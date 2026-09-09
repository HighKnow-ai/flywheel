//! `task_create` — the tracer's one mutating command (D-09 quick-add path).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

const MAX_TITLE_LEN: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
}

impl From<flywheel_core::domain::task::Task> for TaskDto {
    fn from(task: flywheel_core::domain::task::Task) -> Self {
        Self {
            id: task.id,
            project_id: task.project_id,
            epic_id: task.epic_id,
            key: task.key,
            title: task.title,
            status: task.status,
            rank: task.rank,
            priority: task.priority,
        }
    }
}

/// Create a task at the current position (D-09: quick-add is the creation path). `actor_id` is
/// resolved inside this handler (T-01-04) — the command signature accepts no actor argument from
/// the renderer. Emits `board:changed` after the mutation commits (D-04): the renderer never
/// treats its own write as already resolved.
#[tauri::command]
pub fn task_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
    epic_id: Option<String>,
) -> Result<TaskDto, String> {
    let title = title.trim();
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        return Err(format!(
            "task title must be 1-{MAX_TITLE_LEN} characters, got {} characters",
            title.len()
        ));
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let task = flywheel_core::domain::task::create_task(
        &mut conn,
        &project_id,
        &actor_id,
        title,
        epic_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: TaskDto = task.into();
    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "task", "id": dto.id }),
    )
    .ok();

    Ok(dto)
}

const MAX_DESCRIPTION_LEN: usize = 20_000;

/// Patch a task's `title`/`description` (`None` leaves a field unchanged). `actor_id` is
/// resolved server-side (T-01-04); emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_update(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    title: Option<String>,
    description: Option<String>,
) -> Result<TaskDto, String> {
    if let Some(t) = &title {
        let trimmed = t.trim();
        if trimmed.is_empty() || trimmed.len() > MAX_TITLE_LEN {
            return Err(format!(
                "task title must be 1-{MAX_TITLE_LEN} characters, got {} characters",
                trimmed.len()
            ));
        }
    }
    if let Some(d) = &description {
        if d.len() > MAX_DESCRIPTION_LEN {
            return Err(format!(
                "description must be at most {MAX_DESCRIPTION_LEN} characters, got {} characters",
                d.len()
            ));
        }
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let task = flywheel_core::domain::task::update_task(
        &mut conn,
        &actor_id,
        &task_id,
        title.as_deref().map(str::trim),
        description.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: TaskDto = task.into();
    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": dto.id }))
        .ok();
    Ok(dto)
}

/// Delete a task (idempotent). `actor_id` is resolved server-side (T-01-04); emits
/// `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_delete(state: State<AppState>, app: AppHandle, task_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::delete_task(&mut conn, &actor_id, &task_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}

/// Set a task's workflow status. Rejected by the schema CHECK constraint if `status` is outside
/// the fixed five (BOARD-04, T-01-15) — this handler performs no application-layer allow-list of
/// its own. `actor_id` is resolved server-side; emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_set_status(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    status: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::set_task_status(&mut conn, &actor_id, &task_id, &status)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}
