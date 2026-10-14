---
phase: 09-planned-fan-out-that-does-not-collide
plan: 11
subsystem: dispatch
tags: [rust, sqlite, file-set, widen, dispatch-edges, d-152, d-157]
requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: dispatch_edges with the widen cause, approve_plan edge and sequenced-event writers, widen_file_set, declare_file_set_in_tx
provides:
  - A live widen that reaches a queued same-wave task stores a widen-cause edge and one task.sequenced event in the widen's own transaction
  - declare_file_set_in_tx refuses any replace, clear or no-op declare while the task has a running or blocked run
  - declare_refusal, so the command layer can show the reason instead of an opaque code
affects: [09-12, 09-13, why, wave plan sheet]
plan_head_before: db306925de988a53a2260ae3a17118b89acb1ef4
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns:
    - "One writer per event shape: append_sequenced_event is crate-visible and shared by approval and the widen"
    - "A guard goes in the one function every caller routes through, not in each caller"
key-files:
  created: []
  modified:
    - packages/core/src/domain/file_set.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/tests/scope_widen.rs
    - packages/desktop/src-tauri/src/commands/file_set.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
key-decisions:
  - "Widen edges are oriented live-before-queued, not by board rank; acyclicity comes from liveness, stated in the code"
  - "Queued means plan state planned, waiting or held_by_limit with no running or blocked run"
  - "The declare guard is a pub fn, declare_refusal, called by declare_file_set_in_tx and by the command, not an error enum"
requirements-completed: [PLAN-02, PLAN-07]
coverage:
  - id: D1
    description: "A real widen that reaches a queued same-wave task leaves one widen-cause edge, one task.sequenced event, and a why answer"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#a_widen_reaching_a_queued_same_wave_task_is_accepted_and_records_edge_event_and_why"
        status: pass
    human_judgment: false
  - id: D2
    description: "A repeat widen onto the same queued task writes no second edge and does not fail; the widen and its record are atomic"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#a_second_widen_reaching_the_same_queued_task_writes_no_second_edge_and_is_accepted"
        status: pass
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#the_widen_and_its_record_land_together_or_not_at_all"
        status: pass
    human_judgment: false
  - id: D3
    description: "Different wave, no live plan, reaches nobody and a refused running-sibling widen each write no edge"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#a_widen_reaching_a_queued_task_in_another_wave_writes_no_edge"
        status: pass
    human_judgment: false
  - id: D4
    description: "Replacing, clearing or re-submitting the declared set of a task with a running or blocked run is refused, naming the task and the widen, and writes nothing"
    requirement: PLAN-02
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_widen.rs#replacing_the_set_of_a_task_with_a_running_run_is_refused_naming_the_task_and_the_widen"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/file_set.rs#replacing_the_set_of_a_task_with_a_live_run_reaches_the_renderer_as_a_readable_refusal"
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 9 Plan 11: Widen Record and Declare Guard Summary

**A live widen that reaches a queued same-wave task now stores the widen-cause edge and its task.sequenced event inside the widen's own transaction, and replacing a live task's declared set is refused at the one function every declare routes through.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-10
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- D-157 is delivered rather than permitted. `EDGE_CAUSE_WIDEN` was declared, allowed by migration 0019's CHECK and rendered by `why` and the sheet, and nothing wrote it. `widen_file_set` now calls `record_widen_sequencing` after the entry insert. It finds the live plans holding the widening task, takes the queued tasks in the same wave, and writes one edge (widening task before, queued task after) plus one `task.sequenced` event per reached task. It uses the same `insert_edge_in_tx` and `append_sequenced_event` that approval uses.
- A pair with an existing edge in either orientation is skipped, so a second widen neither trips the unique index nor rewrites the first answer. A failure while recording rolls back the whole widen (proved with an injected trigger on `task.sequenced`).
- `declare_refusal` is called at the top of `declare_file_set_in_tx`. It refuses when the task has a running or blocked run. The message names the task key and points at the widen as the write that carries the D-152 re-check. `task_file_set_set` asks first, so the renderer receives that sentence instead of `failed:task_file_set_set:declare`.
- The in-flight widen refusal and the marker rewrite are untouched. The case-folding probe count in `file_set.rs` is 3 before and after, and the new code runs no subprocess.

