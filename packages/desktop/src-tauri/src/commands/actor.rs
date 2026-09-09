//! `actor_list` — the actor roster the assignee picker renders (BOARD-06). Read-only in Phase 1:
//! actors are seeded by migration `0001_actors.sql`, and no command here creates one.

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorDto {
    pub id: String,
    pub actor_type: String,
    pub display_name: String,
}

impl From<flywheel_core::domain::actor::Actor> for ActorDto {
    fn from(actor: flywheel_core::domain::actor::Actor) -> Self {
        Self {
            id: actor.id,
            actor_type: actor.actor_type,
            display_name: actor.display_name,
        }
    }
}

/// List every actor (human, agent and system) — the `AssigneePicker`'s roster (BOARD-06). The
/// picker itself adds the explicit "Unassigned" entry; this command returns only real rows.
#[tauri::command]
pub fn actor_list(state: State<AppState>) -> Result<Vec<ActorDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let actors = flywheel_core::domain::actor::list_actors(&conn).map_err(|e| e.to_string())?;
    Ok(actors.into_iter().map(ActorDto::from).collect())
}
