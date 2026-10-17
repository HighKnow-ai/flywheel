//! `agent_run_start` / `agent_run_log_window` — Start Work's one mutating command and the session
//! surface's one read (D-27, D-31, D-33, D-34). The context packet builder and its launch-sheet
//! preview (`agent_run_preview`) were deleted by issue #38; until the MVP's Context packet exists a
//! run starts from `flywheel_core::domain::agent_run::stand_in_launch_prompt`.
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
//!
//! `handle_inbound_session_closed` (G-02-4) follows the exact same split for the terminal path: a
//! `session_closed` event arriving on `sidecar.rs`'s reader loop is handled by this Tauri-facing
//! half, which calls straight through to the DB-only
//! `flywheel_core::domain::agent_run::apply_session_closed` — the production caller
//! `close_agent_run` never had. This is the call site whose absence was gap G-02-4: a run that
//! ends on its own — completed or failed — previously stayed `running` on the board forever.

use std::io::{BufRead, BufReader};

use flywheel_core::domain::session_summary::{DecisionEntry, SessionSummary};
use flywheel_core::dispatch::ReadinessRefusal;
use rusqlite::{Connection, Transaction};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::{emit_board_changed, project_of, project_of_locked};

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

/// One decision entry inside a summary's `decisions` list, projected for the wire (camelCase) —
/// mirrors `domain::session_summary::DecisionEntry` field-for-field (plan 04-08 Task 2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionDto {
    pub id: String,
    pub statement: String,
}

impl From<DecisionEntry> for DecisionDto {
    fn from(entry: DecisionEntry) -> Self {
        Self { id: entry.id, statement: entry.statement }
    }
}

/// One prior-session summary, projected for the wire (camelCase) — mirrors
/// `context_packet::SummaryEntry` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryDto {
    pub agent_run_id: String,
    pub created_at: String,
    pub auto_generated: bool,
    pub changed_files: Vec<String>,
    pub changed_prose: Option<String>,
    pub remains: Option<String>,
    pub next_session_must_know: Option<String>,
    pub decisions: Vec<DecisionDto>,
}

/// The item detail panel's own summary read (`task_session_summaries`, plan 04-09 Task 3).
impl From<SessionSummary> for SessionSummaryDto {
    fn from(summary: SessionSummary) -> Self {
        Self {
            agent_run_id: summary.agent_run_id,
            created_at: summary.created_at,
            auto_generated: summary.auto_generated,
            changed_files: summary.changed_files,
            changed_prose: summary.changed_prose,
            remains: summary.remains,
            next_session_must_know: summary.next_session_must_know,
            decisions: summary.decisions.into_iter().map(DecisionDto::from).collect(),
        }
    }
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
    /// Set only when a user's own launch overlaps a DIFFERENT live task (phase 09 plan 09-13): the
    /// one sentence Rust composed from the stored rows, shown by the renderer verbatim. `None` for
    /// an ordinary launch, so the warning means something when it appears.
    pub overlap_warning: Option<String>,
}

/// What [`start_agent_run_recording_first`] produced (gap #2 of 04-VERIFICATION.md, CTX-06) — the
/// DB-only half of a Start Work run's outcome, everything [`agent_run_start`] itself needs to
/// finish the Tauri- and process-facing half (merge the shim env, send the spawn request, emit
/// `board:changed`, build the returned DTO) without touching the database again.
pub(crate) struct StartRunOutcome {
    pub run_id: String,
    pub worktree_path: String,
    pub prompt: String,
    /// The run's scope marker was written ARMED (the task has a declared file-set). The sidecar is
    /// told, so it refuses to start the run if it cannot wire the scope gate in (phase 09 review
    /// CR-01) rather than running it unenforced.
    pub scope_armed: bool,
}

/// The DB-only half of [`agent_run_start`] (gap #2 of 04-VERIFICATION.md, CTX-06), extracted so
/// the fix at its heart is unit-testable against a bare `&mut Connection`, with no
/// `State<AppState>` and no `AppHandle` — named after [`stop_agent_run_recording_first`]'s
/// identical precedent in this file, for the identical reason.
///
/// `case_insensitive` is the repository's observed `core.ignorecase`, read by the caller BEFORE the
/// database lock was taken (it is a `git config` subprocess, D-REV-39 WR-07) and written into the
/// scope marker unchanged.
///
/// Performs, in exactly this order:
/// 1. `start_agent_run`.
/// 2. `stand_in_launch_prompt` (issue #38 deleted the context packet, and with it the drift
///    warnings it carried and the predecessor-run read they needed; the MVP's Context packet
///    replaces them).
/// 3. `list_current_criteria` then `pin_criteria_revisions`, unchanged.
/// 4. the `SELECT path FROM worktrees WHERE id = ?1` read for the worktree path.
/// 5. [`arm_run_scope`] (phase 09, plan 09-01, D-150/D-151) — writes the run's scope marker, AFTER
///     the worktree path is read (the marker records the canonical worktree root) and BEFORE the
///     outcome is returned, so the marker exists on disk before the caller can spawn a session
///     that reads it. Unarmed when the task declares no file-set; armed otherwise. A marker-write
///     failure returns an error from this function and aborts the start: a run that cannot record
///     its scope must not start.
pub(crate) fn start_agent_run_recording_first(
    conn: &mut Connection,
    task_id: &str,
    permission_mode: &str,
    instruction: &str,
    human_actor_id: &str,
    case_insensitive: bool,
) -> Result<StartRunOutcome, String> {
    // Step 1.
    let run = flywheel_core::domain::agent_run::start_agent_run(
        conn,
        task_id,
        permission_mode,
        human_actor_id,
    )
    .map_err(|e| e.to_string())?;

    // Steps 2-4 all run AFTER the run row exists, so an error from any of them closes that row
    // `failed` before it propagates (D-REV-46): a `running` row with no session behind it holds a
    // cap slot and makes `launch_conflict` answer `HasLiveRun` until the app restarts.
    let built = (|| -> Result<(String, String), String> {
        // Step 2: the stand-in prompt, read now that the run row and its worktree exist.
        let prompt = flywheel_core::domain::agent_run::stand_in_launch_prompt(conn, task_id, instruction)
            .map_err(|e| e.to_string())?;

        // Step 3 (D-78, plan 04-10): pin, on the run row, exactly which criterion revisions this
        // briefing carried — read via `list_current_criteria` in the same rank order the prompt
        // above lists them, so the pin and the prompt agree by construction.
        let criteria_ids: Vec<String> =
            flywheel_core::domain::acceptance_criterion::list_current_criteria(conn, "task", task_id)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|c| c.id)
                .collect();
        flywheel_core::domain::agent_run::pin_criteria_revisions(conn, &run.id, &criteria_ids)
            .map_err(|e| e.to_string())?;

        // Step 4.
        let worktree_path: String = conn
            .query_row(
                "SELECT path FROM worktrees WHERE id = ?1",
                rusqlite::params![run.worktree_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        Ok((prompt, worktree_path))
    })();
    let (prompt, worktree_path) = match built {
        Ok(v) => v,
        Err(why) => return Err(fail_launch(conn, &run.id, why)),
    };

    // Step 5 (D-150/D-151, plan 09-01) — see this function's own doc comment. On failure the run
    // row this function inserted at step 1 is closed `failed` before the error propagates: a
    // `running` row with no session behind it would hold a dispatcher slot forever (plan 09-07
    // counts `running` runs) and leave the task looking worked-on.
    let scope_armed = arm_run_scope(conn, &run.id, task_id, &worktree_path, case_insensitive)
        .map_err(|why| fail_launch(conn, &run.id, why))?;

    Ok(StartRunOutcome {
        run_id: run.id,
        worktree_path,
        prompt,
        scope_armed,
    })
}

/// Write `run_id`'s scope marker (D-150, D-151): the single call that decides "armed or unarmed",
/// so no spawn path can forget it. The body lives in `flywheel_core` (`domain::file_set::
/// arm_scope_marker`) so the contract test in `packages/core` drives the very same function; this
/// wrapper is the name the run-start path calls and the place the error becomes a command error.
/// A task with no declared file-set gets an explicit `unarmed` marker — `agent_run_start` behaves
/// exactly as it did before this phase for it. Returns whether the marker was written ARMED.
pub(crate) fn arm_run_scope(
    conn: &Connection,
    run_id: &str,
    task_id: &str,
    worktree_path: &str,
    case_insensitive: bool,
) -> Result<bool, String> {
    flywheel_core::domain::file_set::arm_scope_marker_with(
        conn,
        run_id,
        task_id,
        std::path::Path::new(worktree_path),
        case_insensitive,
    )
    .map(|mode| mode == flywheel_core::runtime_protocol::ScopeMode::Armed)
}

/// Close a run whose launch failed after its row was inserted, and hand `why` back for the caller to
/// return. The one place that decides what a failed launch leaves behind: a `failed` row, never a
/// `running` one (D-REV-46). Best-effort on the close itself, as [`fail_planning_start`]'s is: the
/// original failure is the error worth reporting.
pub(crate) fn fail_launch(conn: &mut Connection, run_id: &str, why: String) -> String {
    let _ = flywheel_core::domain::agent_run::close_agent_run(
        conn,
        run_id,
        flywheel_core::domain::agent_run::AgentRunStatus::Failed,
        None,
        None,
        None,
    );
    why
}

/// Start a fresh agent run against `task_id` (D-30: always fresh, never `--resume`). Validates
/// `permission_mode` and the operator's free-text `instruction` (T-02-19/T-02-20) before any DB
/// or sidecar call happens, then delegates everything else to [`launch_run_for_task`] — the ONE
/// launch path, shared with the fan-out dispatcher (phase 09 plan 09-07). A task with no declared
/// file-set launches exactly as it did before that phase.
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
    launch_run_for_task(
        &state,
        &app,
        &task_id,
        &permission_mode,
        &instruction,
        CrossTaskConflict::WarnAndProceed,
    )
}

