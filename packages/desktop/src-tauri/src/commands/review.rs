//! REVW-01/REVW-02's command surface (Phase 8 plan 08-01): two read-only commands, `review_files`
//! and `review_file_patch`. Both take a scope plus an id (plus a file path for the patch) and
//! nothing else: the base ref, the head ref, the repository path and every git flag are derived
//! inside `flywheel_core::review`, so no ref or filesystem path the renderer invents can reach a
//! git argv.
//!
//! Plan 08-02 adds `review_criteria_state` (read) and `criterion_check_with_anchor` (write). The
//! write takes no sha: the one stored is resolved here from the review target's head ref, so no
//! renderer value can claim the evidence was read at a commit it was not (T-08-02-01).
//!
//! Plan 08-07 adds `review_merge_precheck` (read) and `review_merge_task` (the one git write,
//! REVW-04). The merge takes a task id alone; it reads the board into `MergePlanInputs` under the
//! database lock, drops it, runs `finish_plan` (the rev-list and diff) with the lock gone, takes
//! the per-epic guard only for the git work, then re-locks to record the event — never two locks
//! at once, and neither held across the emit.
//!
//! Plan 08-09 adds `review_epic_task_rollup` (read-only): an epic id in, each of the epic's tasks
//! with its current-revision criteria counted out. It takes the id and nothing else and spawns no
//! git, so it is safe under the database lock.
//!
//! Phase 8.1 plan 21 (A-08(a)) adds `review_changes_request_state` (read) and
//! `review_request_changes` (write): the review surface's decline path. The write takes a task id
//! and nothing else, so the renderer cannot author the reason the agent reads; it moves a task's
//! status by exactly one named edge and takes no status argument. That narrows the review tree's
//! old "writes no status" claim to "writes no status except this one edge" -- the merge commands'
//! own claim, further down, is unchanged. Both are thin over `flywheel_core::domain::task`.
//!
//! The review commands are async so the git call runs off the main thread. Each reads the board into
//! an opaque inputs value under the database lock (`review_target_inputs`, `criteria_with_anchors`,
//! `plan_merge_inputs`), releases the lock, and only then runs the git half
//! (`finish_review_target`, `finish_plan`), which takes no connection — a slow ancestry check or
//! diff blocks no other command handler, and holding the lock across it is not expressible.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, project_of, project_of_locked};

use super::criterion::CriterionDto;
use super::ipc_error;

use crate::state::AppState;

/// One changed file — mirrors `flywheel_core::git::ReviewFile` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFileDto {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub binary: bool,
}

