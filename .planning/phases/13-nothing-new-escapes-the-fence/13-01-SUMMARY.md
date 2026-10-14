---
phase: 13-nothing-new-escapes-the-fence
plan: 01
subsystem: testing
tags: [rust, source-gate, fnc-04, pm-vocabulary, tracer]

requires:
  - phase: 12
    provides: two-sided gate house style (planted violation + clean tree)
provides:
  - "pm_vocabulary_gate.rs: whole-word source gate over ten PM words, run by cargo test -p core"
  - "worked two-sided example of the gate architecture the rest of phase 13 copies"
affects: [13-02, 13-03, 13-04, 13-05, 13-06, 13-07, 13-08, 13-09, 13-10, 13-11]

actuals:
  tokens: 6500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "self-contained source gate: scan_body_for_pm_words shared by the real gate and planted-violation tests"
    - "gate on the gate: walker reachability test over every scanned tree"

key-files:
  created:
    - packages/core/tests/pm_vocabulary_gate.rs
  modified:
    - packages/core/tests/proc_timeout_boundary.rs
    - packages/core/tests/lock_contention.rs
    - packages/core/tests/git_hooks_pre_push.rs
    - packages/core/tests/proposal_duplicates.rs
    - packages/desktop/src/board/__tests__/board-pending-focus.test.tsx

key-decisions:
  - "Whole-word, case-insensitive match; an exclusion only shields a hit word that is part of its literal, so with_capacity cannot shield a deadline hit"
  - "The gate skips its own file by path: its corpus literals and planted fixtures necessarily spell the forbidden words"
  - "Exactly two IDIOM_EXCLUSIONS (with_capacity anywhere; deadline in src/proc.rs), each with its reason in source"

patterns-established:
  - "Gate tests drive one shared matcher from both the real-tree scan and in-memory planted bodies"

requirements-completed: [FNC-04]

coverage:
  - id: D1
    description: "A whole-word PM-vocabulary hit in core/desktop source or test trees fails cargo test -p core"
    requirement: FNC-04
    verification:
      - kind: unit
        ref: "packages/core/tests/pm_vocabulary_gate.rs#no_pm_vocabulary_in_core_or_desktop_source"
        status: pass
      - kind: unit
        ref: "packages/core/tests/pm_vocabulary_gate.rs#the_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly two idiom exclusions, each narrow (planted-violation proves a PM-shaped use still fails)"
    requirement: FNC-04
    verification:
      - kind: unit
        ref: "packages/core/tests/pm_vocabulary_gate.rs#the_gate_is_silent_on_each_named_idiom_exclusion"
        status: pass
    human_judgment: false
  - id: D3
    description: "The walker reaches all scanned trees and .rs/.ts/.tsx files, so the gate cannot become dead coverage"
    requirement: FNC-04
    verification:
      - kind: unit
        ref: "packages/core/tests/pm_vocabulary_gate.rs#the_pm_vocabulary_gate_walker_reaches_every_scanned_tree"
        status: pass
    human_judgment: false

duration: 20 min
completed: 2026-10-14
status: complete
plan_head_before: 09c09c734f3b09921c59a62d7361c248f8590d15
commits: 2
---

# Phase 13 Plan 01: PM-vocabulary gate Summary

**Whole-word FNC-04 source gate over ten PM words in core/desktop source and test trees, proven in both directions, with the five real offenders renamed so the clean tree is genuinely clean.**

## Performance

- **Duration:** 20 min
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 edited)

## Accomplishments
- `pm_vocabulary_gate.rs` with four tests: the real gate, the walker self-check, the planted-violation half, the idiom-exclusion half. All pass under `cargo test -p core`.
- Timeout `deadline` bindings in three core test files renamed to `timeout_at`/`timeout`; two fixture/description strings reworded. No timing value or assertion changed; all five touched suites pass (24, 6, 4, 16 Rust tests, 9 vitest tests).
- No production source, Cargo.toml or package.json touched.

## Task Commits

1. **Task 1: PM-vocabulary gate (both directions)** - `1cb11d9` (test)
2. **Task 2: clean the five real offenders** - `9e61436` (refactor)

The cleanup commit lands first so every commit on the branch is green; the gate file carries Task 2's planted-violation tests too.

## Files Created/Modified
- `packages/core/tests/pm_vocabulary_gate.rs` - the gate, shared matcher, two exclusions, self-checks
- `packages/core/tests/proc_timeout_boundary.rs`, `lock_contention.rs`, `git_hooks_pre_push.rs` - `deadline` renamed
- `packages/core/tests/proposal_duplicates.rs` - fixture reworded
- `packages/desktop/src/board/__tests__/board-pending-focus.test.tsx` - `it(...)` description reworded

## Decisions Made
See key-decisions. Matching is per line (one offender per offending line); a line mixing `with_capacity` and a real `capacity` hit is shielded, a known ceiling of the plan-specified line-level exclusion.

## Deviations from Plan

**1. [Rule 1 - Bug] Planted fixture `let sprint_goal = 3;` contradicts the whole-word rule**
- **Found during:** Task 2
- **Issue:** the plan's behavior list expects `sprint_goal` to be one offender, but the same plan defines a hit as a match not adjoined by `_`/alphanumerics (and says `story_points_total` is not a hit), so `sprint_goal` is not a hit.
- **Fix:** fixture is `let sprint = 3;`; added a case asserting `story_points_total` is silent.
- **Files modified:** packages/core/tests/pm_vocabulary_gate.rs
- **Committed in:** 1cb11d9

**2. [Rule 3 - Blocking] The gate must skip its own file**
- **Found during:** Task 1
- **Issue:** the corpus literals and planted fixtures live in `packages/core/tests`, a scanned tree, so the gate would flag itself. The plan did not mention this.
- **Fix:** the real-gate loop skips paths ending `tests/pm_vocabulary_gate.rs`. This is not an idiom exclusion, so `IDIOM_EXCLUSIONS` stays at two. The plan's `\bdeadline\b` acceptance grep over `packages/core/tests` was run excluding this file for the same reason.
- **Committed in:** 1cb11d9

**3. [Rule 1 - Scope] Exclusion scoped to the hit word**
- An exclusion shields a hit only when the hit word is part of its literal, so `with_capacity` cannot hide a `deadline` hit on the same line.

**Total deviations:** 3 auto-fixed. **Impact:** none on scope; all needed for the gate to be correct and non-self-defeating.

## Issues Encountered
None.

## Known Stubs
None.

## Threat Flags
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
The two-sided gate pattern (shared matcher, planted violation, walker self-check) is in place for plans 13-02 onward.

## Self-Check: PASSED
- `packages/core/tests/pm_vocabulary_gate.rs` exists; commits `1cb11d9` and `9e61436` exist; `cargo test -p core --test pm_vocabulary_gate` reports 4 passed.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*
