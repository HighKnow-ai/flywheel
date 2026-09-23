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
//! [`spawn_sidecar`] returns only AFTER the sidecar has answered its own bounded startup readiness
//! handshake on its own stdio protocol (G-02-1) — `tauri-plugin-shell`'s `.spawn()` returning `Ok`
//! proves only that the operating system accepted the exec, not that a live process is on the
//! other end reading its stdin and writing its own protocol on stdout. A sidecar that exits
//! immediately after spawn (a bad stub, a missing Node, a crash on boot) now aborts startup
//! naming its own exit status and its own stderr tail, through this module's callers' existing
//! expect-or-crash-loudly idiom, instead of deferring the failure to the first request written to
//! a stdin that was never open on the other end. The wait is bounded by
//! [`STARTUP_READINESS_TIMEOUT`] — a wedged sidecar fails the handshake rather than hanging
//! application startup. Once the handshake succeeds, the reader task below observes the sidecar's
//! stderr and process-lifecycle events for the remainder of the process, not only its stdout.
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
    Event {
        event: serde_json::Value,
    },
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
pub fn resolved_env_for_run(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<HashMap<String, String>> {
    let mut env = flywheel_core::credentials::resolve_credential(conn, project_id)?.env;

    // D-56 (plan 03-07): the ONLY external input `destructive::classify` accepts beyond the
    // argv itself — resolved server-side from the project's own row, never from the agent or
    // from a file. Read here (rather than in `merge_shim_env_for_run`) because this function
    // already has `conn`/`project_id` in hand and this value needs neither `run_id` nor the
    // per-run shim directory the way `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM` do.
    let default_branch: String = conn
        .query_row(
            "SELECT default_branch FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .context("failed to resolve the project's default_branch for a spawned session's environment")?;
    env.insert("FLYWHEEL_DEFAULT_BRANCH".to_string(), default_branch);

    // D-47/D-50 (plan 03-02): the seam the watchdog wrapper (`packages/sidecar/src/watchdog.ts`)
    // reads its own configuration from. `FLYWHEEL_RUNTIME_DIR` is the SAME resolved value
    // `runtime_protocol::runtime_dir` uses on the Rust side, so the watchdog polls the exact
    // heartbeat file `spawn_sidecar`'s heartbeat thread (below) touches. The run id is already
    // carried in the spawn request's own `runId` field, so no fourth entry is needed here — the
    // adapter (`claude-code-adapter.ts`) adds `FLYWHEEL_RUN_ID` itself at spawn time, from the
    // one place that actually knows it.
    let runtime_dir = flywheel_core::runtime_protocol::runtime_dir()
        .context("failed to resolve the runtime directory for a spawned session's environment")?;
    env.insert(
        "FLYWHEEL_RUNTIME_DIR".to_string(),
        runtime_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "FLYWHEEL_HEARTBEAT_STALE_MS".to_string(),
        flywheel_core::runtime_protocol::HEARTBEAT_STALE_MS.to_string(),
    );
    env.insert(
        "FLYWHEEL_HEARTBEAT_POLL_MS".to_string(),
        flywheel_core::runtime_protocol::HEARTBEAT_POLL_MS.to_string(),
    );

    Ok(env)
}

/// D-51 (plan 03-04): merge the per-run PATH-shim entries into an already-resolved spawn
/// environment. Called AFTER `start_agent_run` produces a real `run_id` — [`resolved_env_for_run`]
/// above intentionally runs BEFORE the run/worktree row is created (D-39), so a credential
/// resolution failure never orphans a running `agent_runs` row; the shim's own installed directory
/// is keyed by `run_id`, which does not exist yet at that point, so this step cannot live inside
/// that same function. A shim-install failure here still refuses the SPAWN itself —
/// `agent_run_start` propagates the error and never sends the request to the sidecar — exactly as
/// it already refuses on a credential failure, even though by this point the row and worktree
/// already exist (closing that narrower gap would require making run ids predictable before
/// creation, out of this plan's scope).
///
/// **D-59/D-60 (plan 03-25):** `flywheel_core::shim::shim_env_for_run` now verifies both that it
/// installed a structurally sound shadow directory (Task 1) AND that the installed entry speaks
/// plan 03-24's current classification contract (Task 2) — a broken or stale install refuses the
/// spawn here rather than producing a session `pretooluse-hook.ts`'s PreToolUse hook can never
/// prove and therefore denies every command in, safe ones included (D-60). The `.context(...)`
/// string below is what `agent_run_start` turns into `Err(String)` and what
/// `LaunchSheet.tsx`'s existing `handleSubmit` catch renders in the launch sheet's error slot — the
/// one sentence a human actually reads when a session cannot be protected.
pub fn merge_shim_env_for_run(
    env: &mut HashMap<String, String>,
    run_id: &str,
) -> anyhow::Result<()> {
    let shim_env = flywheel_core::shim::shim_env_for_run(run_id).context(
        "failed to install the PATH shim for this session — a session cannot be spawned without \
         a verified shim, because the PreToolUse hook denies every command in a session whose \
         shadow directory it cannot prove (D-60)",
    )?;
    env.extend(shim_env);
    Ok(())
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
    pending_acks:
        Mutex<HashMap<String, std::sync::mpsc::Sender<Result<serde_json::Value, String>>>>,
    /// Maps a `permission_requests.id` (the DATABASE row id — the only id the board/renderer
    /// ever sees or names) to the `(run_id, mcp_request_id)` pair `agent_run_answer_permission`
    /// needs to relay a decision back to the SPECIFIC held MCP tool call the sidecar's
    /// permission server is holding open. The two ids are deliberately distinct
    /// (`permission_request.rs`'s own doc comment on the sidecar side) — this map is their only
    /// correlation point. Populated when `create_pending_request` succeeds (inbound, the
    /// no-matching-rule path), consumed and removed by `relay_permission_answer` (outbound).
    pending_permission_requests: Mutex<HashMap<String, (String, String)>>,
    /// Run ids for which the reader loop has already emitted a persistence-failure notice
    /// (CR-03, PROC-07) — so a run whose log keeps failing to open or append produces exactly
    /// ONE notice, not one per failing event, while still retrying the write itself on every
    /// event (T-02G-12-02).
    notified_persist_failures: Mutex<std::collections::HashSet<String>>,
    /// Set to `true` by [`Self::kill`] so the heartbeat-writer thread `spawn_sidecar` starts
    /// stops touching the heartbeat file promptly on a clean exit (D-47) — a stopped supervisor
    /// SHOULD look stale to every live watchdog as soon as possible, not linger for one more
    /// `HEARTBEAT_INTERVAL_MS` tick after the sidecar itself is already gone.
    heartbeat_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// D-52/WORK-05: one spawn floor for this handle's entire process lifetime, keyed by
    /// repository path. [`Self::send_spawn_request`] is the ONLY path a spawn request may take —
    /// see its own doc comment for the invariant this field exists to enforce.
    spawn_floor: flywheel_core::git_retry::SpawnFloor,
}

/// How long `interrupt_run` waits for the sidecar's ack before giving up — generous enough to
/// cover the sidecar's own `STOP_GRACE_MS` (5s, `packages/sidecar/src/claude-code-adapter.ts`)
/// plus the force step and normal IPC overhead, so a legitimate interrupt-then-force sequence
/// never times out under this ceiling; only a genuinely wedged or crashed sidecar does.
const INTERRUPT_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// How long `shutdown_all_sessions` waits for the sidecar's ack before giving up (CR-02, plan
/// 02-14). Deliberately far shorter than [`INTERRUPT_ACK_TIMEOUT`]: this one is waited on during
/// APPLICATION EXIT, where the operating system and the user both expect the app to go away
/// promptly, and it only needs to cover the sidecar's own `SHUTDOWN_SESSION_GRACE_MS` (2s,
/// `packages/sidecar/src/index.ts`) plus IPC overhead — not the full 30-second interrupt ceiling.
const SHUTDOWN_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The fixed request id [`spawn_sidecar`]'s startup readiness handshake uses (G-02-1). It names no
/// run and is never reused for anything else — every other request id in this module either names
/// a `run_id` or is freshly generated per call (`capability_probe`, `shutdown_all_sessions`).
const READINESS_REQUEST_ID: &str = "startup-readiness-check";

/// How long [`spawn_sidecar`] waits for the sidecar's own answer to the readiness handshake before
/// giving up and aborting startup (G-02-1). Five seconds is generous relative to a plain Node
/// process boot — importing its own small module graph and starting a `readline` interface — yet
/// short enough that a wedged or hung sidecar cannot make the whole application appear to hang at
/// launch; the same expect-or-crash-loudly idiom `main.rs`'s `.setup()` closure already applies to
/// every other startup step surfaces this as a named, actionable failure well within a user's
/// patience for "the app is starting."
const STARTUP_READINESS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// The cap, in bytes, on how much of the sidecar's stderr [`spawn_sidecar`]'s readiness handshake
/// retains while waiting (G-02-1, T-02G-15-03). Once reached, further stderr chunks are dropped
/// rather than grown without bound — this is a startup diagnostic tail for the developer's own
/// console, not a full capture, and an unbounded buffer here would let a chatty or looping child
/// process grow this function's memory use while startup is blocked waiting on it.
const READINESS_STDERR_TAIL_CAP: usize = 4096;

/// Append one chunk of the sidecar's readiness-handshake stderr to `tail`, bounded at `cap`
/// bytes (plan 03-15, T-03-15-04) — extracted out of the async closure in [`spawn_sidecar`] so it
/// is unit-testable without spawning a process or entering a runtime.
///
/// Replaces a `String::truncate` at the raw byte minimum, which panics whenever the cut lands
/// mid-character: `String::from_utf8_lossy` renders invalid UTF-8 as three-byte U+FFFD
/// replacement characters, so a stderr burst whose decoded form straddles `cap` can very easily
/// land the cut inside one. This frame runs inside `tauri::async_runtime::block_on` in
/// `main.rs`'s `.setup()` closure, which CANNOT UNWIND, and the workspace release profile sets
/// `panic = "abort"` — so an oversized multi-byte stderr burst during the five-second readiness
/// handshake would have killed the app before a window was ever shown (`stderr_tail_tests`'s
/// `..._invalid_utf8_positioned_to_straddle_the_cap_never_panics` is the falsifying test). Instead
/// of cutting at the raw byte minimum, walk backwards from the candidate cut index using
/// `str::is_char_boundary` (stable — no nightly boundary helper needed) until landing on one;
/// index zero is always a boundary, so the loop always terminates.
fn push_bounded_stderr_tail(tail: &mut String, bytes: &[u8], cap: usize) {
    if tail.len() >= cap {
        return;
    }
    tail.push_str(&String::from_utf8_lossy(bytes));
    tail.push('\n');
    if tail.len() > cap {
        let mut cut = cap;
        while cut > 0 && !tail.is_char_boundary(cut) {
            cut -= 1;
        }
        tail.truncate(cut);
    }
}

impl SidecarHandle {
    /// Send one newline-delimited JSON request to the sidecar's stdin (a `spawn`/`interrupt`/
    /// `kill` request, built by the caller).
    pub fn send_request(&self, request_json: &str) -> anyhow::Result<()> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| anyhow::anyhow!("sidecar child mutex poisoned"))?;
        let child = guard.as_mut().context("sidecar process is not running")?;
        let mut line = request_json.to_string();
        line.push('\n');
        child
            .write(line.as_bytes())
            .context("failed to write request to the sidecar's stdin")?;
        Ok(())
    }

    /// D-52/WORK-05: the ONLY path a spawn request may take. Calls
    /// `SpawnFloor::wait_turn(repo_path)` BEFORE ever writing to the sidecar's stdin, so no two
    /// spawns against the SAME repository can begin within `SPAWN_FLOOR_MS` of each other — the
    /// gate is unbypassable from the command layer precisely because there is no other way to
    /// reach the sidecar's stdin for a spawn request. Callers MUST invoke this only after their
    /// own database connection has already been dropped (`agent_run_start`'s own comment on its
    /// call site names why): the floor's sleep must never run while holding the SQLite mutex
    /// (T-03-04-05).
    pub fn send_spawn_request(&self, repo_path: &str, request_json: &str) -> anyhow::Result<()> {
        self.spawn_floor.wait_turn(repo_path);
        self.send_request(request_json)
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
                let available = data
                    .get("available")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let version = data
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
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
    pub fn register_pending_permission_request(
        &self,
        db_request_id: &str,
        run_id: &str,
        mcp_request_id: &str,
    ) {
        if let Ok(mut map) = self.pending_permission_requests.lock() {
            map.insert(
                db_request_id.to_string(),
                (run_id.to_string(), mcp_request_id.to_string()),
            );
        }
    }

    /// Relay a decision for `db_request_id` to the sidecar's held call, resolving the id via the
    /// map `register_pending_permission_request` populated. If nothing is tracked for this id
    /// (already relayed, or a row this handle never learned about), this is a harmless no-op —
    /// never an error the caller must handle specially, mirroring the sidecar's own
    /// `resolvePermission`'s "no held call — ignore" contract for its `requestId`.
    pub fn relay_permission_answer(
        &self,
        db_request_id: &str,
        decision: &str,
    ) -> anyhow::Result<()> {
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
    pub fn relay_permission_answer_direct(
        &self,
        run_id: &str,
        mcp_request_id: &str,
        decision: &str,
    ) -> anyhow::Result<()> {
        let request = serde_json::json!({
            "id": format!("permission-answer-{mcp_request_id}"),
            "op": "permission_answer",
            "runId": run_id,
            "requestId": mcp_request_id,
            "decision": decision,
        });
        self.send_request(&request.to_string())
    }

    /// D-87 (plan 05-05): answer a held `board_read` call for `run_id`/`request_id` with the
    /// core's own result (or error) — the read-path sibling of [`Self::relay_permission_answer_direct`],
    /// following its identical fire-and-forget shape (no ack wait): the sidecar's own
    /// `authoring_read_answer` ack is not something this call's caller needs to observe
    /// synchronously.
    pub fn relay_authoring_read_answer(
        &self,
        run_id: &str,
        request_id: &str,
        result: Result<serde_json::Value, String>,
    ) -> anyhow::Result<()> {
        let mut request = serde_json::json!({
            "id": format!("board-read-answer-{request_id}"),
            "op": "authoring_read_answer",
            "runId": run_id,
            "requestId": request_id,
        });
        match result {
            Ok(value) => request["result"] = value,
            Err(message) => request["error"] = serde_json::Value::String(message),
        }
        self.send_request(&request.to_string())
    }

    /// D-89 (plan 05-05): send one turn's text to a live authoring session — the seam
    /// `advance_stage`'s distillation instruction and a developer's decision on a proposal both
    /// use to reach the running conversation; plan 05-12 Task 1 adds the developer's OWN typed
    /// turn as a fourth caller. Task 2 widens this beyond "send it to the child" alone: every turn
    /// is now persisted to the session log (via [`persist_event_line`], against this handle's own
    /// `writers` map) and emitted on the `agent:event` channel — in that order, persist before
    /// emit, matching this module's "the persisted log is ground truth" discipline (PITFALLS.md
    /// pitfall 10) — BEFORE the sidecar request below is ever sent. A persist failure must never
    /// block delivery: it is logged and this function proceeds regardless, exactly how the shared
    /// reader loop's own `persist_event_line` caller treats a non-`Written` outcome — a value,
    /// never a panic and never an early return.
    ///
    /// Still fire-and-forget toward the child process itself, mirroring
    /// [`Self::relay_permission_answer_direct`]'s own shape: no ack wait on the `authoring_turn`
    /// request below. Delivery FAILURE (a missing handle upstream, or `send_request` erroring) is
    /// what this function's `Err` return communicates to callers that choose to surface it (plan
    /// 05-12's `authoring_turn_send` command); the three system-generated relay call sites keep
    /// swallowing it with `let _ =`, unaffected by this widening.
    pub fn send_authoring_turn(
        &self,
        app: &AppHandle,
        run_id: &str,
        text: &str,
        origin: AuthoringTurnOrigin,
    ) -> anyhow::Result<()> {
        let turn_id = flywheel_core::ids::new_id();
        let at = chrono::Utc::now().to_rfc3339();
        let line = build_authoring_turn_line(run_id, text, origin, &turn_id, &at);

        let outcome = persist_event_line(&self.writers, run_id, &line);
        if outcome != PersistOutcome::Written {
            eprintln!(
                "session log persist failed for an authoring turn on run {run_id}: {outcome:?}"
            );
        }
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
            let _ = app.emit("agent:event", &event);
        }

        let request = serde_json::json!({
            "id": format!("authoring-turn-{}", flywheel_core::ids::new_id()),
            "op": "authoring_turn",
            "runId": run_id,
            "text": text,
        });
        self.send_request(&request.to_string())
    }

    /// Ask the sidecar to tear down every live session's process group, and wait a bounded
    /// moment for its ack (CR-02, plan 02-14). This must be called BEFORE [`Self::kill`] on app
    /// exit: every `claude` session is spawned `detached: true`
    /// (`packages/sidecar/src/claude-code-adapter.ts`) precisely so it becomes its own
    /// process-group leader, independent of the sidecar's own group — killing the sidecar
    /// (`kill`, below) reaches none of them, so this call is the ONLY thing that still can.
    /// Structurally mirrors [`Self::capability_probe`]: generates its own request id, registers a
    /// `pending_acks` entry, sends the request, and blocks on `recv_timeout`. On a send failure or
    /// a timeout, the stale `pending_acks` entry is removed exactly as `interrupt_run` and
    /// `capability_probe` do, so a late ack can never resurrect it — and either way this returns
    /// an `Err` rather than panicking or hanging, so app exit can always proceed to `kill()`
    /// regardless of the outcome.
    pub fn shutdown_all_sessions(&self) -> anyhow::Result<usize> {
        let request_id = format!("shutdown-{}", flywheel_core::ids::new_id());
        let (tx, rx) = std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
        {
            let mut pending = self
                .pending_acks
                .lock()
                .map_err(|_| anyhow::anyhow!("sidecar pending-acks mutex poisoned"))?;
            pending.insert(request_id.clone(), tx);
        }

        let request = serde_json::json!({ "id": request_id, "op": "shutdown" });
        if let Err(err) = self.send_request(&request.to_string()) {
            if let Ok(mut pending) = self.pending_acks.lock() {
                pending.remove(&request_id);
            }
            return Err(err);
        }

        match rx.recv_timeout(SHUTDOWN_ACK_TIMEOUT) {
            Ok(Ok(data)) => Ok(data.get("killed").and_then(|v| v.as_u64()).unwrap_or(0) as usize),
            Ok(Err(err)) => Err(anyhow::anyhow!("sidecar shutdown request failed: {err}")),
            Err(_) => {
                if let Ok(mut pending) = self.pending_acks.lock() {
                    pending.remove(&request_id);
                }
                Err(anyhow::anyhow!(
                    "sidecar did not acknowledge the shutdown request within {SHUTDOWN_ACK_TIMEOUT:?}"
                ))
            }
        }
    }

    /// Kill the sidecar's own process — a single `tauri-plugin-shell` `CommandChild::kill()`
    /// signal to that ONE process. This does NOT reach any child session: every `claude` session
    /// is spawned `detached: true` (`packages/sidecar/src/claude-code-adapter.ts`) precisely so it
    /// becomes its own process-group leader, independent of the sidecar's own group (CR-02).
    /// Reaching the sessions is [`Self::shutdown_all_sessions`]'s job, and it MUST be called first
    /// — killing the sidecar before the sessions would remove the only thing left that can still
    /// signal them. Called on app exit, after `shutdown_all_sessions`, so no orphaned sidecar
    /// process survives Flywheel closing.
    pub fn kill(&self) {
        self.heartbeat_stop
            .store(true, std::sync::atomic::Ordering::Relaxed);
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

/// Whether `run_id` has the shape of a real run id — delegates entirely to
/// `flywheel_core::ids::is_ulid`, the single shared shape predicate this workspace defines. This
/// function must never re-implement that shape itself: `session_log_path` (`packages/core/src/
/// session_log.rs`) is the fail-closed join site guarded by the SAME predicate, so the
/// sidecar-stdout boundary this function guards and the renderer-facing IPC boundary can never
/// drift into disagreeing about what a valid run id is (plan 03-15). This is the guard that stops
/// a `runId` read off an untrusted sidecar stdout line from ever being joined into a filesystem
/// path unchecked (T-02G-12-01) — called before [`SessionLogWriter::open`] / `session_log_path` on
/// every path through [`persist_event_line`].
///
/// Delegating to `is_ulid` TIGHTENS this check versus the previous hand-rolled "26 ASCII
/// alphanumeric characters" test: Crockford base32 excludes I, L, O and U, which the old test
/// accepted. This is safe because every run id in this codebase is minted by
/// `flywheel_core::ids::new_id()`, which only ever produces genuine Crockford-base32 ULIDs.
pub(crate) fn is_plausible_run_id(run_id: &str) -> bool {
    flywheel_core::ids::is_ulid(run_id)
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
            return PersistOutcome::OpenFailed(format!(
                "session log writers mutex poisoned: {poisoned}"
            ))
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
        None => PersistOutcome::OpenFailed(
            "session log writer unexpectedly absent after insert".to_string(),
        ),
    }
}

/// Distinguishes a turn the developer typed (via the composer, plan 05-12 Task 1) from one the
/// application generated on the conversation's own behalf (a proposal-decision relay, or the
/// distillation instruction `authoring_stage_advance` sends) — carried on every turn line
/// [`build_authoring_turn_line`] builds, so the transcript (and any future consumer) can tell the
/// two apart, even though today both render through the SAME `developer_turn` feed row (Task 2's
/// own "attributed to the right speaker" requirement: from the model's perspective — and the
/// transcript's — all three are the human side of the conversation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoringTurnOrigin {
    Developer,
    Application,
}

impl AuthoringTurnOrigin {
    fn as_str(self) -> &'static str {
        match self {
            AuthoringTurnOrigin::Developer => "developer",
            AuthoringTurnOrigin::Application => "application",
        }
    }
}

