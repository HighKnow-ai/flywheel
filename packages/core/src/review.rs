//! Review scope resolution (Phase 8, REVW-01/REVW-02): a task id or epic id in, the repository
//! path plus the base and head refs of the diff to show out.
//!
//! This module stores nothing and caches no verdict: every ref is re-derived from the board on
//! every call, and nothing here mutates git or the board. In particular it never calls the epic
//! module's integration-branch-cutting helper — resolving a scope for reading must not have the
//! side effect of creating a branch (a NULL `epics.integration_branch` is a typed outcome, not a
//! trigger to cut one).
//!
//! Refs are LOCAL branch names with no remote prefix: the integration branch is cut locally and
//! never pushed, so `origin/<integration>` (what `git_facts` uses as a target) does not resolve.
//! Diffs run against the project `repo_path`, not a worktree, so review survives worktree removal.
//!
//! Every git read routes through `crate::git`; this module is sync throughout.

use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::git;

/// Which kind of board item a review is over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewScope {
    Task,
    Epic,
}

/// What a scope resolved to.
#[derive(Debug, Clone, PartialEq)]
pub enum ReviewTarget {
    Resolved {
        repo_path: PathBuf,
        base: String,
        head: String,
        project_id: String,
        epic_id: Option<String>,
        task_id: Option<String>,
    },
    /// The epic (or the task's epic) has no integration branch yet — nothing to review.
    NoIntegrationBranch,
    /// The task has no worktree row, so no branch to review.
    NoBranch,
}

/// Resolve `item_id` under `scope` to a repo path and a base/head ref pair.
pub fn resolve_review_target(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<ReviewTarget> {
    match scope {
        ReviewScope::Task => {
            let branch: Option<String> = conn
                .query_row(
                    "SELECT branch FROM worktrees WHERE task_id = ?1",
                    params![item_id],
                    |row| row.get(0),
                )
                .optional()
                .context("failed to look up the worktree for this task")?;
            let Some(head) = branch else {
                return Ok(ReviewTarget::NoBranch);
            };

            let (project_id, epic_id): (String, Option<String>) = conn
                .query_row(
                    "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
                    params![item_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .with_context(|| format!("task {item_id:?} not found"))?;
            let (repo_path, default_branch) = project_repo(conn, &project_id)?;

            let base = match &epic_id {
                Some(epic_id) => {
                    let integration: Option<String> = conn
                        .query_row(
                            "SELECT integration_branch FROM epics WHERE id = ?1",
                            params![epic_id],
                            |row| row.get(0),
                        )
                        .with_context(|| format!("epic {epic_id:?} not found"))?;
                    match integration {
                        Some(b) => b,
                        None => return Ok(ReviewTarget::NoIntegrationBranch),
                    }
                }
                None => default_branch,
            };
            Ok(ReviewTarget::Resolved {
                repo_path,
                base,
                head,
                project_id,
                epic_id,
                task_id: Some(item_id.to_string()),
            })
        }
        ReviewScope::Epic => {
            let (project_id, integration): (String, Option<String>) = conn
                .query_row(
                    "SELECT project_id, integration_branch FROM epics WHERE id = ?1",
                    params![item_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .with_context(|| format!("epic {item_id:?} not found"))?;
            let Some(head) = integration else {
                return Ok(ReviewTarget::NoIntegrationBranch);
            };
            let (repo_path, base) = project_repo(conn, &project_id)?;
            Ok(ReviewTarget::Resolved {
                repo_path,
                base,
                head,
                project_id,
                epic_id: Some(item_id.to_string()),
                task_id: None,
            })
        }
    }
}

fn project_repo(conn: &Connection, project_id: &str) -> anyhow::Result<(PathBuf, String)> {
    let (repo_path, default_branch): (String, String) = conn
        .query_row(
            "SELECT repo_path, default_branch FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;
    Ok((PathBuf::from(repo_path), default_branch))
}

/// The changed files of an already-resolved target (empty unless it resolved). Takes no
/// connection, so a caller can resolve under the database lock, release it, then run git.
pub fn files_for_target(target: &ReviewTarget) -> anyhow::Result<Vec<git::ReviewFile>> {
    match target {
        ReviewTarget::Resolved { repo_path, base, head, .. } => {
            git::review_files(repo_path, base, head)
        }
        _ => Ok(Vec::new()),
    }
}

/// One file's patch text for an already-resolved target, or `None` when it did not resolve.
pub fn patch_for_target(
    target: &ReviewTarget,
    path: &str,
    old_path: Option<&str>,
) -> anyhow::Result<Option<String>> {
    match target {
        ReviewTarget::Resolved { repo_path, base, head, .. } => {
            Ok(Some(git::review_patch(repo_path, base, head, path, old_path)?))
        }
        _ => Ok(None),
    }
}

/// The scope's resolved target plus its changed-file list (empty unless the target resolved).
pub fn review_file_list(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<(ReviewTarget, Vec<git::ReviewFile>)> {
    let target = resolve_review_target(conn, scope, item_id)?;
    let files = files_for_target(&target)?;
    Ok((target, files))
}

/// One file's patch text, or `None` when the scope does not resolve to a branch.
pub fn review_file_patch(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
    path: &str,
    old_path: Option<&str>,
) -> anyhow::Result<Option<String>> {
    patch_for_target(&resolve_review_target(conn, scope, item_id)?, path, old_path)
}
