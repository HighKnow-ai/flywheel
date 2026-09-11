//! The sidecar supervisor (PROC-01, PROC-02, D-34): spawns the bundled `flywheel-sidecar` Node
//! process via `tauri-plugin-shell`, keeps its stdin request channel and its process handle, and
//! runs a reader task that persists every stdout line to the owning run's session log BEFORE ever
//! emitting it to the renderer (PITFALLS.md pitfall 10 — the persisted log is ground truth,
//! independent of what the UI renders; the log write is never conditional on the emit succeeding).
//!
//! No per-run fault on this reader loop can ever terminate it (CR-03, PROC-07 — the gap this
//! module used to have: one run's unwritable log file used to panic the loop and silently starve
//! every other run's events for the rest of the app session). A malformed line, an unwritable or
//! unappendable session log, an unparseable event and a rejected run id are each turned into a
//! value by [`persist_event_line`] and handled by its caller — never a panic, never an early
//! return out of the loop. One run's I/O failure stays scoped to that run.
//!
//! This module's own working directory is fixed by the OS at process launch and is NEVER read or
//! reassigned (PROC-02, ARCHITECTURE.md Anti-Pattern 3 — "the supervisor must never drift into a
//! worker's worktree" enforced structurally, not by convention) — every path this module hands the
//! sidecar (a worktree path, in a `spawn` request built by `commands::agent_run::agent_run_start`)
//! is already absolute by the time it arrives here. `packages/core/tests/supervisor_cwd.rs`
//! enforces this as a gate: it scans this file's own source for any ambient-current-directory
//! call and fails the build if one appears.

use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Context;
use rusqlite::Connection;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use flywheel_core::session_log::SessionLogWriter;

/// One line of the sidecar's stdout protocol: either a normalised agent event, or an
/// acknowledgement of a request this supervisor sent. Anything else (a malformed line) is logged
/// and dropped — it can never crash the reader task. `data` is `None` for every ack except
/// `capability_probe`'s (D-39, plan 02-09 Task 3) — the only request in this protocol that
/// carries a response payload beyond plain success/failure.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SidecarStdoutLine {
    Event { event: serde_json::Value },
    Ack {
        id: String,
        ok: bool,
        error: Option<String>,
        #[serde(default)]
        data: Option<serde_json::Value>,
    },
}

/// Resolve which credential a spawn for `project_id` should use, and the environment additions
/// the sidecar's spawn request should carry (D-39). Called from `commands::agent_run::
/// agent_run_start` ONCE per spawn, immediately before the spawn request is built — NEVER cached
/// on `AppState` or anywhere else (T-02-41): a cached credential would outlive the setting that
/// produced it, breaking a per-project override the moment a user changes it mid-session. This is
/// a thin wrapper over `flywheel_core::credentials::resolve_credential` — the actual credential
/// read happens there, this function exists only so the spawn-request call site in
/// `commands::agent_run` names a function local to the sidecar-facing module it calls into.
pub fn resolved_env_for_run(conn: &Connection, project_id: &str) -> anyhow::Result<HashMap<String, String>> {
    Ok(flywheel_core::credentials::resolve_credential(conn, project_id)?.env)
}

/// The live sidecar process handle: its child (for kill-on-app-exit), its stdin request sender,
/// the map of open per-run session-log writers the reader task appends through, and every
/// still-outstanding request awaiting its ack, keyed by the request `id` (D-35 — `interrupt_run`
/// blocks on this until the sidecar's `interrupt` ack line arrives).
pub struct SidecarHandle {
    child: Mutex<Option<CommandChild>>,
    writers: Mutex<HashMap<String, SessionLogWriter>>,
    /// Every still-outstanding request awaiting its ack, keyed by request `id`. The channel
    /// carries the ack's `data` payload (a bare `Null` for every request type except
    /// `capability_probe`, which is the only one with a response beyond plain success/failure) —
    /// generalised from a plain `Result<(), String>` in plan 02-09 Task 3 so `capability_probe`
    /// could reuse this exact wait-for-ack mechanism rather than inventing a second one.
    pending_acks: Mutex<HashMap<String, std::sync::mpsc::Sender<Result<serde_json::Value, String>>>>,
    /// Maps a `permission_requests.id` (the DATABASE row id — the only id the board/renderer
    /// ever sees or names) to the `(run_id, mcp_request_id)` pair `agent_run_answer_permission`
    /// needs to relay a decision back to the SPECIFIC held MCP tool call the sidecar's
    /// permission server is holding open. The two ids are deliberately distinct
    /// (`permission_request.rs`'s own doc comment on the sidecar side) — this map is their only
    /// correlation point. Populated when `create_pending_request` succeeds (inbound, the
    /// no-matching-rule path), consumed and removed by `relay_permission_answer` (outbound).
    pending_permission_requests: Mutex<HashMap<String, (String, String)>>,
}