impl From<flywheel_core::git::ReviewFile> for ReviewFileDto {
    fn from(f: flywheel_core::git::ReviewFile) -> Self {
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

/// The resolved scope, without the repository path (the renderer has no use for one). `state` is
/// `resolved`, `noIntegrationBranch` or `noBranch`; the other fields are populated only when
/// resolved.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTargetDto {
    pub state: String,
    /// True when the task is already integrated: the range is the merge commit against its first
    /// parent (what the merge landed), not the task branch against the target.
    pub post_merge: bool,
    pub base: Option<String>,
    pub head: Option<String>,
    pub project_id: Option<String>,
    pub epic_id: Option<String>,
    pub task_id: Option<String>,
}

impl From<flywheel_core::review::ReviewTarget> for ReviewTargetDto {
    fn from(t: flywheel_core::review::ReviewTarget) -> Self {
        use flywheel_core::review::ReviewTarget;
        let bare = |state: &str| Self {
            state: String::from(state),
            post_merge: false,
            base: None,
            head: None,
            project_id: None,
            epic_id: None,
            task_id: None,
        };
        match t {
            ReviewTarget::Resolved { base, head, project_id, epic_id, task_id, post_merge, .. } => Self {
                state: "resolved".to_string(),
                post_merge,
                base: Some(base),
                head: Some(head),
                project_id: Some(project_id),
                epic_id,
                task_id,
            },
            ReviewTarget::NoIntegrationBranch => bare("noIntegrationBranch"),
            ReviewTarget::NoBranch => bare("noBranch"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFilesDto {
    pub target: ReviewTargetDto,
    pub files: Vec<ReviewFileDto>,
}

/// The enum is the whole input-validation surface for the scope argument.
fn parse_scope(scope: &str) -> Result<flywheel_core::review::ReviewScope, String> {
    match scope {
        "task" => Ok(flywheel_core::review::ReviewScope::Task),
        "epic" => Ok(flywheel_core::review::ReviewScope::Epic),
        other => Err(format!("unknown review scope {other:?}: expected \"task\" or \"epic\"")),
    }
}

/// The changed-file list for a task or an epic, plus how the scope resolved. Read-only.
#[tauri::command(async)]
pub fn review_files(
    state: State<AppState>,
    scope: String,
    item_id: String,
) -> Result<ReviewFilesDto, String> {
    let scope = parse_scope(&scope)?;
    // The DB lock is held for the board read only; the ancestry check and the diff run after it is
    // released.
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_files:lock", e))?;
        flywheel_core::review::review_target_inputs(&conn, scope, &item_id).map_err(|e| ipc_error("review_files:resolve", e))?
    };
    let target = flywheel_core::review::finish_review_target(inputs).map_err(|e| ipc_error("review_files:finish", e))?;
    let files = flywheel_core::review::files_for_target(&target).map_err(|e| ipc_error("review_files:git", e))?;
    Ok(ReviewFilesDto {
        target: ReviewTargetDto::from(target),
        files: files.into_iter().map(ReviewFileDto::from).collect(),
    })
}

/// One file's unified patch text, or `null` when the scope does not resolve to a branch. Read-only.
#[tauri::command(async)]
pub fn review_file_patch(
    state: State<AppState>,
    scope: String,
    item_id: String,
    path: String,
    old_path: Option<String>,
) -> Result<Option<String>, String> {
    let scope = parse_scope(&scope)?;
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_file_patch:lock", e))?;
        flywheel_core::review::review_target_inputs(&conn, scope, &item_id).map_err(|e| ipc_error("review_file_patch:resolve", e))?
    };
    let target = flywheel_core::review::finish_review_target(inputs).map_err(|e| ipc_error("review_file_patch:finish", e))?;
    flywheel_core::review::patch_for_target(&target, &path, old_path.as_deref())
        .map_err(|e| ipc_error("review_file_patch:git", e))
}

/// The evidence behind a checked criterion — mirrors `CriterionAnchor`. Staleness is not here: it
/// rides next to it on [`ReviewCriterionStateDto`], derived per read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorDto {
    pub path: String,
    pub side: String,
    pub line_start: u32,
    pub line_end: u32,
    pub sha: String,
}

/// `state` is `untouched`, `changed` (with `commits`), `movedOrChanged` or `unknown`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StalenessDto {
    pub state: String,
    pub commits: Option<u32>,
}

impl From<flywheel_core::review::AnchorStaleness> for StalenessDto {
    fn from(s: flywheel_core::review::AnchorStaleness) -> Self {
        use flywheel_core::review::AnchorStaleness as S;
        let (state, commits) = match s {
            S::Untouched => ("untouched", None),
            S::Changed { commits } => ("changed", Some(commits)),
            S::MovedOrChanged => ("movedOrChanged", None),
            S::Unknown => ("unknown", None),
        };
        Self { state: String::from(state), commits }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCriterionStateDto {
    pub criterion: CriterionDto,
    pub anchor: Option<AnchorDto>,
    pub staleness: Option<StalenessDto>,
}

/// Every current criterion of a task or epic with its anchor and a staleness verdict re-derived
/// from git on this call. Read-only; the DB lock is dropped before git runs.
#[tauri::command(async)]
pub fn review_criteria_state(
    state: State<AppState>,
    scope: String,
    item_id: String,
) -> Result<Vec<ReviewCriterionStateDto>, String> {
    let scope = parse_scope(&scope)?;
    let (inputs, rows) = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_criteria_state:lock", e))?;
        flywheel_core::review::criteria_with_anchors(&conn, scope, &item_id)
            .map_err(|e| ipc_error("review_criteria_state:read", e))?
    };
    let target = flywheel_core::review::finish_review_target(inputs).map_err(|e| ipc_error("review_criteria_state:finish", e))?;
    Ok(flywheel_core::review::with_staleness(&target, rows)
        .into_iter()
        .map(|e| ReviewCriterionStateDto {
            criterion: e.criterion.into(),
            anchor: e.anchor.map(|a| AnchorDto {
                path: a.path,
                side: a.side,
                line_start: a.line_start,
                line_end: a.line_end,
                sha: a.sha,
            }),
            staleness: e.staleness.map(StalenessDto::from),
        })
        .collect())
}

/// One task of an epic with its criteria counts — mirrors `flywheel_core::review::EpicTaskCriteria`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicTaskRollupRowDto {
    pub task_id: String,
    pub key: String,
    pub title: String,
    pub status: String,
    pub checked: i64,
    pub total: i64,
    pub with_evidence: i64,
    pub without_evidence: i64,
}

impl From<flywheel_core::review::EpicTaskCriteria> for EpicTaskRollupRowDto {
    fn from(t: flywheel_core::review::EpicTaskCriteria) -> Self {
        Self {
            task_id: t.task_id,
            key: t.key,
            title: t.title,
            status: t.status,
            checked: t.checked,
            total: t.total,
            with_evidence: t.with_evidence,
            without_evidence: t.without_evidence,
        }
    }
}

/// Each task of an epic with its current-revision criteria counted (D-132). Read-only. There is
/// deliberately no `scope` parameter: the roll-up is epic-only by construction, so the renderer
/// supplies one id and nothing else (D-118, D-139).
#[tauri::command(async)]
pub fn review_epic_task_rollup(state: State<AppState>, epic_id: String) -> Result<Vec<EpicTaskRollupRowDto>, String> {
    let rows = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_epic_task_rollup:lock", e))?;
        flywheel_core::review::epic_task_rollup(&conn, &epic_id).map_err(|e| ipc_error("review_epic_task_rollup:read", e))?
    };
    Ok(rows.into_iter().map(EpicTaskRollupRowDto::from).collect())
}

