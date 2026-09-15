//! Worktree create-or-reuse (WORK-01, WORK-08, D-30): `ensure_worktree` is the ONE call site that
//! resolves whether a task's worktree already exists, and if not, creates it. Never rely on git's
//! own error to detect a duplicate (RESEARCH.md Pitfall 2) — this module always checks the
//! `worktrees` table first.
//!
//! `worktrees.task_id` carries a UNIQUE constraint (migration `0003_agent_runtime.sql`) — the
//! promoted-primary-noun decision (plan 02-01's `<assumption_delta_decision>`): a worktree is
//! created once per task and reused by every subsequent run.

use std::path::{Path, PathBuf};

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::branch::task_branch_name;
use crate::domain::epic::ensure_epic_integration_branch;
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

/// Every `worktrees` row currently `status = 'active'` — [`reconcile_worktrees`]'s own candidate
/// set. Only `active` rows are ever examined (a row already `stale`/`merged`/`abandoned` is left
/// alone), matching `<behavior>`'s "only active rows are candidates" rule.
const ACTIVE_WORKTREES_SELECT_SQL: &str =
    "SELECT id, task_id, project_id, path, branch, base_branch, status FROM worktrees WHERE status = 'active'";

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

/// Resolve the base ref a task's worktree should branch from (D-25, D-26, WORK-02). Exactly two
/// shapes, selected purely by `task.epic_id` — no configuration input, no caller-supplied
/// override, no planner or agent choice:
/// - `task.epic_id` is `Some` → `domain::epic::ensure_epic_integration_branch`'s resolved value
///   (lazily cutting the integration branch from the project's trunk tip on first use, D-25).
/// - `task.epic_id` is `None` → the project's own `default_branch` (D-26).
///
/// This is the ONE call site in this crate that resolves a base ref for worktree creation —
/// `ensure_worktree` calls this and nothing else.
pub fn base_ref_for_task(conn: &mut Connection, task_id: &str, actor_id: &str) -> anyhow::Result<String> {
    let (project_id, epic_id): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    match epic_id {
        Some(epic_id) => ensure_epic_integration_branch(conn, &epic_id, actor_id),
        None => {
            let default_branch: String = conn
                .query_row(
                    "SELECT default_branch FROM projects WHERE id = ?1",
                    params![project_id],
                    |row| row.get(0),
                )
                .with_context(|| format!("project {project_id:?} not found"))?;
            Ok(default_branch)
        }
    }
}

