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
//!
//! Plan 06-05 (PROP-05, D-108/D-111): `handle_inbound_proposal_created`'s `Created` arm now also
//! resolves an optional `duplicateCandidate` (kind/key/title/score) through ONE bounded lookup
//! (`query::authoring::resolve_duplicate_candidate_label`) and folds it into the relayed answer —
//! present only when the staged proposal actually carries a `duplicate_of`, so a plain staging
//! answer with no candidate is byte-identical to what it was before this plan. Its
//! `LimitExhausted` arm relays a loud `Err` naming the limit and pointing the agent at
//! `report_summary`'s `remains` field, never a silent drop. `authoring_proposal_limit_notices`
//! (below) is the tray-side read for those refusals — DERIVED from the
//! `proposal.limit_exhausted` events on every call, never a second stored copy of the notice.
//!
//! Plan 06-06 exposes the rest of the triage-verb surface Wave 2 (plan 06-03) built:
//! `authoring_proposal_merge` (D-101) and `authoring_proposal_defer` (D-102) each wrap their
//! single-row domain verb exactly like `authoring_proposal_accept`/`authoring_proposal_reject`
//! already do; `authoring_proposals_reject_bulk`/`authoring_proposals_defer_bulk` (D-104) are the
//! ONLY two bulk commands this module offers — bulk-accept does not exist at any layer, by design;
//! `authoring_proposals_deferred` is `authoring_proposals_pending`'s deferred-filter sibling. No
//! command in this file accepts a `project_id` on a write path (T-06-25) — every write resolves
//! its own scope from the proposal row or the local actor, server-side.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::{emit_board_changed, project_of};

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
///
/// Plan 06-06 closes the gap 06-01-SUMMARY.md recorded: `rationale`/`originLogOffset` (PROP-07)
/// and `duplicateOf`/`duplicateScore` (PROP-04) now reach the renderer, so the triage lane can
/// finally show WHY a proposal was made, not just its title.
///
/// Plan 06-07 (deviation, Rule 2): `duplicateOf` alone is an opaque id — `TriageSurface.tsx`'s own
/// acceptance criteria require naming the candidate's kind/key/title, which nothing on the wire
/// carried yet. `duplicate_candidate` closes that gap by resolving it (see
/// `proposal_dto_with_duplicate_label` below), reusing `query::authoring::
/// resolve_duplicate_candidate_label` exactly as `handle_inbound_proposal_created` already does
/// for a freshly staged proposal — never a second lookup routine.
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
    pub rationale: Option<String>,
    pub origin_log_offset: Option<i64>,
    pub duplicate_of: Option<String>,
    pub duplicate_score: Option<f64>,
    pub duplicate_candidate: Option<DuplicateCandidateDto>,
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
            rationale: proposal.rationale,
            origin_log_offset: proposal.origin_log_offset,
            duplicate_of: proposal.duplicate_of,
            duplicate_score: proposal.duplicate_score,
            duplicate_candidate: None,
        }
    }
}

/// One resolved duplicate candidate (plan 06-07, PROP-04) — the camelCase mirror of
/// `query::authoring::DuplicateCandidateLabel`. `key` is `None` for a candidate that is itself
/// still a pending/decided proposal (no key until accepted, D-96) — same field, same reason as
/// `query::search::DuplicateCandidate`'s own.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidateDto {
    pub kind: String,
    pub key: Option<String>,
    pub title: String,
}

impl From<flywheel_core::query::authoring::DuplicateCandidateLabel> for DuplicateCandidateDto {
    fn from(label: flywheel_core::query::authoring::DuplicateCandidateLabel) -> Self {
        Self { kind: label.kind, key: label.key, title: label.title }
    }
}

