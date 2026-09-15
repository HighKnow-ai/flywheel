//! Bounded, literal-SQL reads over `worktrees`/`agent_runs` for D-46's board-visible "recovery
//! needed" signal: `recovery_task_ids_for_project` (the board's Needs Decision pill) and
//! `recovery_count_for_project` (the project-rail count). Structurally mirrors
//! `query::permissions::blocked_task_ids_for_project`/`blocked_count_for_project` — the exact
//! pair this module's functions were written against, including their compile-time-literal SQL
//! and single-bound-parameter discipline (never `format!`, T-01-01/T-01-23).
//!
//! "A recovery item is outstanding" here means either of two independent facts about a task:
//!   1. its `worktrees` row reads `status = 'missing'` (D-45 — the reconciler found nothing on
//!      disk where the database expected a worktree), or
//!   2. it has an `agent_runs` row with `status = 'abandoned'` and `acknowledged_at IS NULL`
//!      (D-49/D-50 — the launch reconciler recorded a session Flywheel could not supervise to a
//!      clean end, and nobody has told the app "I've seen it" yet).
//!
//! Deliberately NOT required: that the abandoned run be the task's *most recent* run. A task
//! whose latest run completed cleanly but whose EARLIER run was abandoned and never acknowledged
//! still has something the user has not seen — D-46's item is about the user having *seen* the
//! fact, and a later clean run does not retroactively make an earlier abandonment seen. This is a
//! deliberate divergence from `blocked_task_ids_for_project`'s own "most recent run" definition,
//! which exists for a different reason (a task can only ever be blocked by its current run).

use anyhow::Context;
use rusqlite::{params, Connection};

// `UNION` (not `UNION ALL`) is what makes a task carrying BOTH conditions below appear exactly
// once — do not "optimise" this to `UNION ALL`. A task whose worktree is missing AND whose
// abandoned run is unacknowledged would otherwise contribute two rows, over-counting it in
// `recovery_count_for_project` and disagreeing with the single pill `recovery_task_ids_for_project`
// implies (T-03-11-04).
const RECOVERY_TASK_IDS_SQL: &str = "SELECT task_id FROM worktrees \
    WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT task_id FROM agent_runs \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL \
    ORDER BY task_id ASC";

// Counts over the SAME union `recovery_task_ids_for_project` reads, rather than summing counts
// from either table separately, so the count and the set can never disagree (mirrors
// `blocked_count_for_project`'s own reasoning).
const RECOVERY_COUNT_SQL: &str = "SELECT COUNT(*) FROM (\
    SELECT task_id FROM worktrees WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT task_id FROM agent_runs \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL\
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
