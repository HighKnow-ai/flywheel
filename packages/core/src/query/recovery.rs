//! Bounded, literal-SQL reads over `worktrees`/`sessions` for D-46's "recovery needed" signal:
//! `recovery_story_ids_for_project` and `recovery_count_for_project` (the project-rail count).
//!
//! "A recovery item is outstanding" means either of two independent facts about a Story:
//!   1. its `worktrees` row reads `status = 'missing'` (D-45 — the reconciler found nothing on
//!      disk where the database expected a worktree), or
//!   2. it has a session with `status = 'abandoned'` and `acknowledged_at IS NULL` (D-49/D-50 —
//!      the launch reconciler recorded a session Flywheel could not supervise to a clean end, and
//!      nobody has told the app "I've seen it" yet). The abandoned session need not be the Story's
//!      most recent: a later clean session does not make an earlier abandonment seen.

use anyhow::Context;
use rusqlite::{params, Connection};

// `UNION` (not `UNION ALL`) makes a Story carrying both conditions appear exactly once, so the
// count below and the set never disagree (T-03-11-04).
const RECOVERY_STORY_IDS_SQL: &str = "SELECT story_id FROM worktrees \
    WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT story_id FROM sessions \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL \
    ORDER BY story_id ASC";

const RECOVERY_COUNT_SQL: &str = "SELECT COUNT(*) FROM (\
    SELECT story_id FROM worktrees WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT story_id FROM sessions \
    WHERE project_id = ?1 AND status = 'abandoned' AND acknowledged_at IS NULL)";

/// Every distinct Story id in `project_id` with an outstanding recovery item (D-46).
pub fn recovery_story_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(RECOVERY_STORY_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list recovery Story ids for project")
}

/// The count of distinct Stories in `project_id` with an outstanding recovery item (D-46). Always
/// equal to `recovery_story_ids_for_project(..).len()`.
pub fn recovery_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(RECOVERY_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count recovery Stories for project")?;
    Ok(count)
}
