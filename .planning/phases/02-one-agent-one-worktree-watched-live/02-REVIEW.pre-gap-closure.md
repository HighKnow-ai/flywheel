---
phase: 02-one-agent-one-worktree-watched-live
reviewed: 2026-09-11T00:00:00Z
depth: standard
files_reviewed: 81
files_reviewed_list:
  - packages/core/src/branch.rs
  - packages/core/src/context_packet.rs
  - packages/core/src/credentials.rs
  - packages/core/src/db/migrations/0003_agent_runtime.sql
  - packages/core/src/db/migrations/0004_permission_gate.sql
  - packages/core/src/db/migrations/0005_credentials.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/permission_request.rs
  - packages/core/src/domain/permission_rule.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/domain/trigger.rs
  - packages/core/src/domain/worktree.rs
  - packages/core/src/git.rs
  - packages/core/src/lib.rs
  - packages/core/src/query/agent_runs.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/permissions.rs
  - packages/core/src/session_log.rs
  - packages/core/tests/agent_tracer.rs
  - packages/core/tests/branch_naming.rs
  - packages/core/tests/context_packet.rs
  - packages/core/tests/credentials.rs
  - packages/core/tests/permission_gate.rs
  - packages/core/tests/session_log_window.rs
  - packages/core/tests/stop_lifecycle.rs
  - packages/core/tests/supervisor_cwd.rs
  - packages/core/tests/worktree_lifecycle.rs
  - packages/desktop/src-tauri/Cargo.toml
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/settings.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/menu.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/__tests__/blocked-indicator.test.tsx
  - packages/desktop/src/board/__tests__/epic-roster.test.tsx
  - packages/desktop/src/board/__tests__/filter.test.tsx
  - packages/desktop/src/board/__tests__/workflow.test.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/item-detail/RunsSection.tsx
  - packages/desktop/src/item-detail/WorktreeSummary.tsx
  - packages/desktop/src/item-detail/__tests__/runs-section.test.tsx
  - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
  - packages/desktop/src/legend/Legend.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/PermissionRequestCard.tsx
  - packages/desktop/src/session/RawLogView.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/permission-card.test.tsx
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/settings/PermissionRulesTable.tsx
  - packages/desktop/src/settings/SettingsSurface.tsx
  - packages/desktop/src/settings/__tests__/settings-surface.test.tsx
  - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/desktop/src/styles/motion.css
  - packages/desktop/src/styles/tokens.css
  - packages/desktop/src/theme/__tests__/contrast.test.ts
  - packages/desktop/src/theme/tokens.ts
  - packages/desktop/vitest.config.ts
  - packages/sidecar/package.json
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/adapter.test.mjs
  - packages/sidecar/test/credentials.test.mjs
  - packages/sidecar/test/fake-claude.mjs
  - packages/sidecar/test/permission.test.mjs
  - packages/sidecar/test/stop.test.mjs
findings:
  critical: 4
  warning: 2
  info: 0
  total: 6
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 81
**Status:** issues_found

## Summary

This phase wires up real agent-process supervision: spawning `claude` via a Node sidecar,
persisting session logs, gating tool calls on a human permission decision, and resolving
credentials from the macOS Keychain. The credential boundary (`credentials.rs`,
`domain/settings.rs`) and the once-only permission-answer transition
(`domain/permission_request.rs`) are both careful, well-tested, and match their documented
invariants — I could not break either one. The sidecar's own process-group interrupt/kill
mechanics (`claude-code-adapter.ts`) are real and covered by a genuine multi-process test suite
(`stop.test.mjs`).

However, four defects sit exactly where this review was asked to look hardest — process
lifecycle/orphan risk, and the permission/stop hold-release path — plus one migration-driven
regression in existing task-deletion behavior that this phase's own schema changes broke without
any accompanying fix or test. All four are provable from the code as written, not speculative.

## Critical Issues

### CR-01: Task deletion now fails once a task has ever had an agent run (new NOT NULL FKs, no orphaning path)

**File:** `packages/core/src/db/migrations/0003_agent_runtime.sql:31-59`, `packages/core/src/db/migrations/0004_permission_gate.sql:34-46`

