//! Steering a running Story from the board (docs/mvp-spec.md §4.7, docs/adr/0044): a note to the agent
//! and a Quick Story. One module holds both, so the pair is easy to find and to drop.
//!
//! - `session_note_send` records the developer's note (`domain::session_note::record_note`) and queues it
//!   in the sidecar, which hands it to the agent at its next turn boundary. Nothing here types into the
//!   session. `handle_inbound_note_delivered` is the other half: the sidecar's `note_delivered` event
//!   marks the note delivered.
//! - `story_quick_start` writes a Quick Story (`domain::quick_story::write_quick_story`) and starts it
//!   with the same launch as the Start button (`session::story_start_blocking`).
//!
//! Both stamp the local human actor server-side (T-01-04).

use crate::AppHandle;
use serde::Serialize;
use tauri::{Manager, State};

use super::session::{story_start_blocking, SessionDto};
use super::story::StoryDto;
use super::{emit_board_changed, project_of_locked};
use crate::state::AppState;

/// One note, as the board draws it: `sent`, `delivered` or `undelivered`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub story_id: String,
    pub session_id: String,
    pub body: String,
    pub status: String,
    pub created_at: String,
    pub delivered_at: Option<String>,
}

impl From<flywheel_core::domain::session_note::SessionNote> for NoteDto {
    fn from(n: flywheel_core::domain::session_note::SessionNote) -> Self {
        Self {
            id: n.id,
            story_id: n.story_id,
            session_id: n.session_id,
            body: n.body,
            status: n.status,
            created_at: n.created_at,
            delivered_at: n.delivered_at,
        }
    }
}

/// The notes of a Story, oldest first. Read-only.
#[tauri::command]
pub fn story_notes(state: State<AppState>, story_id: String) -> Result<Vec<NoteDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::session_note::notes_for_story(&conn, &story_id)
        .map(|notes| notes.into_iter().map(NoteDto::from).collect())
        .map_err(|e| format!("{e:#}"))
}

/// Send a note to the agent of a running Story. The note is recorded first, then queued in the sidecar;
/// the wait for the sidecar's acknowledgement runs with no database lock held (the board mutex is for
/// database work only, ADR 0024). A refusal by the sidecar, usually because the session just ended, comes
/// back as an error, and the recorded note then reads as not delivered.
#[tauri::command]
pub async fn session_note_send(
    app: AppHandle,
    story_id: String,
    body: String,
) -> Result<NoteDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let note = {
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
                .map_err(|e| e.to_string())?;
            flywheel_core::domain::session_note::record_note(&mut conn, &actor_id, &story_id, &body)
                .map_err(|e| format!("{e:#}"))?
        };
        let project_id = project_of_locked(&state.db, "stories", &story_id);
        emit_board_changed(&app, project_id.as_deref(), "note", Some(&note.id));
        if let Some(sidecar) = state.sidecar.as_ref() {
            sidecar
                .send_note(&note.session_id, &note.id, &note.body)
                .map_err(|e| {
                    format!("The note was not delivered: the session could not take it ({e}).")
                })?;
        }
        Ok(NoteDto::from(note))
    })
    .await
    .map_err(|e| super::ipc_error("session_note_send:join", e))?
}

/// The Tauri-facing half of the delivery report: the sidecar's `note_delivered` event marks the note
/// delivered and tells the board. Never panics: a malformed event, a poisoned lock or an unknown note is
/// a silent no-op, like the other inbound handlers.
pub fn handle_inbound_note_delivered(app: &AppHandle, event: &serde_json::Value) {
    let Some(note_id) = event.get("noteId").and_then(|v| v.as_str()) else {
        return;
    };
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        return;
    };
    let changed =
        flywheel_core::domain::session_note::mark_delivered(&mut conn, note_id).unwrap_or(false);
    let project_id: Option<String> = conn
        .query_row(
            "SELECT project_id FROM session_notes WHERE id = ?1",
            rusqlite::params![note_id],
            |r| r.get(0),
        )
        .ok();
    drop(conn);
    if changed {
        emit_board_changed(app, project_id.as_deref(), "note", Some(note_id));
    }
}

/// What a Quick Story's one step produced.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickStoryDto {
    pub story: StoryDto,
    pub session: SessionDto,
}

/// Write a Quick Story from one text field and start it. `claude` is looked for first, so a missing
/// binary refuses before anything is written. When the start fails after the Story was written, the Story
/// stays Ready on the board and the error says so: the developer starts it again with Start.
#[tauri::command]
pub async fn story_quick_start(
    app: AppHandle,
    project_id: String,
    text: String,
) -> Result<QuickStoryDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        flywheel_core::login_path::claude_bin()?;
        let state = app.state::<AppState>();
        let story = {
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
                .map_err(|e| e.to_string())?;
            flywheel_core::domain::quick_story::write_quick_story(
                &mut conn,
                &actor_id,
                &project_id,
                &text,
            )
            .map_err(|e| format!("{e:#}"))?
        };
        emit_board_changed(&app, Some(&story.project_id), "story", Some(&story.id));
        let key = story.key.clone();
        let session = story_start_blocking(&app, story.id.clone(), "").map_err(|why| {
            format!("The Quick Story {key} is on the board, Ready, but it did not start: {why}")
        })?;
        Ok(QuickStoryDto {
            story: story.into(),
            session,
        })
    })
    .await
    .map_err(|e| super::ipc_error("story_quick_start:join", e))?
}
