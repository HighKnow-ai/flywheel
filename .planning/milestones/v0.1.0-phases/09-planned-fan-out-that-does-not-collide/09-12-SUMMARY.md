---
phase: 09-planned-fan-out-that-does-not-collide
plan: 12
subsystem: dispatch
tags: [rust, dispatch, file-set, launch-guard, gap-closure, d-rev-37, d-150]
requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: readiness with the RunsAlone refusal (CR-02 fix), RunsAlone in why (09-10), live-widen edge and declare guard (09-11), run_pass
provides:
  - "dispatch::launch_conflict: the ONE implementation of the launch-time disjointness rule, callable with only a connection and a task id"
  - "readiness calls it in place of its own copy of the in-flight loop, verdicts unchanged"
  - "the decide-to-launch window driven by test: a competing run landing in the spawn closure is refused, recorded pre-spawn, and recovers"
affects: [09-13, phase-09-verification]
plan_head_before: 2103b8659e55463d1515eea7027560b89fdc6d3b
commits: 4
actuals:
  tokens: 4300
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns:
    - "A cross-row rule lives once in a pure function and every launch path calls it, rather than a schema constraint that cannot state it"
    - "The fold flag is a parameter, so the rule is callable under the database lock"
key-files:
  created: []
  modified:
    - packages/core/src/dispatch.rs
    - packages/core/tests/dispatch_auto_merge.rs
key-decisions:
  - "No migration and no partial unique index on agent_runs(task_id): the invariant is disjointness between two DIFFERENT tasks' file sets, a cross-row predicate over a child table, which no uniqueness constraint can state. An index would only stop two live runs of the SAME task, and would turn the out-of-scope leaked-running-row defect (D-REV-39, WR-03) into a permanently unlaunchable task with no in-app repair. The same-task guard is taken as a code guard in 09-13."
  - "launch_conflict reuses ReadinessRefusal (HasLiveRun, RunsAlone, OverlapsInFlight) instead of adding a second vocabulary"
  - "launch_conflict adds its own live-run check read from agent_runs, so it is the authority for a caller with no TaskView; readiness keeps its cheap early return on t.live as a pre-filter"
  - "Direct tests of the rule live in dispatch_auto_merge.rs because dispatch.rs has no test module"
requirements-completed: [PLAN-02, PLAN-03]
coverage:
  - id: D1
    description: "launch_conflict answers HasLiveRun, RunsAlone (either side) and OverlapsInFlight (naming the other task and path), reads stored rows including a mid-flight widen, is per-project, counts chosen-earlier tasks, and honours the supplied fold flag"
    requirement: PLAN-02
    verification:
      - kind: unit
        ref: "packages/core/tests/dispatch_auto_merge.rs#launch_conflict_* (10 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Extracting the rule changed no dispatcher verdict: the pre-existing suites pass with no pre-existing test body edited"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "cargo test -p core --test dispatch_auto_merge (32 pre-existing + 13 new = 45), --test dispatch_cap (8), --test dispatch_plan (61), --test dispatch_limit_gate (32), --test file_set_overlap (36), --test scope_widen (24)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The decide-to-launch window is driven: a competing live run inserted in the spawn closure is refused (overlap, and runs-alone for an undeclared competitor), leaves no run row, is pre-spawn needs-attention, is offered again by ready_tasks, and merges once the competitor is gone; a control without a competitor spawns"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "packages/core/tests/dispatch_auto_merge.rs#a_competing_run_landing_in_the_window_refuses_the_spawn_and_the_task_recovers"
        status: pass
      - kind: unit
        ref: "packages/core/tests/dispatch_auto_merge.rs#an_undeclared_competitor_in_the_window_is_the_runs_alone_refusal_not_an_overlap"
        status: pass
      - kind: unit
        ref: "packages/core/tests/dispatch_auto_merge.rs#with_no_competitor_in_the_window_the_same_fixture_spawns"
        status: pass
    human_judgment: false
  - id: D4
    description: "dispatch.rs stays pure and the overlap comparison appears once outside edges_for_plan"
    requirement: PLAN-03
    verification:
      - kind: unit
        ref: "cargo test -p core --test spawn_stagger (9 passed)"
        status: pass
      - kind: command
        ref: "grep -v '^[[:space:]]*//' packages/core/src/dispatch.rs | grep -c 'collisions(' == 2"
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 9 Plan 12: One launch-conflict rule, and the decide-to-launch window driven Summary

**The loop inside `readiness` is now `dispatch::launch_conflict`, the one callable statement of "may this task's declared set go in flight right now", and the window between a dispatcher decision and its spawn has its first test.**

## The signature plan 09-13 calls

```rust
pub fn launch_conflict(
    conn: &Connection,
    task_id: &str,
    project_id: &str,
    fold_case: bool,
    taken: &[(String, String, Vec<FileSetEntry>)], // (project_id, task_id, entries), chosen earlier in this decision
) -> anyhow::Result<Option<ReadinessRefusal>>      // None = may launch
```

