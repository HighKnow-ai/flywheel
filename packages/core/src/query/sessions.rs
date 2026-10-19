//! Bounded reads over `sessions`/`worktrees` for a Story's session list and worktree summary
//! (D-31, D-34, 02-UI-SPEC.md "Item detail panel additions") — literal SQL,
//! bound through `params![]`, following `query::events`'s own discipline (T-01-01/T-01-23): no
//! `format!`/string-interpolated SQL anywhere in this module.
//!
//! Neither read stores a rendered label on its row: status words, relative times and durations
//! are derived at read time in the renderer, the same `EventRow.description` rule `query::events`
//! established — a future change to how a status or duration is worded applies to every
//! historical row without a migration.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

/// One row of a Story's session list, newest first (02-UI-SPEC.md "Runs section"). `cost_usd`/
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
/// `acknowledged_at` (added plan 03-10 Task 2, D-49) is `sessions.acknowledged_at`'s own value
/// verbatim — `NULL` until the abandoned-run acknowledgment row's Acknowledge button writes it
/// (`session_acknowledge`, `commands/session.rs`). Meaningless for any status other than
/// `abandoned`, but read for every row regardless — a status can change under a caller between two
/// reads, and this column carries no branch of its own.
#[derive(Debug, Clone, PartialEq)]
pub struct RunRow {
    pub id: String,
    pub story_id: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub external_session_id: Option<String>,
    pub acknowledged_at: Option<String>,
    /// How the session ended (`sessions.ending_reason`, docs/mvp-spec.md §4.5); `None` while live.
    pub ending_reason: Option<String>,
}

const RUNS_FOR_STORY_SQL: &str = "SELECT id, story_id, status, started_at, ended_at, cost_usd, \
    tokens_in, tokens_out, external_session_id, acknowledged_at, ending_reason FROM sessions WHERE story_id = ?1 \
    ORDER BY started_at DESC, id DESC LIMIT ?2 OFFSET ?3";

fn row_to_run(row: &rusqlite::Row) -> rusqlite::Result<RunRow> {
    Ok(RunRow {
        id: row.get(0)?,
        story_id: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        cost_usd: row.get(5)?,
        tokens_in: row.get(6)?,
        tokens_out: row.get(7)?,
        external_session_id: row.get(8)?,
        acknowledged_at: row.get(9)?,
        ending_reason: row.get(10)?,
    })
}

/// `story_id`'s agent runs, newest first by `started_at` then `id` (a total order — two runs can
/// never share a `started_at` down to the same tie-break, matching `query::events::activity_trail`'s
/// own "no bare timestamp sort" discipline applied here to a second column). Bounded by `limit`
/// with an `offset` cursor, never the whole run history at once. A Story with no sessions yet returns
/// an empty vector, never an error.
pub fn runs_for_story(
    conn: &Connection,
    story_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<RunRow>> {
    let mut stmt = conn.prepare(RUNS_FOR_STORY_SQL)?;
    let rows = stmt
        .query_map(params![story_id, limit, offset], row_to_run)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list sessions for the Story")
}

/// The dead session a Stopped Story shows (docs/mvp-spec.md §2 "Attention", §4.5).
#[derive(Debug, Clone, PartialEq)]
pub struct StoppedSession {
    pub session_id: String,
    pub ending_reason: Option<String>,
    pub ended_at: Option<String>,
}

const STOPPED_SESSION_SQL: &str = "SELECT r.id, r.ending_reason, r.ended_at FROM stories s \
    JOIN sessions r ON r.id = (SELECT id FROM sessions WHERE story_id = s.id ORDER BY started_at DESC, id DESC LIMIT 1) \
    WHERE s.id = ?1 AND s.state = 'running' AND r.status NOT IN ('running', 'blocked')";

/// Whether `story_id` is Stopped, worked out from its sessions and never stored: a Running Story
/// whose latest session is dead. A Running Story only leaves Running by handing off, so a dead
/// latest session on a Running Story is one that never handed off. Returns that session, or `None`
/// when the Story is not Stopped (not Running, a live session, or no session yet).
pub fn stopped_session_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Option<StoppedSession>> {
    conn.query_row(STOPPED_SESSION_SQL, params![story_id], |row| {
        Ok(StoppedSession { session_id: row.get(0)?, ending_reason: row.get(1)?, ended_at: row.get(2)? })
    })
    .optional()
    .context("failed to work out whether the Story is Stopped")
}

/// A Story's worktree summary (02-UI-SPEC.md "Worktree summary") — `branch`/`path` as
/// `ensure_worktree` recorded them at creation time (D-23/D-24), never re-derived at read time.
/// `story_key` (plan 03-01 Task 1, WORK-03) is joined in from `stories` so the worktree-removal
/// dialog's heading can print the Story key without a second query. `status` (plan 03-03 Task 3,
/// WORK-06) lets the renderer branch on `missing` — D-45's recovery banner — without a second
/// query either.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeSummary {
    pub branch: String,
    pub path: String,
    pub story_key: String,
    pub status: String,
}

const WORKTREE_SUMMARY_SQL: &str = "SELECT worktrees.branch, worktrees.path, stories.key, worktrees.status \
    FROM worktrees JOIN stories ON worktrees.story_id = stories.id WHERE worktrees.story_id = ?1";

/// `story_id`'s worktree summary, or `None` for a Story with no worktree yet (one worktree per
/// Story, ever — LINK-01/WORK-08's own UNIQUE constraint) — never a row of empty strings standing
/// in for absence.
pub fn worktree_summary_for_story(
    conn: &Connection,
    story_id: &str,
) -> anyhow::Result<Option<WorktreeSummary>> {
    conn.query_row(WORKTREE_SUMMARY_SQL, params![story_id], |row| {
        Ok(WorktreeSummary {
            branch: row.get(0)?,
            path: row.get(1)?,
            story_key: row.get(2)?,
            status: row.get(3)?,
        })
    })
    .optional()
    .context("failed to read worktree summary for the Story")
}
