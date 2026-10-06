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
//! Both are async commands so the git call runs off the main thread, and both resolve
//! under the database lock and release it before git is spawned — a slow diff blocks no other
//! command handler.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::criterion::CriterionDto;

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
            state: state.to_string(),
            base: None,
            head: None,
            project_id: None,
            epic_id: None,
            task_id: None,
        };
        match t {
            ReviewTarget::Resolved { base, head, project_id, epic_id, task_id, .. } => Self {
                state: "resolved".to_string(),
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
    // The DB lock is held for resolution only; git runs after it is released.
    let target = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        flywheel_core::review::resolve_review_target(&conn, scope, &item_id)
            .map_err(|e| e.to_string())?
    };
    let files = flywheel_core::review::files_for_target(&target).map_err(|e| e.to_string())?;
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
    let target = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        flywheel_core::review::resolve_review_target(&conn, scope, &item_id)
            .map_err(|e| e.to_string())?
    };
    flywheel_core::review::patch_for_target(&target, &path, old_path.as_deref())
        .map_err(|e| e.to_string())
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
        Self { state: state.to_string(), commits }
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
    let (target, rows) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        flywheel_core::review::criteria_with_anchors(&conn, scope, &item_id)
            .map_err(|e| e.to_string())?
    };
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

    // Under the lock: the actor, and proof the criterion belongs to the item being reviewed.
    let target = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
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
        flywheel_core::review::resolve_review_target(&conn, scope, &item_id).map_err(|e| e.to_string())?
    };

    // The sha is derived here, from the head ref the core resolved — never taken from the caller.
    let head_sha = match (&anchor, &target) {
        (None, _) => String::new(),
        (Some(_), flywheel_core::review::ReviewTarget::Resolved { repo_path, head, .. }) => {
            let out = flywheel_core::git::git_at(
                repo_path,
                &["rev-parse", "--verify", &format!("{head}^{{commit}}")],
            )
            .map_err(|e| e.to_string())?;
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        (Some(_), _) => return Err("this item has no branch to anchor evidence against yet".to_string()),
    };

    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        check_criterion_with_anchor(&mut conn, &actor_id, &criterion_id, anchor, &head_sha)
            .map_err(|e| e.to_string())?;
    }
    app.emit("board:changed", serde_json::json!({ "entity": "criterion", "id": criterion_id }))
        .ok();
    Ok(())
}
