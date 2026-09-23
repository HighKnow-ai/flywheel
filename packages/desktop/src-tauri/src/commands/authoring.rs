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
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::agent_run::CriterionDto;
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

/// One `agent_runs` row projected for the renderer (camelCase), as read back after
/// [`authoring_run_start`] or [`authoring_run_for_epic`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringRunDto {
    pub id: String,
    pub epic_id: Option<String>,
    pub status: String,
    pub authoring_stage: Option<String>,
    /// `true` when this row names an ALREADY-running/blocked authoring session for the epic a
    /// caller named — plan 05-10's "route to it, start no second run" guard
    /// ([`find_running_authoring_run`]). `false` for a genuinely fresh start. The renderer treats
    /// both cases identically (open the session surface on `id`) — this field exists so a test
    /// can assert "no second run was created" by call count without inspecting the database.
    pub resumed: bool,
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

/// The run currently `running`/`blocked` for `epic_id`, if any (plan 05-10) — the ONE place "is
/// this epic already being shaped" is answered, shared by [`authoring_run_start`]'s own
/// defensive re-check and [`authoring_run_for_epic`]'s door-level pre-flight read, so the two can
/// never disagree about what counts as "already running". `authoring_stage IS NOT NULL` is what
/// scopes this to an authoring run specifically — an ordinary task-execution run never carries a
/// stage, and shares no identity space with an epic id regardless.
fn find_running_authoring_run(
    conn: &rusqlite::Connection,
    epic_id: &str,
) -> Result<Option<AuthoringRunDto>, String> {
    conn.query_row(
        "SELECT id, epic_id, status, authoring_stage FROM agent_runs \
         WHERE epic_id = ?1 AND authoring_stage IS NOT NULL AND status IN ('running', 'blocked') \
         ORDER BY started_at DESC LIMIT 1",
        rusqlite::params![epic_id],
        |row| {
            Ok(AuthoringRunDto {
                id: row.get(0)?,
                epic_id: row.get(1)?,
                status: row.get(2)?,
                authoring_stage: row.get(3)?,
                resumed: true,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// The door's own pre-flight read (plan 05-10): does `epic_id` already have a running/blocked
/// authoring session? A pure read — never starts anything, never spends anything — so a "Continue
/// shaping" action can decide whether to open the briefing preview (nothing running yet) or route
/// straight to the live session (one already is) before doing either.
#[tauri::command]
pub fn authoring_run_for_epic(
    state: State<AppState>,
    epic_id: String,
) -> Result<Option<AuthoringRunDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    find_running_authoring_run(&conn, &epic_id)
}

/// Start an epic-authoring session — a fresh one when `epic_id` is `None` (SHAPE-01) or a
/// reopened one when it names an existing epic (SHAPE-05, plan 05-10). Reopening is the SAME start
/// path with a subject, not a second flow: `epic_id` threads straight through to both
/// `start_authoring_run` and `assemble_epic_context_packet`, and the packet's own rendered prompt
/// — never a hand-written opening line — is what the session is spawned with in every case,
/// including the fresh-epic one (a short sheet, per `render_epic_prompt`'s own omit-the-heading
/// rule, is still a real briefing). If `epic_id` already has a running/blocked authoring session,
/// this returns THAT run (`resumed: true`) instead of starting a second one
/// ([`find_running_authoring_run`]) — two concurrent shaping sessions on one epic would stage two
/// proposal sets against the same rejected history with no way to reconcile them.
///
/// Mirrors `agent_run::agent_run_start`'s own body order for the same reason: read
/// `projects.repo_path` and resolve the credential BEFORE any row is created (D-39), then call
/// `domain::authoring_session::start_authoring_run`, merge the shim env, and send an
/// `authoring_spawn` request carrying `repo_path` as the session's `cwd` — never a worktree path
/// (D-86). Emits `board:changed` exactly as `agent_run_start` does.
#[tauri::command]
pub fn authoring_run_start(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    epic_id: Option<String>,
) -> Result<AuthoringRunDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    // T-05-10-02: refuse a second concurrent session on the same epic, plainly — the caller
    // (either door) already has enough to route straight to the running one instead.
    if let Some(epic_id) = epic_id.as_deref() {
        if let Some(existing) = find_running_authoring_run(&conn, epic_id)? {
            return Ok(existing);
        }
    }

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

    // T-05-10-01: the packet is assembled with BOTH `project_id` and `epic_id` bound through
    // `params![]` — `assemble_epic_context_packet` itself refuses (`Err`) an `epic_id` outside
    // `project_id`, so a renderer-supplied epic id can never prime a session with another
    // project's facts.
    let packet = flywheel_core::epic_context_packet::assemble_epic_context_packet(
        &conn,
        &project_id,
        epic_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let opening_prompt = flywheel_core::epic_context_packet::render_epic_prompt(&packet);

    let run = flywheel_core::domain::authoring_session::start_authoring_run(
        &mut conn,
        &project_id,
        epic_id.as_deref(),
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
            "prompt": opening_prompt,
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
        resumed: false,
    })
}

// ---------------------------------------------------------------------------------------------
// The epic-authoring briefing preview (D-27's launch sheet, extended to an authoring subject —
// plan 05-10 Task 1(c)). Mirrors `commands/agent_run.rs`'s `ContextPacketDto`/`agent_run_preview`
// pair field-for-field in spirit: a read-only DTO plus a thin command, so "what will this session
// be told" is visible before Start Shaping ever spends a token. `EpicContextPacket`'s own fields
// are snake_case Rust with no `serde(rename_all)` of their own (`epic_context_packet.rs`'s own
// purity contract has nothing to say about wire casing) — every DTO below is the camelCase
// projection this command layer owns, exactly as `ContextPacketDto` owns it for the task-scoped
// packet.
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicFactsDto {
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRosterEntryDto {
    pub key: String,
    pub title: String,
    pub status: String,
    pub criteria: Vec<CriterionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssumptionEntryDto {
    pub assumption: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedProposalEntryDto {
    pub target_type: String,
    /// The payload's own title/statement/assumption text alone (`ProposalPayload::label`) —
    /// never the full typed payload, matching `FoldedRejectedProposal`'s own narrative-dropped
    /// shape one field down.
    pub label: String,
    pub rejection_reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldedRejectedProposalDto {
    pub target_type: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectionBoundaryDto {
    pub total: usize,
    pub verbatim_count: usize,
    pub folded_count: usize,
    /// `None` when nothing folded (`RejectionBoundary::boundary_sentence`'s own omit contract) —
    /// the sheet renders the fold boundary only when there is one to show.
    pub boundary_sentence: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSetDto {
    pub verbatim: Vec<RejectedProposalEntryDto>,
    pub folded: Vec<FoldedRejectedProposalDto>,
    pub boundary: RejectionBoundaryDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringRunEntryDto {
    pub id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub stage_reached: Option<String>,
    pub summary_changed_prose: Option<String>,
}

/// The epic-authoring launch sheet's read-only briefing (plan 05-10 Task 1(c)) — the packet's
/// structured fields AND the rendered prompt string (`render_epic_prompt`), so the sheet displays
/// exactly the text the session will be spawned with rather than re-deriving its own rendering in
/// TypeScript. Mirrors `ContextPacketDto`'s own "one renderer, in Rust" discipline.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicContextPacketDto {
    pub epic: Option<EpicFactsDto>,
    pub task_roster: Vec<TaskRosterEntryDto>,
    pub answered_assumptions: Vec<AssumptionEntryDto>,
    pub rejected: RejectedSetDto,
    pub prior_authoring_runs: Vec<AuthoringRunEntryDto>,
    pub rendered_prompt: String,
}

impl From<flywheel_core::epic_context_packet::EpicContextPacket> for EpicContextPacketDto {
    fn from(packet: flywheel_core::epic_context_packet::EpicContextPacket) -> Self {
        // Rendered from the packet BEFORE any field below is consumed — the same "one renderer"
        // rule `ContextPacketDto::from` follows for the task-scoped packet.
        let rendered_prompt = flywheel_core::epic_context_packet::render_epic_prompt(&packet);

        let epic = packet.epic.map(|e| EpicFactsDto {
            key: e.key,
            title: e.title,
            description: e.description,
            status: e.status,
        });

        let task_roster = packet
            .task_roster
            .into_iter()
            .map(|t| TaskRosterEntryDto {
                key: t.key,
                title: t.title,
                status: t.status,
                criteria: t
                    .criteria
                    .into_iter()
                    .map(|c| CriterionDto {
                        statement: c.statement,
                        verification_hint: c.verification_hint,
                    })
                    .collect(),
            })
            .collect();

        let answered_assumptions = packet
            .answered_assumptions
            .into_iter()
            .map(|a| AssumptionEntryDto { assumption: a.assumption, answer: a.answer })
            .collect();

        let boundary_sentence = packet.rejected.boundary.boundary_sentence();
        let rejected = RejectedSetDto {
            verbatim: packet
                .rejected
                .verbatim
                .into_iter()
                .map(|r| RejectedProposalEntryDto {
                    target_type: r.target_type,
                    label: r.payload.label().to_string(),
                    rejection_reason: r.rejection_reason,
                    created_at: r.created_at,
                })
                .collect(),
            folded: packet
                .rejected
                .folded
                .into_iter()
                .map(|f| FoldedRejectedProposalDto {
                    target_type: f.target_type,
                    label: f.label,
                    created_at: f.created_at,
                })
                .collect(),
            boundary: RejectionBoundaryDto {
                total: packet.rejected.boundary.total,
                verbatim_count: packet.rejected.boundary.verbatim_count,
                folded_count: packet.rejected.boundary.folded_count,
                boundary_sentence,
            },
        };

        let prior_authoring_runs = packet
            .prior_authoring_runs
            .into_iter()
            .map(|r| AuthoringRunEntryDto {
                id: r.id,
                started_at: r.started_at,
                ended_at: r.ended_at,
                stage_reached: r.stage_reached,
                summary_changed_prose: r.summary_changed_prose,
            })
            .collect();

        Self { epic, task_roster, answered_assumptions, rejected, prior_authoring_runs, rendered_prompt }
    }
}

/// Preview the epic-scoped briefing an [`authoring_run_start`] against `project_id`/`epic_id`
/// would send (D-27's launch sheet, extended here) — a read: it mutates nothing, spawns nothing,
/// writes no trigger row and starts no process, exactly the "nothing happens until Start Shaping
/// fires" property [`agent_run_preview`](super::agent_run::agent_run_preview) already holds for
/// the task-scoped sheet. `epic_id = None` previews the fresh-epic case — a short sheet with most
/// sections absent, never an error.
#[tauri::command]
pub fn authoring_preview_epic_packet(
    state: State<AppState>,
    project_id: String,
    epic_id: Option<String>,
) -> Result<EpicContextPacketDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let packet = flywheel_core::epic_context_packet::assemble_epic_context_packet(
        &conn,
        &project_id,
        epic_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(packet.into())
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

/// Per-status proposal counts (`query::authoring::ProposalStatusCounts`), projected for the
/// renderer — the triage lane header's own "N pending, M total" read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalStatusCountsDto {
    pub pending: i64,
    pub accepted: i64,
    pub rejected: i64,
}

impl From<flywheel_core::query::authoring::ProposalStatusCounts> for ProposalStatusCountsDto {
    fn from(counts: flywheel_core::query::authoring::ProposalStatusCounts) -> Self {
        Self { pending: counts.pending, accepted: counts.accepted, rejected: counts.rejected }
    }
}

/// [`authoring_proposals_pending`]'s return shape — the bounded window plus the project's
/// per-status counts, so the triage lane can report its own scale without a second round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalWindowDto {
    pub proposals: Vec<ProposalDto>,
    pub counts: ProposalStatusCountsDto,
}

/// The opaque resume point the triage lane echoes back unchanged from the last row of the prior
/// window it received — mirrors `commands/board.rs`'s `BoardCursorInput` doc comment: the
/// renderer never constructs one from scratch, only forwards it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalCursorInput {
    pub created_at: String,
    pub id: String,
}

/// The board-level triage lane's own read (D-82) — every PENDING proposal across `project_id`,
/// bounded and clamped through the SAME `resolve_limit` idiom `commands/board.rs` uses (redeclared
/// at this module's own top, per this file's own header comment). Calls only
/// `query::authoring::list_pending_proposals` — never a second read path the tray and this lane
/// could disagree about.
#[tauri::command]
pub fn authoring_proposals_pending(
    state: State<AppState>,
    project_id: String,
    limit: Option<i64>,
    cursor: Option<ProposalCursorInput>,
) -> Result<ProposalWindowDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_limit = resolve_limit(limit);
    let cursor_ref = cursor.as_ref().map(|c| (c.created_at.as_str(), c.id.as_str()));
    let window = flywheel_core::query::authoring::list_pending_proposals(
        &conn,
        &project_id,
        resolved_limit,
        cursor_ref,
    )
    .map_err(|e| e.to_string())?;
    Ok(ProposalWindowDto {
        proposals: window.proposals.into_iter().map(ProposalDto::from).collect(),
        counts: window.counts.into(),
    })
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

/// Accept a subtree — a proposed task together with its drafted criteria (D-95, plan 05-06's ONE
/// bulk path). Resolves the local human actor server-side, calls straight through to
/// `domain::authoring_proposal::accept_subtree`, and emits `board:changed` for both the
/// materialised root task and the run the proposal came from.
#[tauri::command]
pub fn authoring_subtree_accept(
    state: State<AppState>,
    app: AppHandle,
    root_proposal_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome = flywheel_core::domain::authoring_proposal::accept_subtree(
        &mut conn,
        &root_proposal_id,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    let agent_run_id: String = conn
        .query_row(
            "SELECT agent_run_id FROM authoring_proposals WHERE id = ?1",
            rusqlite::params![root_proposal_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "task", "id": outcome.root_materialised_id }),
    )
    .ok();
    app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": agent_run_id }))
        .ok();

    Ok(())
}

/// Reject a pending proposal (D-93) — the deciding human actor is resolved server-side, exactly
/// like every other command in this workspace. Delegates to `domain::authoring_proposal::reject_proposal`
/// (DB-only), then relays the decision to the live session as an `authoring_turn` (D-93's "not a
/// verdict, propose something better" wording) — a missing sidecar handle or a delivery failure is
/// swallowed here, never surfaced as a command error, matching `authoring_stage_advance`'s
/// identical "delivery is best-effort" discipline.
#[tauri::command]
pub fn authoring_proposal_reject(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let proposal = flywheel_core::domain::authoring_proposal::reject_proposal(
        &mut conn,
        &proposal_id,
        &human_actor_id,
        reason.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": proposal.agent_run_id }),
    )
    .ok();

    if let Some(sidecar) = state.sidecar.as_ref() {
        let turn = flywheel_core::domain::authoring_session::ProposalDecisionTurn::Rejected {
            target_type: proposal.target_type.clone(),
            label: proposal.payload.label().to_string(),
            reason: proposal.rejection_reason.clone(),
        };
        let text = flywheel_core::domain::authoring_session::render_decision_turn(&turn);
        let _ = sidecar.send_authoring_turn(
            &app,
            &proposal.agent_run_id,
            &text,
            crate::sidecar::AuthoringTurnOrigin::Application,
        );
    }

    Ok(())
}

/// Amend a pending proposal (D-94) — edit the staged row's payload to the developer's own text,
/// leaving it `pending`. `payload` is the same JSON shape `ProposalDto.payload` carries (a
/// `ProposalPayload` with its `kind` discriminant). Resolves the human actor server-side, delegates
/// to `domain::authoring_proposal::amend_proposal` (DB-only), then relays D-94's "this is my own
/// text" wording to the live session — the same best-effort delivery discipline
/// [`authoring_proposal_reject`] follows immediately above.
#[tauri::command]
pub fn authoring_proposal_amend(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
    payload: serde_json::Value,
) -> Result<ProposalDto, String> {
    let payload: flywheel_core::domain::authoring_proposal::ProposalPayload =
        serde_json::from_value(payload).map_err(|e| e.to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome = flywheel_core::domain::authoring_proposal::amend_proposal(
        &mut conn,
        &proposal_id,
        &human_actor_id,
        payload,
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": outcome.proposal.agent_run_id }),
    )
    .ok();

    if let Some(sidecar) = state.sidecar.as_ref() {
        let turn = flywheel_core::domain::authoring_session::ProposalDecisionTurn::Amended {
            target_type: outcome.proposal.target_type.clone(),
            original_label: outcome.original_label.clone(),
            new_text: outcome.proposal.payload.label().to_string(),
        };
        let text = flywheel_core::domain::authoring_session::render_decision_turn(&turn);
        let _ = sidecar.send_authoring_turn(
            &app,
            &outcome.proposal.agent_run_id,
            &text,
            crate::sidecar::AuthoringTurnOrigin::Application,
        );
    }

    Ok(outcome.proposal.into())
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
            let _ = sidecar.send_authoring_turn(
                &app,
                &agent_run_id,
                &instruction.text,
                crate::sidecar::AuthoringTurnOrigin::Application,
            );
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

/// The maximum length (in `char`s) of a developer's own typed turn (T-05-12-01, T-05-12-07) —
/// generous enough for real conversational prose rather than a title, deliberately much larger than
/// `domain::authoring_proposal`'s own `MAX_PROPOSAL_TITLE_LEN`/`MAX_PROPOSAL_TEXT_LEN` (500/1000)
/// bounds, which cap a single STAGED FIELD rather than free conversation.
const MAX_AUTHORING_TURN_TEXT_LEN: usize = 8000;

/// Send a developer's own typed turn into a live authoring session (SHAPE-01, plan 05-12 Task 1) —
/// the one seam between the developer and the conversation the challenge stage otherwise has no
/// human channel for. Body order follows [`authoring_stage_advance`] immediately above: validate
/// first, read the run's own row to confirm it can still receive a turn, then relay.
///
/// Unlike [`authoring_proposal_reject`]/[`authoring_proposal_amend`]/[`authoring_stage_advance`]'s
/// own system-generated relays — each deliberately best-effort, since a distillation request or a
/// decision echo failing to land is not something the developer is waiting on — THIS relay
/// **surfaces its failure**: a developer who pressed send is entitled to know their own words did
/// not reach the session, so a missing sidecar handle or a failed send returns an `Err` here rather
/// than being swallowed.
///
/// No board row is written and no `events` row is appended — a turn is conversation, not a board
/// mutation, so there is no actor to resolve here and nothing for `board:changed` to announce
/// (contrast every neighbouring command above, which does resolve an actor and does emit). Nothing
/// in this command touches the run's `authoring_stage` and nothing reaches a proposal-writing tool:
/// a turn is a turn — D-88's tool gate and D-90's human-only advance are both untouched.
#[tauri::command]
pub fn authoring_turn_send(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
    text: String,
) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("message must not be empty".to_string());
    }
    let char_count = trimmed.chars().count();
    if char_count > MAX_AUTHORING_TURN_TEXT_LEN {
        return Err(format!(
            "message must be at most {MAX_AUTHORING_TURN_TEXT_LEN} characters, got {char_count} characters"
        ));
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (authoring_stage, status): (Option<String>, String) = conn
        .query_row(
            "SELECT authoring_stage, status FROM agent_runs WHERE id = ?1",
            rusqlite::params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    drop(conn);

    if authoring_stage.is_none() {
        return Err("agent run is not an authoring session — it has no conversation to join".to_string());
    }
    let can_receive_turn = matches!(status.as_str(), "running" | "blocked");
    if !can_receive_turn {
        return Err(format!(
            "this conversation has already ended (status = {status:?}) — the message was not sent"
        ));
    }

    let Some(sidecar) = state.sidecar.as_ref() else {
        return Err("no live session to send this message to".to_string());
    };
    sidecar
        .send_authoring_turn(
            &app,
            &agent_run_id,
            trimmed,
            crate::sidecar::AuthoringTurnOrigin::Developer,
        )
        .map_err(|e| e.to_string())
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
