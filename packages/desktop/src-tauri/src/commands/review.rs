//! `story_review` / `story_merge`: the review card's read and its Merge (docs/mvp-spec.md §8, issue
//! #155, ADR 0009). The read is `domain::review::review_for_story`; Merge is
//! `domain::story_merge::merge_story`, human-only, stamped with the local human actor here.
//!
//! Merge runs git (a merge may run the developer's commit hooks), so like `worktree_reclaim` it never
//! holds the shared database mutex across a git call and never runs on the IPC thread: the mutex is
//! taken only to resolve the actor, and the Merge runs on the blocking pool over a connection of its
//! own (WAL plus `busy_timeout`). A refusal reaches the developer as written; any other failure
//! crosses IPC only as its fixed category (`ipc_error`), since git's output carries paths.

use flywheel_core::domain::proposal_apply::AdrBarLines;
use flywheel_core::domain::review::{Review, ReviewCheck, ReviewCriterion, StoryReview};
use flywheel_core::domain::review_decisions::{DecisionChange, NewAdr, RelatedAdr, ReviewDecisions};
use flywheel_core::domain::story_merge::{MergeOptions, MergeOutcome, MergeRefused};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use super::{emit_board_changed, ipc_error};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCheckDto {
    pub check_id: String,
    pub criterion_id: String,
    pub command: String,
    /// `not_run`, `passed`, `failed` or `timed_out`.
    pub result: String,
    pub stale: bool,
    pub commit_sha: Option<String>,
    pub output_tail: Option<String>,
}