/// Build one `developer_turn` transcript line (Task 2, plan 05-12) — the record
/// [`SidecarHandle::send_authoring_turn`] persists and emits for every turn the application sends
/// into a live authoring session, independent of whether the sidecar delivery beneath it succeeds.
/// Deterministic and unit-testable with no clock and no id source: `turn_id` and `at` are both
/// parameters rather than generated inside, mirroring [`persist_event_line`]'s own "take only what
/// it needs" discipline. `raw` carries the SAME text as `text` — both the raw view and the
/// malformed-line fallback then have something real to show.
pub(crate) fn build_authoring_turn_line(
    run_id: &str,
    text: &str,
    origin: AuthoringTurnOrigin,
    turn_id: &str,
    at: &str,
) -> String {
    serde_json::json!({
        "type": "developer_turn",
        "runId": run_id,
        "at": at,
        "text": text,
        "raw": text,
        "origin": origin.as_str(),
        "turnId": turn_id,
    })
    .to_string()
}

/// Make a skipped persist observable to the user (CR-03, PROC-07's own prohibition that the live
/// feed never silently drops agent output) — emits a synthetic `system_notice` on the existing
/// `agent:event` channel, mirroring the sidecar's own `SystemNoticeEvent` shape (`packages/
/// sidecar/src/adapter.ts`) exactly so the renderer needs no new event type. `detail` must carry
/// the OS error KIND text only — this
/// function never interpolates the resolved log path, the app-data directory, or any environment
/// value into `text` or `raw` (T-02G-12-03: those are Rust-core-internal facts, not something to
/// hand to the renderer).
fn emit_persistence_failure_notice(app: &AppHandle, run_id: &str, detail: &str) {
    let text = format!(
        "Flywheel could not write this session's log ({detail}) — the transcript below may be incomplete."
    );
    let payload = serde_json::json!({
        "runId": run_id,
        "seq": -1,
        "at": chrono::Utc::now().to_rfc3339(),
        "raw": text.clone(),
        "type": "system_notice",
        "text": text,
        "flywheelPersistenceFailure": true,
    });
    let _ = app.emit("agent:event", &payload);
}

