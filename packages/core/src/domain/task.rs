//! `create_task` — the tracer's one-transaction write (DATA-01): the projection row, the
//! human-readable key (D-10), the per-origin event sequence (D-17) and the event (D-19) all
//! commit together, or none of them do.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::acceptance_criterion::delete_criteria_for_parent;
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

/// The default priority for a newly created task: "No priority", keyed `0` in the keyboard map.
/// It SORTS LAST in `query::list_board` despite being keyed `0` — see that module's sort-key
/// expression (01-UI-SPEC.md Open Decisions #6).
pub const DEFAULT_PRIORITY: i64 = 0;

/// A task row, as read back immediately after `create_task` commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
}

/// Create a task: opens exactly one `conn.transaction()` and, inside it, computes the tail rank
/// for the backlog band, allocates the project's next human-readable key, inserts the `tasks`
/// row, allocates the next event sequence and appends a `task.created` event — then commits
/// once. The projection row and the event either both land or neither does (DATA-01).
///
/// `epic_id` is nullable by design (D-13) — a task may exist before its epic is known. This
/// function performs no join to `epics` and does not require one to exist.
pub fn create_task(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    epic_id: Option<&str>,
) -> anyhow::Result<Task> {
    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM tasks WHERE project_id = ?1 AND status = 'backlog' ORDER BY rank DESC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the backlog tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    // Allocate the human-readable key in the same transaction as the insert (D-10) — no gaps,
    // no races.
    let key: String = tx
        .query_row(
            "UPDATE projects SET key_counter = key_counter + 1
             WHERE id = ?1
             RETURNING key_prefix || '-' || key_counter",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to allocate the next project key")?;

    tx.execute(
        "INSERT INTO tasks (
            id, project_id, epic_id, key, title, status, rank, priority,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'backlog', ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, epic_id, key, title, rank, DEFAULT_PRIORITY, actor_id, now],
    )
    .context("failed to insert task")?;

    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": "backlog",
        "title": title,
        "label": format!("Created task \"{title}\""),
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "task",
        &id,
        Some(&id),
        None,
        actor_id,
        "task.created",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit create_task transaction")?;

    Ok(Task {
        id,
        project_id: project_id.to_string(),
        epic_id: epic_id.map(|s| s.to_string()),
        key,
        title: title.to_string(),
        status: "backlog".to_string(),
        rank,
        priority: DEFAULT_PRIORITY,
    })
}

