//! `task_add` / `task_list` / `task_set_state` / `task_rename` / `task_set_note` / `task_move` — the Story checklist
//! (docs/mvp-spec.md §4.3). A Task is a step inside one Story, not a board item of its own; the
//! developer can add, edit, reorder and drop Tasks at any time, and the Story's agent writes them
//! through its board tool ([`handle_inbound_board_tool_request`], issue #52).

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
    /// What the agent (or the developer) wrote down while working the Task; `None` when empty.
    pub note: Option<String>,
}

impl From<flywheel_core::domain::task::Task> for TaskDto {
    fn from(t: flywheel_core::domain::task::Task) -> Self {
        Self {
            id: t.id,
            story_id: t.story_id,
            title: t.title,
            state: t.state,
            dropped_reason: t.dropped_reason,
            rank: t.rank,
            note: t.note,
        }
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

/// Give a Task a new title.
#[tauri::command]
pub fn task_rename(state: State<AppState>, app: AppHandle, task_id: String, title: String) -> Result<(), String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "tasks", &task_id);
    flywheel_core::domain::task::rename_task(&mut conn, &actor_id, &task_id, &title).map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    Ok(())
}

/// Replace a Task's note (issue #96). A blank note clears it.
#[tauri::command]
pub fn task_set_note(state: State<AppState>, app: AppHandle, task_id: String, note: String) -> Result<(), String> {
    if note.chars().count() > flywheel_core::domain::task::MAX_TASK_NOTE_LEN {
        return Err(format!("note is at most {} characters", flywheel_core::domain::task::MAX_TASK_NOTE_LEN));
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "tasks", &task_id);
    flywheel_core::domain::task::set_task_note(&mut conn, &actor_id, &task_id, &note).map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    Ok(())
}

/// Move a Task just before `before_task_id` in its Story's checklist, or to the end when that is
/// absent.
#[tauri::command]
pub fn task_move(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    before_task_id: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "tasks", &task_id);
    flywheel_core::domain::task::move_task(&mut conn, &actor_id, &task_id, before_task_id.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "task", Some(&task_id));
    Ok(())
}

/// The core's answer to one Task tool call, as the sidecar's `board_tool_answer` op carries it:
/// `{result}` with the checklist, or `{error}` with the reason the core refused. Also returns the
/// project whose board changed, when the call wrote something.
pub fn answer_task_tool_call(
    conn: &mut rusqlite::Connection,
    run_id: &str,
    tool: &str,
    args: &serde_json::Value,
) -> (serde_json::Value, Option<String>) {
    use flywheel_core::domain::task_tool::{apply_task_tool_call, tasks_as_tool_result, TaskToolCall};
    let outcome = TaskToolCall::parse(tool, args)
        .and_then(|call| apply_task_tool_call(conn, run_id, &call).map(|outcome| (call, outcome)));
    match outcome {
        Ok((call, outcome)) => {
            let changed = (call != TaskToolCall::List).then_some(outcome.project_id);
            (serde_json::json!({ "result": tasks_as_tool_result(&outcome.tasks) }), changed)
        }
        // The reason goes to the agent so it can correct its call. A core refusal names a Task
        // state rule or a Task id, never a path.
        Err(e) => (serde_json::json!({ "error": format!("{e:#}") }), None),
    }
}

/// The Tauri-facing half of the board tools (issues #52, #53), called from `sidecar.rs`'s reader
/// loop for every `board_tool_request` event: run the call through the core, answer the held call
/// over the sidecar's stdin, and emit `board:changed` when the board changed. A hand-off or a Check
/// run takes minutes, so it goes to its own thread ([`super::handoff`]) and never holds the reader
/// loop. Must never panic: a malformed event or a poisoned lock is a silent no-op, and the agent's
/// call then ends with its session.
pub fn handle_inbound_board_tool_request(app: &AppHandle, event: &serde_json::Value) {
    let (Some(run_id), Some(request_id), Some(tool)) = (
        event.get("runId").and_then(|v| v.as_str()),
        event.get("requestId").and_then(|v| v.as_str()),
        event.get("tool").and_then(|v| v.as_str()),
    ) else {
        return;
    };
    let args = event.get("args").cloned().unwrap_or(serde_json::Value::Null);
    if flywheel_core::domain::handoff::HANDOFF_TOOL_NAMES.contains(&tool) {
        super::handoff::spawn_handoff_tool_call(app.clone(), run_id.to_string(), request_id.to_string(), tool.to_string(), args);
        return;
    }
    // Issue #123: a shaping session's `round_post` is held until its Round is answered.
    if flywheel_core::domain::shaping_tool::SHAPING_TOOL_NAMES.contains(&tool) {
        super::shaping::handle_shaping_tool_request(app, run_id, request_id, tool, &args);
        return;
    }
    let Some(state) = tauri::Manager::try_state::<AppState>(app) else { return };
    let (answer, changed) = {
        let Ok(mut conn) = state.db.lock() else { return };
        answer_task_tool_call(&mut conn, run_id, tool, &args)
    };
    send_board_tool_answer(app, run_id, request_id, &answer);
    if let Some(project_id) = changed {
        emit_board_changed(app, Some(&project_id), "task", None);
    }
}

