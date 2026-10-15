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

/// The project's full epic roster (BOARD-06, G-01-2): the three fields the epic pill, the filter
/// chips and the picker options consume (`id`, `key`, `title`), plus the two the roster header's
/// sub-label reads (`status`, `integration_branch`; 08.1-14 finish review). Still deliberately not
/// the full epic row: no description, rank or priority.
#[derive(Debug, Clone, PartialEq)]
pub struct EpicSummary {
    pub id: String,
    pub key: String,
    pub title: String,
    /// The epic's own workflow status, as the board stores it.
    pub status: String,
    /// `None` until an agent first runs against the epic (D-25 cuts the branch lazily) — which is a
    /// fact the header says in words ("no integration branch yet"), never a blank.
    pub integration_branch: Option<String>,
}

/// [`list_epics`]'s ceiling (D-87, plan 05-04, closing `01-SECURITY.md` AR-01-04): five hundred
/// times `board.rs`'s `DEFAULT_LIMIT`, and NOT a page size — nothing in this crate paginates
/// against it. AR-01-04's own objection to a naive cap was that a cap would *silently* truncate
/// the roster and reintroduce G-01-2 (an epic sorting outside the window rendering as a raw
/// internal ULID). A ceiling this far above any realistic human-authored roster, combined with
/// [`EpicRoster::truncated`] — a fact the caller must render, never swallow (D-16: surface a
/// mismatch, never silently repair it) — removes the unbounded read AR-01-04 flagged as this
/// phase's re-rate trigger without recreating the silence that made the original exemption safe
/// to reject.
pub const EPIC_ROSTER_CEILING: i64 = 5000;

/// [`list_epics`]'s return shape (D-16, D-87): the roster page (bounded by
/// [`EPIC_ROSTER_CEILING`]), the project's TRUE epic count, and whether the two differ. A caller
/// that ignores `truncated` gets exactly `EPIC_ROSTER_CEILING` rows and no signal that more exist
/// — the renderer must check this field, not infer truncation from `epics.len()` alone.
#[derive(Debug, Clone, PartialEq)]
pub struct EpicRoster {
    pub epics: Vec<EpicSummary>,
    pub total: i64,
    pub truncated: bool,
}

