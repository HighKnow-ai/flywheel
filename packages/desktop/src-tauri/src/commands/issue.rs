//! `issue_create` / `issue_update` / `issue_delete` — the issue mutation surface. Issues carry
//! no status parameter (D-07); every handler resolves `actor_id` server-side (T-01-04) and emits
//! `board:changed` after a successful mutation (D-04).

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

const MAX_TITLE_LEN: usize = 500;
const MAX_BODY_LEN: usize = 20_000;
const VALID_KINDS: [&str; 4] = ["bug", "idea", "question", "risk"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDto {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub task_id: Option<String>,
    pub key: String,
    pub title: String,
    pub body: Option<String>,
    pub kind: String,
}

impl From<flywheel_core::domain::issue::Issue> for IssueDto {
    fn from(issue: flywheel_core::domain::issue::Issue) -> Self {
        Self {
            id: issue.id,
            project_id: issue.project_id,
            epic_id: issue.epic_id,
            task_id: issue.task_id,
            key: issue.key,
            title: issue.title,
            body: issue.body,
            kind: issue.kind,
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

fn validate_body(body: &Option<String>) -> Result<(), String> {
    if let Some(b) = body {
        if b.len() > MAX_BODY_LEN {
            return Err(format!(
                "body must be at most {MAX_BODY_LEN} characters, got {} characters",
                b.len()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn issue_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
    kind: String,
    epic_id: Option<String>,
    task_id: Option<String>,
) -> Result<IssueDto, String> {
    let title = title.trim();
    validate_title(title)?;
    if !VALID_KINDS.contains(&kind.as_str()) {
        return Err(format!(
            "kind must be one of {VALID_KINDS:?}, got {kind:?}"
        ));
    }
    // CR-01: the wire format still sends an independent `(epic_id, task_id)` pair — converting
    // it to `IssueParent` here, before the connection is locked (mirroring how `issue_set_parent`
    // parses its own pair first), is what rejects "both supplied" instead of silently inserting
    // an issue holding both.
    let parent = flywheel_core::domain::issue::IssueParent::from_ids(
        epic_id.as_deref(),
        task_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let issue = flywheel_core::domain::issue::create_issue(
        &mut conn,
        &project_id,
        &actor_id,
        title,
        None,
        &kind,
        parent,
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: IssueDto = issue.into();
    app.emit("board:changed", serde_json::json!({ "entity": "issue", "id": dto.id }))
        .ok();
    Ok(dto)
}

#[tauri::command]
pub fn issue_update(
    state: State<AppState>,
    app: AppHandle,
    issue_id: String,
    title: Option<String>,
    body: Option<String>,
) -> Result<IssueDto, String> {
    if let Some(t) = &title {
        validate_title(t.trim())?;
    }
    validate_body(&body)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let issue = flywheel_core::domain::issue::update_issue(
        &mut conn,
        &actor_id,
        &issue_id,
        title.as_deref().map(str::trim),
        body.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: IssueDto = issue.into();
    app.emit("board:changed", serde_json::json!({ "entity": "issue", "id": dto.id }))
        .ok();
    Ok(dto)
}

#[tauri::command]
pub fn issue_delete(
    state: State<AppState>,
    app: AppHandle,
    issue_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::issue::delete_issue(&mut conn, &actor_id, &issue_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "issue", "id": issue_id }))
        .ok();
    Ok(())
}

/// Move an issue up or down by one position within the project's issues lane (`⌘↑`/`⌘↓`, D-07,
/// D-11, BOARD-05). Mirrors `commands::task::task_reorder`'s shape exactly.
#[tauri::command]
pub fn issue_reorder(
    state: State<AppState>,
    app: AppHandle,
    issue_id: String,
    direction: String,
) -> Result<(), String> {
    let direction = flywheel_core::ranking::ReorderDirection::parse(&direction)
        .map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::issue::reorder_issue(&mut conn, &actor_id, &issue_id, direction)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "issue", "id": issue_id }))
        .ok();
    Ok(())
}

/// Reparent an issue to an epic, to a task, or detach it — `parent_kind` is `None`, `"epic"` or
/// `"task"`; `parent_id` is required when `parent_kind` is `"epic"`/`"task"` (G-01-EPIC-ASSIGN).
/// Parsed with `IssueParent::parse` before the connection is locked, mirroring how
/// `issue_reorder` parses its direction first. `actor_id` is resolved server-side (T-01-04);
/// emits `board:changed` after commit (D-04).
#[tauri::command]
pub fn issue_set_parent(
    state: State<AppState>,
    app: AppHandle,
    issue_id: String,
    parent_kind: Option<String>,
    parent_id: Option<String>,
) -> Result<(), String> {
    let parent = flywheel_core::domain::issue::IssueParent::parse(
        parent_kind.as_deref(),
        parent_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::issue::set_parent(&mut conn, &actor_id, &issue_id, parent)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "issue", "id": issue_id }))
        .ok();
    Ok(())
}
