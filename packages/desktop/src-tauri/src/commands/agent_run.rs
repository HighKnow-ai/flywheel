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
//!
//! `handle_inbound_permission_request`/`process_inbound_permission_request` and
//! `agent_run_answer_permission`/`answer_permission_request` (AGNT-06, D-38) are the answer
//! round trip's two halves — inbound (a `permission_request` event arriving on
//! `sidecar.rs`'s reader loop) and outbound (a board decision reaching the held call). Both split
//! their DB-only logic into a plain, Tauri-free function (`process_inbound_permission_request`/
//! `answer_permission_request`) so the decision logic is unit-testable without a real spawned
//! sidecar process, mirroring `build_preview_dto`'s own reasoning.

use std::io::{BufRead, BufReader};

use flywheel_core::context_packet::{assemble_context_packet, render_prompt, ContextPacket};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

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

/// What happened when [`process_inbound_permission_request`] handled one `permission_request`
/// event — kept as a plain enum return value (rather than performing the IPC relay/emit inline)
/// so the rule-check-vs-pending-row decision is unit-testable against a bare `Connection`.
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionRequestOutcome {
    /// A matching `permission_rules` row resolved the call automatically — no
    /// `permission_requests` row was created and the run's status is untouched. `decision` is
    /// `"allow"` or `"deny"`, the MCP layer's own vocabulary (T-02-24).
    AutoResolved { decision: String },
    /// No rule matched — a `pending` row now exists and the run is `blocked`. `db_request_id` is
    /// `permission_requests.id`, the id the board/renderer names from here on.
    Pending { db_request_id: String },
    /// `run_id` names no `agent_runs` row this core knows about — nothing sane to do; logged
    /// nowhere yet, dropped, matching this module's "never crashes the reader task" discipline.
    UnknownRun,
}

