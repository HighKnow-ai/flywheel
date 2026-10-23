//! Merge (docs/mvp-spec.md §2 "In review → Merged", §8, issue #155): the developer merges an In
//! review Story from its review card. Merged means the merge commit is on the local base branch and
//! the worktree is removed. Merge never pushes.
//!
//! [`merge_story`] is human-only, and refuses (writing nothing, in git or on the board) unless:
//! the Story is In review, no session is live, every criterion is accepted, the worktree is clean,
//! and every Check passed at the branch's current head. A failed, timed out, not run or stale Check
//! needs [`MergeOptions::with_failing_checks`], which is recorded on the review and in the
//! `story.merged` event. A merge that would conflict refuses, naming the paths.
//!
//! The commit (ADR 0009): when a checkout has the base branch checked out and clean, `git merge
//! --no-ff` runs there (aborted on failure); checked out but dirty, Merge refuses and says so;
//! otherwise the same two-parent commit is built with plumbing and the branch moved by
//! compare-and-swap. Then the worktree is removed and the branch deleted once it is contained in
//! the base branch, and one board transaction moves the Story to Merged, closes its review and links
//! each ADR the branch adds to the Story by path (issue #161). An ADR accepted in shaping keeps its
//! Epic Proposal and gets no second link, and an ADR some record already links is left as it is.
//!
//! Once the commit is on the base branch the Story is Merged, whatever happens next: a worktree or
//! branch that could not be removed is reported in [`MergeOutcome::cleanup_warning`] and left for
//! the fleet's reclaim, never a reason to leave the Story In review (a retry would merge twice).

use std::fmt;
use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::domain::actor::assert_human_actor;
use crate::domain::adr_link::{is_linked, link_adr_in_tx, AdrLinkTarget};
use crate::domain::review_decisions::{accepted_epic_adrs, new_adr_paths};
use crate::domain::review::{close_review_in_tx, open_review_in_tx, read_review_diff, review_for_story, StoryReview};
use crate::domain::story::{get_story, set_story_state_in_tx, StoryState};
use crate::domain::worktree::{record_worktree_removed_in_tx, worktree_for_story, Worktree};
use crate::domain::{now, record_event, EventScope};
use crate::git::{self, MergePrecheck};

/// The developer's choices at Merge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MergeOptions {
    /// "Merge with failing Check": merge although a Check failed, timed out, did not run or is
    /// stale. Recorded with the Checks it overrode.
    pub with_failing_checks: bool,
}

/// How the merge commit was written (ADR 0009).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeMethod {
    /// `git merge --no-ff` in the clean checkout that has the base branch checked out.
    Checkout,
    /// `merge-tree`, `commit-tree` and a compare-and-swap `update-ref`: no checkout has the base
    /// branch.
    Plumbing,
}

impl MergeMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            MergeMethod::Checkout => "checkout",
            MergeMethod::Plumbing => "plumbing",
        }
    }
}

/// What a Merge did.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeOutcome {
    pub project_id: String,
    pub merge_commit: String,
    pub base_branch: String,
    pub method: MergeMethod,
    /// The Checks "Merge with failing Check" overrode; empty when none needed it.
    pub failing_checks_overridden: Vec<Value>,
    /// The worktree or branch the Merge could not remove after the commit landed.
    pub cleanup_warning: Option<String>,
    /// The new ADRs Merge linked to the Story, by path.
    pub adrs_linked: Vec<String>,
}

/// A Merge refused before anything was written, with a reason meant for the developer. Its text
/// never carries a filesystem path or git's own output, so the command may show it as is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeRefused(pub String);

impl fmt::Display for MergeRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MergeRefused {}

fn refuse<T>(reason: impl Into<String>) -> anyhow::Result<T> {
    Err(MergeRefused(reason.into()).into())
}