/// [`ProposalDto`] via the plain [`From`] impl above, PLUS one bounded `duplicate_candidate`
/// lookup when the row carries a `duplicate_of` — the two board-level triage reads
/// ([`authoring_proposals_pending`]/[`authoring_proposals_deferred`]) call this instead of the bare
/// `From` conversion; the tray's own [`authoring_proposals_for_run`] has no caller that renders the
/// candidate yet, so it keeps the cheaper plain conversion. A lookup failure, or no `duplicate_of`
/// at all, degrades to `None` — never turns a successful read into an error (mirrors
/// `handle_inbound_proposal_created`'s own degrade-to-`None` rule for the identical lookup).
fn proposal_dto_with_duplicate_label(
    conn: &rusqlite::Connection,
    proposal: flywheel_core::domain::authoring_proposal::Proposal,
) -> ProposalDto {
    let duplicate_of = proposal.duplicate_of.clone();
    let mut dto = ProposalDto::from(proposal);
    dto.duplicate_candidate = duplicate_of.and_then(|candidate_id| {
        flywheel_core::query::authoring::resolve_duplicate_candidate_label(conn, &candidate_id)
            .ok()
            .flatten()
            .map(DuplicateCandidateDto::from)
    });
    dto
}

/// The run currently `running`/`blocked` for `epic_id`, if any (plan 05-10) — the ONE place "is
/// this epic already being shaped" is answered, shared by [`authoring_run_start`]'s own
/// defensive re-check and [`authoring_run_for_epic`]'s door-level pre-flight read, so the two can
/// never disagree about what counts as "already running". `authoring_stage IS NOT NULL` is what
/// scopes this to an authoring run specifically — an ordinary task-execution run never carries a
/// stage, and shares no identity space with an epic id regardless.
pub(crate) fn find_running_authoring_run(
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

/// The maximum length (in `char`s) of a developer's stated premise (T-05-13-01, T-05-13-06) —
/// generous enough for a paragraph of framing, following `domain::authoring_proposal`'s own
/// length-bound idiom. Deliberately its own constant, not a reuse of `MAX_AUTHORING_TURN_TEXT_LEN`
/// (below): a premise is one opening statement, not free conversation, so it does not need that
/// constant's much larger ceiling.
const MAX_AUTHORING_PREMISE_LEN: usize = 4000;

/// Validate a developer's stated premise (T-05-13-01, T-05-13-06): trim it, treat a blank result
/// as absent, and refuse anything past [`MAX_AUTHORING_PREMISE_LEN`] with a worded error naming
/// the limit and the actual length — the same idiom `domain::authoring_proposal::validate_payload`
/// applies to every other renderer-supplied string in this workspace. Refuses rather than
/// truncates, matching [`authoring_turn_send`]'s own discipline below.
fn validate_premise(premise: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = premise else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let char_count = trimmed.chars().count();
    if char_count > MAX_AUTHORING_PREMISE_LEN {
        return Err(format!(
            "premise must be at most {MAX_AUTHORING_PREMISE_LEN} characters, got {char_count} characters"
        ));
    }
    Ok(Some(trimmed.to_string()))
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
///
/// `premise` (plan 05-13, gap G-05-2's second half): the developer's own stated framing for a
/// brand-new epic (or what they want to change about a reopened one), validated by
/// [`validate_premise`] and threaded through [`flywheel_core::epic_context_packet::render_epic_prompt`]
/// so it reaches the opening prompt. AFTER the spawn request is sent, it is also RECORDED (never
/// relayed a second time — see [`crate::sidecar::SidecarHandle::record_authoring_turn`]'s own doc
/// comment) as the transcript's own first developer turn, so the conversation opens with the
/// developer's own words attributed to them.
#[tauri::command]
pub fn authoring_run_start(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    epic_id: Option<String>,
    premise: Option<String>,
) -> Result<AuthoringRunDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    // T-05-10-02: refuse a second concurrent session on the same epic, plainly — the caller
    // (either door) already has enough to route straight to the running one instead. Unchanged by
    // this plan's premise widening: a short-circuit to an already-running session records nothing
    // and sends no prompt, so a premise typed against it is never even validated.
    if let Some(epic_id) = epic_id.as_deref() {
        if let Some(existing) = find_running_authoring_run(&conn, epic_id)? {
            return Ok(existing);
        }
    }

    let premise = validate_premise(premise)?;

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
    let opening_prompt =
        flywheel_core::epic_context_packet::render_epic_prompt(&packet, premise.as_deref());

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

        // T-05-13: record the premise as the transcript's own first developer turn — AFTER the
        // spawn request above, so a delivery failure there is unaffected by this. Recorded, never
        // relayed: the model already has the premise inside the opening prompt, and relaying it
        // too would put the same text into the session twice (`record_authoring_turn`'s own doc
        // comment says why). Best-effort, like every other system-generated relay this module
        // makes — the developer already sees their premise field emptied and the session
        // starting; a persistence hiccup here must not fail the whole start.
        if let Some(premise_text) = premise.as_deref() {
            sidecar.record_authoring_turn(
                &app,
                &run.id,
                premise_text,
                crate::sidecar::AuthoringTurnOrigin::Developer,
            );
        }
    }

    emit_board_changed(&app, Some(project_id.as_str()), "agent_run", Some(&run.id));

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
        // The preview has no premise to render with — a developer has not typed one yet at this
        // point (this is the read-only briefing shown before Start Shaping ever fires), so `None`
        // here is correct, not a placeholder for a value this command forgot to thread through.
        let rendered_prompt = flywheel_core::epic_context_packet::render_epic_prompt(&packet, None);

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
    pub merged: i64,
    pub deferred: i64,
}

