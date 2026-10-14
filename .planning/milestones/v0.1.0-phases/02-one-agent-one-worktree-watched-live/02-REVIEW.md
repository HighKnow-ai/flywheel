---
phase: 02-one-agent-one-worktree-watched-live
reviewed: 2026-09-11T05:31:11Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/core/src/domain/task.rs
  - packages/core/src/session_log.rs
  - packages/core/tests/app_exit_ordering.rs
  - packages/core/tests/task_delete_with_run_history.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/task.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/test/shutdown.test.mjs
findings:
  critical: 1
  warning: 1
  info: 1
  total: 3
status: issues_found
---

# Phase 02: Code Review Report (gap-closure round)

**Reviewed:** 2026-09-11T05:31:11Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

This is a re-review of the incremental scope from plans `02-11`..`02-14`, which set out to close
the four Criticals (`CR-01`..`CR-04`) and one Warning (`WR-01`) the prior review found. Three of
the four Criticals, and the Warning, are genuinely and verifiably closed — I could not reopen them:

- **CR-01 (task deletion FK regression):** closed. `delete_task` now runs four bound `COUNT(*)`
  probes inside its transaction and `anyhow::bail!`s with a human sentence naming the blocking
  count before ever reaching `DELETE FROM tasks`, so SQLite's raw constraint error is structurally
  unreachable. `task_delete_with_run_history.rs` proves the block for a task with agent-run
  history, proves an unblocked delete still works for a task with none, and proves no `FOREIGN
  KEY` substring ever reaches the caller either way.
- **CR-02 (orphaned `claude` processes on app exit):** closed, and unusually well-proven.
  `shutdown_all_sessions` is called before `kill()` (enforced by a source-scanning gate,
  `app_exit_ordering.rs`, that also proves the gate is falsifiable against a reordered/missing/
  commented-out fixture), it only ever signals process groups the sidecar's own `liveSessions` map
  already tracks (never a pid taken off the wire), and `shutdown.test.mjs` drives the real compiled
  sidecar binary as a child process and proves real OS-level grandchild processes are gone via
  `process.kill(pid, 0)` throwing `ESRCH` — the strongest kind of evidence for this class of claim.
