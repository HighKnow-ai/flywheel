//! LINK-04's command surface (Phase 7 plan 07-05): `git_identifier_resolve` is the renderer's
//! only route to the round trip's read half — a pasted commit hash or `flywheel/` branch name,
//! resolved to its board item. Read-only, and validated before any git invocation (T-07-05-01):
//! `flywheel_core::git_identity::classify` runs as the very first statement, before the database
//! is ever locked, so a string that is not a plausible hash or branch name never reaches a
//! subprocess. The string is passed to git only as a positional revision argument followed by
//! `--`, never into a flag position (`git_identity.rs`'s own `resolve_sha`). This command stores
//! nothing and caps nothing, because its result is at most one item (D-128).

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// `IdentityResolution`'s projection for the renderer — mirrors it field-for-field, plus
/// `item_title`, a single supplementary read (same locked connection, same project/item) that
/// `flywheel_core::git_identity` deliberately does not carry (its own struct never names a
/// title), so the palette entry has something to render without a second round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentityResolutionDto {
    pub project_id: String,
    pub item_kind: String,
    pub item_id: String,
    pub item_key: String,
    pub item_title: String,
    pub matched_sha: Option<String>,
    pub run_id: Option<String>,
}

/// The four outcome shapes `flywheel_core::git_identity::ResolveOutcome` can take, internally
/// tagged on `outcome` so the renderer narrows on one field rather than guessing which payload
/// fields are present.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum GitIdentityOutcomeDto {
    Resolved { resolution: GitIdentityResolutionDto },
    NotFound,
    AmbiguousPrefix { matches: usize },
    AmbiguousAcrossRepositories { repositories: usize },
}

/// Resolve a pasted string to its board item, or report why it couldn't be — read-only.
///
/// `classify` runs first, before `state.db` is ever locked (T-07-05-01): a string that is not a
/// plausible hash or `flywheel/` branch returns the not-found outcome immediately, with no
/// database lock taken and no subprocess spawned. A classified identifier is then handed to the
/// core's own resolver — this command delegates to it rather than re-implementing any part of
/// its repository loop.
#[tauri::command]
pub async fn git_identifier_resolve(state: State<'_, AppState>, raw: String) -> Result<GitIdentityOutcomeDto, String> {
    let Some(identifier) = flywheel_core::git_identity::classify(&raw) else {
        return Ok(GitIdentityOutcomeDto::NotFound);
    };

    // The resolver asks each registered repository's git: a side connection, not the board mutex
    // (issue #215), on the blocking pool, not the thread IPC dispatches on (issue #220).
    let path = super::board_path(&state.db)?;
    tauri::async_runtime::spawn_blocking(move || resolve_beside(&path, &identifier))
        .await
        .map_err(|e| super::ipc_error("git_identifier_resolve:join", e))?
}

fn resolve_beside(
    path: &std::path::Path,
    identifier: &flywheel_core::git_identity::GitIdentifier,
) -> Result<GitIdentityOutcomeDto, String> {
    let conn = super::open_beside(path)?;
    let outcome =
        flywheel_core::git_identity::resolve_identifier(&conn, identifier).map_err(|e| e.to_string())?;

    Ok(match outcome {
        flywheel_core::git_identity::ResolveOutcome::Resolved(resolution) => {
            // Every resolution names a Story (`item_kind` is "story").
            let item_title: String = conn
                .query_row("SELECT title FROM stories WHERE id = ?1", [&resolution.item_id], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            GitIdentityOutcomeDto::Resolved {
                resolution: GitIdentityResolutionDto {
                    project_id: resolution.project_id,
                    item_kind: resolution.item_kind,
                    item_id: resolution.item_id,
                    item_key: resolution.item_key,
                    item_title,
                    matched_sha: resolution.matched_sha,
                    run_id: resolution.run_id,
                },
            }
        }
        flywheel_core::git_identity::ResolveOutcome::NotFound => GitIdentityOutcomeDto::NotFound,
        flywheel_core::git_identity::ResolveOutcome::AmbiguousPrefix { matches } => {
            GitIdentityOutcomeDto::AmbiguousPrefix { matches }
        }
        flywheel_core::git_identity::ResolveOutcome::AmbiguousAcrossRepositories { repositories } => {
            GitIdentityOutcomeDto::AmbiguousAcrossRepositories { repositories }
        }
    })
}