/// D-52/WORK-05: the ONLY place a spawn request leaves the app — it goes through
/// `SidecarHandle::send_spawn_request`, which enforces the per-repository spawn floor. Both
/// [`launch_run_for_task`] and the planning run (phase 09 plan 09-08) call it, so a spawn that
/// is not a task launch is still staggered. The caller must NOT hold the `AppState.db` lock: the
/// floor sleeps. With no sidecar attached there is nothing to send and this succeeds.
pub(crate) fn send_gated_spawn(
    state: &AppState,
    repo_path: &str,
    request: &serde_json::Value,
) -> Result<(), String> {
    match state.sidecar.as_ref() {
        Some(sidecar) => sidecar.send_spawn_request(repo_path, &request.to_string()).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// How the launch body disposes of a conflict with a DIFFERENT live task (phase 09 plan 09-13).
/// Both callers pass one explicitly; there is no default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CrossTaskConflict {
    /// The dispatcher's launch: a conflict refuses, nothing is created, and `run_pass` records a
    /// pre-spawn launch failure that the next pass retries.
    Refuse,
    /// A user's own launch: never refused for a cross-task conflict (the 09-07 choice), but recorded
    /// as an event and carried back on the result so it is no longer silent.
    WarnAndProceed,
}

/// The event appended when a user's own launch overlaps a DIFFERENT live task (phase 09 plan 09-13).
/// Payload follows the `task.scope_denied` idiom: a human `label`, then the facts.
pub(crate) const EVENT_LAUNCH_OVERLAP: &str = "task.launch_overlap";

/// Everything the lock-held half of a launch produced; [`launch_run_for_task`] finishes the
/// process-facing half (shim env, gated spawn, `board:changed`) from it.
pub(crate) struct PreparedLaunch {
    pub outcome: StartRunOutcome,
    pub repo_path: String,
    pub env: std::collections::HashMap<String, String>,
    pub overlap_warning: Option<String>,
}

/// The database half of a launch, run under the caller's `AppState.db` lock: actor, credential,
/// the launch-conflict check, the run row. Split out of [`launch_run_for_task`] so it can be driven
/// without a Tauri app handle.
pub(crate) fn prepare_launch(
    conn: &mut Connection,
    task_id: &str,
    permission_mode: &str,
    instruction: &str,
    conflict: CrossTaskConflict,
    fold_case: bool,
) -> Result<PreparedLaunch, String> {
    // D-REV-39 IN-02: `Refuse` is the dispatcher's launch, which nobody at the keyboard asked for, so
    // it is the system actor's act (and `start_agent_run` flags it automatic from that actor's type);
    // `WarnAndProceed` is the user pressing Launch. Same convention the automatic merge uses.
    let initiator_id = match conflict {
        CrossTaskConflict::Refuse => flywheel_core::domain::actor::system_actor(conn).map(|a| a.id),
        CrossTaskConflict::WarnAndProceed => flywheel_core::domain::actor::local_human_actor_id(conn),
    }
    .map_err(|e| e.to_string())?;

    // Resolve the credential BEFORE any run/worktree state is created (D-39, plan 02-09 Task 2).
    // `resolve_credential` errors when the credential mode is api_key and no key is stored
    // (T-02-42) — that failure must never leave behind an already-`running` `agent_runs` row and
    // a freshly created worktree that will never actually be spawned into, so the project id is
    // looked up (read-only) and the credential resolved BEFORE `start_agent_run_recording_first`
    // runs.
    // D-52 (plan 03-04): `repo_path` is read in this SAME `query_row` call, one extra column, no
    // extra round trip — the spawn request needs it to key the per-repository spawn floor
    // (`send_spawn_request`, below).
    let (project_id, repo_path): (String, String) = conn
        .query_row(
            "SELECT tasks.project_id, projects.repo_path
             FROM tasks
             JOIN projects ON projects.id = tasks.project_id
             WHERE tasks.id = ?1",
            rusqlite::params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let env = crate::sidecar::resolved_env_for_run(conn, &project_id).map_err(|e| e.to_string())?;

    // The disjointness rule, consulted BEFORE `start_agent_run_recording_first` inserts the run row,
    // so a refused launch creates nothing: no `running` row holding a cap slot, no worktree. Plan
    // 09-12's single rule, the same function the dispatcher's `readiness` calls; a verdict the
    // dispatcher took under its own lock can be stale by now, which is exactly why it is asked again
    // here, at the body every launch passes through.
    // `fold_case` is the repository's OBSERVED flag, the same value `readiness` reads for the dispatcher
    // (`Observations::case_insensitive`), resolved by the caller before it took this lock because it
    // runs `git config`. Both callers therefore return one verdict for one pair on every filesystem
    // (D-REV-44): the launch used to fold unconditionally, so on a case-sensitive repository it
    // refused a pair the dispatcher had judged disjoint.
    let cross_task = match flywheel_core::dispatch::launch_conflict(conn, task_id, &project_id, fold_case, &[])
        .map_err(|e| e.to_string())?
    {
        None => None,
        // Not a cap refusal: two agents in one worktree corrupts the work, `readiness` already
        // refuses it for the dispatcher, and no contract promises a user they may do it. So it
        // refuses on BOTH dispositions.
        Some(ReadinessRefusal::HasLiveRun) => {
            return Err("This task already has a running or blocked run. A second agent in the same \
                        worktree would corrupt the work, so this launch is refused."
                .to_string());
        }
        Some(refusal @ (ReadinessRefusal::OverlapsInFlight { .. } | ReadinessRefusal::RunsAlone { .. })) => {
            Some(conflict_sentence(conn, &refusal)?)
        }
        Some(other) => return Err(format!("Launch refused: {other:?}")),
    };
    if let (Some(sentence), CrossTaskConflict::Refuse) = (&cross_task, conflict) {
        return Err(format!("Launch refused: {sentence}"));
    }

    let outcome =
        start_agent_run_recording_first(conn, task_id, permission_mode, instruction, &initiator_id, fold_case)?;
    // A user's own launch proceeds, but no longer silently. The run id exists now, so the event can
    // carry it; its own transaction, as the neighbouring event writes do.
    if let Some(sentence) = &cross_task {
        record_launch_overlap(conn, &project_id, task_id, &outcome.run_id, &initiator_id, sentence)
            .map_err(|why| fail_launch(conn, &outcome.run_id, why))?;
    }
    Ok(PreparedLaunch { outcome, repo_path, env, overlap_warning: cross_task })
}

/// The one sentence for a cross-task launch conflict, composed from the stored rows: it names the
/// other task by key and, for an overlap, the colliding path. Shown verbatim by the renderer.
fn conflict_sentence(conn: &Connection, refusal: &ReadinessRefusal) -> Result<String, String> {
    let key_of = |task_id: &str| -> Result<String, String> {
        conn.query_row("SELECT key FROM tasks WHERE id = ?1", rusqlite::params![task_id], |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    Ok(match refusal {
        ReadinessRefusal::OverlapsInFlight { task_id, path } => {
            format!("Overlaps {}, which is running now: both declare {path}.", key_of(task_id)?)
        }
        ReadinessRefusal::RunsAlone { task_id } => format!(
            "{} is running now and a task with no declared file set runs alone, so nothing shows these two are disjoint.",
            key_of(task_id)?
        ),
        other => return Err(format!("not a cross-task conflict: {other:?}")),
    })
}

/// Append one [`EVENT_LAUNCH_OVERLAP`] row for a user's launch that overlaps a live task, in its own
/// transaction. Payload follows the `task.scope_denied` idiom: a human `label`, then the facts.
fn record_launch_overlap(
    conn: &mut Connection,
    project_id: &str,
    task_id: &str,
    run_id: &str,
    actor_id: &str,
    sentence: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let epic_id: Option<String> = tx
        .query_row("SELECT epic_id FROM tasks WHERE id = ?1", rusqlite::params![task_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({ "label": sentence, "run_id": run_id });
    let sequence =
        flywheel_core::domain::event::next_sequence(&tx, project_id, "local").map_err(|e| e.to_string())?;
    flywheel_core::domain::event::append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        EVENT_LAUNCH_OVERLAP,
        &payload,
        &now,
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// The process-facing half of a launch, after [`prepare_launch`] inserted the run row: the shim env
/// merge, then the spawn request through the one gated path. `merge_shim` and `send` are parameters
/// only so a test can force each to fail; [`launch_run_for_task`] passes the real ones.
///
/// D-51: the shim's per-run directory is keyed by the run id, which only exists from `prepare_launch`
/// on, so a shim-install failure here refuses the spawn (see `merge_shim_env_for_run`'s own doc
/// comment for why this cannot live inside `resolved_env_for_run`). `conn` is the caller's held
/// `AppState.db` guard; it is dropped before `send` so the spawn floor's sleep never runs while
/// holding the SQLite mutex (T-03-04-05), mirroring `agent_run_stop`'s own resolve-before-lock
/// discipline.
pub(crate) fn spawn_prepared_run(
    db: &std::sync::Mutex<Connection>,
    mut conn: std::sync::MutexGuard<'_, Connection>,
    outcome: &StartRunOutcome,
    mut env: std::collections::HashMap<String, String>,
    permission_mode: &str,
    merge_shim: impl FnOnce(&mut std::collections::HashMap<String, String>, &str) -> anyhow::Result<()>,
    send: impl FnOnce(&serde_json::Value) -> Result<(), String>,
) -> Result<(), String> {
    merge_shim(&mut env, &outcome.run_id)
        .map_err(|e| fail_launch(&mut conn, &outcome.run_id, e.to_string()))?;
    drop(conn);

    let request = serde_json::json!({
        "id": outcome.run_id,
        "op": "spawn",
        "runId": outcome.run_id,
        "worktreePath": outcome.worktree_path,
        "prompt": outcome.prompt,
        "permissionMode": permission_mode,
        "scopeArmed": outcome.scope_armed,
        "env": env,
    });
    // The guard is gone (the spawn floor sleeps inside `send`), so closing the row takes the lock afresh.
    send(&request).map_err(|why| match db.lock() {
        Ok(mut conn) => fail_launch(&mut conn, &outcome.run_id, why),
        Err(_) => why,
    })
}

/// The repository's OBSERVED case flag for `task_id`, read with no database lock held across the probe:
/// the repository path under a short lock, the lock dropped, the `git config` subprocess, and the
/// caller takes the lock again (the shape the worktree reclaim path uses). This is the value the
/// dispatcher's `readiness` already reads, so a launch and a dispatcher decision see one flag
/// (D-REV-44); it also keeps `git config` off `AppState.db` (D-REV-39 WR-07).
pub(crate) fn observed_fold_case(db: &std::sync::Mutex<Connection>, task_id: &str) -> Result<bool, String> {
    let repo_path = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        flywheel_core::domain::file_set::task_repo_path(&conn, task_id).map_err(|e| e.to_string())?
    };
    Ok(flywheel_core::domain::file_set::repo_is_case_insensitive(std::path::Path::new(&repo_path)))
}

/// The launch body, after argument validation: resolves the human actor server-side (T-01-04),
/// credential resolution before any run/worktree state exists (D-39, T-02-42), the DB-only half
/// ([`prepare_launch`]), the shim env merge, the spawn request through the one gated path, and the
/// `board:changed` emit.
///
/// Called by [`agent_run_start`] for a user's launch and by the dispatcher for an autonomous one:
/// one launch path, so there is one place the order below can be wrong. The cap and the limit gate
/// are the DISPATCHER's to consult; neither is consulted here, so a user's own launch is never
/// refused by either. The disjointness rule IS consulted here ([`prepare_launch`], before any run
/// state exists); it is the caller's `conflict` disposition that decides whether a conflict with a
/// DIFFERENT task refuses or is merely recorded and surfaced, and a user's own launch is still never
/// refused for one (the recorded choice in `09-07-SUMMARY`). A task's OWN live run refuses on both.
/// Callers pass an already-validated mode and instruction.
pub(crate) fn launch_run_for_task(
    state: &AppState,
    app: &AppHandle,
    task_id: &str,
    permission_mode: &str,
    instruction: &str,
    conflict: CrossTaskConflict,
) -> Result<AgentRunDto, String> {
    let fold_case = observed_fold_case(&state.db, task_id)?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let PreparedLaunch { outcome, repo_path, env, overlap_warning } =
        prepare_launch(&mut conn, task_id, permission_mode, instruction, conflict, fold_case)?;
    spawn_prepared_run(
        &state.db,
        conn,
        &outcome,
        env,
        permission_mode,
        crate::sidecar::merge_shim_env_for_run,
        |request| send_gated_spawn(state, &repo_path, request),
    )?;

    let project_id = project_of_locked(&state.db, "tasks", task_id);
    emit_board_changed(app, project_id.as_deref(), "task", Some(task_id));

    Ok(AgentRunDto {
        id: outcome.run_id,
        task_id: task_id.to_string(),
        // `start_agent_run` always inserts a fresh run with `status = 'running'` — see
        // `start_agent_run_recording_first`'s own step 1.
        status: "running".to_string(),
        permission_mode: permission_mode.to_string(),
        overlap_warning,
    })
}

/// What [`agent_run_stop`] recorded (CR-04, D-35, PROC-06). `status` is read back from
/// `agent_runs` after the write, never a hard-coded literal, and `sidecar_warning` is populated
/// only when the sidecar's interrupt request could not be confirmed — a `None` here means the
/// interrupt was acknowledged (or no sidecar was attached at all), never that nothing was
/// recorded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStopDto {
    pub agent_run_id: String,
    pub status: String,
    pub sidecar_warning: Option<String>,
}

/// The Stop/Discard termination unit (D-64, CTX-01, gap #1 of 04-VERIFICATION.md): runs, inside
/// the CALLER's transaction, the core in-tx interrupt sibling followed by the presence-checked
/// fallback-summary insert — mirroring the shape `apply_session_closed` already gives the
/// natural-close variant via `close_agent_run_in_tx`. Composing these two writes on the same
/// `&Transaction` is what makes "a terminated run always has a summary" a property of the
/// database rather than of call ordering: a crash between the two writes now rolls back BOTH,
/// leaving the run exactly as it was, instead of leaving a terminal run with no summary at all.
///
/// The status read happens AFTER `interrupt_agent_run_in_tx`'s write, and is issued against this
/// same `tx` — never a separate connection-level read — so the synthesized fallback summary
/// records the run's terminal status, never the pre-terminal one. This ordering is load-bearing:
/// reading the status before the interrupt write, or off a different connection/transaction,
/// would let the fallback summary claim a status the run never actually reached (or claim the
/// wrong one if a concurrent write raced in between).
///
/// Returns the run's terminal status string, read back from `agent_runs` on this same `tx`.
pub(crate) fn stop_agent_run_in_tx(
    tx: &Transaction,
    agent_run_id: &str,
    actor_id: &str,
) -> Result<String, String> {
    flywheel_core::domain::agent_run::interrupt_agent_run_in_tx(tx, agent_run_id, actor_id)
        .map_err(|e| e.to_string())?;

    let status: String = tx
        .query_row(
            "SELECT status FROM agent_runs WHERE id = ?1",
            rusqlite::params![agent_run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // If the agent already recorded its own summary, leave it exactly as it is — never write a
    // second, synthesized row over an agent-authored one. Only an ABSENT summary triggers the
    // fallback (D-64). The presence check and the insert both run on THIS `tx`, so the decision
    // and the write cannot disagree with a concurrent insert on a different connection.
    if flywheel_core::domain::session_summary::latest_summary_for_run(tx, agent_run_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        flywheel_core::domain::session_summary::synthesize_fallback_summary(tx, agent_run_id, &status)
            .map_err(|e| e.to_string())?;
    }

    Ok(status)
}

/// The DB-only half of [`agent_run_stop`] (CR-04): records the run's terminal status
/// UNCONDITIONALLY, regardless of what `interrupt` returns. `interrupt` is invoked exactly once,
/// FIRST, but its `Result` is captured in a local rather than propagated with `?` or an early
/// `return` — a sidecar that crashed, wedged, or never acknowledged the request can therefore
/// only widen the returned DTO's `sidecar_warning`, never starve the domain write below it. This
/// is the actual fix for CR-04: the previous `agent_run_stop` applied `?` directly to
/// `interrupt_run`'s result, so a sidecar that failed to answer within
/// `SidecarHandle::INTERRUPT_ACK_TIMEOUT` left the run stuck `running`/`blocked` forever with no
/// force path — precisely the moment a user most needs Stop to work (PROC-06 "at any time").
///
/// `actor_id` is resolved server-side (T-01-04) — never accepted from the renderer. The terminal
/// write and the presence-checked fallback-summary insert now run inside ONE transaction, via
/// [`stop_agent_run_in_tx`] (D-64, CTX-01, gap #1 of 04-VERIFICATION.md) — mirroring the pattern
/// `apply_session_closed` documents for the natural-close variant. `interrupt_agent_run_in_tx` is
/// idempotent on an already-terminal run (D-35), so calling this seam twice on the same run
/// appends no second `agent_run.interrupted` event and does not overwrite the recorded status.
/// `Err` from this function means only that the terminal write itself failed — never that the
/// sidecar did not answer.
pub(crate) fn stop_agent_run_recording_first(
    conn: &mut Connection,
    agent_run_id: &str,
    interrupt: impl FnOnce() -> Result<(), String>,
) -> Result<AgentRunStopDto, String> {
    let interrupt_result = interrupt();

    let human_actor_id =
        flywheel_core::domain::actor::local_human_actor_id(conn).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let status = stop_agent_run_in_tx(&tx, agent_run_id, &human_actor_id)?;
    tx.commit().map_err(|e| e.to_string())?;

    let sidecar_warning = interrupt_result.err().map(|e| {
        format!(
            "Flywheel recorded this run as interrupted, but could not confirm the agent process stopped: {e}"
        )
    });

    Ok(AgentRunStopDto { agent_run_id: agent_run_id.to_string(), status, sidecar_warning })
}

/// Stop a running agent run (D-35: interrupt, then force; CR-04). The interrupt request is still
/// sent to the sidecar FIRST, over `SidecarHandle::interrupt_run`, and this command still blocks
/// until it acknowledges (or times out) — but that outcome can only ADD a warning to the
/// returned DTO, never prevent the terminal write: see `stop_agent_run_recording_first`, which
/// keeps the interrupt's `Result` in a local instead of propagating it with `?`. A sidecar that
/// is crashed, wedged, or never acknowledges the interrupt therefore still leaves the run at a
/// terminal status, exactly once, regardless of what the sidecar side did. `Err` from THIS
/// command now means only that the terminal write itself could not be recorded — it no longer
/// means "the sidecar did not answer". `actor_id` is resolved server-side (T-01-04, T-02-13) —
/// never accepted from the renderer. Drops the connection lock before emitting `board:changed`
/// with an `{ entity: "agent_run", id }` payload, the same shape `task_create` uses (D-04).
///
/// CR-01 (`02-REVIEW.md` gap-closure round): the interrupt call — which can block for up to
/// `SidecarHandle::INTERRUPT_ACK_TIMEOUT` (30s) — MUST run before `state.db.lock()` is acquired,
/// never after. `state.db` is the one `Mutex<Connection>` every other command in this codebase
/// locks first; holding it across a 30-second wait on a wedged sidecar would freeze every other
/// board read, task creation, and agent-run interaction in the app, not just this one Stop call.
/// If a future refactor moves the lock acquisition ahead of the interrupt again, this ordering
/// silently regresses — there is no compiler error for it, only degraded behavior under exactly
/// the failure mode CR-04 exists to make graceful.
#[tauri::command]
pub fn agent_run_stop(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<AgentRunStopDto, String> {
    // Resolve the interrupt outcome BEFORE touching `state.db` — see the CR-01 note above.
    let interrupt_result = match state.sidecar.as_ref() {
        Some(sidecar) => sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string()),
        None => Ok(()),
    };

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let dto = stop_agent_run_recording_first(&mut conn, &agent_run_id, move || interrupt_result)?;
    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(dto)
}

/// The bounded wait a discard gives the agent's own closing summary before falling through to the
/// same interrupt-then-force path [`agent_run_stop`] already walks (D-66, plan 04-13's own
/// resolution of D-66's open timing item — the backend runs headless, so there is no channel to
/// inject an extra user turn into a live session; every briefing's own Closing Requirement section
/// already tells the agent, by exact tool name, to record its summary as its final turn, and this
/// constant is discard's only contribution: time for that turn to land before the interrupt).
/// Longer than the sidecar's `STOP_GRACE_MS` (5_000ms, `claude-code-adapter.ts` — the
/// SIGINT-to-SIGTERM grace window), because this window waits for a MODEL to finish a tool call
/// rather than for a process to notice a signal; shorter than twice `STOP_GRACE_MS`, because
/// discard has to keep feeling like one action. The two windows are sequential, so the worst case
/// before the force step fires is thirteen seconds (`DISCARD_SUMMARY_WAIT_MS` + `STOP_GRACE_MS` =
/// 8_000 + 5_000).
pub const DISCARD_SUMMARY_WAIT_MS: u64 = 8_000;

/// How often [`agent_run_discard`]'s own loop re-checks for a recorded summary or a terminal
/// status — modest enough not to hammer the shared DB mutex, short enough that the bounded wait
/// actually behaves like a poll rather than one long sleep.
const DISCARD_POLL_INTERVAL_MS: u64 = 200;

/// One poll iteration's read: has a summary landed for this run yet, and has the run already
/// reached a terminal status on its own? Takes a plain `&Connection` — never the lock itself — so
/// [`agent_run_discard`]'s own loop can take and release `state.db.lock()` once per poll, never
/// holding it across the whole wait (T-04-36): `agent_run_stop`'s own CR-01 comment states the
/// reason in this exact file — holding the app's one `Mutex<Connection>` across a multi-second wait
/// freezes every other board read in the app — and that reasoning applies here with more force,
/// because this window is longer. A read error on either query degrades to "no summary yet, not
/// terminal yet" (T-04-37) — a poll must never fail the discard because it happened to error once.
fn discard_poll_snapshot(conn: &Connection, agent_run_id: &str) -> (bool, bool) {
    let has_summary =
        flywheel_core::domain::session_summary::latest_summary_for_run(conn, agent_run_id)
            .ok()
            .flatten()
            .is_some();
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE id = ?1",
            rusqlite::params![agent_run_id],
            |row| row.get(0),
        )
        .ok();
    let is_terminal = matches!(
        status.as_deref(),
        Some("completed") | Some("failed") | Some("interrupted") | Some("abandoned")
    );
    (has_summary, is_terminal)
}

/// Discard a live run in one action (D-66/D-67, plan 04-13, CTX-08 — the phase's flagship path,
/// the user-visible half of everything the previous twelve plans built): give the agent's own
/// closing summary a bounded window to land, then end the session through the EXACT SAME path
/// [`agent_run_stop`] already walks — a thin wrapper around it, never a second termination
/// implementation. A surfaced contradiction or a missing summary must never stand between the
/// developer and a fresh session (T-04-37): the wait is bounded by [`DISCARD_SUMMARY_WAIT_MS`]
/// regardless of whether the agent ever answers, and a poll error along the way is simply treated
/// as "no summary yet" rather than aborting the discard.
///
/// Returns the SAME [`AgentRunStopDto`] `agent_run_stop` returns, so the renderer's existing
/// handling applies unchanged — the caller cannot tell, from the return shape alone, whether the
/// summary that ended up recorded was agent-authored or the fallback synthesizer's.
#[tauri::command]
pub fn agent_run_discard(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<AgentRunStopDto, String> {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(DISCARD_SUMMARY_WAIT_MS);
    loop {
        // Lock taken and released each iteration — never held across the wait (T-04-36, see
        // discard_poll_snapshot's own doc comment).
        let (has_summary, is_terminal) = match state.db.lock() {
            Ok(conn) => discard_poll_snapshot(&conn, &agent_run_id),
            Err(_) => (false, false),
        };
        if has_summary || is_terminal {
            break;
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(DISCARD_POLL_INTERVAL_MS));
    }

    // From here on, exactly what agent_run_stop performs: the CR-01 resolve-the-interrupt-before-
    // locking-the-shared-db-mutex ordering, then the ONE shared termination tail
    // (stop_agent_run_recording_first), then the same board:changed emit shape agent_run_stop uses.
    let interrupt_result = match state.sidecar.as_ref() {
        Some(sidecar) => sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string()),
        None => Ok(()),
    };

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let dto = stop_agent_run_recording_first(&mut conn, &agent_run_id, move || interrupt_result)?;
    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(dto)
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
///
/// `destructive_category` (D-56/D-57, plan 03-07): when `Some`, the `matching_rule` check above
/// is SKIPPED entirely and this request goes straight to `create_pending_request` — a project's
/// existing "always allow {tool_name}" rule (D-38) is scoped to `(project_id, tool_name)`, the
/// SAME tool name (`"Bash"`) a destructive command also arrives under, so without this bypass a
/// routine standing grant earned for ordinary Bash calls would silently auto-approve a
/// force-push or a `rm -rf` the very first time one arrived — exactly the standing-grant leak
/// D-57 says must be structurally impossible, not merely absent from the answer UI.
pub fn process_inbound_permission_request(
    conn: &mut Connection,
    run_id: &str,
    tool_name: &str,
    input_payload: Option<&str>,
    destructive_category: Option<&str>,
) -> Result<PermissionRequestOutcome, String> {
    // D-84's assumption-delta promote (plan 05-09): the run raising this request may be an
    // authoring session, wrapped by the SAME destructive gate/PATH shim (D-86) — `task_id` is
    // `Option<String>`, `epic_id` read alongside it. Reading `task_id` as a non-optional `String`
    // here previously failed the whole query (an `InvalidColumnType` error) for any authoring
    // run, which this function's own `Err(_) => UnknownRun` branch then silently mistook for "no
    // such run" — an authoring run genuinely blocked on a permission request never reached
    // `create_pending_request` at all.
    let lookup: Result<(String, Option<String>, Option<String>), rusqlite::Error> = conn.query_row(
        "SELECT project_id, task_id, epic_id FROM agent_runs WHERE id = ?1",
        rusqlite::params![run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    let (project_id, task_id, epic_id) = match lookup {
        Ok(v) => v,
        Err(_) => return Ok(PermissionRequestOutcome::UnknownRun),
    };

    let agent_id =
        flywheel_core::domain::agent_run::agent_actor_id(conn).map_err(|e| e.to_string())?;

    // D-57: a destructive request never consults an existing per-project rule — see this
    // function's own doc comment for why that bypass is load-bearing, not an optimisation.
    let rule = if destructive_category.is_some() {
        None
    } else {
        flywheel_core::domain::permission_rule::matching_rule(conn, &project_id, tool_name)
            .map_err(|e| e.to_string())?
    };

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
            task_id.as_deref(),
            epic_id.as_deref(),
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
        destructive_category,
    )
    .map_err(|e| e.to_string())?;

    Ok(PermissionRequestOutcome::Pending { db_request_id: request.id })
}

/// The project name and subject label a notification names, read in the caller's existing
/// connection. A missing row degrades to a generic word rather than failing: this is on the
/// must-never-panic path of both hooks below.
fn notify_context(conn: &Connection, run_id: &str) -> (String, String) {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT p.name, COALESCE(t.key, e.key)
               FROM agent_runs ar
               JOIN projects p ON p.id = ar.project_id
               LEFT JOIN tasks t ON t.id = ar.task_id
               LEFT JOIN epics e ON e.id = ar.epic_id
              WHERE ar.id = ?1",
            rusqlite::params![run_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    match row {
        Some((project, subject)) => (project, subject.unwrap_or_else(|| "An agent".to_string())),
        None => ("Flywheel".to_string(), "An agent".to_string()),
    }
}

/// The notification a freshly pending permission request earns (D-174), or `None`. Only the
/// `running` -> `blocked` edge notifies: a run that was already `blocked` and received a second
/// concurrent request must not announce itself again (Finding 5, Pitfall 3).
fn permission_transition(
    conn: &Connection,
    run_id: &str,
    prior_status: Option<&str>,
    tool_name: &str,
) -> Option<crate::notify::Transition> {
    if prior_status != Some("running") {
        return None;
    }
    let (project_name, subject_label) = notify_context(conn, run_id);
    Some(crate::notify::Transition {
        run_id: run_id.to_string(),
        project_name,
        subject_label,
        kind: crate::notify::TransitionKind::Blocked,
        tool: Some(tool_name.to_string()),
    })
}

/// The notification a closed session earns (D-174), or `None`. `Completed` and `Failed` only.
/// `Interrupted` is user-initiated, and an already-terminal or backfilled-terminal outcome means
/// nothing transitioned. Both exclusions fall out for free and need no extra guard: the Stop path
/// writes `interrupted` first, so the later `session_closed` is already-terminal, and
/// `mark_abandoned` runs at launch before any window exists.
fn closed_transition(
    conn: &Connection,
    run_id: &str,
    outcome: &flywheel_core::domain::agent_run::SessionClosedOutcome,
) -> Option<crate::notify::Transition> {
    use flywheel_core::domain::agent_run::{AgentRunStatus, SessionClosedOutcome};
    let kind = match outcome {
        SessionClosedOutcome::Closed(AgentRunStatus::Completed) => crate::notify::TransitionKind::Completed,
        SessionClosedOutcome::Closed(AgentRunStatus::Failed) => crate::notify::TransitionKind::Failed,
        _ => return None,
    };
    let (project_name, subject_label) = notify_context(conn, run_id);
    Some(crate::notify::Transition {
        run_id: run_id.to_string(),
        project_name,
        subject_label,
        kind,
        tool: None,
    })
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

    // D-56/D-57 (plan 03-07): a TOP-LEVEL `destructiveCategory` field on the event itself — lifted
    // there by `claude-code-adapter.ts`'s `onRequest` handler from the shim's own
    // `input.destructiveCategory` wire shape — present only when the shim's own
    // `destructive::classify` call found this command destructive
    // (`packages/shim/src/main.rs`). An unrecognised string here (a version skew between the
    // shim's compiled category set and this core's) falls back to `Uncategorized` rather than
    // being silently dropped — the whole point of the field's presence is "the shim already
    // decided this is destructive," so a malformed value must still route to the destructive
    // gate, never quietly to `None`.
    let destructive_category = event
        .get("destructiveCategory")
        .and_then(|v| v.as_str())
        .map(|raw| {
            flywheel_core::destructive::DestructiveCategory::from_str_name(raw)
                .unwrap_or(flywheel_core::destructive::DestructiveCategory::Uncategorized)
                .as_str()
        });

    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(sidecar) = state.sidecar.as_ref() else { return };
    let Ok(mut conn) = state.db.lock() else { return };

    // Read BEFORE the request is processed: processing blocks the run, so this is the only moment
    // the prior status (the edge a notification needs) is still observable.
    let prior_status: Option<String> = conn
        .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |r| r.get(0))
        .ok();

    let outcome = match process_inbound_permission_request(
        &mut conn,
        run_id,
        tool_name,
        Some(&input_payload),
        destructive_category,
    ) {
        Ok(outcome) => outcome,
        Err(_) => return,
    };
    // The banner's text is gathered with the connection still held, so it needs no second lock.
    let transition = match &outcome {
        PermissionRequestOutcome::Pending { .. } => {
            permission_transition(&conn, run_id, prior_status.as_deref(), tool_name)
        }
        _ => None,
    };
    let project_id = project_of(&conn, "agent_runs", run_id);
    drop(conn);

    match outcome {
        PermissionRequestOutcome::AutoResolved { decision } => {
            let _ = sidecar.relay_permission_answer_direct(run_id, request_id, &decision);
        }
        PermissionRequestOutcome::Pending { db_request_id } => {
            sidecar.register_pending_permission_request(&db_request_id, run_id, request_id);
            emit_board_changed(app, project_id.as_deref(), "agent_run", Some(run_id));
            if let Some(t) = transition {
                crate::notify::push(t);
            }
        }
        PermissionRequestOutcome::UnknownRun => {}
    }
}

/// The Tauri-facing half of the terminal-event path (G-02-4) — called from `sidecar.rs`'s reader
/// loop for every `session_closed` event, mirroring [`handle_inbound_permission_request`]'s own
/// split: the DB-only decision (`flywheel_core::domain::agent_run::apply_session_closed`) stays
/// testable without a real spawned sidecar, and this half performs the IPC-adjacent side effect
/// (the `board:changed` emit) the outcome implies.
///
/// This function must never panic — no `expect`, no `unwrap`, no direct indexing (T-02G-18-05): a
/// malformed event, a poisoned lock, or an error from the applier is a silent no-op here, matching
/// `sidecar.rs`'s own "a malformed line never crashes the reader task" discipline. No per-run fault
/// on this path may ever disturb the shared reader loop that calls it.
pub fn handle_inbound_session_closed(app: &AppHandle, event: &serde_json::Value) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Ok(mut conn) = state.db.lock() else { return };

    let outcome = match flywheel_core::domain::agent_run::apply_session_closed(&mut conn, event) {
        Ok(outcome) => outcome,
        Err(_) => return,
    };
    let run_id = event.get("runId").and_then(|v| v.as_str());
    let transition = run_id.and_then(|id| closed_transition(&conn, id, &outcome));
    let project_id = run_id.and_then(|id| project_of(&conn, "agent_runs", id));
    drop(conn);

    let changed = matches!(
        outcome,
        flywheel_core::domain::agent_run::SessionClosedOutcome::Closed(_)
            | flywheel_core::domain::agent_run::SessionClosedOutcome::BackfilledTerminal
    );
    if let (true, Some(run_id)) = (changed, run_id) {
        emit_board_changed(app, project_id.as_deref(), "agent_run", Some(run_id));
    }
    if let Some(t) = transition {
        crate::notify::push(t);
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
    let project_id = project_of(&conn, "agent_runs", &instruction.run_id);
    drop(conn);

    if let Some(sidecar) = state.sidecar.as_ref() {
        sidecar
            .relay_permission_answer(&request_id, instruction.decision)
            .map_err(|e| e.to_string())?;
    }

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&instruction.run_id));

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
    // Read before the revoke: the row (and its project) is gone afterwards.
    let project_id = project_of(&conn, "permission_rules", &rule_id);
    flywheel_core::domain::permission_rule::revoke_rule(&mut conn, &rule_id, &actor_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "permission_rule", Some(&rule_id));

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
    /// `None` for a routine request, `Some(category)` (one of
    /// `destructive::DestructiveCategory::as_str()`'s kebab-case names) for a destructive one —
    /// selects the destructive-action gate card's variant (plan 03-12).
    pub destructive_category: Option<String>,
}

impl From<flywheel_core::query::permissions::PendingPermissionRequest> for PendingPermissionRequestDto {
    fn from(r: flywheel_core::query::permissions::PendingPermissionRequest) -> Self {
        Self {
            id: r.id,
            tool_name: r.tool_name,
            input_payload: r.input_payload,
            created_at: r.created_at,
            destructive_category: r.destructive_category,
        }
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

/// D-46's board-visible "recovery needed" signal for one project (plan 03-11): a task's worktree
/// reading `missing` (D-45) or an unacknowledged abandoned run (D-49/D-50). The board row's Needs
/// Decision pill and the project-rail's second count badge read this SAME summary, so the two can
/// never disagree at different moments — mirrors `BlockedSummaryDto`'s own reasoning. A read: no
/// mutation, no emit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySummaryDto {
    pub recovery_task_ids: Vec<String>,
    pub recovery_count: i64,
}

/// Every task id in `project_id` with an outstanding recovery item plus the count (D-46) — feeds
/// `BoardRow.tsx`'s Needs Decision pill and `ProjectRail.tsx`'s second count badge, delegating
/// straight to `query::recovery`. Read-only.
#[tauri::command]
pub fn board_recovery_summary(state: State<AppState>, project_id: String) -> Result<RecoverySummaryDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let recovery_task_ids = flywheel_core::query::recovery::recovery_task_ids_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    let recovery_count = flywheel_core::query::recovery::recovery_count_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())?;
    Ok(RecoverySummaryDto { recovery_task_ids, recovery_count })
}

fn resolve_log_window_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(LOG_WINDOW_DEFAULT_LIMIT).clamp(1, LOG_WINDOW_MAX_LIMIT)
}

/// A bounded page of `agent_run_id`'s durable JSONL log (D-33/D-34, plan 02-07 Task 1) — a thin
/// DTO wrapper over `flywheel_core::session_log::LogWindow`. `limit` is clamped server-side to at
/// most 100 regardless of what is requested (T-02-06) — the desktop layer's own clamp on top of
/// `read_window`'s own internal one, so the ceiling holds even if a future call site here forgets
/// to apply it. `entries` carries each line's parsed JSON value, with a malformed line degrading
/// to an `unknown` entry rather than being dropped (T-02-33). `total` is the log's true complete-
/// line count, so the renderer can page backwards from the tail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogWindowDto {
    pub entries: Vec<serde_json::Value>,
    pub offset: i64,
    pub limit: i64,
    pub total: i64,
}

impl From<flywheel_core::session_log::LogWindow> for LogWindowDto {
    fn from(window: flywheel_core::session_log::LogWindow) -> Self {
        Self {
            entries: window.entries,
            offset: window.offset as i64,
            limit: window.limit as i64,
            total: window.total as i64,
        }
    }
}

// The shape guard for `agent_run_id` lives in `flywheel_core::session_log::session_log_path`
// (the single join site both this command and `agent_run_raw_window` funnel through) — NOT here.
// Adding a second check in this command would be a second implementation of the same rule, the
// exact drift plan 03-15 exists to prevent (see `session_log_path`'s own doc comment).
#[tauri::command]
pub fn agent_run_log_window(
    agent_run_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<LogWindowDto, String> {
    let limit = resolve_log_window_limit(limit);
    let offset = offset.unwrap_or(0).max(0);

    flywheel_core::session_log::read_window(&agent_run_id, offset as usize, limit as usize)
        .map(LogWindowDto::from)
        .map_err(|e| e.to_string())
}

/// One verbatim line of the raw persisted log, with its 0-based line number (D-32's raw escape
/// hatch) — never re-parsed as JSON, so the raw view is always the file's actual ground truth,
/// byte for byte, even for a line the structured feed could not render.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLogLineDto {
    pub line: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLogWindowDto {
    pub lines: Vec<RawLogLineDto>,
    pub offset: i64,
    pub limit: i64,
    pub total: i64,
}

/// The raw view's own bounded read (plan 02-07 Task 1/3, D-32) — the same windowing shape
/// `agent_run_log_window` uses (offset/limit clamped identically, `total` from
/// `session_log::count_lines`), but returning each line's VERBATIM text instead of its parsed
/// value. Never reads the whole file into memory: bounded skip/take over a buffered reader,
/// mirroring `session_log::read_window`'s own discipline.
#[tauri::command]
pub fn agent_run_raw_window(
    agent_run_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<RawLogWindowDto, String> {
    let limit = resolve_log_window_limit(limit);
    let offset = offset.unwrap_or(0).max(0);

    let total = flywheel_core::session_log::count_lines(&agent_run_id).map_err(|e| e.to_string())?;
    let path =
        flywheel_core::session_log::session_log_path(&agent_run_id).map_err(|e| e.to_string())?;
    let lines = read_raw_line_window(&path, offset as usize, limit as usize, total);

    Ok(RawLogWindowDto { lines, offset, limit, total: total as i64 })
}

/// The actual bounded verbatim read behind [`agent_run_raw_window`] — split out so it is
/// unit-testable directly, without going through Tauri's `State<AppState>` extraction machinery.
/// A missing file (or a `total` of zero) returns an empty window. Never steps past `total`
/// lines, so an in-flight write's trailing fragment (excluded from `total` by
/// `session_log::count_lines`) is never returned as a raw line either.
fn read_raw_line_window(
    path: &std::path::Path,
    offset: usize,
    limit: usize,
    total: usize,
) -> Vec<RawLogLineDto> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);

    let mut out = Vec::new();
    for (line_number, line_result) in reader.lines().enumerate() {
        if line_number >= total {
            break;
        }
        if line_number < offset {
            continue;
        }
        if out.len() >= limit {
            break;
        }
        let Ok(text) = line_result else {
            break;
        };
        out.push(RawLogLineDto { line: line_number as i64, text });
    }
    out
}

const AGENT_RUNS_FOR_TASK_DEFAULT_LIMIT: i64 = 50;
const AGENT_RUNS_FOR_TASK_MAX_LIMIT: i64 = 50;

fn resolve_agent_runs_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(AGENT_RUNS_FOR_TASK_DEFAULT_LIMIT).clamp(1, AGENT_RUNS_FOR_TASK_MAX_LIMIT)
}

/// One row of a task's Runs section (02-UI-SPEC.md "Runs section") — mirrors
/// `flywheel_core::query::agent_runs::RunRow` field-for-field, plus `abandoned_reason` (plan
/// 03-10 Task 2, D-49/D-50), which has no column of its own: it is resolved per-row from the
/// on-disk kill record (`runtime_protocol::read_kill_record`), never from SQL. Status words,
/// relative times and durations are derived at read time in the renderer, never sent as
/// pre-rendered strings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummaryDto {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// D-30's session identity (plan 02-08 Task 2, a deviation from this DTO's original field
    /// list) — `NULL` until the sidecar's `init` event reports it. The Runs section renders it
    /// alongside the run's own id so a run and its session read as one linked record.
    pub external_session_id: Option<String>,
    /// `agent_runs.acknowledged_at` verbatim (plan 03-10 Task 2, D-49) — `NULL` until the
    /// abandoned-run row's Acknowledge button writes it. The renderer's Acknowledge button renders
    /// only while `status === "abandoned"` AND this is `null`.
    pub acknowledged_at: Option<String>,
    /// The abandoned-run explanation's own timestamp (plan 03-10 Task 2, D-50) — `Some(killed_at)`
    /// when a kill record exists for this run and parsed successfully, `None` when it is absent OR
    /// malformed (the two are never distinguished on the wire: both render the same honest,
    /// weaker fallback sentence rather than inventing a reason the data does not support).
    /// Populated ONLY for a run whose status is `abandoned` — always `None` otherwise.
    pub abandoned_reason: Option<String>,
}

impl From<flywheel_core::query::agent_runs::RunRow> for RunSummaryDto {
    fn from(run: flywheel_core::query::agent_runs::RunRow) -> Self {
        let abandoned_reason = if run.status == "abandoned" {
            match flywheel_core::runtime_protocol::read_kill_record(&run.id) {
                flywheel_core::runtime_protocol::KillRecordRead::Found(record) => Some(record.killed_at),
                flywheel_core::runtime_protocol::KillRecordRead::Absent
                | flywheel_core::runtime_protocol::KillRecordRead::Malformed(_) => None,
            }
        } else {
            None
        };
        Self {
            id: run.id,
            task_id: run.task_id,
            status: run.status,
            started_at: run.started_at,
            ended_at: run.ended_at,
            cost_usd: run.cost_usd,
            tokens_in: run.tokens_in,
            tokens_out: run.tokens_out,
            external_session_id: run.external_session_id,
            acknowledged_at: run.acknowledged_at,
            abandoned_reason,
        }
    }
}

/// `task_id`'s agent runs, newest first, bounded (plan 02-07 Task 1, 02-UI-SPEC.md "Runs
/// section") — the item detail panel's Runs section reads this. Read-only.
#[tauri::command]
pub fn agent_runs_for_task(
    state: State<AppState>,
    task_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<RunSummaryDto>, String> {
    let limit = resolve_agent_runs_limit(limit);
    let offset = offset.unwrap_or(0).max(0);

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::query::agent_runs::runs_for_task(&conn, &task_id, limit, offset)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(RunSummaryDto::from).collect())
}

/// Every session summary recorded for `task_id` (plan 04-09 Task 3) — the item detail panel's
/// own read, resolving CONTEXT.md's open question about where summaries render: under the run
/// row that produced them, not a separate top-level section. Delegates straight to
/// `flywheel_core::domain::session_summary::list_summaries_for_task`, reusing the same
/// `SessionSummaryDto` the launch sheet's preview already declares — no second DTO shape. A
/// read: locks the database, calls the domain read, maps, returns; no mutation and no emit,
/// mirroring `agent_runs_for_task`'s own shape immediately above.
#[tauri::command]
pub fn task_session_summaries(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<SessionSummaryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = flywheel_core::domain::session_summary::list_summaries_for_task(&conn, &task_id)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(SessionSummaryDto::from).collect())
}

