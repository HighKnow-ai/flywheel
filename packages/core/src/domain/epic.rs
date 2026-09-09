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

use crate::domain::event::{append_event, next_sequence};
use crate::domain::task::DEFAULT_PRIORITY;
use crate::ids::new_id;
use crate::ranking::rank_after;

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

    let (project_id, current_title, current_description, status, rank, priority): (
        String,
        String,
        Option<String>,
        String,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT project_id, title, description, status, rank, priority FROM epics WHERE id = ?1",
            params![epic_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
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
        key: String::new(),
        title: new_title.to_string(),
        description: new_description.map(|s| s.to_string()),
        status,
        rank,
        priority,
    })
}

/// Delete an epic. Idempotent: deleting an id that no longer exists returns `Ok` and appends no
/// event. Children are **orphaned, never cascade-deleted** (D-13, T-01-16): `tasks.epic_id` is
/// set to NULL for every task under this epic before the epic row itself is removed, so an epic
/// deletion never destroys a user's unrecoverable task work.
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
