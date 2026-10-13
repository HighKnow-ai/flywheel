---
phase: 11-ship-it
plan: 09
subsystem: dispatch
tags: [rust, rusqlite, dispatch, launch, widen, tdd]
requires:
  - phase: 09-planned-fan-out
    provides: launch_conflict, windowed readiness pass, record_widen_sequencing, prepare_launch
provides:
  - D-REV-37 widen half of the decide-to-launch window pinned by a test
  - D-REV-38 runs-alone why-cause confirmed and named
  - D-REV-45 widen sequencing agrees with is_startable
  - D-REV-46 one fail_launch helper; no post-insert launch failure leaves a running row
affects: [11-21 register closure pass, 11-10]
actuals:
  tokens: 21000
  tasks: 3
  commits: 5
plan_head_before: 51a4ef219f33c7acc481c3ac91a1954c0e78d577
commits: 5
tech-stack:
  added: []
  patterns:
    - "One shared predicate (dispatch::is_startable) instead of a second hand-written state list"
    - "fail_launch(conn, run_id, why) -> why: close the run failed, return the original reason"
key-files:
  created: []
  modified:
    - packages/core/src/dispatch.rs
    - packages/core/src/domain/file_set.rs
    - packages/core/tests/dispatch_auto_merge.rs
    - packages/core/tests/scope_widen.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
key-decisions:
  - "Task 1 needed no GREEN: the window re-check and the RunsAlone why-cause already existed; only the widen half lacked a test, and it passes first time."
  - "record_widen_sequencing derives 'queued' from is_startable (made pub(crate)) rather than a shared SQL constant, so the two cannot drift."
  - "fail_launch is one helper called from every post-insert path; spawn_prepared_run is a behaviour-preserving seam so shim and send can be forced to fail."
requirements-completed: [DIST-04]
status: complete
---

# Phase 11 Plan 09: Launch-path defects D-REV-37, 38, 45, 46 Summary

Four deferred-review items are closed with tests: the widen half of the readiness-to-launch window is pinned, a widen into a task parked at pre-spawn attention now records its edge by asking `is_startable`, and a launch that fails after its run row exists now closes the run `failed` through one `fail_launch` helper.

## How the history got its shape

Two earlier executor attempts on this plan died to infrastructure, not to bad work: one to a 600 s no-progress watchdog during a slow cold cargo build, one to a transient `ENOTFOUND` API outage. This third attempt picked up from their commits. That explains why Task 1 has a single test commit and no fix commit, and why Task 3's tests and its seam refactor arrive in one commit. The first attempt never wrote the per-plan commit ledger, so `plan_head_before` is the parent of the first plan commit (`8d6ed1d^`, the 11-02 docs commit), and `commits: 5` is `git rev-list --count 51a4ef2..HEAD`.

## Per-register-id coverage (for plan 11-21)

| Register id | Tests that now cover it | Commits |
| --- | --- | --- |
| D-REV-37 | `packages/core/tests/dispatch_auto_merge.rs`: `a_live_widen_landing_in_the_window_refuses_the_spawn_and_leaves_exactly_one_run_on_the_files` (new), plus the existing `a_competing_run_landing_in_the_window_refuses_the_spawn_and_the_task_recovers`, `an_undeclared_competitor_in_the_window_is_the_runs_alone_refusal_not_an_overlap`, `with_no_competitor_in_the_window_the_same_fixture_spawns` | `8d6ed1d` |
| D-REV-38 | `packages/core/tests/dispatch_plan.rs`: `why_two_same_wave_tasks_that_declared_nothing_run_alone_not_disjoint`, `why_one_undeclared_task_in_a_pair_names_only_that_task_in_either_argument_order` (both existing); `dispatch_auto_merge.rs` runs-alone refusal tests (existing) | already landed in Phase 09 |
| D-REV-45 | `packages/core/tests/scope_widen.rs`: `a_widen_reaching_a_task_parked_at_pre_spawn_attention_records_a_widen_edge`, `a_widen_reaching_a_task_that_needs_attention_after_its_run_records_no_edge`, `a_widen_still_records_its_edge_for_every_previously_covered_queued_state` | RED `b85bd3d`, GREEN `e0f3ae6` |
| D-REV-46 | `packages/desktop/src-tauri/src/commands/agent_run.rs` (`mod tests`): `a_failure_between_the_run_insert_and_the_scope_marker_closes_the_run_failed`, `a_failure_recording_the_launch_overlap_closes_the_run_failed`, `a_shim_install_failure_closes_the_run_failed`, `a_failed_gated_spawn_closes_the_run_failed` | RED `d650b53`, GREEN `cf2cb20` |

Each D-REV-46 test asserts three things: the run is `failed`, the occupied-slot count returned to its pre-launch value, and `launch_conflict` no longer answers `HasLiveRun`.

## Task notes

**Task 1 (D-REV-37, D-REV-38).** Established by running `cargo test -p core --test dispatch_auto_merge` (46 passed) that the re-check at the point of launch (`launch_conflict`, called from `prepare_launch`), the `windowed_pass` interleave harness, and the `RunsAlone` why-cause all already existed from Phase 09 gap work. The only missing piece was the live-widen interleave, added in `8d6ed1d`. That test passed immediately: it was never RED. The commit message says the other halves already existed, and this summary repeats it so the TDD gate reading "RED then GREEN" is not misread as a fabricated red.

**Task 2 (D-REV-45).** `record_widen_sequencing`'s queued-task select was a hand-written state list narrower than `is_startable`. It now asks `is_startable` through `task_views`, so the next divergence is a compile error instead of a missing edge. A parked `needs_attention` task now waits for the widener's merge.

**Task 3 (D-REV-46).** Adopted the previous attempt's uncommitted `agent_run.rs` work: the tests and the `spawn_prepared_run` seam were on-plan and correct, but it contained no fix. Two of its four tests asserted `err.contains("boom")` against an `anyhow` context string that never carries the trigger text; corrected to assert the context strings (`criteria_revision_pin`, `append event`) before the RED commit. Then added `fail_launch` and routed through it: run-start steps 3-9 (wrapped in one closure), `record_launch_overlap`, the shim merge, and the gated send (which re-locks `db`, since the guard is dropped before the spawn floor sleeps). The pre-existing inline close at step 10 now uses the same helper, so the helper has six references.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions that could never pass**
- **Found during:** Task 3 RED run
- **Issue:** two inherited tests asserted `"boom"` in an error string built from an `anyhow` context, so they would fail even after the fix.
- **Fix:** assert on the context strings instead.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Commit:** `d650b53`

**Total deviations:** 1 auto-fixed (1 bug in inherited tests). **Impact:** none on scope.

### Verification scope

Plan verification names `cargo build --workspace` and `cargo test --workspace`. A cold workspace build exceeds the executor watchdog on this tree, so verification was scoped per target and each passed: `cargo test -p core --test dispatch_auto_merge` (46), `--test scope_widen --test dispatch_plan` (61 and 27 in the two binaries), `cargo test -p desktop --bin desktop commands::` (87 passed), `cargo check -p desktop` clean apart from one `dead_code` warning on `StartRunOutcome` fields. A full `cargo test --workspace` was not run and is left to the phase-end gate.

## Known Stubs

None.

## Threat Flags

None. T-11-27, T-11-28, T-11-29 are mitigated as the plan stated.

## Self-Check: PASSED

- Commits present: 8d6ed1d, b85bd3d, e0f3ae6, d650b53, cf2cb20.
- Modified files exist; `git status` shows no uncommitted change under `packages/`.
