//! `events_activity_trail` / `events_since_cursor` — the two reads over the append-only `events`
//! log the renderer and (eventually) a relay each consume (BOARD-09, DATA-05). Both cap the
//! requested window before calling the core, independent of and tighter than whatever cap the
//! core itself applies (T-01-24: no renderer bug or malicious IPC caller can ask for the whole
//! log in one call). Both are read-only: neither emits `board:changed`.

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// The activity trail's own ceiling (01-UI-SPEC.md "Activity trail": a 50-event window with a
/// "Load more" affordance beyond it) — the renderer's default request matches this exactly, and
/// asking for more is clamped down to it, never up.
const TRAIL_DEFAULT_LIMIT: i64 = 50;
const TRAIL_MAX_LIMIT: i64 = 50;

/// The cursor stream's own ceiling — looser than the trail's, since a future relay batches many
/// events per round trip, but still bounded (T-01-24: no caller can read the whole log in one
/// call, even the cursor-resumable one D-22 designs for a relay to use).
const CURSOR_DEFAULT_LIMIT: i64 = 500;
const CURSOR_MAX_LIMIT: i64 = 500;

/// The default `origin` every event Phase 1 writes carries — the only origin that exists until a
/// second machine or a relay-originated replay does (D-17).
const DEFAULT_ORIGIN: &str = "local";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDto {
    pub id: String,
    pub project_id: String,
    pub origin: String,
    pub sequence: i64,
    pub actor_id: String,
    pub event_type: String,
    /// The one-line human sentence `core::domain::event::render_description` derived from this
    /// event's own payload (D-19) — the renderer never re-derives this text from `payload`
    /// itself, and the raw payload is not sent across the IPC boundary at all.
    pub description: String,
    pub occurred_at: String,
}

impl From<flywheel_core::query::events::EventRow> for EventDto {
    fn from(event: flywheel_core::query::events::EventRow) -> Self {
        Self {
            id: event.id,
            project_id: event.project_id,
            origin: event.origin,
            sequence: event.sequence,
            actor_id: event.actor_id,
            event_type: event.event_type,
            description: event.description,
            occurred_at: event.occurred_at,
        }
    }
}

fn resolve_trail_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(TRAIL_DEFAULT_LIMIT).clamp(1, TRAIL_MAX_LIMIT)
}

fn resolve_cursor_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(CURSOR_DEFAULT_LIMIT).clamp(1, CURSOR_MAX_LIMIT)
}

/// A task's or an epic's own chronological activity trail (BOARD-09) — its own events plus, for
/// a task, its acceptance criteria's events, ascending by event id, windowed by `limit`/`offset`
/// (D-03). `parentKind` must be `"task"` or `"epic"`; anything else is rejected here, before it
/// ever reaches the core.
#[tauri::command]
pub fn events_activity_trail(
    state: State<AppState>,
    parent_kind: String,
    parent_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<EventDto>, String> {
    if parent_kind != "task" && parent_kind != "epic" {
        return Err(format!(
            "parentKind must be \"task\" or \"epic\", got {parent_kind:?}"
        ));
    }
    let limit = resolve_trail_limit(limit);
    let offset = offset.unwrap_or(0).max(0);

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::query::events::activity_trail(&conn, &parent_kind, &parent_id, limit, offset)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(EventDto::from).collect())
}

/// The resumable per-`(project, origin)` stream (DATA-05) — no UI surface calls this in Phase 1;
/// it exists as the proven integration point a future relay reads from (D-22). `origin` defaults
/// to `"local"`, the only value Phase 1 ever writes.
#[tauri::command]
pub fn events_since_cursor(
    state: State<AppState>,
    project_id: String,
    origin: Option<String>,
    sequence: i64,
    limit: Option<i64>,
) -> Result<Vec<EventDto>, String> {
    let origin = origin.unwrap_or_else(|| DEFAULT_ORIGIN.to_string());
    let limit = resolve_cursor_limit(limit);

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let cursor = flywheel_core::query::events::EventCursor { project_id, origin, sequence };
    let rows = flywheel_core::query::events::events_since_cursor(&conn, &cursor, limit)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(EventDto::from).collect())
}
