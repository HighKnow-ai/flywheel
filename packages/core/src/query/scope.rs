//! `scope_denied_counts` — the board's per-task scope-refusal badge (PLAN-05), read once per board
//! read.
//!
//! One grouped, parameterised query over `idx_events_type_task` (migration 0019). A task with no
//! refusal is ABSENT from the result: the board renders nothing rather than a zero. The window is
//! capped server-side at [`MAX_SCOPE_COUNT_ROWS`] whatever the caller asks for. Every statement is
//! a literal bound through `params![]` (T-01-01/T-01-23).

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::domain::file_set::EVENT_SCOPE_DENIED;

/// The most tasks one call returns.
pub const MAX_SCOPE_COUNT_ROWS: i64 = 1000;

/// One task's refusal count. `count` is at least 1 — a task with none is not in the result.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeDeniedCount {
    pub task_id: String,
    pub count: i64,
}

/// Refusal counts for the tasks of `project_id` that have at least one, most-refused first.
pub fn scope_denied_counts(
    conn: &Connection,
    project_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<ScopeDeniedCount>> {
    let limit = limit.clamp(1, MAX_SCOPE_COUNT_ROWS);
    let mut stmt = conn
        .prepare(
            "SELECT task_id, COUNT(*) AS n FROM events
             WHERE event_type = ?1 AND project_id = ?2 AND task_id IS NOT NULL
             GROUP BY task_id ORDER BY n DESC, task_id ASC LIMIT ?3",
        )
        .context("failed to prepare the scope-denied count read")?;
    let rows = stmt
        .query_map(params![EVENT_SCOPE_DENIED, project_id, limit], |r| {
            Ok(ScopeDeniedCount { task_id: r.get(0)?, count: r.get(1)? })
        })
        .context("failed to read the scope-denied counts")?;
    rows.collect::<Result<Vec<_>, _>>().context("failed to read a scope-denied count row")
}