impl From<flywheel_core::query::authoring::ProposalStatusCounts> for ProposalStatusCountsDto {
    fn from(counts: flywheel_core::query::authoring::ProposalStatusCounts) -> Self {
        Self {
            pending: counts.pending,
            accepted: counts.accepted,
            rejected: counts.rejected,
            merged: counts.merged,
            deferred: counts.deferred,
        }
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
        proposals: window
            .proposals
            .into_iter()
            .map(|p| proposal_dto_with_duplicate_label(&conn, p))
            .collect(),
        counts: window.counts.into(),
    })
}

/// Plan 06-06 (D-102): the deferred filter's own read — every DEFERRED proposal across
/// `project_id`, bounded and clamped through this module's own `resolve_limit`, exactly like
/// [`authoring_proposals_pending`] immediately above. Calls only
/// `query::authoring::list_deferred_proposals` — the same one-read-path discipline every other
/// board-level proposal read in this module follows.
#[tauri::command]
pub fn authoring_proposals_deferred(
    state: State<AppState>,
    project_id: String,
    limit: Option<i64>,
    cursor: Option<ProposalCursorInput>,
) -> Result<ProposalWindowDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_limit = resolve_limit(limit);
    let cursor_ref = cursor.as_ref().map(|c| (c.created_at.as_str(), c.id.as_str()));
    let window = flywheel_core::query::authoring::list_deferred_proposals(
        &conn,
        &project_id,
        resolved_limit,
        cursor_ref,
    )
    .map_err(|e| e.to_string())?;
    Ok(ProposalWindowDto {
        proposals: window
            .proposals
            .into_iter()
            .map(|p| proposal_dto_with_duplicate_label(&conn, p))
            .collect(),
        counts: window.counts.into(),
    })
}

/// [`authoring_proposal_limit_notices`]'s own DTO — the camelCase mirror of
/// `query::authoring::ProposalLimitNotice`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLimitNoticeDto {
    pub agent_run_id: String,
    pub task_id: Option<String>,
    pub limit: i64,
    pub refused_count: i64,
    pub first_refused_at: String,
    pub last_refused_at: String,
}

impl From<flywheel_core::query::authoring::ProposalLimitNotice> for ProposalLimitNoticeDto {
    fn from(notice: flywheel_core::query::authoring::ProposalLimitNotice) -> Self {
        Self {
            agent_run_id: notice.agent_run_id,
            task_id: notice.task_id,
            limit: notice.limit,
            refused_count: notice.refused_count,
            first_refused_at: notice.first_refused_at,
            last_refused_at: notice.last_refused_at,
        }
    }
}

