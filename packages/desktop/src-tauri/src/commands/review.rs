//! The review card's commands (docs/mvp-spec.md §8, issues #155 and #157, ADR 0009):
//!
//! - `story_review`: the read, `domain::review::review_for_story`.
//! - `review_file_patch`: one changed file's patch in the review's diff, read when the card shows it.
//! - `story_checks_rerun`: Re-run Checks, `domain::handoff`'s review run, as the local human.
//! - `story_merge`: Merge, `domain::story_merge::merge_story`, human-only, stamped with the local
//!   human actor here.
//!
//! Each of them runs git (a merge may run the developer's commit hooks, a Check run takes minutes),
//! so like `worktree_reclaim` none holds the shared database mutex across a git call or runs on the
//! IPC thread. The read and Merge run on the blocking pool over a connection of their own (WAL plus
//! `busy_timeout`); the patch takes the mutex only to resolve where to read from; Re-run Checks takes
//! it to plan and to record, and never while a Check runs, as the hand-off does. A refusal reaches
//! the developer as written; any other failure crosses IPC only as its fixed category
//! (`ipc_error`), since git's output carries paths.

use std::sync::Mutex;

use flywheel_core::domain::handoff::{
    complete_review_run, plan_review_run, run_checks_reporting, ReviewRunOutcome, ReviewRunRefused,
};
use flywheel_core::domain::proposal_apply::AdrBarLines;
use flywheel_core::domain::review::{
    Review, ReviewCheck, ReviewCriterion, ReviewObjection, StoryReview,
};
use flywheel_core::domain::review_decisions::{
    AdrDecision, DecisionChange, DecisionFlag, NewAdr, RelatedAdr, ReviewDecisions,
};
use flywheel_core::domain::story_merge::{MergeOptions, MergeOutcome, MergeRefused};
use flywheel_core::git::ReviewFile;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::{emit_board_changed, ipc_error, validate_text, MAX_PROSE_LEN};
use crate::state::AppState;

/// The handing-off agent's objection to a Check.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewObjectionDto {
    pub why: String,
    /// The Check's command when the agent objected; differs from the Check's once it was edited.
    pub command: String,
}

impl From<ReviewObjection> for ReviewObjectionDto {
    fn from(o: ReviewObjection) -> Self {
        Self {
            why: o.why,
            command: o.command,
        }
    }
}

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
    pub objections: Vec<ReviewObjectionDto>,
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
            objections: k
                .objections
                .into_iter()
                .map(ReviewObjectionDto::from)
                .collect(),
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
        Self {
            path: r.path,
            title: r.title,
        }
    }
}

/// The developer's decision on a new ADR (issue #164).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdrDecisionDto {
    /// `keep`, `not_an_adr` or `wrong_decision`.
    pub kind: String,
    /// Set for `wrong_decision`.
    pub what_is_wrong: Option<String>,
    pub should_be: Option<String>,
}

impl From<AdrDecision> for AdrDecisionDto {
    fn from(d: AdrDecision) -> Self {
        let kind = d.as_str().to_string();
        match d {
            AdrDecision::WrongDecision {
                what_is_wrong,
                should_be,
            } => Self {
                kind,
                what_is_wrong: Some(what_is_wrong),
                should_be: Some(should_be),
            },
            _ => Self {
                kind,
                what_is_wrong: None,
                should_be: None,
            },
        }
    }
}

/// What the Decisions section flags on an ADR change (issue #164).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionFlagDto {
    /// `wording_or_supersede`, `renumber` or `supersession_line_missing`.
    pub kind: String,
    /// Renumber: the number taken. Supersession line missing: the superseded ADR's number.
    pub number: Option<u32>,
    /// Renumber: the file holding the number on the base branch, and that branch.
    pub taken_by: Option<String>,
    pub base_branch: Option<String>,
    /// Supersession line missing: the ADR file without its `Status: superseded by` line.
    pub superseded: Option<String>,
}

