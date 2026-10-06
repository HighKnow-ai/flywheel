//! The in-app merge of a task branch into its epic's integration branch (Phase 8 plan 08-03,
//! REVW-04, D-143/D-144/D-145).
//!
//! What this module does NOT do. It caches no verdict. It writes no status column: landing work in
//! an integration branch is not shipping, and a status has exactly one owner per transition. And it
//! never creates an integration branch — a merge into an epic with none cut is a refusal, not a
//! trigger (resolving a merge must not have the side effect of cutting a branch).
//!
//! Four separable halves, inheriting the forge module's rule that the git-running half takes plain
//! values rather than a connection. The connection-free signature, not a comment, is what keeps a
//! caller from holding the database lock across a subprocess:
//! - [`plan_merge_inputs`] and [`record_merge_event`] are the only halves that take a connection,
//!   and neither spawns git. The first reads the board into an opaque [`MergePlanInputs`]; the
//!   second writes the one event.
//! - [`finish_plan`] and [`run_merge`] take plain values and are the only halves that spawn git.
//!   `finish_plan` counts the commits and files; `run_merge` does the merge.
//! - [`merge_commit_is_reachable`] is the git half of the integrated marker. [`is_integrated`]
//!   composes it with a board read ([`integrated_merge_commit`]) and is for core-internal and test
//!   use only.
//! - [`plan_merge`] composes `plan_merge_inputs` and `finish_plan` for core-internal and test use. A
//!   command handler must call the two halves itself, with the lock released between them.
//!
//! The merge runs in a worktree that belongs to the EPIC (derived path, no table row), never in the
//! task's own worktree, so an agent working there cannot collide with it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use anyhow::{bail, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::domain::event::next_sequence;
use crate::git::{self, MergePrecheck};

/// Event type written when a task branch landed in its epic's integration branch.
pub const EVENT_TASK_INTEGRATED: &str = "task.integrated";
/// Event type written when a merge attempt was found conflicting and nothing landed.
pub const EVENT_MERGE_ABORTED: &str = "task.merge_aborted";

/// Everything a merge needs, resolved from the board. Plain values only.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MergePlan {
    pub repo_path: PathBuf,
    pub project_id: String,
    pub epic_id: String,
    pub epic_key: String,
    pub task_id: String,
    pub task_key: String,
    pub task_title: String,
    pub source_branch: String,
    pub target_branch: String,
    pub epic_worktree: PathBuf,
    pub commit_count: u32,
    pub file_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum MergeOutcome {
    Merged { merge_commit: String },
    AlreadyIntegrated,
    Conflicted { files: Vec<String> },
}

/// Why a merge cannot be planned. A typed error (rather than a bare sentence) so the command layer
/// can hand the renderer a named category without parsing prose; `Display` keeps the sentences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeRefusal {
    /// No worktree row, so no branch to merge.
    NoBranch { task_key: String },
    /// An epic-less task: an in-app merge lands in an epic integration branch.
    NoEpic { task_key: String },
    /// The epic has no integration branch cut yet.
    NoIntegrationBranch { epic_key: String },
    /// Zero commits ahead of the integration branch (already integrated, or no work yet).
    NothingToMerge { task_key: String, target_branch: String },
}

impl MergeRefusal {
    /// The stable category the renderer switches on.
    pub fn category(&self) -> &'static str {
        match self {
            Self::NoBranch { .. } => "noBranch",
            Self::NoEpic { .. } => "noEpic",
            Self::NoIntegrationBranch { .. } => "noIntegrationBranch",
            Self::NothingToMerge { .. } => "nothingToMerge",
        }
    }
}

impl std::fmt::Display for MergeRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoBranch { task_key } => write!(
                f,
                "{task_key} has no branch to merge: no worktree has been created for it"
            ),
            Self::NoEpic { task_key } => write!(
                f,
                "{task_key} has no epic, so it cannot be merged in-app: an in-app merge lands in an \
                 epic integration branch. Use the task-level open-request path instead."
            ),
            Self::NoIntegrationBranch { epic_key } => write!(
                f,
                "epic {epic_key} has no integration branch yet: there is nothing to merge into"
            ),
            Self::NothingToMerge { task_key, target_branch } => write!(
                f,
                "{task_key} has no commits ahead of {target_branch}: there is nothing to merge \
                 (already integrated, or no work yet)"
            ),
        }
    }
}