/// Create-or-reuse a task's worktree (D-30). Performs the existence SELECT before opening any
/// transaction; when a row already exists, returns it untouched and issues no second
/// `git worktree add`. Otherwise: derives the branch name (`branch::task_branch_name`), resolves
/// the base ref via [`base_ref_for_task`]'s two-shape resolution (D-25/D-26), computes the
/// worktree path as `worktree_root()/{project.key_prefix}/{task.key}/`, calls
/// `git::worktree_add`, then opens one transaction that inserts the `worktrees` row and appends a
/// `worktree.created` event.
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

    let (repo_path, key_prefix): (String, String) = conn
        .query_row(
            "SELECT repo_path, key_prefix FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let branch = task_branch_name(&task_key, &task_title);
    let base_branch = base_ref_for_task(conn, task_id, actor_id)?;

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

/// One line of `git status --porcelain` output, split into its two-character status code and the
/// path it describes. A line shorter than four characters (code + separating space + at least one
/// path byte) is kept rather than dropped — its raw text becomes `path` and its `code` reads
/// `"??"`, so a malformed/truncated porcelain line still surfaces as SOMETHING dirty rather than
/// silently vanishing from the count (D-42/D-43's "never silently drop a would-be-lost change").
#[derive(Debug, Clone, PartialEq)]
pub struct PorcelainEntry {
    pub code: String,
    pub path: String,
}

/// Parse `git status --porcelain`'s raw stdout for `worktree_path` into one [`PorcelainEntry`]
/// per line, preserving git's own ordering — no filtering, no sorting, no deduplication. This is
/// the sole caller of `git::git_status_porcelain` (WORK-03's one-porcelain-read-site contract);
/// every caller that needs a dirty-tree read (the desktop command's fresh-at-open-time check, and
/// [`remove_worktree_for_task`]'s own re-read) goes through this function.
pub fn porcelain_entries(worktree_path: &Path) -> anyhow::Result<Vec<PorcelainEntry>> {
    let raw = git::git_status_porcelain(worktree_path)?;
    Ok(raw
        .lines()
        .map(|line| {
            if line.len() < 4 {
                PorcelainEntry { code: "??".to_string(), path: line.to_string() }
            } else {
                PorcelainEntry { code: line[0..2].to_string(), path: line[3..].to_string() }
            }
        })
        .collect())
}

/// Remove a task's worktree (WORK-03, D-41/D-42/D-43). Bails when no `worktrees` row exists for
/// `task_id`. **Re-reads `git status --porcelain` itself** via [`porcelain_entries`] — never
/// trusts a caller-supplied dirty check — and bails naming the dirty count on ANY non-empty
/// result. This closes the check-then-act window between a renderer's earlier
/// `worktree_remove_check` read and this call: the renderer's check is advisory UI only, this
/// re-read is the actual guard, and there is no parameter anywhere in this call chain that could
/// skip it (D-43). Only on a verified-clean tree does it call `git::worktree_remove`, then in ONE
/// transaction deletes the `worktrees` row and appends a `worktree.removed` event shaped like
/// `ensure_worktree`'s own `worktree.created` payload (`reconcile_projects`'s
/// `field`/`before`/`after`/`label` idiom).
pub fn remove_worktree_for_task(
    conn: &mut Connection,
    task_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    let worktree = worktree_for_task(conn, task_id)?
        .ok_or_else(|| anyhow::anyhow!("no worktree exists for task {task_id:?}"))?;

    let repo_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![worktree.project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {:?} not found", worktree.project_id))?;

    let task_key: String = conn
        .query_row("SELECT key FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .with_context(|| format!("task {task_id:?} not found"))?;

    // Re-read porcelain HERE, never trusting the renderer's own earlier check (D-43's "no
    // check-then-act window" requirement) — a dirty tree refuses unconditionally.
    let entries = porcelain_entries(Path::new(&worktree.path))?;
    if !entries.is_empty() {
        anyhow::bail!(
            "worktree_remove refused: {} uncommitted change(s) in {:?}",
            entries.len(),
            worktree.path
        );
    }

    git::worktree_remove(Path::new(&repo_path), Path::new(&worktree.path))
        .with_context(|| format!("failed to remove worktree for task {task_id:?}"))?;

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM worktrees WHERE id = ?1", params![worktree.id])
        .context("failed to delete worktree row")?;

    let sequence = next_sequence(&tx, &worktree.project_id, "local")?;
    let payload = serde_json::json!({
        "field": "worktree",
        "before": worktree.branch,
        "after": null,
        "label": format!("Removed worktree for {task_key}"),
    });
    append_event(
        &tx,
        &worktree.project_id,
        "local",
        sequence,
        "worktree",
        &worktree.id,
        Some(task_id),
        None,
        actor_id,
        "worktree.removed",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit remove_worktree_for_task transaction")?;
    Ok(())
}

/// Launch-time worktree reconciliation (WORK-06, D-45) — structurally identical to
/// `domain::project::reconcile_projects`: detect a mismatch between the database and the
/// filesystem, surface it, never silently repair it.
///
/// Selects every `status = 'active'` row through [`ACTIVE_WORKTREES_SELECT_SQL`] (a
/// compile-time-literal constant, no `format!`), collecting them into a `Vec` before the loop so
/// no statement is held open across the per-row transactions below. For each row, presence is
/// `std::path::Path::new(&row.path).try_exists().unwrap_or(false)` — `try_exists` distinguishes
/// "absent" from "could not tell" (a permissions error on the parent directory, say), and
/// `.unwrap_or(false)` deliberately collapses "could not tell" into "missing", mirroring
/// `reconcile_projects`'s own `.unwrap_or(false)` so one unreadable row never aborts the pass for
/// every other row.
///
/// A row whose derived status equals its current status is skipped with no write and no event —
/// this is what makes a second run over an unchanged filesystem a true no-op, and what keeps a
/// worktree that went `missing` and then reappeared on disk at `missing`: reconciliation never
/// moves a row back to `active` on its own (that is the user's Recreate decision,
/// [`recreate_worktree_for_task`]). On a real change, one transaction updates `status` — and
/// nothing else; `path`/`branch`/`base_branch` are structurally out of reach of this function's
/// `UPDATE` statement — and appends one `worktree.missing` event whose payload carries a
/// human-renderable `label` (D-19) for the activity trail.
pub fn reconcile_worktrees(conn: &mut Connection, actor_id: &str) -> anyhow::Result<()> {
    let active_worktrees: Vec<Worktree> = {
        let mut stmt = conn
            .prepare(ACTIVE_WORKTREES_SELECT_SQL)
            .context("failed to prepare the active-worktrees reconciliation query")?;
        let rows = stmt
            .query_map([], row_to_worktree)
            .context("failed to query active worktrees for reconciliation")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("failed to read an active worktree row during reconciliation")?
    };

    let now = Utc::now().to_rfc3339();

    for worktree in active_worktrees {
        // Any read failure (a permissions error, a genuinely absent path) reads as "not present"
        // here — one bad row must never abort reconciliation for every other worktree.
        let present = Path::new(&worktree.path).try_exists().unwrap_or(false);
        let new_status = if present { "active" } else { "missing" };
        if new_status == worktree.status {
            // No change: no row write, no event — the no-op contract.
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute("UPDATE worktrees SET status = ?1 WHERE id = ?2", params![new_status, worktree.id])
            .context("failed to update worktree status during reconciliation")?;

        let sequence = next_sequence(&tx, &worktree.project_id, "local")?;
        let payload = serde_json::json!({
            "field": "status",
            "before": worktree.status,
            "after": new_status,
            "path": worktree.path,
            "label": "Worktree missing from disk",
        });
        append_event(
            &tx,
            &worktree.project_id,
            "local",
            sequence,
            "worktree",
            &worktree.id,
            Some(&worktree.task_id),
            None,
            actor_id,
            "worktree.missing",
            &payload,
            &now,
        )?;

        tx.commit().context("failed to commit reconcile_worktrees transaction")?;
    }

    Ok(())
}

