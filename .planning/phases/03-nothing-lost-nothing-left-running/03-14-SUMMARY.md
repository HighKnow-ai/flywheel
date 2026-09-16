---
phase: 03-nothing-lost-nothing-left-running
plan: 14
subsystem: security
tags: [rust, destructive-gate, git, permission-socket, classifier]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-07's classify_push/classify_branch/classify_rm module and the shim's destructive_gate wiring; 03-04/03-08's shared git_retry/shim path"
provides:
  - "classify_push detects the delete family (--delete, -d, empty-source colon refspec) and returns BranchDeletion regardless of which branch is named"
  - "classify_push detects the leading-plus force refspec (+feature, +feature:feature) as ForcePush"
  - "An end-to-end proof (run_shim_as_git) that the real built shim binary raises a real permission request carrying destructiveCategory: branch-deletion on the wire and never executes git when denied"
affects: [03-16 (PermissionRequestCard's branchDeleteTarget, now reachable because a push can produce BranchDeletion), 03-VERIFICATION.md's Success Criterion 5]

# Actuals (#2632)
actuals:
  tokens: 4723
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "classify_push's early-return ordering is now delete > default-branch > force, documented inline, so the category selected always matches the more severe/accurate consequence sentence"

key-files:
  created: []
  modified:
    - packages/core/src/destructive.rs
    - packages/core/tests/destructive_classifier.rs

key-decisions:
  - "A delete-shaped push targeting the default branch (git push origin :main) classifies as BranchDeletion, not DefaultBranchPush — the delete check is the first of classify_push's three early returns, ahead of the default-branch check, per the plan's own explicit instruction. No prior test asserted this shape, so no existing expectation changed."
  - "Task 3 (leading-plus force refspec) was kept, not dropped — it closes the same fail-open class in the same function, found while reading it for Task 1, and the plan marked it separable but in-scope for this run."
  - "run_shim_as_git's scratch repository is created with `git init -q -b main` (not the bare `git init -q` the plan's action text shows) because this machine has no `init.defaultBranch` global config, so a bare `git init` names the branch `master`, not `main` — the test's own default_branch argument is `main`, so the checkout of `main` after creating `feature` would otherwise fail. Found by a real failing test, not anticipated by the plan."

patterns-established:
  - "End-to-end shim_gate proofs for `git` (not just `rm`) now exist — run_shim_as_git mirrors run_shim_as_rm exactly, so a future destructive-gate change to any git subcommand has a template to extend rather than invent."

requirements-completed: [AGNT-07, WORK-04, WORK-05]

coverage:
  - id: D1
    description: "A delete-shaped push (--delete, -d, or the empty-source colon refspec) on ANY branch classifies as Verdict::Destructive(DestructiveCategory::BranchDeletion), never Safe."
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#delete_shaped_push_long_form_flag_on_a_non_default_branch"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#delete_shaped_push_short_form_flag_on_a_non_default_branch"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#delete_shaped_push_empty_source_colon_refspec_on_a_non_default_branch"
        status: pass
      - kind: other
        ref: "FLYWHEEL_DEFAULT_BRANCH=main cargo run --quiet -p flywheel-shim -- --classify-command 'git push origin --delete feature' -> branch-deletion"
        status: pass
    human_judgment: false
  - id: D2
    description: "A delete-shaped push whose target IS the default branch classifies as BranchDeletion, not DefaultBranchPush — the delete check outranks the default-branch check."
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#delete_shaped_push_long_form_flag_takes_priority_over_default_branch_push_on_the_default_branch"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#delete_shaped_push_colon_refspec_takes_priority_over_default_branch_push_on_the_default_branch"
        status: pass
    human_judgment: false
  - id: D3
    description: "The real built shim binary, invoked as git with a delete-shaped push against a real permission socket, raises a request whose wire payload carries destructiveCategory: branch-deletion; a deny answer means the real git binary named by FLYWHEEL_REAL_GIT is never executed."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/core/tests/destructive_classifier.rs#shim_gate::a_delete_shaped_push_raises_a_branch_deletion_request_and_is_never_executed_on_deny"
        status: pass
    human_judgment: false
  - id: D4
    description: "A leading-plus force refspec (+feature, +feature:feature) classifies as ForcePush; the delete family still outranks it; an ordinary src:dst refspec with no leading plus stays Safe."
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#force_push_leading_plus_refspec_with_explicit_destination"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#force_push_leading_plus_refspec_still_loses_to_branch_deletion"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs#safe_refspec_with_no_leading_plus_is_not_a_force_push"
        status: pass
      - kind: other
        ref: "FLYWHEEL_DEFAULT_BRANCH=main cargo run --quiet -p flywheel-shim -- --classify-command 'git push origin +feature:feature' -> force-push"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every push shape classified before this change keeps its verdict exactly, and the workspace's shared shim/classifier path (lock_contention.rs, spawn_stagger.rs — WORK-04/WORK-05's evidence) stays green."
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "cargo test --workspace (388+21 = full suite, every `test result:` line ok, including lock_contention.rs 6/6 and spawn_stagger.rs 5/5)"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-09-16
status: complete
---

