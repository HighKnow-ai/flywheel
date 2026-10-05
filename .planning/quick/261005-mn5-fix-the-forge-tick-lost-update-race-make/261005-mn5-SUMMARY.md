---
phase: quick
plan: 261005-mn5
subsystem: forge
tags: [forge, scheduler, race-condition, compare-and-swap, sqlite-core, rust]

# Dependency graph
requires:
  - phase: 07-forge-integration
    provides: the lock-release restructure (plans 07-11/07-12) that split run_forge_tick into forge_tick_targets (read, under the lock), poll_forge_targets (network, lock-free) and apply_forge_results (write, re-acquired lock) — the window this quick task closes
provides:
  - "A compare-and-swap precondition (expected_status: Option<&str>) on apply_forge_observation's status write, so a manual column move landing inside the lock-release window is never overwritten by a stale merged observation"
  - "A new forge.status_write_skipped event naming the expected/actual/intended status, rendered verbatim into the activity trail, so the user can see why the card did not move"
  - "forge/mod.rs's module header and forge_and_repo_path's doc comment corrected to state the one bounded local git spawn the detection fallback actually performs, instead of the prior false 'spawns nothing' claim"
  - "The scheduler's three-phase forge tick (forge_tick_targets -> poll_forge_targets -> apply_forge_results) its first test coverage: 4 inline tests in a new scheduler::forge_tick_tests module"
affects: [forge-integration, scheduler]

# Actuals (#2632)
actuals:
  tokens: 12280
  tasks: 3
  commits: 3
  plan_head_before: 7835f39

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compare-and-swap on a transactional status write: a caller that released its lock between read and write passes the status it captured at read time; the write is refused unless that status still matches when the write actually runs"
    - "A refused write still appends the edge-detector's unconditional state-change event, advancing the restart-safe baseline, so the next tick re-observes no edge and never retries the overwrite"
    - "Inline #[cfg(test)] mod in a bin-only crate (no lib target) that needs to test private functions — the desktop crate's own established idiom, reused rather than reinvented"

key-files:
  created: []
  modified:
    - packages/core/src/forge/transitions.rs
    - packages/desktop/src-tauri/src/scheduler.rs
    - packages/core/src/forge/mod.rs
    - packages/core/tests/status_transitions.rs
    - packages/core/tests/forge_live_chain.rs
    - packages/core/tests/forge_board_flags.rs

key-decisions:
  - "expected_status: Option<&str> is an explicit fifth parameter, not an inferred guard — merged_against_a_none_baseline_still_reaches_done proves a None baseline legitimately reaches done from ANY status, so there is no single status the detector could infer it is transitioning from (D1)"
  - "The forge.state_changed event still fires unconditionally on a refusal, advancing the baseline to the terminal Merged state — if it did not, the next tick 120s later would re-observe the same edge and retry the overwrite forever (D4)"
  - "The refusal's trace is a new events row (forge.status_write_skipped), not a swallowed skip or an eprintln! — matching this module's own established discipline for every other non-status-writing observation"
  - "forge_and_repo_path's false 'spawns nothing' claim was corrected in place (two doc comments), not resolved by splitting the function — the one bounded local git spawn it performs cannot produce the unbounded-latency freeze the resolution/dispatch split exists to prevent, so restructuring it would be a second split for no user-visible gain (D6)"
  - "MED-02's new coverage lives as an inline #[cfg(test)] mod inside scheduler.rs, reusing the desktop crate's existing fixture shapes (seeded_conn_with_task, the worktrees INSERT) verbatim rather than adding a tests/ directory or a library target to a bin-only crate (D7)"
  - "No fake gh/glab stub was added — target resolution and result threading are proven with projects.forge = 'local', which spawns no process at all, so a scheduler that failed to capture the status still fails the regression test (D8)"

requirements-completed: [BL-01, HI-01, MED-02]

