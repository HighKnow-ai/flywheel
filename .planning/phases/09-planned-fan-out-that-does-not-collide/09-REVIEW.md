---
phase: 09
reviewed: 2026-10-09T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - packages/core/src/context_packet.rs
  - packages/core/src/db/migrations/0019_fan_out.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/dispatch_exec.rs
  - packages/core/src/dispatch.rs
  - packages/core/src/domain/dispatch_plan.rs
  - packages/core/src/domain/file_set.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/drift.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/file_set.rs
  - packages/core/src/git_facts.rs
  - packages/core/src/lib.rs
  - packages/core/src/limit_gate.rs
  - packages/core/src/merge.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/scope.rs
  - packages/core/src/runtime_protocol.rs
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/commands/dispatch.rs
  - packages/desktop/src-tauri/src/commands/file_set.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/settings.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/App.css
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/EpicHeaderRow.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/dispatch/dispatch.css
  - packages/desktop/src/dispatch/DispatchGateLine.tsx
  - packages/desktop/src/dispatch/EpicDispatchControls.tsx
  - packages/desktop/src/dispatch/queries.ts
  - packages/desktop/src/dispatch/WavePlanSheet.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/settings/SettingsSurface.tsx
  - packages/desktop/src/state/uiStore.ts
  - packages/shim/src/main.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/src/scope-hook.ts
findings:
  critical: 2
  warning: 7
  info: 3
  total: 12
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-10-09
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found (the `status: <clean|issues>` field is spelled `issues_found` per the review-workflow schema)

## Summary

The hook, shim and containment predicate are carefully built. Checked and found sound:

- **Hook error paths.** Every error path in `scope-hook.ts` ends in exit 2: a throw, a rejection, a malformed payload, a missing run identity, a shim that cannot spawn, and unparseable shim output.
- **Path resolution.** `resolve_scope_target` canonicalises the longest existing prefix, denies on a dangling symlink, and denies when the resolved path is outside the root.
- **Marker handling.** An absent, unreadable, wrong-version or unparseable marker returns non-zero, which the hook turns into a deny. `unarmed` is an explicit fact Rust writes.
- **Widen transaction.** `widen_file_set` reads and writes inside one `IMMEDIATE` transaction. The marker is rewritten only after commit. A failed rewrite is returned as `MarkerNotRewritten`, and a retry repairs it.
- **Cap and gate asymmetry.** It is real and intentional: `decide` consults the cap and gate, and `launch_run_for_task` consults neither. A malformed stored cap reads back as the default of 3.
- **Command surface.** All 17 new commands (everything registered in `main.rs` except `settings_set_dispatch_max_parallel`, which is also checked) appear in the `capabilities/default.json` roster. Every mutating command resolves the actor server-side, and every id is ULID-validated.
- **Automatic merge.** It dry-runs first, works in the epic's own worktree, rolls back a failed merge, and reports a dirty integration worktree before touching it.

Two defects void the parallelism guarantee in ways the SUMMARY files do not describe:

- The scope gate is not installed when hook wiring fails, so a run with an armed marker runs unenforced.
- A task with no declared file-set is dispatched in parallel with its siblings. D-150 says it runs alone.

The warnings are a missing re-check between decide and launch, run-row and slot leaks on launch failure, an event storm on a persistently failing merge, relaunch of tasks run outside the plan, an unrecorded widen ordering, a bypass of the widen re-check via `task_file_set_set`, and the database mutex held across git subprocesses.

## Critical Issues

### CR-01: The scope gate silently fails open when its hook wiring is absent or cannot run

**File:** `packages/sidecar/src/claude-code-adapter.ts:272-275` (write failure), `:1393-1395` (`FLYWHEEL_RUNTIME_DIR` unset), `:236` and `:252` (unquoted command strings)

**Issue:** Rust writes an ARMED marker and the run starts. Enforcement then depends on the sidecar installing a `--settings` file that wires `scope-hook.js`. Three ways that wiring is silently absent:

1. `writeHookSettings` catches any `mkdirSync` or `writeFileSync` failure (disk full, permissions), logs it and returns `undefined`. `buildClaudeArgv` then omits `--settings`, and the agent runs with no `PreToolUse` hooks at all.
2. `env.FLYWHEEL_RUNTIME_DIR ? writeHookSettings(...) : undefined` has the same outcome when the variable is unset.
3. The hook command is built as `` `${process.execPath} ${scopeHookScriptPath()}` `` with no quoting. If either path contains a space, the shell splits it, `node` exits 1 with "Cannot find module", and exit 1 does not block the tool call. `scope-hook.ts`'s own header records this as measured (M2: any exit status other than 2 lets the call proceed). The same happens if `scope-hook.js` is missing from a broken install.

