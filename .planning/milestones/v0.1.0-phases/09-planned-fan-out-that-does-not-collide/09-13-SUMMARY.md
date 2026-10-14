---
phase: 09-planned-fan-out-that-does-not-collide
plan: 13
subsystem: dispatch
tags: [rust, tauri, react, launch-guard, gap-closure, d-rev-37, d-150]
requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: dispatch::launch_conflict, the one launch-conflict rule (09-12)
provides:
  - "The shared launch body consults the one launch-conflict rule before it creates any run state"
  - "CrossTaskConflict::{Refuse, WarnAndProceed}: the dispatcher refuses, a user's own launch is recorded and warned"
  - "A task's own running or blocked run refuses on both paths"
  - "task.launch_overlap event, and overlapWarning on the launch result, shown by the sheet and by the app"
affects: [phase-09-verification]
plan_head_before: cadddf54adb4f60a85c3d42a3491c8c2e624fb4d
commits: 4
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns:
    - "The lock-held half of a launch is its own function (prepare_launch) so it can be driven without a Tauri app handle"
    - "A guard sits before the first insert, so a refusal creates nothing and needs no unwind"
key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
    - packages/desktop/src/App.tsx
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "A user's cross-task overlapping launch stays ALLOWED (recorded 09-07 choice, and launch_run_for_task's documented contract). It is now recorded as an event and surfaced, no longer silent. Refusing it would be a new owner decision; the Refuse disposition already exists, so it would be one call site."
  - "Own-live-run refusal applies to both dispositions and is not a cap refusal: two agents in one worktree corrupts the work."
  - "The launch guard folds case unconditionally (ponytail comment in the code names the ceiling and the upgrade)."
  - "The overlap event follows the task.scope_denied payload idiom (label plus facts) and is written by a small appender in agent_run.rs, not core."
requirements-completed: [PLAN-02, PLAN-03]
coverage:
  - id: D1
    description: "A dispatched launch that collides with, or runs beside an undeclared, live task is refused naming the other task and path; no run row and no event are created"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_dispatched_launch_colliding_with_a_live_task_is_refused_and_creates_nothing"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_dispatched_launch_beside_an_undeclared_live_task_is_refused_as_runs_alone"
        status: pass
    human_judgment: false
  - id: D2
    description: "A user's own overlapping launch proceeds, appends exactly one overlap event naming the other task and path, and returns the warning; an ordinary launch is silent; the cap is not consulted"
    requirement: PLAN-02
    verification:
      - kind: unit
        ref: "agent_run.rs#a_manual_launch_colliding_with_a_different_live_task_proceeds_recorded_and_warned, a_manual_launch_beside_an_undeclared_live_task_proceeds_with_the_runs_alone_wording, a_manual_launch_with_nothing_in_flight_is_silent, a_manual_launch_at_or_above_the_cap_still_proceeds"
        status: pass
    human_judgment: false
  - id: D3
    description: "A task's own running or blocked run refuses on both dispositions and changes neither the run-row count nor the event count"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "agent_run.rs#a_task_with_its_own_running_or_blocked_run_is_refused_on_both_dispositions (four combinations)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The launch sheet renders Rust's warning verbatim (not the alert role), renders nothing extra without one, and still completes the launch"
    requirement: PLAN-02
    verification:
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx#LaunchSheet overlap warning (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The app shows the warning after the sheet closes"
    requirement: PLAN-02
    verification: []
    human_judgment: true
    rationale: "App.tsx toast has no test; queued as D-REV-43 with an automatable test sketch"
  - id: D6
    description: "One spawn site and the dispatcher file's purity are intact"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "cargo test -p core --test spawn_stagger (9 passed)"
        status: pass
    human_judgment: false
duration: 35min
completed: 2026-10-10
status: complete
---

# Phase 9 Plan 13: The shared launch body consults the one rule Summary

**Every launch, dispatched or human, now passes `dispatch::launch_conflict` inside the existing lock and before any run row exists: the dispatcher refuses and retries, and a user's own overlapping launch is recorded as `task.launch_overlap` and warned about instead of silent.**

## What changed

