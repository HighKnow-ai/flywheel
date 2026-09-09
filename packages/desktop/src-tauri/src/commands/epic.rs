//! `epic_create` / `epic_update` / `epic_delete` / `epic_set_status` — the epic mutation surface.
//! Every handler resolves `actor_id` server-side (T-01-04, never from a renderer-supplied claim)
//! and emits `board:changed` after a successful mutation (D-04).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

const MAX_TITLE_LEN: usize = 500;
const MAX_DESCRIPTION_LEN: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicDto {
    pub id: String,
    pub project_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub rank: String,
    pub priority: i64,
}

impl From<flywheel_core::domain::epic::Epic> for EpicDto {
    fn from(epic: flywheel_core::domain::epic::Epic) -> Self {
        Self {
            id: epic.id,
            project_id: epic.project_id,
            key: epic.key,
            title: epic.title,
            description: epic.description,
            status: epic.status,
            rank: epic.rank,
            priority: epic.priority,
        }
    }
}

fn validate_title(title: &str) -> Result<(), String> {
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        return Err(format!(
            "title must be 1-{MAX_TITLE_LEN} characters, got {} characters",
            title.len()
        ));
    }
    Ok(())
}

fn validate_description(description: &Option<String>) -> Result<(), String> {
    if let Some(d) = description {
        if d.len() > MAX_DESCRIPTION_LEN {
            return Err(format!(
                "description must be at most {MAX_DESCRIPTION_LEN} characters, got {} characters",
                d.len()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn epic_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
) -> Result<EpicDto, String> {
    let title = title.trim();
    validate_title(title)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let epic = flywheel_core::domain::epic::create_epic(&mut conn, &project_id, &actor_id, title, None)
        .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: EpicDto = epic.into();
    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": dto.id }))
        .ok();
    Ok(dto)
}

#[tauri::command]
pub fn epic_update(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    title: Option<String>,
    description: Option<String>,
) -> Result<EpicDto, String> {
    if let Some(t) = &title {
        validate_title(t.trim())?;
    }
    validate_description(&description)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let epic = flywheel_core::domain::epic::update_epic(
        &mut conn,
        &actor_id,
        &epic_id,
        title.as_deref().map(str::trim),
        description.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: EpicDto = epic.into();
    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": dto.id }))
        .ok();
    Ok(dto)
}

#[tauri::command]
pub fn epic_delete(state: State<AppState>, app: AppHandle, epic_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::delete_epic(&mut conn, &actor_id, &epic_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}

#[tauri::command]
pub fn epic_set_status(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    status: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::set_epic_status(&mut conn, &actor_id, &epic_id, &status)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}

/// Move an epic up or down by one position within its priority band (`⌘↑`/`⌘↓`, D-11, BOARD-05).
/// Mirrors `commands::task::task_reorder`'s shape exactly.
#[tauri::command]
pub fn epic_reorder(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    direction: String,
) -> Result<(), String> {
    let direction = flywheel_core::ranking::ReorderDirection::parse(&direction)
        .map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::reorder_epic(&mut conn, &actor_id, &epic_id, direction)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}

/// Set an epic's priority — mirrors `commands::task::task_set_priority`'s shape exactly.
#[tauri::command]
pub fn epic_set_priority(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    priority: i64,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::set_priority(&mut conn, &actor_id, &epic_id, priority)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}

/// Set an epic's estimate — mirrors `commands::task::task_set_estimate`'s shape exactly.
#[tauri::command]
pub fn epic_set_estimate(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    estimate: Option<i64>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::set_estimate(&mut conn, &actor_id, &epic_id, estimate)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}

/// Set an epic's assignee — mirrors `commands::task::task_set_assignee`'s shape exactly.
#[tauri::command]
pub fn epic_set_assignee(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
    assignee_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::epic::set_assignee(&mut conn, &actor_id, &epic_id, assignee_id.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "epic", "id": epic_id }))
        .ok();
    Ok(())
}