/// The DB-only half of the inbound permission round trip (AGNT-06, D-38, T-02-24, T-02-27):
/// check `permission_rule::matching_rule` FIRST, before ever creating a pending row. A match
/// auto-resolves and still appends an event recording the automatic decision (T-02-27 — a
/// decision the board never shows as an event is exactly RESEARCH.md pitfall 4's failure mode),
/// even though no `permission_requests` row exists to hang that event off. No match falls
/// through to `permission_request::create_pending_request`, which blocks the run in the SAME
/// transaction as the row's own insert (Task 1's own contract).
pub fn process_inbound_permission_request(
    conn: &mut Connection,
    run_id: &str,
    tool_name: &str,
    input_payload: Option<&str>,
) -> Result<PermissionRequestOutcome, String> {
    let lookup: Result<(String, String), rusqlite::Error> = conn.query_row(
        "SELECT project_id, task_id FROM agent_runs WHERE id = ?1",
        rusqlite::params![run_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );
    let (project_id, task_id) = match lookup {
        Ok(v) => v,
        Err(_) => return Ok(PermissionRequestOutcome::UnknownRun),
    };

    let agent_id =
        flywheel_core::domain::agent_run::agent_actor_id(conn).map_err(|e| e.to_string())?;

    let rule = flywheel_core::domain::permission_rule::matching_rule(conn, &project_id, tool_name)
        .map_err(|e| e.to_string())?;

    if let Some(rule) = rule {
        let now = chrono::Utc::now().to_rfc3339();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let sequence = flywheel_core::domain::event::next_sequence(&tx, &project_id, "local")
            .map_err(|e| e.to_string())?;
        let label = if rule.decision == "allow" {
            format!("Auto-allowed {tool_name} (project rule)")
        } else {
            format!("Auto-denied {tool_name} (project rule)")
        };
        let payload = serde_json::json!({
            "field": "permission_request",
            "before": null,
            "after": rule.decision,
            "tool_name": tool_name,
            "label": label,
        });
        flywheel_core::domain::event::append_event(
            &tx,
            &project_id,
            "local",
            sequence,
            "permission_request",
            &flywheel_core::ids::new_id(),
            Some(&task_id),
            None,
            &agent_id,
            "permission_request.auto_resolved",
            &payload,
            &now,
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(PermissionRequestOutcome::AutoResolved { decision: rule.decision });
    }

    let request = flywheel_core::domain::permission_request::create_pending_request(
        conn,
        run_id,
        tool_name,
        input_payload,
        &agent_id,
    )
    .map_err(|e| e.to_string())?;

    Ok(PermissionRequestOutcome::Pending { db_request_id: request.id })
}

/// The Tauri-facing half of the inbound path — called from `sidecar.rs`'s reader loop for every
/// `permission_request` event. Extracts the event's fields, locks the DB, calls
/// [`process_inbound_permission_request`], and performs the IPC relay/`board:changed` emit the
/// outcome implies. Never panics on a malformed event — a missing field or lock failure is a
/// silent no-op, matching `sidecar.rs`'s own "a malformed line never crashes the reader task"
/// discipline.
pub fn handle_inbound_permission_request(app: &AppHandle, event: &serde_json::Value) {
    let (Some(run_id), Some(request_id), Some(tool_name)) = (
        event.get("runId").and_then(|v| v.as_str()),
        event.get("requestId").and_then(|v| v.as_str()),
        event.get("toolName").and_then(|v| v.as_str()),
    ) else {
        return;
    };
    let input = event.get("input").cloned().unwrap_or(serde_json::Value::Null);
    let input_payload = input.to_string();

    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(sidecar) = state.sidecar.as_ref() else { return };
    let Ok(mut conn) = state.db.lock() else { return };

    let outcome =
        match process_inbound_permission_request(&mut conn, run_id, tool_name, Some(&input_payload)) {
            Ok(outcome) => outcome,
            Err(_) => return,
        };
    drop(conn);

    match outcome {
        PermissionRequestOutcome::AutoResolved { decision } => {
            let _ = sidecar.relay_permission_answer_direct(run_id, request_id, &decision);
        }
        PermissionRequestOutcome::Pending { db_request_id } => {
            sidecar.register_pending_permission_request(&db_request_id, run_id, request_id);
            let _ = app.emit(
                "board:changed",
                serde_json::json!({ "entity": "agent_run", "id": run_id }),
            );
        }
        PermissionRequestOutcome::UnknownRun => {}
    }
}

/// Rejects a `decision` outside `allow`/`deny`/`allow_always` before any DB call happens
/// (mirrors [`validate_permission_mode`]'s own reasoning) and maps it to the value
/// `permission_request::answer_request` accepts — the schema's own CHECK-constrained
/// vocabulary (`allowed`/`denied`/`allowed_always`), a plain past-tense spelling of this
/// command's own present-tense one.
fn db_decision_for(decision: &str) -> Result<&'static str, String> {
    match decision {
        "allow" => Ok("allowed"),
        "deny" => Ok("denied"),
        "allow_always" => Ok("allowed_always"),
        other => Err(format!(
            "decision must be one of \"allow\", \"deny\", \"allow_always\", got {other:?}"
        )),
    }
}

/// What `agent_run_answer_permission` relays to the sidecar after a successful DB answer — kept
/// as a return value (never performed here) so the outbound path's decision logic is
/// unit-testable without a real spawned sidecar process.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRelayInstruction {
    pub run_id: String,
    /// `"allow"` or `"deny"` — the MCP layer's own binary vocabulary; `allow_always`'s "always"
    /// half is a `permission_rules` concept only, irrelevant to resolving THIS held call.
    pub decision: &'static str,
}

/// The DB-only half of the outbound answer round trip (AGNT-06, D-38): validate `decision`
/// BEFORE touching the database, call `permission_request::answer_request` (the once-only
/// guarded transition), and — for `allow_always` — also grant the project-scoped rule via
/// `permission_rule::upsert_rule`. Returns the relay instruction the caller sends to the
/// sidecar; on the already-answered error, returns that error and the caller relays nothing.
pub fn answer_permission_request(
    conn: &mut Connection,
    request_id: &str,
    decision: &str,
    actor_id: &str,
) -> Result<PermissionRelayInstruction, String> {
    let db_decision = db_decision_for(decision)?;

    let answered =
        flywheel_core::domain::permission_request::answer_request(conn, request_id, db_decision, actor_id)
            .map_err(|e| e.to_string())?;

    if decision == "allow_always" {
        flywheel_core::domain::permission_rule::upsert_rule(
            conn,
            &answered.project_id,
            &answered.tool_name,
            "allow",
            actor_id,
        )
        .map_err(|e| e.to_string())?;
    }

    let relay_decision: &'static str = if decision == "deny" { "deny" } else { "allow" };
    Ok(PermissionRelayInstruction { run_id: answered.agent_run_id, decision: relay_decision })
}