/// The human-facing notice for a throttled run (plan 06-05, D-112) — bounded and clamped through
/// this module's own `resolve_limit` idiom, calling straight through to
/// `query::authoring::proposal_limit_notices`, which DERIVES every notice from the
/// `proposal.limit_exhausted` events on every call — never a second stored copy of the warning.
#[tauri::command]
pub fn authoring_proposal_limit_notices(
    state: State<AppState>,
    project_id: String,
    limit: Option<i64>,
) -> Result<Vec<ProposalLimitNoticeDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_limit = resolve_limit(limit);
    let notices =
        flywheel_core::query::authoring::proposal_limit_notices(&conn, &project_id, resolved_limit)
            .map_err(|e| e.to_string())?;
    Ok(notices.into_iter().map(ProposalLimitNoticeDto::from).collect())
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

    let project_id = project_of(&conn, "authoring_proposals", &proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "task", Some(&outcome.materialised_id));
    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&outcome.proposal.agent_run_id));

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

    let project_id = project_of(&conn, "authoring_proposals", &root_proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "task", Some(&outcome.root_materialised_id));
    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(())
}

/// [`authoring_proposal_merge`]'s own DTO — the decided [`ProposalDto`] plus the new child issue's
/// id and key, mirroring `domain::authoring_proposal::MergeOutcome`'s shape. `issue_key` is looked
/// up with one follow-up single-row read (the domain outcome carries only the id) while the
/// connection is still locked below, exactly like [`authoring_subtree_accept`]'s own
/// `agent_run_id` follow-up read immediately above.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcomeDto {
    pub proposal: ProposalDto,
    pub issue_id: String,
    pub issue_key: String,
}

