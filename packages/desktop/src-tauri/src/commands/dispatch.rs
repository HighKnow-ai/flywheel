//! The plan lifecycle command surface and the dispatcher's entry point (phase 09 plan 09-07,
//! D-155 to D-158, PLAN-03, PLAN-06, PLAN-07).
//!
//! **What this file is.** Thin: the decision (`flywheel_core::dispatch::decide`), the automatic
//! merge and the lock discipline live in core (`dispatch_exec`) where real-repository tests drive
//! them. This file adds what only the desktop crate can: the launch (the ONE launch body, shared
//! with a user's own launch), the actor resolved server-side, the board-changed notices and the
//! commands the renderer calls.
//!
//! **Human-only.** `dispatch_plan_approve`, `dispatch_plan_pause`, `dispatch_plan_resume`,
//! `dispatch_plan_stop`, `dispatch_advance_now` and `dispatch_gate_resume_now` are in the
//! `authoring_stage_advance` family: no MCP tool and no agent-reachable caller, because they change
//! what the machine does unattended. Every command here accepts ids and plain values only; each
//! branch, ref and path is derived inside core, and the actor is resolved here. Pause and stop
//! change what is STARTED; neither touches a running session or sends an interrupt.
//!
//! **Attribution.** An automatic merge is recorded with the system actor and an automatic flag. It
//! must never read as a reviewed merge: Phase 8's per-task review gate is not mandatory during
//! fan-out (D-156), and the audit trail says so.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::ipc_error;
use crate::state::AppState;

/// Dispatched runs use the conservative edit mode: a tool call it does not cover blocks the run and
/// surfaces as a permission request, which holds its slot until the user answers.
pub const DISPATCH_PERMISSION_MODE: &str = "acceptEdits";

/// Server-side bounds on a draft edit, so a renderer cannot submit an unbounded one.
const MAX_EDITS: usize = 500;
const MAX_EDIT_ENTRIES: usize = 200;
const MAX_ENTRY_CHARS: usize = 1024;

