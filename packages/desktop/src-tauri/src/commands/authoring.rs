//! `authoring_run_start` / `authoring_proposals_for_run` / `authoring_proposal_accept` (D-84,
//! D-80/D-81, D-86, plan 05-02): the desktop command surface for an epic-authoring session —
//! `authoring_run_start` is `agent_run_start`'s sibling (same order for the same reason: resolve
//! `repo_path` and the credential BEFORE any row is created, D-39), `authoring_proposals_for_run`
//! is the tray's own bounded read (`board.rs`'s `resolve_limit` idiom, copied here rather than
//! shared, since this module has its own domain-layer clamp already), and
//! `authoring_proposal_accept` is the ONLY path that ever turns a staged proposal into a real
//! board row — resolving the human actor server-side, exactly like every other command in this
//! workspace (never from the renderer).
//!
//! `handle_inbound_proposal_created`, called from `sidecar.rs`'s reader loop, is the inbound half
//! of the same round trip `handle_inbound_summary_reported` already established: the DB-only
//! decision (`flywheel_core::domain::authoring_proposal::apply_proposal_created`) stays testable
//! without a real spawned sidecar, and this half performs the IPC-adjacent `board:changed` emit
//! the outcome implies.

use anyhow::Context;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

/// The tray's own read window, mirroring `commands/board.rs`'s `DEFAULT_LIMIT`/`MAX_LIMIT`/
/// `resolve_limit` idiom (lines 11-19) at the command layer — independent of, and tighter than,
/// the domain layer's own `pending_proposals_for_run` clamp (T-05-02-04's belt-and-suspenders).
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;

fn resolve_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// D-86: the authoring agent runs READ-ONLY in the project's main checkout. `agent_run_start`'s
/// own `permission_mode` is caller-supplied (the operator's own launch-sheet choice); an
/// authoring session has no such choice to make — D-86 overrides D-36's `acceptEdits` default
/// unconditionally, so this is a fixed literal, not a parameter.
const AUTHORING_PERMISSION_MODE: &str = "default";

/// The opening turn every fresh authoring session is started with (D-88's `challenge` stage: the
/// agent is told to challenge, not interview, and that it has no proposal tool yet).
const AUTHORING_OPENING_PROMPT: &str = "I want to shape a new epic. Challenge my framing with \
    clarifying questions before proposing any structure — you have no tool to stage a proposal \
    until I tell you the challenge is done.";

/// One `agent_runs` row projected for the renderer (camelCase), as read back after
/// [`authoring_run_start`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringRunDto {
    pub id: String,
    pub epic_id: Option<String>,
    pub status: String,
    pub authoring_stage: Option<String>,
}

/// One `authoring_proposals` row projected for the renderer (camelCase) — mirrors
/// `flywheel_core::domain::authoring_proposal::Proposal` field-for-field. `payload` stays a raw
/// `serde_json::Value` here rather than a typed DTO: the tray only ever needs to read `title`/
/// `targetType` out of it for this plan's one supported shape, and re-typing it on the wire would
/// duplicate `ProposalPayload`'s own `kind` discriminant for no reader this plan has yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDto {
    pub id: String,
    pub agent_run_id: String,
    pub epic_id: Option<String>,
    pub verb: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub parent_proposal_id: Option<String>,
    pub position: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub created_by: String,
    pub created_at: String,
}

impl From<flywheel_core::domain::authoring_proposal::Proposal> for ProposalDto {
    fn from(proposal: flywheel_core::domain::authoring_proposal::Proposal) -> Self {
        Self {
            id: proposal.id,
            agent_run_id: proposal.agent_run_id,
            epic_id: proposal.epic_id,
            verb: proposal.verb,
            target_type: proposal.target_type,
            target_id: proposal.target_id,
            parent_proposal_id: proposal.parent_proposal_id,
            position: proposal.position,
            payload: serde_json::to_value(&proposal.payload).unwrap_or(serde_json::Value::Null),
            status: proposal.status,
            created_by: proposal.created_by,
            created_at: proposal.created_at,
        }
    }
}

