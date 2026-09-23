//! Bounded, literal-SQL reads over `worktrees`/`agent_runs`/`events` for D-46's board-visible
//! "recovery needed" signal: `recovery_task_ids_for_project` (the board's Needs Decision pill) and
//! `recovery_count_for_project` (the project-rail count). Structurally mirrors
//! `query::permissions::blocked_task_ids_for_project`/`blocked_count_for_project` — the exact
//! pair this module's functions were written against, including their compile-time-literal SQL
//! and single-bound-parameter discipline (never `format!`, T-01-01/T-01-23).
//!
//! "A recovery item is outstanding" here means any of three independent facts about a task:
//!   1. its `worktrees` row reads `status = 'missing'` (D-45 — the reconciler found nothing on
//!      disk where the database expected a worktree), or
//!   2. it has an `agent_runs` row with `status = 'abandoned'` and `acknowledged_at IS NULL`
//!      (D-49/D-50 — the launch reconciler recorded a session Flywheel could not supervise to a
//!      clean end, and nobody has told the app "I've seen it" yet), or
//!   3. its most recent `agent_runs` row has at least one `drift.detected` event on it (D-72
//!      through D-75, plan 04-12) — a fired drift detector, told to the board as well as to the
//!      agent.
//!
//! Deliberately NOT required for arm 2: that the abandoned run be the task's *most recent* run. A
//! task whose latest run completed cleanly but whose EARLIER run was abandoned and never
//! acknowledged still has something the user has not seen — D-46's item is about the user having
//! *seen* the fact, and a later clean run does not retroactively make an earlier abandonment
//! seen. This is a deliberate divergence from `blocked_task_ids_for_project`'s own "most recent
//! run" definition, which exists for a different reason (a task can only ever be blocked by its
//! current run).
//!
//! Arm 3 makes the OPPOSITE choice, deliberately: recency IS required. A drift warning is a
//! statement about the *current* relationship between the board and the repository, not about
//! whether the user has seen a past fact — D-75 says the signal clears the moment the underlying
//! fact clears, and the honest way to express "the underlying fact cleared" in SQL is "the most
//! recent run recorded none," never "some run, ever, recorded one." Two arms with two different
//! recency rules, each with its own reason written down here, is more honest than reusing one rule
//! that is wrong for one of them.

use anyhow::Context;
use rusqlite::{params, Connection};

// `UNION` (not `UNION ALL`) is what makes a task carrying two or more of the three conditions
// below appear exactly once — do not "optimise" this to `UNION ALL`. A task whose worktree is
// missing AND whose latest run drifted would otherwise contribute two rows, over-counting it in
// `recovery_count_for_project` and disagreeing with the single pill `recovery_task_ids_for_project`
// implies (T-03-11-04, T-04-34).
//
// Arm 3's "most recent run" is expressed as a correlated subquery ordered `started_at DESC, id
// DESC LIMIT 1` — the same ordering `idx_agent_runs_task_started` already backs, with the ULID
// `id` as a deterministic tie-break for two runs started in the same instant (mirrors this
// crate's own CTX-04 convention elsewhere). `events.stream_id` names the run directly, exactly as
// `domain::agent_run::record_drift_warnings` writes it.
const RECOVERY_TASK_IDS_SQL: &str = "SELECT task_id FROM worktrees \
    WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT task_id FROM agent_runs \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL \
    UNION \
    SELECT ar.task_id FROM agent_runs ar \
    WHERE ar.project_id = ?1 \
    AND ar.id = ( \
        SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = ar.task_id \
        ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1 \
    ) \
    AND EXISTS ( \
        SELECT 1 FROM events e WHERE e.stream_id = ar.id AND e.event_type = 'drift.detected' \
    ) \
    ORDER BY task_id ASC";

// Counts over the SAME union `recovery_task_ids_for_project` reads, rather than summing counts
// from either table separately, so the count and the set can never disagree (mirrors
// `blocked_count_for_project`'s own reasoning).
const RECOVERY_COUNT_SQL: &str = "SELECT COUNT(*) FROM (\
    SELECT task_id FROM worktrees WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT task_id FROM agent_runs \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL \
    UNION \
    SELECT ar.task_id FROM agent_runs ar \
    WHERE ar.project_id = ?1 \
    AND ar.id = ( \
        SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = ar.task_id \
        ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1 \
    ) \
    AND EXISTS ( \
        SELECT 1 FROM events e WHERE e.stream_id = ar.id AND e.event_type = 'drift.detected' \
    )\
    )";

/// Every distinct task id in `project_id` with an outstanding recovery item (D-46) — feeds the
/// board's Needs Decision pill. A project with no recovery items returns an empty vector, never
/// an error.
pub fn recovery_task_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(RECOVERY_TASK_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list recovery task ids for project")
}

/// The count of distinct tasks in `project_id` with an outstanding recovery item (D-46) — feeds
/// the project-rail's second badge. Returns `0`, not an error, for a project with no recovery
/// items at all. Always equal to `recovery_task_ids_for_project(..).len()` — computed over the
/// identical union, never summed from the two tables independently.
pub fn recovery_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(RECOVERY_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count recovery tasks for project")?;
    Ok(count)
}
