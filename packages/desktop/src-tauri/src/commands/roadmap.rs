//! `milestone_create` / `milestone_list` / `milestone_set_state` — the Roadmap's command surface. A
//! project's Roadmap is its Milestones in rank order (`domain::milestone`). Every handler stamps the
//! local human actor server-side (T-01-04) and emits `board:changed` after a successful mutation.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneDto {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub exit_test: Option<String>,
    /// The state with In progress derived: `shaping`, `ready`, `in_progress`, `done` or `dropped`.
    pub state: String,
    /// Whether this is the Current Milestone (the first in Roadmap order not done or dropped).
    pub current: bool,
    pub rank: String,
}

fn to_dto(
    conn: &rusqlite::Connection,
    m: flywheel_core::domain::milestone::Milestone,
    current_id: Option<&str>,
) -> Result<MilestoneDto, String> {
    let state = flywheel_core::domain::milestone::milestone_state(conn, &m.id).map_err(|e| e.to_string())?;
    Ok(MilestoneDto {
        current: current_id == Some(m.id.as_str()),
        id: m.id,
        project_id: m.project_id,
        title: m.title,
        exit_test: m.exit_test,
        state: state.as_str().to_string(),
        rank: m.rank,
    })
}

/// Add a Milestone at the end of the project's Roadmap, in Shaping.
#[tauri::command]
pub fn milestone_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
    exit_test: Option<String>,
) -> Result<MilestoneDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    if let Some(exit_test) = &exit_test {
        validate_text("exitTest", exit_test, MAX_PROSE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let m = flywheel_core::domain::milestone::create_milestone(&mut conn, &project_id, &actor_id, &title, exit_test.as_deref())
        .map_err(|e| e.to_string())?;
    let current = flywheel_core::domain::milestone::current_milestone(&conn, &project_id).map_err(|e| e.to_string())?;
    let dto = to_dto(&conn, m, current.as_ref().map(|c| c.id.as_str()))?;
    drop(conn);
    emit_board_changed(&app, Some(&project_id), "milestone", Some(&dto.id));
    Ok(dto)
}

/// The project's Roadmap: every Milestone in rank order, with its derived state.
#[tauri::command]
pub fn milestone_list(state: State<AppState>, project_id: String) -> Result<Vec<MilestoneDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current = flywheel_core::domain::milestone::current_milestone(&conn, &project_id).map_err(|e| e.to_string())?;
    let current_id = current.as_ref().map(|c| c.id.as_str());
    flywheel_core::domain::milestone::roadmap(&conn, &project_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| to_dto(&conn, m, current_id))
        .collect()
}

/// The developer moves a Milestone: `ready` closes shaping, `done` confirms the exit test,
/// `dropped` retires it, `shaping` reopens shaping. The domain refuses the rest.
#[tauri::command]
pub fn milestone_set_state(
    state: State<AppState>,
    app: AppHandle,
    milestone_id: String,
    to: String,
) -> Result<(), String> {
    let to = flywheel_core::domain::milestone::MilestoneState::parse(&to).map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::milestone::set_milestone_state(&mut conn, &actor_id, &milestone_id, to)
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "milestones", &milestone_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "milestone", Some(&milestone_id));
    Ok(())
}