The existing Bash gate tolerates a missing settings file because the PATH shim is its second layer. The scope gate has no second layer; the session-close backstop is detective only. D-151 and the invariant "a crashing hook, absent marker ... must all end in refusal" are violated. An armed run proceeds with every `Write`, `Edit` and `NotebookEdit` permitted and nothing recorded.

**Fix:**

- Have Rust send `scopeArmed: true` in the spawn request, using the mode `arm_scope_marker` already returns.
- In `ClaudeCodeAdapter.startSession`, refuse to spawn when armed and any of the following holds:
  - `settingsPath === undefined`
  - `!fs.existsSync(scopeHookScriptPath())`
  - `FLYWHEEL_SHIM_BIN` is unset
- Quote both paths in the command, for example `` `${JSON.stringify(process.execPath)} ${JSON.stringify(scopeHookScriptPath())}` ``.
- `writeHookSettings` should rethrow, or return a discriminated result, instead of swallowing the failure when `includeScopeGate` is true.

```ts
if (options.scopeArmed && (!settingsPath || !fs.existsSync(scopeHookScriptPath()))) {
  throw new Error("scope gate cannot be installed; refusing to run an armed task unenforced");
}
```

### CR-02: A task with no declared file-set is dispatched in parallel with its siblings (D-150 not implemented)

**File:** `packages/core/src/dispatch.rs:567-583` (`readiness` skips the overlap check when `entries.is_empty()`), `packages/core/src/domain/dispatch_plan.rs:625-654` and `:200-270` (plan creation and approval), `packages/desktop/src/dispatch/WavePlanSheet.tsx:155-189`

**Issue:** D-150 says a task with no declared set "runs alone ... can never share a wave". The code does the opposite:

- `create_plan_for_epic` puts every backlog and todo task in wave 1, and the declared sets are read as they stand.
- `edges_for_plan` yields no edge for an empty set.
- `readiness` skips the in-flight overlap check for an empty set.
- `in_flight_declared_sets` omits a live unarmed task, so nobody else is held off by it.
- `approve_plan_with` accepts a plan containing such tasks.
- The sheet shows an empty textarea with no warning.

Tasks typed into QuickAdd have no set, which makes this the default path. The whole epic then starts at once, up to the cap. Each task runs with the hook disarmed, and the only guard is the merge-conflict path. This is the "two agents write the same file with neither refused" case. The planning pass cannot produce it (`EmptyFileList` is refused), but the "Plan fan-out" alternative `dispatch_plan_create` and any manual draft can.

09-07-SUMMARY records that such a task "is never excluded". It does not record that this contradicts D-150's "runs alone", and the sheet gives the human no signal at the one review point D-149 provides.

**Fix:** Pick one and enforce it in `readiness`. Both options are cheap and database-only.

- **Isolate undeclared tasks.** A task whose set is empty is ready only when nothing else in its project has a live run, and while it is live nothing else becomes ready. This is the literal D-150.
- **Refuse approval.** `approve_plan_with` bails if any non-`skipped` task has no declared entries, naming the task keys.

Either way, flag empty-set tasks on the sheet ("No files declared, runs alone / blocks approval").

## Warnings

### WR-01: `task_file_set_set` and `edit_draft_plan` bypass the D-152 collision re-check, and a later widen launders the result into the live marker

**File:** `packages/desktop/src-tauri/src/commands/file_set.rs:60-94`, `:108-121`; `packages/core/src/domain/dispatch_plan.rs:700-702`; `packages/core/src/domain/file_set.rs:484-499`

**Issue:**

- `declare_file_set` replaces a task's stored set with no check that the task has a live run and no check against other in-flight sets.
- `task_file_set_set` is a registered command, callable from the webview (the renderer adapter does not currently use it).
- `edit_draft_plan` has the same behaviour for a task that has a live manual run.

Scenario: A runs with `{a/}`, B runs with `{b/}`.

1. `task_file_set_set(A, [a/, b/])` succeeds. The database now says A and B overlap, while A's marker still says `{a/}`.
2. The user later widens A with any unrelated entry. `widen_file_set` collision-checks only that candidate, then `rewrite_live_markers` re-arms A from ALL stored rows.
3. A's hook now permits `b/`, which B is running against. The re-check D-152 calls load-bearing was never applied to `b/`.

**Fix:** In `declare_file_set_in_tx`, or in the command, refuse (or route through `widen_file_set`) when `task_id` has a run in `('running','blocked')`.

```rust
let live: bool = tx.query_row(
    "SELECT EXISTS(SELECT 1 FROM agent_runs WHERE task_id=?1 AND status IN ('running','blocked'))",
    [task_id], |r| r.get(0))?;
if live { bail!("task {task_id} has a live run; use the widen path"); }
```

### WR-02: Readiness, cap and liveness are decided once and never re-verified at launch