/// Start a fresh epic-authoring session against no existing epic (SHAPE-01's own case; a
/// reopened-epic session is a later plan's concern). Mirrors `agent_run::agent_run_start`'s own
/// body order for the same reason: read `projects.repo_path` and resolve the credential BEFORE
/// any row is created (D-39), then call `domain::authoring_session::start_authoring_run`, merge
/// the shim env, and send an `authoring_spawn` request carrying `repo_path` as the session's
/// `cwd` — never a worktree path (D-86). Emits `board:changed` exactly as `agent_run_start` does.
#[tauri::command]
pub fn authoring_run_start(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
) -> Result<AuthoringRunDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    // D-39/D-86: repo_path resolved and the credential resolved BEFORE any run is created — the
    // same discipline `agent_run_start` applies, adapted for the project's registered main
    // checkout rather than a task's worktree.
    let repo_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut env = crate::sidecar::resolved_env_for_run(&conn, &project_id).map_err(|e| e.to_string())?;

    let run = flywheel_core::domain::authoring_session::start_authoring_run(
        &mut conn,
        &project_id,
        None,
        AUTHORING_PERMISSION_MODE,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    // D-51: the shim's per-run directory is keyed by the run id, which only exists from this
    // point on — mirrors `agent_run_start`'s own ordering.
    crate::sidecar::merge_shim_env_for_run(&mut env, &run.id).map_err(|e| e.to_string())?;

    drop(conn);

    if let Some(sidecar) = state.sidecar.as_ref() {
        let request = serde_json::json!({
            "id": run.id,
            "op": "authoring_spawn",
            "runId": run.id,
            "repoPath": repo_path,
            "prompt": AUTHORING_OPENING_PROMPT,
            "permissionMode": AUTHORING_PERMISSION_MODE,
            "env": env,
        });
        sidecar
            .send_spawn_request(&repo_path, &request.to_string())
            .map_err(|e| e.to_string())?;
    }

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": run.id }),
    )
    .ok();

    Ok(AuthoringRunDto {
        id: run.id,
        epic_id: run.epic_id,
        status: "running".to_string(),
        authoring_stage: run.authoring_stage,
    })
}

/// Every pending proposal staged for `agent_run_id`, bounded — the proposal tray's own read.
#[tauri::command]
pub fn authoring_proposals_for_run(
    state: State<AppState>,
    agent_run_id: String,
    limit: Option<i64>,
) -> Result<Vec<ProposalDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_limit = resolve_limit(limit);
    let proposals = flywheel_core::domain::authoring_proposal::pending_proposals_for_run(
        &conn,
        &agent_run_id,
        resolved_limit,
    )
    .map_err(|e| e.to_string())?;
    Ok(proposals.into_iter().map(ProposalDto::from).collect())
}

/// Accept a pending proposal (D-92/D-96) — the ONLY path that ever turns a staged proposal into a
/// real board row. Resolves the local human actor SERVER-SIDE (never from the renderer, matching
/// every other command in this workspace), calls straight through to
/// `domain::authoring_proposal::accept_proposal`, and emits `board:changed` for both the newly
/// materialised task and the run the proposal came from.
#[tauri::command]
pub fn authoring_proposal_accept(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome =
        flywheel_core::domain::authoring_proposal::accept_proposal(&mut conn, &proposal_id, &human_actor_id)
            .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "task", "id": outcome.materialised_id }),
    )
    .ok();
    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": outcome.proposal.agent_run_id }),
    )
    .ok();

    Ok(())
}

/// Advance `agent_run_id` to its next authoring stage (D-88, D-90, plan 05-03) — the ONE gate the
/// whole phase depends on, resolving the local human actor server-side (never from the renderer,
/// matching `authoring_proposal_accept`'s own discipline immediately above). Thin wrapper over
/// `domain::authoring_session::advance_stage`; emits `board:changed` for the run so the stage
/// indicator (`SessionSurface.tsx`) and any other consumer of this run's row re-read it.
///
/// D-89 (plan 05-05): when `advance_stage` returns a distillation instruction (advancing OUT of
/// `challenge`), it is relayed to the live session as an `authoring_turn` — AFTER the stage row
/// has already committed above. Distillation is a REQUEST, not a precondition: a missing sidecar
/// handle or a delivery failure is swallowed here (never surfaced as a command error), matching
/// the plan's own "the stage advances even when the turn cannot be delivered" requirement — a
/// stage machine that cannot move because a model declined (or a process is not reachable) to
/// emit a row is a worse failure than a thin assumption record.
#[tauri::command]
pub fn authoring_stage_advance(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let (stage, distillation) = flywheel_core::domain::authoring_session::advance_stage(
        &mut conn,
        &agent_run_id,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": agent_run_id }),
    )
    .ok();

    if let Some(instruction) = distillation {
        if let Some(sidecar) = state.sidecar.as_ref() {
            let _ = sidecar.send_authoring_turn(&agent_run_id, &instruction.text);
        }
    }

    Ok(stage.as_str().to_string())
}