# Phase 03 Plan 14: Delete-Shaped Push Gap Closure Summary

**`classify_push` now detects the delete family (`--delete`/`-d`/`:branch`) and the leading-plus force refspec, closing 03-VERIFICATION.md's Success Criterion 5 FAILED gap.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-16T04:33:00Z (approx.)
- **Completed:** 2026-09-16T04:55:40Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `classify_push` gains a `delete` boolean (long `--delete` flag, short `-d` flag, and an
  empty-source colon-refspec check on the positional vector) as the FIRST of its three early
  returns — ahead of `targets_default` and `force` — so `git push origin :main` now reads
  `BranchDeletion`, not `DefaultBranchPush`.
- An end-to-end proof (`run_shim_as_git`, mirroring the existing `run_shim_as_rm`) drives the real
  built shim binary as `git` against a real mock permission socket, asserting the wire payload's
  `destructiveCategory` field equals `branch-deletion` and that a `deny` answer exits non-zero
  without ever touching `FLYWHEEL_REAL_GIT`.
- `classify_push` also folds a leading-plus positional (`+feature`, `+feature:feature`) into its
  existing force early-return (Task 3, kept — not dropped), closing the same fail-open class found
  while reading the function for Task 1.
- 21 new/extended `#[test]` functions pin every delete spelling, the default-branch precedence
  rule, clustered short flags (`-fd`), the plus-refspec forms, and the full non-regression set.

## Task Commits

Each task was committed atomically (Task 2 and 3 followed the RED→GREEN TDD split where a RED
phase actually failed; see "TDD Gate Compliance" below):

1. **Task 1: A delete-shaped push reaches the gate — classifier through shim through socket** - `804c017` (feat)
2. **Task 2: Pin every delete spelling, the precedence rule, and the non-regression set** - `5fb2188` (test)
3. **Task 3a: Add failing tests for the leading-plus force refspec (RED)** - `674e798` (test)
4. **Task 3b: classify_push detects the leading-plus force refspec (GREEN)** - `296fb5d` (feat)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified
- `packages/core/src/destructive.rs` — `classify_push` gains delete-family detection (first
  early-return) and leading-plus-refspec force detection (folded into the existing force
  early-return), each documented inline with the precedence rationale.
- `packages/core/tests/destructive_classifier.rs` — 21 new tests (10 delete-shaped-push shapes, 5
  plus-refspec shapes, 1 end-to-end shim_gate proof, plus supporting helper changes:
  `spawn_mock_permission_server` now returns the whole parsed `serde_json::Value` request instead
  of only `requestId`, and `resolve_system_git`/`run_shim_as_git` mirror the existing `rm`
  helpers). Test count: 60 (baseline) → 61 (Task 1) → 71 (Task 2) → 76 (Task 3).

## Decisions Made
- The delete check outranks the default-branch check inside `classify_push`, per the plan's
  explicit instruction: the consequence sentence a human reads is chosen by category, and
  describing a deletion as a push would be materially wrong. `git push origin :main` now reads
  `BranchDeletion`. No prior test asserted this shape, so nothing regressed.
- Task 3 was kept (not dropped) — see Deviations below, it required no scope change, just
  confirmation it was worth doing in this same run.
