//! Bounded, literal-SQL reads over `agent_runs`/`permission_requests` for D-37's board-visible
//! "blocked" signal: `blocked_task_ids_for_project` (the board's blocked task-row indicator) and
//! `blocked_count_for_project` (the project-rail count). Follows `query::events`'s own discipline
//! — every statement below is a single literal `&str`, bound through `params![]`, never assembled
//! by `format!`/string interpolation.
//!
//! "Blocked" here means: a task's MOST RECENT agent run (by `started_at`) is currently
//! `status = 'blocked'`. A task's older, already-terminal runs never count, even if one of them
//! happened to end blocked (impossible today since `interrupt_agent_run`/`close_agent_run` always
//! move a run to a terminal status, but the query is written to be correct under that definition
//! regardless).

use anyhow::Context;
use rusqlite::{params, Connection};

const BLOCKED_TASK_IDS_SQL: &str = "SELECT ar.task_id FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' \
    AND ar.started_at = (SELECT MAX(started_at) FROM agent_runs WHERE task_id = ar.task_id) \
    ORDER BY ar.task_id ASC";

const BLOCKED_COUNT_SQL: &str = "SELECT COUNT(*) FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' \
    AND ar.started_at = (SELECT MAX(started_at) FROM agent_runs WHERE task_id = ar.task_id)";

/// Every distinct task id in `project_id` whose most recent agent run is `blocked` (D-37) — feeds
/// the board's blocked task-row indicator. A project with no runs at all returns an empty vector,
/// never an error.
pub fn blocked_task_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(BLOCKED_TASK_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list blocked task ids for project")
}

/// The count of distinct tasks in `project_id` whose most recent agent run is `blocked` (D-37) —
/// feeds the project-rail count. Returns `0`, not an error, for a project with no runs at all.
pub fn blocked_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(BLOCKED_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count blocked tasks for project")?;
    Ok(count)
}