coverage:
  - id: D1
    description: "BL-01: a manual status move landing inside the forge tick's lock-release window survives a stale merged observation that was captured before the move — proven red against the unfixed code first, then green after the compare-and-swap"
    requirement: "BL-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/scheduler.rs#forge_tick_tests::a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation"
        status: pass
    human_judgment: false
  - id: D2
    description: "The compare-and-swap is a precondition, not a blanket refusal — an unmoved task's merge observation still reaches done exactly as before"
    requirement: "BL-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/scheduler.rs#forge_tick_tests::a_merged_observation_still_carries_an_unmoved_task_to_done"
        status: pass
    human_judgment: false
  - id: D3
    description: "The restart-safe baseline advances to Merged even on a refused write, so the next tick never retries the overwrite"
    requirement: "BL-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/scheduler.rs#forge_tick_tests::a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation (latest_forge_baseline assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "expected_status: None reproduces the pre-change behaviour exactly across all 36 existing hermetic call sites"
    requirement: "BL-01"
    verification:
      - kind: integration
        ref: "cargo test -p core --test status_transitions (22 passed), cargo test -p core --test forge_live_chain (9 passed), cargo test -p core --test forge_board_flags (8 passed) — unchanged assertions"
        status: pass
    human_judgment: false
  - id: D5
    description: "HI-01: forge/mod.rs no longer claims forge_and_repo_path spawns nothing when its detection fallback spawns one bounded local git remote get-url origin"
    requirement: "HI-01"
    verification:
      - kind: other
        ref: "grep -c 'spawns one bounded local' packages/core/src/forge/mod.rs == 2; grep -c 'spawns nothing' packages/core/src/forge/mod.rs == 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "MED-02: the scheduler's restructured three-phase forge tick (forge_tick_targets -> poll_forge_targets -> apply_forge_results) is covered by 4 new tests, where previously it had zero"
    requirement: "MED-02"
    verification:
      - kind: unit
        ref: "cargo test -p desktop forge_tick_tests (4 passed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "No regression anywhere in the workspace: cargo test --workspace reports 973 passed (969 baseline + the 4 new scheduler tests), 0 failed"
    verification:
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false

# Metrics
duration: ~40min
completed: 2026-10-05
status: complete
---

# Quick Task 261005-mn5 Summary

**Compare-and-swap on the forge tick's status write (`expected_status: Option<&str>`), closing the lost-update race plan 07-11's lock-release restructure opened — plus a corrected `forge_and_repo_path` doc comment and the scheduler's first test coverage.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-10-05T08:25:00Z (approx.)
- **Completed:** 2026-10-05T09:03:35Z
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments

- Proved the race **red** first, against today's unfixed `apply_forge_observation` (4-arg) signature: a task moved to `in_review` with an `Open` baseline, manually moved to `in_progress` inside the simulated lock-release window, then hit with a stale `Merged` observation — captured panic `left: "done", right: "in_progress"`, with the log saved at `${TMPDIR:-/tmp}/bl01-red.log`. No production code touched in this step.
- Added `expected_status: Option<&str>` as a fifth parameter to `apply_forge_observation` (`packages/core/src/forge/transitions.rs`) — a compare-and-swap precondition on the status write. `None` reproduces the pre-change behaviour exactly (all 36 existing hermetic test call sites get a literal `, None`); `Some(s)` refuses the write unless the task is still at `s` when the write actually runs.
- The `forge.state_changed` event still fires unconditionally on a refusal, so the restart-safe baseline advances to `Merged` (terminal) and the next tick never re-observes the edge or retries the overwrite. A refused write appends exactly one new `forge.status_write_skipped` event — carrying the expected/actual/intended status and a human-readable `label` — and never the unmet-acceptance-criteria event, since the task never reached `done`.
- Threaded a captured `status_at_poll: String` field through `ForgePollTarget` and `ForgePollResult` in `packages/desktop/src-tauri/src/scheduler.rs`, read under the lock in `forge_tick_targets`, carried lock-free through `poll_forge_targets`, and passed as `Some(&result.status_at_poll)` into `apply_forge_observation` from `apply_forge_results` — the value whose survival across the lock-release window is what makes the compare-and-swap real.
- Turned the Task 1 regression test green, and added three siblings in a new `scheduler::forge_tick_tests` module: `forge_tick_targets_captures_each_tasks_status_as_of_the_read`, `poll_forge_targets_threads_the_captured_status_into_each_result` (exercised with `projects.forge = 'local'`, no subprocess at all), and `a_merged_observation_still_carries_an_unmoved_task_to_done` (proves the guard is a precondition, not a blanket refusal).
- Corrected `forge/mod.rs`'s module header (fourth rule) and `forge_and_repo_path`'s own doc comment, both of which falsely claimed the function spawns nothing. It issues no forge CLI call and no network call, and spawns no process at all on the stored-override arms — but on the detection fallback (`projects.forge` is `NULL`) it spawns one bounded local `git remote get-url origin`, tolerated because a local config read bounded by `GIT_TIMEOUT_SECS` cannot produce the unbounded freeze the resolution/dispatch split exists to prevent.
- Ran `cargo test --workspace`: 973 passed, 0 failed (969 baseline + the 4 new scheduler tests) — the real completeness gate on the 37-call-site signature ripple.