/// Return `agent_run_id` to an earlier authoring stage (D-90, plan 05-03) — the other half of the
/// one gate D-90 reserves for the developer. Mirrors [`authoring_stage_advance`] exactly: resolves
/// the human actor server-side, calls straight through to
/// `domain::authoring_session::return_to_stage`, and emits the same `board:changed` shape.
#[tauri::command]
pub fn authoring_stage_return(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
    stage: String,
) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let resolved = flywheel_core::domain::authoring_session::return_to_stage(
        &mut conn,
        &agent_run_id,
        &stage,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": agent_run_id }),
    )
    .ok();

    Ok(resolved.as_str().to_string())
}

/// The Tauri-facing half of the inbound `proposal_created` path (D-80/D-81), called from
/// `sidecar.rs`'s reader loop for every `proposal_created` event — mirrors
/// `agent_run::handle_inbound_summary_reported` line for line: the DB-only decision stays
/// testable without a real spawned sidecar, and this half performs the `board:changed` emit the
/// outcome implies.
///
/// This function must never panic — no `expect`, no `unwrap`, no direct indexing: a malformed
/// event, a poisoned lock, or an error from the applier is a silent no-op here, matching
/// `sidecar.rs`'s own "a malformed line never crashes the reader task" discipline.
pub fn handle_inbound_proposal_created(app: &AppHandle, event: &serde_json::Value) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Ok(mut conn) = state.db.lock() else { return };

    let outcome =
        match flywheel_core::domain::authoring_proposal::apply_proposal_created(&mut conn, event) {
            Ok(outcome) => outcome,
            Err(_) => return,
        };

    drop(conn);

    if let flywheel_core::domain::authoring_proposal::ProposalOutcome::Created(proposal) = outcome {
        let _ = app.emit(
            "board:changed",
            serde_json::json!({ "entity": "agent_run", "id": proposal.agent_run_id }),
        );
    }
}

