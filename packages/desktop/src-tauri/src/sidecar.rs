//! The sidecar supervisor (PROC-01, PROC-02, D-34): spawns the bundled `flywheel-sidecar` Node
//! process via `tauri-plugin-shell`, keeps its stdin request channel and its process handle, and
//! runs a reader task that persists every stdout line to the owning run's session log BEFORE ever
//! emitting it to the renderer (PITFALLS.md pitfall 10 — the persisted log is ground truth,
//! independent of what the UI renders; the log write is never conditional on the emit succeeding).
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
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use flywheel_core::session_log::SessionLogWriter;

/// One line of the sidecar's stdout protocol: either a normalised agent event, or an
/// acknowledgement of a request this supervisor sent. Anything else (a malformed line) is logged
/// and dropped — it can never crash the reader task.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SidecarStdoutLine {
    Event { event: serde_json::Value },
    Ack { id: String, ok: bool, error: Option<String> },
}

/// The live sidecar process handle: its child (for kill-on-app-exit), its stdin request sender,
/// the map of open per-run session-log writers the reader task appends through, and every
/// still-outstanding request awaiting its ack, keyed by the request `id` (D-35 — `interrupt_run`
/// blocks on this until the sidecar's `interrupt` ack line arrives).
pub struct SidecarHandle {
    child: Mutex<Option<CommandChild>>,
    writers: Mutex<HashMap<String, SessionLogWriter>>,
    pending_acks: Mutex<HashMap<String, std::sync::mpsc::Sender<Result<(), String>>>>,
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
    /// acknowledgement arrives (D-35) — `agent_run_stop` calls this BEFORE writing the run's
    /// terminal status, so the process has already started (and, by the time this returns,
    /// finished) shutting down before the domain write lands. The request `id` is `run_id`
    /// itself, matching `agent_run_start`'s own convention (`commands/agent_run.rs`).
    pub fn interrupt_run(&self, run_id: &str) -> anyhow::Result<()> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
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
            Ok(Ok(())) => Ok(()),
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
                                    // truth (PITFALLS.md pitfall 10).
                                    if let Ok(mut writers) = sidecar.writers.lock() {
                                        let writer = writers.entry(run_id.clone()).or_insert_with(|| {
                                            SessionLogWriter::open(&run_id)
                                                .expect("failed to open session log writer for run")
                                        });
                                        let _ = writer.append_event_line(&event_line);
                                    }
                                }
                            }
                        }

                        let _ = app_for_reader.emit("agent:event", &event);
                    }
                    Ok(SidecarStdoutLine::Ack { id, ok, error }) => {
                        if let Some(state) = app_for_reader.try_state::<crate::state::AppState>() {
                            if let Some(sidecar) = state.sidecar.as_ref() {
                                if let Ok(mut pending) = sidecar.pending_acks.lock() {
                                    if let Some(sender) = pending.remove(&id) {
                                        let result = if ok {
                                            Ok(())
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