impl From<DecisionFlag> for DecisionFlagDto {
    fn from(f: DecisionFlag) -> Self {
        let kind = f.as_str().to_string();
        let empty = Self {
            kind,
            number: None,
            taken_by: None,
            base_branch: None,
            superseded: None,
        };
        match f {
            DecisionFlag::WordingOrSupersede => empty,
            DecisionFlag::Renumber {
                number,
                taken_by,
                base_branch,
            } => Self {
                number: Some(number),
                taken_by: Some(taken_by),
                base_branch: Some(base_branch),
                ..empty
            },
            DecisionFlag::SupersessionLineMissing { superseded, number } => Self {
                number: Some(number),
                superseded: Some(superseded),
                ..empty
            },
        }
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
    /// Keep, Not an ADR or Wrong decision, as stored on the open review.
    pub decision: AdrDecisionDto,
}

impl From<NewAdr> for NewAdrDto {
    fn from(a: NewAdr) -> Self {
        Self {
            title: a.title,
            bar_lines: a.bar_lines.map(AdrBarLinesDto::from),
            bar_lines_from: a.bar_lines_from.map(|s| s.as_str().to_string()),
            related: a.related.into_iter().map(RelatedAdrDto::from).collect(),
            proposal_id: a.proposal_id,
            decision: a.decision.into(),
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
    /// Wording or supersede?, Renumber, Supersession line missing.
    pub flags: Vec<DecisionFlagDto>,
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
            flags: c.flags.into_iter().map(DecisionFlagDto::from).collect(),
        }
    }
}

/// One changed file of the review's diff.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFileDto {
    pub path: String,
    /// A rename's or copy's source.
    pub old_path: Option<String>,
    /// git's status letter: `M`, `A`, `D`, `R`, `C` or `T`.
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub binary: bool,
}

impl From<ReviewFile> for ReviewFileDto {
    fn from(f: ReviewFile) -> Self {
        Self {
            path: f.path,
            old_path: f.old_path,
            status: f.status,
            added: f.added,
            removed: f.removed,
            binary: f.binary,
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
    /// The changed files of the review's diff, against the branch's head now.
    pub files: Vec<ReviewFileDto>,
    /// The Decisions section: `docs/adr/` changes by path, then `GLOSSARY.md` (issue #161).
    pub decisions: Vec<DecisionChangeDto>,
    /// Rebase needed (issue #158): the repository-relative paths a merge into the base branch would
    /// conflict in; empty when it merges cleanly.
    pub conflicts: Vec<String>,
    /// The request for changes Rebase needed pre-fills, naming the base branch and those paths.
    pub rebase_comment: Option<String>,
    /// The ADR review points a request for changes carries after the comments (issue #164): each
    /// Not an ADR and Wrong decision, and each renumber and missing supersession line.
    pub adr_review_points: Vec<String>,
}

impl StoryReviewDto {
    fn new(r: StoryReview, decisions: ReviewDecisions) -> Self {
        let adr_review_points = decisions.review_points();
        Self {
            decisions: decisions
                .changes
                .into_iter()
                .map(DecisionChangeDto::from)
                .collect(),
            adr_review_points,
            ..Self::from(r)
        }
    }
}

impl From<StoryReview> for StoryReviewDto {
    fn from(r: StoryReview) -> Self {
        let rebase_comment = r.rebase_comment();
        Self {
            story_id: r.story_id,
            story_key: r.story_key,
            story_state: r.story_state,
            head_sha: r.head_sha,
            review: r.review.map(ReviewDto::from),
            criteria: r
                .criteria
                .into_iter()
                .map(ReviewCriterionDto::from)
                .collect(),
            open_tasks: r.open_tasks,
            failing_checks: r
                .failing_checks
                .into_iter()
                .map(ReviewCheckDto::from)
                .collect(),
            live_session: r.live_session,
            uncommitted: r.uncommitted,
            decisions: Vec::new(),
            conflicts: r.conflicts,
            rebase_comment,
            files: r.files.into_iter().map(ReviewFileDto::from).collect(),
            adr_review_points: Vec::new(),
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

/// A connection of its own on the shared database, for work that runs git off the shared mutex.
fn own_connection() -> anyhow::Result<Connection> {
    let conn = Connection::open(flywheel_core::db::default_db_path()?)?;
    flywheel_core::db::apply_pragmas(&conn)?;
    Ok(conn)
}

/// The review card of one Story: criteria with their Check chips and pre-ticks, the Tasks not done,
/// the failing Checks with the agent's objections, the diff's files, what would stop a Merge now, and
/// the Decisions section. Read-only; it reads git, so it runs on the blocking pool over a connection
/// of its own.
#[tauri::command(async)]
pub async fn story_review(story_id: String) -> Result<StoryReviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<StoryReviewDto, String> {
        let conn = own_connection().map_err(|e| ipc_error("story_review:open", e))?;
        let review = flywheel_core::domain::review::review_for_story(&conn, &story_id)
            .map_err(|e| ipc_error("story_review:read", e))?;
        let decisions = flywheel_core::domain::review_decisions::review_decisions(&conn, &story_id)
            .map_err(|e| ipc_error("story_review:decisions", e))?;
        Ok(StoryReviewDto::new(review, decisions))
    })
    .await
    .map_err(|e| ipc_error("story_review:join", e))?
}

/// The longest patch the card is sent, in bytes. A longer one is withheld, and the card says so.
pub const MAX_PATCH_BYTES: usize = 512 * 1024;

/// One changed file's patch, or the word that it is too large to show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPatchDto {
    /// `git diff`'s text for the one file; empty when `too_large`.
    pub patch: String,
    pub too_large: bool,
}

fn patch_dto(patch: String) -> ReviewPatchDto {
    if patch.len() > MAX_PATCH_BYTES {
        ReviewPatchDto {
            patch: String::new(),
            too_large: true,
        }
    } else {
        ReviewPatchDto {
            patch,
            too_large: false,
        }
    }
}

/// One changed file's patch in the open review's diff (`old_path`: a rename's source). The range is
/// the core's, never the caller's; the mutex is held only to resolve it.
#[tauri::command(async)]
pub async fn review_file_patch(
    state: State<'_, AppState>,
    story_id: String,
    path: String,
    old_path: Option<String>,
) -> Result<ReviewPatchDto, String> {
    let source = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("review_file_patch:lock", e))?;
        flywheel_core::domain::review::review_patch_source(&conn, &story_id)
            .map_err(|e| ipc_error("review_file_patch:read", e))?
    };
    tauri::async_runtime::spawn_blocking(move || source.patch(&path, old_path.as_deref()))
        .await
        .map_err(|e| ipc_error("review_file_patch:join", e))?
        .map(patch_dto)
        .map_err(|e| ipc_error("review_file_patch:git", e))
}