/// D-53 (plan 03-13): apply one `git_lock_exhausted` notice event to the database — resolves the
/// seeded SYSTEM actor server-side (`flywheel_core::domain::actor::system_actor`, per
/// `03-UI-SPEC.md`'s "Git lock-exhaustion entry") and calls
/// `flywheel_core::domain::agent_run::record_lock_exhaustion`. Mirrors `persist_event_line`'s own
/// discipline: a failure here is a logged value, never a panic and never an early return that
/// abandons the shared reader loop (CR-03) — one run's failed exhaustion write can never silence
/// every other run's feed.
fn handle_inbound_git_lock_exhausted(app: &AppHandle, event: &serde_json::Value) {
    let (Some(run_id), Some(repository), Some(command), Some(attempts)) = (
        event.get("runId").and_then(|v| v.as_str()),
        event.get("repository").and_then(|v| v.as_str()),
        event.get("command").and_then(|v| v.as_str()),
        event.get("attempts").and_then(|v| v.as_u64()),
    ) else {
        return;
    };

    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        return;
    };

    let result = flywheel_core::domain::actor::system_actor(&conn)
        .context("failed to resolve the seeded system actor")
        .and_then(|actor| {
            flywheel_core::domain::agent_run::record_lock_exhaustion(
                &mut conn,
                run_id,
                repository,
                command,
                attempts as u32,
                &actor.id,
            )
        });
    drop(conn);

    match result {
        Ok(()) => {
            let _ = app.emit(
                "board:changed",
                serde_json::json!({ "entity": "agent_run", "id": run_id }),
            );
        }
        Err(err) => {
            eprintln!("failed to record a git lock exhaustion for run {run_id}: {err:#}");
        }
    }
}

