//! LINK-02/LINK-09's command surface (Phase 7 plan 07-01): `git_facts` is a read-only projection
//! of `flywheel_core::git_facts::GitFacts`, and `git_truth_focus_task` writes exactly one
//! in-memory field (`AppState.focused_task`, D-114's "open detail panel" half) and can never reach
//! the database or the filesystem.

use serde::Serialize;
use tauri::State;

use crate::commands::agent_run::PorcelainEntryDto;
use crate::state::AppState;

/// One row of a task's commit window, projected for the renderer — mirrors
/// `flywheel_core::git_facts::CommitRow` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRowDto {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub committed_at: String,
}

impl From<flywheel_core::git_facts::CommitRow> for CommitRowDto {
    fn from(row: flywheel_core::git_facts::CommitRow) -> Self {
        Self {
            sha: row.sha,
            short_sha: row.short_sha,
            subject: row.subject,
            committed_at: row.committed_at,
        }
    }
}

/// A task's full git truth, projected for the renderer — mirrors
/// `flywheel_core::git_facts::GitFacts` field-for-field, following `WorktreeSummaryDto`'s own
/// "`None`/`null` for a task with no worktree yet, never a row of empty strings" discipline (the
/// command below returns `Option<GitFactsDto>`, not this type alone).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFactsDto {
    pub branch: String,
    pub worktree_path: String,
    pub target_ref: String,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_fetch_at: Option<String>,
    pub commits: Vec<CommitRowDto>,
    pub commits_truncated: usize,
    pub uncommitted: Vec<PorcelainEntryDto>,
}

impl From<flywheel_core::git_facts::GitFacts> for GitFactsDto {
    fn from(facts: flywheel_core::git_facts::GitFacts) -> Self {
        Self {
            branch: facts.branch,
            worktree_path: facts.worktree_path,
            target_ref: facts.target_ref,
            ahead: facts.ahead,
            behind: facts.behind,
            last_fetch_at: facts.last_fetch_at,
            commits: facts.commits.into_iter().map(CommitRowDto::from).collect(),
            commits_truncated: facts.commits_truncated,
            uncommitted: facts.uncommitted.into_iter().map(PorcelainEntryDto::from).collect(),
        }
    }
}

/// `task_id`'s full git truth (LINK-02, LINK-09), or `null` when the task has no worktree yet.
/// Read-only — delegates straight to `flywheel_core::git_facts::git_facts_for_task`.
#[tauri::command]
pub fn git_facts(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<GitFactsDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let facts =
        flywheel_core::git_facts::git_facts_for_task(&conn, &task_id).map_err(|e| e.to_string())?;
    Ok(facts.map(GitFactsDto::from))
}

/// Declares which task's item detail panel is currently open (D-114's hot-tier "open panel"
/// half) — writes `AppState.focused_task` and nothing else. `None` means no panel is open.
#[tauri::command]
pub fn git_truth_focus_task(state: State<AppState>, task_id: Option<String>) -> Result<(), String> {
    let mut focused = state.focused_task.lock().map_err(|e| e.to_string())?;
    *focused = task_id;
    Ok(())
}