/// What a Re-run Checks recorded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksRerunDto {
    pub commit_sha: String,
    pub passed: usize,
    pub failed: usize,
    pub timed_out: usize,
}

impl From<&ReviewRunOutcome> for ChecksRerunDto {
    fn from(o: &ReviewRunOutcome) -> Self {
        use flywheel_core::domain::check::CheckResult;
        let count = |result: CheckResult| {
            o.batch
                .outcomes
                .iter()
                .filter(|x| x.result == result)
                .count()
        };
        Self {
            commit_sha: o.batch.commit_sha.clone(),
            passed: count(CheckResult::Passed),
            failed: count(CheckResult::Failed),
            timed_out: count(CheckResult::TimedOut),
        }
    }
}

/// Re-run every Check of an In review Story against `db`, as the local human: plan and record with
/// the mutex, run without it. `on_progress` hears `(done, total)` as the Checks run.
pub fn rerun_off_lock(
    db: &Mutex<Connection>,
    story_id: &str,
    on_progress: impl FnMut(usize, usize),
) -> anyhow::Result<ReviewRunOutcome> {
    let lock = || {
        db.lock()
            .map_err(|_| anyhow::anyhow!("the board database is unavailable"))
    };
    let (actor, plan) = {
        let conn = lock()?;
        (
            flywheel_core::domain::actor::local_human_actor_id(&conn)?,
            plan_review_run(&conn, story_id)?,
        )
    };
    let batch = run_checks_reporting(&plan, on_progress)?;
    complete_review_run(&mut *lock()?, &actor, &plan, batch)
}

/// A Re-run Checks failure as the renderer sees it: a refusal's own words, or a fixed category.
fn rerun_error(e: anyhow::Error) -> String {
    match e.downcast_ref::<ReviewRunRefused>() {
        Some(refused) => refused.0.clone(),
        None => ipc_error("story_checks_rerun:run", e),
    }
}

/// The developer's Re-run Checks from the review card: every Check, in the worktree, with no
/// session, each run recorded against the branch's head. Refused while a session is live. While it
/// runs, `checks:progress` says how many of the Checks have ended (`{ storyId, done, total }`).
#[tauri::command(async)]
pub async fn story_checks_rerun(
    app: AppHandle,
    story_id: String,
) -> Result<ChecksRerunDto, String> {
    let worker = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let progress = |done: usize, total: usize| {
            use tauri::Emitter;
            let payload = serde_json::json!({ "storyId": story_id, "done": done, "total": total });
            worker.emit("checks:progress", payload).ok();
        };
        rerun_off_lock(&worker.state::<AppState>().db, &story_id, progress)
    })
    .await
    .map_err(|e| ipc_error("story_checks_rerun:join", e))?
    .map_err(rerun_error)?;
    emit_board_changed(
        &app,
        Some(&outcome.project_id),
        "story",
        Some(&outcome.story_id),
    );
    Ok(ChecksRerunDto::from(&outcome))
}