- `run_shim_as_git`'s scratch repo uses `git init -q -b main` rather than a bare `git init -q`, to
  make the branch name match the test's own `default_branch` argument on a machine with no
  `init.defaultBranch` global config (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `run_shim_as_git`'s end-to-end test used `git init -q` without `-b main`, and the checkout of `main` failed on this machine**
- **Found during:** Task 1 (writing the `shim_gate` end-to-end test)
- **Issue:** This machine has no `init.defaultBranch` global git config, so a bare `git init -q`
  names the initial branch `master`. The test's own `default_branch` argument to `run_shim_as_git`
  is `"main"`, and the test script explicitly does `git checkout -q main` after creating and
  leaving the `feature` branch — that checkout failed because no `main` branch existed, causing
  the whole test to panic before ever reaching the shim invocation.
- **Fix:** Changed the scratch-repo init call to `git init -q -b main`, which explicitly names the
  initial branch regardless of the host's global config.
- **Files modified:** `packages/core/tests/destructive_classifier.rs`
- **Verification:** Re-ran `cargo test -p core --test destructive_classifier` — the test passes;
  full suite went from 60 → 61 passed, 0 failed.
- **Committed in:** `804c017` (part of Task 1's commit)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact on plan:** Necessary for the plan's own
Task 1 test to run at all on a machine without a global `init.defaultBranch`; no scope creep, no
change to any other file.

## TDD Gate Compliance

- **Task 2 (`type="auto" tdd="true"`):** Per the task's own instructions, the new tests were
  written and run against Task 1's already-updated `classify_push` before any further
  implementation change. All 10 new assertions passed immediately (Task 1's delete-family fix
  already covered every shape Task 2 pins) — there was no failing RED phase to record, and no
  further implementation change was needed. This is the outcome the task's own action text
  anticipated ("Any that fail indicate a shape Task 1 missed... fix classify_push"): none did.
  Committed as a single `test(03-14)` commit (`5fb2188`).
- **Task 3 (`type="auto" tdd="true"`):** Full RED→GREEN cycle observed and recorded:
  - RED: `674e798` (`test(03-14): add failing tests for the leading-plus force refspec`) — 3 of
    the 5 new assertions failed against the pre-Task-3 classifier (`left: Safe, right:
    Destructive(ForcePush)`), confirmed by running
    `cargo test -p core --test destructive_classifier force_push_leading_plus` before any
    implementation change.
  - GREEN: `296fb5d` (`feat(03-14): classify_push detects the leading-plus force refspec`) — all
    76 tests pass.
  - REFACTOR: none needed; the fix is a single boolean folded into the existing force condition.

## Issues Encountered
None beyond the one deviation documented above.

## Measured Before/After (per plan's own `<output>` instruction)

| Command | Before (HEAD) | After |
|---|---|---|
| `git push origin --delete feature` | `safe` | `branch-deletion` |
| `git push origin -d feature` | `safe` | `branch-deletion` |
| `git push origin :feature` | `safe` | `branch-deletion` |
| `git push origin +feature:feature` | `safe` | `force-push` |
| `git push origin HEAD:main` | `default-branch-push` | `default-branch-push` (unchanged) |
| `git branch -D feature` | `branch-deletion` | `branch-deletion` (unchanged) |
| `git push --force origin feature` | `force-push` | `force-push` (unchanged) |
| `rm -rf /tmp/x` | `recursive-delete` | `recursive-delete` (unchanged) |
| `git push origin --delete main` (default `main`) | `default-branch-push` | `branch-deletion` (deliberately changed — Task 1's precedence rule) |
| `git push origin feature:feature` | `safe` | `safe` (unchanged — no leading plus) |
| `git push origin --delete +feature` | `safe` | `branch-deletion` (delete wins over the plus) |

`destructive_classifier` test count: 60 (baseline) → 61 (Task 1) → 71 (Task 2) → 76 (Task 3, final).

`cargo test --workspace`: every suite's `test result:` line reads `ok`, including
`lock_contention.rs` (6/6) and `spawn_stagger.rs` (5/5) — WORK-04/WORK-05's evidence unaffected by
the shared shim/classifier path change.

Task 3 (the leading-plus force refspec) was **kept**, not dropped — it closed a hole of the same
fail-open class found while reading `classify_push` for Task 1.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Success Criterion 5 (AGNT-07) is now expected to VERIFY on re-run of the phase verifier: no
  shape of remote branch deletion returns `Verdict::Safe`, and every shape is exercised by a
  passing test, including a real end-to-end proof through the built shim binary and a real
  permission socket.
- Plan 03-16 (sibling gap-closure plan) can now proceed meaningfully: `PermissionRequestCard.tsx`'s
  `branchDeleteTarget` fix is reachable because a delete-shaped push now actually produces
  `branch-deletion` instead of `safe`.
- No frontend files were touched by this plan, per the parallel-sibling boundary note in this
  plan's own prompt.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-16*