/// Check a criterion, optionally against a line range of the diff. There is deliberately no sha
/// parameter: the stored sha is the review target's head ref resolved here, which is what makes a
/// renderer-supplied sha impossible rather than merely discouraged (T-08-02-01). The four anchor
/// fields travel together; a partial set is refused rather than silently checking with no evidence.
#[tauri::command(async)]
pub fn criterion_check_with_anchor(
    state: State<AppState>,
    app: AppHandle,
    scope: String,
    item_id: String,
    criterion_id: String,
    path: Option<String>,
    side: Option<String>,
    line_start: Option<u32>,
    line_end: Option<u32>,
) -> Result<(), String> {
    use flywheel_core::domain::acceptance_criterion::{check_criterion_with_anchor, AnchorInput};

    let scope = parse_scope(&scope)?;
    let anchor = match (path, side, line_start, line_end) {
        (Some(path), Some(side), Some(line_start), Some(line_end)) => {
            Some(AnchorInput { path, side, line_start, line_end })
        }
        (None, None, None, None) => None,
        _ => return Err("an anchor needs path, side, line_start and line_end together".to_string()),
    };

    // Under the lock: proof the criterion belongs to the item being reviewed, and the target's board
    // read. The ancestry check runs after the lock is released.
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("criterion_check_with_anchor:lock", e))?;
        let parent: Option<(String, String)> = conn
            .query_row(
                "SELECT parent_type, parent_id FROM acceptance_criteria WHERE id = ?1",
                [&criterion_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let expected = if scope == flywheel_core::review::ReviewScope::Task { "task" } else { "epic" };
        if parent.as_ref().map(|(t, id)| (t.as_str(), id.as_str())) != Some((expected, item_id.as_str())) {
            return Err(format!("criterion {criterion_id:?} does not belong to {expected} {item_id:?}"));
        }
        flywheel_core::review::review_target_inputs(&conn, scope, &item_id).map_err(|e| ipc_error("criterion_check_with_anchor:resolve", e))?
    };
    let target = flywheel_core::review::finish_review_target(inputs).map_err(|e| ipc_error("criterion_check_with_anchor:finish", e))?;

    // The sha is derived here, from the head ref the core resolved — never taken from the caller.
    let head_sha = match (&anchor, &target) {
        (None, _) => String::new(),
        (Some(_), flywheel_core::review::ReviewTarget::Resolved { repo_path, head, .. }) => {
            let out = flywheel_core::git::git_at(
                repo_path,
                &["rev-parse", "--verify", &format!("{head}^{{commit}}")],
            )
            .map_err(|e| ipc_error("criterion_check_with_anchor:revParse", e))?;
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        (Some(_), _) => return Err("this item has no branch to anchor evidence against yet".to_string()),
    };

    {
        let mut conn = state.db.lock().map_err(|e| ipc_error("criterion_check_with_anchor:lockWrite", e))?;
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| ipc_error("criterion_check_with_anchor:actor", e))?;
        check_criterion_with_anchor(&mut conn, &actor_id, &criterion_id, anchor, &head_sha)
            .map_err(|e| ipc_error("criterion_check_with_anchor:write", e))?;
    }
    let project_id = project_of_locked(&state.db, "acceptance_criteria", &criterion_id);
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(&criterion_id));
    Ok(())
}

