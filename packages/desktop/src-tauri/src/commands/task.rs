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

/// The session surface's title (plan 11-22, finish-review four-1): a task's key and title by id,
/// `None` when the task no longer exists. Read-only; takes an id and nothing else.
#[tauri::command]
pub fn task_header(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<flywheel_core::query::authoring::ItemHeader>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::query::authoring::task_header(&conn, &task_id).map_err(|e| e.to_string())
}

/// The same title for an authoring run, which has an epic and no task. Read-only.
#[tauri::command]
pub fn epic_header(
    state: State<AppState>,
    epic_id: String,
) -> Result<Option<flywheel_core::query::authoring::ItemHeader>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::query::authoring::epic_header(&conn, &epic_id).map_err(|e| e.to_string())
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
///
/// **D-40:** if the task has any agent-run history (`triggers`/`worktrees`/`agent_runs`/
/// `permission_requests`), `delete_task` returns `Err` naming what blocks it instead of deleting.
/// `.map_err(|e| e.to_string())` below surfaces that domain message to the renderer verbatim —
/// there is no wrapping `.context(...)` anywhere between `delete_task`'s `anyhow::bail!` and this
/// handler, so the user never sees a raw SQLite `FOREIGN KEY constraint failed` string.
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

/// Move a task up or down by one position within its priority band (`⌘↑`/`⌘↓`, D-11, BOARD-05).
/// `direction` must be `"up"` or `"down"` — parsed by `ReorderDirection::parse`, rejected
/// otherwise. `actor_id` is resolved server-side; emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_reorder(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    direction: String,
) -> Result<(), String> {
    let direction = flywheel_core::ranking::ReorderDirection::parse(&direction)
        .map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::reorder_task(&mut conn, &actor_id, &task_id, direction)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}

/// Set a task's priority (`p` then `0`-`4`, D-11). Rejected by the schema CHECK constraint if
/// `priority` is outside `0..=4` — this handler performs no application-layer range check of its
/// own. `actor_id` is resolved server-side; emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_set_priority(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    priority: i64,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::set_priority(&mut conn, &actor_id, &task_id, priority)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}

/// Set a task's estimate (`e`, D-12: nullable S/M/L). `estimate: None` clears the field.
/// Rejected by the schema CHECK constraint if outside `{1,2,3}`. `actor_id` is resolved
/// server-side; emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_set_estimate(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    estimate: Option<i64>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::set_estimate(&mut conn, &actor_id, &task_id, estimate)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}

/// Set a task's assignee (`a`, BOARD-06). `assignee_id: None` clears the field ("Unassigned").
/// An id naming no row in `actors` is rejected by the `assignee_id` foreign key (T-01-21).
/// `actor_id` is resolved server-side; emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn task_set_assignee(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    assignee_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::set_assignee(&mut conn, &actor_id, &task_id, assignee_id.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}

/// Reparent a task under an epic, or clear its epic with `epic_id: None` (G-01-EPIC-ASSIGN).
/// Performs no application-layer existence or same-project check of its own —
/// `flywheel_core::domain::task::set_epic`'s `assert_parent_in_project` and the `epic_id`
/// foreign key are the authority, exactly as `task_set_assignee` defers to the `assignee_id`
/// foreign key. `actor_id` is resolved server-side (T-01-04); emits `board:changed` after
/// commit (D-04).
#[tauri::command]
pub fn task_set_epic(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    epic_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::task::set_epic(&mut conn, &actor_id, &task_id, epic_id.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id }))
        .ok();
    Ok(())
}
