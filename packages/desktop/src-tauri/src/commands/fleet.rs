//! `fleet_list` — Phase 10 plan 10-01's cross-project fleet read (FLEET-01, FLEET-04, D-163..D-171):
//! every agent run across every registered project, banded and ordered by the Rust core, in ONE
//! call.
//!
//! Read-only, and it takes NO arguments at all: no project id (D-14 — one database holds every
//! project), no path, no ref, no actor. There is therefore no parameter a renderer could widen, and
//! the window is capped server-side. No git process runs here. Plan 10-03 adds one bounded file read
//! per LIVE row (the end of that run's session log, for the activity cell), so the command takes the
//! `async` + `spawn_blocking` shape `board_change_flags` uses: the database lock is released first and
//! the file reads run off the IPC thread.

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
    /// The end of this run's session log, for the activity cell (plan 10-03, D-167). Always empty for
    /// a run that is not live.
    pub activity: FleetActivityDto,
}

/// Raw tail lines, NOT a rendered string: the normaliser that turns log lines into the line the
/// fleet shows lives in the renderer (the session feed's own `buildFeedRows`) and must not be
/// duplicated here. An empty `lines` is how the renderer tells "nothing to show" from a value;
/// `truncated` separates "nothing there" from "there, but it did not fit the read window".
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetActivityDto {
    pub lines: Vec<String>,
    pub truncated: bool,
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
            activity: FleetActivityDto::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetListDto {
    pub rows: Vec<FleetRowDto>,
    pub total_rows: usize,
    /// Sum of the visible rows' recorded costs, or null when none has one. An estimate (bundled
    /// price table), computed by the core read so the renderer never sums.
    pub visible_cost_usd: Option<f64>,
}

/// A live run is one a person could be watching: its activity line is a liveness signal, so a
/// terminal row never gets one (and is never read).
fn is_live(run_status: &str) -> bool {
    matches!(run_status, "running" | "blocked")
}

/// Fill `activity` for every live row, reading each run's log tail through `read`. A row whose read
/// fails keeps the empty default, which the renderer draws as an explicit absence — one unreadable
/// log must not fail the whole fleet. `read` is a parameter so a test can count the calls.
fn attach_activity(
    rows: &mut [FleetRowDto],
    read: impl Fn(&str) -> anyhow::Result<flywheel_core::session_log::LogTail>,
) {
    for row in rows.iter_mut().filter(|row| is_live(&row.run_status)) {
        if let Ok(tail) = read(&row.agent_run_id) {
            row.activity = FleetActivityDto { lines: tail.lines, truncated: tail.truncated };
        }
    }
}

/// Every agent run across every registered project that belongs on the fleet (capped), with the end
/// of each live run's log for the activity cell. Read-only, cross-project by design, accepts no
/// arguments.
#[tauri::command(async)]
pub async fn fleet_list(state: State<'_, AppState>) -> Result<FleetListDto, String> {
    let list = {
        let conn = state.db.lock().map_err(|e| ipc_error("fleet_list:lock", e))?;
        let list = flywheel_core::query::fleet::fleet_rows(&conn, FLEET_ROWS_CAP)
            .map_err(|e| ipc_error("fleet_list:read", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        list?
    };

    let total_rows = list.total_rows;
    let visible_cost_usd = list.visible_cost_usd;
    let mut rows: Vec<FleetRowDto> = list.rows.into_iter().map(FleetRowDto::from).collect();
    let rows = tauri::async_runtime::spawn_blocking(move || {
        attach_activity(&mut rows, flywheel_core::session_log::read_tail);
        rows
    })
    .await
    .map_err(|e| ipc_error("fleet_list:tail", e))?;

    Ok(FleetListDto { total_rows, visible_cost_usd, rows })
}

/// The server-side cap on the blocked queue (T-10-05-04), equal to the core's backstop clamp.
const BLOCKED_QUEUE_CAP: usize = 200;

/// Mirrors `flywheel_core::query::fleet::BlockedQueueEntry` field-for-field: the pending request the
/// permission card renders, plus the run, project and subject the queue row names.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedQueueEntryDto {
    pub request_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    pub destructive_category: Option<String>,
    pub agent_run_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub subject_kind: String,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_title: Option<String>,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub authoring_stage: Option<String>,
    pub blocked_since: String,
}

impl From<flywheel_core::query::fleet::BlockedQueueEntry> for BlockedQueueEntryDto {
    fn from(e: flywheel_core::query::fleet::BlockedQueueEntry) -> Self {
        Self {
            request_id: e.request_id,
            tool_name: e.tool_name,
            input_payload: e.input_payload,
            created_at: e.created_at,
            destructive_category: e.destructive_category,
            agent_run_id: e.agent_run_id,
            project_id: e.project_id,
            project_name: e.project_name,
            project_key_prefix: e.project_key_prefix,
            subject_kind: e.subject_kind.as_str().to_string(),
            task_id: e.task_id,
            task_key: e.task_key,
            task_title: e.task_title,
            epic_id: e.epic_id,
            epic_key: e.epic_key,
            authoring_stage: e.authoring_stage,
            blocked_since: e.blocked_since,
        }
    }
}

/// Every agent across every registered project currently blocked at a pending permission request
/// (FLEET-02, D-172): live blocks only, one entry per run. Read-only, cross-project by design, takes
/// no arguments. Answering goes through the existing, unchanged `agent_run_answer_permission` (D-173).
/// Pure database read, so it is a plain sync command like the other short reads.
#[tauri::command]
pub fn fleet_blocked_queue(state: State<'_, AppState>) -> Result<Vec<BlockedQueueEntryDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("fleet_blocked_queue:lock", e))?;
    let entries = flywheel_core::query::fleet::blocked_queue(&conn, BLOCKED_QUEUE_CAP)
        .map_err(|e| ipc_error("fleet_blocked_queue:read", e))?;
    Ok(entries.into_iter().map(BlockedQueueEntryDto::from).collect())
}

/// Declares which agent run's session surface is the visible one (D-174), so a notification for
/// the session the user is already watching can be withheld. Writes `AppState.watched_run` and
/// nothing else; `None` means no session is showing. Suppression additionally needs the window to
/// be focused, which Rust reads itself at fire time (T-10-07-03).
#[tauri::command]
pub fn fleet_watch_run(state: State<AppState>, agent_run_id: Option<String>) -> Result<(), String> {
    set_watched_run(&state, agent_run_id)
}

fn set_watched_run(state: &AppState, agent_run_id: Option<String>) -> Result<(), String> {
    let mut watched = state.watched_run.lock().map_err(|e| e.to_string())?;
    *watched = agent_run_id;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flywheel_core::session_log::LogTail;
    use std::cell::Cell;

    fn row(id: &str, run_status: &str) -> FleetRowDto {
        FleetRowDto {
            agent_run_id: id.to_string(),
            project_id: "p".into(),
            project_name: "P".into(),
            project_key_prefix: "P".into(),
            project_status: "active".into(),
            subject_kind: "task".into(),
            task_id: None,
            task_key: None,
            task_title: None,
            task_status: None,
            epic_id: None,
            epic_key: None,
            authoring_stage: None,
            run_status: run_status.into(),
            fleet_state: run_status.into(),
            started_at: "2026-10-12T00:00:00Z".into(),
            ended_at: None,
            blocked_since: None,
            cost_usd: None,
            tokens_in: None,
            tokens_out: None,
            activity: FleetActivityDto::default(),
        }
    }

    fn tail(line: &str) -> anyhow::Result<LogTail> {
        Ok(LogTail { lines: vec![line.to_string()], truncated: false })
    }

    #[test]
    fn fleet_watch_run_sets_the_field_and_clears_it_when_passed_nothing() {
        let state = AppState {
            db: std::sync::Mutex::new(rusqlite::Connection::open_in_memory().unwrap()),
            sidecar: None,
            pending_orphans: std::sync::Mutex::new(Vec::new()),
            focused_task: std::sync::Mutex::new(None),
            watched_run: std::sync::Mutex::new(None),
        };
        set_watched_run(&state, Some("run-1".into())).unwrap();
        assert_eq!(state.watched_run.lock().unwrap().as_deref(), Some("run-1"));
        set_watched_run(&state, None).unwrap();
        assert_eq!(*state.watched_run.lock().unwrap(), None);
    }

    #[test]
    fn only_live_rows_are_read_and_terminal_rows_never_are() {
        let calls = Cell::new(0);
        let mut rows = vec![
            row("a", "running"),
            row("b", "blocked"),
            row("c", "completed"),
            row("d", "failed"),
            row("e", "interrupted"),
            row("f", "abandoned"),
        ];
        attach_activity(&mut rows, |_| {
            calls.set(calls.get() + 1);
            tail("{}")
        });
        assert_eq!(calls.get(), 2);
        assert_eq!(rows[0].activity.lines, vec!["{}".to_string()]);
        assert_eq!(rows[1].activity.lines, vec!["{}".to_string()]);
        assert!(rows[2..].iter().all(|r| r.activity.lines.is_empty()));
    }

    #[test]
    fn a_database_whose_only_runs_are_terminal_makes_no_read_at_all() {
        let calls = Cell::new(0);
        let mut rows = vec![row("a", "completed"), row("b", "abandoned")];
        attach_activity(&mut rows, |_| {
            calls.set(calls.get() + 1);
            tail("{}")
        });
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn a_failed_read_leaves_that_row_empty_and_does_not_fail_the_rest() {
        let mut rows = vec![row("bad", "running"), row("good", "running")];
        attach_activity(&mut rows, |id| if id == "bad" { Err(anyhow::anyhow!("nope")) } else { tail("{}") });
        assert!(rows[0].activity.lines.is_empty());
        assert_eq!(rows[1].activity.lines.len(), 1);
    }

    #[test]
    fn the_truncated_flag_is_carried_through() {
        let mut rows = vec![row("a", "running")];
        attach_activity(&mut rows, |_| Ok(LogTail { lines: Vec::new(), truncated: true }));
        assert!(rows[0].activity.truncated);
    }
}
