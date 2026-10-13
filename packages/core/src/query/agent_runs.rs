//! Bounded reads over `agent_runs`/`worktrees` for the item detail panel's Runs section and
//! worktree summary (D-31, D-34, 02-UI-SPEC.md "Item detail panel additions") — literal SQL,
//! bound through `params![]`, following `query::events`'s own discipline (T-01-01/T-01-23): no
//! `format!`/string-interpolated SQL anywhere in this module.
//!
//! Neither read stores a rendered label on its row: status words, relative times and durations
//! are derived at read time in the renderer, the same `EventRow.description` rule `query::events`
//! established — a future change to how a status or duration is worded applies to every
//! historical row without a migration.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

/// One row of a task's Runs section, newest first (02-UI-SPEC.md "Runs section"). `cost_usd`/
/// `tokens_in`/`tokens_out` are `NULL` until the run's first `cost_update`/`result` event lands —
/// the renderer's own concern to distinguish "not yet reported" from "reported as zero."
///
/// `external_session_id` (added plan 02-08 Task 2, a deviation from this module's own original
/// `SELECT` list) is D-30's session identity — the Runs section renders it alongside the run's own
/// id (`Run · session {external_session_id}`) so a run and its session read as one linked record
/// rather than two the user must correlate themselves (02-UI-SPEC.md Discretion #1). `NULL` until
/// the sidecar's own `init` event reports it (AGNT-01) — a run in flight before that event lands
/// renders its run identity alone.
///
/// `acknowledged_at` (added plan 03-10 Task 2, D-49) is `agent_runs.acknowledged_at`'s own value
/// verbatim — `NULL` until the abandoned-run acknowledgment row's Acknowledge button writes it
/// (`agent_run_acknowledge`, `commands/agent_run.rs`). Meaningless for any status other than
/// `abandoned`, but read for every row regardless — a status can change under a caller between two
/// reads, and this column carries no branch of its own.
#[derive(Debug, Clone, PartialEq)]
pub struct RunRow {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub external_session_id: Option<String>,
    pub acknowledged_at: Option<String>,
}

const RUNS_FOR_TASK_SQL: &str = "SELECT id, task_id, status, started_at, ended_at, cost_usd, \
    tokens_in, tokens_out, external_session_id, acknowledged_at FROM agent_runs WHERE task_id = ?1 \
    ORDER BY started_at DESC, id DESC LIMIT ?2 OFFSET ?3";

fn row_to_run(row: &rusqlite::Row) -> rusqlite::Result<RunRow> {
    Ok(RunRow {
        id: row.get(0)?,
        task_id: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        cost_usd: row.get(5)?,
        tokens_in: row.get(6)?,
        tokens_out: row.get(7)?,
        external_session_id: row.get(8)?,
        acknowledged_at: row.get(9)?,
    })
}

/// `task_id`'s agent runs, newest first by `started_at` then `id` (a total order — two runs can
/// never share a `started_at` down to the same tie-break, matching `query::events::activity_trail`'s
/// own "no bare timestamp sort" discipline applied here to a second column). Bounded by `limit`
/// with an `offset` cursor, never the whole run history at once. A task with no runs yet returns
/// an empty vector, never an error.
pub fn runs_for_task(
    conn: &Connection,
    task_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<RunRow>> {
    let mut stmt = conn.prepare(RUNS_FOR_TASK_SQL)?;
    let rows = stmt
        .query_map(params![task_id, limit, offset], row_to_run)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list agent runs for task")
}

/// A task's worktree summary (02-UI-SPEC.md "Worktree summary") — `branch`/`path` as
/// `ensure_worktree` recorded them at creation time (D-23/D-24), never re-derived at read time.
/// `task_key` (plan 03-01 Task 1, WORK-03) is joined in from `tasks` so the worktree-removal
/// dialog's heading can print the task key without a second query. `status` (plan 03-03 Task 3,
/// WORK-06) lets the renderer branch on `missing` — D-45's recovery banner — without a second
/// query either.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeSummary {
    pub branch: String,
    pub path: String,
    pub task_key: String,
    pub status: String,
}

const WORKTREE_SUMMARY_SQL: &str = "SELECT worktrees.branch, worktrees.path, tasks.key, worktrees.status \
    FROM worktrees JOIN tasks ON worktrees.task_id = tasks.id WHERE worktrees.task_id = ?1";

/// `task_id`'s worktree summary, or `None` for a task with no worktree yet (one worktree per
/// task, ever — LINK-01/WORK-08's own UNIQUE constraint) — never a row of empty strings standing
/// in for absence.
pub fn worktree_summary_for_task(
    conn: &Connection,
    task_id: &str,
) -> anyhow::Result<Option<WorktreeSummary>> {
    conn.query_row(WORKTREE_SUMMARY_SQL, params![task_id], |row| {
        Ok(WorktreeSummary {
            branch: row.get(0)?,
            path: row.get(1)?,
            task_key: row.get(2)?,
            status: row.get(3)?,
        })
    })
    .optional()
    .context("failed to read worktree summary for task")
}