/// CR-03's exact failure mode, as falsifiable tests: force `SessionLogWriter::open` to fail for
/// one run and prove — by bytes on disk, not just the return value — that another run's events
/// keep flowing. Follows `packages/core/tests/session_log_window.rs`'s own precedent of writing
/// through `session_log_path` against the real OS app-data directory with a fresh ULID-shaped run
/// id per test, removing each test's own files/directories afterward. No test here constructs a
/// `SidecarHandle`, spawns a process, or requires a Tauri `AppHandle` — `persist_event_line`
/// takes only `&Mutex<HashMap<String, SessionLogWriter>>`, so none of that is needed.
#[cfg(test)]
mod persist_tests {
    use super::*;

    /// A fresh ULID-shaped run id this test owns exclusively.
    fn fresh_run_id() -> String {
        flywheel_core::ids::new_id()
    }

    /// Force `SessionLogWriter::open` to fail for `run_id`, portably (macOS, Linux and Windows
    /// alike): create a DIRECTORY at the log path itself, so an append-mode file open against it
    /// fails — without touching permissions or filling a disk. Returns the obstructed path so the
    /// caller can remove it.
    fn obstruct_log_path(run_id: &str) -> std::path::PathBuf {
        let path = flywheel_core::session_log::session_log_path(run_id)
            .expect("session_log_path should resolve for a fresh run id");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create the sessions directory");
        }
        std::fs::create_dir_all(&path).expect("failed to obstruct the log path with a directory");
        path
    }

    #[test]
    fn one_runs_unopenable_log_never_stops_another_runs_events() {
        let writers: Mutex<HashMap<String, SessionLogWriter>> = Mutex::new(HashMap::new());
        let run_a = fresh_run_id();
        let run_b = fresh_run_id();
        let obstruction = obstruct_log_path(&run_a);

        // Run A's log can never be opened — it returns a value, never a panic.
        assert!(matches!(
            persist_event_line(&writers, &run_a, "{\"seq\":0}"),
            PersistOutcome::OpenFailed(_)
        ));

        // A healthy second run, in the SAME call sequence, is completely unaffected.
        let line_b0 = "{\"seq\":0}";
        assert_eq!(
            persist_event_line(&writers, &run_b, line_b0),
            PersistOutcome::Written
        );
        assert_eq!(
            flywheel_core::session_log::count_lines(&run_b).expect("count_lines should succeed"),
            1,
            "run B's first line must be persisted despite run A's failure"
        );
        let path_b = flywheel_core::session_log::session_log_path(&run_b)
            .expect("session_log_path should resolve for run B");
        let content_b = std::fs::read_to_string(&path_b).expect("failed to read run B's log file");
        assert_eq!(
            content_b,
            format!("{line_b0}\n"),
            "run B's file must contain the exact line text"
        );

        // Run A's failure REPEATS — still OpenFailed — and run B keeps flowing regardless.
        assert!(matches!(
            persist_event_line(&writers, &run_a, "{\"seq\":1}"),
            PersistOutcome::OpenFailed(_)
        ));
        let line_b1 = "{\"seq\":1}";
        assert_eq!(
            persist_event_line(&writers, &run_b, line_b1),
            PersistOutcome::Written
        );
        assert_eq!(
            flywheel_core::session_log::count_lines(&run_b).expect("count_lines should succeed"),
            2,
            "run B's second line must be persisted despite run A's REPEATED failure"
        );

        let _ = std::fs::remove_dir_all(&obstruction);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn a_failed_open_is_retried_on_the_next_event_rather_than_cached() {
        let writers: Mutex<HashMap<String, SessionLogWriter>> = Mutex::new(HashMap::new());
        let run_id = fresh_run_id();
        let obstruction = obstruct_log_path(&run_id);

        assert!(matches!(
            persist_event_line(&writers, &run_id, "{\"seq\":0}"),
            PersistOutcome::OpenFailed(_)
        ));

        // The obstruction is removed — nothing about the FIRST failure was cached in `writers`,
        // so the very next call for the SAME run id must retry the open and succeed.
        std::fs::remove_dir_all(&obstruction).expect("failed to remove the obstruction");

        assert_eq!(
            persist_event_line(&writers, &run_id, "{\"seq\":1}"),
            PersistOutcome::Written
        );
        assert_eq!(
            flywheel_core::session_log::count_lines(&run_id).expect("count_lines should succeed"),
            1
        );

        let path = flywheel_core::session_log::session_log_path(&run_id)
            .expect("session_log_path should resolve for a fresh run id");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_run_id_that_is_not_a_plausible_ulid_is_rejected_before_any_path_is_built() {
        let writers: Mutex<HashMap<String, SessionLogWriter>> = Mutex::new(HashMap::new());

        // 26 characters (the required length) but with a path separator in it.
        let separator_id = format!("{}/", "a".repeat(25));
        // A plausible-looking but one-character-short id.
        let short_id = "a".repeat(25);
        // A traversal-shaped id — the exact attack shape this guard exists to stop.
        let traversal_id = "../../../etc/passwd";
        let candidates = [separator_id.as_str(), short_id.as_str(), "", traversal_id];

        for run_id in candidates {
            assert_eq!(
                persist_event_line(&writers, run_id, "{}"),
                PersistOutcome::RejectedRunId,
                "run id {run_id:?} should be rejected before any path is built"
            );
            // Rejection now happens inside `session_log_path` itself, before `sessions_dir()` is
            // ever resolved — so the call must return `Err`, not merely "a path that doesn't
            // exist yet". This is the property this task's guard delivers: the path was never
            // even CONSTRUCTIBLE for a rejected id, not just unpopulated.
            assert!(
                flywheel_core::session_log::session_log_path(run_id).is_err(),
                "session_log_path must refuse to build a path for a rejected run id {run_id:?}"
            );
        }
    }

    /// [`build_authoring_turn_line`]'s own behavior (Task 2, plan 05-12) — a pure function, no
    /// `SidecarHandle`, no Tauri handle, nothing but the arguments it takes.
    #[test]
    fn authoring_turn_line_carries_type_run_id_text_and_origin() {
        let line = build_authoring_turn_line(
            "run-a",
            "hello there",
            AuthoringTurnOrigin::Developer,
            "turn-1",
            "2026-01-01T00:00:00Z",
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&line).expect("the builder must produce valid JSON");
        assert_eq!(parsed["type"], "developer_turn");
        assert_eq!(parsed["runId"], "run-a");
        assert_eq!(parsed["text"], "hello there");
        assert_eq!(parsed["raw"], "hello there");
        assert_eq!(parsed["origin"], "developer");
        assert_eq!(parsed["turnId"], "turn-1");
    }

    #[test]
    fn two_builder_calls_with_different_turn_ids_never_collide_on_one_feed_key() {
        let line_a = build_authoring_turn_line(
            "run-a",
            "same text",
            AuthoringTurnOrigin::Application,
            "turn-a",
            "2026-01-01T00:00:00Z",
        );
        let line_b = build_authoring_turn_line(
            "run-a",
            "same text",
            AuthoringTurnOrigin::Application,
            "turn-b",
            "2026-01-01T00:00:00Z",
        );
        assert_ne!(
            line_a, line_b,
            "two turns with different turn ids must never produce identical lines"
        );
    }
}

/// [`push_bounded_stderr_tail`]'s own behavior cases (plan 03-15, T-03-15-04): a `String::truncate`
/// at a non-boundary byte index panics, and this frame runs inside `tauri::async_runtime::block_on`
/// in `main.rs`'s `.setup()` closure, which cannot unwind, under a `panic = "abort"` release
/// profile — so a panicking truncation here would kill the app before a window is ever shown.
#[cfg(test)]
mod stderr_tail_tests {
    use super::*;

    #[test]
    fn stderr_tail_appending_bytes_whose_decoded_form_crosses_the_cap_keeps_at_most_the_cap_and_never_panics()
    {
        let mut tail = String::new();
        push_bounded_stderr_tail(&mut tail, b"0123456789ABCDEF", 10);
        assert!(tail.len() <= 10, "tail must never exceed the cap, got {} bytes", tail.len());
    }

    #[test]
    fn stderr_tail_multi_byte_characters_overrunning_the_cap_stay_valid_utf8_with_no_partial_char() {
        let mut tail = String::new();
        // "é" is 2 bytes in UTF-8 — ten of them (20 bytes) comfortably overrun a 10-byte cap.
        let multi_byte_line: String = std::iter::repeat_n('é', 10).collect();
        push_bounded_stderr_tail(&mut tail, multi_byte_line.as_bytes(), 10);
        assert!(tail.len() <= 10, "tail must never exceed the cap, got {} bytes", tail.len());
        // `tail` is a `String` — if the cut had landed mid-character, this line is unreachable:
        // `push_bounded_stderr_tail` would have already panicked before returning.
        assert!(std::str::from_utf8(tail.as_bytes()).is_ok());
    }

    #[test]
    fn stderr_tail_invalid_utf8_positioned_to_straddle_the_cap_never_panics() {
        let mut tail = String::new();
        // Three lone continuation bytes (0x80) are each invalid UTF-8 on their own;
        // `from_utf8_lossy` renders each as its own 3-byte U+FFFD replacement character — 9 bytes
        // total, straddling a 4-byte cap right through the middle of a replacement character.
        let invalid_utf8: [u8; 3] = [0x80, 0x80, 0x80];
        push_bounded_stderr_tail(&mut tail, &invalid_utf8, 4);
        assert!(tail.len() <= 4, "tail must never exceed the cap, got {} bytes", tail.len());
    }

    #[test]
    fn stderr_tail_a_short_ascii_line_is_left_intact_with_a_trailing_newline() {
        let mut tail = String::new();
        push_bounded_stderr_tail(&mut tail, b"hello", READINESS_STDERR_TAIL_CAP);
        assert_eq!(tail, "hello\n");
    }

    #[test]
    fn stderr_tail_once_at_the_cap_further_appends_leave_it_unchanged() {
        let mut tail = "a".repeat(10);
        let before = tail.clone();
        push_bounded_stderr_tail(&mut tail, b"more text that should never be appended", 10);
        assert_eq!(tail, before, "once the tail has reached the cap, further appends must be no-ops");
    }
}

/// Spawn the bundled `flywheel-sidecar` binary, prove it is alive and speaking its own protocol
/// via a bounded readiness handshake (G-02-1), and start its stdout/stderr/lifecycle reader task.
/// Follows this codebase's expect-or-crash-loudly-at-startup idiom (`main.rs`'s `.setup()`
/// closure) — a failure to resolve, spawn, OR ANSWER READY aborts startup rather than proceeding
/// with a half-working app. See this module's own doc comment for the full contract.
pub fn spawn_sidecar(app: &AppHandle) -> anyhow::Result<SidecarHandle> {
    let sidecar_command = app
        .shell()
        .sidecar("flywheel-sidecar")
        .context("failed to resolve the flywheel-sidecar binary")?;
    let (mut rx, mut child) = sidecar_command
        .spawn()
        .context("failed to spawn the flywheel-sidecar process")?;

    // Readiness handshake (G-02-1): write the cheapest possible liveness question to the child's
    // stdin, then drive a bounded wait over the SAME receiver the reader task will later own,
    // BEFORE that receiver is ever moved into the reader task. `main.rs`'s `.setup()` closure runs
    // before `app.manage(AppState { .. })`, so the reader task's existing `pending_acks` mechanism
    // (which reads `AppState` back off the `AppHandle`) is not available yet — this handshake
    // reads the spawn receiver directly instead.
    let ready_request = serde_json::json!({ "id": READINESS_REQUEST_ID, "op": "ping" });
    let mut ready_line = ready_request.to_string();
    ready_line.push('\n');
    child
        .write(ready_line.as_bytes())
        .context("the sidecar's stdin was not writable at spawn time")?;

    // The timeout future MUST be constructed INSIDE the runtime context, never passed in as an
    // already-built argument (G-02-5). `tokio::time::timeout` builds its `Sleep` eagerly at
    // CONSTRUCTION time, and `Sleep` registers with the runtime's timer driver through
    // thread-local state the moment it is created. Call arguments are evaluated BEFORE
    // `block_on` enters the runtime, so building it outside panicked with "there is no reactor
    // running, must be called from the context of a Tokio 1.x runtime". That panic fired inside
    // `main.rs`'s `.setup()` closure — which runs on the main thread during
    // `did_finish_launching`, outside any runtime, in a frame that CANNOT UNWIND — so it aborted
    // the process before a window was ever shown, rather than surfacing as the startup error this
    // function returns.
    let handshake_result = tauri::async_runtime::block_on(async {
        tokio::time::timeout(STARTUP_READINESS_TIMEOUT, async {
            let mut stderr_tail = String::new();
            loop {
                match rx.recv().await {
                    Some(CommandEvent::Stdout(line_bytes)) => {
                        let line = String::from_utf8_lossy(&line_bytes).into_owned();
                        let parsed: Result<SidecarStdoutLine, _> =
                            serde_json::from_str(line.trim());
                        // ANY ack carrying the readiness request's own id ends the wait
                        // successfully, regardless of its `ok` field — it proves a live process
                        // reading stdin and writing its own protocol on stdout, which is the
                        // whole question being asked. Anything else (an unrelated line, a
                        // malformed line) is skipped; the handshake only ever looks for its own id.
                        if let Ok(SidecarStdoutLine::Ack { id, .. }) = parsed {
                            if id == READINESS_REQUEST_ID {
                                return Ok(());
                            }
                        }
                    }
                    Some(CommandEvent::Stderr(bytes)) => {
                        // See `push_bounded_stderr_tail`'s own doc comment (plan 03-15,
                        // T-03-15-04): this frame cannot unwind and the release profile aborts
                        // on panic, so the cut MUST land on a UTF-8 character boundary.
                        push_bounded_stderr_tail(&mut stderr_tail, &bytes, READINESS_STDERR_TAIL_CAP);
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        return Err(anyhow::anyhow!(
                            "the flywheel-sidecar process exited before answering the readiness handshake (exit code {:?}, signal {:?}); stderr: {}",
                            payload.code,
                            payload.signal,
                            stderr_tail
                        ));
                    }
                    Some(CommandEvent::Error(err)) => {
                        return Err(anyhow::anyhow!(
                            "the flywheel-sidecar process reported an error before answering the readiness handshake: {err}"
                        ));
                    }
                    Some(_) => {
                        // Catch-all: `CommandEvent` is `#[non_exhaustive]` — a future variant
                        // must not fail this build. Skip it and keep waiting.
                    }
                    None => {
                        return Err(anyhow::anyhow!(
                            "the flywheel-sidecar's event stream closed before it answered the readiness handshake; stderr: {}",
                            stderr_tail
                        ));
                    }
                }
            }
        })
        .await
    });

    match handshake_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => return Err(err),
        Err(_elapsed) => {
            return Err(anyhow::anyhow!(
                "the flywheel-sidecar did not answer the readiness handshake within {STARTUP_READINESS_TIMEOUT:?}"
            ));
        }
    }

    // D-47 (plan 03-02): touch the heartbeat file on a fixed interval for as long as Flywheel is
    // alive, so every live session's watchdog (`packages/sidecar/src/watchdog.ts`) has evidence
    // the supervisor is still around. Started here, AFTER the readiness handshake succeeds, and
    // stopped from `SidecarHandle::kill` on a clean exit — deliberately a plain `std::thread`,
    // not a tokio task, so it keeps running even if the async runtime that drives the reader task
    // below were ever torn down independently. A write failure is logged at most once per
    // distinct message (mirroring `notified_persist_failures`'s own once-per-key discipline
    // below) rather than spamming stderr on every tick; it can NEVER panic or stop the loop
    // (CR-03) — a single missed heartbeat write is not fatal, the next tick tries again.
    let heartbeat_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let stop_flag = heartbeat_stop.clone();
        std::thread::spawn(move || {
            let mut last_failure_message: Option<String> = None;
            while !stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                if let flywheel_core::runtime_protocol::RuntimeIo::WriteFailed(message) =
                    flywheel_core::runtime_protocol::touch_heartbeat()
                {
                    if last_failure_message.as_deref() != Some(message.as_str()) {
                        eprintln!("flywheel heartbeat write failed: {message}");
                        last_failure_message = Some(message);
                    }
                } else {
                    last_failure_message = None;
                }
                std::thread::sleep(std::time::Duration::from_millis(
                    flywheel_core::runtime_protocol::HEARTBEAT_INTERVAL_MS,
                ));
            }
        });
    }

    let handle = SidecarHandle {
        child: Mutex::new(Some(child)),
        writers: Mutex::new(HashMap::new()),
        pending_acks: Mutex::new(HashMap::new()),
        pending_permission_requests: Mutex::new(HashMap::new()),
        notified_persist_failures: Mutex::new(std::collections::HashSet::new()),
        heartbeat_stop,
        spawn_floor: flywheel_core::git_retry::SpawnFloor::new(),
    };

    let app_for_reader = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    // Developer breadcrumb only — never surfaced to the renderer. Mid-session
                    // sidecar stderr is out of this plan's scope beyond keeping the pipe drained
                    // (T-02G-15-04); the startup case is already handled by the handshake above.
                    eprintln!(
                        "flywheel-sidecar stderr: {}",
                        String::from_utf8_lossy(&bytes)
                    );
                }
                CommandEvent::Terminated(payload) => {
                    // A sidecar that dies mid-session is now observable instead of silent
                    // (G-02-1's secondary cause) — but reconciling any `agent_runs` rows it was
                    // driving is explicitly out of scope here (see plan 02-15's "Adjacent Open
                    // Items"; 02-18 owns that). Nothing further can arrive on this receiver once
                    // its process is gone, so the loop ends.
                    eprintln!(
                        "flywheel-sidecar process terminated (exit code {:?}, signal {:?})",
                        payload.code, payload.signal
                    );
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("flywheel-sidecar process error: {err}");
                }
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes).into_owned();
                    let parsed: Result<SidecarStdoutLine, _> = serde_json::from_str(line.trim());

                    match parsed {
                        Ok(SidecarStdoutLine::Event { event }) => {
                            let run_id = event
                                .get("runId")
                                .and_then(|v| v.as_str())
                                .map(str::to_string);
                            let event_line = event.to_string();

                            if let Some(run_id) = run_id {
                                if let Some(state) =
                                    app_for_reader.try_state::<crate::state::AppState>()
                                {
                                    if let Some(sidecar) = state.sidecar.as_ref() {
                                        // The persistent write happens FIRST, unconditionally — the
                                        // emit below is a best-effort live view, never the source of
                                        // truth (PITFALLS.md pitfall 10). No outcome here — Written or
                                        // otherwise — can ever stop this loop (CR-03): a per-run fault
                                        // is a value `persist_event_line` returns, never a panic.
                                        let outcome = persist_event_line(
                                            &sidecar.writers,
                                            &run_id,
                                            &event_line,
                                        );
                                        if outcome != PersistOutcome::Written {
                                            // The user-facing guarantee is the emitted notice below,
                                            // not this line — stderr is suppressed on a release
                                            // Windows build (this module's own doc comment).
                                            eprintln!(
                                            "session log persist failed for run {run_id}: {outcome:?}"
                                        );
                                            let already_notified = {
                                                match sidecar.notified_persist_failures.lock() {
                                                    Ok(mut notified) => {
                                                        !notified.insert(run_id.clone())
                                                    }
                                                    Err(_) => true, // poisoned — never spam a notice
                                                }
                                            };
                                            if !already_notified {
                                                // A fixed, outcome-shaped phrase only — NEVER the
                                                // `PersistOutcome`'s own stored string, which (via
                                                // `SessionLogWriter::open`'s anyhow context) embeds
                                                // the resolved session-log path. Passing that path to
                                                // the renderer would be exactly the app-data-directory
                                                // disclosure T-02G-12-03 forbids; the full detail
                                                // stays in the `eprintln!` breadcrumb above, which
                                                // never crosses the IPC boundary.
                                                let detail = match &outcome {
                                                    PersistOutcome::RejectedRunId => {
                                                        "an invalid run id"
                                                    }
                                                    PersistOutcome::OpenFailed(_) => {
                                                        "the log file could not be opened"
                                                    }
                                                    PersistOutcome::AppendFailed(_) => {
                                                        "the log file could not be written to"
                                                    }
                                                    // Guarded by the `outcome != Written` check above —
                                                    // never actually reached, but a plain fallback
                                                    // value rather than a panicking call (this loop's
                                                    // own invariant: no per-run fault may ever unwind
                                                    // it, and neither may a defensive branch here).
                                                    PersistOutcome::Written => {
                                                        "an unknown condition"
                                                    }
                                                };
                                                emit_persistence_failure_notice(
                                                    &app_for_reader,
                                                    &run_id,
                                                    detail,
                                                );
                                            }
                                        }
                                    }
                                }
                            }

                            let _ = app_for_reader.emit("agent:event", &event);

                            // AGNT-06 inbound half: a permission_request event on this SAME reader
                            // loop, handled BEFORE any pending row exists — the rule short-circuit
                            // (T-02-24) checks first, so a matching allow-always rule never creates a
                            // board-visible pending request or blocks the run.
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("permission_request")
                            {
                                crate::commands::agent_run::handle_inbound_permission_request(
                                    &app_for_reader,
                                    &event,
                                );
                            }

                            // G-02-4: the terminal-event consumer the sidecar's `session_closed`
                            // event never had. Without this call site, a run that ends on its own
                            // — completed or failed — stays `running` on the board forever, with
                            // no end time, no cost and no token counts; only the explicit Stop path
                            // ever wrote a terminal status. Sits AFTER both the persist call above
                            // and the renderer emit directly above, so a fault in this database
                            // write can never delay or suppress the live event the user is
                            // watching.
                            if event.get("type").and_then(|v| v.as_str()) == Some("session_closed")
                            {
                                crate::commands::agent_run::handle_inbound_session_closed(
                                    &app_for_reader,
                                    &event,
                                );
                            }

                            // D-53 (plan 03-13): the shim's exhaustion notice already reached the
                            // renderer via the `agent:event` emit above (Task 2's FeedRow.tsx
                            // renders nothing for it, by design — the notice is a feed event only,
                            // never a database write). This branch is what makes an exhausted
                            // retry budget a durable, human-rendered Activity Trail entry.
                            //
                            // Deliberately NO branch exists here for the shim's OTHER notice kind
                            // (the "still retrying" one) — writing a row per individual collision
                            // is exactly the noise D-53 rejects; only exhaustion is ever
                            // persisted.
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("git_lock_exhausted")
                            {
                                handle_inbound_git_lock_exhausted(&app_for_reader, &event);
                            }

                            // D-64/D-65 (plan 04-06): the agent's own `report_summary` tool call,
                            // relayed here as a `summary_reported` event. Sits AFTER both the
                            // `agent:event` emit and the `session_closed` branch above, for the
                            // same reason `session_closed`'s own branch sits there: a fault in
                            // this database write can never delay or suppress the live event the
                            // developer is watching (T-04-06).
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("summary_reported")
                            {
                                crate::commands::agent_run::handle_inbound_summary_reported(
                                    &app_for_reader,
                                    &event,
                                );
                            }

                            // D-80/D-81 (plan 05-02): the agent's own `propose_task` tool call,
                            // relayed here as a `proposal_created` event. Placed AFTER both the
                            // `agent:event` emit and the `session_closed` branch above, for the
                            // same reason `summary_reported`'s own branch sits there: a fault in
                            // this database write can never delay or suppress the live event the
                            // developer is watching.
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("proposal_created")
                            {
                                crate::commands::authoring::handle_inbound_proposal_created(
                                    &app_for_reader,
                                    &event,
                                );
                            }

                            // D-87 (plan 05-05): a HELD board_read call — resolved by relaying an
                            // authoring_read_answer request back to the sidecar's own stdin
                            // (never here, never blocking this loop). Placed AFTER the
                            // `agent:event` emit for the same reason every other inbound branch
                            // sits there: a fault in the query it runs can never delay or
                            // suppress the live event the developer is watching.
                            if event.get("type").and_then(|v| v.as_str())
                                == Some("board_read_request")
                            {
                                crate::commands::authoring::handle_inbound_board_read_request(
                                    &app_for_reader,
                                    &event,
                                );
                            }
                        }
                        Ok(SidecarStdoutLine::Ack {
                            id,
                            ok,
                            error,
                            data,
                        }) => {
                            if let Some(state) =
                                app_for_reader.try_state::<crate::state::AppState>()
                            {
                                if let Some(sidecar) = state.sidecar.as_ref() {
                                    if let Ok(mut pending) = sidecar.pending_acks.lock() {
                                        if let Some(sender) = pending.remove(&id) {
                                            let result = if ok {
                                                Ok(data.unwrap_or(serde_json::Value::Null))
                                            } else {
                                                Err(error.unwrap_or_else(|| {
                                                    "sidecar request failed".to_string()
                                                }))
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
                _ => {
                    // Catch-all: `CommandEvent` is `#[non_exhaustive]` — a future variant must
                    // not break this build.
                }
            }
        }
    });

    Ok(handle)
}