/// Answer a pending permission request from the board (AGNT-06, D-38). `actor_id` is resolved
/// server-side (T-01-04) — never accepted from the renderer. If `answer_permission_request`
/// returns the already-answered error, that error is returned to the renderer and NOTHING is
/// relayed to the sidecar — the held call was already settled by whichever answer won.
#[tauri::command]
pub fn agent_run_answer_permission(
    state: State<AppState>,
    app: AppHandle,
    request_id: String,
    decision: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;

    let instruction = answer_permission_request(&mut conn, &request_id, &decision, &actor_id)?;
    drop(conn);

    if let Some(sidecar) = state.sidecar.as_ref() {
        sidecar
            .relay_permission_answer(&request_id, instruction.decision)
            .map_err(|e| e.to_string())?;
    }

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "agent_run", "id": instruction.run_id }),
    )
    .ok();

    Ok(())
}

/// One `permission_rules` row, projected for the wire (camelCase) — plan 02-10's Settings
/// surface read/revoke path (D-38).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleDto {
    pub id: String,
    pub project_id: String,
    pub tool_name: String,
    pub decision: String,
    pub created_at: String,
}

impl From<flywheel_core::domain::permission_rule::PermissionRule> for PermissionRuleDto {
    fn from(rule: flywheel_core::domain::permission_rule::PermissionRule) -> Self {
        Self {
            id: rule.id,
            project_id: rule.project_id,
            tool_name: rule.tool_name,
            decision: rule.decision,
            created_at: rule.created_at,
        }
    }
}

/// List `project_id`'s allow-always rules (D-38) — read-only.
#[tauri::command]
pub fn permission_rules_list(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<PermissionRuleDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rules = flywheel_core::domain::permission_rule::rules_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    Ok(rules.into_iter().map(Into::into).collect())
}

/// Revoke an allow-always rule (D-38) — `actor_id` resolved server-side (T-01-04).
#[tauri::command]
pub fn permission_rule_revoke(state: State<AppState>, app: AppHandle, rule_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::permission_rule::revoke_rule(&mut conn, &rule_id, &actor_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit(
        "board:changed",
        serde_json::json!({ "entity": "permission_rule", "id": rule_id }),
    )
    .ok();

    Ok(())
}

/// One pending permission request, projected for the wire (camelCase) — the permission-request
/// card's data source (AGNT-06, plan 02-06 Task 2). Mirrors
/// `flywheel_core::query::permissions::PendingPermissionRequest` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionRequestDto {
    pub id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
}

impl From<flywheel_core::query::permissions::PendingPermissionRequest> for PendingPermissionRequestDto {
    fn from(r: flywheel_core::query::permissions::PendingPermissionRequest) -> Self {
        Self { id: r.id, tool_name: r.tool_name, input_payload: r.input_payload, created_at: r.created_at }
    }
}

/// List every pending permission request for `agent_run_id`, oldest first (AGNT-06, plan 02-06
/// Task 2) — the permission-request card's data source, shared by both mount points (the session
/// feed and the item detail panel both call this with the same `agent_run_id`). Read-only.
#[tauri::command]
pub fn agent_run_pending_permissions(
    state: State<AppState>,
    agent_run_id: String,
) -> Result<Vec<PendingPermissionRequestDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::query::permissions::pending_requests_for_run(&conn, &agent_run_id)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// The most recent agent run id for `task_id`, or `null` if the task has never had a run (AGNT-06,
/// plan 02-06 Task 2) — the item detail panel's own resolution of "this task's active run," so its
/// compact permission-request card mount can read the exact same `agent_run_id`-keyed query the
/// session feed's mount uses. Read-only.
#[tauri::command]
pub fn task_latest_agent_run(state: State<AppState>, task_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::query::permissions::latest_run_id_for_task(&conn, &task_id).map_err(|e| e.to_string())
}

/// D-37's board-visible blocked signal for one project (plan 02-06 Task 3): the board row's
/// blocked pill and the project-rail count read the SAME summary, so the two can never disagree at
/// different moments. A read: no mutation, no emit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedSummaryDto {
    pub blocked_task_ids: Vec<String>,
    pub blocked_count: i64,
}