Callers outside a decision pass `&[]` for `taken`. `fold_case` must be resolved BEFORE the database lock is held (it runs git); the function itself runs no subprocess. It returns the existing `ReadinessRefusal` variants `HasLiveRun`, `RunsAlone { task_id }` and `OverlapsInFlight { task_id, path }`.

## No migration, and why (the rejected mechanism, on the record)

No migration was added. The gap's first `missing` item offered a partial unique index on `agent_runs(task_id)` for running and blocked. It was declined:

- It cannot state the invariant. The invariant is disjointness between two DIFFERENT tasks' file sets, a cross-row predicate over a child table. A uniqueness constraint can only stop two live runs of the SAME task, a real but different defect.
- It would sharpen a defect this phase may not fix. `09-REVIEW.md` WR-03 (D-REV-39) leaks an abandoned `running` row. Today that costs one cap slot. Under a unique index it would make that task permanently unlaunchable with no in-app repair.

The same-task protection is taken instead as a code guard in plan 09-13, where it is cheap and reversible. A re-check is code a fourth caller could bypass; the answer is to put the one check where every caller already routes (the shared launch body, 09-13), and the function's doc comment says so.

## Accomplishments

- `launch_conflict` extracted from `readiness`. `readiness` keeps its wave, startable, predecessor-merged and stale-base checks in their original order and calls the function where the loop was. The 09-10 `RunsAlone` arm of `why` and the 09-11 live-widen/declare-guard code were not touched.
- The function adds one thing the loop lacked: its own `HasLiveRun` check read from `agent_runs`, so it is authoritative for a caller with no `TaskView`.
- Ten direct tests of the rule and three window tests, all in `dispatch_auto_merge.rs`.
- The window test interleaves with no sleep: the spawn closure `run_pass` gets runs with no lock held, so inserting a competing live run there reproduces the real gap exactly.

## Lost-race cost (deliberate, visible, self-healing)

A lost race costs one needs-attention record and one event, which clears on the following pass: the cause is `LaunchFailed`, whose phase is pre-spawn, which `is_startable` treats as startable. This is not a silent retry. The race is expected to be rare because it needs a manual launch or a widen inside one pass's spawn window. The test asserts the recovery through `ready_tasks`, then drives passes until the refused task merges.

## Task Commits

TDD order held (the config gate cannot enforce it here, D-REV-40, so the order is the control):

1. **Task 1 RED** - `eaae67a` (test): ten direct cases against a stub; 8 of 10 failed on assertion (the two that pass are the legitimate no-refusal cases)
2. **Task 1 GREEN** - `2a2f0b6` (feat): extraction
3. **Task 2 RED** - `85c112e` (test): window tests with a closure that does not consult the rule; both refusal tests failed on assertion, the control passed
4. **Task 2 GREEN** - `96c7a71` (test): the closure consults `launch_conflict`

**Plan metadata:** docs commit follows this file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan criterion miscalibrated] The "no sleep" grep reports 2, not 0**
- **Found during:** Task 2 verify
- **Issue:** `grep -v '^[[:space:]]*//' dispatch_auto_merge.rs | grep -cE 'thread::sleep|tokio::time::sleep'` matches two lines that already existed at the plan's base (`2103b86`): string literals in the `banned` token lists of the existing source-gate tests (lines 723 and 759).
- **Resolution:** No sleep call was introduced. Verified by diffing the match set against the base: identical two lines. Left as is; editing those pre-existing test bodies is forbidden by the same plan.

**2. [Scope note] Task 1 stub in the RED commit**
- A stub `launch_conflict` returning `Ok(None)` was committed with the RED tests so they fail on assertions rather than on a compile error (an unambiguous valid RED).

**Total deviations:** 1 criterion miscalibration, 1 note. **Impact:** none on behaviour.

## Issues Encountered

None. `cargo build --workspace` shows one pre-existing `desktop` dead-field warning (`actor_id`, `worktree_id`, `drift_event_count`) and `dispatch_plan` one pre-existing unused-import warning; neither is from this plan.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the function is read-only and in-process.

## Self-Check: PASSED

- `packages/core/src/dispatch.rs` and `packages/core/tests/dispatch_auto_merge.rs` exist and carry the changes.
- Commits `eaae67a`, `2a2f0b6`, `85c112e`, `96c7a71` exist.
- Verified: `dispatch_auto_merge` 45 passed (32 pre-existing unmodified), `dispatch_cap` 8, `dispatch_plan` 61, `dispatch_limit_gate` 32, `spawn_stagger` 9, `file_set_overlap` 36, `scope_widen` 24, `cargo build --workspace` clean, `collisions(` count in `dispatch.rs` is 2.
- Not run, deliberately: `cargo test --workspace` in full (`credentials` keychain prompt; `forge_live_*` need network).
