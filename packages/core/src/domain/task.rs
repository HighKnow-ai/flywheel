//! `create_task` — the tracer's one-transaction write (DATA-01): the projection row, the
//! human-readable key (D-10), the per-origin event sequence (D-17) and the event (D-19) all
//! commit together, or none of them do.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::rank_after;

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