/// List every epic in `project_id`, up to [`EPIC_ROSTER_CEILING`] — no longer literally unwindowed
/// (closing `01-SECURITY.md` AR-01-04's re-rate trigger: Phase 5 gives an agent a board read
/// path), but still deliberately NOT `board.rs`'s `DEFAULT_LIMIT`/200-row window: epics are a
/// small roster, and resolving a label against a 200-row `list_board` page was UAT gap G-01-2 —
/// any epic sorting outside that window had no entry, so `BoardRow.tsx` fell back to rendering the
/// epic's raw internal ULID. Placed here rather than in `query/mod.rs` because that module is
/// framed specifically around the bounded, cursor-resumable board window, exactly as `list_actors`
/// sits in `domain/actor.rs` rather than in `query/`. `query::authoring::list_epics_page` is the
/// SEPARATE, `DEFAULT_LIMIT`/`MAX_LIMIT`-clamped read an agent's own tools call (plan 05-04 Task
/// 2) — two reads, two ceilings, one reason each, never one function serving both purposes.
///
/// Orders by `crate::query::ORDER_BY` — the same status-band/priority/rank/id total order
/// `list_board` uses (BOARD-05) — so this roster's own iteration order, where it happens to
/// matter (e.g. a picker's option list), never drifts from the board's. `ORDER_BY` is itself a
/// `const` built with `concat!` from literals, but `concat!` accepts only literal tokens, not a
/// path to another `const` (`crate::query::ORDER_BY` cannot be spliced into a second `concat!`
/// call) — so the two compile-time-literal fragments are joined with the `[&str]::concat`
/// **slice method** (not the `concat!` macro), exactly the discipline `query/mod.rs`'s own
/// `format_sql` helper uses for the identical reason. Every fragment is a literal; the only
/// runtime value is `project_id`, bound through `params![]`, never interpolated into the string
/// (T-01-01/T-01-23) — this function contains no `format!`.
pub fn list_epics(conn: &Connection, project_id: &str) -> anyhow::Result<EpicRoster> {
    let sql: String = [
        "SELECT b.id, b.key, b.title, b.status, b.integration_branch FROM epics b WHERE b.project_id = ?1 ",
        crate::query::ORDER_BY,
        " LIMIT ?2",
    ]
    .concat();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![project_id, EPIC_ROSTER_CEILING], |row| {
            Ok(EpicSummary {
                id: row.get(0)?,
                key: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                integration_branch: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    let epics = rows.context("failed to list the project's epics")?;

    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM epics WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to count the project's epics")?;

    let truncated = total > epics.len() as i64;

    Ok(EpicRoster { epics, total, truncated })
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
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let epic = create_epic_in_tx(&tx, project_id, actor_id, title, description, &now)?;
    tx.commit().context("failed to commit create_epic transaction")?;
    Ok(epic)
}

/// The statement body [`create_epic`] issues, factored out so a caller composing an epic creation
/// with something else in the SAME transaction —
/// `domain::authoring_proposal::accept_proposal`, which must never write `epics` through a second
/// statement of its own (T-05-02-03, mirrors `task::create_task_in_tx`'s identical precedent) —
/// can run it inside a transaction it already owns. `create_epic`'s own body and signature are
/// otherwise unchanged; this is the same statements, callable from inside the caller's
/// transaction.
pub fn create_epic_in_tx(
    tx: &rusqlite::Transaction,
    project_id: &str,
    actor_id: &str,
    title: &str,
    description: Option<&str>,
    now: &str,
) -> anyhow::Result<Epic> {
    let id = new_id();

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

    // Unlike a task (created at `todo`, where `backlog` is a legacy band with no producer), an
    // epic IS still created at `backlog` by a human. The band means different things for the two
    // types, deliberately; what an epic's status should be is the owner's open Phase 14 decision
    // (`13-VERIFICATION.md` `human_verification`), not settled here.
    tx.execute(
        "INSERT INTO epics (
            id, project_id, key, title, description, status, rank, priority,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'backlog', ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, key, title, description, rank, DEFAULT_PRIORITY, actor_id, now],
    )
    .context("failed to insert epic")?;

    let sequence = next_sequence(tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": "backlog",
        "title": title,
        "label": format!("Created epic \"{title}\""),
    });
    append_event(
        tx,
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
        now,
    )?;

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
    let epic = update_epic_in_tx(&tx, actor_id, epic_id, title, description, &now)?;
    tx.commit().context("failed to commit update_epic transaction")?;
    Ok(epic)
}

/// The statement body [`update_epic`] issues, factored out so `domain::authoring_proposal::accept_proposal`
/// can materialise an `amend`/`epic` proposal inside its own already-open transaction — mirrors
/// [`create_epic_in_tx`]'s identical factoring reason.
pub fn update_epic_in_tx(
    tx: &rusqlite::Transaction,
    actor_id: &str,
    epic_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    now: &str,
) -> anyhow::Result<Epic> {
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

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "title",
        "before": current_title,
        "after": new_title,
        "label": format!("Edited title to \"{new_title}\""),
    });
    append_event(
        tx,
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
        now,
    )?;

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
    delete_epic_in_tx(&tx, actor_id, epic_id, &now)?;
    tx.commit().context("failed to commit delete_epic transaction")?;
    Ok(())
}

