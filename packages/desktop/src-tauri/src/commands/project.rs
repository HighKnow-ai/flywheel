//! `project_register` / `project_list` / `project_hide` / `project_restore` — project registration,
//! listing and reversible removal.

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
pub async fn project_register(
    state: State<'_, AppState>,
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

    let key_prefix = key_prefix.trim();
    if key_prefix.is_empty() || key_prefix.len() > MAX_KEY_PREFIX_LEN {
        return Err(format!(
            "key prefix must be 1-{MAX_KEY_PREFIX_LEN} characters"
        ));
    }

    // Registering installs the repository's git hooks, which reads git's config: a side
    // connection, never the board mutex (issue #215), on the blocking pool (issue #220).
    let path = super::board_path(&state.db)?;
    let (name, repo_path, key_prefix) = (name.to_string(), repo_path.to_string(), key_prefix.to_string());
    tauri::async_runtime::spawn_blocking(move || register_beside(&path, &name, &repo_path, &key_prefix))
        .await
        .map_err(|e| super::ipc_error("project_register:join", e))?
}

fn register_beside(path: &Path, name: &str, repo_path: &str, key_prefix: &str) -> Result<ProjectDto, String> {
    let mut conn = super::open_beside(path)?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    // T-01-13: the native folder picker returns an absolute path, but this handler is the trust
    // boundary — length/emptiness are validated above, and `register_project` (01-11-PLAN.md
    // Task 2) is where canonicalization (resolving symlinks and `.`/`..` segments) now happens,
    // since core-level callers (`packages/core/tests/project_reconciliation.rs`) must get the
    // exact same guarantee without going through this command layer at all. `packages/core`
    // still never derives a path by concatenating stored content (ARCHITECTURE.md Anti-Pattern
    // 3) — canonicalizing at the read boundary is what keeps that guarantee meaningful; it reads
    // a marker at an explicit path, never one built from marker content.
    //
    // If a marker already exists at this repository (D-15, a clone being re-adopted, or a
    // re-registration), `register_project` reuses its id and key rather than minting new ones —
    // that reuse is what `RegisterProjectFlow.tsx` surfaces to the user as "already registered"
    // before completing (01-11-PLAN.md Task 3), a UI-layer courtesy, not a core precondition.
    let project = flywheel_core::domain::project::register_project(
        &mut conn, &actor_id, Path::new(repo_path), name, key_prefix,
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

/// Verify every known project's marker still matches its cached path (D-16, BOARD-10) and
/// return the resulting list. `main.rs`'s `setup` hook already runs this once at launch, before
/// the window is shown — this command exists so a future surface (or a manual re-check) could
/// trigger it again without relaunching, and so the reconciliation path itself is exercised by
/// the same Tauri command-boundary tests every other handler in this module gets.
#[tauri::command]
pub fn project_reconcile(state: State<AppState>) -> Result<Vec<ProjectDto>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::project::reconcile_projects(&mut conn, &actor_id)
        .map_err(|e| e.to_string())?;
    let projects =
        flywheel_core::domain::project::list_projects(&conn).map_err(|e| e.to_string())?;
    Ok(projects.into_iter().map(ProjectDto::from).collect())
}

/// Explicitly relocate a project whose marker no longer matches its cached path (D-16) — the
/// ONLY recovery action `ProjectUnreachable.tsx` offers (never an auto-scan, never a silent
/// rebind). Rejects a `new_repo_path` whose marker names a different project (T-01-29).
#[tauri::command]
pub async fn project_relocate(
    state: State<'_, AppState>,
    project_id: String,
    new_repo_path: String,
) -> Result<ProjectDto, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("project id is required".to_string());
    }
    let new_repo_path = new_repo_path.trim();
    if new_repo_path.is_empty() || new_repo_path.len() > MAX_REPO_PATH_LEN {
        return Err("repository path is invalid".to_string());
    }

    // Relocating reinstalls the git hooks at the new path: a side connection, not the board mutex,
    // on the blocking pool.
    let path = super::board_path(&state.db)?;
    let (project_id, new_repo_path) = (project_id.to_string(), new_repo_path.to_string());
    tauri::async_runtime::spawn_blocking(move || -> Result<ProjectDto, String> {
        let mut conn = super::open_beside(&path)?;
        let actor_id =
            flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
        let project = flywheel_core::domain::project::relocate_project(
            &mut conn,
            &actor_id,
            &project_id,
            Path::new(&new_repo_path),
        )
        .map_err(|e| e.to_string())?;
        Ok(project.into())
    })
    .await
    .map_err(|e| super::ipc_error("project_relocate:join", e))?
}

/// Remove a project from every list (D-200, closes D-REV-29) — a reversible soft-hide, never a
/// delete: the project's board, worktrees, runs and activity trail all stay in SQLite and
/// [`project_restore`] brings it back. Takes a project id and nothing else; the actor is resolved
/// here, never accepted from the renderer (T-11-53). Refuses an id that names no project.
#[tauri::command]
pub fn project_hide(state: State<AppState>, project_id: String) -> Result<(), String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("project id is required".to_string());
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::project::hide_project(&mut conn, &actor_id, project_id)
        .map_err(|e| e.to_string())
}

/// Undo [`project_hide`] and return the resulting project list. Re-verifies every project's
/// marker afterwards, so a restored project does not keep a stale `unreachable` or `active` status
/// until the next launch. Same argument rules as [`project_hide`]: an id, no actor.
#[tauri::command]
pub fn project_restore(state: State<AppState>, project_id: String) -> Result<Vec<ProjectDto>, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("project id is required".to_string());
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::project::restore_project(&mut conn, &actor_id, project_id)
        .map_err(|e| e.to_string())?;
    flywheel_core::domain::project::reconcile_projects(&mut conn, &actor_id)
        .map_err(|e| e.to_string())?;
    let projects =
        flywheel_core::domain::project::list_projects(&conn).map_err(|e| e.to_string())?;
    Ok(projects.into_iter().map(ProjectDto::from).collect())
}
