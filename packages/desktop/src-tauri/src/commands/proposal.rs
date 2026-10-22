//! `proposal_list_pending` / `proposal_accept` / `proposal_amend` / `proposal_reject` — the
//! developer's side of Proposals (docs/mvp-spec.md §3, §5). Agents file Proposals through their
//! board tool, never through IPC; deciding one is human-only, enforced by the domain writer, with
//! the local human actor resolved here (T-01-04). Accepting or amending applies the Proposal in the
//! same transaction as the decision (`flywheel_core::domain::proposal_apply`, issue #125).

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_PROSE_LEN, MAX_TITLE_LEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDto {
    pub id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub epic_id: Option<String>,
    /// `create`, `amend`, `reorder` or `retire`.
    pub verb: String,
    /// `milestone`, `epic`, `story`, `criterion`, `adr` or `glossary_term`.
    pub target_type: String,
    pub target_id: Option<String>,
    pub payload: serde_json::Value,
    pub rationale: Option<String>,
    pub state: String,
    pub created_at: String,
    /// The developer's reason, once rejected.
    pub rejection_reason: Option<String>,
    /// The shaping Stage and Round it was filed in (issue #125); `None` for a Story session's.
    pub stage_id: Option<String>,
    pub round_id: Option<String>,
}

impl From<flywheel_core::domain::proposal::Proposal> for ProposalDto {
    fn from(p: flywheel_core::domain::proposal::Proposal) -> Self {
        Self {
            id: p.id,
            project_id: p.project_id,
            session_id: p.session_id,
            epic_id: p.epic_id,
            verb: p.verb,
            target_type: p.target_type,
            target_id: p.target_id,
            payload: p.payload,
            rationale: p.rationale,
            state: p.state,
            created_at: p.created_at,
            rejection_reason: p.rejection_reason,
            stage_id: p.stage_id,
            round_id: p.round_id,
        }
    }
}

/// A project's pending Proposals, oldest first.
#[tauri::command]
pub fn proposal_list_pending(state: State<AppState>, project_id: String) -> Result<Vec<ProposalDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::domain::proposal::pending_proposals(&conn, &project_id).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(ProposalDto::from).collect())
}

/// Accept a pending Proposal, applying it in the same transaction (issue #125).
#[tauri::command]
pub fn proposal_accept(state: State<AppState>, app: AppHandle, proposal_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let decided = flywheel_core::domain::proposal::accept_proposal_released(&mut conn, &actor_id, &proposal_id, None)
        .map_err(|e| format!("{e:#}"))?;
    let project_id = super::project_of(&conn, "proposals", &proposal_id);
    drop(conn);
    settle(&app, &decided);
    emit_board_changed(&app, project_id.as_deref(), "proposal", Some(&proposal_id));
    Ok(())
}

/// Issue #133: a decision that closed a roadmap Round its session waits on answers that held call,
/// once the lock is released, with every decision.
fn settle(app: &AppHandle, decided: &flywheel_core::domain::proposal::Decided) {
    if let Some(release) = &decided.release {
        super::task::send_board_tool_answer(app, &release.session_id, &release.request_id, &super::shaping::release_answer(release));
    }
}

/// Amend (issue #125): accept a pending Proposal with the developer's edited payload, applying the
/// edit in the same transaction. The event keeps the agent's original.
#[tauri::command]
pub fn proposal_amend(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    validate_text("payload", &payload.to_string(), MAX_PROSE_LEN + MAX_TITLE_LEN)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let decided = flywheel_core::domain::proposal::accept_proposal_released(&mut conn, &actor_id, &proposal_id, Some(&payload))
        .map_err(|e| format!("{e:#}"))?;
    let project_id = super::project_of(&conn, "proposals", &proposal_id);
    drop(conn);
    settle(&app, &decided);
    emit_board_changed(&app, project_id.as_deref(), "proposal", Some(&proposal_id));
    Ok(())
}

/// Reject a pending Proposal, keeping the reason for the Epic's packet.
#[tauri::command]
pub fn proposal_reject(
    state: State<AppState>,
    app: AppHandle,
    proposal_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    if let Some(reason) = &reason {
        validate_text("reason", reason, MAX_TITLE_LEN)?;
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let decided = flywheel_core::domain::proposal::reject_proposal_released(&mut conn, &actor_id, &proposal_id, reason.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "proposals", &proposal_id);
    drop(conn);
    settle(&app, &decided);
    emit_board_changed(&app, project_id.as_deref(), "proposal", Some(&proposal_id));
    Ok(())
}