/// Patch a task's `title`/`description` — `None` leaves the field unchanged (mirrors
/// `epic.rs::update_epic`'s shape). Appends exactly one event carrying the before/after title.
pub fn update_task(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    title: Option<&str>,
    description: Option<&str>,
) -> anyhow::Result<Task> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_title, current_description, status, rank, priority): (
        String,
        Option<String>,
        String,
        Option<String>,
        String,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, title, description, status, rank, priority FROM tasks WHERE id = ?1",
            params![task_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let new_title = title.unwrap_or(&current_title);
    let new_description = description.or(current_description.as_deref());

    tx.execute(
        "UPDATE tasks SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_title, new_description, now, task_id],
    )
    .context("failed to update task")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "title",
        "before": current_title,
        "after": new_title,
        "label": format!("Edited title to \"{new_title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.updated",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit update_task transaction")?;

    Ok(Task {
        id: task_id.to_string(),
        project_id,
        epic_id,
        key: String::new(),
        title: new_title.to_string(),
        status,
        rank,
        priority,
    })
}

/// Delete a task. Idempotent: deleting an id that no longer exists returns `Ok` and appends no
/// second event. Issues linked to this task are **orphaned, never cascade-deleted**: `issues.task_id`
/// is set to NULL before the task row itself is removed, so a task deletion never fails with a
/// foreign-key error when an issue references it (CR-01).
pub fn delete_task(conn: &mut Connection, actor_id: &str, task_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, Option<String>, String)> = tx
        .query_row(
            "SELECT project_id, epic_id, title FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read task before delete")?;

    let Some((project_id, epic_id, title)) = existing else {
        tx.commit().context("failed to commit no-op delete_task transaction")?;
        return Ok(());
    };

    // Issues referencing this task must also be orphaned, not left dangling — `issues.task_id`
    // is a `NO ACTION` FK to `tasks(id)` with `foreign_keys = ON`, so the `DELETE FROM tasks`
    // below would otherwise fail with a raw SQLite FK constraint error the moment any issue is
    // linked to this task (CR-01). Mirrors `delete_epic`'s issue-orphaning: a plain UPDATE, no
    // event appended for the orphaning itself.
    tx.execute(
        "UPDATE issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",
        params![now, task_id],
    )
    .context("failed to orphan issues referencing this task")?;

    // Criteria belong exclusively to their parent (unlike a task's epic, which is orphaned, not
    // cascaded) — deleting the parent deletes its criteria, one `criterion.deleted` event per
    // row, inside this same transaction (D-06, D-19).
    delete_criteria_for_parent(&tx, &project_id, actor_id, "task", task_id, &now)?;

    tx.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
        .context("failed to delete task")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "existing",
        "after": "deleted",
        "title": title,
        "label": format!("Deleted task \"{title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.deleted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit delete_task transaction")?;
    Ok(())
}

/// Set a task's workflow status. A redundant transition (new value equals the current value) is
/// a no-op: `Ok` is returned, `updated_at` is left untouched, and no event is appended. An
/// invalid status is rejected by the schema CHECK constraint in migration `0002_board_schema.sql`
/// (BOARD-04, T-01-15) — this function performs no application-layer allow-list of its own.
pub fn set_task_status(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_status: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_status): (String, Option<String>, String) = tx
        .query_row(
            "SELECT project_id, epic_id, status FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_status == new_status {
        tx.commit().context("failed to commit no-op set_task_status transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_status, now, task_id],
    )
    .context("failed to set task status")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": current_status,
        "after": new_status,
        "label": format!("Changed status from {current_status} to {new_status}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.status_changed",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit set_task_status transaction")?;
    Ok(())
}

/// Move a task up or down by one position within its `(project_id, status, priority)` band
/// (D-11, BOARD-05) — the manual-rank half of the tie-break rule ("priority sorts first, rank
/// orders within a band"). Filtering the neighbour lookup by `priority`, not merely
/// `(project_id, status)`, is what keeps `⌘↑`/`⌘↓` from computing a rank against a neighbour in a
/// different priority band: `list_board`'s `priority ASC, rank ASC, id ASC` order groups by
/// priority first, so the neighbour a keyboard reorder must actually displace is scoped by
/// priority too.
///
/// One transaction: read the task's own `(project_id, status, priority, rank)`, look up its one
/// or two nearest neighbours in the move direction with a single indexed query against
/// `(project_id, status, rank)`, compute the new rank from [`rank_before`]/[`rank_between`]/
/// [`rank_after`], write exactly one `UPDATE`, append one `task.reordered` event, and commit.
/// A task with no neighbour in the move direction (already first for `Up`, already last for
/// `Down`, or the only item in its band) is a no-op: `Ok` is returned and no row is written.
pub fn reorder_task(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    direction: ReorderDirection,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, status, priority, rank): (
        String,
        Option<String>,
        String,
        i64,
        String,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, status, priority, rank FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let new_rank = match direction {
        ReorderDirection::Up => {
            // Newest-first by (rank, id): LIMIT 2 gives [immediate predecessor, its own
            // predecessor] in one indexed query against (project_id, status, rank).
            let mut stmt = tx.prepare(
                "SELECT rank FROM tasks
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) < (?4, ?5)
                 ORDER BY rank DESC, id DESC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, task_id], |row| {
                    row.get(0)
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the preceding neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [prev] => Some(rank_before(Some(prev.as_str()))?),
                [prev, prev_prev, ..] => Some(rank_between(prev_prev, prev)?),
            }
        }
        ReorderDirection::Down => {
            let mut stmt = tx.prepare(
                "SELECT rank FROM tasks
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) > (?4, ?5)
                 ORDER BY rank ASC, id ASC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, task_id], |row| {
                    row.get(0)
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the following neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [next] => Some(rank_after(Some(next.as_str()))?),
                [next, next_next, ..] => Some(rank_between(next, next_next)?),
            }
        }
    };

    let Some(new_rank) = new_rank else {
        tx.commit()
            .context("failed to commit no-op reorder_task transaction")?;
        return Ok(());
    };

    tx.execute(
        "UPDATE tasks SET rank = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_rank, now, task_id],
    )
    .context("failed to reorder task")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "rank",
        "before": rank,
        "after": new_rank,
        "label": "Reordered",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.reordered",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit reorder_task transaction")?;
    Ok(())
}