/// How long `interrupt_run` waits for the sidecar's ack before giving up — generous enough to
/// cover the sidecar's own `STOP_GRACE_MS` (5s, `packages/sidecar/src/claude-code-adapter.ts`)
/// plus the force step and normal IPC overhead, so a legitimate interrupt-then-force sequence
/// never times out under this ceiling; only a genuinely wedged or crashed sidecar does.
const INTERRUPT_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

impl SidecarHandle {
    /// Send one newline-delimited JSON request to the sidecar's stdin (a `spawn`/`interrupt`/
    /// `kill` request, built by the caller).
    pub fn send_request(&self, request_json: &str) -> anyhow::Result<()> {
        let mut guard = self.child.lock().map_err(|_| anyhow::anyhow!("sidecar child mutex poisoned"))?;
        let child = guard.as_mut().context("sidecar process is not running")?;
        let mut line = request_json.to_string();
        line.push('\n');
        child
            .write(line.as_bytes())
            .context("failed to write request to the sidecar's stdin")?;
        Ok(())
    }

    /// Send an `interrupt` request for `run_id` over the sidecar's stdin and block until its
    /// acknowledgement arrives (D-35). Since plan 02-11 (CR-04), `agent_run_stop` no longer
    /// gates its terminal write on this call: the interrupt is still sent and this call still
    /// waits on it, but its outcome can only widen the command's returned `sidecar_warning` — it
    /// can never delay or prevent the domain write that records the run's terminal status. The
    /// request `id` is `run_id` itself, matching `agent_run_start`'s own convention
    /// (`commands/agent_run.rs`).
    pub fn interrupt_run(&self, run_id: &str) -> anyhow::Result<()> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
        {
            let mut pending = self
                .pending_acks
                .lock()
                .map_err(|_| anyhow::anyhow!("sidecar pending-acks mutex poisoned"))?;
            pending.insert(run_id.to_string(), tx);
        }

        let request = serde_json::json!({ "id": run_id, "op": "interrupt", "runId": run_id });
        if let Err(err) = self.send_request(&request.to_string()) {
            if let Ok(mut pending) = self.pending_acks.lock() {
                pending.remove(run_id);
            }
            return Err(err);
        }