- **CR-03 (one run's log-open panic killing the shared reader loop):** closed.
  `SessionLogWriter::open`'s failure is now routed through `persist_event_line` into a
  `PersistOutcome` value, never an `.expect()`; `is_plausible_run_id` rejects a malformed run id
  before any path is built; a failed open is retried (not cached) on the next event for the same
  run; the user-facing notice is a fixed, outcome-shaped phrase that never carries the resolved
  session-log path. `sidecar.rs`'s own `persist_tests` module proves run B's events keep flowing
  while run A's log stays permanently unopenable, and that a rejected run id never touches the
  filesystem at all.
- **WR-01 (unguarded initial SIGINT racing process exit):** closed — `interruptSession`'s SIGINT
  call is now wrapped in the identical `try { ... } catch { /* already exited */ }` shape the
  SIGTERM escalation already used.

**CR-04, however, is only half-closed.** The domain write itself is now genuinely
unreachable-proof — `stop_agent_run_recording_first` captures the interrupt outcome in a local and
always reaches the terminal DB write regardless — and this is well covered by both Rust unit tests
and the renderer's own `session-surface.test.tsx` suite. But the plan's refactor introduced a new
regression while fixing the old one: `agent_run_stop` now acquires the application's single shared
`Mutex<Connection>` *before* invoking the (up to 30-second-blocking) interrupt call, where the
pre-fix code acquired it *after*. The practical effect is that every other command in the
application — board reads, task creation, every other agent run's interactions — blocks for up to
30 seconds behind one Stop click against an unresponsive sidecar. This is exactly the scenario
CR-04 was written to make graceful, and the fix makes it worse in a different dimension: instead of
one run's board tile disagreeing with reality, the entire app freezes for the same window. See
CR-01 (fresh numbering) below.

## Critical Issues

### CR-01: `agent_run_stop` holds the application's single DB mutex for up to 30 seconds while waiting on an unresponsive sidecar — freezing every other command, not just this run's

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:315-341` (the lock), `:274-301`
(the blocking call it wraps), `packages/desktop/src-tauri/src/state.rs:16` (`pub db:
Mutex<Connection>`, the one connection every command handler locks).

**Issue:** `agent_run_stop` now does this:

```rust
pub fn agent_run_stop(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<AgentRunStopDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;   // <-- global lock acquired FIRST

    let sidecar = state.sidecar.as_ref();
    let run_id_for_interrupt = agent_run_id.clone();
    let interrupt = move || -> Result<(), String> {
        match sidecar {
            Some(sidecar) => sidecar.interrupt_run(&run_id_for_interrupt).map_err(|e| e.to_string()),
            None => Ok(()),
        }
    };

    let dto = stop_agent_run_recording_first(&mut conn, &agent_run_id, interrupt)?;
    drop(conn);
    ...
```

and `stop_agent_run_recording_first` calls the `interrupt` closure as its very first statement:

```rust
pub(crate) fn stop_agent_run_recording_first(
    conn: &mut Connection,
    agent_run_id: &str,
    interrupt: impl FnOnce() -> Result<(), String>,
) -> Result<AgentRunStopDto, String> {
    let interrupt_result = interrupt();   // <-- blocks up to INTERRUPT_ACK_TIMEOUT (30s), while `conn`'s MutexGuard is already held
    ...
```

`interrupt()` calls `SidecarHandle::interrupt_run`, which blocks on `rx.recv_timeout(INTERRUPT_ACK_TIMEOUT)` — 30 seconds — before giving up. `state.db` is a plain `std::sync::Mutex<Connection>` (`state.rs:16`), and it is the *only* connection in the process: every other `#[tauri::command]` in this codebase (`task.rs`, the rest of `agent_run.rs`, `board.rs`, `epic.rs`, `settings.rs`, …) opens with `state.db.lock()` before doing anything else. Tauri dispatches commands on a thread pool, so these are genuinely concurrent callers competing for the same OS mutex.

Net effect: the moment a user clicks Stop on a run whose sidecar is wedged, crashed, or simply slow to ack — precisely the failure mode CR-04 was written to make graceful — every other window of the app (the board, task creation, every other task's item detail panel, every other agent run's Stop/permission-answer button) hangs for up to 30 seconds, because they are all blocked acquiring `state.db.lock()` behind this one call. This is a strictly worse outcome for the exact scenario CR-04 targets: the previous (pre-fix) code called `interrupt_run` **before** acquiring the DB lock (see the prior review's own CR-04 quote: `sidecar.interrupt_run(&agent_run_id)...?; let mut conn = state.db.lock()...`), so a wedged sidecar only affected the one Stop call, not the whole app. The gap-closure refactor, in restructuring the function so the DB write is unconditional, moved the lock acquisition earlier than it needs to be.

None of the added tests catch this: `stop_agent_run_recording_first`'s own unit tests
(`agent_run.rs:1334-1395`) call it directly against a bare `Connection`, never through
`AppState`'s `Mutex`, so the lock-contention regression is invisible to them; the renderer's
`session-surface.test.tsx` mocks the Tauri command boundary entirely.

**Fix:** Call the interrupt request *before* acquiring the DB lock — the closure captures
`state.sidecar`, not `conn`, so nothing about it actually needs the lock held:

```rust
#[tauri::command]
pub fn agent_run_stop(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<AgentRunStopDto, String> {
    // Run the (potentially 30s-blocking) interrupt request BEFORE ever touching the shared DB
    // mutex, so a wedged sidecar only ever delays THIS command, never every other command in the
    // app racing on the same `Mutex<Connection>`.
    let interrupt_result = match state.sidecar.as_ref() {
        Some(sidecar) => sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string()),
        None => Ok(()),
    };

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let dto = record_stop_outcome(&mut conn, &agent_run_id, interrupt_result)?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": agent_run_id })).ok();
    Ok(dto)
}
```

with `stop_agent_run_recording_first` correspondingly changed to accept the already-resolved
`Result<(), String>` (or keep the closure shape but call it strictly before the lock is taken at
every call site, including the test helpers, so the shape itself cannot be misused this way again).

## Warnings

### WR-01: `delete_task`'s blocking-deletion message can read as self-contradictory when only `triggers`/`permission_requests` rows exist with zero `agent_runs`

**File:** `packages/core/src/domain/task.rs:277-290`

**Issue:** The message is built as:

```rust
let run_word = if agent_run_count == 1 { "run" } else { "runs" };
...
anyhow::bail!(
    "Cannot delete this task: it has {agent_run_count} recorded agent {run_word} \
     {worktree_clause}. ..."
);
```

This is gated on `trigger_count > 0 || worktree_count > 0 || agent_run_count > 0 ||
permission_request_count > 0` — any one of the four alone is enough to block the delete — but the
message always names `agent_run_count`. `start_agent_run` (`domain/agent_run.rs:89-127`) calls
`ensure_worktree` *before* opening its own transaction that inserts the `triggers` and
`agent_runs` rows together; if that transaction fails for any reason after the worktree already
committed (e.g. the task row disappearing between the two steps), a task could end up with
`worktree_count > 0` and `agent_run_count == 0`. In that state the user sees "Cannot delete this
task: it has 0 recorded agent runs and a worktree exists for it," which reads as contradictory
(the count says "nothing blocks you" while the sentence still refuses). No test in
`task_delete_with_run_history.rs` exercises this partial-history shape — both tests there create
either full history (trigger + worktree + agent_run + permission_request together) or none at all.

**Fix:** Either name whichever count is actually nonzero (worktree/trigger/permission count as a
fallback when `agent_run_count == 0`), or phrase the message in terms of "has been started" rather
than a specific number that can legitimately be zero while still blocking:

```rust
let reason = if agent_run_count > 0 {
    format!("it has {agent_run_count} recorded agent {run_word}")
} else if worktree_count > 0 {
    "a worktree has been created for it".to_string()
} else {
    "work has been started on it".to_string()
};
anyhow::bail!("Cannot delete this task: {reason}. ...");
```

## Info

### IN-01: `stop_agent_run_recording_first` surfaces a generic `rusqlite` "no rows" error for an `agent_run_id` the caller invented

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:274-301`

**Issue:** `interrupt_agent_run` treats an unknown `agent_run_id` as a silent no-op (`domain/
agent_run.rs:310-313`: `existing` is `None` → commit and return `Ok(())`). `stop_agent_run_
recording_first` then unconditionally runs `SELECT status FROM agent_runs WHERE id = ?1` and
propagates `rusqlite::Error::QueryReturnedNoRows`'s generic message ("Query returned no rows") to
the renderer via `.map_err(|e| e.to_string())?` — rather than a message naming the actual problem
("no such agent run"). Low practical impact (the renderer never invents an id itself), but it's an
easy, cheap improvement given the rest of this file's discipline around naming rejected values in
its error strings (`validate_permission_mode`, `validate_instruction`, `db_decision_for`).

**Fix:** Check for the row's existence explicitly and return a named error before running the
`status` read, mirroring `domain::task::update_task`'s `with_context(|| format!("task {task_id:?}
not found"))` idiom elsewhere in this codebase.

---

_Reviewed: 2026-09-11T05:31:11Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
