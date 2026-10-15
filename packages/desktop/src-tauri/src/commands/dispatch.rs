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
//! `dispatch_plan_stop`, `dispatch_advance_now`, `dispatch_gate_resume_now`, `retry_task` and
//! `skip_task` are in the
//! `authoring_stage_advance` family: no MCP tool and no agent-reachable caller, because they change
//! what the machine does unattended. Every command here accepts ids and plain values only; each
//! branch, ref and path is derived inside core, and the actor is resolved here. Pause and stop
//! change what is STARTED; neither touches a running session or sends an interrupt.
//!
//! **Attribution.** An automatic merge is recorded with the system actor and an automatic flag. It
//! must never read as a reviewed merge: Phase 8's per-task review gate is not mandatory during
//! fan-out (D-156), and the audit trail says so.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::{emit_board_changed, project_of_locked};

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
    /// The named cause, present while `state` is `needs_attention`, `failed`, `stopped` or `conflict`.
    pub attention: Option<String>,
    /// The task's declared file-set as stored, in the order it was stored.
    pub entries: Vec<String>,
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
    /// `true` once approval has frozen the edges; `false` for a draft, whose edges are a preview that
    /// approval will recompute.
    pub edges_frozen: bool,
}

/// `fold_case` is the repository's case flag, used only to preview a DRAFT's edges. It is a parameter
/// because reading it runs `git config`, which must not happen under `AppState.db` (D-REV-39 WR-07);
/// [`plan_fold_case`] reads it before the lock is taken.
fn plan_dto(conn: &rusqlite::Connection, plan_id: &str, fold_case: bool) -> Result<DispatchPlanDto, String> {
    let plan = flywheel_core::domain::dispatch_plan::read_plan(conn, plan_id)
        .map_err(|e| ipc_error("dispatch_plan_get:read", e))?
        .ok_or_else(|| format!("plan {plan_id:?} not found"))?;
    // A draft has no frozen edges yet, so it shows what approval WOULD freeze (computed by the same
    // core code, written nowhere); every other status shows the rows that were acted on.
    let edges_frozen = plan.status != "draft";
    let edges = if edges_frozen {
        flywheel_core::domain::dispatch_plan::read_edges(conn, plan_id)
    } else {
        flywheel_core::domain::dispatch_plan::preview_edges_with(conn, plan_id, fold_case)
    }
    .map_err(|e| ipc_error("dispatch_plan_get:edges", e))?;
    let mut tasks = Vec::with_capacity(plan.tasks.len());
    for t in plan.tasks {
        let (task_key, title): (String, String) = conn
            .query_row("SELECT key, title FROM tasks WHERE id = ?1", [&t.task_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| ipc_error("dispatch_plan_get:task", e))?;
        // `needs_attention` carries its own recorded cause; failed, stopped and conflict write none, so
        // their cause is composed from the state (D-REV-41).
        let attention = if t.state == "needs_attention" {
            flywheel_core::dispatch::attention_for(conn, plan_id, &t.task_id)
                .map_err(|e| ipc_error("dispatch_plan_get:attention", e))?
                .map(|(_, _, cause)| cause)
        } else {
            flywheel_core::dispatch::stuck_cause(conn, &t.task_id, &t.state)
                .map_err(|e| ipc_error("dispatch_plan_get:stuck", e))?
        };
        // Read from the stored rows, never from the marker file (09-01).
        let entries = flywheel_core::domain::file_set::list_entries_for_task(conn, &t.task_id)
            .map_err(|e| ipc_error("dispatch_plan_get:entries", e))?
            .iter()
            .map(|e| flywheel_core::file_set::entry_path(e).to_string())
            .collect();
        tasks.push(DispatchTaskDto {
            task_id: t.task_id,
            task_key,
            title,
            wave: t.wave,
            state: t.state,
            rationale: t.rationale,
            attention,
            entries,
        });
    }
    Ok(DispatchPlanDto {
        id: plan.id,
        epic_id: plan.epic_id,
        status: plan.status,
        wave_cursor: plan.wave_cursor,
        tasks,
        edges_frozen,
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

/// The repository's case flag for a DRAFT plan, read with NO database lock held across the probe:
/// the repository path is read under a short lock, the lock is dropped, `git config` runs, and the
/// caller re-locks (the shape `worktree.rs`'s reclaim path uses). Any other status needs no flag and
/// reads `false`; so does a plan that cannot be found, because the core call that follows reports the
/// real error.
fn plan_fold_case(state: &AppState, plan_id: &str) -> bool {
    let repo_path = state.db.lock().ok().and_then(|conn| {
        let draft: bool = conn
            .query_row("SELECT status = 'draft' FROM dispatch_plans WHERE id = ?1", [plan_id], |r| r.get(0))
            .ok()?;
        if !draft {
            return None;
        }
        flywheel_core::domain::dispatch_plan::plan_repo_path(&conn, plan_id).ok()
    });
    repo_path.is_some_and(|p| flywheel_core::domain::file_set::repo_is_case_insensitive(std::path::Path::new(&p)))
}

/// [`plan_dto`] for a caller that holds no lock: the case flag first (no lock across the probe), then
/// a short lock for the read.
fn plan_dto_unlocked(state: &AppState, plan_id: &str) -> Result<DispatchPlanDto, String> {
    let fold_case = plan_fold_case(state, plan_id);
    let conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan:lock", e))?;
    plan_dto(&conn, plan_id, fold_case)
}

fn notify(app: &AppHandle, plan_id: &str) {
    // Every caller has released the lock by now, so taking it here cannot deadlock.
    let project_id = app
        .try_state::<AppState>()
        .and_then(|state| project_of_locked(&state.db, "dispatch_plans", plan_id));
    emit_board_changed(app, project_id.as_deref(), "dispatch_plan", Some(plan_id));
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
    drop(conn);
    let dto = plan_dto_unlocked(&state, &plan_id)?;
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
    drop(conn);
    plan_dto_unlocked(&state, &plan_id).map(Some)
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
    drop(conn);
    let dto = plan_dto_unlocked(&state, &plan_id)?;
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
    drop(conn);
    let dto = plan_dto_unlocked(state, plan_id)?;
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
    let fold_case = plan_fold_case(&state, &plan_id); // before the lock: it runs `git config`
    let mut conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_approve:lock", e))?;
    let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| ipc_error("dispatch_plan_approve:actor", e))?;
    flywheel_core::domain::dispatch_plan::approve_and_start_with(&mut conn, &plan_id, &human, fold_case)
        .map_err(|e| ipc_error("dispatch_plan_approve:approve", e))?;
    drop(conn);
    let dto = plan_dto_unlocked(&state, &plan_id)?;
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
    drop(conn);
    let dto = plan_dto_unlocked(&state, &plan_id)?;
    notify(&app, &plan_id);
    crate::scheduler::nudge_dispatch(&app);
    Ok(dto)
}

/// What a stuck-task verb leaves behind: the refusal's own sentence (composed in core from names and
/// states, never git or CLI text) or the refreshed plan, with the board and the dispatcher told.
fn finish_stuck_verb(
    state: &AppState,
    app: &AppHandle,
    outcome: anyhow::Result<String>,
    context: &str,
) -> Result<DispatchPlanDto, String> {
    let plan_id = outcome.map_err(|e| match e.downcast_ref::<flywheel_core::domain::dispatch_plan::StuckRefusal>() {
        Some(refusal) => refusal.to_string(),
        None => ipc_error(context, e),
    })?;
    let dto = plan_dto_unlocked(state, &plan_id)?;
    notify(app, &plan_id);
    crate::scheduler::nudge_dispatch(app);
    Ok(dto)
}

/// Hand a task whose run failed or was stopped, or whose automatic merge found a conflict, back to
/// the dispatcher (D-REV-41). A task id and nothing else: the plan is the task's live plan and the
/// actor is resolved here. HUMAN-ONLY, in the `authoring_stage_advance` family: no MCP tool and no
/// agent-reachable caller, because an agent restarting its own stuck work would be an agent deciding
/// its own work is not done. Refuses by name, writing nothing, outside those three states or while a
/// run of the task is live.
#[tauri::command]
pub fn retry_task(state: State<AppState>, app: AppHandle, task_id: String) -> Result<DispatchPlanDto, String> {
    validate_id("task", &task_id)?;
    let outcome = {
        let mut conn = state.db.lock().map_err(|e| ipc_error("retry_task:lock", e))?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| ipc_error("retry_task:actor", e))?;
        flywheel_core::domain::dispatch_plan::retry_task(&mut conn, &task_id, &human)
    };
    finish_stuck_verb(&state, &app, outcome, "retry_task")
}

/// Leave a stuck task out of its plan so its wave and every later wave advance (D-REV-41). Same
/// shape, same refusals and the same HUMAN-ONLY standing as [`retry_task`]: a task id and nothing
/// else, the actor resolved here, no MCP tool, no agent-reachable caller. The task's branch and
/// worktree are left exactly as they are.
#[tauri::command]
pub fn skip_task(state: State<AppState>, app: AppHandle, task_id: String) -> Result<DispatchPlanDto, String> {
    validate_id("task", &task_id)?;
    let outcome = {
        let mut conn = state.db.lock().map_err(|e| ipc_error("skip_task:lock", e))?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| ipc_error("skip_task:actor", e))?;
        flywheel_core::domain::dispatch_plan::skip_task(&mut conn, &task_id, &human)
    };
    finish_stuck_verb(&state, &app, outcome, "skip_task")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhyDto {
    /// `sequenced`, `differentWaves`, `disjointSets`, `runsAlone` or `notInPlan`.
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
    why_dto(&conn, &plan_id, &task_a, &task_b)
}

/// The body of `dispatch_why`, over a plain connection so the sentences are testable.
fn why_dto(conn: &rusqlite::Connection, plan_id: &str, task_a: &str, task_b: &str) -> Result<WhyDto, String> {
    let key = |id: &str| -> String {
        conn.query_row("SELECT key FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| id.to_string())
    };
    use flywheel_core::dispatch::SequencingReason;
    let reason = flywheel_core::dispatch::why(conn, plan_id, task_a, task_b)
        .map_err(|e| ipc_error("dispatch_why:read", e))?;
    let (ka, kb) = (key(task_a), key(task_b));
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
        SequencingReason::RunsAlone { undeclared_task_ids } => WhyDto {
            kind: "runsAlone".into(),
            sentence: match undeclared_task_ids.as_slice() {
                [one] => format!(
                    "{} has no declared file-set, so it runs alone and never shares a wave.",
                    key(one)
                ),
                _ => format!(
                    "Neither {ka} nor {kb} has a declared file-set, so each runs alone and never shares a wave."
                ),
            },
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
            crate::commands::agent_run::CrossTaskConflict::Refuse,
        )
        .map(|_| ())
    });
    match report {
        Ok(report) => {
            for failure in &report.failures {
                eprintln!("dispatch tick: {failure}");
            }
            if !report.actions.is_empty() {
                // One pass can act on plans in several projects: broadcast.
                emit_board_changed(app, None, "dispatch_plan", None);
            }
        }
        Err(err) => eprintln!("dispatch tick: {err:#}"),
    }
}

// ---------------------------------------------------------------------------------------------
// Plan 09-08: the pre-dispatch planning pass.
// ---------------------------------------------------------------------------------------------

/// A planning run uses the default permission mode (the authoring precedent): a tool call that is not
/// pre-approved, which is everything but `submit_plan`, blocks and surfaces as a permission request
/// instead of running.
pub const PLANNING_PERMISSION_MODE: &str = "default";

/// The sidecar `spawn` request a planning run is launched with: the ordinary `spawn` op with the
/// epic integration worktree as its working directory and `planning: true`, which makes the sidecar
/// pre-approve `submit_plan` and nothing else. No task id: a planning run has none.
pub(crate) fn planning_spawn_request(
    run_id: &str,
    worktree_path: &std::path::Path,
    prompt: &str,
    env: &impl Serialize,
) -> serde_json::Value {
    serde_json::json!({
        "id": run_id,
        "op": "spawn",
        "runId": run_id,
        "worktreePath": worktree_path.to_string_lossy(),
        "prompt": prompt,
        "permissionMode": PLANNING_PERMISSION_MODE,
        "planning": true,
        "env": env,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningRunDto {
    pub run_id: String,
    pub epic_id: String,
}

/// End a planning run that was recorded but could not be launched, so it does not sit `running`
/// forever holding a slot.
fn fail_planning_start(state: &AppState, run_id: &str, why: String) -> String {
    if let Ok(mut conn) = state.db.lock() {
        let _ = flywheel_core::domain::agent_run::close_agent_run(
            &mut conn,
            run_id,
            flywheel_core::domain::agent_run::AgentRunStatus::Failed,
            None,
            None,
            None,
        );
    }
    why
}

/// Start the pre-dispatch planning run for an epic: refuse what cannot be planned, prepare the
/// integration worktree, record the run, then launch it through the ONE gated spawn path. The
/// credential is resolved before any run exists (D-39). Not gated by the parallel cap: this is the
/// user's own action, and the run still holds a slot while it runs.
pub(crate) fn start_planning_run(state: &AppState, epic_id: &str) -> Result<PlanningRunDto, String> {
    let (human, mut env) = {
        let conn = state.db.lock().map_err(|e| ipc_error("dispatch_plan_generate:lock", e))?;
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .map_err(|e| ipc_error("dispatch_plan_generate:actor", e))?;
        let project_id: String = conn
            .query_row("SELECT project_id FROM epics WHERE id = ?1", [epic_id], |r| r.get(0))
            .map_err(|e| ipc_error("dispatch_plan_generate:epic", e))?;
        let env = crate::sidecar::resolved_env_for_run(&conn, &project_id)
            .map_err(|e| ipc_error("dispatch_plan_generate:credential", e))?;
        (human, env)
    };
    let start = flywheel_core::dispatch_exec::begin_planning_run(&state.db, epic_id, &human, PLANNING_PERMISSION_MODE)
        .map_err(|e| ipc_error("dispatch_plan_generate:begin", e))?;
    if let Err(e) = crate::sidecar::merge_shim_env_for_run(&mut env, &start.run_id) {
        return Err(fail_planning_start(state, &start.run_id, ipc_error("dispatch_plan_generate:shim", e)));
    }
    let request = planning_spawn_request(&start.run_id, &start.worktree_path, &start.prompt, &env);
    if let Err(e) = crate::commands::agent_run::send_gated_spawn(state, &start.repo_path, &request) {
        return Err(fail_planning_start(state, &start.run_id, ipc_error("dispatch_plan_generate:spawn", e)));
    }
    Ok(PlanningRunDto { run_id: start.run_id, epic_id: start.epic_id })
}

/// The epic's running planning run, if any: the window between "Generate" and the first valid
/// submission, in which a run exists and no plan row does.
pub(crate) fn planning_run_for_epic(
    conn: &rusqlite::Connection,
    epic_id: &str,
) -> Result<Option<PlanningRunDto>, String> {
    // The same kind `check_can_plan` refuses a second run on: see `RUN_KIND_PLANNING_PREDICATE`.
    let sql = format!(
        "SELECT id FROM agent_runs
          WHERE epic_id = ?1 AND {}
            AND status IN ('running', 'blocked')
          ORDER BY started_at DESC LIMIT 1",
        flywheel_core::domain::agent_run::RUN_KIND_PLANNING_PREDICATE
    );
    let run_id: Option<String> = conn
        .query_row(
            &sql,
            [epic_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| ipc_error("dispatch_planning_run:read", e))?;
    Ok(run_id.map(|run_id| PlanningRunDto { run_id, epic_id: epic_id.to_string() }))
}

/// Is a planning run in progress for this epic? The window between Generate and the first valid
/// submission has a run and no plan row, so the plan read alone cannot show it. Read-only.
#[tauri::command]
pub fn dispatch_planning_run(state: State<AppState>, epic_id: String) -> Result<Option<PlanningRunDto>, String> {
    validate_id("epic", &epic_id)?;
    let conn = state.db.lock().map_err(|e| ipc_error("dispatch_planning_run:lock", e))?;
    planning_run_for_epic(&conn, &epic_id)
}

/// Ask for a fan-out plan on an epic: a short, read-only agent run reads the repository as it is NOW
/// and stores a draft with a file-set and a wave on every task and a reason for anything left out.
/// It approves nothing and starts no task; the user reviews and edits the draft first. Human-only.
#[tauri::command]
pub fn dispatch_plan_generate(
    state: State<AppState>,
    app: AppHandle,
    epic_id: String,
) -> Result<PlanningRunDto, String> {
    validate_id("epic", &epic_id)?;
    let dto = start_planning_run(&state, &epic_id)?;
    let project_id = project_of_locked(&state.db, "epics", &epic_id);
    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&dto.run_id));
    Ok(dto)
}

#[cfg(test)]
mod planning_tests {
    use super::*;

    /// A migrated database holding one epic with one backlog task, returned with the human actor.
    fn epic_fixture() -> (rusqlite::Connection, String, String) {
        let dir = tempfile::tempdir().expect("scratch dir");
        let mut conn = flywheel_core::db::open_and_migrate(&dir.path().join("f.db"), &dir.path().join("backups"))
            .expect("open_and_migrate");
        std::mem::forget(dir);
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
        let project = flywheel_core::domain::project::create_project(&mut conn, &human, "P", "/repo", "FLY", "main").unwrap();
        let epic = flywheel_core::domain::epic::create_epic(&mut conn, &project.id, &human, "Epic", None).unwrap();
        flywheel_core::domain::task::create_task(&mut conn, &project.id, &human, "T", Some(&epic.id)).unwrap();
        (conn, epic.id, human)
    }

    #[test]
    fn the_spawn_request_marks_the_run_as_planning_and_names_no_task() {
        let request = planning_spawn_request(
            "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            std::path::Path::new("/tmp/epic-worktree"),
            "plan it",
            &serde_json::json!({ "A": "b" }),
        );
        assert_eq!(request["op"], "spawn");
        assert_eq!(request["runId"], "01ARZ3NDEKTSV4RRFFQ69G5FAV");
        assert_eq!(request["worktreePath"], "/tmp/epic-worktree");
        assert_eq!(request["prompt"], "plan it");
        assert_eq!(request["permissionMode"], PLANNING_PERMISSION_MODE);
        assert_eq!(request["planning"], true);
        assert_eq!(request["env"]["A"], "b");
        assert!(request.get("taskId").is_none());
    }

    #[test]
    fn a_planning_run_is_not_returned_by_the_running_authoring_run_lookup() {
        let (mut conn, epic_id, human) = epic_fixture();
        let run_id = flywheel_core::domain::dispatch_plan::start_planning_run_row(
            &mut conn,
            &epic_id,
            &human,
            PLANNING_PERMISSION_MODE,
            |_| Ok(()),
        )
        .expect("the planning run starts");
        let status: String = conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", [&run_id], |r| r.get(0)).unwrap();
        assert_eq!(status, "running");
        assert!(
            crate::commands::authoring::find_running_authoring_run(&conn, &epic_id).unwrap().is_none(),
            "a planning run must never be mistaken for an authoring session"
        );
    }
}

#[cfg(test)]
mod surface_tests {
    use super::*;

    /// An epic with two tasks, both declaring `a.rs` (so one edge), and the human actor.
    fn two_task_epic() -> (rusqlite::Connection, String, String, Vec<String>) {
        let dir = tempfile::tempdir().expect("scratch dir");
        let mut conn = flywheel_core::db::open_and_migrate(&dir.path().join("f.db"), &dir.path().join("backups"))
            .expect("open_and_migrate");
        std::mem::forget(dir);
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
        let project = flywheel_core::domain::project::create_project(&mut conn, &human, "P", "/repo", "FLY", "main").unwrap();
        let epic = flywheel_core::domain::epic::create_epic(&mut conn, &project.id, &human, "Epic", None).unwrap();
        let mut tasks = Vec::new();
        for (i, raw) in [["a.rs", "b.rs"], ["a.rs", "c.rs"]].iter().enumerate() {
            let task = flywheel_core::domain::task::create_task(&mut conn, &project.id, &human, &format!("T{i}"), Some(&epic.id)).unwrap();
            let entries: Vec<_> = raw.iter().map(|r| flywheel_core::file_set::parse_entry(r).unwrap()).collect();
            flywheel_core::domain::file_set::declare_file_set(&mut conn, &task.id, &entries, &human).unwrap();
            tasks.push(task.id);
        }
        (conn, epic.id, human, tasks)
    }

    #[test]
    fn a_draft_dto_carries_each_tasks_declared_entries_and_previews_the_edges_unfrozen() {
        let (mut conn, epic_id, human, tasks) = two_task_epic();
        let plan_id = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic_id, &human).unwrap();
        let dto = plan_dto(&conn, &plan_id, false).unwrap();
        assert_eq!(dto.status, "draft");
        assert!(!dto.edges_frozen, "a draft's edges are a preview");
        assert_eq!(dto.edges.len(), 1);
        assert_eq!(dto.edges[0].before_task_id, tasks[0]);
        assert_eq!(dto.edges[0].after_task_id, tasks[1]);
        assert_eq!(dto.edges[0].colliding_paths[0].before, "a.rs");
        let first = dto.tasks.iter().find(|t| t.task_id == tasks[0]).unwrap();
        assert_eq!(first.entries, vec!["a.rs".to_string(), "b.rs".to_string()]);
        let stored: i64 = conn.query_row("SELECT COUNT(*) FROM dispatch_edges", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, 0, "reading a draft freezes nothing");
    }

    /// An epic whose tasks declared nothing, approved: the default QuickAdd shape.
    fn undeclared_pair(declare_second: bool) -> (rusqlite::Connection, String, Vec<String>) {
        let (mut conn, epic_id, human, tasks) = two_task_epic();
        // `two_task_epic` declares both; clear the first, and the second too unless asked to keep it.
        flywheel_core::domain::file_set::declare_file_set(&mut conn, &tasks[0], &[], &human).unwrap();
        if !declare_second {
            flywheel_core::domain::file_set::declare_file_set(&mut conn, &tasks[1], &[], &human).unwrap();
        }
        let plan_id = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic_id, &human).unwrap();
        flywheel_core::domain::dispatch_plan::approve_and_start(&mut conn, &plan_id, &human).unwrap();
        (conn, plan_id, tasks)
    }

    fn key_of(conn: &rusqlite::Connection, id: &str) -> String {
        conn.query_row("SELECT key FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn why_for_a_pair_that_declared_nothing_says_runs_alone_naming_both_keys() {
        let (conn, plan_id, tasks) = undeclared_pair(false);
        let dto = why_dto(&conn, &plan_id, &tasks[0], &tasks[1]).unwrap();
        assert_eq!(dto.kind, "runsAlone");
        assert!(dto.sentence.contains("runs alone") || dto.sentence.contains("run alone"), "{}", dto.sentence);
        assert!(dto.sentence.contains(&key_of(&conn, &tasks[0])) && dto.sentence.contains(&key_of(&conn, &tasks[1])), "{}", dto.sentence);
        assert!(!dto.sentence.contains("disjoint"), "{}", dto.sentence);
    }

    #[test]
    fn why_for_a_pair_with_one_undeclared_task_names_that_tasks_key_only() {
        let (conn, plan_id, tasks) = undeclared_pair(true);
        let dto = why_dto(&conn, &plan_id, &tasks[0], &tasks[1]).unwrap();
        assert_eq!(dto.kind, "runsAlone");
        assert!(dto.sentence.contains(&key_of(&conn, &tasks[0])), "{}", dto.sentence);
        assert!(dto.sentence.contains("runs alone"), "{}", dto.sentence);
        assert!(dto.sentence.contains("no declared file-set"), "{}", dto.sentence);
    }

    #[test]
    fn why_for_a_disjoint_declared_pair_keeps_its_exact_sentence() {
        let (mut conn, epic_id, human, tasks) = two_task_epic();
        let b = [flywheel_core::file_set::parse_entry("x.rs").unwrap()];
        let c = [flywheel_core::file_set::parse_entry("y.rs").unwrap()];
        flywheel_core::domain::file_set::declare_file_set(&mut conn, &tasks[0], &b, &human).unwrap();
        flywheel_core::domain::file_set::declare_file_set(&mut conn, &tasks[1], &c, &human).unwrap();
        let plan_id = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic_id, &human).unwrap();
        flywheel_core::domain::dispatch_plan::approve_and_start(&mut conn, &plan_id, &human).unwrap();
        let dto = why_dto(&conn, &plan_id, &tasks[0], &tasks[1]).unwrap();
        assert_eq!(dto.kind, "disjointSets");
        assert_eq!(
            dto.sentence,
            format!("{} and {} declare disjoint sets, so neither waits for the other.", key_of(&conn, &tasks[0]), key_of(&conn, &tasks[1]))
        );
    }

    #[test]
    fn an_approved_plans_dto_returns_the_frozen_edges_not_a_preview() {
        let (mut conn, epic_id, human, _) = two_task_epic();
        let plan_id = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic_id, &human).unwrap();
        flywheel_core::domain::dispatch_plan::approve_and_start(&mut conn, &plan_id, &human).unwrap();
        let dto = plan_dto(&conn, &plan_id, false).unwrap();
        assert!(dto.edges_frozen);
        assert_eq!(dto.edges.len(), 1);
    }

    #[test]
    fn a_running_planning_run_is_reported_for_its_epic_until_it_ends() {
        let (mut conn, epic_id, human, _) = two_task_epic();
        assert!(planning_run_for_epic(&conn, &epic_id).unwrap().is_none());
        let run_id = flywheel_core::domain::dispatch_plan::start_planning_run_row(
            &mut conn,
            &epic_id,
            &human,
            PLANNING_PERMISSION_MODE,
            |_| Ok(()),
        )
        .unwrap();
        let found = planning_run_for_epic(&conn, &epic_id).unwrap().expect("the run is reported");
        assert_eq!(found.run_id, run_id);
        assert_eq!(found.epic_id, epic_id);
        flywheel_core::domain::agent_run::close_agent_run(
            &mut conn,
            &run_id,
            flywheel_core::domain::agent_run::AgentRunStatus::Failed,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(planning_run_for_epic(&conn, &epic_id).unwrap().is_none(), "an ended run is not in progress");
    }
}