/// What a merge would do, from the side-effect-free dry run. `ready` carries the figures the
/// confirm sheet prints; `refused` carries a named category (`noBranch`, `noEpic`,
/// `noIntegrationBranch`, `nothingToMerge`) instead of a sentence, because the surface needs to
/// say why the action is unavailable in its own words.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state")]
pub enum MergePreviewDto {
    #[serde(rename = "ready", rename_all = "camelCase")]
    Ready {
        epic_key: String,
        source_branch: String,
        target_branch: String,
        commit_count: u32,
        file_count: u32,
        /// Empty when the dry run found no conflicts.
        conflicted_files: Vec<String>,
    },
    #[serde(rename = "refused")]
    Refused { category: String },
}

/// The three outcomes the core can prove. Conflicted paths cross the boundary as values; raw git
/// output never does.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum MergeOutcomeDto {
    #[serde(rename = "merged", rename_all = "camelCase")]
    Merged { epic_key: String, target_branch: String, merge_commit: String },
    #[serde(rename = "alreadyIntegrated")]
    AlreadyIntegrated,
    #[serde(rename = "conflicted")]
    Conflicted { files: Vec<String> },
}

/// Preview a task's merge into its epic's integration branch. Read-only: no worktree is touched
/// and nothing is written. A refusal from the plan is a preview, not an error.
#[tauri::command(async)]
pub fn review_merge_precheck(
    state: State<AppState>,
    task_id: String,
) -> Result<MergePreviewDto, String> {
    use flywheel_core::git::MergePrecheck;
    use flywheel_core::merge::{finish_plan, plan_merge_inputs, MergeRefusal};

    // The lock covers the board read only; the rev-list and diff in `finish_plan` run after it is
    // gone. A refusal can come from either half and is a preview, not an error.
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_merge_precheck:lock", e))?;
        plan_merge_inputs(&conn, &task_id)
    };
    let planned = inputs.and_then(finish_plan);
    let plan = match planned {
        Ok(plan) => plan,
        Err(e) => {
            return match e.downcast_ref::<MergeRefusal>() {
                Some(refusal) => Ok(MergePreviewDto::Refused { category: refusal.category().to_string() }),
                None => Err(ipc_error("review_merge_precheck:plan", e)),
            }
        }
    };
    let conflicted_files =
        match flywheel_core::git::merge_tree_check(&plan.repo_path, &plan.target_branch, &plan.source_branch)
            .map_err(|e| ipc_error("review_merge_precheck:dryRun", e))?
        {
            MergePrecheck::Clean => Vec::new(),
            MergePrecheck::Conflicts(files) => files,
        };
    Ok(MergePreviewDto::Ready {
        epic_key: plan.epic_key,
        source_branch: plan.source_branch,
        target_branch: plan.target_branch,
        commit_count: plan.commit_count,
        file_count: plan.file_count,
        conflicted_files,
    })
}

