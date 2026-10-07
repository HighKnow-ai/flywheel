//! The board's one-sweep "which task has real changes behind it" read (Phase 8.1, D-15/D-16):
//! per active worktree, how many commits its branch is ahead of its base, and whether its working
//! tree is dirty.
//!
//! Stores nothing and caches no verdict — every figure is re-derived from the board and git on
//! each call, the same stateless discipline as [`crate::review`]. Unlike `query::forge`, this read
//! reaches git, so it copies `review.rs`'s lock-safe split instead: [`change_flag_inputs`] is the
//! board half (a `&Connection`, no process spawned, safe under the database lock) and
//! [`finish_change_flags`] is the git half (no connection, run once the lock is released).
//!
//! The base ref is the epic's LOCAL integration branch, falling back to the project's default
//! branch — never a remote-tracking ref: integration branches are cut locally and mostly never
//! pushed, so `origin/<branch>` does not resolve (RESEARCH Correction 4). When a base still does
//! not resolve, `ahead` is `None` ("cannot measure"), which is a different statement from
//! `Some(0)` ("level") and must never be flattened into it.
//!
//! Every git read routes through `crate::git` (the workspace's only process-spawning site).

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection};

/// What the git half needs per worktree — resolved from the board, so no path, ref or sha ever
/// has to cross IPC.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangeFlagInput {
    pub task_id: String,
    pub path: String,
    pub branch: String,
    pub base: Option<String>,
}

/// One task's change state. `ahead: None` is cannot-measure, `Some(0)` is level.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangeFlag {
    pub task_id: String,
    pub ahead: Option<u32>,
    pub dirty: bool,
}

/// The board half: every active worktree of `project_id` with its resolved base, capped at
/// `limit`. Takes only a `&Connection` and spawns no process, so it is safe under the database
/// lock; hand the result to [`finish_change_flags`] once the lock is released.
pub fn change_flag_inputs(
    conn: &Connection,
    project_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<ChangeFlagInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT w.task_id, w.path, w.branch, e.integration_branch, p.default_branch
             FROM worktrees w
             JOIN tasks t ON t.id = w.task_id
             JOIN projects p ON p.id = w.project_id
             LEFT JOIN epics e ON e.id = t.epic_id
             WHERE w.project_id = ?1 AND w.status = 'active'
             ORDER BY w.id ASC
             LIMIT ?2",
        )
        .context("failed to prepare the change-flag inputs query")?;
    let rows = stmt
        .query_map(params![project_id, limit as i64], |row| {
            let integration: Option<String> = row.get(3)?;
            let default_branch: String = row.get(4)?;
            Ok(ChangeFlagInput {
                task_id: row.get(0)?,
                path: row.get(1)?,
                branch: row.get(2)?,
                base: Some(integration.unwrap_or(default_branch)),
            })
        })
        .context("failed to query change-flag inputs")?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read change-flag inputs")
}

/// The git half: takes no connection. A worktree whose directory has vanished since the board
/// read is skipped (a race with removal, not an error — it gets no annotation).
pub fn finish_change_flags(inputs: Vec<ChangeFlagInput>) -> anyhow::Result<Vec<ChangeFlag>> {
    let mut flags = Vec::with_capacity(inputs.len());
    for input in inputs {
        let path = Path::new(&input.path);
        if !path.is_dir() {
            continue;
        }
        let ahead = match &input.base {
            Some(base) => crate::git::ahead_behind(path, base, &input.branch)?
                .map(|(ahead, _behind)| ahead),
            None => None,
        };
        let dirty = !crate::domain::worktree::porcelain_entries(path)?.is_empty();
        flags.push(ChangeFlag { task_id: input.task_id, ahead, dirty });
    }
    Ok(flags)
}