/// The acknowledgment of a finished run (D-49 for `abandoned`, widened by D-165 / plan 10-04 to
/// `completed`, `failed` and `interrupted`). The statement lives in exactly one place,
/// `flywheel_core::domain::agent_run::acknowledge_run`, whose `WHERE` clause refuses a live run, so
/// this command cannot dismiss one however it is called. No actor is needed: the statement changes
/// one timestamp column and appends no event. Emits `board:changed` with
/// `{ entity: "agent_run", id: agent_run_id }` so `useAgentRuns` and the fleet re-read.
#[tauri::command]
pub fn agent_run_acknowledge(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::agent_run::acknowledge_run(&conn, &agent_run_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(())
}

/// The server-side cap on one "Dismiss finished" call (T-10-04-02), the same order as the fleet
/// window it clears.
const ACKNOWLEDGE_MANY_CAP: usize = 200;

/// One id's outcome in [`agent_run_acknowledge_many`]. `acknowledged` is false for an unknown id,
/// a live run or an already-acknowledged run -- all of them benign -- and `error` is set, with
/// `acknowledged` false, when the write itself failed (locked database, I/O), so a failed dismiss
/// is never mistaken for "nothing to do". The batch never aborts on one id.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcknowledgeResultDto {
    pub agent_run_id: String,
    pub acknowledged: bool,
    pub error: Option<String>,
}

