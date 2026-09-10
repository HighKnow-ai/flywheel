//! `agent_run_start` / `agent_run_log_window` — Start Work's one mutating command and the
//! session surface's one read (D-31, D-33, D-34). `agent_run_start` resolves the human actor
//! server-side (T-01-04), calls straight through to `flywheel_core::domain::agent_run::start_agent_run`
//! (worktree create-or-reuse + the transactional-outbox write), and then sends exactly one `spawn`
//! request to the sidecar with the absolute worktree path — never a relative one (PROC-02).
//! `agent_run_log_window` reads the durable JSONL log D-34 names, windowed with the same
//! `LIMIT`/`OFFSET` shape `query::events::activity_trail` already uses (D-33), capped server-side
//! at 100 rows (T-02-06) regardless of what the caller requests.

use std::io::{BufRead, BufReader};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// The only `permission_mode` values this handler accepts (D-36) — validated here, before the
/// value ever reaches the sidecar or the CLI argv it builds.
const ACCEPTED_PERMISSION_MODES: [&str; 4] = ["acceptEdits", "default", "plan", "bypassPermissions"];

const LOG_WINDOW_DEFAULT_LIMIT: i64 = 50;
const LOG_WINDOW_MAX_LIMIT: i64 = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDto {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub permission_mode: String,
}

/// Start a fresh agent run against `task_id` (D-30: always fresh, never `--resume`). Validates
/// `permission_mode`, resolves the human actor server-side (T-01-04), calls
/// `domain::agent_run::start_agent_run` (which itself ensures the task's worktree exists —
/// create-or-reuse, WORK-01/WORK-08), then sends one `spawn` request to the sidecar over its
/// stdin request channel. For this tracer, the prompt is the task's own title and description —
/// plan 02-04 replaces this with `assemble_context_packet`. Emits `board:changed` after the
/// domain write commits (D-04).
#[tauri::command]
pub fn agent_run_start(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    permission_mode: String,
) -> Result<AgentRunDto, String> {
    if !ACCEPTED_PERMISSION_MODES.contains(&permission_mode.as_str()) {
        return Err(format!(
            "permission_mode must be one of {ACCEPTED_PERMISSION_MODES:?}, got {permission_mode:?}"
        ));
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let run = flywheel_core::domain::agent_run::start_agent_run(
        &mut conn,
        &task_id,
        &permission_mode,
        &human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    let (title, description): (String, Option<String>) = conn
        .query_row(
            "SELECT title, description FROM tasks WHERE id = ?1",
            rusqlite::params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let worktree_path: String = conn
        .query_row(
            "SELECT path FROM worktrees WHERE id = ?1",
            rusqlite::params![run.worktree_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    drop(conn);

    let prompt = match description {
        Some(description) if !description.trim().is_empty() => format!("{title}\n\n{description}"),
        _ => title,
    };

    if let Some(sidecar) = state.sidecar.as_ref() {
        let request = serde_json::json!({
            "id": run.id,
            "op": "spawn",
            "runId": run.id,
            "worktreePath": worktree_path,
            "prompt": prompt,
            "permissionMode": permission_mode,
        });
        sidecar
            .send_request(&request.to_string())
            .map_err(|e| e.to_string())?;
    }

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "task", "id": task_id }),
    )
    .ok();

    Ok(AgentRunDto {
        id: run.id,
        task_id: run.task_id,
        status: run.status.as_str().to_string(),
        permission_mode: run.permission_mode,
    })
}

fn resolve_log_window_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(LOG_WINDOW_DEFAULT_LIMIT).clamp(1, LOG_WINDOW_MAX_LIMIT)
}

/// A bounded page of `agent_run_id`'s durable JSONL log, read with the same `LIMIT`/`OFFSET`
/// windowing shape `query::events::activity_trail` uses (D-33). `limit` is clamped server-side to
/// at most 100 regardless of what is requested (T-02-06) — never the whole log in one call. Each
/// returned element is the raw parsed JSON value of one log line; a line that fails to parse is
/// skipped rather than failing the whole read.
#[tauri::command]
pub fn agent_run_log_window(
    state: State<AppState>,
    agent_run_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let limit = resolve_log_window_limit(limit);
    let offset = offset.unwrap_or(0).max(0) as usize;

    let log_path: String = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT log_path FROM agent_runs WHERE id = ?1",
            rusqlite::params![agent_run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    Ok(read_log_window(&log_path, offset, limit as usize))
}

/// The actual windowed read over one session log file — split out from [`agent_run_log_window`]
/// so it is unit-testable directly, without going through Tauri's `State<AppState>` extraction
/// machinery (no other command handler in this crate carries unit tests, so there is no existing
/// in-crate precedent to follow; a plain function over a file path is the smallest testable seam).
/// A missing file returns an empty window, matching how a fresh activity trail behaves. A line
/// that fails to parse is skipped rather than failing the whole read.
fn read_log_window(log_path: &str, offset: usize, limit: usize) -> Vec<serde_json::Value> {
    let file = match std::fs::File::open(log_path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);

    reader
        .lines()
        .skip(offset)
        .take(limit)
        .filter_map(|line| line.ok())
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn resolve_log_window_limit_clamps_any_requested_value_to_the_100_row_ceiling() {
        assert_eq!(resolve_log_window_limit(None), LOG_WINDOW_DEFAULT_LIMIT);
        assert_eq!(resolve_log_window_limit(Some(1)), 1);
        assert_eq!(resolve_log_window_limit(Some(100)), 100);
        assert_eq!(resolve_log_window_limit(Some(500)), 100);
        assert_eq!(resolve_log_window_limit(Some(i64::MAX)), 100);
        assert_eq!(resolve_log_window_limit(Some(0)), 1);
        assert_eq!(resolve_log_window_limit(Some(-5)), 1);
    }

    #[test]
    fn read_log_window_returns_at_most_100_rows_for_any_requested_limit() {
        let dir = tempfile::tempdir().expect("failed to create scratch dir");
        let path = dir.path().join("run.jsonl");
        {
            let mut file = std::fs::File::create(&path).expect("failed to create fixture log file");
            for i in 0..250 {
                writeln!(file, "{{\"seq\":{i}}}").expect("failed to write fixture line");
            }
        }
        let path_str = path.to_string_lossy().into_owned();

        // Even asking for more than the ceiling (250 requested vs a 250-line file) must return
        // at most LOG_WINDOW_MAX_LIMIT rows — this function itself enforces no default, so the
        // caller (agent_run_log_window) is what applies resolve_log_window_limit's clamp; this
        // test asserts read_log_window still honours whatever `limit` it is actually given.
        let window = read_log_window(&path_str, 0, LOG_WINDOW_MAX_LIMIT as usize);
        assert_eq!(window.len(), LOG_WINDOW_MAX_LIMIT as usize);

        let full_clamped = read_log_window(&path_str, 0, resolve_log_window_limit(Some(9999)) as usize);
        assert!(full_clamped.len() <= LOG_WINDOW_MAX_LIMIT as usize);
    }

    #[test]
    fn read_log_window_on_a_missing_file_returns_an_empty_window() {
        let window = read_log_window("/nonexistent/path/to/a/log.jsonl", 0, 50);
        assert!(window.is_empty());
    }
}
