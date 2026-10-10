---
phase: 09-planned-fan-out-that-does-not-collide
plan: 10
subsystem: dispatch
tags: [rust, tauri, react, sequencing, why, gap-closure]
requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "why / SequencingReason (09-03), readiness RunsAlone refusal (CR-02 fix), WavePlanSheet (09-09)"
provides:
  - "SequencingReason::RunsAlone: why answers truthfully for a same-wave pair that declared nothing"
  - "dispatch_why runsAlone kind and sentence (one-undeclared and both-undeclared wordings)"
  - "WavePlanSheet line on every non-skipped task with no declared files, in draft and read-only"
affects: [09-11, 09-12, 09-13, phase-09-verification]
actuals:
  tokens: 3500
  tasks: 2
  commits: 4
plan_head_before: dad01fed375e72523c54de454211a5ac93245d78
tech-stack:
  added: []
  patterns:
    - "Explanation reads the same rows (list_entries_for_task) the refusal reads, so they cannot disagree"
    - "Command body extracted to why_dto(&Connection, ...) so sentences are unit-testable without tauri State"
key-files:
  created: []
  modified:
    - packages/core/src/dispatch.rs
    - packages/core/tests/dispatch_plan.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src/dispatch/WavePlanSheet.tsx
    - packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx
key-decisions:
  - "RunsAlone carries Vec<String> of undeclared task ids (argument order), because the sentence differs for one versus both"
  - "The new cause lives only on why's no-edge, same-wave arm; the frozen-edge read and the different-waves arm are untouched"
  - "Sheet signal reuses wave-plan-note; no new CSS, no DTO field, no command"
requirements-completed: [PLAN-07]
coverage:
  - id: D1
    description: "why reports RunsAlone (naming the undeclared task or tasks) for a no-edge same-wave pair where either declared nothing"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/core/tests/dispatch_plan.rs#why_two_same_wave_tasks_that_declared_nothing_run_alone_not_disjoint"
        status: pass
      - kind: unit
        ref: "packages/core/tests/dispatch_plan.rs#why_one_undeclared_task_in_a_pair_names_only_that_task_in_either_argument_order"
        status: pass
    human_judgment: false
  - id: D2
    description: "A frozen edge, different waves, disjoint declared sets and not-in-plan answers are unchanged"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/core/tests/dispatch_plan.rs#why_a_frozen_edge_still_wins_after_both_declared_sets_are_emptied"
        status: pass
      - kind: unit
        ref: "packages/core/tests/dispatch_plan.rs#why_undeclared_tasks_in_different_waves_still_answer_different_waves"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/dispatch.rs#why_for_a_disjoint_declared_pair_keeps_its_exact_sentence"
        status: pass
    human_judgment: false
  - id: D3
    description: "dispatch_why returns kind runsAlone with a sentence naming the undeclared task key(s)"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/dispatch.rs#why_for_a_pair_that_declared_nothing_says_runs_alone_naming_both_keys"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/dispatch.rs#why_for_a_pair_with_one_undeclared_task_names_that_tasks_key_only"
        status: pass
    human_judgment: false
  - id: D4
    description: "Wave plan sheet shows a no-files-declared / runs-alone line on draft and read-only tasks, never on declared or skipped ones, and derives it only from entries and state"
    requirement: PLAN-07
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx#a task that declared no files (D-150, D-149)"
        status: pass
    human_judgment: false
duration: 30min
completed: 2026-10-10
status: complete
---

# Phase 9 Plan 10: why answers runs-alone on the default path Summary

**`why` now answers "runs alone, no declared file-set" for an undeclared same-wave pair instead of the false "disjoint sets", and the wave plan sheet shows the same fact on the task rows.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-10-10T09:25Z
- **Tasks:** 2 (a tracer and an auto task, both TDD)
- **Files modified:** 5

## Accomplishments

- Core: `SequencingReason::RunsAlone { undeclared_task_ids }`, returned from `why`'s no-edge same-wave arm when either task's `list_entries_for_task` is empty. The frozen-edge query is still first and unconditional; the different-waves arm is untouched.
- Command: `dispatch_why` maps it to `kind: "runsAlone"` with a key-naming sentence, no new DTO field.
- Sheet: one `wave-plan-note` line above the draft/read-only conditional, from `task.entries` and `task.state` only; skipped tasks get none.