/// Acknowledge each id through [`flywheel_core::domain::agent_run::acknowledge_run`]. A list longer
/// than [`ACKNOWLEDGE_MANY_CAP`] is refused as a whole, before anything is written, as the reclaim
/// batch is -- never silently truncated.
fn acknowledge_many(conn: &Connection, agent_run_ids: Vec<String>) -> Result<Vec<AcknowledgeResultDto>, String> {
    if agent_run_ids.len() > ACKNOWLEDGE_MANY_CAP {
        return Err(format!(
            "agent_run_acknowledge_many refused: {} runs named, at most {ACKNOWLEDGE_MANY_CAP} at a time",
            agent_run_ids.len()
        ));
    }
    Ok(agent_run_ids
        .into_iter()
        .map(|agent_run_id| {
            match flywheel_core::domain::agent_run::acknowledge_run(conn, &agent_run_id) {
                Ok(acknowledged) => AcknowledgeResultDto { agent_run_id, acknowledged, error: None },
                Err(e) => AcknowledgeResultDto { agent_run_id, acknowledged: false, error: Some(format!("{e:#}")) },
            }
        })
        .collect())
}

/// The fleet's "Dismiss finished" action: acknowledge each id through the same single statement as
/// [`agent_run_acknowledge`], at most [`ACKNOWLEDGE_MANY_CAP`] of them, one result per id. Ids only
/// from the renderer; one `board:changed` is emitted for the whole batch.
#[tauri::command]
pub fn agent_run_acknowledge_many(
    state: State<AppState>,
    app: AppHandle,
    agent_run_ids: Vec<String>,
) -> Result<Vec<AcknowledgeResultDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let results = acknowledge_many(&conn, agent_run_ids);
    drop(conn);

    // A batch can span projects, and no single project is honest here: broadcast.
    emit_board_changed(&app, None, "agent_run", None);

    results
}

