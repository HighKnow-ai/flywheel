//! `dev_environment_get` / `dev_environment_choose` — the development builds' hidden Environment
//! picker (issue #786). This module is declared under `#[cfg(debug_assertions)]` in `mod.rs`, and
//! both commands are registered under the same attribute in `main.rs`, so a release build compiles
//! neither: it has no command that names or changes an Environment, and `generate_handler!`
//! carries neither name. `flywheel_core::environment` holds the hostnames and the persistence.

use serde::Serialize;
use tauri::State;

use flywheel_core::environment::dev::{self, Choice};
use flywheel_core::environment::Environment;

use crate::state::AppState;

/// The Environment this install talks to, for the picker and its indicator.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEnvironmentDto {
    /// `production`, `staging`, or `env-<name>`.
    pub name: String,
    pub api_origin: String,
    pub production: bool,
}

impl From<Environment> for DevEnvironmentDto {
    fn from(environment: Environment) -> Self {
        Self {
            name: environment.name().to_string(),
            api_origin: environment.api_origin().to_string(),
            production: environment.is_production(),
        }
    }
}

/// The longest temporary name the command reads before the core judges it.
const MAX_TYPED_NAME_LEN: usize = 200;

/// The Environment this install talks to. Read-only.
#[tauri::command]
pub fn dev_environment_get(state: State<AppState>) -> Result<DevEnvironmentDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    dev::chosen(&conn)
        .map(DevEnvironmentDto::from)
        .map_err(|e| e.to_string())
}

/// Choose the Environment this install talks to: `tier` is `production`, `staging` or
/// `temporary`, and `name` is the temporary Environment's name, with or without `env-`. A refused
/// name leaves the stored choice as it was. The actor is resolved here, never sent.
#[tauri::command]
pub fn dev_environment_choose(
    state: State<AppState>,
    tier: String,
    name: Option<String>,
) -> Result<DevEnvironmentDto, String> {
    let choice = match (tier.as_str(), name) {
        ("production", None) => Choice::Production,
        ("staging", None) => Choice::Staging,
        ("temporary", Some(name)) if name.chars().count() <= MAX_TYPED_NAME_LEN => {
            Choice::Temporary(name)
        }
        ("temporary", Some(_)) => {
            return Err(format!(
                "a temporary Environment's name is at most {MAX_TYPED_NAME_LEN} characters"
            ))
        }
        ("temporary", None) => return Err("a temporary Environment needs a name".to_string()),
        (other, _) => {
            return Err(format!(
                "tier must be \"production\", \"staging\" or \"temporary\" (a name only with \
                 \"temporary\"), got {other:?}"
            ))
        }
    };
    dev::resolve(&choice)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    dev::choose(&mut conn, &actor_id, &choice)
        .map(DevEnvironmentDto::from)
        .map_err(|e| e.to_string())
}
