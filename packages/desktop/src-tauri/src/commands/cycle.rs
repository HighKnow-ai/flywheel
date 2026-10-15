//! `cycle_region` — the board's sticky Cycle region (phase 14 plan 14-01, RECD-09, D-01). Read-only,
//! database-only: the project id is the only input. The numbers come from
//! `flywheel_core::query::cycle_progress`, a read-time fold over every task of every epic in the
//! Cycle, never from the board's row window and never from a stored percentage (D-08).
//!
//! `later` is the roadmap ahead of the active Cycle (plan 14-02, D-02): single lines, bounded by
//! `CYCLE_ROSTER_CEILING`. `total` / `listed` / `truncated` are the roster's own facts and the
//! renderer MUST print them when `truncated` is true; this command invents no second window.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::{emit_board_changed, ipc_error, project_of};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleProgressDto {
    pub epics: u32,
    pub tasks_total: u32,
    pub tasks_done: u32,
    pub agents_running: u32,
    pub agents_blocked: u32,
}

impl From<flywheel_core::query::cycle_progress::CycleProgress> for CycleProgressDto {
    fn from(p: flywheel_core::query::cycle_progress::CycleProgress) -> Self {
        Self {
            epics: p.epics,
            tasks_total: p.tasks_total,
            tasks_done: p.tasks_done,
            agents_running: p.agents_running,
            agents_blocked: p.agents_blocked,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnfinishedEpicDto {
    pub id: String,
    pub key: String,
    pub title: String,
}

/// The numbers and the one sentence built from them, so the renderer prints rather than re-words.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeDriftDto {
    pub epics_added: u32,
    pub epics_removed: u32,
    pub sentence: String,
}

fn scope_drift_dto(conn: &rusqlite::Connection, cycle_id: &str) -> Result<Option<ScopeDriftDto>, String> {
    use flywheel_core::query::cycle_scope::{cycle_scope_drift, cycle_scope_sentence};
    let drift = cycle_scope_drift(conn, cycle_id).map_err(|e| ipc_error("cycle_region:scope_drift", e))?;
    Ok(drift.map(|d| ScopeDriftDto {
        epics_added: d.epics_added,
        epics_removed: d.epics_removed,
        sentence: cycle_scope_sentence(&d),
    }))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCycleDto {
    pub id: String,
    /// The Cycle's unfinished epics, which closing it asks about one by one (RECD-10).
    pub unfinished_epics: Vec<UnfinishedEpicDto>,
    /// Scope change since the Cycle started, derived from the event log; absent when there is none.
    pub scope_drift: Option<ScopeDriftDto>,
    pub key: String,
    pub goal: String,
    pub exit_criteria: Option<String>,
    pub state: String,
    pub rank: String,
    pub progress: CycleProgressDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleLineDto {
    pub id: String,
    pub scope_drift: Option<ScopeDriftDto>,
    pub key: String,
    pub goal: String,
    pub epic_count: u32,
}

/// `active: null` when the project has no active Cycle: a stated absence, not an error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CycleRegionDto {
    pub active: Option<ActiveCycleDto>,
    /// Planned Cycles ranked after the active one, in rank order, one line each.
    pub later: Vec<CycleLineDto>,
    /// Open (planned or active) Cycles that exist, the rows the roster read, and whether they differ.
    pub total: i64,
    pub listed: u32,
    pub truncated: bool,
}

#[tauri::command]
pub fn cycle_region(state: State<AppState>, project_id: String) -> Result<CycleRegionDto, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("cycle_region:lock", e))?;
    let active = flywheel_core::domain::cycle::active_cycle(&conn, &project_id)
        .map_err(|e| ipc_error("cycle_region:read", e))?;
    let active = match active {
        None => None,
        Some(cycle) => {
            let progress = flywheel_core::query::cycle_progress::cycle_progress(&conn, &cycle.id)
                .map_err(|e| ipc_error("cycle_region:progress", e))?;
            let unfinished_epics = flywheel_core::domain::cycle::unfinished_epics(&conn, &cycle.id)
                .map_err(|e| ipc_error("cycle_region:unfinished", e))?
                .into_iter()
                .map(|e| UnfinishedEpicDto { id: e.id, key: e.key, title: e.title })
                .collect();
            let scope_drift = scope_drift_dto(&conn, &cycle.id)?;
            Some(ActiveCycleDto {
                unfinished_epics,
                scope_drift,
                id: cycle.id,
                key: cycle.key,
                goal: cycle.goal,
                exit_criteria: cycle.exit_criteria,
                state: cycle.state,
                rank: cycle.rank,
                progress: progress.into(),
            })
        }
    };
    let roster = flywheel_core::domain::cycle::cycle_roster(&conn, &project_id)
        .map_err(|e| ipc_error("cycle_region:roster", e))?;
    let later = roster
        .ahead()
        .into_iter()
        .map(|l| {
            Ok(CycleLineDto {
                id: l.cycle.id.clone(),
                scope_drift: scope_drift_dto(&conn, &l.cycle.id)?,
                key: l.cycle.key.clone(),
                goal: l.cycle.goal.clone(),
                epic_count: l.epic_count,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(CycleRegionDto {
        active,
        later,
        total: roster.total,
        listed: roster.cycles.len() as u32,
        truncated: roster.truncated,
    })
}

/// One epic's answer when closing a Cycle. The webview sends one of these per unfinished epic and
/// the core refuses a close that lacks one for any of them; there is no field that applies a choice
/// to a set of epics (DRFT-07).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicChoiceDto {
    pub epic_id: String,
    #[serde(flatten)]
    pub choice: EpicChoiceKindDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "choice", rename_all = "snake_case")]
pub enum EpicChoiceKindDto {
    MoveTo {
        #[serde(rename = "targetCycleId")]
        target_cycle_id: String,
    },
    Unassign,
    LeaveHere,
}

/// Close a Cycle. The actor is resolved here from the store, never accepted from the webview, and
/// the writer re-checks it is human inside its own transaction (FNC-03).
#[tauri::command]
pub fn cycle_close(
    state: State<AppState>,
    app: AppHandle,
    cycle_id: String,
    choices: Vec<EpicChoiceDto>,
) -> Result<(), String> {
    use flywheel_core::domain::cycle::{close_cycle, EpicChoice, EpicDisposition};
    let mut conn = state.db.lock().map_err(|e| ipc_error("cycle_close:lock", e))?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("cycle_close:actor", e))?;
    let choices: Vec<EpicChoice> = choices
        .into_iter()
        .map(|c| EpicChoice {
            epic_id: c.epic_id,
            disposition: match c.choice {
                EpicChoiceKindDto::MoveTo { target_cycle_id } => EpicDisposition::MoveTo(target_cycle_id),
                EpicChoiceKindDto::Unassign => EpicDisposition::Unassign,
                EpicChoiceKindDto::LeaveHere => EpicDisposition::LeaveHere,
            },
        })
        .collect();
    close_cycle(&mut conn, &cycle_id, &choices, &actor_id).map_err(|e| ipc_error("cycle_close:close", e))?;
    let project_id = project_of(&conn, "cycles", &cycle_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "cycle", Some(cycle_id.as_str()));
    Ok(())
}
