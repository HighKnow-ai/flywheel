//! REVW-01/REVW-02's command surface (Phase 8 plan 08-01): two read-only commands, `review_files`
//! and `review_file_patch`. Both take a scope plus an id (plus a file path for the patch) and
//! nothing else: the base ref, the head ref, the repository path and every git flag are derived
//! inside `flywheel_core::review`, so no ref or filesystem path the renderer invents can reach a
//! git argv.
//!
//! Both are async commands so the git call runs off the main thread, and both resolve
//! under the database lock and release it before git is spawned — a slow diff blocks no other
//! command handler.

use serde::Serialize;
use tauri::State;

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