impl From<ReviewCheck> for ReviewCheckDto {
    fn from(k: ReviewCheck) -> Self {
        Self {
            check_id: k.check_id,
            criterion_id: k.criterion_id,
            command: k.command,
            result: k.result.as_str().to_string(),
            stale: k.stale,
            commit_sha: k.commit_sha,
            output_tail: k.output_tail,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCriterionDto {
    pub id: String,
    pub statement: String,
    pub accepted: bool,
    pub accepted_at: Option<String>,
    /// Its Check passed at the branch's head: the card suggests accepting it. Never an acceptance.
    pub pre_ticked: bool,
    pub check: Option<ReviewCheckDto>,
}

impl From<ReviewCriterion> for ReviewCriterionDto {
    fn from(c: ReviewCriterion) -> Self {
        Self {
            id: c.id,
            statement: c.statement,
            accepted: c.accepted,
            accepted_at: c.accepted_at,
            pre_ticked: c.pre_ticked,
            check: c.check.map(ReviewCheckDto::from),
        }
    }
}

/// The open `reviews` row: what the hand-off recorded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDto {
    pub id: String,
    pub opened_at: String,
    pub base_sha: String,
    pub head_sha: String,
    pub files: i64,
    pub added: i64,
    pub removed: i64,
    pub open_tasks: i64,
    pub check_objections: Value,
    pub adr_notes: Value,
}

impl From<Review> for ReviewDto {
    fn from(r: Review) -> Self {
        Self {
            id: r.id,
            opened_at: r.opened_at,
            base_sha: r.base_sha,
            head_sha: r.head_sha,
            files: r.files,
            added: r.added,
            removed: r.removed,
            open_tasks: r.open_tasks,
            check_objections: r.check_objections,
            adr_notes: r.adr_notes,
        }
    }
}

/// An ADR's four bar lines, as the review card shows them beside it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdrBarLinesDto {
    pub hard_to_reverse: String,
    pub surprising: String,
    pub losing_alternative: String,
    pub relates_to: Option<String>,
}

impl From<AdrBarLines> for AdrBarLinesDto {
    fn from(b: AdrBarLines) -> Self {
        Self {
            hard_to_reverse: b.hard_to_reverse,
            surprising: b.surprising,
            losing_alternative: b.losing_alternative,
            relates_to: b.relates_to,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedAdrDto {
    pub path: String,
    pub title: String,
}

impl From<RelatedAdr> for RelatedAdrDto {
    fn from(r: RelatedAdr) -> Self {
        Self { path: r.path, title: r.title }
    }
}

/// A new ADR's card in the Decisions section.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAdrDto {
    pub title: String,
    /// `null`: no bar lines, from the hand-off or from shaping.
    pub bar_lines: Option<AdrBarLinesDto>,
    /// `handoff` or `shaping`; `null` with no bar lines.
    pub bar_lines_from: Option<String>,
    pub related: Vec<RelatedAdrDto>,
    /// The ADR Proposal accepted on the Epic in shaping at this path.
    pub proposal_id: Option<String>,
}

impl From<NewAdr> for NewAdrDto {
    fn from(a: NewAdr) -> Self {
        Self {
            title: a.title,
            bar_lines: a.bar_lines.map(AdrBarLinesDto::from),
            bar_lines_from: a.bar_lines_from.map(|s| s.as_str().to_string()),
            related: a.related.into_iter().map(RelatedAdrDto::from).collect(),
            proposal_id: a.proposal_id,
        }
    }
}

/// One `docs/adr/` or `GLOSSARY.md` change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionChangeDto {
    /// `adr` or `glossary`.
    pub kind: String,
    pub path: String,
    pub old_path: Option<String>,
    /// git's status letter: `A`, `M`, `D`, `R`, `C` or `T`.
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    /// Set for an ADR the branch adds.
    pub new_adr: Option<NewAdrDto>,
}

impl From<DecisionChange> for DecisionChangeDto {
    fn from(c: DecisionChange) -> Self {
        Self {
            kind: c.kind.as_str().to_string(),
            path: c.path,
            old_path: c.old_path,
            status: c.status,
            added: c.added,
            removed: c.removed,
            new_adr: c.new_adr.map(NewAdrDto::from),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryReviewDto {
    pub story_id: String,
    pub story_key: String,
    pub story_state: String,
    pub head_sha: Option<String>,
    pub review: Option<ReviewDto>,
    pub criteria: Vec<ReviewCriterionDto>,
    /// Tasks open or doing now.
    pub open_tasks: i64,
    /// The Checks Merge needs "Merge with failing Check" for: failed, timed out, not run or stale.
    pub failing_checks: Vec<ReviewCheckDto>,
    pub live_session: bool,
    /// Uncommitted paths in the Story's worktree, repository-relative.
    pub uncommitted: Vec<String>,
    /// The Decisions section: `docs/adr/` changes by path, then `GLOSSARY.md` (issue #161).
    pub decisions: Vec<DecisionChangeDto>,
}

impl StoryReviewDto {
    fn new(r: StoryReview, decisions: ReviewDecisions) -> Self {
        Self { decisions: decisions.changes.into_iter().map(DecisionChangeDto::from).collect(), ..Self::from(r) }
    }
}

impl From<StoryReview> for StoryReviewDto {
    fn from(r: StoryReview) -> Self {
        Self {
            story_id: r.story_id,
            story_key: r.story_key,
            story_state: r.story_state,
            head_sha: r.head_sha,
            review: r.review.map(ReviewDto::from),
            criteria: r.criteria.into_iter().map(ReviewCriterionDto::from).collect(),
            open_tasks: r.open_tasks,
            failing_checks: r.failing_checks.into_iter().map(ReviewCheckDto::from).collect(),
            live_session: r.live_session,
            uncommitted: r.uncommitted,
            decisions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeDto {
    pub merge_commit: String,
    pub base_branch: String,
    /// `checkout` or `plumbing` (ADR 0009).
    pub method: String,
    /// How many failing Checks "Merge with failing Check" overrode.
    pub failing_checks_overridden: usize,
    /// The worktree or branch Merge could not remove after the commit landed.
    pub cleanup_warning: Option<String>,
    /// The new ADRs Merge linked to the Story, by path.
    pub adrs_linked: Vec<String>,
}

impl From<MergeOutcome> for MergeDto {
    fn from(o: MergeOutcome) -> Self {
        Self {
            merge_commit: o.merge_commit,
            base_branch: o.base_branch,
            method: o.method.as_str().to_string(),
            failing_checks_overridden: o.failing_checks_overridden.len(),
            cleanup_warning: o.cleanup_warning,
            adrs_linked: o.adrs_linked,
        }
    }
}

/// The review card of one Story: criteria with their Check chips and pre-ticks, the Tasks not done,
/// the failing Checks, what would stop a Merge now, and the Decisions section. Read-only.
#[tauri::command]
pub fn story_review(state: State<AppState>, story_id: String) -> Result<StoryReviewDto, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("story_review:lock", e))?;
    let review = flywheel_core::domain::review::review_for_story(&conn, &story_id).map_err(|e| ipc_error("story_review:read", e))?;
    let decisions = flywheel_core::domain::review_decisions::review_decisions(&conn, &story_id)
        .map_err(|e| ipc_error("story_review:decisions", e))?;
    Ok(StoryReviewDto::new(review, decisions))
}

/// A Merge failure as the renderer sees it: a refusal's own words, or a fixed category.
fn merge_error(e: anyhow::Error) -> String {
    match e.downcast_ref::<MergeRefused>() {
        Some(refused) => refused.0.clone(),
        None => ipc_error("story_merge:git", e),
    }
}

/// The developer's Merge of an In review Story (`with_failing_checks`: "Merge with failing Check").
#[tauri::command(async)]
pub async fn story_merge(
    state: State<'_, AppState>,
    app: AppHandle,
    story_id: String,
    with_failing_checks: bool,
) -> Result<MergeDto, String> {
    let actor = {
        let conn = state.db.lock().map_err(|e| ipc_error("story_merge:lock", e))?;
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| ipc_error("story_merge:actor", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        actor?
    };
    let db_path = flywheel_core::db::default_db_path().map_err(|e| ipc_error("story_merge:open", e))?;

    let outcome = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<MergeOutcome> {
        let mut conn = rusqlite::Connection::open(&db_path)?;
        flywheel_core::db::apply_pragmas(&conn)?;
        flywheel_core::domain::story_merge::merge_story(&mut conn, &actor, &story_id, MergeOptions { with_failing_checks })
    })
    .await
    .map_err(|e| ipc_error("story_merge:join", e))?
    .map_err(merge_error)?;

    emit_board_changed(&app, Some(&outcome.project_id), "story", None);
    Ok(outcome.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_crosses_as_written_and_any_other_failure_as_its_category() {
        let refused = anyhow::Error::new(MergeRefused("Accept every criterion before merging.".into()));
        assert_eq!(merge_error(refused), "Accept every criterion before merging.");
        let git = anyhow::anyhow!("git -C \"/Users/someone/repo\" [\"merge\"] failed");
        assert_eq!(merge_error(git), "failed:story_merge:git");
    }
}
