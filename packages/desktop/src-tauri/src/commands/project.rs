//! `project_register` / `project_list` — project registration and listing.

use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::state::AppState;

const MAX_NAME_LEN: usize = 200;
const MAX_REPO_PATH_LEN: usize = 4096;
const MAX_KEY_PREFIX_LEN: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub key_prefix: String,
    pub name: String,
    pub repo_path: String,
    pub default_branch: String,
    pub status: String,
}

impl From<flywheel_core::domain::project::Project> for ProjectDto {
    fn from(project: flywheel_core::domain::project::Project) -> Self {
        Self {
            id: project.id,
            key_prefix: project.key_prefix,
            name: project.name,
            repo_path: project.repo_path,
            default_branch: project.default_branch,
            status: project.status,
        }
    }
}

/// Register a local git repository as a project. `actor_id` is resolved inside this handler
/// (T-01-04) — the command signature accepts no actor argument from the renderer.
#[tauri::command]
pub fn project_register(
    state: State<AppState>,
    name: String,
    repo_path: String,
    key_prefix: String,
) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(format!(
            "project name must be 1-{MAX_NAME_LEN} characters, got {} characters",
            name.len()
        ));
    }
    let repo_path = repo_path.trim();
    if repo_path.is_empty() || repo_path.len() > MAX_REPO_PATH_LEN {
        return Err("repository path is invalid".to_string());
    }
    // T-01-13: the native folder picker returns an absolute path, but this handler is the trust
    // boundary — canonicalize it here (resolving symlinks and `.`/`..` segments) before it is
    // ever stored. `packages/core` never derives a path by concatenating stored content
    // (ARCHITECTURE.md Anti-Pattern 3); canonicalizing at the one write point is what keeps that
    // guarantee meaningful.
    let canonical_repo_path = Path::new(repo_path)
        .canonicalize()
        .map_err(|e| format!("repository path could not be resolved: {e}"))?;
    let canonical_repo_path = canonical_repo_path
        .to_str()
        .ok_or_else(|| "repository path is not valid UTF-8".to_string())?;

    let key_prefix = key_prefix.trim();
    if key_prefix.is_empty() || key_prefix.len() > MAX_KEY_PREFIX_LEN {
        return Err(format!(
            "key prefix must be 1-{MAX_KEY_PREFIX_LEN} characters"
        ));
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let project = flywheel_core::domain::project::create_project(
        &mut conn, &actor_id, name, canonical_repo_path, key_prefix, "main",
    )
    .map_err(|e| e.to_string())?;

    Ok(project.into())
}

/// List every registered project.
#[tauri::command]
pub fn project_list(state: State<AppState>) -> Result<Vec<ProjectDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let projects =
        flywheel_core::domain::project::list_projects(&conn).map_err(|e| e.to_string())?;
    Ok(projects.into_iter().map(ProjectDto::from).collect())
}