        match rx.recv_timeout(INTERRUPT_ACK_TIMEOUT) {
            Ok(Ok(_data)) => Ok(()),
            Ok(Err(err)) => Err(anyhow::anyhow!("sidecar interrupt request failed: {err}")),
            Err(_) => {
                // Timed out (or the sender was dropped without ever sending) — clean up the stale
                // pending-ack entry so a late ack can never resurrect it and silently satisfy a
                // future call for the same run_id.
                if let Ok(mut pending) = self.pending_acks.lock() {
                    pending.remove(run_id);
                }
                Err(anyhow::anyhow!(
                    "sidecar did not acknowledge the interrupt request for run {run_id:?} within {INTERRUPT_ACK_TIMEOUT:?}"
                ))
            }
        }
    }

    /// Ask the sidecar to resolve the backend binary it would spawn and report its version
    /// (D-39, plan 02-09 Task 3). Read-only: never spawns a session, never touches a credential —
    /// mirrors `interrupt_run`'s own send-then-block-on-ack shape, reusing [`Self::pending_acks`]
    /// for the wait. Returns `(available, version)`; `version` is `None` whenever `available` is
    /// `false` or the backend printed no parseable version string.
    pub fn capability_probe(&self) -> anyhow::Result<(bool, Option<String>)> {
        let request_id = format!("capability-probe-{}", flywheel_core::ids::new_id());
        let (tx, rx) = std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
        {
            let mut pending = self
                .pending_acks
                .lock()
                .map_err(|_| anyhow::anyhow!("sidecar pending-acks mutex poisoned"))?;
            pending.insert(request_id.clone(), tx);
        }

        let request = serde_json::json!({ "id": request_id, "op": "capability_probe" });
        if let Err(err) = self.send_request(&request.to_string()) {
            if let Ok(mut pending) = self.pending_acks.lock() {
                pending.remove(&request_id);
            }
            return Err(err);
        }

        match rx.recv_timeout(INTERRUPT_ACK_TIMEOUT) {
            Ok(Ok(data)) => {
                let available = data.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
                let version = data.get("version").and_then(|v| v.as_str()).map(str::to_string);
                Ok((available, version))
            }
            Ok(Err(err)) => Err(anyhow::anyhow!("sidecar capability probe failed: {err}")),
            Err(_) => {
                if let Ok(mut pending) = self.pending_acks.lock() {
                    pending.remove(&request_id);
                }
                Err(anyhow::anyhow!(
                    "sidecar did not respond to the capability probe within {INTERRUPT_ACK_TIMEOUT:?}"
                ))
            }
        }
    }

    /// Remember the correlation between a freshly-created `permission_requests.id` and the
    /// sidecar's own `(run_id, mcp_request_id)` for that held call (AGNT-06 inbound path) — the
    /// ONLY place this mapping is written.
    pub fn register_pending_permission_request(&self, db_request_id: &str, run_id: &str, mcp_request_id: &str) {
        if let Ok(mut map) = self.pending_permission_requests.lock() {
            map.insert(db_request_id.to_string(), (run_id.to_string(), mcp_request_id.to_string()));
        }
    }

    /// Relay a decision for `db_request_id` to the sidecar's held call, resolving the id via the
    /// map `register_pending_permission_request` populated. If nothing is tracked for this id
    /// (already relayed, or a row this handle never learned about), this is a harmless no-op —
    /// never an error the caller must handle specially, mirroring the sidecar's own
    /// `resolvePermission`'s "no held call — ignore" contract for its `requestId`.
    pub fn relay_permission_answer(&self, db_request_id: &str, decision: &str) -> anyhow::Result<()> {
        let entry = {
            let mut map = self
                .pending_permission_requests
                .lock()
                .map_err(|_| anyhow::anyhow!("pending permission requests mutex poisoned"))?;
            map.remove(db_request_id)
        };
        let Some((run_id, mcp_request_id)) = entry else {
            return Ok(());
        };
        self.relay_permission_answer_direct(&run_id, &mcp_request_id, decision)
    }

    /// Relay a decision directly by `(run_id, mcp_request_id)` — used by the rule-short-circuit
    /// inbound path (T-02-24), which never creates a `permission_requests` row and so has
    /// nothing to look up in [`Self::pending_permission_requests`].
    pub fn relay_permission_answer_direct(&self, run_id: &str, mcp_request_id: &str, decision: &str) -> anyhow::Result<()> {
        let request = serde_json::json!({
            "id": format!("permission-answer-{mcp_request_id}"),
            "op": "permission_answer",
            "runId": run_id,
            "requestId": mcp_request_id,
            "decision": decision,
        });
        self.send_request(&request.to_string())
    }

    /// Kill the sidecar's own process (and, by extension, every child session it was driving) —
    /// called on app exit so no orphaned sidecar or session process survives Flywheel closing.
    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

/// The outcome of one attempt to persist a single sidecar stdout event line to its owning run's
/// session log (CR-03, PROC-07). Every variant is a plain value returned to the caller — never an
/// unwind — because the caller is the single shared reader task for every run in the app.
#[derive(Debug, PartialEq)]
pub(crate) enum PersistOutcome {
    /// The line was appended to `run_id`'s session log.
    Written,
    /// `run_id` does not have the shape of a real run id (see [`is_plausible_run_id`]) — rejected
    /// before any filesystem path was ever built from it (T-02G-12-01).
    RejectedRunId,
    /// `run_id`'s session log could not be opened. Carries the error text; nothing was inserted
    /// into the writers map, so the very next event for this run retries the open rather than
    /// being permanently poisoned by a cached failure (T-02G-12-02).
    OpenFailed(String),
    /// `run_id`'s session log was open, but appending this line to it failed. Carries the error
    /// text.
    AppendFailed(String),
}