/// The statement body [`delete_epic`] issues, factored out so `domain::authoring_proposal::accept_proposal`
/// can materialise a `delete`/`epic` proposal inside its own already-open transaction — mirrors
/// [`create_epic_in_tx`]'s identical factoring reason. Idempotent, exactly like [`delete_epic`]
/// itself: an id that no longer exists is a no-op, no event appended.
pub fn delete_epic_in_tx(tx: &rusqlite::Transaction, actor_id: &str, epic_id: &str, now: &str) -> anyhow::Result<()> {
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
    delete_criteria_for_parent(tx, &project_id, actor_id, "epic", epic_id, now)?;

    tx.execute("DELETE FROM epics WHERE id = ?1", params![epic_id])
        .context("failed to delete epic")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "existing",
        "after": "deleted",
        "title": title,
        "label": format!("Deleted epic \"{title}\""),
    });
    append_event(
        tx,
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
        now,
    )?;

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
    let tx = conn.transaction()?;
    set_epic_priority_in_tx(&tx, actor_id, epic_id, new_priority)?;
    tx.commit()
        .context("failed to commit set_priority transaction")?;
    Ok(())
}

/// The statement body [`set_priority`] issues, factored out like `task::set_priority_in_tx` so
/// accepting a priority suggestion can compose with
/// `authoring_proposal::accept_proposal_in_tx`'s transaction rather than nesting a second one
/// (D-16, D-17, F4). Does not commit — the caller's transaction owns that.
pub fn set_epic_priority_in_tx(
    tx: &rusqlite::Transaction,
    actor_id: &str,
    epic_id: &str,
    new_priority: i64,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    let (project_id, current_priority): (String, i64) = tx
        .query_row(
            "SELECT project_id, priority FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if current_priority == new_priority {
        return Ok(());
    }

    tx.execute(
        "UPDATE epics SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_priority, now, epic_id],
    )
    .context("failed to set epic priority")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "priority",
        "before": current_priority,
        "after": new_priority,
        "label": format!("Changed priority from {current_priority} to {new_priority}"),
    });
    append_event(
        tx,
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

/// Lazily cut an epic's integration branch (D-25): if `epics.integration_branch` is already set,
/// return it unchanged and cut nothing. Otherwise derive the name (`branch::epic_integration_branch_name`),
/// verify the ref does not already exist, cut it from the project's `default_branch` tip, and — in
/// ONE transaction — write `epics.integration_branch` and append an
/// `epic.integration_branch_created` event. An epic that never runs an agent never leaves a branch
/// behind — this is the only writer of `epics.integration_branch` in this crate.
pub fn ensure_epic_integration_branch(
    conn: &mut Connection,
    epic_id: &str,
    actor_id: &str,
) -> anyhow::Result<String> {
    let (project_id, epic_key, epic_title, existing_branch): (String, String, String, Option<String>) = conn
        .query_row(
            "SELECT project_id, key, title, integration_branch FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    if let Some(branch) = existing_branch {
        return Ok(branch);
    }

    let (repo_path, default_branch): (String, String) = conn
        .query_row(
            "SELECT repo_path, default_branch FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let branch_name = crate::branch::epic_integration_branch_name(&epic_key, &epic_title);
    let repo_path = std::path::Path::new(&repo_path);

    if crate::git::rev_parse_verify(repo_path, &branch_name)? {
        anyhow::bail!(
            "ensure_epic_integration_branch refused: branch {branch_name:?} already exists in {repo_path:?}"
        );
    }

    crate::git::git_at(repo_path, &["branch", &branch_name, &default_branch]).with_context(|| {
        format!("failed to cut integration branch {branch_name:?} for epic {epic_id:?}")
    })?;

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE epics SET integration_branch = ?1, updated_at = ?2 WHERE id = ?3",
        params![branch_name, now, epic_id],
    )
    .context("failed to write epics.integration_branch")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "integration_branch",
        "before": null,
        "after": branch_name,
        "label": format!("Cut integration branch {branch_name}"),
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
        "epic.integration_branch_created",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit ensure_epic_integration_branch transaction")?;

    Ok(branch_name)
}
