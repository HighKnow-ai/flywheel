//! `board_change_flags` — Phase 8.1 plan 01's board-wide "which task has real changes" read
//! (D-15, D-16): per active worktree of one project, commits ahead of its base and whether its
//! tree is dirty, in ONE call for the whole board — never one per row.
//!
//! Read-only, and the only parameter is the project id: the branch, base and path are all derived
//! inside `packages/core` from the board, so a renderer can never name a ref, a sha or a path
//! (T-08.1-01). Unlike `board_forge_flags` (a bounded `events` read), this command reaches git, so
//! it follows `review.rs`'s lock-safe split: the database mutex is held for the board half only
//! and released before git runs, and the git half runs on the blocking pool, off the IPC thread —
//! the scheduler already holds `AppState.db` across its own ticks, so a second long holder would
//! queue behind it (T-08.1-02).

use serde::Serialize;
use tauri::State;

use super::ipc_error;
use crate::state::AppState;

/// Mirrors `flywheel_core::query::change_flags::ChangeFlag` field-for-field. `ahead: null` means
/// cannot-measure, which is not the same as `0` (level).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeFlagDto {
    pub task_id: String,
    pub epic_id: Option<String>,
    pub ahead: Option<u32>,
    pub dirty: bool,
}

impl From<flywheel_core::query::change_flags::ChangeFlag> for ChangeFlagDto {
    fn from(flag: flywheel_core::query::change_flags::ChangeFlag) -> Self {
        Self { task_id: flag.task_id, epic_id: flag.epic_id, ahead: flag.ahead, dirty: flag.dirty }
    }
}

/// The server-side cap on the sweep (T-08.1-02) — applied here, before the call into
/// `packages/core`, like `BOARD_FORGE_FLAGS_CAP`.
const BOARD_CHANGE_FLAGS_CAP: usize = 200;

/// Change flags for every active worktree of `projectId` (capped). Read-only.
#[tauri::command(async)]
pub async fn board_change_flags(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<ChangeFlagDto>, String> {
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("board_change_flags:lock", e))?;
        let inputs = flywheel_core::query::change_flags::change_flag_inputs(
            &conn,
            &project_id,
            BOARD_CHANGE_FLAGS_CAP,
        )
        .map_err(|e| ipc_error("board_change_flags:read", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        inputs?
    };

    let flags = tauri::async_runtime::spawn_blocking(move || {
        flywheel_core::query::change_flags::finish_change_flags(inputs)
    })
    .await
    .map_err(|e| ipc_error("board_change_flags:join", e))?
    .map_err(|e| ipc_error("board_change_flags:git", e))?;

    Ok(flags.into_iter().map(ChangeFlagDto::from).collect())
}