/// The refusals that read the board and the worktree, in the order the developer fixes them.
fn refusal(key: &str, review: &StoryReview, options: MergeOptions) -> Option<String> {
    if review.live_session {
        return Some(format!("{key} has a live session. Stop it before merging."));
    }
    let unaccepted: Vec<String> = review.unaccepted().map(|c| format!("\"{}\"", c.statement)).collect();
    if !unaccepted.is_empty() {
        return Some(format!(
            "Accept every criterion before merging. Not accepted yet: {}.",
            unaccepted.join(", ")
        ));
    }
    if !review.uncommitted.is_empty() {
        return Some(format!(
            "{key}'s worktree has uncommitted changes ({}). Commit or discard them, then merge.",
            review.uncommitted.join(", ")
        ));
    }
    if !review.failing_checks.is_empty() && !options.with_failing_checks {
        let named: Vec<String> =
            review.failing_checks.iter().map(|k| format!("`{}` ({})", k.command, k.failing_words())).collect();
        return Some(format!(
            "A Check has not passed at the branch's head: {}. Re-run the Checks, or use Merge with failing Check.",
            named.join(", ")
        ));
    }
    None
}

/// Refuse a worktree or branch Flywheel does not own, as Drop does.
fn guard_owned(worktree: &Worktree, repo: &Path) -> anyhow::Result<()> {
    let path = Path::new(&worktree.path);
    if path == repo || !path.starts_with(git::worktree_root_from_env()) {
        return refuse("Merge refused: the Story's worktree is not a Flywheel worktree.");
    }
    let branch = worktree.branch.as_str();
    if branch == worktree.base_branch || !branch.starts_with(crate::branch::FLYWHEEL_BRANCH_NAMESPACE) {
        return refuse("Merge refused: the Story's branch is not a Flywheel Story branch.");
    }
    Ok(())
}