## Task Commits

1. **Task 1: widen records edge and event** - `2f7f222` (test, RED: 3 of 7 new tests failed on the missing record), `1f43219` (feat)
2. **Task 2: declare refused while a run is live** - `a2fd4da` (test, RED: 4 core tests and 1 desktop test failed), `513980a` (feat)

**Plan metadata:** the docs commit that follows this file.

## Files Created/Modified

- `packages/core/src/domain/file_set.rs` - `record_widen_sequencing`, `declare_refusal`, and the guard in `declare_file_set_in_tx`
- `packages/core/src/domain/dispatch_plan.rs` - `append_sequenced_event` made `pub(crate)`, doc names its two callers
- `packages/core/tests/scope_widen.rs` - 13 new tests (7 for the record, 6 for the declare guard)
- `packages/desktop/src-tauri/src/commands/file_set.rs` - pre-check so the refusal reaches the renderer, plus a command-layer test
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - one existing test adjusted (see deviations)

## Decisions Made

- Queued means plan state `planned`, `waiting` or `held_by_limit` with no running or blocked run. The plan said "not merged, not skipped, no live run"; the narrower list keeps a finished, failed or conflicted task from getting a false "waits for" record.
- The refusal is a plain message from a `pub fn`, not a new enum, as the plan asked. It lives in core once and the command reuses it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A command-layer error would have hidden the refusal**
- **Found during:** Task 2
- **Issue:** `ipc_error` reduces any core error to `failed:<context>`, so a refusal from `declare_file_set_in_tx` would reach the renderer as an opaque code, not the "use the widen" message the plan requires.
- **Fix:** exposed `declare_refusal` and called it in `set_task_file_set` before the declare. The guard in the in-transaction function stays the authority.
- **Files modified:** `packages/core/src/domain/file_set.rs`, `packages/desktop/src-tauri/src/commands/file_set.rs`
- **Committed in:** `513980a`

**2. [Rule 1 - Bug] An existing test cleared a set under a live run**
- **Found during:** Task 2
- **Issue:** `clearing_the_declared_set_makes_the_next_real_run_start_unarmed` (`commands/agent_run.rs`) cleared the declared set while the first run was still running. That is the exact write the guard now forbids.
- **Fix:** the test closes the first run as `Completed` before clearing. Its assertion (the next run starts unarmed) is unchanged.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Committed in:** `513980a`

---

**Total deviations:** 2 auto-fixed (2 Rule 1)
**Impact on plan:** both needed for the plan's own goal; no scope growth.

## Issues Encountered

None beyond the deviations. `cargo test --workspace` was not run (credentials hangs on a keychain prompt; forge_live tests need network). Every other core integration binary, the core lib tests, `cargo test -p desktop` and `cargo build --workspace` pass.

## edit_draft_plan

`edit_draft_plan` needed no change. Draft-plan tasks have no runs (D-149: nothing spawns before approval), and `dispatch_plan` (61 tests) and `cargo test -p desktop` (97 tests) pass.

## Gap 2: what remains for 09-12 and 09-13

Closed here: the declare path on a live task (third of gap 2's three laundering paths), at the shared function.

Still open: the decide-to-launch window (the scheduler deciding a task is ready, then a widen landing before the run starts) is for 09-12, and the manual launch path is for 09-13. Gap 1's other missing items were handled by 09-10.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. The edge and event shapes are the ones approval already writes.

## Next Phase Readiness

`why` now has a real writer for the widen cause, so the sheet's "(after a live widen)" text can be reached from a real widen. Ready for 09-12.

## Self-Check: PASSED

- Modified files exist; commits `2f7f222`, `1f43219`, `a2fd4da`, `513980a` found in `git log`.
- RED commits precede GREEN commits for both tasks.
- `scope_widen` (24), `scope_events`, `dispatch_plan`, `file_set_overlap`, `scope_marker_contract`, `dispatch_auto_merge` and `cargo test -p desktop` pass; `cargo build --workspace` is clean.

---
*Phase: 09-planned-fan-out-that-does-not-collide*
*Completed: 2026-10-10*
