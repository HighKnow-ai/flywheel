//! `proposal_list_pending` / `proposal_accept` / `proposal_reject` — the developer's side of
//! Proposals (docs/mvp-spec.md §5). Agents file Proposals through their board tool, never through
//! IPC; deciding one is human-only, enforced by the domain writer, with the local human actor
//! resolved here (T-01-04).

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{emit_board_changed, validate_text, MAX_TITLE_LEN};
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

/// Accept a pending Proposal.
#[tauri::command]
pub fn proposal_accept(state: State<AppState>, app: AppHandle, proposal_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::proposal::accept_proposal(&mut conn, &actor_id, &proposal_id).map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "proposals", &proposal_id);
    drop(conn);
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
    flywheel_core::domain::proposal::reject_proposal(&mut conn, &actor_id, &proposal_id, reason.as_deref())
        .map_err(|e| e.to_string())?;
    let project_id = super::project_of(&conn, "proposals", &proposal_id);
    drop(conn);
    emit_board_changed(&app, project_id.as_deref(), "proposal", Some(&proposal_id));
    Ok(())
}
