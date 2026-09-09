//! Epic mutations (BOARD-01, BOARD-04): `create_epic`, `update_epic`, `delete_epic` and
//! `set_epic_status`, each opening exactly one `conn.transaction()` and committing the
//! projection row and its event together (DATA-01), following `task.rs::create_task`'s shape.
//!
//! Epics share `tasks`' project-scoped key counter (D-10) — `create_epic` allocates from the
//! same `projects.key_counter` column `create_task` does, so keys stay unique across entity
//! types within a project (e.g. a project never has both an `FLY-3` epic and an `FLY-3` task).

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::acceptance_criterion::delete_criteria_for_parent;
use crate::domain::event::{append_event, next_sequence};
use crate::domain::task::DEFAULT_PRIORITY;
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

/// An epic row, as read back immediately after a mutation commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Epic {
    pub id: String,
    pub project_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub rank: String,
    pub priority: i64,
}

/// Create an epic: one transaction allocates the tail rank for the backlog band, allocates the
/// next project key (shared with `tasks`, D-10), inserts the `epics` row, and appends an
/// `epic.created` event — then commits once.
pub fn create_epic(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    description: Option<&str>,
) -> anyhow::Result<Epic> {
    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM epics WHERE project_id = ?1 AND status = 'backlog' ORDER BY rank DESC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the backlog tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    // Same `projects.key_counter` column `create_task` allocates from — keys stay unique across
    // entity types within a project (D-10).
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
        "INSERT INTO epics (
            id, project_id, key, title, description, status, rank, priority,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'backlog', ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, key, title, description, rank, DEFAULT_PRIORITY, actor_id, now],
    )
    .context("failed to insert epic")?;

    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": "backlog",
        "title": title,
        "label": format!("Created epic \"{title}\""),
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "epic",
        &id,
        None,
        Some(&id),
        actor_id,
        "epic.created",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit create_epic transaction")?;

    Ok(Epic {
        id,
        project_id: project_id.to_string(),
        key,
        title: title.to_string(),
        description: description.map(|s| s.to_string()),
        status: "backlog".to_string(),
        rank,
        priority: DEFAULT_PRIORITY,
    })
}

/// Patch an epic's `title`/`description` — `None` leaves the field unchanged. Appends exactly
/// one event per call, carrying the before/after values of whichever fields actually changed.
pub fn update_epic(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    title: Option<&str>,
    description: Option<&str>,
) -> anyhow::Result<Epic> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, key, current_title, current_description, status, rank, priority): (
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT project_id, key, title, description, status, rank, priority FROM epics WHERE id = ?1",
            params![epic_id],
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
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    let new_title = title.unwrap_or(&current_title);
    let new_description = description.or(current_description.as_deref());

    tx.execute(
        "UPDATE epics SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_title, new_description, now, epic_id],
    )
    .context("failed to update epic")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.updated",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit update_epic transaction")?;

    Ok(Epic {
        id: epic_id.to_string(),
        project_id,
        key,
        title: new_title.to_string(),
        description: new_description.map(|s| s.to_string()),
        status,
        rank,
        priority,
    })
}

/// Delete an epic. Idempotent: deleting an id that no longer exists returns `Ok` and appends no
/// event. Children are **orphaned, never cascade-deleted** (D-13, T-01-16): `tasks.epic_id` is
/// set to NULL for every task under this epic, and `issues.epic_id` is set to NULL for every
/// issue linked to this epic, both before the epic row itself is removed, so an epic deletion
/// never destroys a user's unrecoverable task work and never fails with a foreign-key error.
pub fn delete_epic(conn: &mut Connection, actor_id: &str, epic_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT project_id, title FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to read epic before delete")?;

    let Some((project_id, title)) = existing else {
        // Already gone — idempotent success, no second event.
        tx.commit().context("failed to commit no-op delete_epic transaction")?;
        return Ok(());
    };

    tx.execute(
        "UPDATE tasks SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2",
        params![now, epic_id],
    )
    .context("failed to orphan child tasks")?;

    // Issues referencing this epic must also be orphaned, not left dangling — `issues.epic_id`
    // is a `NO ACTION` FK to `epics(id)` with `foreign_keys = ON`, so the `DELETE FROM epics`
    // below would otherwise fail with a raw SQLite FK constraint error the moment any issue is
    // linked to this epic (CR-01). Mirrors the child-task orphaning above: a plain UPDATE, no
    // event appended for the orphaning itself, consistent with how child tasks are orphaned.
    tx.execute(
        "UPDATE issues SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2",
        params![now, epic_id],
    )
    .context("failed to orphan issues referencing this epic")?;

    // The epic's own criteria are deleted with it (unlike its child tasks, which are orphaned,
    // not cascaded) — one `criterion.deleted` event per row, inside this same transaction.
    delete_criteria_for_parent(&tx, &project_id, actor_id, "epic", epic_id, &now)?;

    tx.execute("DELETE FROM epics WHERE id = ?1", params![epic_id])
        .context("failed to delete epic")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "existing",
        "after": "deleted",
        "title": title,
        "label": format!("Deleted epic \"{title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.deleted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit delete_epic transaction")?;
    Ok(())
}

