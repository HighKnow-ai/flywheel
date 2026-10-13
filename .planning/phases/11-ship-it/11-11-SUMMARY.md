---
phase: 11-ship-it
plan: 11
subsystem: dispatch
tags: [rust, dispatch, scope, tauri, react, tdd]
requires:
  - phase: 11-ship-it
    provides: "11-10 hand-run adoption (D-REV-59), file_set record_backstop_denials, dispatcher decide/after_completed_run"
provides:
  - D-REV-41 closed: retry_task and skip_task, human-only, with the stuck cause and the sheet UI
  - D-REV-42 cheap half closed: an observed scope breach holds the automatic merge
affects: [11-21 owner pass]
actuals:
  tokens: 21000
  tasks: 2
  commits: 5
plan_head_before: 3ab6a35d9a0ca9418f21e78db441c68a916c6cbf
commits: 5
tech-stack:
  added: []
  patterns:
    - "A needs-attention cause is an AttentionCause variant: kind, phase and sentence in one place"
    - "A breach belongs to the run that caused it: read against the task's latest run id, so a retry is judged on its own run"
key-files:
  created:
    - packages/desktop/src/dispatch/__tests__/stuck-task.test.tsx
  modified:
    - packages/core/src/dispatch.rs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/tests/dispatch_auto_merge.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/dispatch/WavePlanSheet.tsx
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "A recorded human merge releases the scope-breach hold, so the Phase 8 review-and-merge path is the way out; a second skip or retry verb was not added for needs_attention."
  - "The breach is read against the task's latest run, not every run, so a retried task is not held by the failed run it replaces."
requirements-completed: [DIST-04]
status: complete
duration: resumed run, about 40 min after a stalled executor
completed: 2026-10-14
---

# Phase 11 Plan 11: Stuck-task exits and the observed-breach hold Summary

**A failed, stopped or conflicting task can be retried or skipped from the wave plan sheet by a human only, and a run whose out-of-scope write was found at session close is held as needs-attention instead of merging automatically.**

## Resumed execution

A previous executor completed Task 1 (`47e9f68` red, `695f19b` green) and stalled partway into Task 2; it was killed. This run did not redo Task 1. It inherited and kept two uncommitted files: the Task 2 RED tests in `dispatch_auto_merge.rs` (+75 lines) and the untracked `stuck-task.test.tsx`. Task 1's roster sentence in `capabilities/default.json` was already committed and was not appended again.

## What was built

- **Core (D-REV-42, cheap half).** `AttentionCause::ScopeBreach { count, first }` (kind `scope_breach`, post-run). `after_completed_run` reads the task's latest run's `task.scope_denied` rows with `detected_after_the_fact = 1` and, if any, marks needs-attention once and emits no `Merge`. A recorded integrated merge skips the check, so a human merge releases the hold. The accepted D-REV-59 adopt path is untouched: it only differs when a breach was observed.
- **Adapter and UI (D-REV-41).** `retryTask` and `skipTask` in `adapters/tauri.ts`; `WavePlanSheet.tsx` renders Retry and Skip on `failed`, `stopped` and `conflict` (not on a draft), calls the wrapper once, shows the returned plan, and renders a rejection's own text on that task. No `invoke` in the component. The cause sentence was already rendered from `task.attention`, which Task 1 fills from `stuck_cause`.

## Test mapping

| Claim | Test |
| --- | --- |
| D-REV-41 retry | Task 1: `a_failed_task_is_retried_by_a_human_and_the_wave_then_drains`, `a_conflicted_task_is_retried_after_the_user_resolves_it_and_the_wave_drains`, `a_task_the_user_ran_by_hand_that_failed_is_started_again_only_by_a_retry` |
| D-REV-41 skip, refusals, not agent-reachable | Task 1: `a_stopped_task_is_skipped_and_this_and_every_later_wave_advance`, `retry_and_skip_refuse_by_name_outside_the_three_states_and_write_nothing`, `retry_and_skip_are_not_reachable_from_an_agent` |
| D-REV-42 held on breach | `a_run_with_an_out_of_scope_write_found_after_the_fact_is_not_merged_automatically` |
| Clean run still merges | `a_clean_run_still_merges_automatically` |
| Human merge releases the hold | `a_human_merge_after_the_breach_lets_the_wave_move_on` |
| Earlier run's breach does not hold a retry | `a_breach_in_an_earlier_run_does_not_hold_a_later_clean_run` |
| UI: cause, buttons, one call each, refusal text | `stuck-task.test.tsx` (5 tests) |

RED was observed for the two breach tests before the core change (two failed, 62 passed; the other two are guards and passed). For `stuck-task.test.tsx` I did not run it red myself: it was written by the stalled executor and I first ran it after the UI change, where it passes. It cannot have passed before, since it needs buttons that did not exist, but I did not observe that.

## Verification

- `cargo build --workspace` green; `cargo test -p core --test dispatch_auto_merge`: 64 passed, 0 failed.
- `npm --prefix packages/desktop test -- src/dispatch`: 4 files, 50 tests passed. `npm --prefix packages/desktop run build` green.
- `dispatch-layout` browser test (the 11-14 containment measurements): 20 passed, 1 expected fail (the pre-existing `it.fails`).
- `grep -rn "retry_task\|skip_task" packages/sidecar/src`: 0.
- NOT run: `cargo test --workspace` as a whole (known-flaky runner tests and `credentials.rs`, which writes to the real Keychain and hangs). Only the named binary above was run.

## Deviations from Plan

**1. [Plan gate too strict] The single-IPC-seam grep returns 3, not 0.**
`grep -rl "@tauri-apps/" ... | grep -v adapters/tauri.ts` lists `settings/__tests__/settings-surface.test.tsx`, `adapters/__tests__/changes-request-adapter.test.ts` and `session/__tests__/permission-card.test.tsx`. All three are pre-existing test files that mock the package; none is production code and none was touched here. I did not change them. The plan's gate wording counts tests, so it can never read 0 in this repository.

No other deviations.

## Still open (not closed by this plan)

D-REV-42's other half stays open, and this plan does not close it. Both items are in `.planning/DEFERRED-REVIEW.md` (`update_11-11` on `D-REV-42`, grepped and present at the entry) and routed to the plan 11-21 owner pass:

1. Bash writes are still only detected after the fact, not prevented, because the hook matcher cannot see `Bash`.
2. PLAN-04's wording ("prevented at the tool level") is still broader than the shipped behaviour, and REQUIREMENTS.md still marks it Complete unqualified. That is an owner decision about requirement wording.

Also unaddressed: a task held as `scope_breach` is `needs_attention`, which Retry and Skip refuse by design. The way out is a human merge through the Phase 8 path. There is no skip for it.

## Register

D-REV-41: `status: closed (2026-10-14, plan 11-11)` with an `update_11-11` line, grepped in `.planning/DEFERRED-REVIEW.md`. D-REV-42: status unchanged (`open`), `update_11-11` line added. D-REV-59 untouched.

## Known Stubs

None.

## Self-Check: PASSED

Commits `47e9f68`, `695f19b`, `4847a62`, `fed188c`, `07be615` present; `stuck-task.test.tsx` present; both `update_11-11` register lines present; Phase 08 UAT screenshots clean.