/// A task's worktree summary line (02-UI-SPEC.md "Worktree summary") — mirrors
/// `flywheel_core::query::agent_runs::WorktreeSummary` field-for-field. Mirrors
/// `worktree_summary_for_task`'s own contract: `None`/`null` for a task with no worktree yet,
/// never a row of empty strings. `status` (plan 03-09, WORK-06/D-45) lets the renderer branch on
/// `"missing"` — the missing-worktree decision banner — without a second call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSummaryDto {
    pub branch: String,
    pub path: String,
    pub status: String,
}

impl From<flywheel_core::query::agent_runs::WorktreeSummary> for WorktreeSummaryDto {
    fn from(summary: flywheel_core::query::agent_runs::WorktreeSummary) -> Self {
        Self { branch: summary.branch, path: summary.path, status: summary.status }
    }
}

/// `task_id`'s worktree summary, or `null` if no worktree exists for the task yet (plan 02-07
/// Task 1, 02-UI-SPEC.md "Worktree summary"). Read-only.
#[tauri::command]
pub fn worktree_summary(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<WorktreeSummaryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let summary = flywheel_core::query::agent_runs::worktree_summary_for_task(&conn, &task_id)
        .map_err(|e| e.to_string())?;
    Ok(summary.map(WorktreeSummaryDto::from))
}

/// One `git status --porcelain` entry, projected for the renderer (WORK-03, D-42) — mirrors
/// `flywheel_core::domain::worktree::PorcelainEntry` field-for-field.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PorcelainEntryDto {
    pub code: String,
    pub path: String,
}

impl From<flywheel_core::domain::worktree::PorcelainEntry> for PorcelainEntryDto {
    fn from(entry: flywheel_core::domain::worktree::PorcelainEntry) -> Self {
        Self { code: entry.code, path: entry.path }
    }
}

/// The worktree-removal dialog's fresh-at-open-time read (WORK-03, D-41/D-42) — `null` when the
/// task has no `worktrees` row at all (mirrors `worktree_summary`'s own "absence, never a row of
/// empty strings" contract). `dirty_count` is `entries.len()`, denormalised here so the renderer
/// never has to recompute it and so it stays honest even against a future partial-parse path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemovalCheckDto {
    pub task_key: String,
    pub path: String,
    pub branch: String,
    pub entries: Vec<PorcelainEntryDto>,
    pub dirty_count: usize,
}

/// A fresh, never-cached `git status --porcelain` read for `task_id`'s worktree (WORK-03,
/// D-41/D-42) — the renderer calls this at dialog-open time, never from a cached query
/// (`useWorktreeRemovalCheck`'s own `staleTime: 0`/`gcTime: 0`). Read-only: this command never
/// removes anything and never mutates the database, so no actor resolution is needed here.
#[tauri::command]
pub fn worktree_remove_check(
    state: State<AppState>,
    task_id: String,
) -> Result<Option<WorktreeRemovalCheckDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let Some(summary) =
        flywheel_core::query::agent_runs::worktree_summary_for_task(&conn, &task_id)
            .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    // Drop the lock before the git spawn below — the porcelain read never needs the connection.
    drop(conn);

    let entries = flywheel_core::domain::worktree::porcelain_entries(std::path::Path::new(
        &summary.path,
    ))
    .map_err(|e| e.to_string())?;
    let dirty_count = entries.len();

    Ok(Some(WorktreeRemovalCheckDto {
        task_key: summary.task_key,
        path: summary.path,
        branch: summary.branch,
        entries: entries.into_iter().map(PorcelainEntryDto::from).collect(),
        dirty_count,
    }))
}

/// Remove `task_id`'s worktree (WORK-03, D-41/D-42/D-43). `actor_id` is resolved server-side
/// (T-01-04) — never accepted from the renderer. `remove_worktree_for_task` re-reads porcelain
/// itself before ever touching git — this command never trusts `worktree_remove_check`'s earlier
/// read as authorization to proceed (D-43's "no check-then-act window"). Emits `board:changed`
/// with `{ entity: "worktree", id: task_id }` after a successful removal, the same shape every
/// other state-changing command in this file uses (D-04).
#[tauri::command]
pub fn worktree_remove(
    state: State<AppState>,
    app: AppHandle,
    task_id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::worktree::remove_worktree_for_task(&mut conn, &task_id, &actor_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "tasks", &task_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "worktree", Some(&task_id));

    Ok(())
}

/// D-45's "Recreate Worktree" decision (plan 03-09, WORK-06) — re-runs worktree creation against
/// the SAME recorded branch/base a `missing` row already carries; never resolves a new base ref
/// and mints no new branch. `actor_id` is resolved server-side (T-01-04) — never accepted from
/// the renderer. Delegates straight to `recreate_worktree_for_task`, which itself refuses on any
/// non-`missing` row (naming the actual status in the error) — this command carries no
/// force/override parameter beyond `task_id`, so there is no second guard here and no way around
/// the first. `recreate_worktree_for_task` shells out to git; the connection lock is dropped
/// before that call so a slow git operation never holds `state.db` (mirrors `agent_run_start`'s
/// own resolve-before-lock discipline for `send_spawn_request`, see the comment above it). Emits
/// `board:changed` with `{ entity: "worktree", id: task_id }` on success — `useWorktreeSummary`'s
/// existing invalidation is what makes the banner disappear once the row reads `active` again.
#[tauri::command]
pub fn worktree_recreate(state: State<AppState>, app: AppHandle, task_id: String) -> Result<(), String> {
    let actor_id = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?
    };

    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        flywheel_core::domain::worktree::recreate_worktree_for_task(&mut conn, &task_id, &actor_id)
            .map_err(|e| e.to_string())?;
    }

    let project_id = project_of_locked(&state.db, "tasks", &task_id);
    emit_board_changed(&app, project_id.as_deref(), "worktree", Some(&task_id));

    Ok(())
}

/// D-45's "Remove Record" decision (plan 03-09, WORK-06) — drops the `worktrees` row only; there
/// is nothing on disk to touch, since the row being `missing` is exactly what means nothing is
/// there. `actor_id` is resolved server-side (T-01-04) — never accepted from the renderer.
/// Delegates straight to `forget_worktree_record`, which itself refuses on any non-`missing` row
/// and makes no filesystem call of any kind — the only removal path for a REAL, on-disk worktree
/// remains plan 03-01's porcelain-checked `worktree_remove`. This command carries no
/// force/override parameter beyond `task_id`, so there is no second guard here and no way around
/// the first. Emits `board:changed` with `{ entity: "worktree", id: task_id }` on success.
#[tauri::command]
pub fn worktree_forget_record(state: State<AppState>, app: AppHandle, task_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::worktree::forget_worktree_record(&mut conn, &task_id, &actor_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "tasks", &task_id);
    drop(conn);

    emit_board_changed(&app, project_id.as_deref(), "worktree", Some(&task_id));

    Ok(())
}

/// One genuinely-alive orphaned run the launch reconciler found (plan 03-06, PROC-05, D-46) —
/// mirrors `flywheel_core::domain::agent_run::LiveOrphan` field-for-field in camelCase, carrying
/// nothing `03-UI-SPEC.md`'s orphan-recovery modal does not render: no cost, no token counts
/// (those are AGNT-08, Phase 10) and no live stream handle — the process here is being killed,
/// not observed.
///
/// Exactly one of the task-* fields or the epic-* fields is populated (plan 05-09's CR-01 fix,
/// D-84) — a task-execution run carries the former, an epic-authoring run carries the latter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOrphanDto {
    pub run_id: String,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_title: Option<String>,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    pub project_id: String,
    pub external_session_id: Option<String>,
    pub pid: i32,
    pub started_at: String,
}

impl From<flywheel_core::domain::agent_run::LiveOrphan> for PendingOrphanDto {
    fn from(orphan: flywheel_core::domain::agent_run::LiveOrphan) -> Self {
        Self {
            run_id: orphan.run_id,
            task_id: orphan.task_id,
            task_key: orphan.task_key,
            task_title: orphan.task_title,
            epic_id: orphan.epic_id,
            epic_key: orphan.epic_key,
            epic_title: orphan.epic_title,
            project_id: orphan.project_id,
            external_session_id: orphan.external_session_id,
            pid: orphan.pid,
            started_at: orphan.started_at,
        }
    }
}

/// The launch-time live-orphan list (plan 03-06) — read-only, cloned out of
/// `AppState.pending_orphans`, which `main.rs`'s `.setup()` populates exactly once from
/// `reconcile_agent_runs`'s own return value. After every row has been resolved via
/// [`orphan_kill`] this returns an empty list.
#[tauri::command]
pub fn agent_runs_pending_orphans(state: State<AppState>) -> Result<Vec<PendingOrphanDto>, String> {
    let orphans = state.pending_orphans.lock().map_err(|e| e.to_string())?;
    Ok(orphans.iter().cloned().map(PendingOrphanDto::from).collect())
}

/// What [`orphan_kill`] returns (plan 03-06, T-03-06-04) — mirrors
/// `flywheel_core::domain::agent_run::OrphanKillOutcome` field-for-field in camelCase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanKillDto {
    pub killed: bool,
    pub pid: i32,
    pub detail: Option<String>,
}

/// Remove `agent_run_id` from `pending` ONLY when `killed` is true (plan 03-06, T-03-06-04) — a
/// failed kill leaves the row mounted so the recovery modal keeps showing it, rather than
/// dismissing a row this call never actually resolved. Factored out of [`orphan_kill`] so this
/// decision is unit-testable against a bare `Vec`, mirroring
/// `process_inbound_permission_request`'s own split from its Tauri-facing caller.
fn retain_pending_orphan_unless_killed(
    pending: &mut Vec<flywheel_core::domain::agent_run::LiveOrphan>,
    agent_run_id: &str,
    killed: bool,
) {
    if killed {
        pending.retain(|orphan| orphan.run_id != agent_run_id);
    }
}