/// Merge a pending task/epic/issue proposal into an existing task or epic (D-101) — attaches one
/// child `issues` row through the canonical writer that table already owns, never mutating the
/// target's own row. `target_kind` accepts only the two literals `"task"`/`"epic"`, refusing
/// anything else by naming both accepted values (T-06-25: this command resolves identity itself
/// and accepts no `project_id`, matching every other command in this workspace). A merge whose
/// target no longer exists surfaces `domain::authoring_proposal::ProposalUndecidable`'s own
/// `Display` text through the plain `.to_string()` below — the SAME stable substring
/// `authoring_proposal_accept`'s error already carries through this identical `map_err` pattern,
/// which `ProposalRow.tsx`'s `isUndecidableError` already matches on; no downcast is needed at
/// this layer; the typed error's `Display` IS the string that crosses the command boundary.
#[tauri::command]
pub fn authoring_proposal_merge(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
    target_kind: String,
    target_id: String,
) -> Result<MergeOutcomeDto, String> {
    let target = match target_kind.as_str() {
        "task" => flywheel_core::domain::authoring_proposal::MergeTarget::Task(target_id),
        "epic" => flywheel_core::domain::authoring_proposal::MergeTarget::Epic(target_id),
        other => {
            return Err(format!("target_kind must be \"task\" or \"epic\", got {other:?}"));
        }
    };

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome = flywheel_core::domain::authoring_proposal::merge_proposal(
        &mut conn,
        &actor_id,
        &proposal_id,
        &target,
    )
    .map_err(|e| e.to_string())?;

    let issue_key: String = conn
        .query_row(
            "SELECT key FROM issues WHERE id = ?1",
            rusqlite::params![outcome.issue_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let agent_run_id = outcome.proposal.agent_run_id.clone();
    let issue_id = outcome.issue_id.clone();

    let project_id = project_of(&conn, "authoring_proposals", &proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "issue", Some(&issue_id));
    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(MergeOutcomeDto { proposal: outcome.proposal.into(), issue_id, issue_key })
}

/// Defer a pending proposal (D-102) — mints nothing in any canonical table; a deferred proposal
/// stays recallable through [`authoring_proposals_deferred`]. Resolves the human actor
/// server-side, exactly like every other command in this workspace.
#[tauri::command]
pub fn authoring_proposal_defer(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
) -> Result<ProposalDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let proposal = flywheel_core::domain::authoring_proposal::defer_proposal(
        &mut conn,
        &actor_id,
        &proposal_id,
    )
    .map_err(|e| e.to_string())?;

    let agent_run_id = proposal.agent_run_id.clone();
    let project_id = project_of(&conn, "authoring_proposals", &proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(proposal.into())
}

/// [`authoring_proposals_reject_bulk`]/[`authoring_proposals_defer_bulk`]'s own DTO — the camelCase
/// mirror of `domain::authoring_proposal::BulkDecisionOutcome`. D-104: the only two bulk verbs this
/// module offers — no bulk-accept counterpart exists at any layer (the Phase-5 accept-all source
/// gate over `packages/desktop/src` re-runs as this plan's own verify step, proving it stays
/// green).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkDecisionDto {
    pub decided: usize,
    pub skipped: Vec<String>,
}

/// Bulk-reject every pending id in `proposal_ids` (D-104) — the first of the two bulk paths this
/// module offers. Resolves the human actor server-side; emits one `board:changed` when at least
/// one row was actually decided (an empty selection or an all-skipped batch touches nothing, so it
/// emits nothing).
#[tauri::command]
pub fn authoring_proposals_reject_bulk(
    state: State<AppState>,
    app: AppHandle,
    proposal_ids: Vec<String>,
    reason: Option<String>,
) -> Result<BulkDecisionDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome = flywheel_core::domain::authoring_proposal::reject_proposals_bulk(
        &mut conn,
        &actor_id,
        &proposal_ids,
        reason.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    if outcome.decided > 0 {
        // A bulk batch can span projects, and no single project is honest here: broadcast.
        emit_board_changed(&app, None, "authoring_proposal", Some("bulk_reject"));
    }

    Ok(BulkDecisionDto { decided: outcome.decided, skipped: outcome.skipped })
}

/// Bulk-defer every pending id in `proposal_ids` (D-104) — [`authoring_proposals_reject_bulk`]'s
/// sibling, behaving identically.
#[tauri::command]
pub fn authoring_proposals_defer_bulk(
    state: State<AppState>,
    app: AppHandle,
    proposal_ids: Vec<String>,
) -> Result<BulkDecisionDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let outcome = flywheel_core::domain::authoring_proposal::defer_proposals_bulk(
        &mut conn,
        &actor_id,
        &proposal_ids,
    )
    .map_err(|e| e.to_string())?;

    drop(conn);

    if outcome.decided > 0 {
        // A bulk batch can span projects, and no single project is honest here: broadcast.
        emit_board_changed(&app, None, "authoring_proposal", Some("bulk_defer"));
    }

    Ok(BulkDecisionDto { decided: outcome.decided, skipped: outcome.skipped })
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

    let project_id = project_of(&conn, "authoring_proposals", &proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&proposal.agent_run_id));

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

    let project_id = project_of(&conn, "authoring_proposals", &proposal_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&outcome.proposal.agent_run_id));

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
/// Plan 05-45 (closing gap G-05-9): `advance_stage` now returns an instruction for BOTH
/// transitions that have one — D-89's distillation instruction on entering `decompose`, and the
/// criteria draft request on entering `criteria` — and both are relayed to the live session as an
/// `authoring_turn` the SAME way, AFTER the stage row has already committed above. An instruction
/// is a REQUEST, not a precondition: a missing sidecar handle or a delivery failure is swallowed
/// here (never surfaced as a command error), matching the plan's own "the stage advances even when
/// the turn cannot be delivered" requirement — a stage machine that cannot move because a model
/// declined (or a process is not reachable) to emit a row is a worse failure than a thin draft
/// record.
#[tauri::command]
pub fn authoring_stage_advance(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<String, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let (stage, instruction) = flywheel_core::domain::authoring_session::advance_stage(
        &mut conn,
        &agent_run_id,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    if let Some(instruction) = instruction {
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

    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

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
///
/// **The `developer_turn` transcript row this relay produces names a turn the transport ACCEPTED,
/// never merely an attempted one** (plan 05-14, closing CR-01/`05-VERIFICATION.md` truth #7):
/// [`crate::sidecar::SidecarHandle::send_authoring_turn`] attempts delivery first and records
/// nothing on a failed attempt, so a failed send followed by a successful retry of the same text
/// leaves exactly one transcript row, never two. This command's own `Err` surfacing (unlike its
/// best-effort neighbours above) is what lets the composer offer that retry in the first place.
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
/// Plan 05-48 (D-80/D-81/D-92, gap G-05-10): holding the staging socket (`stageAuthoringProposal`)
/// means this event's own `requestId`, when present, names a tool call still WAITING for an
/// answer. Every reachable outcome relays exactly one answer back over
/// [`crate::sidecar::SidecarHandle::relay_authoring_proposal_answer`] — the core-minted id on
/// `Created`, an outcome-shaped `Err` string on `Ignored`/`UnknownRun`/`TerminalRun`, a poisoned
/// lock, or an `apply_proposal_created` error. An event carrying NO `requestId` (the pre-05-48
/// fire-and-forget shape) performs the write and the `board:changed` emit exactly as before and
/// relays nothing — full backward compatibility. Exactly two paths cannot relay at all (see the
/// two comments below naming them) — reaching the sidecar requires state this function has
/// already failed to obtain by that point.
///
/// This function must never panic — no `expect`, no `unwrap`, no direct indexing: a malformed
/// event, a poisoned lock, or an error from the applier becomes a relayed string (or, for the two
/// unreachable-to-answer paths, a silent no-op), matching `sidecar.rs`'s own "a malformed line
/// never crashes the reader task" discipline.
pub fn handle_inbound_proposal_created(app: &AppHandle, event: &serde_json::Value) {
    let request_id = event.get("requestId").and_then(|v| v.as_str());
    let run_id = event.get("runId").and_then(|v| v.as_str()).unwrap_or_default();

    // This path cannot relay an answer: reaching the sidecar requires the AppState this call just
    // failed to get. The ONE permitted bare return with no relay in this function.
    let Some(state) = app.try_state::<AppState>() else { return };
    // Same reasoning as above — no SidecarHandle means no channel to relay an answer over. The
    // OTHER permitted bare return with no relay in this function.
    let Some(sidecar) = state.sidecar.as_ref() else { return };

    let mut conn = match state.db.lock() {
        Ok(conn) => conn,
        Err(_) => {
            if let Some(request_id) = request_id {
                let _ = sidecar.relay_authoring_proposal_answer(
                    run_id,
                    request_id,
                    Err("db mutex poisoned".to_string()),
                );
            }
            return;
        }
    };

    let outcome = match flywheel_core::domain::authoring_proposal::apply_proposal_created(&mut conn, event) {
        Ok(outcome) => outcome,
        Err(e) => {
            drop(conn);
            if let Some(request_id) = request_id {
                let _ = sidecar.relay_authoring_proposal_answer(run_id, request_id, Err(e.to_string()));
            }
            return;
        }
    };

    // Plan 06-05 (D-108): resolve the duplicate candidate's own kind/key/title WHILE the
    // connection is still locked — one bounded lookup, never a second DB round trip after the
    // `drop(conn)` below. A lookup failure (or no `duplicate_of` at all) degrades to `None`,
    // which omits the field entirely further down — never turns a successfully staged proposal
    // into a reported failure.
    let duplicate_candidate_json: Option<serde_json::Value> =
        if let flywheel_core::domain::authoring_proposal::ProposalOutcome::Created(ref proposal) = outcome {
            proposal.duplicate_of.as_deref().and_then(|duplicate_id| {
                flywheel_core::query::authoring::resolve_duplicate_candidate_label(&conn, duplicate_id)
                    .ok()
                    .flatten()
                    .map(|label| {
                        let mut candidate = serde_json::json!({
                            "kind": label.kind,
                            "title": label.title,
                            "score": proposal.duplicate_score.unwrap_or_default(),
                        });
                        if let Some(key) = label.key {
                            candidate["key"] = serde_json::Value::String(key);
                        }
                        candidate
                    })
            })
        } else {
            None
        };

    let project_id = project_of(&conn, "agent_runs", run_id);
    drop(conn);

    if let flywheel_core::domain::authoring_proposal::ProposalOutcome::Created(ref proposal) = outcome {
        emit_board_changed(app, project_id.as_deref(), "agent_run", Some(&proposal.agent_run_id));
    }

    let Some(request_id) = request_id else { return };

    let result: Result<serde_json::Value, String> = match outcome {
        flywheel_core::domain::authoring_proposal::ProposalOutcome::Created(proposal) => {
            let mut result = serde_json::json!({ "proposalId": proposal.id });
            if let Some(candidate) = duplicate_candidate_json {
                result["duplicateCandidate"] = candidate;
            }
            Ok(result)
        }
        flywheel_core::domain::authoring_proposal::ProposalOutcome::Ignored => {
            Err("the proposal event was ignored: malformed or unparseable payload".to_string())
        }
        flywheel_core::domain::authoring_proposal::ProposalOutcome::UnknownRun => {
            Err("no agent_runs row matches this run".to_string())
        }
        flywheel_core::domain::authoring_proposal::ProposalOutcome::TerminalRun => {
            Err("this run has already reached a terminal status".to_string())
        }
        flywheel_core::domain::authoring_proposal::ProposalOutcome::LimitExhausted { limit, count } => {
            Err(format!(
                "proposal limit reached: this run has already staged {count} of {limit} allowed \
                 proposals — this one was NOT staged. Call report_summary and put it in the \
                 remains field instead."
            ))
        }
    };
    let _ = sidecar.relay_authoring_proposal_answer(run_id, request_id, result);
}

/// D-87 (plan 05-05; relay-shell extraction plan 05-18/G-05-1): the inbound half of the
/// board-read round trip — called from `sidecar.rs`'s reader loop for every `board_read_request`
/// event. Extracts `runId`/`requestId`, locks the database, and calls
/// `flywheel_core::query::authoring::resolve_board_read` — the ONE dispatch this handler and the
/// UAT bridge's `answer-board-read` subcommand both call, so the scope resolution, the clamp
/// arithmetic and the `readKind` dispatch live in exactly one place, never two that can drift
/// apart. Relays the result back over the sidecar's own stdin via
/// `SidecarHandle::relay_authoring_read_answer`. This function must never panic: a malformed
/// event, a poisoned lock, or a query error becomes an `error` string relayed back to the waiting
/// call, never a crash of this shared reader loop (mirrors `handle_inbound_proposal_created`'s
/// own discipline).
pub fn handle_inbound_board_read_request(app: &AppHandle, event: &serde_json::Value) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(sidecar) = state.sidecar.as_ref() else { return };

    let (Some(run_id), Some(request_id)) = (
        event.get("runId").and_then(|v| v.as_str()),
        event.get("requestId").and_then(|v| v.as_str()),
    ) else {
        return;
    };

    let result: Result<serde_json::Value, String> = (|| -> anyhow::Result<serde_json::Value> {
        let conn = state
            .db
            .lock()
            .map_err(|_| anyhow::anyhow!("db mutex poisoned"))?;
        flywheel_core::query::authoring::resolve_board_read(&conn, run_id, event)
    })()
    .map_err(|e| e.to_string());

    let _ = sidecar.relay_authoring_read_answer(run_id, request_id, result);
}