fn validate_id(what: &str, id: &str) -> Result<(), String> {
    if flywheel_core::ids::is_ulid(id) {
        Ok(())
    } else {
        Err(format!("{what} id must be a 26-character ULID, got {id:?}"))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollidingPathDto {
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchEdgeDto {
    pub before_task_id: String,
    pub after_task_id: String,
    pub cause: String,
    pub colliding_paths: Vec<CollidingPathDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTaskDto {
    pub task_id: String,
    pub task_key: String,
    pub title: String,
    pub wave: u32,
    pub state: String,
    pub rationale: Option<String>,
    /// The named cause, present only while `state` is `needs_attention`.
    pub attention: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchPlanDto {
    pub id: String,
    pub epic_id: String,
    pub status: String,
    pub wave_cursor: u32,
    pub tasks: Vec<DispatchTaskDto>,
    pub edges: Vec<DispatchEdgeDto>,
}

fn plan_dto(conn: &rusqlite::Connection, plan_id: &str) -> Result<DispatchPlanDto, String> {
    let plan = flywheel_core::domain::dispatch_plan::read_plan(conn, plan_id)
        .map_err(|e| ipc_error("dispatch_plan_get:read", e))?
        .ok_or_else(|| format!("plan {plan_id:?} not found"))?;
    let edges = flywheel_core::domain::dispatch_plan::read_edges(conn, plan_id)
        .map_err(|e| ipc_error("dispatch_plan_get:edges", e))?;
    let mut tasks = Vec::with_capacity(plan.tasks.len());
    for t in plan.tasks {
        let (task_key, title): (String, String) = conn
            .query_row("SELECT key, title FROM tasks WHERE id = ?1", [&t.task_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| ipc_error("dispatch_plan_get:task", e))?;
        let attention = if t.state == "needs_attention" {
            flywheel_core::dispatch::attention_for(conn, plan_id, &t.task_id)
                .map_err(|e| ipc_error("dispatch_plan_get:attention", e))?
                .map(|(_, _, cause)| cause)
        } else {
            None
        };
        tasks.push(DispatchTaskDto {
            task_id: t.task_id,
            task_key,
            title,
            wave: t.wave,
            state: t.state,
            rationale: t.rationale,
            attention,
        });
    }
    Ok(DispatchPlanDto {
        id: plan.id,
        epic_id: plan.epic_id,
        status: plan.status,
        wave_cursor: plan.wave_cursor,
        tasks,
        edges: edges
            .into_iter()
            .map(|e| DispatchEdgeDto {
                before_task_id: e.before_task_id,
                after_task_id: e.after_task_id,
                cause: e.cause,
                colliding_paths: e
                    .colliding_paths
                    .into_iter()
                    .map(|(before, after)| CollidingPathDto { before, after })
                    .collect(),
            })
            .collect(),
    })
}

fn notify(app: &AppHandle, plan_id: &str) {
    app.emit("board:changed", serde_json::json!({ "entity": "dispatch_plan", "id": plan_id })).ok();
}

/// Build a draft plan over an epic's tasks from their currently declared sets, with no planning
/// agent involved (so the dispatcher is usable before one exists).
#[tauri::command]
pub fn dispatch_plan_create(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
) -> Result<DispatchPlanDto, String> {
    validate_id("epic", &epic_id)?;
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_create:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_plan_create:actor", e))?;
    let plan_id = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic_id, &human)
        .map_err(|e| ipc_error("dispatch_plan_create:create", e))?;
    let dto = plan_dto(&conn, &plan_id)?;
    drop(conn);
    notify(&app, &plan_id);
    Ok(dto)
}

/// A plan by its id, or the epic's most recent plan by the epic id (how the renderer finds it again
/// after a restart). Exactly one of the two.
#[tauri::command]
pub fn dispatch_plan_get(
    state: State<AppState>,
    plan_id: Option<String>,
    epic_id: Option<String>,
) -> Result<Option<DispatchPlanDto>, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_get:lock", e))?;
    let plan_id = match (plan_id, epic_id) {
        (Some(id), None) => {
            validate_id("plan", &id)?;
            id
        }
        (None, Some(epic)) => {
            validate_id("epic", &epic)?;
            let found: Option<String> = conn
                .query_row(
                    "SELECT id FROM dispatch_plans WHERE epic_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
                    [&epic],
                    |r| r.get(0),
                )
                .ok();
            match found {
                Some(id) => id,
                None => return Ok(None),
            }
        }
        _ => return Err("pass exactly one of a plan id or an epic id".to_string()),
    };
    plan_dto(&conn, &plan_id).map(Some)
}

/// One edit to a draft: a wave move and/or a replacement of the task's declared entries.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchEditInput {
    pub task_id: String,
    pub wave: Option<u32>,
    pub entries: Option<Vec<String>>,
}

/// Wave moves and entry edits on a DRAFT plan. A refused entry changes nothing.
#[tauri::command]
pub fn dispatch_plan_edit(
    state: State<AppState>,
    app: AppHandle,
    plan_id: String,
    edits: Vec<DispatchEditInput>,
) -> Result<DispatchPlanDto, String> {
    validate_id("plan", &plan_id)?;
    if edits.len() > MAX_EDITS {
        return Err(format!("at most {MAX_EDITS} edits per call, got {}", edits.len()));
    }
    let mut inputs = Vec::with_capacity(edits.len());
    for e in edits {
        validate_id("task", &e.task_id)?;
        if let Some(entries) = &e.entries {
            if entries.len() > MAX_EDIT_ENTRIES || entries.iter().any(|s| s.chars().count() > MAX_ENTRY_CHARS) {
                return Err(format!("at most {MAX_EDIT_ENTRIES} entries of {MAX_ENTRY_CHARS} characters per task"));
            }
        }
        inputs.push(flywheel_core::domain::dispatch_plan::DraftEdit {
            task_id: e.task_id,
            wave: e.wave,
            entries: e.entries,
        });
    }
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_edit:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_plan_edit:actor", e))?;
    flywheel_core::domain::dispatch_plan::edit_draft_plan(&mut conn, &plan_id, &inputs, &human)
        .map_err(|e| ipc_error("dispatch_plan_edit:edit", e))?;
    let dto = plan_dto(&conn, &plan_id)?;
    drop(conn);
    notify(&app, &plan_id);
    Ok(dto)
}

fn control(
    state: &AppState,
    app: &AppHandle,
    plan_id: &str,
    control: flywheel_core::domain::dispatch_plan::PlanControl,
    context: &str,
) -> Result<DispatchPlanDto, String> {
    validate_id("plan", plan_id)?;
    let mut conn = state.db.lock().map_err(|e| ipc_error(context, e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| ipc_error(context, e))?;
    flywheel_core::domain::dispatch_plan::control_plan(&mut conn, plan_id, control, &human)
        .map_err(|e| ipc_error(context, e))?;
    let dto = plan_dto(&conn, plan_id)?;
    drop(conn);
    notify(app, plan_id);
    Ok(dto)
}

/// Approve a draft: freezes the ordering edges and their colliding paths, then starts the plan. The
/// dispatcher takes over from the next tick. Human-only.
#[tauri::command]
pub fn dispatch_plan_approve(
    state: State<AppState>,
    app: AppHandle,
    plan_id: String,
) -> Result<DispatchPlanDto, String> {
    validate_id("plan", &plan_id)?;
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_approve:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_plan_approve:actor", e))?;
    flywheel_core::domain::dispatch_plan::approve_and_start(&mut conn, &plan_id, &human)
        .map_err(|e| ipc_error("dispatch_plan_approve:approve", e))?;
    let dto = plan_dto(&conn, &plan_id)?;
    drop(conn);
    notify(&app, &plan_id);
    crate::scheduler::nudge_dispatch(&app);
    Ok(dto)
}

/// Stop starting new work. Running sessions are left exactly as they are. Human-only.
#[tauri::command]
pub fn dispatch_plan_pause(state: State<AppState>, app: AppHandle, plan_id: String) -> Result<DispatchPlanDto, String> {
    control(&state, &app, &plan_id, flywheel_core::domain::dispatch_plan::PlanControl::Pause, "dispatch_plan_pause")
}

/// Continue a paused plan. Human-only.
#[tauri::command]
pub fn dispatch_plan_resume(state: State<AppState>, app: AppHandle, plan_id: String) -> Result<DispatchPlanDto, String> {
    let dto = control(&state, &app, &plan_id, flywheel_core::domain::dispatch_plan::PlanControl::Resume, "dispatch_plan_resume")?;
    crate::scheduler::nudge_dispatch(&app);
    Ok(dto)
}

/// End the plan. Running sessions are left exactly as they are; nothing is interrupted. Human-only.
#[tauri::command]
pub fn dispatch_plan_stop(state: State<AppState>, app: AppHandle, plan_id: String) -> Result<DispatchPlanDto, String> {
    control(&state, &app, &plan_id, flywheel_core::domain::dispatch_plan::PlanControl::Stop, "dispatch_plan_stop")
}

/// Advance the wave cursor now, from the warning tier where the dispatcher will not do it on its
/// own. Refused unless the wave is entirely merged or skipped. Human-only.
#[tauri::command]
pub fn dispatch_advance_now(state: State<AppState>, app: AppHandle, plan_id: String) -> Result<DispatchPlanDto, String> {
    validate_id("plan", &plan_id)?;
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_advance_now:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_advance_now:actor", e))?;
    flywheel_core::domain::dispatch_plan::advance_wave(&mut conn, &plan_id, &human)
        .map_err(|e| ipc_error("dispatch_advance_now:advance", e))?;
    let dto = plan_dto(&conn, &plan_id)?;
    drop(conn);
    notify(&app, &plan_id);
    crate::scheduler::nudge_dispatch(&app);
    Ok(dto)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhyDto {
    /// `sequenced`, `differentWaves`, `disjointSets` or `notInPlan`.
    pub kind: String,
    pub sentence: String,
    pub before_task_id: Option<String>,
    pub after_task_id: Option<String>,
    pub cause: Option<String>,
    pub colliding_paths: Vec<CollidingPathDto>,
}

/// Why were these two tasks sequenced (or not)? Answers from the edge frozen at approval, which is
/// what was acted on, not from a recomputation. Read-only.
#[tauri::command]
pub fn dispatch_why(
    state: State<AppState>,
    plan_id: String,
    task_a: String,
    task_b: String,
) -> Result<WhyDto, String> {
    validate_id("plan", &plan_id)?;
    validate_id("task", &task_a)?;
    validate_id("task", &task_b)?;
    let conn = state.db.lock().map_err(|e| ipc_error("dispatch_why:lock", e))?;
    let key = |id: &str| -> String {
        conn.query_row("SELECT key FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| id.to_string())
    };
    use flywheel_core::dispatch::SequencingReason;
    let reason = flywheel_core::dispatch::why(&conn, &plan_id, &task_a, &task_b)
        .map_err(|e| ipc_error("dispatch_why:read", e))?;
    let (ka, kb) = (key(&task_a), key(&task_b));
    Ok(match reason {
        SequencingReason::Sequenced { before_task_id, after_task_id, cause, colliding_paths } => {
            let shown: Vec<&str> = colliding_paths.iter().take(3).map(|(_, a)| a.as_str()).collect();
            let sentence = format!(
                "{} waits for {}: both declare {}{}",
                key(&after_task_id),
                key(&before_task_id),
                shown.join(", "),
                if cause == "widen" { " (after a live widen)" } else { "" },
            );
            WhyDto {
                kind: "sequenced".into(),
                sentence,
                before_task_id: Some(before_task_id),
                after_task_id: Some(after_task_id),
                cause: Some(cause),
                colliding_paths: colliding_paths.into_iter().map(|(before, after)| CollidingPathDto { before, after }).collect(),
            }
        }
        SequencingReason::DifferentWaves { wave_a, wave_b } => WhyDto {
            kind: "differentWaves".into(),
            sentence: format!("{ka} is in wave {wave_a} and {kb} in wave {wave_b}, so they never run together."),
            before_task_id: None,
            after_task_id: None,
            cause: None,
            colliding_paths: Vec::new(),
        },
        SequencingReason::DisjointSets => WhyDto {
            kind: "disjointSets".into(),
            sentence: format!("{ka} and {kb} declare disjoint sets, so neither waits for the other."),
            before_task_id: None,
            after_task_id: None,
            cause: None,
            colliding_paths: Vec::new(),
        },
        SequencingReason::NotInPlan => WhyDto {
            kind: "notInPlan".into(),
            sentence: "At least one of those tasks is not in this plan.".into(),
            before_task_id: None,
            after_task_id: None,
            cause: None,
            colliding_paths: Vec::new(),
        },
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDto {
    /// `open`, `warning` or `paused`.
    pub state: String,
    /// The reason the user reads.
    pub message: String,
    pub resume_at: Option<i64>,
}

fn gate_dto(conn: &rusqlite::Connection) -> Result<GateDto, String> {
    use flywheel_core::limit_gate::GateState;
    let gate = flywheel_core::limit_gate::read_gate(conn, chrono::Utc::now().timestamp())
        .map_err(|e| ipc_error("dispatch_gate_state:read", e))?;
    Ok(GateDto {
        state: match &gate {
            GateState::Open { .. } => "open",
            GateState::Warning { .. } => "warning",
            GateState::Paused { .. } => "paused",
        }
        .to_string(),
        message: gate.message(),
        resume_at: match &gate {
            GateState::Paused { resume_at, .. } => *resume_at,
            GateState::Warning { resets_at, .. } => *resets_at,
            GateState::Open { .. } => None,
        },
    })
}

/// The account-limit gate as the dispatcher reads it right now, with its reason. Read-only.
#[tauri::command]
pub fn dispatch_gate_state(state: State<AppState>) -> Result<GateDto, String> {
    let conn = state.db.lock().map_err(|e| ipc_error("dispatch_gate_state:lock", e))?;
    gate_dto(&conn)
}

/// Open the gate on the user's word, without waiting for the reset. Human-only.
#[tauri::command]
pub fn dispatch_gate_resume_now(state: State<AppState>, app: AppHandle) -> Result<GateDto, String> {
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_gate_resume_now:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_gate_resume_now:actor", e))?;
    flywheel_core::limit_gate::resume_now(&mut conn, &human).map_err(|e| ipc_error("dispatch_gate_resume_now:resume", e))?;
    let dto = gate_dto(&conn)?;
    drop(conn);
    crate::scheduler::nudge_dispatch(&app);
    Ok(dto)
}

/// One dispatcher pass: read, observe, decide, then act on every decision, taking the database lock
/// for each database step and holding it across no subprocess. Spawns go through
/// [`crate::commands::agent_run::launch_run_for_task`], which sends the request through the one
/// gated spawn path that enforces the per-repository spawn floor; nothing here sleeps or paces.
/// The system actor is resolved here and is the only actor an automatic write carries.
pub fn execute_dispatch_actions(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let system = {
        let Ok(conn) = state.db.lock() else {
            eprintln!("dispatch tick: AppState.db lock was poisoned, skipping this tick");
            return;
        };
        match flywheel_core::domain::actor::system_actor(&conn) {
            Ok(actor) => actor.id,
            Err(err) => {
                eprintln!("dispatch tick: failed to resolve the system actor: {err:#}");
                return;
            }
        }
    };
    let report = flywheel_core::dispatch_exec::run_pass(&state.db, chrono::Utc::now().timestamp(), &system, |_plan, task_id| {
        crate::commands::agent_run::launch_run_for_task(
            &state,
            app,
            task_id,
            DISPATCH_PERMISSION_MODE,
            flywheel_core::context_packet::DISPATCHED_COMMIT_INSTRUCTION,
        )
        .map(|_| ())
    });
    match report {
        Ok(report) => {
            for failure in &report.failures {
                eprintln!("dispatch tick: {failure}");
            }
            if !report.actions.is_empty() {
                app.emit("board:changed", serde_json::json!({ "entity": "dispatch_plan" })).ok();
            }
        }
        Err(err) => eprintln!("dispatch tick: {err:#}"),
    }
}