/// Kill one live orphan (plan 03-06, D-30, D-48) — the only verb the orphan-recovery modal offers.
/// `agent_run_id` is the ONLY input; the pid actually signalled is read from the descriptor this
/// application itself wrote at spawn time, never supplied by the renderer (T-03-06-03). Rejects
/// with a not-found error when `agent_run_id` no longer names an entry in `pending_orphans` —
/// checked BEFORE the domain call runs, so a second kill for a run already resolved (by an
/// earlier kill, or by never having been a real live orphan at all) reports that honestly rather
/// than performing a redundant signal and claiming a success it did not observe.
///
/// `actor_id` is resolved server-side (T-01-04). Unlike `agent_run_stop`'s CR-01 sidecar wait
/// (up to 30s), `kill_orphan`'s own post-signal wait is bounded at ~200ms
/// (`domain::agent_run::ORPHAN_KILL_RECHECK_DELAY`) — short enough that holding `state.db` across
/// it, for this one call, does not risk starving every other board command the way a wedged
/// sidecar would; the CR-01 discipline of resolving an external wait before locking the database
/// is honoured in spirit (a bounded, short wait) rather than by an unneeded split of the already
/// tested domain function.
///
/// Emits `board:changed` with `{ entity: "agent_run", id: agent_run_id }` in BOTH outcomes — the
/// run reaches `abandoned` in the database either way (`kill_orphan`'s own CR-04 shape), and the
/// board must reflect that even when the process itself survived the signal.
#[tauri::command]
pub fn orphan_kill(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<OrphanKillDto, String> {
    {
        let pending = state.pending_orphans.lock().map_err(|e| e.to_string())?;
        if !pending.iter().any(|orphan| orphan.run_id == agent_run_id) {
            return Err(format!("no pending orphan found for agent_run_id {agent_run_id:?}"));
        }
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id =
        flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let outcome = flywheel_core::domain::agent_run::kill_orphan(&mut conn, &agent_run_id, &actor_id)
        .map_err(|e| e.to_string())?;
    let project_id = project_of(&conn, "agent_runs", &agent_run_id);
    drop(conn);

    {
        let mut pending = state.pending_orphans.lock().map_err(|e| e.to_string())?;
        // Removed only on a genuine success (see retain_pending_orphan_unless_killed's own doc).
        retain_pending_orphan_unless_killed(&mut pending, &agent_run_id, outcome.killed);
    }

    emit_board_changed(&app, project_id.as_deref(), "agent_run", Some(&agent_run_id));

    Ok(OrphanKillDto { killed: outcome.killed, pid: outcome.pid, detail: outcome.detail })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_live_orphan(run_id: &str) -> flywheel_core::domain::agent_run::LiveOrphan {
        flywheel_core::domain::agent_run::LiveOrphan {
            run_id: run_id.to_string(),
            task_id: Some("task-1".to_string()),
            task_key: Some("FLY-1".to_string()),
            task_title: Some("Sample task".to_string()),
            epic_id: None,
            epic_key: None,
            epic_title: None,
            project_id: "project-1".to_string(),
            external_session_id: None,
            pid: 4242,
            started_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn retain_pending_orphan_unless_killed_leaves_the_row_mounted_on_a_failed_kill() {
        let mut pending = vec![sample_live_orphan("run-a"), sample_live_orphan("run-b")];
        retain_pending_orphan_unless_killed(&mut pending, "run-a", false);
        assert_eq!(pending.len(), 2, "a failed kill must never dismiss the row");
    }

    #[test]
    fn retain_pending_orphan_unless_killed_removes_only_the_matching_row_on_success() {
        let mut pending = vec![sample_live_orphan("run-a"), sample_live_orphan("run-b")];
        retain_pending_orphan_unless_killed(&mut pending, "run-a", true);
        assert_eq!(pending.len(), 1);
        assert!(pending.iter().all(|orphan| orphan.run_id != "run-a"));
        assert!(pending.iter().any(|orphan| orphan.run_id == "run-b"));
    }

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
    fn read_raw_line_window_returns_at_most_the_requested_limit_and_never_past_total() {
        let dir = tempfile::tempdir().expect("failed to create scratch dir");
        let path = dir.path().join("run.jsonl");
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&path).expect("failed to create fixture log file");
            for i in 0..250 {
                writeln!(file, "{{\"seq\":{i}}}").expect("failed to write fixture line");
            }
        }

        let window = read_raw_line_window(&path, 0, LOG_WINDOW_MAX_LIMIT as usize, 250);
        assert_eq!(window.len(), LOG_WINDOW_MAX_LIMIT as usize);
        assert_eq!(window[0].line, 0);
        assert_eq!(window[0].text, "{\"seq\":0}");
    }

    #[test]
    fn read_raw_line_window_on_a_missing_file_returns_an_empty_window() {
        let window =
            read_raw_line_window(std::path::Path::new("/nonexistent/path/to/a/log.jsonl"), 0, 50, 0);
        assert!(window.is_empty());
    }

    /// The shape guard lives in `session_log_path` (`packages/core/src/session_log.rs`), but this
    /// command is one of the two IPC boundaries a renderer can actually reach (plan 03-15,
    /// T-03-15-01) — this test proves the guard is inherited here, not that it is re-implemented.
    #[test]
    fn agent_run_log_window_rejects_a_run_id_that_is_not_ulid_shaped() {
        let result = agent_run_log_window("../../../etc/passwd".to_string(), None, None);
        assert!(result.is_err(), "a traversal-shaped agent_run_id must be rejected");
    }

    #[test]
    fn agent_run_raw_window_rejects_a_run_id_that_is_not_ulid_shaped() {
        let result = agent_run_raw_window("../../../etc/passwd".to_string(), None, None);
        assert!(result.is_err(), "a traversal-shaped agent_run_id must be rejected");
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

    // --- Phase 10 plan 10-07: which transitions earn a notification (D-174) -------------------

    #[test]
    fn a_running_run_that_gets_a_pending_request_notifies_once_with_the_tool_name_only() {
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let t = permission_transition(&conn, &run_id, Some("running"), "Bash").expect("a transition");
        assert_eq!(t.kind, crate::notify::TransitionKind::Blocked);
        assert_eq!(t.run_id, run_id);
        assert_eq!(t.project_name, "Test Project");
        assert_eq!(t.tool, Some("Bash".to_string()));
    }

    // --- WR-09: the batch acknowledge never hides truncation or a failed write ------------------

    #[test]
    fn acknowledge_many_refuses_an_over_cap_list_as_a_whole_and_writes_nothing() {
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        conn.execute("UPDATE agent_runs SET status = 'completed', ended_at = started_at WHERE id = ?1", [&run_id])
            .unwrap();
        let mut ids = vec![run_id.clone()];
        ids.extend((0..ACKNOWLEDGE_MANY_CAP).map(|n| format!("no-such-run-{n}")));
        assert!(ids.len() > ACKNOWLEDGE_MANY_CAP);

        let err = acknowledge_many(&conn, ids).expect_err("an oversize list is refused");

        assert!(err.contains("refused"), "{err}");
        let ack: Option<String> =
            conn.query_row("SELECT acknowledged_at FROM agent_runs WHERE id = ?1", [&run_id], |r| r.get(0)).unwrap();
        assert_eq!(ack, None, "nothing may be written when the list is refused");
    }

    #[test]
    fn acknowledge_many_tells_an_unknown_id_from_a_write_error_and_acknowledges_the_rest() {
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        conn.execute("UPDATE agent_runs SET status = 'completed', ended_at = started_at WHERE id = ?1", [&run_id])
            .unwrap();

        let results = acknowledge_many(&conn, vec![run_id.clone(), "no-such-run".to_string()]).unwrap();
        assert!(results[0].acknowledged && results[0].error.is_none());
        assert!(!results[1].acknowledged && results[1].error.is_none(), "unknown is benign, not an error");

        // A real write failure: the table the statement targets is gone.
        conn.execute_batch("DROP INDEX IF EXISTS idx_agent_runs_fleet; ALTER TABLE agent_runs RENAME TO agent_runs_gone;")
            .unwrap();
        let results = acknowledge_many(&conn, vec![run_id]).unwrap();
        assert!(!results[0].acknowledged);
        assert!(results[0].error.is_some(), "a failed write must carry its error");
    }

    #[test]
    fn a_run_already_blocked_that_gets_a_second_request_notifies_nothing() {
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        assert!(permission_transition(&conn, &run_id, Some("blocked"), "Bash").is_none());
        assert!(permission_transition(&conn, &run_id, None, "Bash").is_none());
    }

    #[test]
    fn a_pending_request_with_no_target_still_notifies_and_reads_as_text() {
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let t = permission_transition(&conn, &run_id, Some("running"), "WebSearch")
            .expect("a transition");
        let mut co = crate::notify::Coalescer::new(crate::notify::COALESCE_WINDOW);
        let t0 = std::time::Instant::now();
        co.push(t, t0);
        let banner = co.take_due(t0 + crate::notify::COALESCE_WINDOW, |_| true).expect("a banner");
        let (title, body) = banner.text();
        assert!(!title.is_empty());
        assert_eq!(body, "WebSearch");
    }

    #[test]
    fn only_completed_and_failed_closes_notify() {
        use flywheel_core::domain::agent_run::{AgentRunStatus, SessionClosedOutcome};
        let (conn, run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        let kind = |o: SessionClosedOutcome| closed_transition(&conn, &run_id, &o).map(|t| t.kind);
        assert_eq!(
            kind(SessionClosedOutcome::Closed(AgentRunStatus::Completed)),
            Some(crate::notify::TransitionKind::Completed)
        );
        assert_eq!(
            kind(SessionClosedOutcome::Closed(AgentRunStatus::Failed)),
            Some(crate::notify::TransitionKind::Failed)
        );
        assert_eq!(kind(SessionClosedOutcome::Closed(AgentRunStatus::Interrupted)), None);
        assert_eq!(kind(SessionClosedOutcome::Closed(AgentRunStatus::Abandoned)), None);
        assert_eq!(kind(SessionClosedOutcome::AlreadyTerminal), None);
        assert_eq!(kind(SessionClosedOutcome::BackfilledTerminal), None);
        assert_eq!(kind(SessionClosedOutcome::UnknownRun), None);
        assert_eq!(kind(SessionClosedOutcome::Ignored), None);
    }

    #[test]
    fn a_missing_project_or_task_row_degrades_to_generic_words_and_never_panics() {
        let (conn, _run_id, _task_id, _project_id) = seeded_conn_with_running_agent_run();
        assert_eq!(notify_context(&conn, "no-such-run"), ("Flywheel".to_string(), "An agent".to_string()));
        let t = permission_transition(&conn, "no-such-run", Some("running"), "Bash")
            .expect("still a transition");
        assert_eq!(t.subject_label, "An agent");
    }

    #[test]
    fn a_matching_allow_rule_auto_resolves_with_no_pending_row_and_the_run_stays_running() {
        let (mut conn, run_id, _task_id, project_id) = seeded_conn_with_running_agent_run();
        let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        flywheel_core::domain::permission_rule::upsert_rule(&mut conn, &project_id, "Bash", "allow", &actor_id)
            .expect("upsert_rule should succeed");

        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None, None)
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

        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None, None)
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
        let outcome = process_inbound_permission_request(&mut conn, "not-a-real-run-id", "Bash", None, None)
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
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None, None)
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
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None, None)
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
        let outcome = process_inbound_permission_request(&mut conn, &run_id, "Bash", None, None)
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

    /// A fresh migrated database with one project, one task, one trigger, one worktree row and
    /// one `running` `agent_runs` row — inserted directly via literal SQL (not
    /// `domain::agent_run::start_agent_run`, which shells out to real git against the helper's
    /// placeholder project path, mirroring this file's own `seeded_conn_with_running_agent_run`
    /// precedent). `stop_agent_run_recording_first` takes a bare `&mut Connection` and a
    /// closure, so no real worktree on disk and no Tauri `AppHandle` are needed for these tests.
    fn seeded_conn_with_running_run() -> (Connection, String, String) {
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
        let worktree_id = flywheel_core::ids::new_id();
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
            "INSERT INTO worktrees (
                id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
            ) VALUES (
                ?1, ?2, ?3, '/tmp/does-not-need-to-exist-for-this-test', 'flywheel/test-task',
                'main', 'active', ?4, ?5
            )",
            rusqlite::params![worktree_id, task_id, project_id, human_actor_id, now],
        )
        .expect("failed to insert fixture worktree row");

        conn.execute(
            "INSERT INTO agent_runs (
                id, worktree_id, task_id, project_id, trigger_id, actor_id, status,
                permission_mode, log_path, started_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, 'running', 'acceptEdits',
                '/tmp/does-not-need-to-exist-for-this-test.jsonl', ?7
            )",
            rusqlite::params![run_id, worktree_id, task_id, project_id, trigger_id, agent_actor_id, now],
        )
        .expect("failed to insert fixture agent_runs row");

        (conn, task_id, run_id)
    }

    /// D-64/CTX-01, gap #1 of 04-VERIFICATION.md: opening a transaction, running
    /// `stop_agent_run_in_tx` inside it, and dropping the transaction WITHOUT committing must
    /// leave the run exactly as it was before — `running`, no `ended_at`, no `exit_summary_id`,
    /// zero `session_summaries` rows and zero `agent_run.interrupted` events for it. The pre-fix
    /// shape could not satisfy this at all: its terminal write committed on its own connection-
    /// level transaction, so there was no encompassing transaction a caller could roll back to
    /// undo it (RED evidence, captured empirically before this rewrite landed: calling the old
    /// `stop_agent_run_recording_first` and then attempting the equivalent of a rollback left the
    /// run already committed as `status = "interrupted"`, `ended_at = Some(...)` — both writes
    /// were already durable by the time the function returned).
    #[test]
    fn a_rolled_back_stop_leaves_the_run_running_with_no_summary_and_no_terminal_event() {
        let (mut conn, _task_id, run_id) = seeded_conn_with_running_run();
        let human_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");

        let tx = conn.transaction().expect("opening a transaction should succeed");
        let status = stop_agent_run_in_tx(&tx, &run_id, &human_actor_id)
            .expect("stop_agent_run_in_tx should succeed inside an open transaction");
        assert_eq!(status, "interrupted", "the in-tx write must still report the terminal status it wrote");

        // Roll back instead of committing — simulates a crash between the write and the commit.
        drop(tx);

        let status_after_rollback: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert_eq!(
            status_after_rollback, "running",
            "a rolled-back termination unit must leave the run exactly as it was: status running"
        );

        let ended_at: Option<String> = conn
            .query_row("SELECT ended_at FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert!(ended_at.is_none(), "a rolled-back termination unit must leave ended_at NULL");

        let exit_summary_id: Option<String> = conn
            .query_row(
                "SELECT exit_summary_id FROM agent_runs WHERE id = ?1",
                rusqlite::params![run_id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert!(exit_summary_id.is_none(), "a rolled-back termination unit must leave exit_summary_id NULL");

        let summary_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                rusqlite::params![run_id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(summary_count, 0, "a rolled-back termination unit must leave zero session_summaries rows");

        let terminal_event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.interrupted' AND stream_id = ?1",
                rusqlite::params![run_id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            terminal_event_count, 0,
            "a rolled-back termination unit must leave zero agent_run.interrupted events"
        );
    }

    /// CR-04's failure mode as a red-if-regressed test: a stop whose sidecar closure returns
    /// `Err` must still reach a terminal status, and the returned DTO must carry the warning the
    /// user actually sees (plan 02-11 Task 3 renders `sidecar_warning` in the session surface).
    #[test]
    fn stop_records_interrupted_even_when_the_sidecar_never_acks() {
        let (mut conn, _task_id, run_id) = seeded_conn_with_running_run();

        let dto = stop_agent_run_recording_first(&mut conn, &run_id, || {
            Err("sidecar did not acknowledge the interrupt request within 30s".to_string())
        })
        .expect("stop_agent_run_recording_first should succeed even when the interrupt closure fails");

        assert_eq!(dto.status, "interrupted");
        assert_eq!(dto.agent_run_id, run_id);
        let warning = dto.sidecar_warning.expect("a failed interrupt must produce a sidecar_warning");
        assert!(
            warning.contains("could not confirm the agent process stopped"),
            "the warning must bind to the user-facing promise, not an incidental format, got: {warning}"
        );

        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert_eq!(status, "interrupted", "the run must reach a terminal status regardless of the sidecar outcome");

        let ended_at: Option<String> = conn
            .query_row("SELECT ended_at FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert!(ended_at.is_some(), "ended_at must be set after an interrupt");
    }

    /// A second stop against the same dead sidecar must be safe (D-35 idempotence): no second
    /// `agent_run.interrupted` event, and the recorded status is never overwritten.
    #[test]
    fn stop_twice_with_a_dead_sidecar_appends_exactly_one_interrupted_event() {
        let (mut conn, _task_id, run_id) = seeded_conn_with_running_run();

        let failing_interrupt =
            || Err("sidecar did not acknowledge the interrupt request within 30s".to_string());

        stop_agent_run_recording_first(&mut conn, &run_id, failing_interrupt)
            .expect("first stop should succeed even when the interrupt closure fails");
        stop_agent_run_recording_first(&mut conn, &run_id, failing_interrupt)
            .expect("second stop on an already-terminal run should be a harmless idempotent no-op");

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.interrupted' AND stream_id = ?1",
                rusqlite::params![run_id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(event_count, 1, "a second stop must append no second agent_run.interrupted event");

        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", rusqlite::params![run_id], |row| {
                row.get(0)
            })
            .expect("agent_runs row should exist");
        assert_eq!(status, "interrupted", "the status must remain interrupted, not overwritten");
    }

    /// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — verbatim in shape
    /// to `packages/core/tests/discard_lifecycle.rs`'s and `stop_lifecycle.rs`'s own identical
    /// guard: `FLYWHEEL_WORKTREE_ROOT` is process-global mutable state, and two tests racing here
    /// could let one test's worktree creation fall through to the real default
    /// (`~/Flywheel/...`) between the other test's `set_var`/`remove_var` pair.
    static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
        let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
        // Plan 09-01: starting a run now writes its scope marker under `runtime_dir()`, so every
        // test that reaches `start_agent_run_recording_first` also needs a scratch runtime dir —
        // otherwise the marker lands in the developer's real `<app-data>/runtime/`.
        let runtime_dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
        // SAFETY: the mutex above serializes every caller in this binary, so no other thread
        // reads or mutates these vars while they're set, and this helper always clears them
        // before returning.
        unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
        unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime_dir.path()) };
        let result = f();
        unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
        unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
        result
    }

    /// A fresh migrated database, one project pointing at a REAL git repository (one commit on
    /// `main`), and one task under it — the desktop-crate mirror of
    /// `packages/core/tests/common/mod.rs`'s `seeded_git_project`, needed here because
    /// `start_agent_run_recording_first` calls straight through to `start_agent_run`, which
    /// creates a real worktree (`ensure_worktree`) and therefore needs a real repository to clone
    /// from — a placeholder path (as `seeded_conn_with_task` uses) is not enough once a run
    /// actually starts. Returns the connection, the human actor id, the project id, the task id,
    /// and the repository's own `TempDir` (kept alive by the caller for the test's duration).
    fn seeded_git_conn_with_task() -> (Connection, String, String, String, tempfile::TempDir) {
        let repo_dir = tempfile::tempdir().expect("failed to create scratch repo dir");
        let repo_path = repo_dir.path();

        // `flywheel_core::git::git_at` — never a bare `Command::new("git")` here — so this test
        // helper stays inside `packages/core/tests/supervisor_cwd.rs`'s own PROC-02 gate, which
        // requires every `Command::new("git")` construction in the workspace to live in
        // `packages/core/src/git.rs`.
        let run = |args: &[&str]| {
            flywheel_core::git::git_at(repo_path, args)
                .unwrap_or_else(|e| panic!("git {args:?} failed: {e}"));
        };

        run(&["init", "--initial-branch=main"]);
        run(&["config", "user.email", "fixture@flywheel.test"]);
        run(&["config", "user.name", "Fixture"]);
        std::fs::write(repo_path.join("README.md"), "fixture repo\n")
            .expect("failed to write README");
        run(&["add", "README.md"]);
        run(&["commit", "-m", "initial commit"]);

        let dir = tempfile::tempdir().expect("failed to create scratch db dir");
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
            &repo_path.to_string_lossy(),
            "FLY",
            "main",
        )
        .expect("create_project should succeed");
        let task = flywheel_core::domain::task::create_task(
            &mut conn,
            &project.id,
            &actor_id,
            "Test task",
            None,
        )
        .expect("create_task should succeed");

        (conn, actor_id, project.id, task.id, repo_dir)
    }

    // ---- A-08(a): a reviewer's decline reaches the agent and the preview identically ----------

    // --- phase 09 plan 09-01: the run-start path arms the scope (D-150/D-151) ---------------------
    //
    // The two-sided contract's desktop half: these drive the REAL `start_agent_run_recording_first`
    // and then run the SHIPPED compiled hook against the marker it wrote — neither half writes the
    // other's state. (`packages/core/tests/scope_marker_contract.rs` owns the core half and a
    // source-structural gate over this function.)

    /// Run the shipped compiled `scope-hook.js` against `target`, with identity from the
    /// environment only. Returns `(exit_code, stdout)`.
    fn run_shipped_scope_hook(run_id: &str, target: &std::path::Path) -> (Option<i32>, String) {
        use std::io::Write as _;
        use std::process::{Command, Stdio};

        let workspace_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("src-tauri sits at <workspace>/packages/desktop/src-tauri")
            .to_path_buf();
        let hook = workspace_root.join("packages/sidecar/dist/scope-hook.js");
        assert!(
            hook.is_file(),
            "expected the built scope hook at {hook:?} — run `npm --prefix packages/sidecar run build` first"
        );
        let shim = flywheel_core::shim::resolve_shim_binary()
            .expect("the compiled flywheel-shim is required — run `cargo build --workspace` first");
        let runtime = flywheel_core::runtime_protocol::runtime_dir().expect("runtime dir");
        let payload = serde_json::json!({
            "tool_name": "Write",
            "tool_input": { "file_path": target, "content": "x" },
        })
        .to_string();

        let mut child = Command::new("node")
            .arg(&hook)
            .env("FLYWHEEL_RUN_ID", run_id)
            .env("FLYWHEEL_RUNTIME_DIR", runtime)
            .env("FLYWHEEL_SHIM_BIN", shim)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn node for the shipped scope hook");
        child.stdin.as_mut().unwrap().write_all(payload.as_bytes()).unwrap();
        drop(child.stdin.take());
        let out = child.wait_with_output().unwrap();
        (out.status.code(), String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// Declare (or, with an empty list, clear) a task's file-set through the core's own writer, so
    /// these tests start from a set the app itself could have stored.
    fn declare_set(conn: &mut Connection, actor: &str, task_id: &str, raw: &[&str]) {
        let entries: Vec<_> = raw
            .iter()
            .map(|r| flywheel_core::file_set::parse_entry(r).expect("fixture entries parse"))
            .collect();
        flywheel_core::domain::file_set::declare_file_set(conn, task_id, &entries, actor)
            .expect("declare_file_set should accept the fixture entries");
    }

    #[test]
    fn the_real_run_start_writes_an_armed_marker_and_the_shipped_hook_enforces_it() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _project_id, task_id, _repo) = seeded_git_conn_with_task();
            declare_set(&mut conn, &actor, &task_id, &["src/allowed/"]);

            let outcome = start_agent_run_recording_first(&mut conn, &task_id, "acceptEdits", "", &actor, false)
                .expect("a task with a declared set starts");

            let marker = flywheel_core::runtime_protocol::read_scope_marker(&outcome.run_id)
                .expect("the run start must have written the scope marker");
            assert_eq!(marker.mode, flywheel_core::runtime_protocol::ScopeMode::Armed);
            assert!(outcome.scope_armed, "the sidecar is told the run is armed, so it can fail closed");
            assert_eq!(marker.entries.len(), 1);
            assert_eq!(marker.entries[0].path, "src/allowed/");

            let worktree = std::path::Path::new(&outcome.worktree_path);
            let (code, out) = run_shipped_scope_hook(&outcome.run_id, &worktree.join("src/allowed/new.rs"));
            assert_eq!((code, out.trim()), (Some(0), "{}"), "inside the declared set");

            let (code, out) = run_shipped_scope_hook(&outcome.run_id, &worktree.join("README.md"));
            assert_eq!(code, Some(2), "outside the declared set: {out}");
            assert!(out.contains("FLYWHEEL-SCOPE:") && out.contains("README.md"), "{out}");
        });
    }

    #[test]
    fn the_real_run_start_for_a_task_with_no_declared_set_writes_an_unarmed_marker() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _project_id, task_id, _repo) = seeded_git_conn_with_task();

            let outcome = start_agent_run_recording_first(&mut conn, &task_id, "acceptEdits", "", &actor, false)
                .expect("a task with no declared set starts exactly as before this phase");

            let marker = flywheel_core::runtime_protocol::read_scope_marker(&outcome.run_id)
                .expect("an unarmed marker is still written — a fact, never an absence");
            assert_eq!(marker.mode, flywheel_core::runtime_protocol::ScopeMode::Unarmed);
            assert!(!outcome.scope_armed, "an undeclared task is never refused for lack of a gate (D-150)");
            assert!(marker.entries.is_empty());

            let worktree = std::path::Path::new(&outcome.worktree_path);
            let (code, out) = run_shipped_scope_hook(&outcome.run_id, &worktree.join("anything/at/all.rs"));
            assert_eq!((code, out.trim()), (Some(0), "{}"), "an unarmed run is not enforced");
        });
    }

    #[test]
    fn clearing_the_declared_set_makes_the_next_real_run_start_unarmed() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _project_id, task_id, _repo) = seeded_git_conn_with_task();
            declare_set(&mut conn, &actor, &task_id, &["a/"]);
            let first = start_agent_run_recording_first(&mut conn, &task_id, "acceptEdits", "", &actor, false).unwrap();
            assert_eq!(
                flywheel_core::runtime_protocol::read_scope_marker(&first.run_id).unwrap().mode,
                flywheel_core::runtime_protocol::ScopeMode::Armed
            );

            // The first run must end before its task's set can be replaced: a declare against a live
            // task is refused (09-11), because only the widen re-checks against in-flight sets.
            flywheel_core::domain::agent_run::close_agent_run(
                &mut conn,
                &first.run_id,
                flywheel_core::domain::agent_run::AgentRunStatus::Completed,
                None,
                None,
                None,
            )
            .unwrap();
            declare_set(&mut conn, &actor, &task_id, &[]);
            let second = start_agent_run_recording_first(&mut conn, &task_id, "acceptEdits", "", &actor, false).unwrap();
            assert_eq!(
                flywheel_core::runtime_protocol::read_scope_marker(&second.run_id).unwrap().mode,
                flywheel_core::runtime_protocol::ScopeMode::Unarmed
            );
        });
    }

    #[test]
    fn a_scope_marker_write_failure_aborts_the_start_and_leaves_no_running_run() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _project_id, task_id, _repo) = seeded_git_conn_with_task();
            declare_set(&mut conn, &actor, &task_id, &["a/"]);

            // Make the runtime directory unusable: point it BENEATH a regular file, so creating
            // `<runtime>/scope/` fails. (`with_scratch_worktree_root` restores/clears the var.)
            let blocker = tempfile::NamedTempFile::new().unwrap();
            let unusable = blocker.path().join("runtime");
            // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK`, held by the enclosing helper.
            unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", &unusable) };

            let err = match start_agent_run_recording_first(&mut conn, &task_id, "acceptEdits", "", &actor, false) {
                Ok(_) => panic!("a run that cannot record its scope must not start"),
                Err(e) => e,
            };
            assert!(err.contains("scope marker"), "{err}");

            let running: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1 AND status IN ('running', 'blocked')",
                    rusqlite::params![task_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(running, 0, "the aborted start must not leave a running run behind");
        });
    }

    // --- phase 09 plan 09-13: the shared launch body consults the one launch-conflict rule ---------

    fn add_task(conn: &mut Connection, actor: &str, project_id: &str, title: &str) -> (String, String) {
        let t = flywheel_core::domain::task::create_task(conn, project_id, actor, title, None)
            .expect("create_task should succeed");
        (t.id, t.key)
    }

    /// `(agent_runs rows for the task, all events rows)` — a refusal must change neither.
    fn launch_footprint(conn: &Connection, task_id: &str) -> (i64, i64) {
        let runs = conn
            .query_row("SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", rusqlite::params![task_id], |r| r.get(0))
            .unwrap();
        let events = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        (runs, events)
    }

    fn overlap_events(conn: &Connection, task_id: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT payload FROM events WHERE event_type = ?1 AND task_id = ?2")
            .unwrap();
        stmt.query_map(rusqlite::params![EVENT_LAUNCH_OVERLAP, task_id], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn launch(
        conn: &mut Connection,
        task_id: &str,
        conflict: CrossTaskConflict,
    ) -> Result<PreparedLaunch, String> {
        prepare_launch(conn, task_id, "acceptEdits", "", conflict, false)
    }

    /// A project with two tasks: `task` (declared `src/a/` unless `task_set` says otherwise) and an
    /// `other` task that is LIVE (its set is `other_set`; empty means undeclared).
    struct TwoTasks {
        conn: Connection,
        task: String,
        other: String,
        other_key: String,
        _repo: tempfile::TempDir,
    }

    fn two_tasks(task_set: &[&str], other_set: &[&str]) -> TwoTasks {
        let (mut conn, actor, project_id, task, repo) = seeded_git_conn_with_task();
        let (other, other_key) = add_task(&mut conn, &actor, &project_id, "Other task");
        declare_set(&mut conn, &actor, &task, task_set);
        declare_set(&mut conn, &actor, &other, other_set);
        start_agent_run_recording_first(&mut conn, &other, "acceptEdits", "", &actor, false)
            .expect("the other task goes live");
        TwoTasks { conn, task, other, other_key, _repo: repo }
    }

    #[test]
    fn a_dispatched_launch_colliding_with_a_live_task_is_refused_and_creates_nothing() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &["src/a/"]);
            let before = launch_footprint(&f.conn, &f.task);
            let err = match launch(&mut f.conn, &f.task, CrossTaskConflict::Refuse) {
                Ok(_) => panic!("a colliding dispatched launch must be refused"),
                Err(e) => e,
            };
            assert!(err.contains(&f.other_key) && err.contains("src/a/"), "names the task and the path: {err}");
            assert_eq!(launch_footprint(&f.conn, &f.task), before, "a refusal creates no run row and appends no event");
        });
    }

    #[test]
    fn a_dispatched_launch_beside_an_undeclared_live_task_is_refused_as_runs_alone() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &[]);
            let before = launch_footprint(&f.conn, &f.task);
            let err = match launch(&mut f.conn, &f.task, CrossTaskConflict::Refuse) {
                Ok(_) => panic!("D-150: an undeclared live task blocks a dispatched launch"),
                Err(e) => e,
            };
            assert!(err.contains(&f.other_key) && err.contains("runs alone"), "{err}");
            assert_eq!(launch_footprint(&f.conn, &f.task), before);
        });
    }

    #[test]
    fn a_dispatched_launch_with_nothing_in_flight_proceeds_silently() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _p, task, _repo) = seeded_git_conn_with_task();
            declare_set(&mut conn, &actor, &task, &["src/a/"]);
            let prepared = launch(&mut conn, &task, CrossTaskConflict::Refuse).expect("nothing in flight");
            assert!(prepared.overlap_warning.is_none());
            assert_eq!(launch_footprint(&conn, &task).0, 1, "the run row exists");
            assert!(overlap_events(&conn, &task).is_empty());
        });
    }

    #[test]
    fn a_manual_launch_colliding_with_a_different_live_task_proceeds_recorded_and_warned() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &["src/a/"]);
            let prepared = launch(&mut f.conn, &f.task, CrossTaskConflict::WarnAndProceed)
                .expect("a user's own launch is never refused for a cross-task conflict (09-07)");
            let warning = prepared.overlap_warning.expect("the overlap is surfaced, not silent");
            assert!(warning.contains(&f.other_key) && warning.contains("src/a/"), "{warning}");
            assert_eq!(launch_footprint(&f.conn, &f.task).0, 1, "the run row exists");
            let events = overlap_events(&f.conn, &f.task);
            assert_eq!(events.len(), 1, "exactly one overlap event");
            assert!(events[0].contains(&f.other_key) && events[0].contains("src/a/"), "{}", events[0]);
            assert!(events[0].contains(&prepared.outcome.run_id), "the event carries the run id");
        });
    }

    #[test]
    fn a_manual_launch_beside_an_undeclared_live_task_proceeds_with_the_runs_alone_wording() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &[]);
            let prepared = launch(&mut f.conn, &f.task, CrossTaskConflict::WarnAndProceed).expect("proceeds");
            let warning = prepared.overlap_warning.expect("surfaced");
            assert!(warning.contains(&f.other_key) && warning.contains("runs alone"), "{warning}");
            let events = overlap_events(&f.conn, &f.task);
            assert_eq!(events.len(), 1);
            assert!(events[0].contains("runs alone"), "{}", events[0]);
        });
    }

    #[test]
    fn a_manual_launch_with_nothing_in_flight_is_silent() {
        with_scratch_worktree_root(|| {
            let (mut conn, actor, _p, task, _repo) = seeded_git_conn_with_task();
            declare_set(&mut conn, &actor, &task, &["src/a/"]);
            let prepared = launch(&mut conn, &task, CrossTaskConflict::WarnAndProceed).expect("proceeds");
            assert!(prepared.overlap_warning.is_none(), "an ordinary launch carries no warning");
            assert!(overlap_events(&conn, &task).is_empty(), "and appends no overlap event");
        });
    }

    #[test]
    fn a_task_with_its_own_running_or_blocked_run_is_refused_on_both_dispositions() {
        for status in ["running", "blocked"] {
            for conflict in [CrossTaskConflict::Refuse, CrossTaskConflict::WarnAndProceed] {
                with_scratch_worktree_root(|| {
                    let (mut conn, actor, _p, task, _repo) = seeded_git_conn_with_task();
                    declare_set(&mut conn, &actor, &task, &["src/a/"]);
                    let first = start_agent_run_recording_first(&mut conn, &task, "acceptEdits", "", &actor, false).unwrap();
                    conn.execute(
                        "UPDATE agent_runs SET status = ?1 WHERE id = ?2",
                        rusqlite::params![status, first.run_id],
                    )
                    .unwrap();
                    let before = launch_footprint(&conn, &task);
                    let err = match launch(&mut conn, &task, conflict) {
                        Ok(_) => panic!("{status} / {conflict:?}: two agents in one worktree must be refused"),
                        Err(e) => e,
                    };
                    assert!(err.contains("already has"), "{status} / {conflict:?}: {err}");
                    assert_eq!(launch_footprint(&conn, &task), before, "{status} / {conflict:?}");
                });
            }
        }
    }

    #[test]
    fn a_manual_launch_at_or_above_the_cap_still_proceeds() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &["src/b/"]);
            let actor = flywheel_core::domain::actor::local_human_actor_id(&f.conn).unwrap();
            flywheel_core::domain::settings::set_dispatch_max_parallel(&mut f.conn, &actor, 1).unwrap();
            let live: i64 = f
                .conn
                .query_row("SELECT COUNT(*) FROM agent_runs WHERE status IN ('running','blocked')", [], |r| r.get(0))
                .unwrap();
            assert!(live >= 1, "the cap of 1 is already reached");
            let prepared = launch(&mut f.conn, &f.task, CrossTaskConflict::WarnAndProceed)
                .expect("the cap is the dispatcher's alone (D-159)");
            assert!(prepared.overlap_warning.is_none(), "disjoint sets: nothing to warn about");
            let _ = &f.other;
        });
    }

    // --- D-REV-39 IN-02: an unattended launch is not the user pressing Launch --------------------------

    #[test]
    fn a_dispatcher_launch_is_attributed_to_the_system_actor_and_a_manual_launch_to_the_human() {
        for (conflict, automatic) in [(CrossTaskConflict::Refuse, true), (CrossTaskConflict::WarnAndProceed, false)] {
            with_scratch_worktree_root(|| {
                let (mut conn, human, _p, task, _repo) = seeded_git_conn_with_task();
                declare_set(&mut conn, &human, &task, &["src/a/"]);
                let system = flywheel_core::domain::actor::system_actor(&conn).unwrap().id;
                let human_events = |c: &Connection| -> i64 {
                    c.query_row("SELECT COUNT(*) FROM events WHERE actor_id = ?1", rusqlite::params![human], |r| r.get(0))
                        .unwrap()
                };
                let before = human_events(&conn);

                let prepared = launch(&mut conn, &task, conflict).unwrap();

                let expected = if automatic { &system } else { &human };
                let (trigger_by, config): (String, Option<String>) = conn
                    .query_row(
                        "SELECT t.created_by, t.config FROM agent_runs r JOIN triggers t ON t.id = r.trigger_id WHERE r.id = ?1",
                        rusqlite::params![prepared.outcome.run_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .unwrap();
                assert_eq!(&trigger_by, expected, "{conflict:?}: who fired the run");
                assert_eq!(config.as_deref().is_some_and(|c| c.contains("automatic")), automatic, "{conflict:?}");
                let worktree_by: String = conn
                    .query_row("SELECT created_by FROM worktrees WHERE task_id = ?1", rusqlite::params![task], |r| r.get(0))
                    .unwrap();
                assert_eq!(&worktree_by, expected, "{conflict:?}: the worktree the launch cut");
                let started: String = conn
                    .query_row(
                        "SELECT payload FROM events WHERE event_type = 'agent_run.started' AND stream_id = ?1",
                        rusqlite::params![prepared.outcome.run_id],
                        |r| r.get(0),
                    )
                    .unwrap();
                let started: serde_json::Value = serde_json::from_str(&started).unwrap();
                assert_eq!(started["automatic"] == true, automatic, "{conflict:?}: {started}");
                if automatic {
                    assert_eq!(human_events(&conn), before, "an unattended launch writes no event under the human actor");
                } else {
                    assert!(human_events(&conn) > before, "the user's own launch is still theirs");
                }
            });
        }
    }

    // --- D-REV-44: the launch asks with the repository's observed case flag -----------------------------

    /// `Src/a.rs` against `src/a.rs` is one file on a case-insensitive filesystem and two on a
    /// case-sensitive one. The launch used to fold unconditionally, so on the second it refused a pair
    /// the dispatcher had judged disjoint. The flag is passed explicitly (both values), so this means
    /// the same thing on a case-insensitive macOS runner as on a case-sensitive Linux one.
    #[test]
    fn a_case_only_pair_is_judged_by_the_flag_the_launch_is_given() {
        for fold in [false, true] {
            with_scratch_worktree_root(|| {
                let mut f = two_tasks(&["Src/a.rs"], &["src/a.rs"]);
                let result = prepare_launch(&mut f.conn, &f.task, "acceptEdits", "", CrossTaskConflict::Refuse, fold);
                if fold {
                    let err = result.err().expect("folded, the pair is one file: the dispatcher's launch is refused");
                    assert!(err.contains("Launch refused"), "{err}");
                } else {
                    result.expect("not folded, the pair is two files: nothing to refuse");
                }
            });
        }
    }

    #[test]
    fn the_observed_case_flag_is_the_repositorys_core_ignorecase() {
        for configured in ["false", "true"] {
            with_scratch_worktree_root(|| {
                let (conn, _actor, _project, task, repo) = seeded_git_conn_with_task();
                // Every git command is constructed in `core/src/git.rs` (supervisor_cwd.rs pins it).
                flywheel_core::git::git_at(repo.path(), &["config", "core.ignorecase", configured]).unwrap();
                let db = std::sync::Mutex::new(conn);
                assert_eq!(observed_fold_case(&db, &task).unwrap(), configured == "true");
                assert!(db.try_lock().is_ok(), "the database lock is not left held by the probe");
            });
        }
    }

    // --- D-REV-46: a launch that fails after its run row exists leaves no `running` row -----------------

    fn live_run_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM agent_runs WHERE status IN ('running', 'blocked')", [], |r| r.get(0))
            .unwrap()
    }

    /// The three facts every failed-launch path must leave: the run is `failed` (not `running`), the
    /// cap slot is back where it was, and the task is not refused as `HasLiveRun` on the next try.
    fn assert_failed_launch_left_nothing_running(conn: &Connection, task_id: &str, live_before: i64) {
        let (status, run_id): (String, String) = conn
            .query_row(
                "SELECT status, id FROM agent_runs WHERE task_id = ?1 ORDER BY started_at DESC, rowid DESC LIMIT 1",
                rusqlite::params![task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "failed", "run {run_id} must be closed, not left running");
        assert_eq!(live_run_count(conn), live_before, "the cap slot is released");
        let project_id: String = conn
            .query_row("SELECT project_id FROM tasks WHERE id = ?1", rusqlite::params![task_id], |r| r.get(0))
            .unwrap();
        let refusal = flywheel_core::dispatch::launch_conflict(conn, task_id, &project_id, true, &[]).unwrap();
        assert!(
            !matches!(refusal, Some(ReadinessRefusal::HasLiveRun)),
            "the task must be relaunchable without a restart: {refusal:?}"
        );
    }

    #[test]
    fn a_failure_between_the_run_insert_and_the_scope_marker_closes_the_run_failed() {
        with_scratch_worktree_root(|| {
            let (mut conn, _actor, _p, task, _repo) = seeded_git_conn_with_task();
            // Step 3 of the run start writes the criteria pin; make exactly that write fail.
            conn.execute_batch(
                "CREATE TRIGGER boom BEFORE UPDATE OF criteria_revision_pin ON agent_runs
                 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
            )
            .unwrap();
            let live_before = live_run_count(&conn);
            let err = match launch(&mut conn, &task, CrossTaskConflict::WarnAndProceed) {
                Ok(_) => panic!("the pin write was made to fail"),
                Err(e) => e,
            };
            assert!(err.contains("criteria_revision_pin"), "{err}");
            conn.execute_batch("DROP TRIGGER boom").unwrap();
            assert_failed_launch_left_nothing_running(&conn, &task, live_before);
        });
    }

    #[test]
    fn a_failure_recording_the_launch_overlap_closes_the_run_failed() {
        with_scratch_worktree_root(|| {
            let mut f = two_tasks(&["src/a/"], &["src/a/"]);
            f.conn
                .execute_batch(&format!(
                    "CREATE TRIGGER boom BEFORE INSERT ON events WHEN NEW.event_type = '{EVENT_LAUNCH_OVERLAP}'
                     BEGIN SELECT RAISE(ABORT, 'boom'); END;"
                ))
                .unwrap();
            let live_before = live_run_count(&f.conn);
            let err = match launch(&mut f.conn, &f.task, CrossTaskConflict::WarnAndProceed) {
                Ok(_) => panic!("the overlap event write was made to fail"),
                Err(e) => e,
            };
            assert!(err.contains("append event"), "{err}");
            f.conn.execute_batch("DROP TRIGGER boom").unwrap();
            assert_failed_launch_left_nothing_running(&f.conn, &f.task, live_before);
        });
    }

    /// Drive `prepare_launch` then `spawn_prepared_run` with the given shim and send, returning the
    /// error and the database for the assertions.
    fn spawn_with(
        merge_shim: impl FnOnce(&mut std::collections::HashMap<String, String>, &str) -> anyhow::Result<()>,
        send: impl FnOnce(&serde_json::Value) -> Result<(), String>,
    ) -> (String, std::sync::Mutex<Connection>, String, tempfile::TempDir) {
        let (conn, _actor, _p, task, repo) = seeded_git_conn_with_task();
        let db = std::sync::Mutex::new(conn);
        let mut guard = db.lock().unwrap();
        let prepared = prepare_launch(&mut guard, &task, "acceptEdits", "", CrossTaskConflict::WarnAndProceed, false)
            .expect("the run row is inserted");
        let err = spawn_prepared_run(&db, guard, &prepared.outcome, prepared.env, "acceptEdits", merge_shim, send)
            .expect_err("the injected step fails");
        (err, db, task, repo)
    }

    #[test]
    fn a_shim_install_failure_closes_the_run_failed() {
        with_scratch_worktree_root(|| {
            let (err, db, task, _repo) = spawn_with(|_, _| Err(anyhow::anyhow!("shim boom")), |_| Ok(()));
            assert!(err.contains("shim boom"), "{err}");
            assert_failed_launch_left_nothing_running(&db.lock().unwrap(), &task, 0);
        });
    }

    #[test]
    fn a_failed_gated_spawn_closes_the_run_failed() {
        with_scratch_worktree_root(|| {
            let (err, db, task, _repo) = spawn_with(|_, _| Ok(()), |_| Err("spawn boom".to_string()));
            assert!(err.contains("spawn boom"), "{err}");
            assert_failed_launch_left_nothing_running(&db.lock().unwrap(), &task, 0);
        });
    }
}
