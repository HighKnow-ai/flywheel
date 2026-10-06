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

use std::path::{Path, PathBuf};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::acceptance_criterion::{row_to_anchor, row_to_criterion, AcceptanceCriterion, CriterionAnchor};
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

/// Whether the code a criterion was checked against has moved since (D-141). A reading, never a
/// verdict on the user's mark: nothing here unchecks anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorStaleness {
    /// No commit touched the anchored path since the recorded sha.
    Untouched,
    /// `commits` commits touched the anchored path since the recorded sha.
    Changed { commits: u32 },
    /// The path is gone at head, or was renamed away since the recorded sha.
    MovedOrChanged,
    /// The recorded sha (or the head ref) no longer resolves — never read as untouched.
    Unknown,
}

/// Derive an anchor's staleness from git. Derived on every read and stored nowhere (D-75).
///
/// Order matters. A renamed file has no later commits on its OLD path, so a count-only test would
/// report it untouched (research Pitfall 9); the existence and rename-source checks therefore run
/// before the commit count. An unresolvable sha is `Unknown`, checked first.
pub fn anchor_staleness(
    repo_path: &Path,
    head: &str,
    anchor_sha: &str,
    anchor_path: &str,
) -> anyhow::Result<AnchorStaleness> {
    // `^{commit}` forces an object lookup: a bare full-length hex sha verifies without existing.
    let sha_ok = git::rev_parse_verify(repo_path, &format!("{anchor_sha}^{{commit}}"))?;
    if !sha_ok || !git::rev_parse_verify(repo_path, &format!("{head}^{{commit}}"))? {
        return Ok(AnchorStaleness::Unknown);
    }

    let exists = git::git_output_at(repo_path, &["cat-file", "-e", &format!("{head}:{anchor_path}")])?;
    if !exists.status.success() {
        return Ok(AnchorStaleness::MovedOrChanged);
    }

    let range = format!("{anchor_sha}..{head}");
    let names = git::git_at(repo_path, &["diff", "-z", "--name-status", "-M", &range])?;
    let names = String::from_utf8_lossy(&names.stdout).into_owned();
    let mut fields = names.split('\0').filter(|f| !f.is_empty());
    while let Some(token) = fields.next() {
        if token.starts_with('R') || token.starts_with('C') {
            let old = fields.next();
            fields.next(); // the new path
            if token.starts_with('R') && old == Some(anchor_path) {
                return Ok(AnchorStaleness::MovedOrChanged);
            }
        } else {
            fields.next(); // the path
        }
    }

    let count = git::git_at(
        repo_path,
        &["--literal-pathspecs", "rev-list", "--count", &range, "--", anchor_path],
    )?;
    let commits: u32 = String::from_utf8_lossy(&count.stdout).trim().parse().unwrap_or(0);
    Ok(if commits > 0 { AnchorStaleness::Changed { commits } } else { AnchorStaleness::Untouched })
}

/// [`anchor_staleness`] for an anchor against an already-resolved target. `None` when the target
/// did not resolve (no branch to measure against) or git failed — the criteria stay readable.
pub fn staleness_for_target(target: &ReviewTarget, anchor: &CriterionAnchor) -> Option<AnchorStaleness> {
    match target {
        ReviewTarget::Resolved { repo_path, head, .. } => {
            anchor_staleness(repo_path, head, &anchor.sha, &anchor.path).ok()
        }
        _ => None,
    }
}

/// One current-revision criterion with its evidence and how that evidence has aged.
#[derive(Debug, Clone, PartialEq)]
pub struct CriterionReviewState {
    pub criterion: AcceptanceCriterion,
    pub anchor: Option<CriterionAnchor>,
    pub staleness: Option<AnchorStaleness>,
}

/// The database half of [`review_criteria_state`]: the item's current-revision criteria with their
/// anchors (absent = no evidence), and the resolved target. Takes the connection so a caller can
/// run this under the database lock, release it, then call [`with_staleness`] lock-free.
pub fn criteria_with_anchors(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<(ReviewTarget, Vec<(AcceptanceCriterion, Option<CriterionAnchor>)>)> {
    let target = resolve_review_target(conn, scope, item_id)?;
    let parent_type = match scope {
        ReviewScope::Task => "task",
        ReviewScope::Epic => "epic",
    };
    let mut stmt = conn.prepare(
        "SELECT ac.id, ac.parent_type, ac.parent_id, ac.statement, ac.verification_hint, ac.checked,
                ac.rank, ac.created_at, ac.updated_at, ac.revision, ac.revision_of, ac.superseded_at,
                a.criterion_id, a.path, a.side, a.line_start, a.line_end, a.sha, a.created_at
         FROM acceptance_criteria ac
         LEFT JOIN criterion_anchors a ON a.criterion_id = ac.id
         WHERE ac.parent_type = ?1 AND ac.parent_id = ?2 AND ac.superseded_at IS NULL
         ORDER BY ac.rank ASC, ac.id ASC",
    )?;
    let rows = stmt
        .query_map(params![parent_type, item_id], |row| {
            let criterion = row_to_criterion(row)?;
            let anchor = match row.get::<_, Option<String>>(12)? {
                Some(_) => Some(row_to_anchor(row, 12)?),
                None => None,
            };
            Ok((criterion, anchor))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read criteria with their anchors")?;
    Ok((target, rows))
}

/// The git half of [`review_criteria_state`]: derive each anchor's staleness against `target`.
pub fn with_staleness(
    target: &ReviewTarget,
    rows: Vec<(AcceptanceCriterion, Option<CriterionAnchor>)>,
) -> Vec<CriterionReviewState> {
    rows.into_iter()
        .map(|(criterion, anchor)| {
            let staleness = anchor.as_ref().and_then(|a| staleness_for_target(target, a));
            CriterionReviewState { criterion, anchor, staleness }
        })
        .collect()
}

/// Every current criterion of the scope's item, with its anchor and a staleness verdict re-derived
/// from git on this call. An unresolved target yields `staleness: None`, not an error.
pub fn review_criteria_state(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<Vec<CriterionReviewState>> {
    let (target, rows) = criteria_with_anchors(conn, scope, item_id)?;
    Ok(with_staleness(&target, rows))
}