/// Every blocked task id in `project_id` plus the count (D-37) — feeds `BoardRow.tsx`'s blocked
/// pill and `ProjectRail.tsx`'s count badge, delegating straight to `query::permissions`. Read-only.
#[tauri::command]
pub fn board_blocked_summary(state: State<AppState>, project_id: String) -> Result<BlockedSummaryDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let blocked_task_ids = flywheel_core::query::permissions::blocked_task_ids_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    let blocked_count = flywheel_core::query::permissions::blocked_count_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    Ok(BlockedSummaryDto { blocked_task_ids, blocked_count })
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

    /// A fresh migrated database with one project, one task and one `running` `agent_runs` row —
    /// inserted directly via literal SQL rather than `start_agent_run` (which requires a real git
    /// repository for `ensure_worktree`) since `process_inbound_permission_request`/
    /// `answer_permission_request` only ever read `agent_runs.project_id`/`task_id` and update
    /// its `status` column; they never touch a worktree or trigger row beyond what the schema's
    /// foreign keys require. `worktree_id` stays `NULL` (nullable per migration `0003`).
    fn seeded_conn_with_running_agent_run() -> (Connection, String, String, String) {
        let (conn, task_id) = seeded_conn_with_task(false);
        let project_id: String = conn
            .query_row("SELECT project_id FROM tasks WHERE id = ?1", rusqlite::params![task_id], |row| {
                row.get(0)
            })
            .expect("task's project_id should be readable");
        let human_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        let agent_actor_id = flywheel_core::domain::agent_run::agent_actor_id(&conn)
            .expect("seeded agent actor should exist");

        let now = "2026-01-01T00:00:00.000Z";
        let trigger_id = flywheel_core::ids::new_id();
        let run_id = flywheel_core::ids::new_id();
        conn.execute(
            "INSERT INTO triggers (
                id, project_id, target_task_id, source, config, enabled, last_fired_at,
                created_by, created_at
            ) VALUES (?1, ?2, ?3, 'user_action', NULL, 1, NULL, ?4, ?5)",
            rusqlite::params![trigger_id, project_id, task_id, human_actor_id, now],
        )
        .expect("failed to insert fixture trigger row");
        conn.execute(
            "INSERT INTO agent_runs (
                id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
                external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
                started_at, ended_at
            ) VALUES (?1, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'acceptEdits', \
                NULL, NULL, NULL, '/tmp/does-not-need-to-exist-for-this-test.jsonl', ?6, NULL)",
            rusqlite::params![run_id, task_id, project_id, trigger_id, agent_actor_id, now],
        )
        .expect("failed to insert fixture agent_runs row");

        (conn, run_id, task_id, project_id)
    }

    #[test]
    fn a_matching_allow_rule_auto_resolves_with_no_pending_row_and_the_run_stays_running() {
        let (mut conn, run_id, _task_id, project_id) = seeded_conn_with_running_agent_run();
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        flywheel_core::domain::permission_rule::upsert_rule(&mut conn, &project_id, "Bash", "allow", &actor_id)
            .expect("upsert_rule should succeed");

        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None)
            .expect("process_inbound_permission_request should succeed");
        assert_eq!(outcome, PermissionRequestOutcome::AutoResolved { decision: "allow".to_string() });

        let pending_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM permission_requests", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(pending_count, 0, "a rule match must create no permission_requests row");

        let run_status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert_eq!(run_status, "running", "a rule match must never block the run");

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'permission_request.auto_resolved'",
                [],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(event_count, 1, "the automatic decision must still appear in the activity trail (T-02-27)");
    }

    #[test]
    fn no_matching_rule_produces_a_pending_row_and_blocks_the_run() {
        let (mut conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();

        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None)
            .expect("process_inbound_permission_request should succeed");
        let db_request_id = match outcome {
            PermissionRequestOutcome::Pending { db_request_id } => db_request_id,
            other => panic!("expected Pending, got {other:?}"),
        };

        let pending_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM permission_requests WHERE id = ?1 AND status = 'pending'",
                rusqlite::params![db_request_id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(pending_count, 1);

        let run_status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert_eq!(run_status, "blocked");
    }

    #[test]
    fn an_unknown_run_id_is_a_harmless_no_op() {
        let (mut conn, _run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let outcome = process_inbound_permission_request(&mut conn, "not-a-real-run-id", "Bash", None)
            .expect("an unknown run_id must not error");
        assert_eq!(outcome, PermissionRequestOutcome::UnknownRun);
    }

    #[test]
    fn db_decision_for_accepts_exactly_the_three_named_values_and_rejects_others() {
        assert_eq!(db_decision_for("allow"), Ok("allowed"));
        assert_eq!(db_decision_for("deny"), Ok("denied"));
        assert_eq!(db_decision_for("allow_always"), Ok("allowed_always"));
        let err = db_decision_for("yolo").expect_err("an unrecognised decision should be rejected");
        assert!(err.contains("yolo"), "the error must name the rejected value, got: {err}");
    }

    #[test]
    fn answer_permission_request_rejects_an_invalid_decision_before_touching_the_database() {
        let (mut conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None)
            .expect("should succeed");
        let db_request_id = match outcome {
            PermissionRequestOutcome::Pending { db_request_id } => db_request_id,
            other => panic!("expected Pending, got {other:?}"),
        };
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");

        let events_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count query should succeed");

        let err = answer_permission_request(&mut conn, &db_request_id, "yolo", &actor_id)
            .expect_err("an out-of-set decision must be rejected");
        assert!(err.contains("yolo"), "the error must name the rejected value, got: {err}");

        let events_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(events_before, events_after, "an invalid decision must write nothing to the database");
    }

    #[test]
    fn answering_allow_always_writes_the_answered_row_and_exactly_one_permission_rule() {
        let (mut conn, run_id, _task_id, project_id) = seeded_conn_with_running_agent_run();
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None)
            .expect("should succeed");
        let db_request_id = match outcome {
            PermissionRequestOutcome::Pending { db_request_id } => db_request_id,
            other => panic!("expected Pending, got {other:?}"),
        };
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");

        let instruction = answer_permission_request(&mut conn, &db_request_id, "allow_always", &actor_id)
            .expect("answer_permission_request should succeed");
        assert_eq!(instruction, PermissionRelayInstruction { run_id: run_id.clone(), decision: "allow" });

        let answered_status: String = conn
            .query_row(
                "SELECT status FROM permission_requests WHERE id = ?1",
                rusqlite::params![db_request_id],
                |row| row.get(0),
            )
            .expect("permission_requests row should exist");
        assert_eq!(answered_status, "allowed_always");

        let rule_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM permission_rules WHERE project_id = ?1 AND tool_name = 'Bash'",
                rusqlite::params![project_id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(rule_count, 1, "allow_always must write exactly one permission_rules row");
    }

    #[test]
    fn answering_an_already_answered_request_returns_the_already_answered_error_with_nothing_left_to_relay() {
        let (mut conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None)
            .expect("should succeed");
        let db_request_id = match outcome {
            PermissionRequestOutcome::Pending { db_request_id } => db_request_id,
            other => panic!("expected Pending, got {other:?}"),
        };
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");

        // First answer: succeeds and produces exactly one relay instruction — the caller
        // (`agent_run_answer_permission`) would call `sidecar.relay_permission_answer` exactly
        // once for this Ok result.
        let first = answer_permission_request(&mut conn, &db_request_id, "allow", &actor_id);
        assert!(first.is_ok(), "the first answer must succeed and produce one relay instruction");

        // Second answer to the SAME request id: must be an Err, meaning the caller's own
        // `if let Some(sidecar) = ...` relay branch is never reached a second time — this IS the
        // "relays nothing" property this acceptance criterion names, since the command's
        // structure only ever calls `relay_permission_answer` after an `Ok` result (see
        // `agent_run_answer_permission`'s own body, which returns via `?` before reaching the
        // relay on an `Err`).
        let second = answer_permission_request(&mut conn, &db_request_id, "deny", &actor_id);
        assert!(second.is_err(), "answering an already-answered request must be refused");

        let answered_status: String = conn
            .query_row(
                "SELECT status FROM permission_requests WHERE id = ?1",
                rusqlite::params![db_request_id],
                |row| row.get(0),
            )
            .expect("permission_requests row should exist");
        assert_eq!(answered_status, "allowed", "the second (denying) answer must never overwrite the first");
    }
}