/// Merge `story_id` into its base branch. See the module documentation for every refusal and for
/// how the commit is written.
pub fn merge_story(conn: &mut Connection, actor_id: &str, story_id: &str, options: MergeOptions) -> anyhow::Result<MergeOutcome> {
    assert_human_actor(conn, actor_id)?;
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    if story.state != StoryState::InReview.as_str() {
        return refuse(format!("Only a Story In review merges, and {} is {}.", story.key, story.state.replace('_', " ")));
    }
    let Some(worktree) = worktree_for_story(conn, story_id)? else {
        return refuse(format!("{} has no worktree to merge from.", story.key));
    };
    let worktree_path = Path::new(&worktree.path);
    if !worktree_path.is_dir() {
        return refuse(format!("{}'s worktree is missing from disk. Recreate it, or drop the Story.", story.key));
    }
    let repo_path: String =
        conn.query_row("SELECT repo_path FROM projects WHERE id = ?1", params![story.project_id], |r| r.get(0))?;
    let repo = Path::new(&repo_path);
    guard_owned(&worktree, repo)?;

    let review = review_for_story(conn, story_id)?;
    if let Some(reason) = refusal(&story.key, &review, options) {
        return refuse(reason);
    }
    let head = review.head_sha.clone().context("could not read the Story branch's head")?;
    let base = worktree.base_branch.clone();
    let base_tip = git::rev_parse_commit(repo, &format!("refs/heads/{base}"))
        .with_context(|| format!("could not read the base branch {base:?}"))?;
    if git::git_output_at(repo, &["merge-base", "--is-ancestor", &head, &base_tip])?.status.success() {
        return refuse(format!("{}'s branch has nothing that is not already on {base}: there is nothing to merge.", story.key));
    }
    if let MergePrecheck::Conflicts(paths) = git::merge_tree_check(repo, &base_tip, &head)? {
        return refuse(format!(
            "Merging {} into {base} would conflict in {}. Rebase needed: request changes so the agent rebases.",
            story.key,
            paths.join(", ")
        ));
    }
    let checkout = git::checkout_of_branch(repo, &base)?;
    if let Some(checkout) = &checkout {
        let changed = git::tracked_changes(checkout)?;
        if !changed.is_empty() {
            return refuse(format!(
                "{base} is checked out with uncommitted changes ({}). Commit or stash them, then merge.",
                changed.join(", ")
            ));
        }
    }
    let overridden: Vec<Value> = review.failing_checks.iter().map(|k| k.override_record()).collect();
    // A Story handed off before reviews existed has no open review: open it now, so the decision has
    // a row to land on.
    let diff = if review.review.is_none() { Some(read_review_diff(worktree_path, &base, &head)?) } else { None };
    // The ADRs the branch adds, read now: the worktree is gone after the git step. One accepted in
    // shaping keeps its Epic Proposal.
    let shaped: Vec<String> = accepted_epic_adrs(conn, &story.epic_id)?.into_iter().map(|(_, d)| d.path).collect();
    let new_adrs: Vec<String> =
        new_adr_paths(&git::review_files(repo, &base_tip, &head)?).into_iter().filter(|p| !shaped.contains(p)).collect();

    // The git step. Everything above wrote nothing.
    let message = format!("Merge {}: {}\n\nMerged in Flywheel from {}.", story.key, story.title, worktree.branch);
    let (merge_commit, method) = match &checkout {
        Some(checkout) => {
            git::merge_no_ff(checkout, &worktree.branch, &message)?;
            (git::rev_parse_commit(checkout, "HEAD")?, MergeMethod::Checkout)
        }
        None => (git::merge_without_checkout(repo, &base, &head, &message)?, MergeMethod::Plumbing),
    };

    // The commit is on the base branch: the Story is Merged from here on.
    let mut warnings = Vec::new();
    let removed = match git::worktree_remove(repo, worktree_path) {
        Ok(_) => true,
        Err(e) => {
            eprintln!("merge of {}: worktree removal failed: {e:#}", story.key);
            warnings.push("its worktree could not be removed");
            false
        }
    };
    if removed {
        if let Err(e) = git::delete_merged_branch(repo, &worktree.branch, &head, &merge_commit) {
            eprintln!("merge of {}: branch deletion failed: {e:#}", story.key);
            warnings.push("its branch could not be deleted");
        }
    }
    let cleanup_warning = (!warnings.is_empty())
        .then(|| format!("{} is merged, but {}. Reclaim it from the worktree inventory.", story.key, warnings.join(" and ")));

    let now = now();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(diff) = &diff {
        open_review_in_tx(&tx, &story.project_id, story_id, None, diff, &Value::Array(Vec::new()), &Value::Array(Vec::new()))?;
    }
    if removed {
        record_worktree_removed_in_tx(&tx, &worktree, story_id, &story.key, actor_id, &now)?;
    }
    set_story_state_in_tx(&tx, actor_id, story_id, StoryState::Merged)?;
    let overridden_json = Value::Array(overridden.clone());
    close_review_in_tx(&tx, story_id, actor_id, "merged", (!overridden.is_empty()).then_some(&overridden_json), None)?;
    let mut adrs_linked = Vec::new();
    for path in new_adrs {
        if !is_linked(&tx, &story.project_id, &path)? {
            link_adr_in_tx(&tx, actor_id, &story.project_id, &path, &AdrLinkTarget::Story(story_id.to_string()), &now)?;
            adrs_linked.push(path);
        }
    }
    let label = if overridden.is_empty() {
        format!("Merged {} into {base}", story.key)
    } else {
        format!("Merged {} into {base} with {} failing Check(s)", story.key, overridden.len())
    };
    record_event(
        &tx,
        &story.project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&story.epic_id) },
        actor_id,
        "story.merged",
        &serde_json::json!({
            "merge_commit": merge_commit,
            "base_branch": base,
            "branch": worktree.branch,
            "method": method.as_str(),
            "failing_checks_overridden": overridden_json,
            "cleanup_warning": cleanup_warning,
            "adrs_linked": adrs_linked,
            "label": label,
        }),
        &now,
    )?;
    tx.commit().context("the merge commit is on the base branch, but the board could not record it")?;

    Ok(MergeOutcome {
        project_id: story.project_id,
        merge_commit,
        base_branch: base,
        method,
        failing_checks_overridden: overridden,
        cleanup_warning,
        adrs_linked,
    })
}