- `prepare_launch` (new, lock-held, no Tauri handle) holds actor, credential, the conflict read, then `start_agent_run_recording_first`. `launch_run_for_task` calls it, merges the shim env, drops the connection, then sends the one gated spawn. The `drop(conn)` at line 612 still precedes the `send_gated_spawn` call at 624.
- `CrossTaskConflict::Refuse` (dispatcher's spawn closure) and `WarnAndProceed` (`agent_run_start`). `HasLiveRun` refuses on both.
- `AgentRunDto.overlap_warning` (`overlapWarning` in TS). The event is `task.launch_overlap`, payload `{label, run_id}`, written in its own transaction after the run id exists.
- Sheet renders the sentence verbatim with the `note` role. `onStarted` now passes it as a second argument, and `App.tsx` shows it as a toast.

## Stated plainly

- **The manual cross-task overlap remains ALLOWED** by the recorded 09-07 choice; it is now recorded and surfaced. Refusing it is the owner's decision and would be one call site (`CrossTaskConflict::Refuse` in `agent_run_start`).
- **`MergeConfirmSheet.tsx` is the other caller of the launch path.** It receives the same `overlapWarning` field and does not render it yet. The appended event is the durable record for that path meanwhile.
- **The case-folding shortcut** in the launch guard is marked with its ceiling and upgrade path in a `ponytail:` comment in `prepare_launch`.
- **WR-05 (D-REV-39, the `is_startable` relaunch defect) is narrowed, not fixed.** The own-live-run refusal stops a second run on a task that already has a live one, but the leaked `running` row (WR-03) and the relaunch of a finished task are untouched.
- **Cheap follow-up, not a gap:** computing the same warning in `agent_run_preview` would show it BEFORE the click.

## Task Commits

1. **Task 1 RED** - `eea2dec` (test): `prepare_launch` split with the disposition threaded but not consulted; 4 of the 5 new groups fail on assertion, the silent and cap controls pass
2. **Task 1 GREEN** - `b219dff` (feat): guard, dispositions, event, warning
3. **Task 2 RED** - `26cf682` (test): 3 of the 4 sheet tests fail on assertion, the no-warning control passes
4. **Task 2 GREEN** - `8ed5b8a` (feat): adapter field, sheet line, host toast

The project's TDD gate is off (D-REV-40), so the RED-before-GREEN order is the control; it is visible in `git log`.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] The sheet unmounts before its warning can be read**
- **Found during:** Task 2
- **Issue:** `App.tsx`'s `onStarted` sets the launch task to null in the same callback, so the sheet returns nothing; a warning rendered only inside the sheet would never be seen in the real app.
- **Fix:** `onStarted(runId, overlapWarning)` carries the sentence, and `App.tsx` shows it as a fixed toast for 15 seconds. The sheet still renders it too (tested), for any host that keeps the sheet open. `App.tsx` was not in the plan's `files_modified`.
- **Verification:** sheet tests pass; the toast itself is untested (D-REV-43).
- **Commit:** `8ed5b8a`

**2. [Plan shape] Tests drive `prepare_launch`, not `launch_run_for_task`**
- The latter needs a Tauri `AppHandle`, which cannot be built in this crate's tests. Splitting the lock-held half out made it testable and kept the ordering. "No spawn request is sent" holds structurally: a refusal returns `Err` before `launch_run_for_task` reaches `send_gated_spawn`.

**3. [Plan criterion miscalibrated] The `drop(conn)` grep**
- `grep -n -E 'drop\(conn\)|send_gated_spawn\(' | head -4` lists the function definition of `send_gated_spawn` (line 473) first, as it did before this plan. The real ordering inside `launch_run_for_task` is drop (612) then call (624).

**Total deviations:** 1 auto-added (Rule 2), 2 plan-shape notes. **Impact:** one extra file touched (`App.tsx`).

## Issues Encountered

None. `cargo build --workspace` still shows the pre-existing `desktop` dead-field warnings.

## Known Stubs

None.

## Threat Flags

None. The new event and field carry task keys and declared paths already stored on the board; no new endpoint or auth path.

## Self-Check: PASSED

- Verified: `cargo test -p desktop` 105 passed; `spawn_stagger` 9, `dispatch_auto_merge` 45, `dispatch_cap` 8, `dispatch_plan` 61, `scope_widen` 24; `cargo build --workspace` clean.
- Verified: `npm --prefix packages/desktop test` 1301 passed (floor 1292); `tsc --noEmit` clean; build succeeds; `tauri-apps` appears nowhere in `LaunchSheet.tsx` code.
- Commits `eea2dec`, `b219dff`, `26cf682`, `8ed5b8a` exist.
- Not run, deliberately: `cargo test --workspace` in full (`credentials` keychain prompt; `forge_live_*` need network); the sidecar suite (untouched).