## Task Commits

TDD order held (RED before GREEN, per D-REV-40, since the config gate cannot enforce it here):

1. **Task 1 RED** - `1c25e90` (test)
2. **Task 1 GREEN** - `416bbf3` (feat)
3. **Task 2 RED** - `254b22e` (test)
4. **Task 2 GREEN** - `190d692` (feat)

**Plan metadata:** docs commit follows this file.

## Files Created/Modified

- `packages/core/src/dispatch.rs` - `RunsAlone` variant and the no-edge branch of `why`
- `packages/core/tests/dispatch_plan.rs` - four new `why` cases (two-undeclared, one-undeclared both orders, frozen edge after sets emptied, different waves undeclared)
- `packages/desktop/src-tauri/src/commands/dispatch.rs` - `why_dto` extracted from `dispatch_why`; `runsAlone` arm; three command-layer tests
- `packages/desktop/src/dispatch/WavePlanSheet.tsx` - the no-files-declared line
- `packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx` - five cases

## Decisions Made

- The one-undeclared sentence is "FLY-2 has no declared file-set, so it runs alone and never shares a wave." The both-undeclared one is "Neither FLY-1 nor FLY-2 has a declared file-set, so each runs alone and never shares a wave." Both read naturally; no rewording needed.
- Sheet text is "No files declared, so this task runs alone." in the existing muted note style. No new CSS rule: `wave-plan-note` is the right class.

## Gap 1 coverage (09-VERIFICATION.md, D-REV-38)

Of gap 1's three `missing` items, this plan closed the first (the runs-alone cause in `why`) and the third (the sheet signal for a task with no declared set). The second, the widen-edge record, is plan 09-11.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted `why_dto` from `dispatch_why`**
- **Found during:** Task 1 (command-layer tests)
- **Issue:** `dispatch_why` takes a tauri `State<AppState>`, which a unit test cannot build, so the plan's two command-layer cases had nothing to call.
- **Fix:** Moved the body into `why_dto(&Connection, ...)`; the command validates ids, locks, and delegates. Behavior unchanged; the disjoint sentence is pinned byte-identical by a test.
- **Files modified:** packages/desktop/src-tauri/src/commands/dispatch.rs
- **Committed in:** `1c25e90`

**2. [TDD process] RED commit for Task 1 carries type scaffolding**
- A missing enum variant is a compile error, which is INVALID_RED, not RED. The RED commit therefore adds the `RunsAlone` variant, a stub `dispatch_why` arm (empty sentence) and the `why_dto` extraction, with `why` still returning `DisjointSets`. The new tests then fail on assertions for the planned behavior (`DisjointSets` vs `RunsAlone`; `disjointSets` vs `runsAlone`).

**3. [TDD process] Task 2 RED amended once**
- My first RED run failed for the wrong reason (a row query matched both the task row and a pair row, "multiple elements"). I fixed the query to use exact row names, re-ran against the unchanged component to see the three positive cases fail on the missing text, and amended the unpushed RED commit before writing GREEN.

**Total deviations:** 1 auto-fixed (Rule 3), 2 TDD-process notes. **Impact:** none on scope.

## Issues Encountered

None beyond the above. `cargo build --workspace` shows one pre-existing dead-code warning (`worktree_id`) in the desktop crate; out of scope.

## Verification

- `cargo test -p core --test dispatch_plan` 61 passed; `--test dispatch_auto_merge` 32 passed
- `cargo test -p desktop` 96 passed; `cargo build --workspace` clean
- `npm --prefix packages/desktop test` 1297 passed (1292 + 5 new); `tsc --noEmit` clean; `npm run build` ok
- Source gate: in `why`, the `FROM dispatch_edges` read precedes `list_entries_for_task`

## Known Stubs

None. The placeholder empty-sentence arm in the RED commit is replaced in `416bbf3`.

## Next Phase Readiness

Ready for 09-11 (widen-edge record). No blockers.

## Self-Check: PASSED

All five modified files exist; commits `1c25e90`, `416bbf3`, `254b22e`, `190d692` are in `git log`.

---
*Phase: 09-planned-fan-out-that-does-not-collide*
*Completed: 2026-10-10*
