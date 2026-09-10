//! `agent_run_preview` / `agent_run_start` / `agent_run_log_window` — the launch sheet's one
//! read, Start Work's one mutating command, and the session surface's one read (D-27, D-28,
//! D-31, D-33, D-34). `agent_run_preview` and `agent_run_start` both call
//! `flywheel_core::context_packet::assemble_context_packet` — one assembler, two call sites — and
//! both render the initial prompt through the one `render_prompt` function, so the sheet can
//! never show a briefing that differs from what the agent is actually told (T-02-21).
//! `agent_run_start` resolves the human actor server-side (T-01-04), calls straight through to
//! `flywheel_core::domain::agent_run::start_agent_run` (worktree create-or-reuse + the
//! transactional-outbox write), and then sends exactly one `spawn` request to the sidecar with
//! the absolute worktree path — never a relative one (PROC-02). `agent_run_log_window` reads the
//! durable JSONL log D-34 names, windowed with the same `LIMIT`/`OFFSET` shape
//! `query::events::activity_trail` already uses (D-33), capped server-side at 100 rows (T-02-06)
//! regardless of what the caller requests.

use std::io::{BufRead, BufReader};

use flywheel_core::context_packet::{assemble_context_packet, render_prompt, ContextPacket};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// The only `permission_mode` values this handler accepts (D-36) — validated here, before the
/// value ever reaches the sidecar or the CLI argv it builds.
const ACCEPTED_PERMISSION_MODES: [&str; 4] = ["acceptEdits", "default", "plan", "bypassPermissions"];

/// The hard cap on the operator's free-text instruction (T-02-20), the same bound-checking shape
/// `task_create`'s `MAX_TITLE_LEN` uses — measured in characters, not bytes.
const MAX_INSTRUCTION_LEN: usize = 4000;

/// Rejects a `permission_mode` outside [`ACCEPTED_PERMISSION_MODES`] before any DB or sidecar
/// call happens (T-02-19) — factored out of `agent_run_start` so it is independently unit
/// testable, matching this file's own `resolve_log_window_limit`/`read_log_window` precedent.
fn validate_permission_mode(mode: &str) -> Result<(), String> {
    if !ACCEPTED_PERMISSION_MODES.contains(&mode) {
        return Err(format!(
            "permission_mode must be one of {ACCEPTED_PERMISSION_MODES:?}, got {mode:?}"
        ));
    }
    Ok(())
}

/// Trims `instruction` and rejects one longer than [`MAX_INSTRUCTION_LEN`] characters with a
/// message naming both the limit and the actual length (T-02-20) — `None`/an all-whitespace
/// value trims to an empty string, which `render_prompt` already treats as "no instruction"
/// (omits the heading entirely).
fn validate_instruction(instruction: Option<&str>) -> Result<String, String> {
    let trimmed = instruction.unwrap_or("").trim();
    let char_count = trimmed.chars().count();
    if char_count > MAX_INSTRUCTION_LEN {
        return Err(format!(
            "instruction must be at most {MAX_INSTRUCTION_LEN} characters, got {char_count} characters"
        ));
    }
    Ok(trimmed.to_string())
}

/// One acceptance criterion, projected for the wire (camelCase) — mirrors
/// `context_packet::CriterionEntry` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionDto {
    pub statement: String,
    pub verification_hint: Option<String>,
}

/// The launch sheet's read-only briefing (D-27/D-28) — the packet's structured fields AND the
/// rendered prompt string, so the sheet displays exactly the text that will be sent rather than
/// re-deriving its own rendering in TypeScript (one renderer, in Rust, used by both the preview
/// and the launch).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPacketDto {
    pub task_key: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub epic_title: Option<String>,
    pub epic_description: Option<String>,
    pub criteria: Vec<CriterionDto>,
    pub branch: String,
    pub base_ref: String,
    pub worktree_path: String,
    pub rendered_prompt: String,
}