**File:** `packages/core/src/dispatch_exec.rs:196-210` (the `Spawn` arm), `packages/desktop/src-tauri/src/commands/agent_run.rs:697-729`

**Issue:** `decide` computes `Spawn` actions under one lock acquisition. The actions then execute sequentially, each Spawn sleeping inside the 400 ms spawn floor and each Merge waiting on git, with the lock released between them. Nothing re-checks before `launch_run_for_task` runs. Two consequences:

- A widen of sibling A that lands in that window is checked against in-flight sets, and B (spawn already decided) is not yet in flight. A and B then run with overlapping armed sets. This is exactly the hole D-152's re-check exists to close.
- A manual `agent_run_start` of the same task in that window creates a second live run on one task and one worktree. `agent_runs` has no uniqueness on a live `task_id` (migrations only index `(task_id, started_at)`), and `launch_run_for_task` has no live-run guard.

**Fix:** In `run_pass`, immediately before each `spawn`, re-run `readiness` for that task (database-only, cheap) under the lock and skip the Spawn if it is no longer `Ok`. Add a live-run check to the dispatcher launch path. A partial unique index on `agent_runs(task_id) WHERE status IN ('running','blocked')` would make the invariant structural, if existing flows allow it.

### WR-03: A launch that fails after the run row exists leaks a `running` run and a cap slot permanently

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:734` (`merge_shim_env_for_run ... ?`) and `:752-754` (`send_spawn_request ... ?`)

**Issue:** `start_agent_run_recording_first` has already inserted the `agent_runs` row with `status='running'` and armed the marker. The two `?` returns above leave that row `running` with no session behind it. `arm_run_scope`'s failure path closes the row precisely to avoid this ("would hold a dispatcher slot forever"), and `fail_planning_start` does the same, so the author knew. These two paths do not.

For the dispatcher this is worse than for a user launch:

- `occupied_slots` counts the dead row, so the cap shrinks by one per failure. With the default cap of 3, three sidecar hiccups stop all autonomous dispatch.
- `t.live` stays true, so the `LaunchFailed` needs-attention state is never re-evaluated (`HasLiveRun`).

**Fix:** On both error paths, call `close_agent_run(conn, &outcome.run_id, AgentRunStatus::Failed, ...)` before returning. Re-lock if `conn` was dropped before the spawn request.

### WR-04: A persistently failing merge flaps `merging` / `needs_attention` and appends an event every 5 seconds

**File:** `packages/core/src/dispatch_exec.rs:133-137` and `:147-148`; `packages/core/src/domain/dispatch_plan.rs:461-467`

**Issue:** `merge_task` sets the state to `merging` before `run_merge`. If `run_merge` errors (hook refusal, identity unset, index lock), `block` calls `mark_needs_attention`. Its dedupe only fires when `current == "needs_attention"`, and the state is `merging` at that moment, so a new `dispatch.task_needs_attention` event and an `eprintln!` are written. Next pass: `needs_attention` plus `completed` plus PostRun leads to `Action::Merge` again, `merging` again, error again. The inline comment ("a persisting cause stays one record rather than flickering through `merging`") is true only for failures before the `merging` write.

Separately, if `record_merge_event_with` fails after a successful git merge (`?` at line 148), the state stays `merging` and the next pass sees `commits_ahead == 0` with no integrated event. It reports `NoCommits` ("nothing to merge") for work that is in fact on the integration branch, and blocks the wave.

**Fix:**

- Make the dedupe independent of the current state: compare the latest attention event's kind and cause, and skip when equal and the task has not changed state since.
- Alternatively, restore the previous state before `block` on `run_merge` failure.
- For the second case, on `Ok(Merged)` retry the event write, or detect "branch tip reachable from integration" (`merge_commit_is_reachable` style) and record the event then.

### WR-05: The dispatcher relaunches a task that was already run, merged or completed outside it

**File:** `packages/core/src/dispatch.rs:522-533` (`is_startable`), `:705-727` (`decide` first loop); `packages/core/src/domain/dispatch_plan.rs:200-270` (`approve_plan_with`)

**Issue:** `dispatch_plan_tasks.state` is written only by the dispatcher. `is_startable` is true for `planned`, `waiting` and `held_by_limit` regardless of the task's runs or board status.

- If the user launches a planned task with `agent_run_start`, the dispatcher leaves it `planned` while the run is live (`HasLiveRun`). When that run completes, the task is not live, `planned` is startable, and the next pass, nudged immediately by `session_closed`, spawns a second run on a task that is already done.
- The first loop of `decide` only reasons about `running` and `merging` states, so the finished manual run is never merged either.
- `approve_plan_with` does not re-check that tasks are still `backlog` or `todo`. A draft reviewed for an hour and then approved can include tasks the user has since completed.

**Fix:** Adopt rather than relaunch. In `decide`, if a task's state is `planned` or `waiting` and its latest run is newer than the plan (or any run exists in a terminal state), treat it as `running` for the finished-run branch. Re-validate `is_plannable` per task in `approve_plan_with`.

### WR-06: A live widen never records an ordering reason, so "why is this one waiting?" gives a wrong answer (D-157, PLAN-07)

**File:** `packages/core/src/domain/file_set.rs:401-480` (`widen_file_set`), `packages/core/src/dispatch.rs:46` (`EDGE_CAUSE_WIDEN`, never written), `:575-582` (`OverlapsInFlight`), `packages/desktop/src-tauri/src/commands/dispatch.rs:349-410` (`dispatch_why`)

**Issue:** D-157 says that after a live widen the answer acted on must be recorded. The migration allows `cause = 'widen'` and the UI renders "(after a live widen)". Nothing writes such an edge or event. When a widened A overlaps a queued, not-yet-started B in a live plan, B is held at runtime by `ReadinessRefusal::OverlapsInFlight`, which is never persisted. `dispatch_why(A, B)` finds no edge, sees the same wave, and answers `DisjointSets`: "declare disjoint sets, so neither waits for the other". That is false for a pair that is waiting because of a widen.

**Fix:** In the widen transaction, for each other task in a live plan of the same epic that is not running and whose stored set overlaps the new candidate, `insert_edge_in_tx(... EDGE_CAUSE_WIDEN ...)` and append a `task.sequenced` event. Orientation must follow the running-task-first rule, since the widened task is the one currently live.

### WR-07: The `AppState.db` mutex is held across git subprocesses in the new command paths

**File:** `packages/desktop/src-tauri/src/commands/dispatch.rs:100` (`plan_dto` calls `preview_edges`) and `:285-288` (`approve_and_start` calls `approve_plan`); `packages/core/src/domain/dispatch_plan.rs:177` and `:195`; `packages/desktop/src-tauri/src/commands/file_set.rs:199-202` (`widen_task_file_set` calls `widen_file_set` and `rewrite_live_markers`, which reach `repo_is_case_insensitive` via `domain/file_set.rs:428` and `:182`)

**Issue:** `repo_is_case_insensitive` runs `git config --get core.ignorecase`. Each of these handlers locks `state.db` first and keeps the guard while the subprocess runs. `dispatch_plan_get` on a draft runs it on every refetch, and the draft plan is refetched on every `board:changed`. The comments say it happens "before the write transaction opens", which is true of the SQLite transaction but not of the application-wide mutex. The project established the opposite rule (the scheduler module docs and the "git-running half takes plain values, never a connection" convention): a slow or hung repository path freezes every command.

**Fix:** Resolve the fold flag before taking the lock. For example, read the project's `repo_path`, drop the guard, run git, re-lock. Or cache it per project in `Observations` or in a settings row.

## Info

### IN-01: Dead code from the widen and limit work

**File:** `packages/core/src/dispatch.rs:46` (`EDGE_CAUSE_WIDEN`), `packages/core/src/limit_gate.rs:364` (`may_merge`) and `:422` (`hold_for_limit`)

**Issue:** None of the three has a non-test caller. `hold_for_limit` duplicates the `MarkRunEnded { state: "held_by_limit" }` path in `decide`.

**Fix:** Delete them, or wire `EDGE_CAUSE_WIDEN` as in WR-06.

### IN-02: Unattended dispatcher launches are attributed to the local human

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:697-699` and `:723-729`