/// Merge a task's branch into its epic's integration branch. Takes a task id and nothing else:
/// branches, counts and paths are all derived by the plan, so the previewed figures and the merged
/// figures are the same figures. Pushes nothing and writes no status column.
///
/// Errors are `"<category>[:<detail>]"`: `refused:<category>`, `mergeInFlight:<epic key>`,
/// `mergeFailed` (raw cause logged, never returned) and `eventNotRecorded` (the merge landed in git
/// but the board event did not write).
#[tauri::command(async)]
pub fn review_merge_task(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
) -> Result<MergeOutcomeDto, String> {
    use flywheel_core::merge::{self, MergeOutcome, MergeRefusal};

    // Board read under the lock, then the lock is gone before any git runs. A refusal can come
    // from either half.
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("review_merge_task:lock", e))?;
        merge::plan_merge_inputs(&conn, &task_id)
    };
    let plan = match inputs.and_then(merge::finish_plan) {
        Ok(plan) => plan,
        Err(e) => {
            return Err(match e.downcast_ref::<MergeRefusal>() {
                Some(refusal) => format!("refused:{}", refusal.category()),
                None => ipc_error("review_merge_task:plan", e),
            })
        }
    };

    // The epic guard is held across the git work only: never while the database lock is held, and
    // released before the event is recorded and the notification is emitted.
    let ran = {
        let Some(_guard) = merge::try_lock_epic(&plan.epic_id) else {
            return Err(format!("mergeInFlight:{}", plan.epic_key));
        };
        merge::run_merge(&plan)
    };
    let outcome = match ran {
        Ok(outcome) => outcome,
        Err(e) => {
            eprintln!("merge of task {task_id} into {} failed: {e:#}", plan.target_branch);
            return Err("mergeFailed".to_string());
        }
    };

    let mut conn = state.db.lock().map_err(|e| ipc_error("review_merge_task:relock", e))?;
    let recorded = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .and_then(|actor_id| merge::record_merge_event(&mut conn, &plan, &outcome, &actor_id));
    let project_id = project_of(&conn, "tasks", &task_id);
    drop(conn);
    if let Err(e) = recorded {
        eprintln!("merge of task {task_id} ({outcome:?}) was not recorded on the board: {e:#}");
        // A conflict landed nothing, so its outcome stands; a landed merge without its event
        // would not show as integrated, and the sheet must say exactly that.
        if matches!(outcome, MergeOutcome::Merged { .. }) {
            emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
            return Err("eventNotRecorded".to_string());
        }
    }

    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    Ok(match outcome {
        MergeOutcome::Merged { merge_commit } => MergeOutcomeDto::Merged {
            epic_key: plan.epic_key,
            target_branch: plan.target_branch,
            merge_commit,
        },
        MergeOutcome::AlreadyIntegrated => MergeOutcomeDto::AlreadyIntegrated,
        MergeOutcome::Conflicted { files } => MergeOutcomeDto::Conflicted { files },
    })
}

/// What the review surface may offer for a task right now (A-08(a)). `ready` and `sentBack` carry
/// the number of unchecked criteria a decline sends (or has sent); `refused` carries a named
/// category (`notInFlight`, `integrated`, `noCriteria`, `nothingUnchecked`) the surface speaks in
/// its own words.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state")]
pub enum ChangesRequestStateDto {
    #[serde(rename = "ready", rename_all = "camelCase")]
    Ready { unchecked_count: usize },
    #[serde(rename = "sentBack", rename_all = "camelCase")]
    SentBack { unchecked_count: usize },
    #[serde(rename = "refused")]
    Refused { category: String },
}

/// Map the core's state onto the wire shape. Pure, so it is testable without a `State` extractor.
pub(crate) fn changes_request_state_dto(
    state: flywheel_core::domain::task::ChangesRequestState,
) -> ChangesRequestStateDto {
    use flywheel_core::domain::task::ChangesRequestState as S;
    match state {
        S::Ready(unchecked) => ChangesRequestStateDto::Ready { unchecked_count: unchecked.len() },
        S::SentBack(unchecked) => ChangesRequestStateDto::SentBack { unchecked_count: unchecked.len() },
        S::Refused(why) => ChangesRequestStateDto::Refused { category: why.category().to_string() },
    }
}

/// Map the core's outcome onto the command's result: a count, or the packed error
/// `refused:<category>` / `failed:<context>`. Raw error text never crosses (`ipc_error`).
pub(crate) fn request_changes_result(
    outcome: anyhow::Result<flywheel_core::domain::task::ChangesRequestOutcome>,
) -> Result<usize, String> {
    use flywheel_core::domain::task::ChangesRequestOutcome as O;
    match outcome {
        Ok(O::Requested { count }) => Ok(count),
        Ok(O::AlreadySentBack) => Err("refused:alreadySentBack".to_string()),
        Ok(O::Refused(why)) => Err(format!("refused:{}", why.category())),
        Err(e) => Err(ipc_error("review_request_changes:write", e)),
    }
}