/// Set a task's priority (D-11, 5-level Linear convention, 0-4). A redundant change (new value
/// equals the current value) is a no-op: `Ok` is returned, `updated_at` is left untouched, and no
/// event is appended. A priority outside `0..=4` is rejected by the schema CHECK constraint in
/// migration `0002_board_schema.sql` — this function performs no application-layer range check
/// of its own, mirroring `set_task_status`'s deferral to the schema.
pub fn set_priority(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_priority: i64,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_priority): (String, Option<String>, i64) = tx
        .query_row(
            "SELECT project_id, epic_id, priority FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_priority == new_priority {
        tx.commit()
            .context("failed to commit no-op set_priority transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_priority, now, task_id],
    )
    .context("failed to set task priority")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "priority",
        "before": current_priority,
        "after": new_priority,
        "label": format!("Changed priority from {current_priority} to {new_priority}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.priority_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_priority transaction")?;
    Ok(())
}

/// Set a task's estimate (D-12: nullable ordinal S/M/L, stored 1-3). `new_estimate = None` clears
/// the field — the column carries no default. A redundant change is a no-op, mirroring
/// `set_priority`. An out-of-range value is rejected by the schema CHECK constraint, not by this
/// function. Nothing in this crate aggregates the estimate column (D-12) — this function only
/// ever writes the single row it was called for.
pub fn set_estimate(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_estimate: Option<i64>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_estimate): (String, Option<String>, Option<i64>) = tx
        .query_row(
            "SELECT project_id, epic_id, estimate FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_estimate == new_estimate {
        tx.commit()
            .context("failed to commit no-op set_estimate transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET estimate = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_estimate, now, task_id],
    )
    .context("failed to set task estimate")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "estimate",
        "before": current_estimate,
        "after": new_estimate,
        "label": "Changed estimate",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.estimate_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_estimate transaction")?;
    Ok(())
}

/// Set a task's assignee to an actor id, or clear it with `None`. An id that names no row in
/// `actors` is rejected by the `assignee_id` foreign key (T-01-21) — `foreign_keys = ON` is set
/// on every connection (`db::open_and_migrate`), so this function performs no application-layer
/// existence check of its own; the `UPDATE` itself fails with a SQLite foreign-key-constraint
/// error. A redundant change is a no-op, mirroring `set_priority`/`set_estimate`.
pub fn set_assignee(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_assignee_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_assignee_id): (String, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id, assignee_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_assignee_id.as_deref() == new_assignee_id {
        tx.commit()
            .context("failed to commit no-op set_assignee transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET assignee_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_assignee_id, now, task_id],
    )
    .context("failed to set task assignee — assignee_id must reference an existing actor")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "assignee_id",
        "before": current_assignee_id,
        "after": new_assignee_id,
        "label": "Changed assignee",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.assignee_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_assignee transaction")?;
    Ok(())
}