**Issue:** This phase adds four tables with `NOT NULL ... REFERENCES tasks(id)` columns and no
`ON DELETE` clause (SQLite's implicit default is `NO ACTION`): `triggers.target_task_id`,
`worktrees.task_id`, `agent_runs.task_id`, and `permission_requests.task_id`. `apply_pragmas`
(`db/mod.rs:56`) turns on `PRAGMA foreign_keys = ON` for every connection.

The existing `domain::task::delete_task` (not itself in this phase's file list, but broken by
these migrations) already has a documented fix for exactly this class of problem — `issues.task_id`
is a nullable FK, so `delete_task` sets it to `NULL` before deleting the task row (its own comment
cites this as "CR-01" from a prior phase). It does the same for `acceptance_criteria` by deleting
them outright. It does **not** do either for `triggers`/`worktrees`/`agent_runs`/
`permission_requests`, because those tables did not exist when `delete_task` was written — and
none of the plans in this phase's file list touched `delete_task` to catch up.

Concretely: once a task has ever had "Start Work" clicked on it (creating rows in `triggers`,
`worktrees`, `agent_runs`, and possibly `permission_requests`), calling `task_delete` will run
`DELETE FROM tasks WHERE id = ?1` inside a transaction, SQLite will reject it with a raw
"FOREIGN KEY constraint failed" error (these FKs are `NOT NULL`, so there is no "orphan by setting
NULL" option even if the code tried), the transaction rolls back, and the delete silently fails —
surfaced to the renderer as an opaque `e.to_string()` message via
`commands/task.rs::task_delete`. This is a real regression in shipped functionality (task
deletion), not a new-feature gap, and it is completely untested: no test in `packages/core/tests/`
deletes a task that has ever had a worktree/agent_run/trigger row (`hierarchy_workflow.rs` only
covers the pre-existing `issues.task_id` case).

**Fix:** Either forbid deleting a task with any non-terminal or any agent run history (a clear,
user-facing error rather than a raw SQLite constraint failure), or decide the real product
behavior — e.g. delete `agent_runs`/`triggers`/`permission_requests` rows for the task (they are
historical/append-only, so cascading their deletion loses audit trail) or block deletion outright
once `worktrees` has a row for the task (matching D-23's "one worktree per task, ever" framing).
Whichever is chosen, add a migration-level `ON DELETE` clause or an explicit pre-delete cleanup in
`delete_task`, and add a test that starts an agent run against a task and then deletes it.

```sql
-- one option: block cascading loss of audit trail, but let the schema express the decision
-- instead of leaving it as an accidental raw SQLite error
CREATE TABLE agent_runs (
    ...
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, -- explicit, not implicit NO ACTION
    ...
);
```

---

### CR-02: App exit does not kill in-flight agent sessions — orphaned `claude` processes survive Flywheel closing

**File:** `packages/desktop/src-tauri/src/sidecar.rs:224-232`, `packages/desktop/src-tauri/src/main.rs:137-148`, `packages/sidecar/src/claude-code-adapter.ts:316-322`

**Issue:** `main.rs`'s `RunEvent::Exit` handler calls `SidecarHandle::kill()`, whose own doc
comment claims this kills "the sidecar's own process (and, by extension, every child session it
was driving)". That claim is false. `SidecarHandle::kill()` calls
`tauri_plugin_shell::process::CommandChild::kill()`, which (verified against
`tauri-plugin-shell` 2.3.6's vendored source, `process/mod.rs:78`) calls
`SharedChild::kill()` — a signal to that **one** process only, not its process group and not its
descendants.

Every individual `claude` session the sidecar drives is spawned in `claude-code-adapter.ts`'s
`startSession` with `detached: true` specifically so it becomes its own process-group leader
(the comment there correctly explains this is needed so `interruptSession`/`killSession` can
signal "the whole group, never just this one PID"). The same property that makes an *explicit*
Stop work correctly also means these sessions are **not** killed by, and do not belong to, the
sidecar's own process group — killing the sidecar process does nothing to them.

Net effect: if the user quits Flywheel (Cmd+Q, closing the window, or the OS terminating the app)
while any agent run is still `running`, that `claude` process keeps running indefinitely after the
app is gone — no supervisor left alive to interrupt it, no UI showing it, still writing to the
developer's worktree and consuming API credit. This is exactly the orphan-risk failure mode
`CLAUDE.md`'s own architecture notes name as a hard requirement ("killing orphans... at the
OS-process-tree level"), and there is no test anywhere in this phase (`stop.test.mjs`,
`stop_lifecycle.rs`) that exercises the app-exit path — every existing test only covers the
explicit interrupt/kill request path.

**Fix:** On `RunEvent::Exit`, before (or instead of) killing the sidecar's own process, send the
sidecar a `kill`-all-sessions instruction (or a new op) and wait briefly for it to signal every
live session's process group, e.g.:

```rust
// main.rs
if let tauri::RunEvent::Exit = event {
    if let Some(state) = app_handle.try_state::<AppState>() {
        if let Some(sidecar) = state.sidecar.as_ref() {
            sidecar.kill_all_sessions_and_wait(); // new: iterate liveSessions, SIGTERM each group
            sidecar.kill();
        }
    }
}
```
```ts
// index.ts — a new op, or handle "kill" without a runId to mean "all"
case "shutdown": {
  await Promise.all([...liveSessions.keys()].map((runId) => adapter.killSession(runId)));
  emitAck(request.id, true);
  return;
}
```

---

### CR-03: A single session-log write failure permanently kills the sidecar's entire event/ack pipeline, for every run

**File:** `packages/desktop/src-tauri/src/sidecar.rs:272-278`

**Issue:**
```rust
if let Ok(mut writers) = sidecar.writers.lock() {
    let writer = writers.entry(run_id.clone()).or_insert_with(|| {
        SessionLogWriter::open(&run_id)
            .expect("failed to open session log writer for run")
    });
    let _ = writer.append_event_line(&event_line);
}
```
This runs inside the single, shared `while let Some(event) = rx.recv().await` loop
(`spawn_sidecar`, line ~256) that is the **only** place stdout from the sidecar process is ever
read — every normalised agent event, every `Ack` (for `spawn`/`interrupt`/`permission_answer`/
`capability_probe`), for every run this sidecar drives, flows through this one loop.

`SessionLogWriter::open` can fail for ordinary, non-exotic reasons: disk full, the app-data
directory becoming unwritable, a permissions problem, or (on Windows) another process holding the
file. When it does, `.expect(...)` panics. This is a `tauri::async_runtime::spawn`ed task with no
`.await`/join anywhere on its `JoinHandle` and no restart logic — a panic here unwinds and
terminates *this one task*, silently (the panic message goes to stderr, which is suppressed in a
release Windows build per `main.rs:1`'s `windows_subsystem = "windows"` attribute, and is easy to
miss even on macOS). From that moment, `rx.recv().await` is never polled again: no further stdout
line from the sidecar — for *any* run, not just the one whose log file failed to open — is ever
processed again for the lifetime of the app session.

This directly compounds the permission-hold-and-stop path this review was asked to scrutinize: any
`agent_run_answer_permission` after this point still writes the database (its own transaction
never depended on the reader task), but the outbound relay depends on `SidecarHandle::send_request`
succeeding — which still works — while the sidecar's own resolution and the eventual
`session_closed`/`permission_request` events for it are never observed, and any `interrupt_run`
call (see CR-04) will always time out because its ack can never arrive.

**Fix:** Never let one run's I/O failure take down the shared reader loop. Fall back rather than
panic, and keep going:

```rust
let writer = writers.entry(run_id.clone()).or_insert_with(|| {
    match SessionLogWriter::open(&run_id) {
        Ok(w) => w,
        Err(err) => {
            eprintln!("failed to open session log writer for run {run_id}: {err:#}");
            // fall back to a null/no-op writer, or `continue` this iteration entirely,
            // rather than panicking the one shared reader task for every run.
        }
    }
});
```

---

### CR-04: `agent_run_stop` has no recovery path when the sidecar never acknowledges an interrupt — a run can get stuck `running`/`blocked` forever

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:253-273`

**Issue:**
```rust
pub fn agent_run_stop(state: State<AppState>, app: AppHandle, agent_run_id: String) -> Result<(), String> {
    if let Some(sidecar) = state.sidecar.as_ref() {
        sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string())?;   // <-- early return on Err
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    ...
    flywheel_core::domain::agent_run::interrupt_agent_run(&mut conn, &agent_run_id, &human_actor_id)
        .map_err(|e| e.to_string())?;
    ...
}
```
`interrupt_run` blocks for up to `INTERRUPT_ACK_TIMEOUT` (30s) waiting for the sidecar's ack. If
the sidecar's reader task has died (CR-03), the sidecar process has crashed, or it is simply wedged,
this call returns `Err` and the `?` above means `domain::agent_run::interrupt_agent_run` — the only
code path in this codebase that ever writes a run to a terminal `interrupted` status — is **never
called**. The database row is left exactly as it was (`running` or `blocked`), the board keeps
showing an active/blocked task indefinitely, and the only user-facing recourse is to press Stop
again, which repeats the same 30-second timeout with the same outcome. There is no other command in
this file, or anywhere else reviewed, that can force a run's status to a terminal state once the
sidecar side is unresponsive.

This is precisely the failure mode called out for special attention: "a call that is never
released, or one released without an answer." A stuck sidecar leaves the database and the UI
permanently disagreeing with reality, with no escape hatch.

**Fix:** Decouple the domain write from the sidecar ack outcome. On a timeout/error from
`interrupt_run`, still record the run as interrupted (the user unambiguously asked to stop it) and
surface the sidecar failure as a secondary warning, rather than gating the DB write on the ack:

```rust
pub fn agent_run_stop(state: State<AppState>, app: AppHandle, agent_run_id: String) -> Result<(), String> {
    let sidecar_result = state.sidecar.as_ref().map(|s| s.interrupt_run(&agent_run_id));

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let human_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::agent_run::interrupt_agent_run(&mut conn, &agent_run_id, &human_actor_id)
        .map_err(|e| e.to_string())?;
    drop(conn);

    app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": agent_run_id })).ok();

    // Surface the sidecar-side failure without leaving the run stuck.
    if let Some(Err(err)) = sidecar_result {
        return Err(format!("the process may not have fully stopped: {err}"));
    }
    Ok(())
}
```

## Warnings

### WR-01: `interruptSession`'s initial SIGINT is not guarded against the same exit race its own SIGTERM escalation is

**File:** `packages/sidecar/src/claude-code-adapter.ts:382-403`

**Issue:** The SIGTERM escalation step is wrapped defensively:
```ts
if (!session.closedEventEmitted && session.child.pid !== undefined) {
  try {
    process.kill(-session.child.pid, "SIGTERM");
  } catch {
    // Exited in the gap between the grace window elapsing and this signal — nothing to do.
  }
}
```
but the first SIGINT a few lines earlier is not:
```ts
session.interruptionRequested = true;
const pid = session.child.pid;
process.kill(-pid, "SIGINT");   // no try/catch
```
If the child process exits naturally in the gap between the `session.closedEventEmitted` check
(line 385) and this call, `process.kill(-pid, ...)` throws `ESRCH` synchronously. Because
`interruptSession` is `async`, this becomes a rejected promise. `index.ts`'s `case "interrupt"`
does catch it (`emitAck(request.id, false, String(err))`), so the sidecar process itself survives,
but the Rust side receives a spurious interrupt *failure* for a run that in fact completed
successfully on its own — exactly the race D-35's idempotency contract is supposed to make
invisible to the caller.

**Fix:** Wrap the SIGINT call the same way the SIGTERM escalation already is:
```ts
try {
  process.kill(-pid, "SIGINT");
} catch {
  // Exited in the gap between the closedEventEmitted check and this call — treat as already closed.
}
```

### WR-02: `worktree_add`'s pre-flight existence check is a TOCTOU gap, not an atomic guarantee

**File:** `packages/core/src/git.rs:83-110` (via `packages/core/src/domain/worktree.rs:130-135`)

**Issue:** `ensure_worktree` checks `worktree_path.exists()` and bails with a descriptive error if
a stale directory is found with no matching `worktrees` row, then separately calls
`git::worktree_add`. Between that check and the actual `git worktree add` invocation there is a
window (however small, in a single-user desktop app) where another process — or a second
concurrent `ensure_worktree` call racing on the same task, since the existence check in
`worktree_for_task` also happens outside any transaction — could create the path first. `git
worktree add` would then fail with its own (different, less specific) error, or in a worse case
partially populate a worktree the code believes doesn't exist yet. Given this is a single local
desktop app with one shared `Mutex<Connection>` serializing all command handlers, the practical
exposure is low, but it's worth calling out since the review explicitly asked for scrutiny of path
handling around worktree creation.

**Fix:** Not urgent given the current single-process, single-connection architecture, but worth a
short comment acknowledging the gap is accepted, or moving the existence check to just before the
`git worktree add` call inside the same critical section that already serializes on `state.db`.

---

_Reviewed: 2026-09-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