**Issue:** `launch_run_for_task` resolves `local_human_actor_id` and passes it to `start_agent_run_recording_first`, which creates a `user_action` trigger for that actor. Automatic merges are carefully attributed to the system actor with `automatic: true`. Automatic spawns read in the audit trail as the user pressing Launch.

**Fix:** Pass the actor into `launch_run_for_task`; the dispatcher passes the system actor, `agent_run_start` passes the human.

### IN-03: Case-folding is ASCII-only, and an unset `core.ignorecase` errs on the lax side for overlap

**File:** `packages/core/src/file_set.rs:150-151`, `:180`, `:191`; `packages/core/src/domain/file_set.rs:147-153`

**Issue:**

- `to_ascii_lowercase` and `eq_ignore_ascii_case` treat `Écran.rs` and `écran.rs` as different files. On a case-insensitive filesystem (default APFS) they are one file. APFS also treats NFC and NFD spellings as the same name. The plan-time check calls such a pair disjoint.
- `repo_is_case_insensitive` returns `false` when the key is unset or git cannot be run. The doc comment calls that "the STRICTER direction for enforcement", which is true for the hook but is the lax direction for the overlap check that depends on the same flag.

**Fix:** Fold with Unicode case-folding and NFC normalisation when the flag is true. On macOS, default the flag to true when it cannot be read.

---

_Reviewed: 2026-10-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
