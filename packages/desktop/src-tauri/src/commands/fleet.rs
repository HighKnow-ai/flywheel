//! `fleet_list` — Phase 10 plan 10-01's cross-project fleet read (FLEET-01, FLEET-04, D-163..D-171):
//! every agent run across every registered project, banded and ordered by the Rust core, in ONE
//! call.
//!
//! Read-only, and it takes NO arguments at all: no project id (D-14 — one database holds every
//! project), no path, no ref, no actor. There is therefore no parameter a renderer could widen, and
//! the window is capped server-side. It is a pure database read — no filesystem walk and no git
//! process — so it uses the plain synchronous `#[tauri::command]` + `state.db.lock()` shape of
//! `settings_get`, not the `async` + `spawn_blocking` split the git-reaching commands need.

use serde::Serialize;
use tauri::State;

use super::ipc_error;
use crate::state::AppState;

/// The server-side cap on the fleet window (T-10-01-02/03) — applied here, before the call into
/// `packages/core`, like `BOARD_CHANGE_FLAGS_CAP`. Equal to the core's own backstop clamp.
const FLEET_ROWS_CAP: usize = 200;

/// Mirrors `flywheel_core::query::fleet::FleetRow` field-for-field. `subjectKind` is the wire word
/// `task`, `epic` or `authoring`; `fleetState` is the derived state the renderer draws.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetRowDto {
    pub agent_run_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub project_status: String,
    pub subject_kind: String,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_title: Option<String>,
    pub task_status: Option<String>,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub authoring_stage: Option<String>,
    pub run_status: String,
    pub fleet_state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub blocked_since: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
}

impl From<flywheel_core::query::fleet::FleetRow> for FleetRowDto {
    fn from(row: flywheel_core::query::fleet::FleetRow) -> Self {
        Self {
            agent_run_id: row.agent_run_id,
            project_id: row.project_id,
            project_name: row.project_name,
            project_key_prefix: row.project_key_prefix,
            project_status: row.project_status,
            subject_kind: row.subject_kind.as_str().to_string(),
            task_id: row.task_id,
            task_key: row.task_key,
            task_title: row.task_title,
            task_status: row.task_status,
            epic_id: row.epic_id,
            epic_key: row.epic_key,
            authoring_stage: row.authoring_stage,
            run_status: row.run_status,
            fleet_state: row.fleet_state,
            started_at: row.started_at,
            ended_at: row.ended_at,
            blocked_since: row.blocked_since,
            cost_usd: row.cost_usd,
            tokens_in: row.tokens_in,
            tokens_out: row.tokens_out,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetListDto {
    pub rows: Vec<FleetRowDto>,
    pub total_rows: usize,
}

/// Every agent run across every registered project that belongs on the fleet (capped). Read-only,
/// cross-project by design, accepts no arguments.
#[tauri::command]
pub fn fleet_list(state: State<AppState>) -> Result<FleetListDto, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("fleet_list:lock", e))?;
    let list = flywheel_core::query::fleet::fleet_rows(&conn, FLEET_ROWS_CAP)
        .map_err(|e| ipc_error("fleet_list:read", e))?;
    Ok(FleetListDto {
        total_rows: list.total_rows,
        rows: list.rows.into_iter().map(FleetRowDto::from).collect(),
    })
}