/// Whether `run_id` has the shape of a real run id: exactly 26 ASCII alphanumeric characters —
/// the shape the `CHECK (length(id) = 26)` constraint in `0003_agent_runtime.sql` already
/// guarantees for every id this codebase mints via `flywheel_core::ids::new_id()`. This is the
/// guard that stops a `runId` read off an untrusted sidecar stdout line from ever being joined
/// into a filesystem path unchecked (T-02G-12-01) — called before [`SessionLogWriter::open`] /
/// `session_log_path` on every path through [`persist_event_line`].
pub(crate) fn is_plausible_run_id(run_id: &str) -> bool {
    run_id.len() == 26 && run_id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The only place a session-log writer is opened from the shared sidecar reader loop (CR-03). Every
/// failure path here — a poisoned `writers` mutex, a log file that cannot be opened, a write that
/// cannot be appended, an implausible run id — is returned as a [`PersistOutcome`] value, never a
/// panic and never an unwind, because the caller is the ONE reader task for every run this
/// application supervises: a panic here would take every other run's live feed and persisted log
/// down with it for the rest of the app session.
///
/// On [`PersistOutcome::OpenFailed`], nothing is inserted into `writers` — the next call for the
/// same `run_id` retries the open (T-02G-12-02) instead of caching a transient failure forever.
pub(crate) fn persist_event_line(
    writers: &Mutex<HashMap<String, SessionLogWriter>>,
    run_id: &str,
    event_line: &str,
) -> PersistOutcome {
    if !is_plausible_run_id(run_id) {
        return PersistOutcome::RejectedRunId;
    }

    let mut writers = match writers.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            return PersistOutcome::OpenFailed(format!("session log writers mutex poisoned: {poisoned}"))
        }
    };

    if !writers.contains_key(run_id) {
        let writer = match SessionLogWriter::open(run_id) {
            Ok(writer) => writer,
            Err(err) => return PersistOutcome::OpenFailed(format!("{err:#}")),
        };
        writers.insert(run_id.to_string(), writer);
    }

    match writers.get_mut(run_id) {
        Some(writer) => match writer.append_event_line(event_line) {
            Ok(()) => PersistOutcome::Written,
            Err(err) => PersistOutcome::AppendFailed(format!("{err:#}")),
        },
        None => PersistOutcome::OpenFailed("session log writer unexpectedly absent after insert".to_string()),
    }
}

/// Spawn the bundled `flywheel-sidecar` binary and start its stdout reader task. Follows this
/// codebase's expect-or-crash-loudly-at-startup idiom (`main.rs`'s `.setup()` closure) — a failure
/// to resolve or spawn the sidecar aborts startup rather than proceeding with a half-working app.
pub fn spawn_sidecar(app: &AppHandle) -> anyhow::Result<SidecarHandle> {
    let sidecar_command = app
        .shell()
        .sidecar("flywheel-sidecar")
        .context("failed to resolve the flywheel-sidecar binary")?;
    let (mut rx, child) = sidecar_command
        .spawn()
        .context("failed to spawn the flywheel-sidecar process")?;

    let handle = SidecarHandle {
        child: Mutex::new(Some(child)),
        writers: Mutex::new(HashMap::new()),
        pending_acks: Mutex::new(HashMap::new()),
        pending_permission_requests: Mutex::new(HashMap::new()),
    };

    let app_for_reader = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line_bytes) = event {
                let line = String::from_utf8_lossy(&line_bytes).into_owned();
                let parsed: Result<SidecarStdoutLine, _> = serde_json::from_str(line.trim());

                match parsed {
                    Ok(SidecarStdoutLine::Event { event }) => {
                        let run_id = event.get("runId").and_then(|v| v.as_str()).map(str::to_string);
                        let event_line = event.to_string();

                        if let Some(run_id) = run_id {
                            if let Some(state) = app_for_reader.try_state::<crate::state::AppState>() {
                                if let Some(sidecar) = state.sidecar.as_ref() {
                                    // The persistent write happens FIRST, unconditionally — the
                                    // emit below is a best-effort live view, never the source of
                                    // truth (PITFALLS.md pitfall 10). No outcome here — Written or
                                    // otherwise — can ever stop this loop (CR-03): a per-run fault
                                    // is a value `persist_event_line` returns, never a panic.
                                    let _outcome = persist_event_line(&sidecar.writers, &run_id, &event_line);
                                }
                            }
                        }

                        let _ = app_for_reader.emit("agent:event", &event);

                        // AGNT-06 inbound half: a permission_request event on this SAME reader
                        // loop, handled BEFORE any pending row exists — the rule short-circuit
                        // (T-02-24) checks first, so a matching allow-always rule never creates a
                        // board-visible pending request or blocks the run.
                        if event.get("type").and_then(|v| v.as_str()) == Some("permission_request") {
                            crate::commands::agent_run::handle_inbound_permission_request(&app_for_reader, &event);
                        }
                    }
                    Ok(SidecarStdoutLine::Ack { id, ok, error, data }) => {
                        if let Some(state) = app_for_reader.try_state::<crate::state::AppState>() {
                            if let Some(sidecar) = state.sidecar.as_ref() {
                                if let Ok(mut pending) = sidecar.pending_acks.lock() {
                                    if let Some(sender) = pending.remove(&id) {
                                        let result = if ok {
                                            Ok(data.unwrap_or(serde_json::Value::Null))
                                        } else {
                                            Err(error.unwrap_or_else(|| "sidecar request failed".to_string()))
                                        };
                                        let _ = sender.send(result);
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {
                        // A malformed line — logged nowhere yet, dropped, never crashes the
                        // reader task (this module's own doc comment above).
                    }
                }
            }
        }
    });

    Ok(handle)
}
