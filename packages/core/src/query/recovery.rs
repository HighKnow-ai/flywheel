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
    WHERE project_id = ?1 AND kind = 'story' AND status = 'abandoned' AND acknowledged_at IS NULL \
    ORDER BY story_id ASC";

const RECOVERY_COUNT_SQL: &str = "SELECT COUNT(*) FROM (\
    SELECT story_id FROM worktrees WHERE project_id = ?1 AND status = 'missing' \
    UNION \
    SELECT story_id FROM sessions \
    WHERE project_id = ?1 AND kind = 'story' AND status = 'abandoned' AND acknowledged_at IS NULL)";

/// Every distinct Story id in `project_id` with an outstanding recovery item (D-46).
pub fn recovery_story_ids_for_project(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(RECOVERY_STORY_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list recovery Story ids for project")
}

/// One Story whose worktree is missing (D-45): the reconciler found nothing on disk where the
/// database expected it. Needs you lists it as a Stopped-kind item whose action is Recreate (issue
/// #156). A Merged or Dropped Story has no worktree to recreate, so it is left out.
#[derive(Debug, Clone, PartialEq)]
pub struct MissingWorktree {
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    /// When the Story's last session ended, or when the worktree was made: the item's age.
    pub since: String,
}

const MISSING_WORKTREES_SQL: &str = "SELECT w.story_id, s.key, s.title, \
        COALESCE((SELECT MAX(r.ended_at) FROM sessions r WHERE r.story_id = w.story_id), w.created_at) \
    FROM worktrees w JOIN stories s ON s.id = w.story_id \
    WHERE w.project_id = ?1 AND w.status = 'missing' AND s.state NOT IN ('merged', 'dropped') \
    ORDER BY w.story_id ASC";

/// Every open Story in `project_id` whose worktree is missing, by Story id.
pub fn missing_worktrees_for_project(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<MissingWorktree>> {
    let mut stmt = conn.prepare(MISSING_WORKTREES_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(MissingWorktree {
                story_id: row.get(0)?,
                story_key: row.get(1)?,
                story_title: row.get(2)?,
                since: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list the missing worktrees for project")
}

/// The count of distinct Stories in `project_id` with an outstanding recovery item (D-46). Always
/// equal to `recovery_story_ids_for_project(..).len()`.
pub fn recovery_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(RECOVERY_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count recovery Stories for project")?;
    Ok(count)
}
