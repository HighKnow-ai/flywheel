//! `epic_create` / `epic_list` / `epic_update` / `epic_set_state` — the Epic command surface. An
//! Epic sits in one Milestone and carries a short spec (problem, scope, out of scope) and an exit
//! test (`domain::epic`). Every handler stamps the local human actor server-side (T-01-04) and
//! emits `board:changed` after a successful mutation.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicDto {
    pub id: String,
    pub project_id: String,
    pub milestone_id: String,
    pub key: String,
    pub title: String,
    pub problem: Option<String>,
    pub scope: Option<String>,
    pub out_of_scope: Option<String>,
    pub exit_test: Option<String>,
    /// The state with In progress derived: `shaping`, `ready`, `in_progress` or `done`.
    pub state: String,
    pub rank: String,
}

pub(crate) fn to_dto(
    conn: &rusqlite::Connection,
    epic: flywheel_core::domain::epic::Epic,
) -> Result<EpicDto, String> {
    let state =
        flywheel_core::domain::epic::epic_state(conn, &epic.id).map_err(|e| e.to_string())?;
    Ok(EpicDto {
        id: epic.id,
        project_id: epic.project_id,
        milestone_id: epic.milestone_id,
        key: epic.key,
        title: epic.title,
        problem: epic.spec.problem,
        scope: epic.spec.scope,
        out_of_scope: epic.spec.out_of_scope,
        exit_test: epic.spec.exit_test,
        state: state.as_str().to_string(),
        rank: epic.rank,
    })
}

/// Create an Epic at the end of `milestone_id`, in Shaping.
#[tauri::command]
pub fn epic_create(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    title: String,
) -> Result<EpicDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let epic =
        flywheel_core::domain::epic::create_epic(&mut conn, &actor_id, &milestone_id, &title)
            .map_err(|e| e.to_string())?;
    let dto = to_dto(&conn, epic)?;
    drop(conn);
    emit_board_changed(&app, Some(&dto.project_id), "epic", Some(&dto.id));
    Ok(dto)
}

/// Every Epic of a Milestone, in rank order.
#[tauri::command]
pub fn epic_list(state: State<AppState>, milestone_id: String) -> Result<Vec<EpicDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::epics_in_milestone(&conn, &milestone_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|epic| to_dto(&conn, epic))
        .collect()
}

/// Rewrite an Epic's title, spec and exit test.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn epic_update(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    title: String,
    problem: Option<String>,
    scope: Option<String>,
    out_of_scope: Option<String>,
    exit_test: Option<String>,
) -> Result<(), String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    for (field, value) in [
        ("problem", &problem),
        ("scope", &scope),
        ("outOfScope", &out_of_scope),
        ("exitTest", &exit_test),
    ] {
        if let Some(value) = value {
            validate_text(field, value, MAX_PROSE_LEN)?;
        }
    }
    let spec = flywheel_core::domain::epic::EpicSpec {
        problem,
        scope,
        out_of_scope,
        exit_test,
    };
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::update_epic(&mut conn, &actor_id, &epic_id, &title, &spec)
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "epics", &epic_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "epic", Some(&epic_id));
    Ok(())
}

/// The developer moves an Epic: `ready` closes shaping, `shaping` reopens shaping (declining the exit
/// test). `done` is refused here: confirming the exit test is `epic_confirm_done`, which starts the
/// roadmap Round (issue #134). The domain refuses the rest.
#[tauri::command]
pub fn epic_set_state(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    to: String,
) -> Result<(), String> {
    let to = flywheel_core::domain::epic::EpicState::parse(&to).map_err(|e| e.to_string())?;
    super::roadmap_round::refuse_done_without_round(to.as_str())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::set_epic_state(&mut conn, &actor_id, &epic_id, to)
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "epics", &epic_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "epic", Some(&epic_id));
    Ok(())
}
