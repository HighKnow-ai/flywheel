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
