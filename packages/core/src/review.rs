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
        /// True when the task is already integrated and the range is the merge commit against
        /// its first parent (what the merge landed), not the task branch against the target.
        post_merge: bool,
    },
    /// The epic (or the task's epic) has no integration branch yet — nothing to review.
    NoIntegrationBranch,
    /// The task has no worktree row, so no branch to review.
    NoBranch,
}

/// What the board said about a review target, before any git runs. Private fields: an opaque
/// hand-off from [`review_target_inputs`] to [`finish_review_target`], so a caller cannot substitute
/// a ref or a path between the two halves, and the git half re-reads nothing.
#[derive(Debug, Clone)]
pub struct ReviewTargetInputs(Pending);

#[derive(Debug, Clone)]
enum Pending {
    /// Fully decided from the board: an epic, or a task with no branch or no integration branch.
    Settled(ReviewTarget),
    /// A task whose range is known but not yet checked against git for a recorded merge.
    Task {
        repo_path: PathBuf,
        base: String,
        head: String,
        project_id: String,
        epic_id: Option<String>,
        task_id: String,
        /// The merge commit of the task's integrated event, if it has one. A board read.
        recorded_merge_commit: Option<String>,
    },
}

/// The database half of [`resolve_review_target`]: every board read, no git. Safe under the
/// database lock; hand the result to [`finish_review_target`] once the lock is released.
pub fn review_target_inputs(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<ReviewTargetInputs> {
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
                return Ok(ReviewTargetInputs(Pending::Settled(ReviewTarget::NoBranch)));
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
                        None => {
                            return Ok(ReviewTargetInputs(Pending::Settled(
                                ReviewTarget::NoIntegrationBranch,
                            )))
                        }
                    }
                }
                None => default_branch,
            };

            let recorded_merge_commit = match epic_id {
                Some(_) => crate::merge::integrated_merge_commit(conn, item_id)?,
                None => None,
            };
            Ok(ReviewTargetInputs(Pending::Task {
                repo_path,
                base,
                head,
                project_id,
                epic_id,
                task_id: item_id.to_string(),
                recorded_merge_commit,
            }))
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
                return Ok(ReviewTargetInputs(Pending::Settled(ReviewTarget::NoIntegrationBranch)));
            };
            let (repo_path, base) = project_repo(conn, &project_id)?;
            Ok(ReviewTargetInputs(Pending::Settled(ReviewTarget::Resolved {
                repo_path,
                base,
                head,
                project_id,
                epic_id: Some(item_id.to_string()),
                task_id: None,
                post_merge: false,
            })))
        }
    }
}

/// The git half of [`resolve_review_target`]: decide whether an integrated task is reviewed as its
/// merge commit. Takes no connection, so a caller can read the inputs under the database lock,
/// release it, then call this.
pub fn finish_review_target(inputs: ReviewTargetInputs) -> anyhow::Result<ReviewTarget> {
    let (repo_path, base, head, project_id, epic_id, task_id, recorded_merge_commit) = match inputs.0 {
        Pending::Settled(target) => return Ok(target),
        Pending::Task { repo_path, base, head, project_id, epic_id, task_id, recorded_merge_commit } => {
            (repo_path, base, head, project_id, epic_id, task_id, recorded_merge_commit)
        }
    };

    // After a merge the three-dot range between the integration branch and the task
    // branch is EMPTY: the task tip became the merge base. Reading it would report "no
    // changes" for the work just landed, indistinguishable from a task with nothing to
    // review. So an integrated task is reviewed as the recorded merge commit against its
    // first parent (the integration side), which is exactly what the merge landed.
    // The ancestry check runs two quick local git reads, and only for a task that has an
    // integrated event. ponytail: commits the task branch gains after its merge are not
    // in this range; add a second range if that matters.
    if let Some(merge_commit) = recorded_merge_commit {
        if crate::merge::merge_commit_is_reachable(&repo_path, &merge_commit, &base)? {
            return Ok(ReviewTarget::Resolved {
                repo_path,
                base: format!("{merge_commit}^1"),
                head: merge_commit,
                project_id,
                epic_id,
                task_id: Some(task_id),
                post_merge: true,
            });
        }
    }
    Ok(ReviewTarget::Resolved {
        repo_path,
        base,
        head,
        project_id,
        epic_id,
        task_id: Some(task_id),
        post_merge: false,
    })
}

