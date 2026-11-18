//! The landing commands (ADR 0042, issue #1757):
//!
//! - `project_landing_get` / `project_landing_set`: a project's landing mode, command, forge and
//!   auto-merge method. The forge the remote's URL names is read too, so the dialog can say what
//!   "detect" resolves to.
//! - `story_landing`: the request a Landing Story waits for, or the note a closed request left on an
//!   In review one.
//! - `story_landing_refresh`: "Check now", the cold tick's question for one Story, asked at once.
//!
//! Merge itself is `review::story_merge`. The refresh runs the forge CLI, so it runs on the blocking
//! pool over a connection of its own and holds the Story's work lock, never the shared board mutex.

use flywheel_core::domain::landing::{
    landing_for_story, read_settings, refresh_landing, set_settings, LandingMode, LandingSettings,
    StoryLanding,
};
use flywheel_core::forge::{detect_forge, Forge, ForgeCli};
use serde::Serialize;
use tauri::State;

use super::{emit_board_changed, ipc_error};
use crate::state::AppState;
use crate::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLandingDto {
    /// `pull_request` or `command`.
    pub mode: String,
    pub command: Option<String>,
    /// The forge the developer named, `github` or `gitlab`; `None` means "detect".
    pub forge: Option<String>,
    /// `squash`, `merge` or `rebase`.
    pub method: String,
    /// The forge the URL of `origin` names, `None` when there is no remote or its host is unknown.
    pub detected_forge: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryLandingDto {
    pub mode: String,
    pub forge: Option<String>,
    pub request_url: Option<String>,
    /// `unknown`, `open`, `merged` or `closed`.
    pub request_state: String,
    pub note: Option<String>,
}

impl From<StoryLanding> for StoryLandingDto {
    fn from(l: StoryLanding) -> Self {
        Self {
            mode: l.mode,
            forge: l.forge,
            request_url: l.request_url,
            request_state: l.request_state,
            note: l.note,
        }
    }
}

fn dto(settings: LandingSettings, detected: Option<Forge>) -> ProjectLandingDto {
    ProjectLandingDto {
        mode: settings.mode.as_str().to_string(),
        command: settings.command,
        forge: settings.forge.map(|f| f.as_str().to_string()),
        method: settings.method,
        detected_forge: detected.map(|f| f.as_str().to_string()),
    }
}

/// A project's landing setting and the forge its remote names. The git read runs with the board
/// mutex released.
#[tauri::command(async)]
pub async fn project_landing_get(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectLandingDto, String> {
    let (settings, repo_path) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("project_landing_get:lock", e))?;
        let settings = read_settings(&conn, &project_id).map_err(|e| e.to_string())?;
        let repo_path: String = conn
            .query_row(
                "SELECT repo_path FROM projects WHERE id = ?1",
                [&project_id],
                |r| r.get(0),
            )
            .map_err(|e| ipc_error("project_landing_get:repo", e))?;
        (settings, repo_path)
    };
    let detected = tauri::async_runtime::spawn_blocking(move || {
        flywheel_core::git::remote_url(std::path::Path::new(&repo_path), "origin")
            .ok()
            .flatten()
            .and_then(|url| detect_forge(&url))
    })
    .await
    .map_err(|e| ipc_error("project_landing_get:join", e))?;
    Ok(dto(settings, detected))
}

/// Set a project's landing mode. The actor is resolved here, never accepted from the renderer
/// (T-01-04). The core refuses a `command` mode with no command, a multi-line command and an unknown
/// method, with a sentence the dialog shows as it stands.
#[tauri::command]
pub fn project_landing_set(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    mode: String,
    command: Option<String>,
    forge: Option<String>,
    method: String,
) -> Result<ProjectLandingDto, String> {
    let mode = LandingMode::parse(&mode).map_err(|e| e.to_string())?;
    let forge = match forge.as_deref().filter(|f| !f.is_empty()) {
        None => None,
        Some(name) => Some(Forge::parse(name).ok_or("The forge is github or gitlab.")?),
    };
    let mut conn = state
        .db
        .lock()
        .map_err(|e| ipc_error("project_landing_set:lock", e))?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let settings = set_settings(
        &mut conn,
        &actor_id,
        &project_id,
        &LandingSettings {
            mode,
            command,
            forge,
            method,
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    emit_board_changed(&app, Some(&project_id), "project", Some(&project_id));
    Ok(dto(settings, None))
}

/// The landing of one Story, or `None` when it never landed. Read-only.
#[tauri::command]
pub fn story_landing(
    state: State<AppState>,
    story_id: String,
) -> Result<Option<StoryLandingDto>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| ipc_error("story_landing:lock", e))?;
    landing_for_story(&conn, &story_id)
        .map(|l| l.map(Into::into))
        .map_err(|e| ipc_error("story_landing:read", e))
}

/// "Check now": ask the forge about a Landing Story at once. A merged request moves the Story to
/// Merged, a closed one back to In review; a missing or signed-out CLI writes a note and the Story
/// stays Landing. Returns the Story's landing afterwards.
#[tauri::command(async)]
pub async fn story_landing_refresh(
    state: State<'_, AppState>,
    app: AppHandle,
    story_id: String,
) -> Result<Option<StoryLandingDto>, String> {
    let db_path = super::board_path(&state.db)?;
    let id = story_id.clone();
    let (landing, project_id) = tauri::async_runtime::spawn_blocking(move || {
        super::with_story_work(&id, || -> Result<_, String> {
            let mut conn = super::open_beside(&db_path)?;
            let landing = refresh_landing(&mut conn, &ForgeCli::from_env(), &id)
                .map_err(|e| ipc_error("story_landing_refresh:ask", e))?;
            let project_id = super::project_of(&conn, "stories", &id);
            Ok((landing, project_id))
        })
    })
    .await
    .map_err(|e| ipc_error("story_landing_refresh:join", e))??;
    emit_board_changed(&app, project_id.as_deref(), "story", Some(&story_id));
    Ok(landing.map(Into::into))
}