/// D-87 (plan 05-05): the inbound half of the board-read round trip — called from `sidecar.rs`'s
/// reader loop for every `board_read_request` event. Resolves the run's own `project_id` from
/// `agent_runs` INSIDE the query it runs (never trusts anything the event itself might claim
/// about scope — T-05-05-03), dispatches on `readKind` to exactly one `query::authoring` function
/// (never anything outside that module — 05-RESEARCH.md Pitfall 4), and relays the answer back
/// over the sidecar's own stdin via `SidecarHandle::relay_authoring_read_answer`. This function must
/// never panic: a malformed event, a poisoned lock, or a query error becomes an `error` string
/// relayed back to the waiting call, never a crash of this shared reader loop (mirrors
/// `handle_inbound_proposal_created`'s own discipline).
pub fn handle_inbound_board_read_request(app: &AppHandle, event: &serde_json::Value) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(sidecar) = state.sidecar.as_ref() else { return };

    let (Some(run_id), Some(request_id), Some(read_kind)) = (
        event.get("runId").and_then(|v| v.as_str()),
        event.get("requestId").and_then(|v| v.as_str()),
        event.get("readKind").and_then(|v| v.as_str()),
    ) else {
        return;
    };

    // Resolved the SAME way `query::authoring::resolve_limit` resolves it — computed here (not
    // only inside the query function, which clamps a second time regardless — belt-and-suspenders)
    // so this handler can request one row PAST the resolved limit and detect truncation itself,
    // rather than trusting a page's own length to tell it (05-RESEARCH.md Pitfall 4: a reader that
    // thinks it has seen everything is the exact failure a bounded-but-silent page produces).
    let requested_limit = event.get("limit").and_then(|v| v.as_i64()).unwrap_or(0);
    let resolved_limit = if requested_limit <= 0 {
        flywheel_core::query::authoring::DEFAULT_LIMIT
    } else {
        requested_limit
    }
    .min(flywheel_core::query::authoring::MAX_LIMIT);
    // One past the resolved limit, itself clamped at MAX_LIMIT — a request already sitting at the
    // ceiling cannot peek past it, which is an accepted, documented edge case (truncation at the
    // exact ceiling reads `false` rather than `true`), not a silent unbounded read.
    let peek_limit = (resolved_limit + 1).min(flywheel_core::query::authoring::MAX_LIMIT);

    let result: Result<serde_json::Value, String> = (|| -> anyhow::Result<serde_json::Value> {
        let conn = state
            .db
            .lock()
            .map_err(|_| anyhow::anyhow!("db mutex poisoned"))?;
        let project_id: String = conn
            .query_row(
                "SELECT project_id FROM agent_runs WHERE id = ?1",
                rusqlite::params![run_id],
                |row| row.get(0),
            )
            .context("agent_run not found for a board read request")?;

        match read_kind {
            "search" => {
                let term = event.get("term").and_then(|v| v.as_str()).unwrap_or("");
                let mut items = flywheel_core::query::authoring::search_board_for_agent(
                    &conn, &project_id, term, peek_limit,
                )?;
                let truncated = items.len() as i64 > resolved_limit;
                items.truncate(resolved_limit.max(0) as usize);
                let items_json: Vec<serde_json::Value> = items
                    .iter()
                    .map(|item| {
                        serde_json::json!({
                            "id": item.id,
                            "kind": item.kind,
                            "key": item.key,
                            "title": item.title,
                            "status": item.status,
                            "epicId": item.epic_id,
                        })
                    })
                    .collect();
                // 05-RESEARCH.md Pitfall 4 / D-87: a true `total` for an FTS match count would
                // need a second, separately-maintained count query mirroring `search_items`'s own
                // predicate — out of this plan's proportionate scope. `truncated` alone already
                // tells the model it is looking at a page, never the whole board.
                Ok(serde_json::json!({ "items": items_json, "truncated": truncated }))
            }
            "get_epic" => {
                let epic_id = event.get("epicId").and_then(|v| v.as_str()).unwrap_or("");
                let epic = flywheel_core::query::authoring::get_epic_for_agent(
                    &conn, &project_id, epic_id,
                )?;
                let found = epic.is_some();
                Ok(serde_json::json!({ "epic": epic, "found": found }))
            }
            "list_tasks" => {
                let epic_id = event.get("epicId").and_then(|v| v.as_str()).unwrap_or("");
                // Server-side scoping (T-05-05-03): confirm the epic is this run's own project's
                // BEFORE listing its tasks — an epic_id from another project reads not-found
                // rather than the row, never distinguishable from "this epic does not exist".
                let scoped = flywheel_core::query::authoring::get_epic_for_agent(
                    &conn, &project_id, epic_id,
                )?;
                if scoped.is_none() {
                    return Ok(serde_json::json!({
                        "tasks": [], "found": false, "truncated": false, "total": 0
                    }));
                }
                let mut tasks = flywheel_core::query::authoring::list_tasks_for_epic(
                    &conn, epic_id, peek_limit,
                )?;
                let truncated = tasks.len() as i64 > resolved_limit;
                tasks.truncate(resolved_limit.max(0) as usize);
                let total: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM tasks WHERE epic_id = ?1",
                        rusqlite::params![epic_id],
                        |row| row.get(0),
                    )
                    .context("failed to count the epic's own tasks")?;
                Ok(serde_json::json!({
                    "tasks": tasks, "found": true, "truncated": truncated, "total": total
                }))
            }
            other => anyhow::bail!("unknown board read kind {other:?}"),
        }
    })()
    .map_err(|e| e.to_string());

    let _ = sidecar.relay_authoring_read_answer(run_id, request_id, result);
}