## Task Commits

Each task was committed atomically:

1. **Task 1: Prove the race red — one failing test against today's unfixed code** - `cb0c5f9` (test)
2. **Task 2: Compare-and-swap the status write, and turn the red test green** - `60e12a4` (fix)
3. **Task 3: Correct forge_and_repo_path's false spawn claim, then prove the whole workspace** - `31683e7` (docs)

## Files Created/Modified

- `packages/core/src/forge/transitions.rs` - Added `EVENT_FORGE_STATUS_WRITE_SKIPPED`, the `expected_status` compare-and-swap parameter, the permitted/refused branch, and an updated module header paragraph
- `packages/desktop/src-tauri/src/scheduler.rs` - Added `status_at_poll` to `ForgePollTarget`/`ForgePollResult`, read/threading/pass-through across the three tick phases, and the new `forge_tick_tests` module (4 tests)
- `packages/core/src/forge/mod.rs` - Corrected the false "spawns nothing" claim in two places to the real "spawns one bounded local `git`" invariant
- `packages/core/tests/status_transitions.rs` - 24 call sites gained a literal `, None` fifth argument
- `packages/core/tests/forge_live_chain.rs` - 5 call sites gained a literal `, None` fifth argument
- `packages/core/tests/forge_board_flags.rs` - 7 call sites gained a literal `, None` fifth argument

## Decisions Made

See `key-decisions` in frontmatter (D1, D4, D3 [renumbered as D-skip], D6, D7, D8 from the plan's "Decisions made at planning time" section) — all eight were settled at planning time by direct code reading and were followed as locked; none were re-derived or changed during execution.

## Deviations from Plan

None - plan executed exactly as written. The two test assertions for `task.status_changed` event counts (added beyond the plan's literal text, to prove D4's no-retry property per the `<behavior>` block) needed a before/after delta rather than an absolute count, since the fixture's own setup moves (`in_review`, then the manual move) also append `task.status_changed` events — this is a test-correctness fix within Task 2's own scope, not a deviation from the plan's intent, and is recorded here for completeness rather than as a Rule 1-4 deviation.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BL-01, HI-01 and MED-02 are closed. HI-02, MED-01 and LOW-01 from the same review remain filed under `.planning/todos/pending/` and were deliberately out of scope here.
- The scheduler's forge tick now has real test coverage; any future restructure of `run_forge_tick`'s three phases has a regression gate to run against.
- No blockers for subsequent work.

---
*Phase: quick*
*Completed: 2026-10-05*

## Self-Check: PASSED

All 6 modified source/test files confirmed present on disk; this SUMMARY.md confirmed present on disk; all three task commits (`cb0c5f9`, `60e12a4`, `31683e7`) confirmed in git history.