/// Set an epic's workflow status. A redundant transition (new value equals the current value) is
/// a no-op: `Ok` is returned, `updated_at` is left untouched, and no event is appended. An
/// invalid status is rejected by the schema CHECK constraint in migration `0002_board_schema.sql`
/// — this function performs no application-layer allow-list of its own (BOARD-04, T-01-15).
pub fn set_epic_status(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    new_status: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_status): (String, String) = tx
        .query_row(
            "SELECT project_id, status FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if current_status == new_status {
        tx.commit().context("failed to commit no-op set_epic_status transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE epics SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_status, now, epic_id],
    )
    .context("failed to set epic status")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.status_changed",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit set_epic_status transaction")?;
    Ok(())
}

/// Move an epic up or down by one position within its `(project_id, status, priority)` band
/// (D-11, BOARD-05) — mirrors `task.rs::reorder_task`'s shape exactly (same neighbour-lookup
/// query shape, same one-`UPDATE`-per-move discipline), against `epics` instead of `tasks`.
pub fn reorder_epic(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    direction: ReorderDirection,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, status, priority, rank): (String, String, i64, String) = tx
        .query_row(
            "SELECT project_id, status, priority, rank FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    let new_rank = match direction {
        ReorderDirection::Up => {
            let mut stmt = tx.prepare(
                "SELECT rank FROM epics
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) < (?4, ?5)
                 ORDER BY rank DESC, id DESC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, epic_id], |row| {
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
                "SELECT rank FROM epics
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) > (?4, ?5)
                 ORDER BY rank ASC, id ASC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, epic_id], |row| {
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
            .context("failed to commit no-op reorder_epic transaction")?;
        return Ok(());
    };

    tx.execute(
        "UPDATE epics SET rank = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_rank, now, epic_id],
    )
    .context("failed to reorder epic")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.reordered",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit reorder_epic transaction")?;
    Ok(())
}

/// Set an epic's priority — mirrors `task.rs::set_priority` exactly.
pub fn set_priority(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    new_priority: i64,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_priority): (String, i64) = tx
        .query_row(
            "SELECT project_id, priority FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if current_priority == new_priority {
        tx.commit()
            .context("failed to commit no-op set_priority transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE epics SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_priority, now, epic_id],
    )
    .context("failed to set epic priority")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.priority_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_priority transaction")?;
    Ok(())
}

/// Set an epic's estimate — mirrors `task.rs::set_estimate` exactly (D-12: nullable, never
/// aggregated).
pub fn set_estimate(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    new_estimate: Option<i64>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_estimate): (String, Option<i64>) = tx
        .query_row(
            "SELECT project_id, estimate FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if current_estimate == new_estimate {
        tx.commit()
            .context("failed to commit no-op set_estimate transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE epics SET estimate = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_estimate, now, epic_id],
    )
    .context("failed to set epic estimate")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.estimate_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_estimate transaction")?;
    Ok(())
}

/// Set an epic's assignee — mirrors `task.rs::set_assignee` exactly (T-01-21: an id naming no
/// actor row is rejected by the `assignee_id` foreign key, not by an application-layer check).
pub fn set_assignee(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    new_assignee_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_assignee_id): (String, Option<String>) = tx
        .query_row(
            "SELECT project_id, assignee_id FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if current_assignee_id.as_deref() == new_assignee_id {
        tx.commit()
            .context("failed to commit no-op set_assignee transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE epics SET assignee_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_assignee_id, now, epic_id],
    )
    .context("failed to set epic assignee — assignee_id must reference an existing actor")?;

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
        "epic",
        epic_id,
        None,
        Some(epic_id),
        actor_id,
        "epic.assignee_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_assignee transaction")?;
    Ok(())
}
