//! Worktree create-or-reuse (WORK-01, WORK-08, D-30): `ensure_worktree` is the ONE call site that
//! resolves whether a task's worktree already exists, and if not, creates it. Never rely on git's
//! own error to detect a duplicate (RESEARCH.md Pitfall 2) — this module always checks the
//! `worktrees` table first.
//!
//! `worktrees.task_id` carries a UNIQUE constraint (migration `0003_agent_runtime.sql`) — the
//! promoted-primary-noun decision (plan 02-01's `<assumption_delta_decision>`): a worktree is
//! created once per task and reused by every subsequent run.

use std::path::PathBuf;

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::branch::task_branch_name;
use crate::domain::event::{append_event, next_sequence};
use crate::git;
use crate::ids::new_id;

/// A worktree row, as read back after [`ensure_worktree`] resolves it (either freshly created or
/// reused unchanged).
#[derive(Debug, Clone, PartialEq)]
pub struct Worktree {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub path: String,
    pub branch: String,
    pub base_branch: String,
    pub status: String,
}

fn row_to_worktree(row: &rusqlite::Row) -> rusqlite::Result<Worktree> {
    Ok(Worktree {
        id: row.get(0)?,
        task_id: row.get(1)?,
        project_id: row.get(2)?,
        path: row.get(3)?,
        branch: row.get(4)?,
        base_branch: row.get(5)?,
        status: row.get(6)?,
    })
}

const WORKTREE_SELECT_SQL: &str =
    "SELECT id, task_id, project_id, path, branch, base_branch, status FROM worktrees WHERE task_id = ?1";

/// The existing worktree row for `task_id`, if one has ever been created — the existence check
/// `ensure_worktree` performs BEFORE opening a transaction or touching git (RESEARCH.md Pitfall 2).
pub fn worktree_for_task(conn: &Connection, task_id: &str) -> anyhow::Result<Option<Worktree>> {
    conn.query_row(WORKTREE_SELECT_SQL, params![task_id], row_to_worktree)
        .optional()
        .context("failed to look up the worktree for this task")
}

/// The Flywheel-managed worktree root (D-23): `~/Flywheel/`, unless `FLYWHEEL_WORKTREE_ROOT` is
/// set — a deliberate test-only seam, never a user setting (rigidity is the feature).
pub fn worktree_root() -> PathBuf {
    git::worktree_root_from_env()
}

/// Create-or-reuse a task's worktree (D-30). Performs the existence SELECT before opening any
/// transaction; when a row already exists, returns it untouched and issues no second
/// `git worktree add`. Otherwise: derives the branch name (`branch::task_branch_name`), resolves
/// the base ref as the project's `default_branch` (plan 02-01 Task 2 replaces this with
/// `base_ref_for_task`'s two-shape resolution), computes the worktree path as
/// `worktree_root()/{project.key_prefix}/{task.key}/`, calls `git::worktree_add`, then opens one
/// transaction that inserts the `worktrees` row and appends a `worktree.created` event.
pub fn ensure_worktree(conn: &mut Connection, task_id: &str, actor_id: &str) -> anyhow::Result<Worktree> {
    if let Some(existing) = worktree_for_task(conn, task_id)? {
        return Ok(existing);
    }

    let (project_id, task_key, task_title): (String, String, String) = conn
        .query_row(
            "SELECT project_id, key, title FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let (repo_path, default_branch, key_prefix): (String, String, String) = conn
        .query_row(
            "SELECT repo_path, default_branch, key_prefix FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let branch = task_branch_name(&task_key, &task_title);
    let base_branch = default_branch;

    let worktree_path = worktree_root().join(&key_prefix).join(&task_key);

    if worktree_path.exists() {
        anyhow::bail!(
            "worktree_add refused: {worktree_path:?} already exists on disk but no worktrees \
             row claims it"
        );
    }

    git::worktree_add(
        std::path::Path::new(&repo_path),
        &worktree_path,
        &branch,
        &base_branch,
    )
    .with_context(|| format!("failed to create worktree for task {task_id:?}"))?;

    let id = new_id();
    let now = Utc::now().to_rfc3339();
    let worktree_path_str = worktree_path.to_string_lossy().into_owned();

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO worktrees (
            id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8)",
        params![id, task_id, project_id, worktree_path_str, branch, base_branch, actor_id, now],
    )
    .context("failed to insert worktree row")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "worktree",
        "before": null,
        "after": branch,
        "label": format!("Created worktree {branch}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "worktree",
        &id,
        Some(task_id),
        None,
        actor_id,
        "worktree.created",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit ensure_worktree transaction")?;

    Ok(Worktree {
        id,
        task_id: task_id.to_string(),
        project_id,
        path: worktree_path_str,
        branch,
        base_branch,
        status: "active".to_string(),
    })
}
