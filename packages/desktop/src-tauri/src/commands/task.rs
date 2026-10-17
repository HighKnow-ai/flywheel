//! `task_add` / `task_list` / `task_set_state` — the Story checklist (docs/mvp-spec.md §4.3). A Task
//! is a step inside one Story, not a board item of its own; the developer can add and edit Tasks at
//! any time, as the Story's agent does through its board tool.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub story_id: String,
    pub title: String,
    /// `open`, `doing`, `done` or `dropped`.
    pub state: String,
    pub dropped_reason: Option<String>,
    pub rank: String,
}

impl From<flywheel_core::domain::task::Task> for TaskDto {
    fn from(t: flywheel_core::domain::task::Task) -> Self {
        Self { id: t.id, story_id: t.story_id, title: t.title, state: t.state, dropped_reason: t.dropped_reason, rank: t.rank }
    }
}

/// Add a Task at the end of a Story's checklist.
#[tauri::command]
pub fn task_add(state: State<AppState>, app: AppHandle, story_id: String, title: String) -> Result<TaskDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let task = flywheel_core::domain::task::add_task(&mut conn, &actor_id, &story_id, &title).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task.id));
    Ok(task.into())
}

/// A Story's checklist, in order.
#[tauri::command]
pub fn task_list(state: State<AppState>, story_id: String) -> Result<Vec<TaskDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tasks = flywheel_core::domain::task::tasks_for_story(&conn, &story_id).map_err(|e| e.to_string())?;
    Ok(tasks.into_iter().map(TaskDto::from).collect())
}

/// Move a Task to `open`, `doing`, `done` or `dropped` (a drop needs its one-line reason).
#[tauri::command]
pub fn task_set_state(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    to: String,
    dropped_reason: Option<String>,
) -> Result<(), String> {
    let to = flywheel_core::domain::task::TaskState::parse(&to).map_err(|e| e.to_string())?;
    if let Some(reason) = &dropped_reason {
        validate_text("droppedReason", reason, MAX_TITLE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "tasks", &task_id);
    flywheel_core::domain::task::set_task_state(&mut conn, &actor_id, &task_id, to, dropped_reason.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    Ok(())
}
