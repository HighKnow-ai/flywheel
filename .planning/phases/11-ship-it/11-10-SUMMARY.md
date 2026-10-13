---
phase: 11-ship-it
plan: 10
subsystem: dispatch
tags: [rust, rusqlite, dispatch, launch, attribution, case-folding, tdd]
requires:
  - phase: 11-ship-it
    provides: "11-09 spawn_prepared_run extraction, fail_launch, register drain of D-REV-37/38/45/46"
provides:
  - D-REV-39 (seven findings) drained, one corrected as wrongly filed, residuals filed as D-REV-58
  - D-REV-44 closed: the launch and the dispatcher read one observed case flag
affects: [11-21 register closure pass]
actuals:
  tokens: 19200
  tasks: 3
  commits: 8
plan_head_before: 85bf6c85ab01b4933327a496c9dce4cc8e758cc8
commits: 8
tech-stack:
  added: []
  patterns:
    - "A subprocess answer a command needs is read as: short lock for the path, drop, probe, re-lock (plan_fold_case, observed_fold_case)"
    - "A core function that probes itself keeps its signature; a *_with twin takes the probe's answer for callers that hold the lock"
    - "Automatic is derived from the initiating actor's type (system), not passed beside it"
key-files:
  created: []
  modified:
    - packages/core/src/dispatch.rs
    - packages/core/src/dispatch_exec.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/src/domain/file_set.rs
    - packages/core/src/file_set.rs
    - packages/core/src/limit_gate.rs
    - packages/core/tests/dispatch_auto_merge.rs
    - packages/core/tests/dispatch_limit_gate.rs
    - packages/core/tests/dispatch_plan.rs
    - packages/core/tests/scope_widen.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src-tauri/src/commands/file_set.rs
key-decisions:
  - "A hand-run task is ADOPTED by decide (its ending is merged or recorded), not merely left alone, because leaving it would strand the wave silently in 'planned'."
  - "Who started a run is read from the run's trigger actor type, so no new column was added. Runs the dispatcher started before this plan carry a human trigger and read as hand-run."
  - "The merge flap is fixed by not leaving 'needs_attention' during a retry, so the existing dedupe in mark_needs_attention is the guard. No timer, backoff or column."
  - "Unicode lowercase, not full case folding or NFC/NFD: the latter needs a normalisation crate."
requirements-completed: [DIST-04]
status: complete
duration: 190min
completed: 2026-10-13
---

# Phase 11 Plan 10: Drain D-REV-39 and D-REV-44 Summary

**A failing merge is recorded once, a task the user ran by hand is adopted instead of relaunched, `git config` no longer runs under the database lock, the dispatcher's launches belong to the system actor, and the launch and the dispatcher judge a pair of paths with one observed case flag.**

## Performance

- **Duration:** about 190 min, most of it waiting on workspace builds (a cold desktop test build is 7 min)
- **Completed:** 2026-10-13T07:53Z
- **Tasks:** 3 (executed as one set of changes, see Task notes)
- **Files modified:** 14, all under `packages/`

## Register mapping (for plan 11-21)

D-REV-39 held seven findings. The register text lists them in a different order from the review that produced them (`git show 2360e24:.planning/phases/09-planned-fan-out-that-does-not-collide/09-REVIEW.md`).

