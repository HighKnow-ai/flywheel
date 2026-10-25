//! The Acceptance criterion and Check command surface: `criterion_create` / `criterion_list` /
//! `criterion_amend` / `criterion_accept` / `criterion_unaccept` / `criterion_delete`, and
//! `check_set` / `check_remove`. A criterion is anchored to exactly one Story; acceptance and every
//! Check edit are human-only, and the actor is always the local human resolved here (T-01-04), so
//! no renderer claim can stand in for one.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN};
use crate::state::AppState;

/// The longest Check command accepted over IPC.
pub(super) const MAX_CHECK_COMMAND_LEN: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckDto {
    pub id: String,
    pub command: String,
    pub timeout_secs: i64,
    /// `not_run`, `passed`, `failed` or `timed_out`.
    pub result: String,
    /// The commit the current result ran against; `null` when not run.
    pub commit_sha: Option<String>,
    /// Whether the branch has moved since the current result ran (docs/mvp-spec.md §4.4).
    pub stale: bool,
    /// The tail of what the current run printed; `null` when not run.
    pub output_tail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterionDto {
    pub id: String,
    pub story_id: String,
    pub statement: String,
    pub accepted: bool,
    pub accepted_at: Option<String>,
    pub rank: String,
    /// The criterion's Check; `null` means it is judged at review.
    pub check: Option<CheckDto>,
}

/// The head of `story_id`'s branch, read once per listing to tell stale results; `None` when it
/// can't be read. The lock is held only to find the worktree: git reads its head without it
/// (issue #215).
fn branch_head(db: &std::sync::Mutex<rusqlite::Connection>, story_id: &str) -> Result<Option<String>, String> {
    let worktree_path = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        flywheel_core::domain::worktree::worktree_for_story(&conn, story_id).ok().flatten().map(|w| w.path)
    };
    Ok(worktree_path
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
        .and_then(|path| flywheel_core::domain::check::worktree_head(&path).ok()))
}

fn to_dto(
    conn: &rusqlite::Connection,
    c: flywheel_core::domain::acceptance_criterion::AcceptanceCriterion,
    head: Option<&str>,
) -> Result<AcceptanceCriterionDto, String> {
    let check = match flywheel_core::domain::check::check_for_criterion(conn, &c.id).map_err(|e| e.to_string())? {
        Some(check) => {
            let current = flywheel_core::domain::check::current_result(conn, &check.id).map_err(|e| e.to_string())?;
            Some(CheckDto {
                id: check.id,
                command: check.command,
                timeout_secs: check.timeout_secs,
                result: current.result.as_str().to_string(),
                stale: current.is_stale(head),
                commit_sha: current.commit_sha,
                output_tail: current.output_tail,
            })
        }
        None => None,
    };
    Ok(AcceptanceCriterionDto {
        id: c.id,
        story_id: c.story_id,
        statement: c.statement,
        accepted: c.accepted_by.is_some(),
        accepted_at: c.accepted_at,
        rank: c.rank,
        check,
    })
}

/// Run one human mutation on `criterion_id` and emit `board:changed` for its project.
fn mutate(
    state: &State<AppState>,
    app: &AppHandle,
    criterion_id: &str,
    write: impl FnOnce(&mut rusqlite::Connection, &str) -> anyhow::Result<()>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "acceptance_criteria", criterion_id);
    write(&mut conn, &actor_id).map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(app, project_id.as_deref(), "criterion", Some(criterion_id));
    Ok(())
}

/// Add a criterion at the end of `story_id`'s list.
#[tauri::command]
pub fn criterion_create(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
    statement: String,
) -> Result<AcceptanceCriterionDto, String> {
    validate_text("statement", &statement, MAX_PROSE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let c = flywheel_core::domain::acceptance_criterion::create_criterion(&mut conn, &actor_id, &story_id, &statement)
        .map_err(|e| e.to_string())?;
    let dto = to_dto(&conn, c, None)?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "criterion", Some(&dto.id));
    Ok(dto)
}

/// A Story's criteria, in order, each with its Check and current result.
#[tauri::command]
pub fn criterion_list(state: State<AppState>, story_id: String) -> Result<Vec<AcceptanceCriterionDto>, String> {
    let head = branch_head(&state.db, &story_id)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::acceptance_criterion::criteria_for_story(&conn, &story_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| to_dto(&conn, c, head.as_deref()))
        .collect()
}

/// Rewrite a criterion's statement (clears an acceptance already recorded).
#[tauri::command]
pub fn criterion_amend(state: State<AppState>, app: AppHandle, criterion_id: String, statement: String) -> Result<(), String> {
    validate_text("statement", &statement, MAX_PROSE_LEN)?;
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::acceptance_criterion::amend_criterion(conn, actor, &criterion_id, &statement)
    })
}

/// Accept a criterion at review. Human-only, enforced by the domain writer.
#[tauri::command]
pub fn criterion_accept(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::acceptance_criterion::accept_criterion(conn, actor, &criterion_id)
    })
}

/// Withdraw a criterion's acceptance. Human-only, enforced by the domain writer.
#[tauri::command]
pub fn criterion_unaccept(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::acceptance_criterion::unaccept_criterion(conn, actor, &criterion_id)
    })
}

/// Delete a criterion and its Check.
#[tauri::command]
pub fn criterion_delete(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::acceptance_criterion::delete_criterion(conn, actor, &criterion_id)
    })
}

/// Attach or replace the Check on a criterion. Human-only; replacing it resets its result.
#[tauri::command]
pub fn check_set(
    state: State<AppState>,
    app: AppHandle,
    criterion_id: String,
    command: String,
    timeout_secs: Option<i64>,
) -> Result<(), String> {
    validate_text("command", &command, MAX_CHECK_COMMAND_LEN)?;
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::check::set_check(conn, actor, &criterion_id, &command, timeout_secs).map(|_| ())
    })
}

/// Remove the Check from a criterion, which is then judged at review. Human-only.
#[tauri::command]
pub fn check_remove(state: State<AppState>, app: AppHandle, criterion_id: String) -> Result<(), String> {
    mutate(&state, &app, &criterion_id, |conn, actor| {
        flywheel_core::domain::check::remove_check(conn, actor, &criterion_id)
    })
}