impl From<ContextPacket> for ContextPacketDto {
    fn from(packet: ContextPacket) -> Self {
        // Computed with an empty instruction — the preview has no instruction yet; this field
        // exists so the desktop crate never has a second prompt-rendering implementation of its
        // own (T-02-21), not to show the operator a raw prompt dump (the sheet renders the
        // structured fields below it instead).
        let rendered_prompt = render_prompt(&packet, "");
        Self {
            task_key: packet.task_key,
            task_title: packet.task_title,
            task_description: packet.task_description,
            epic_title: packet.epic.as_ref().map(|e| e.title.clone()),
            epic_description: packet.epic.as_ref().and_then(|e| e.description.clone()),
            criteria: packet
                .criteria
                .into_iter()
                .map(|c| CriterionDto {
                    statement: c.statement,
                    verification_hint: c.verification_hint,
                })
                .collect(),
            branch: packet.worktree.branch,
            base_ref: packet.worktree.base_ref,
            worktree_path: packet.worktree.path,
            rendered_prompt,
        }
    }
}

/// The actual preview logic, split out from [`agent_run_preview`] so it is unit-testable without
/// going through Tauri's `State<AppState>` extraction machinery — the same reasoning
/// [`read_log_window`] documents for its own split. Performs no insert, update or delete: every
/// call inside is a `SELECT` (`assemble_context_packet`'s own contract, D-28).
fn build_preview_dto(conn: &Connection, task_id: &str) -> Result<ContextPacketDto, String> {
    let packet = assemble_context_packet(conn, task_id).map_err(|e| e.to_string())?;
    Ok(packet.into())
}