| Finding | Outcome | Evidence |
| --- | --- | --- |
| WR-03 leaked cap slot after a post-insert launch error | Closed by plan 11-09, not by this plan | 11-09 SUMMARY, `fail_launch` tests |
| WR-04 failing merge flaps and appends an event each tick | Fixed | `dispatch_auto_merge.rs::a_persistently_failing_merge_appends_one_event_and_does_not_flap`; RED `87098b1` (4 events, wanted 1), fix `c462799` |
| WR-05 `is_startable` relaunches a hand-run task | Fixed | `a_task_the_user_ran_by_hand_is_not_relaunched_and_its_finished_work_is_adopted`, `a_dispatcher_started_task_held_by_the_limit_is_still_retried`, `a_manual_run_older_than_the_plan_does_not_stop_the_plan_starting_the_task`; commit `da612e3` |
| WR-07 `AppState.db` held across `git config` | Fixed for every command path; two sites left, see below | `no_desktop_command_runs_the_case_probe_under_the_database_lock` (source gate, mutation-checked), `the_observed_case_flag_is_the_repositorys_core_ignorecase`; commit `20e72cf` |
| IN-01 dead code | Corrected, one of three was not dead | below |
| IN-02 unattended spawns attributed to the human | Fixed | `an_unattended_start_is_attributed_to_the_system_actor_and_a_manual_one_to_the_human` (core), `a_dispatcher_launch_is_attributed_to_the_system_actor_and_a_manual_launch_to_the_human` (desktop); RED `ae1a769`, GREEN `20e72cf` |
| IN-03 ASCII-only case fold errs lax | Fixed for case; normalisation and the unreadable-flag default not fixed | `launch_conflict_folds_non_ascii_case_so_the_strict_side_wins` (fails on the old fold, checked) |
| D-REV-44 launch and dispatcher disagree on a case-only pair | Fixed | `scope_widen.rs::the_launch_and_the_dispatcher_agree_on_a_case_only_pair_for_either_case_flag`, desktop `a_case_only_pair_is_judged_by_the_flag_the_launch_is_given` |

The register is updated: D-REV-39 and D-REV-44 are `status: resolved` with a RESOLVED paragraph each, and D-REV-58 holds what was not fixed.

### IN-01: the dead-code claim, checked

Zero-caller greps over `packages` (`.rs`, `.ts`, `.tsx`), run after the removals:

```
$ grep -rnw "may_merge\|hold_for_limit" packages ...        (no output, exit 1)

$ grep -rnw "EDGE_CAUSE_WIDEN" packages ...
packages/core/tests/dispatch_plan.rs:12:    ... EDGE_CAUSE_WIDEN,
packages/core/tests/dispatch_plan.rs:414:        cause: EDGE_CAUSE_WIDEN.into(),
packages/core/src/dispatch.rs:46:pub const EDGE_CAUSE_WIDEN: &str = "widen";
packages/core/src/domain/file_set.rs:574:    use crate::dispatch::{DispatchEdge, EDGE_CAUSE_WIDEN};
packages/core/src/domain/file_set.rs:619:                cause: EDGE_CAUSE_WIDEN.to_string(),
```

- `EDGE_CAUSE_WIDEN` is **register correction, not a deletion.** `record_widen_sequencing` (`file_set.rs:619`) writes it. The register's "dead" was wrong for this name.
- `may_merge` and `hold_for_limit` had no non-test caller before removal (their only references were `dispatch_limit_gate.rs:14, 286, 290, 394`). Removed in `f23917b`. They had test callers, so those tests were rewritten rather than dropped: the paused-gate-still-merges rule is asserted through `decide` by the existing `a_paused_gate_spawns_nothing_but_still_merges`, and the limit-held state is now asserted through `decide` by `a_dispatcher_started_task_held_by_the_limit_is_still_retried` (gate pauses, run fails, task reads `held_by_limit`, gate resumes, task spawns). That path had no test before; the removed helper's test only exercised a one-line wrapper.

### Every `git config` call site

The plan's verify command (`grep -rn "git config"` over `core/src` and `desktop/src-tauri/src`, comment lines removed) prints one line: `commands/dispatch.rs:315`, a trailing comment on `plan_fold_case` (`// before the lock: it runs git config`). It is not a call. The real call sites are `git` invoked with `config` as an argument, found by `grep '"config"'`:

| Site | Lock state | Status |
| --- | --- | --- |
| `domain/file_set.rs` `repo_is_case_insensitive` (`git config --get core.ignorecase`), the single probe | n/a | now `pub` |
| `commands/dispatch.rs` `plan_fold_case`, used by `plan_dto_unlocked` and `dispatch_plan_approve` | path read under a short lock whose guard drops at the end of the closure, then probe, then re-lock | fixed |
| `commands/file_set.rs` `task_file_set_widen` | same shape, probe before `state.db.lock()` | fixed |
| `commands/agent_run.rs` `observed_fold_case`, used by `launch_run_for_task` | same shape; the flag is then passed into `prepare_launch`, `start_agent_run_recording_first`, `arm_run_scope` | fixed |
| `dispatch_exec.rs` `begin_planning_run_with` | probe runs after the first lock block ends and before the second lock; the closure receives the answer | fixed (was probing inside the run's transaction) |
| `domain/dispatch_plan.rs` `preview_edges`, `approve_plan`; `domain/file_set.rs` `widen_file_set`, `arm_scope_marker` | probe inside the function | unchanged and now called by core tests only; the source gate forbids them in the command files |
| `git_facts.rs:369` (`observe`) | no connection in scope by design | unchanged, already correct |
| `drift.rs:348` (`scope_backstop_git`) | `sidecar.rs` ends the lock block before calling it | unchanged, already correct |
| `git_hooks.rs` (six `git config core.hooksPath` read/write sites), reached from `register_project` / `relocate_project` | `project_register` and `project_relocate` hold `AppState.db` across them | **NOT fixed**, filed as D-REV-58. Phase 7/12 code, once per registration, and `destructive_gate_layer_coverage.rs` pins how the install is routed |

## Task notes

**Task 1 (WR-04, WR-05).** The plan said the flap needs "a duplicate-write guard comparing against the last recorded failure". One already exists: `mark_needs_attention` skips when the task is `needs_attention` with the same kind and sentence. The flap happened because `merge_task` set `merging` first, so on the second tick the dedupe saw `merging`. The fix is that a task already in `needs_attention` stays there while its merge is retried. No new guard was added. The failing test is genuine RED: four events where one was wanted.

For WR-05 the plan's wording ("not relaunched while its run is live") describes something that was already true: `readiness` refuses `HasLiveRun`. The real bug is after the hand-run ends, when `planned` is startable again. `is_startable` now refuses a task whose latest run's trigger actor is human and started at or after the plan was created, and `decide` treats that task as `running` for the finished-run branch.

**Task 2 (attribution, locks, dead code, case).** The system-actor and automatic flag live in `start_agent_run`: the flag is derived from the initiating actor's type, so the two cannot disagree. A dispatcher start now writes the trigger's `created_by`, the worktree's `created_by` and the `worktree.created` event under the system actor, puts `{"automatic":true}` in the trigger's `config`, and `automatic: true` in the `agent_run.started` payload. `prepare_launch` picks the actor from `CrossTaskConflict` (`Refuse` is the dispatcher's launch, documented as such). `agent_runs.actor_id` stays the agent actor (D-29).

**Task 3 (D-REV-44).** `prepare_launch` takes `fold_case`. To keep the flag off the database lock the whole chain needed it threaded (`start_agent_run_recording_first`, `arm_run_scope`, `arm_scope_marker_with`), which is why the desktop file list is longer than the plan's.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Files outside the plan's list**
- **Found during:** Tasks 2 and 3
- **Issue:** The lock rule could not be met by editing only the listed files. The case fold lives in `core/src/file_set.rs`, not `domain/file_set.rs`. The probe is reached through `domain/dispatch_plan.rs`, `dispatch_exec.rs` and three command files.
- **Fix:** Added `*_with` twins (`preview_edges_with`, `approve_and_start_with`, `widen_file_set_with`, `arm_scope_marker_with`) and two read-only path helpers (`plan_repo_path`, `task_repo_path`). Existing signatures are unchanged, so about 70 call sites in tests did not move. `begin_planning_run_with`'s closure gained a third argument (one test call updated).
- **Files modified:** see key-files
- **Commit:** `20e72cf`

**2. [Rule 1 - Bug] The new desktop test broke `supervisor_cwd.rs`**
- **Found during:** full core run
- **Issue:** `the_observed_case_flag_is_the_repositorys_core_ignorecase` built its own `Command::new("git")`; `supervisor_cwd.rs` pins every git command to `core/src/git.rs`.
- **Fix:** use `flywheel_core::git::git_at`.
- **Commit:** `4bd6320`

**3. [Rule 2 - Missing critical] Source gate for the lock rule**
- **Issue:** only `observed_fold_case` had a behavioural test; nothing stopped a command regaining a self-probing call.
- **Fix:** `no_desktop_command_runs_the_case_probe_under_the_database_lock`, mutation-checked by reintroducing `widen_file_set(` in `commands/file_set.rs` (it failed, then the file was restored).
- **Commit:** `39e09df`

**Total deviations:** 3 auto-fixed. **Impact:** scope widened by the `*_with` plumbing; no behaviour change beyond the eight findings.

### A decision the owner may want to veto

Adoption (WR-05) means a finished run the user started by hand, on a task that is in an approved plan, is merged automatically (system actor, `automatic: true`, no review), as a dispatcher run would be. The alternative, refusing to relaunch and doing nothing else, leaves the task in `planned` forever and holds its wave with no message. If the owner wants hand-run work reviewed first, change the `running` mapping in `decide` to a needs-attention cause instead.

## Issues Encountered

**A run of the flap test failed once under load, unexplained.** During a four-way parallel run of every core test binary, `a_persistently_failing_merge_appends_one_event_and_does_not_flap` counted 2 events instead of 1. In the same window the stubbed `gh` calls in `forge_*` were killed at their 30 s limit and `lock_contention` hit its deadline, so the machine was badly overloaded. I could not reproduce it: the test passed alone, six copies at once, four whole-binary copies at once, and under ten busy loops. I did not capture the payloads of the failing run. My hypothesis, not proven, is that a git call timed out or retried and produced a different cause sentence, which `mark_needs_attention` correctly treats as a new record. The test now prints every recorded cause when it fails. The five other binaries that failed in that overloaded run (`forge_degrade`, `forge_epic_request_ordering`, `forge_live_chain`, `lock_contention`, `supervisor_cwd`) pass when run normally; `supervisor_cwd` was the real defect above.

**`packages/core/tests/credentials.rs` was not run to completion, and my killing it touched the owner's Keychain.** It hung for 9 min 37 s in the full run (no output; it exercises the real macOS Keychain entry `com.highknow.flywheel` / `anthropic-api-key`). I killed it with SIGTERM, so its restore-on-Drop guard did not run, and it left its fixture value in that entry. I confirmed the entry held exactly the fixture string `sk-ant-test-fixture-0001` (compared with `grep -c`, not printed) and deleted the entry. **What I cannot know:** whether a real key was stored there before the run. If one was, the test captured it in memory and it is gone. The owner's recorded position is that Flywheel does not use an API key, so I judge that unlikely, but the owner should check. This is not caused by this plan's code; the lesson is not to SIGTERM that binary.

**`authoring_lifecycle`, the known flaky test, did not fail in any run.**

## Verification

- `cargo test -p core --test dispatch_auto_merge`: 53 passed (46 before this plan, plus 7 new: the flap, three for hand-run tasks, attribution, non-ASCII, the source gate).
- `cargo test -p core --test scope_widen`: includes the new D-REV-44 test.
- `cargo test -p desktop -p flywheel-shim -p relay-client`: 143 desktop tests pass (three new), shim and relay-client green.
- Every core test binary except `credentials.rs`: all pass, with the one load-induced failure above and the five rechecked in isolation.
- `cargo clippy --workspace --all-targets`: exit 0. No unused-item warning for the removed names. Remaining warnings predate this plan.
- Plan acceptance greps: `fold_case = true` outside comments in `agent_run.rs` returns `0`; `pub fn repo_is_case_insensitive` returns `1`.
- `cargo test --workspace` as one command was not completed, because of the `credentials.rs` hang; the substitute is the per-binary run above.

## Known Stubs

None.

## Threat Flags

None. T-11-30 (attribution) is mitigated with tests for both paths. T-11-31 (lock) is mitigated for every command path and pinned by a source gate; the `git_hooks` registration path is the stated exception (D-REV-58). T-11-32 (case fold) is mitigated for case, not for normalisation (D-REV-58).

## Self-Check: PASSED

- Commits present: 87098b1, c462799, ae1a769, da612e3, 20e72cf, f23917b, 4bd6320, 39e09df (`git rev-list --count 85bf6c8..HEAD` is 8 before this summary's own commit).
- No uncommitted change under `packages/`.