/// What the review surface may offer for a task: ready, already sent back, or refused with a named
/// category (A-08(a)). Read-only. Spawns no git, so holding the database lock for the whole call
/// is safe.
#[tauri::command]
pub fn review_changes_request_state(
    state: State<AppState>,
    task_id: String,
) -> Result<ChangesRequestStateDto, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("review_changes_request_state:lock", e))?;
    flywheel_core::domain::task::changes_request_state(&conn, &task_id)
        .map(changes_request_state_dto)
        .map_err(|e| ipc_error("review_changes_request_state:read", e))
}

/// Send a task back to its agent with its unchecked criteria as the reason (A-08(a)). Takes a task
/// id and nothing else: the reason is derived in the core from the board, so the renderer cannot
/// author the text the agent reads. This command moves a task's status by exactly one named edge
/// (to `in_progress`) and takes no status argument; that narrows the review tree's old "writes no
/// status" claim, while the merge command's own "writes no status column" stays true. It issues no
/// SQL of its own. Resolves the actor server-side and emits `board:changed` after the lock is
/// released. Errors are `refused:<category>` (a core refusal, or `alreadySentBack`) or
/// `failed:<context>`.
#[tauri::command]
pub fn review_request_changes(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
) -> Result<usize, String> {
    let mut conn = state.db.lock().map_err(|e| ipc_error("review_request_changes:lock", e))?;
    let outcome = flywheel_core::domain::actor::local_human_actor_id(&conn).and_then(|actor_id| {
        flywheel_core::domain::task::request_changes(&mut conn, &actor_id, &task_id)
    });
    let project_id = project_of(&conn, "tasks", &task_id);
    drop(conn);
    let result = request_changes_result(outcome);
    if result.is_ok() {
        emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use flywheel_core::domain::task::{
        ChangesRequestOutcome, ChangesRequestRefusal, ChangesRequestState, UncheckedCriterion,
    };

    fn two() -> Vec<UncheckedCriterion> {
        vec![
            UncheckedCriterion { id: "a".into(), statement: "First".into() },
            UncheckedCriterion { id: "b".into(), statement: "Second".into() },
        ]
    }

    #[test]
    fn changes_request_state_maps_ready_and_sent_back_with_the_unchecked_count() {
        let ready = serde_json::to_value(changes_request_state_dto(ChangesRequestState::Ready(two()))).unwrap();
        assert_eq!(ready, serde_json::json!({ "state": "ready", "uncheckedCount": 2 }));
        let sent = serde_json::to_value(changes_request_state_dto(ChangesRequestState::SentBack(two()))).unwrap();
        assert_eq!(sent, serde_json::json!({ "state": "sentBack", "uncheckedCount": 2 }));
    }

    #[test]
    fn changes_request_state_maps_each_refusal_to_its_camel_case_category() {
        for (why, want) in [
            (ChangesRequestRefusal::NotInFlight, "notInFlight"),
            (ChangesRequestRefusal::Integrated, "integrated"),
            (ChangesRequestRefusal::NoCriteria, "noCriteria"),
            (ChangesRequestRefusal::NothingUnchecked, "nothingUnchecked"),
        ] {
            let v = serde_json::to_value(changes_request_state_dto(ChangesRequestState::Refused(why))).unwrap();
            assert_eq!(v, serde_json::json!({ "state": "refused", "category": want }));
        }
    }

    #[test]
    fn changes_request_write_maps_a_requested_outcome_to_its_count() {
        assert_eq!(request_changes_result(Ok(ChangesRequestOutcome::Requested { count: 3 })), Ok(3));
    }

    #[test]
    fn changes_request_write_packs_refusals_as_refused_category() {
        assert_eq!(
            request_changes_result(Ok(ChangesRequestOutcome::Refused(ChangesRequestRefusal::NoCriteria))),
            Err("refused:noCriteria".to_string())
        );
        assert_eq!(
            request_changes_result(Ok(ChangesRequestOutcome::AlreadySentBack)),
            Err("refused:alreadySentBack".to_string())
        );
    }

    #[test]
    fn changes_request_write_never_returns_raw_error_text() {
        let err = request_changes_result(Err(anyhow::anyhow!("no such file /Users/someone/secret.db")))
            .unwrap_err();
        assert_eq!(err, "failed:review_request_changes:write");
        assert!(!err.contains("/Users"));
    }
}