/// The developer's decision on a new ADR in the Decisions section (issue #164): `keep`, `not_an_adr`,
/// or `wrong_decision` with what is wrong and what it should be. Stored on the open review; it holds
/// Merge until set back to Keep, and Request changes carries it to the agent.
#[tauri::command]
pub async fn story_adr_decide(
    state: State<'_, AppState>,
    app: AppHandle,
    story_id: String,
    path: String,
    decision: String,
    what_is_wrong: Option<String>,
    should_be: Option<String>,
) -> Result<(), String> {
    let decision = match decision.as_str() {
        "keep" => AdrDecision::Keep,
        "not_an_adr" => AdrDecision::NotAnAdr,
        "wrong_decision" => {
            let what_is_wrong = what_is_wrong.unwrap_or_default();
            let should_be = should_be.unwrap_or_default();
            validate_text("what is wrong", &what_is_wrong, MAX_PROSE_LEN)?;
            validate_text("what it should be", &should_be, MAX_PROSE_LEN)?;
            AdrDecision::WrongDecision {
                what_is_wrong,
                should_be,
            }
        }
        other => return Err(format!("unknown ADR decision {other:?}")),
    };
    // The decision is checked against the review's ADRs, read from git: a side connection, under
    // the Story's work lock, never the board mutex (issue #215), on the blocking pool (issue #220).
    let db_path = super::board_path(&state.db)?;
    let id = story_id.clone();
    let project_id = tauri::async_runtime::spawn_blocking(move || {
        super::with_story_work(&id, || -> Result<Option<String>, String> {
            let mut conn = super::open_beside(&db_path)?;
            let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
                .map_err(|e| ipc_error("story_adr_decide:actor", e))?;
            flywheel_core::domain::review_decisions::set_adr_decision(
                &mut conn, &human, &id, &path, &decision,
            )
            .map_err(|e| format!("{e:#}"))?;
            Ok(super::project_of(&conn, "stories", &id))
        })
    })
    .await
    .map_err(|e| ipc_error("story_adr_decide:join", e))??;
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
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
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("story_merge:lock", e))?;
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .map_err(|e| ipc_error("story_merge:actor", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        actor?
    };
    let db_path = super::board_path(&state.db)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        merge_with_story_work(
            &db_path,
            &actor,
            &story_id,
            MergeOptions {
                with_failing_checks,
            },
        )
    })
    .await
    .map_err(|e| ipc_error("story_merge:join", e))?
    .map_err(merge_error)?;

    emit_board_changed(&app, Some(&outcome.project_id), "story", None);
    Ok(outcome.into())
}

/// Merge `story_id` on a connection of its own on the database at `db_path`, holding the Story's
/// work lock ([`super::story_work`], issue #220): a Merge never interleaves with a Start, a Drop or
/// a Request changes on the same Story.
pub fn merge_with_story_work(
    db_path: &std::path::Path,
    actor: &str,
    story_id: &str,
    options: MergeOptions,
) -> anyhow::Result<MergeOutcome> {
    super::with_story_work(story_id, || {
        let mut conn = super::open_beside(db_path).map_err(anyhow::Error::msg)?;
        flywheel_core::domain::story_merge::merge_story(&mut conn, actor, story_id, options)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_crosses_as_written_and_any_other_failure_as_its_category() {
        let refused = anyhow::Error::new(MergeRefused(
            "Accept every criterion before merging.".into(),
        ));
        assert_eq!(
            merge_error(refused),
            "Accept every criterion before merging."
        );
        let git = anyhow::anyhow!("git -C \"/Users/someone/repo\" [\"merge\"] failed");
        assert_eq!(merge_error(git), "failed:story_merge:git");
    }

    #[test]
    fn a_rerun_refusal_crosses_as_written_and_any_other_failure_as_its_category() {
        let refused =
            anyhow::Error::new(ReviewRunRefused("A session of this Story is live.".into()));
        assert_eq!(rerun_error(refused), "A session of this Story is live.");
        assert_eq!(
            rerun_error(anyhow::anyhow!("git -C /Users/x failed")),
            "failed:story_checks_rerun:run"
        );
    }

    #[test]
    fn a_patch_past_the_limit_is_withheld_and_said_so() {
        let small = patch_dto("+one line\n".to_string());
        assert!(!small.too_large);
        assert_eq!(small.patch, "+one line\n");
        let large = patch_dto("x".repeat(MAX_PATCH_BYTES + 1));
        assert!(large.too_large);
        assert!(large.patch.is_empty());
    }
}