impl std::error::Error for MergeRefusal {}

/// What the board said about a merge, before any git runs. Private fields: it is an opaque
/// hand-off from [`plan_merge_inputs`] to [`finish_plan`], so a caller cannot substitute a branch or
/// a path between the two halves, and the git half re-reads nothing.
#[derive(Debug, Clone)]
pub struct MergePlanInputs {
    repo_path: PathBuf,
    project_id: String,
    epic_id: String,
    epic_key: String,
    task_id: String,
    task_key: String,
    task_title: String,
    source_branch: String,
    target_branch: String,
    epic_worktree: PathBuf,
}

/// The database half of [`plan_merge`]: resolve the task, its branch, its epic's integration branch
/// and the epic worktree path, or refuse by name (a [`MergeRefusal`] inside the returned error).
/// Reads the board only and spawns no git, so it is safe under the database lock.
pub fn plan_merge_inputs(conn: &Connection, task_id: &str) -> anyhow::Result<MergePlanInputs> {
    let (project_id, task_key, task_title, epic_id): (String, String, String, Option<String>) = conn
        .query_row(
            "SELECT project_id, key, title, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let source_branch: Option<String> = conn
        .query_row("SELECT branch FROM worktrees WHERE task_id = ?1", params![task_id], |row| {
            row.get(0)
        })
        .optional()
        .context("failed to look up the worktree for this task")?;
    let Some(source_branch) = source_branch else {
        return Err(MergeRefusal::NoBranch { task_key }.into());
    };

    let Some(epic_id) = epic_id else {
        return Err(MergeRefusal::NoEpic { task_key }.into());
    };
    let (epic_key, integration): (String, Option<String>) = conn
        .query_row(
            "SELECT key, integration_branch FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;
    let Some(target_branch) = integration else {
        return Err(MergeRefusal::NoIntegrationBranch { epic_key }.into());
    };

    let (repo_path, key_prefix): (String, String) = conn
        .query_row(
            "SELECT repo_path, key_prefix FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;
    let repo_path = PathBuf::from(repo_path);

    // Epic and task keys share the project's key counter, so this path cannot collide with a
    // task's worktree.
    let epic_worktree = crate::domain::worktree::worktree_root().join(&key_prefix).join(&epic_key);

    Ok(MergePlanInputs {
        repo_path,
        project_id,
        epic_id,
        epic_key,
        task_id: task_id.to_string(),
        task_key,
        task_title,
        source_branch,
        target_branch,
        epic_worktree,
    })
}

/// The git half of [`plan_merge`]: count the commits and files the merge would land, or refuse with
/// [`MergeRefusal::NothingToMerge`] when there are none. Takes no connection, so a caller can read
/// the inputs under the database lock, release it, then call this. Nothing is written.
pub fn finish_plan(inputs: MergePlanInputs) -> anyhow::Result<MergePlan> {
    let MergePlanInputs {
        repo_path,
        project_id,
        epic_id,
        epic_key,
        task_id,
        task_key,
        task_title,
        source_branch,
        target_branch,
        epic_worktree,
    } = inputs;

    let range = format!("{target_branch}..{source_branch}");
    let count = git::git_at(&repo_path, &["rev-list", "--count", &range])?;
    let commit_count: u32 = String::from_utf8_lossy(&count.stdout).trim().parse().unwrap_or(0);
    if commit_count == 0 {
        return Err(MergeRefusal::NothingToMerge { task_key, target_branch }.into());
    }
    let file_count = git::review_files(&repo_path, &target_branch, &source_branch)?.len() as u32;

    Ok(MergePlan {
        repo_path,
        project_id,
        epic_id,
        epic_key,
        task_id,
        task_key,
        task_title,
        source_branch,
        target_branch,
        epic_worktree,
        commit_count,
        file_count,
    })
}

/// [`plan_merge_inputs`] then [`finish_plan`]. For core-internal and test use: it takes a
/// connection AND spawns git, so it must not be called from a command handler while the database
/// lock is held. The two halves exist for that.
pub fn plan_merge(conn: &Connection, task_id: &str) -> anyhow::Result<MergePlan> {
    finish_plan(plan_merge_inputs(conn, task_id)?)
}

/// Make sure the epic's integration worktree exists and has the integration branch checked out.
/// An existing directory is reused (after checking it really is that worktree); otherwise it is
/// created through [`git::worktree_add_existing`], whose refusals already bound the path.
pub fn ensure_epic_worktree(repo_path: &Path, worktree_path: &Path, branch: &str) -> anyhow::Result<()> {
    if worktree_path.exists() {
        if !worktree_path.join(".git").exists() {
            bail!("{worktree_path:?} exists but is not a git worktree; refusing to merge into it");
        }
        let head = git::git_at(worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let head = String::from_utf8_lossy(&head.stdout).trim().to_string();
        if head != branch {
            bail!("integration worktree {worktree_path:?} is on {head:?}, not {branch:?}; refusing to merge into it");
        }
        return Ok(());
    }
    git::worktree_add_existing(repo_path, worktree_path, branch)?;
    Ok(())
}

/// Run the merge. Takes no connection. The order matters:
///
/// 1. The dry run. A conflict returns [`MergeOutcome::Conflicted`] before the integration worktree
///    is created or touched, so there is nothing to abort. It is deliberately re-run here rather
///    than trusted from the confirm sheet, so correctness never depends on a read the user saw
///    earlier; it is also the side-effect-free read the sheet calls on open.
/// 2. The epic worktree is ensured.
/// 3. A merge left in progress by a crash is aborted; a worktree dirty for any other reason is
///    refused — a merge into a dirty tree can fail midway or mix files.
/// 4. The real `--no-ff` merge.
pub fn run_merge(plan: &MergePlan) -> anyhow::Result<MergeOutcome> {
    if let MergePrecheck::Conflicts(files) =
        git::merge_tree_check(&plan.repo_path, &plan.target_branch, &plan.source_branch)?
    {
        return Ok(MergeOutcome::Conflicted { files });
    }

    ensure_epic_worktree(&plan.repo_path, &plan.epic_worktree, &plan.target_branch)?;

    let wt = &plan.epic_worktree;
    if git::rev_parse_verify(wt, "MERGE_HEAD")? {
        git::merge_abort_if_in_progress(wt)?;
    }
    let dirty = crate::domain::worktree::porcelain_entries(wt)?;
    if let Some(first) = dirty.first() {
        bail!(
            "refusing to merge: integration worktree {wt:?} has {} uncommitted entries (first: {:?})",
            dirty.len(),
            first.path
        );
    }

    let title = plan.task_title.replace(['\n', '\r'], " ");
    let message = format!("Merge {} {} into {}", plan.task_key, title, plan.target_branch);
    if !git::merge_no_ff(wt, &plan.source_branch, &message)? {
        return Ok(MergeOutcome::AlreadyIntegrated);
    }
    let head = git::git_at(wt, &["rev-parse", "HEAD"])?;
    Ok(MergeOutcome::Merged { merge_commit: String::from_utf8_lossy(&head.stdout).trim().to_string() })
}

/// Record one event for the outcome, in one transaction. A merge writes no status column —
/// anywhere. An already-integrated outcome writes nothing.
pub fn record_merge_event(
    conn: &mut Connection,
    plan: &MergePlan,
    outcome: &MergeOutcome,
    actor_id: &str,
) -> anyhow::Result<()> {
    let (event_type, payload) = match outcome {
        MergeOutcome::AlreadyIntegrated => return Ok(()),
        MergeOutcome::Merged { merge_commit } => (
            EVENT_TASK_INTEGRATED,
            serde_json::json!({
                "label": format!("Merged into {}", plan.target_branch),
                "merge_commit": merge_commit,
                "source_branch": plan.source_branch,
                "target_branch": plan.target_branch,
                "commit_count": plan.commit_count,
                "file_count": plan.file_count,
            }),
        ),
        MergeOutcome::Conflicted { files } => (
            EVENT_MERGE_ABORTED,
            serde_json::json!({
                "label": format!("Merge into {} aborted: {} conflicting file(s)", plan.target_branch, files.len()),
                "source_branch": plan.source_branch,
                "target_branch": plan.target_branch,
                "conflicted_files": files,
            }),
        ),
    };

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let sequence = next_sequence(&tx, &plan.project_id, "local")?;
    crate::domain::event::append_event(
        &tx,
        &plan.project_id,
        "local",
        sequence,
        "task",
        &plan.task_id,
        Some(&plan.task_id),
        Some(&plan.epic_id),
        actor_id,
        event_type,
        &payload,
        &now,
    )?;
    tx.commit().context("failed to commit record_merge_event transaction")?;
    Ok(())
}

static EPICS_MERGING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// Holds the right to merge into one epic; releases it on drop.
#[derive(Debug)]
pub struct EpicMergeGuard {
    epic_id: String,
}

impl Drop for EpicMergeGuard {
    fn drop(&mut self) {
        let set = EPICS_MERGING.get_or_init(Default::default);
        set.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.epic_id);
    }
}

/// Try to take the per-epic merge lock; `None` means a merge into that epic is already running.
///
/// Why it exists: the retry module's spawn floor only spaces spawn starts 400 ms apart and provides
/// no mutual exclusion, so two merges into one integration worktree would contend on the index lock
/// or land inside each other's in-progress state. Ceiling: the set is process-global, which is
/// correct while one process owns the fleet and would be shared by a second application state in
/// the same process.
pub fn try_lock_epic(epic_id: &str) -> Option<EpicMergeGuard> {
    let set = EPICS_MERGING.get_or_init(Default::default);
    let mut held = set.lock().unwrap_or_else(|p| p.into_inner());
    held.insert(epic_id.to_string()).then(|| EpicMergeGuard { epic_id: epic_id.to_string() })
}

/// The merge commit recorded by the task's most recent integrated event, if any. A read only.
pub fn integrated_merge_commit(conn: &Connection, task_id: &str) -> anyhow::Result<Option<String>> {
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM events WHERE task_id = ?1 AND event_type = ?2
             ORDER BY sequence DESC LIMIT 1",
            params![task_id, EVENT_TASK_INTEGRATED],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the task's integrated event")?;
    let Some(payload) = payload else { return Ok(None) };
    let value: serde_json::Value =
        serde_json::from_str(&payload).context("integrated event payload is not JSON")?;
    Ok(value["merge_commit"].as_str().map(str::to_string))
}

/// Is the task integrated into `integration_branch`? Derived from the recorded event PLUS a live
/// ancestry check, never from ancestry alone, and never writes anything.
///
/// The trap this shape avoids: a task branch with zero commits of its own is an ancestor of the
/// branch it was cut from the moment it is cut, so an ancestry-only test lights the marker on
/// brand-new tasks. And after a successful merge the three-dot range between the integration
/// branch and the task branch is empty (the task tip became the merge base), so a surface reading
/// only that range would claim "no changes" for work it had just landed. The recorded merge commit
/// answers both, which is why the event carries it. Plan 08-07 reads this marker and, for an
/// integrated task, diffs the merge commit against its first parent to show what landed.
///
/// A merge commit that no longer resolves (history rewritten) is `false`, not an error.
pub fn is_integrated(
    conn: &Connection,
    repo_path: &Path,
    task_id: &str,
    integration_branch: &str,
) -> anyhow::Result<bool> {
    let Some(merge_commit) = integrated_merge_commit(conn, task_id)? else {
        return Ok(false);
    };
    merge_commit_is_reachable(repo_path, &merge_commit, integration_branch)
}

/// The git half of the integrated marker: does `merge_commit` still resolve, and is it an ancestor
/// of `integration_branch`? Takes no connection, so a caller can read the recorded commit under the
/// database lock, release it, then ask this. An unresolvable commit is `false`, not an error.
pub fn merge_commit_is_reachable(
    repo_path: &Path,
    merge_commit: &str,
    integration_branch: &str,
) -> anyhow::Result<bool> {
    if !git::rev_parse_verify(repo_path, &format!("{merge_commit}^{{commit}}"))? {
        return Ok(false);
    }
    let out = git::git_output_at(
        repo_path,
        &["merge-base", "--is-ancestor", merge_commit, integration_branch],
    )?;
    Ok(out.status.success())
}
