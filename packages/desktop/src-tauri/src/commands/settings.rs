//! `settings_get` / `settings_set_credential_mode` / `settings_store_api_key` /
//! `settings_clear_api_key` / `backend_capability_probe` — D-39's Settings command surface (the
//! product's first). No command in this module ever returns the API key value itself —
//! `settings_get` reports only whether a key is configured and the date, never the key.
//!
//! The Settings surface's own UI (the segmented control, the per-project override list, the
//! permission-rules table) is plan 02-10's responsibility (this plan's own Boundary note) — this
//! module builds only the mechanism and its command surface.

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// One registered project's credential-mode override, projected for the wire — mirrors
/// `flywheel_core::domain::project::Project`'s id/name plus the override this plan's migration
/// added, never a bare tuple so the renderer gets named fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCredentialOverrideDto {
    pub project_id: String,
    pub project_name: String,
    /// `None` means "use the global default" — mirrors `projects.credential_mode`'s own NULL.
    pub credential_mode: Option<String>,
}

/// The full Settings read (D-39) — the global default, every registered project's override (or
/// lack of one), and whether an API key is configured and when. Never the key value itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub global_credential_mode: String,
    pub project_overrides: Vec<ProjectCredentialOverrideDto>,
    pub api_key_configured: bool,
    pub api_key_configured_at: Option<String>,
}

/// Read the full Settings state. Read-only.
#[tauri::command]
pub fn settings_get(state: State<AppState>) -> Result<SettingsDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let global_credential_mode =
        flywheel_core::domain::settings::global_credential_mode(&conn).map_err(|e| e.to_string())?;

    let projects =
        flywheel_core::domain::project::list_projects(&conn).map_err(|e| e.to_string())?;
    let mut project_overrides = Vec::with_capacity(projects.len());
    for project in projects {
        let credential_mode =
            flywheel_core::domain::settings::project_credential_mode(&conn, &project.id)
                .map_err(|e| e.to_string())?;
        project_overrides.push(ProjectCredentialOverrideDto {
            project_id: project.id,
            project_name: project.name,
            credential_mode,
        });
    }

    let api_key_configured =
        flywheel_core::credentials::has_api_key().map_err(|e| e.to_string())?;
    let api_key_configured_at =
        flywheel_core::credentials::api_key_configured_at(&conn).map_err(|e| e.to_string())?;

    Ok(SettingsDto {
        global_credential_mode,
        project_overrides,
        api_key_configured,
        api_key_configured_at,
    })
}

/// Rejects a `mode` outside exactly `"local"`/`"api_key"` before any DB call (mirrors
/// `agent_run.rs`'s `validate_permission_mode`'s own reasoning) — named in the error so the
/// rejected value is legible.
fn validate_mode(mode: &str) -> Result<(), String> {
    if mode != "local" && mode != "api_key" {
        return Err(format!(
            "credential mode must be \"local\" or \"api_key\", got {mode:?}"
        ));
    }
    Ok(())
}

/// Set the credential mode at either scope (D-39). `scope` must be exactly `"global"` or
/// `"project"`; `project_id` is required (and only meaningful) for `"project"`. `actor_id` is
/// resolved server-side (T-01-04), never accepted from the renderer.
#[tauri::command]
pub fn settings_set_credential_mode(
    state: State<AppState>,
    scope: String,
    project_id: Option<String>,
    mode: String,
) -> Result<(), String> {
    validate_mode(&mode)?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| e.to_string())?;

    match scope.as_str() {
        "global" => {
            flywheel_core::domain::settings::set_global_credential_mode(&mut conn, &actor_id, &mode)
                .map_err(|e| e.to_string())?;
        }
        "project" => {
            let project_id = project_id
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "project_id is required for scope \"project\"".to_string())?;
            flywheel_core::domain::settings::set_project_credential_mode(
                &mut conn,
                &actor_id,
                &project_id,
                Some(mode.as_str()),
            )
            .map_err(|e| e.to_string())?;
        }
        other => {
            return Err(format!(
                "scope must be \"global\" or \"project\", got {other:?}"
            ))
        }
    }

    Ok(())
}

/// Store the API key in the macOS Keychain (D-39). Never returns the value; `settings_get` is the
/// only read this module offers, and it reports presence/date only.
#[tauri::command]
pub fn settings_store_api_key(state: State<AppState>, value: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .map_err(|e| e.to_string())?;
    flywheel_core::credentials::store_api_key(&mut conn, &actor_id, &value)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear the stored API key (D-39). Idempotent — clearing an already-absent key is not an error.
#[tauri::command]
pub fn settings_clear_api_key(state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::credentials::clear_api_key(&mut conn).map_err(|e| e.to_string())?;
    Ok(())
}

/// Whether the local backend binary (`claude`) is resolvable, and its reported version (plan
/// 02-09 Task 3). Read-only: never spawns a session, never touches a credential. With the binary
/// absent this reports `available: false` rather than an error — the API-key path remains fully
/// usable regardless (02-UI-SPEC.md's non-blocking notice; 02-RESEARCH.md's Environment
/// Availability fallback note).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCapabilityDto {
    pub available: bool,
    pub version: Option<String>,
    /// Always `true` — configuring/selecting the API-key credential mode (`settings_set_
    /// credential_mode`, `settings_store_api_key`) is never gated on the local backend binary
    /// being resolvable; neither checks `available` before doing its own work. This field makes
    /// that degradation contract explicit in the probe's own response, rather than leaving a
    /// caller to infer it from the absence of an error (D-39, plan 02-09 Task 3).
    pub api_key_path_usable: bool,
}

/// The `BackendCapabilityDto` reported when no sidecar is running at all (`state.sidecar` is
/// `None` — `state.rs`'s own doc comment: "the sidecar failed to start," never a valid steady
/// state in the real app, but still a shape `backend_capability_probe` must degrade against
/// rather than panic on). Factored out so it is unit-testable without a live Tauri `State`.
fn capability_dto_when_no_sidecar() -> BackendCapabilityDto {
    BackendCapabilityDto {
        available: false,
        version: None,
        api_key_path_usable: true,
    }
}

#[tauri::command]
pub fn backend_capability_probe(state: State<AppState>) -> Result<BackendCapabilityDto, String> {
    let Some(sidecar) = state.sidecar.as_ref() else {
        return Ok(capability_dto_when_no_sidecar());
    };
    let (available, version) = sidecar.capability_probe().map_err(|e| e.to_string())?;
    Ok(BackendCapabilityDto {
        available,
        version,
        api_key_path_usable: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The half of "the probe with the binary absent reports unavailable and reports the
    /// API-key path usable" (plan 02-09 Task 3 acceptance criteria) that is reachable without a
    /// live sidecar process — `packages/sidecar/test/credentials.test.mjs`'s own
    /// `probeClaudeBinary reports unavailable...` test covers the sidecar-level half (pointing
    /// `FLYWHEEL_CLAUDE_BIN` at a non-existent path).
    #[test]
    fn when_the_sidecar_is_not_running_the_probe_reports_unavailable_but_the_api_key_path_stays_usable() {
        let dto = capability_dto_when_no_sidecar();
        assert!(!dto.available);
        assert_eq!(dto.version, None);
        assert!(dto.api_key_path_usable);
    }
}