/// Settle one held board tool call: `answer` is `{result}` or `{error}`, sent over the sidecar's
/// stdin as its `board_tool_answer` op.
pub(crate) fn send_board_tool_answer(app: &AppHandle, run_id: &str, request_id: &str, answer: &serde_json::Value) {
    let Some(state) = tauri::Manager::try_state::<AppState>(app) else { return };
    let Some(sidecar) = state.sidecar.as_ref() else { return };
    let mut request = serde_json::json!({
        "id": format!("board-tool-answer-{request_id}"),
        "op": "board_tool_answer",
        "runId": run_id,
        "requestId": request_id,
    });
    if let (Some(request), Some(answer)) = (request.as_object_mut(), answer.as_object()) {
        request.extend(answer.clone());
    }
    let _ = sidecar.send_request(&request.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use flywheel_core::domain::{actor, epic, milestone, project, story};
    use serde_json::json;

    /// A migrated scratch database with one Story and one running session row on it.
    fn live_session() -> (rusqlite::Connection, String, String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mut conn =
            flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups")).unwrap();
        let human = actor::local_human_actor_id(&conn).unwrap();
        let p = project::create_project(&mut conn, &human, "P", "/repo", "FLY", "main").unwrap();
        let m = milestone::create_milestone(&mut conn, &p.id, &human, "M", None).unwrap();
        let e = epic::create_epic(&mut conn, &human, &m.id, "E").unwrap();
        let s = story::create_story(&mut conn, &human, &e.id, "S").unwrap();
        let run_id = flywheel_core::ids::new_id();
        conn.execute(
            "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
             VALUES (?1, ?2, ?3, ?4, 'running', 'acceptEdits', 'log', '2026-01-01T00:00:00Z')",
            rusqlite::params![run_id, s.id, p.id, human],
        )
        .unwrap();
        (conn, run_id, p.id, dir)
    }

    #[test]
    fn a_write_answers_with_the_checklist_and_names_the_changed_project() {
        let (mut conn, run_id, project_id, _dir) = live_session();
        let (answer, changed) = answer_task_tool_call(&mut conn, &run_id, "task_add", &json!({ "titles": ["A"] }));
        assert_eq!(changed.as_deref(), Some(project_id.as_str()));
        let tasks = answer["result"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "A");
        assert_eq!(tasks[0]["state"], "open");

        let (answer, changed) = answer_task_tool_call(&mut conn, &run_id, "task_list", &json!({}));
        assert_eq!(changed, None, "a read changes nothing on the board");
        assert_eq!(answer["result"]["tasks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_refusal_answers_with_the_reason_and_changes_nothing() {
        let (mut conn, run_id, _project_id, _dir) = live_session();
        let (answer, _) = answer_task_tool_call(&mut conn, &run_id, "task_add", &json!({ "titles": ["A", "B"] }));
        let ids: Vec<String> = answer["result"]["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["task_id"].as_str().unwrap().to_string())
            .collect();
        answer_task_tool_call(&mut conn, &run_id, "task_update", &json!({ "task_id": ids[0], "state": "doing" }));

        let (answer, changed) =
            answer_task_tool_call(&mut conn, &run_id, "task_update", &json!({ "task_id": ids[1], "state": "doing" }));
        assert!(answer["error"].as_str().unwrap().contains("at most one"), "{answer}");
        assert!(answer.get("result").is_none());
        assert_eq!(changed, None);

        let (answer, _) =
            answer_task_tool_call(&mut conn, &run_id, "task_update", &json!({ "task_id": ids[1], "state": "dropped" }));
        assert!(answer["error"].as_str().unwrap().contains("reason"), "{answer}");

        let (answer, _) = answer_task_tool_call(&mut conn, "01NOSUCHSESSION00000000000", "task_list", &json!({}));
        assert!(answer["error"].as_str().is_some());
    }
}
