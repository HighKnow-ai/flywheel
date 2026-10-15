//! `cycle_region` — the board's sticky Cycle region (phase 14 plan 14-01, RECD-09, D-01). Read-only,
//! database-only: the project id is the only input. The numbers come from
//! `flywheel_core::query::cycle_progress`, a read-time fold over every task of every epic in the
//! Cycle, never from the board's row window and never from a stored percentage (D-08).
//!
//! `later` is the roadmap ahead of the active Cycle (plan 14-02, D-02): single lines, bounded by
//! `CYCLE_ROSTER_CEILING`. `total` / `listed` / `truncated` are the roster's own facts and the
//! renderer MUST print them when `truncated` is true; this command invents no second window.

use serde::Serialize;
use tauri::State;

use crate::commands::ipc_error;
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
pub struct ActiveCycleDto {
    pub id: String,
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
            Some(ActiveCycleDto {
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
        .map(|l| CycleLineDto {
            id: l.cycle.id.clone(),
            key: l.cycle.key.clone(),
            goal: l.cycle.goal.clone(),
            epic_count: l.epic_count,
        })
        .collect();
    Ok(CycleRegionDto {
        active,
        later,
        total: roster.total,
        listed: roster.cycles.len() as u32,
        truncated: roster.truncated,
    })
}