/// Resolve `item_id` under `scope` to a repo path and a base/head ref pair. For core-internal and
/// test use: it takes a connection AND spawns git, so it must not be called from a command handler
/// while the database lock is held. [`review_target_inputs`] and [`finish_review_target`] exist for
/// that.
pub fn resolve_review_target(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<ReviewTarget> {
    finish_review_target(review_target_inputs(conn, scope, item_id)?)
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
/// anchors (absent = no evidence), and the target's unfinished inputs. Takes the connection so a
/// caller can run this under the database lock, release it, then call [`finish_review_target`] and
/// [`with_staleness`] lock-free.
pub fn criteria_with_anchors(
    conn: &Connection,
    scope: ReviewScope,
    item_id: &str,
) -> anyhow::Result<(ReviewTargetInputs, Vec<(AcceptanceCriterion, Option<CriterionAnchor>)>)> {
    let target = review_target_inputs(conn, scope, item_id)?;
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

/// One task of an epic with where its current-revision criteria stand (D-132). `without_evidence`
/// is checked criteria that carry no anchor; `with_evidence + without_evidence == checked`.
#[derive(Debug, Clone, PartialEq)]
pub struct EpicTaskCriteria {
    pub task_id: String,
    pub key: String,
    pub title: String,
    pub status: String,
    pub checked: i64,
    pub total: i64,
    pub with_evidence: i64,
    pub without_evidence: i64,
}

/// Every task of `epic_id` with its criteria counted: the roll-up beside an epic's own criteria in
/// the review rail (D-132). Rows are ordered by rank then task id, so the order is identical on
/// every read. An unknown epic, or one with no tasks, is an empty vector.
///
/// Read-only, and it takes a connection and spawns no git, so it is safe to call while the
/// database lock is held. It deliberately carries no integrated marker, unlike the roll-up in
/// `forge::request_body`: that marker needs `merge::is_integrated`, which spawns git and would put
/// a subprocess back inside the lock's scope (the CR-01 hazard). Superseded criterion revisions
/// are excluded from every count, so a stale revision is never shown as a task's current state.
pub fn epic_task_rollup(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<EpicTaskCriteria>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.key, t.title, t.status,
            (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.parent_type = 'task'
                AND c.parent_id = t.id AND c.superseded_at IS NULL),
            (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.parent_type = 'task'
                AND c.parent_id = t.id AND c.superseded_at IS NULL AND c.checked = 1),
            (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.parent_type = 'task'
                AND c.parent_id = t.id AND c.superseded_at IS NULL AND c.checked = 1
                AND EXISTS (SELECT 1 FROM criterion_anchors a WHERE a.criterion_id = c.id))
         FROM tasks t WHERE t.epic_id = ?1 ORDER BY t.rank ASC, t.id ASC",
    )?;
    let rows = stmt.query_map(params![epic_id], |row| {
        let checked: i64 = row.get(5)?;
        let with_evidence: i64 = row.get(6)?;
        Ok(EpicTaskCriteria {
            task_id: row.get(0)?,
            key: row.get(1)?,
            title: row.get(2)?,
            status: row.get(3)?,
            total: row.get(4)?,
            checked,
            with_evidence,
            without_evidence: checked - with_evidence,
        })
    })?
    .collect::<Result<Vec<_>, _>>()
    .context("failed to read the epic's task criteria roll-up")?;
    Ok(rows)
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
    let (inputs, rows) = criteria_with_anchors(conn, scope, item_id)?;
    Ok(with_staleness(&finish_review_target(inputs)?, rows))
}