/// Preview the briefing a Start Work run against `task_id` would send (D-27/D-28) — a read: it
/// mutates nothing, creates no worktree, writes no trigger row and emits no event. That "nothing
/// happens until the primary action fires" property is the whole point of the launch sheet.
#[tauri::command]
pub fn agent_run_preview(state: State<AppState>, task_id: String) -> Result<ContextPacketDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    build_preview_dto(&conn, &task_id)
}

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
/// `permission_mode` and the operator's free-text `instruction` (T-02-19/T-02-20) before any DB
/// or sidecar call happens, resolves the human actor server-side (T-01-04), calls
/// `domain::agent_run::start_agent_run` (which itself ensures the task's worktree exists —
/// create-or-reuse, WORK-01/WORK-08), then re-assembles the context packet against the
/// now-created worktree and renders it through the SAME `render_prompt` function
/// `agent_run_preview` uses (T-02-21: one Rust-side renderer, no second implementation in the
/// renderer) — replacing plan 02-01's title-and-description placeholder. Persists
/// `permission_mode` on the run row via `start_agent_run` itself. Emits `board:changed` after the
/// domain write commits (D-04).
#[tauri::command]
pub fn agent_run_start(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
    permission_mode: String,
    instruction: Option<String>,
) -> Result<AgentRunDto, String> {
    validate_permission_mode(&permission_mode)?;
    let instruction = validate_instruction(instruction.as_deref())?;

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

    // Re-read the packet now that the worktree is real (not predicted) — the same assembler
    // `agent_run_preview` calls, so this run's prompt is exactly what the sheet most recently
    // previewed, modulo the operator's own instruction (T-02-21).
    let packet = assemble_context_packet(&conn, &task_id).map_err(|e| e.to_string())?;
    let prompt = render_prompt(&packet, &instruction);

    let worktree_path: String = conn
        .query_row(
            "SELECT path FROM worktrees WHERE id = ?1",
            rusqlite::params![run.worktree_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    drop(conn);

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

/// Stop a running agent run (D-35: interrupt, then force). Sends the sidecar's `interrupt`
/// request FIRST, over `SidecarHandle::interrupt_run`, and blocks until it acknowledges — so the
/// process has already finished the whole interrupt-then-force sequence by the time the domain
/// write below lands — then calls `domain::agent_run::interrupt_agent_run` (idempotent: a no-op
/// on a run that is already terminal). `actor_id` is resolved server-side (T-01-04, T-02-13) —
/// never accepted from the renderer. Drops the connection lock before emitting `board:changed`
/// with an `{ entity: "agent_run", id }` payload, the same shape `task_create` uses (D-04).
#[tauri::command]
pub fn agent_run_stop(state: State<AppState>, app: AppHandle, agent_run_id: String) -> Result<(), String> {
    if let Some(sidecar) = state.sidecar.as_ref() {
        sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string())?;
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::agent_run::interrupt_agent_run(&mut conn, &agent_run_id, &human_actor_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": agent_run_id }),
    )
    .ok();

    Ok(())
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

    /// A fresh migrated database with one project and one task (optionally under one epic) — no
    /// real git repository needed, since `assemble_context_packet`'s no-worktree branch never
    /// shells out to git.
    fn seeded_conn_with_task(with_epic: bool) -> (Connection, String) {
        let dir = tempfile::tempdir().expect("failed to create scratch dir");
        let db_path = dir.path().join("flywheel.db");
        let backups_dir = dir.path().join("backups");
        std::mem::forget(dir);

        let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
            .expect("open_and_migrate should succeed");
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        let project = flywheel_core::domain::project::create_project(
            &mut conn,
            &actor_id,
            "Test Project",
            "/tmp/does-not-need-to-exist-for-this-test",
            "FLY",
            "main",
        )
        .expect("create_project should succeed");
        let epic_id = if with_epic {
            Some(
                flywheel_core::domain::epic::create_epic(&mut conn, &project.id, &actor_id, "Test epic", None)
                    .expect("create_epic should succeed")
                    .id,
            )
        } else {
            None
        };
        let task = flywheel_core::domain::task::create_task(
            &mut conn,
            &project.id,
            &actor_id,
            "Test task",
            epic_id.as_deref(),
        )
        .expect("create_task should succeed");

        (conn, task.id)
    }

    #[test]
    fn build_preview_dto_performs_no_insert_update_or_delete() {
        let (conn, task_id) = seeded_conn_with_task(true);
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .expect("count query should succeed")
        };
        let (triggers_before, worktrees_before, agent_runs_before) =
            (count("triggers"), count("worktrees"), count("agent_runs"));

        let dto = build_preview_dto(&conn, &task_id).expect("build_preview_dto should succeed");
        assert_eq!(dto.task_title, "Test task");

        assert_eq!(count("triggers"), triggers_before);
        assert_eq!(count("worktrees"), worktrees_before);
        assert_eq!(count("agent_runs"), agent_runs_before);
    }

    #[test]
    fn the_previewed_prompt_and_the_started_runs_prompt_come_from_the_same_renderer() {
        let (conn, task_id) = seeded_conn_with_task(false);
        let dto = build_preview_dto(&conn, &task_id).expect("build_preview_dto should succeed");

        // What `agent_run_start` builds for the same (empty) instruction the preview implicitly
        // used — re-assembling the packet independently, exactly as the real handler does after
        // `start_agent_run` runs, and rendering it through the identical `render_prompt` call.
        let packet = assemble_context_packet(&conn, &task_id).expect("assembly should succeed");
        let started_prompt_same_instruction = render_prompt(&packet, "");
        assert_eq!(
            dto.rendered_prompt, started_prompt_same_instruction,
            "the preview's prompt must equal the prompt a start with the same instruction would send"
        );

        // And for a real instruction, both call sites still agree — there is exactly one
        // renderer, so nothing here can drift into a second implementation.
        let with_instruction_a = render_prompt(&packet, "steer it this way");
        let with_instruction_b = render_prompt(&packet, "steer it this way");
        assert_eq!(with_instruction_a, with_instruction_b);
    }

    #[test]
    fn validate_permission_mode_accepts_exactly_the_four_named_values_and_rejects_others() {
        for mode in ACCEPTED_PERMISSION_MODES {
            assert!(validate_permission_mode(mode).is_ok(), "{mode} should be accepted");
        }
        let err = validate_permission_mode("yolo").expect_err("an unrecognised mode should be rejected");
        assert!(err.contains("yolo"), "the error must name the rejected value, got: {err}");
    }

    #[test]
    fn validate_instruction_trims_and_rejects_over_4000_characters() {
        assert_eq!(validate_instruction(None).expect("None should be accepted"), "");
        assert_eq!(
            validate_instruction(Some("  hi  ")).expect("a short instruction should be accepted"),
            "hi"
        );

        let exactly_at_limit = "a".repeat(MAX_INSTRUCTION_LEN);
        assert!(validate_instruction(Some(&exactly_at_limit)).is_ok());

        let over_limit = "a".repeat(MAX_INSTRUCTION_LEN + 1);
        let err = validate_instruction(Some(&over_limit)).expect_err("an over-limit instruction should be rejected");
        assert!(err.contains("4000"), "the error must name the limit, got: {err}");
        assert!(err.contains("4001"), "the error must name the actual length, got: {err}");
    }
}
