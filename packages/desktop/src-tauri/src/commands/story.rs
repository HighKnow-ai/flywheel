//! `story_create` / `story_list` / `story_get` / `story_update` / `story_set_state` — the Story
//! command surface. A Story sits in one Epic and is the unit an agent executes in its own worktree
//! (`domain::story`). Every handler stamps the local human actor server-side (T-01-04), so every
//! transition reached from here is the developer's act; the hand-off is the session's, never an IPC
//! command's.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryDto {
    pub id: String,
    pub project_id: String,
    pub epic_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    /// `shaping`, `ready`, `running`, `in_review`, `merged` or `dropped`.
    pub state: String,
    pub runs_after_story_id: Option<String>,
    pub rank: String,
}

impl From<flywheel_core::domain::story::Story> for StoryDto {
    fn from(s: flywheel_core::domain::story::Story) -> Self {
        Self {
            id: s.id,
            project_id: s.project_id,
            epic_id: s.epic_id,
            key: s.key,
            title: s.title,
            description: s.description,
            state: s.state,
            runs_after_story_id: s.runs_after_story_id,
            rank: s.rank,
        }
    }
}

/// Create a Story at the end of `epic_id`'s execution order, in Shaping.
#[tauri::command]
pub fn story_create(state: State<AppState>, app: AppHandle, epic_id: String, title: String) -> Result<StoryDto, String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let story = flywheel_core::domain::story::create_story(&mut conn, &actor_id, &epic_id, &title)
        .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, Some(&story.project_id), "story", Some(&story.id));
    Ok(story.into())
}

/// Every Story of an Epic, in execution order.
#[tauri::command]
pub fn story_list(state: State<AppState>, epic_id: String) -> Result<Vec<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let stories = flywheel_core::domain::story::stories_in_epic(&conn, &epic_id).map_err(|e| e.to_string())?;
    Ok(stories.into_iter().map(StoryDto::from).collect())
}

/// One Story, or `null` when it does not exist.
#[tauri::command]
pub fn story_get(state: State<AppState>, story_id: String) -> Result<Option<StoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let story = flywheel_core::domain::story::get_story(&conn, &story_id).map_err(|e| e.to_string())?;
    Ok(story.map(StoryDto::from))
}

/// Rewrite a Story's title and description.
#[tauri::command]
pub fn story_update(
    state: State<AppState>,
    app: AppHandle,
    story_id: String,
    title: String,
    description: Option<String>,
) -> Result<(), String> {
    validate_text("title", &title, MAX_TITLE_LEN)?;
    if let Some(description) = &description {
        validate_text("description", description, MAX_PROSE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::update_story(&mut conn, &actor_id, &story_id, &title, description.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}

/// The developer moves a Story along the spec's transition table (starting it, requesting changes,
/// merging, dropping). The domain refuses any move outside the table.
#[tauri::command]
pub fn story_set_state(state: State<AppState>, app: AppHandle, story_id: String, to: String) -> Result<(), String> {
    let to = flywheel_core::domain::story::StoryState::parse(&to).map_err(|e| e.to_string())?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::story::set_story_state(&mut conn, &actor_id, &story_id, to).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "stories", &story_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(())
}
