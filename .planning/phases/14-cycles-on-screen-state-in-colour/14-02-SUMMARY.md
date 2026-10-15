---
phase: 14-cycles-on-screen-state-in-colour
plan: 02
subsystem: cycles
tags: [sqlite, tauri, react, roster, ranking, hierarchy]
requires: ["14-01"]
provides:
  - "14-HIERARCHY.md, committed before any visual work on the region"
  - "domain::cycle::cycle_roster, CycleRoster::ahead, reorder_cycle (cycle.reordered)"
  - "CycleRegionDto.later/total/listed/truncated, CycleLineDto"
  - "tests/cycle_roster.rs and tests/cycle_progress.rs (fold proven at 940 tasks)"
affects: [14-04, 14-06, 14-09]
tech-stack:
  added: []
  patterns: ["bounded roster with a printed truncated fact", "correlated COUNT subquery for a whole roster in one statement", "(rank, id) tie-break for a total order"]
key-files:
  created:
    - .planning/phases/14-cycles-on-screen-state-in-colour/14-HIERARCHY.md
    - packages/core/tests/cycle_roster.rs
    - packages/core/tests/cycle_progress.rs
  modified:
    - packages/core/src/domain/cycle.rs
    - packages/core/src/query/cycle_progress.rs
    - packages/desktop/src-tauri/src/commands/cycle.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/CycleRegion.tsx
    - packages/desktop/src/board/__tests__/cycle-region.test.tsx
decisions:
  - "The roster reads open Cycles only (planned and active). A closed Cycle is not part of the roadmap and must not consume the ceiling."
  - "CycleRoster.cycles is Vec<CycleLine { cycle, epic_count }>; ahead() is planned Cycles ranked after the active one, or every planned Cycle when none is active."
  - "No percentage is drawn. The region prints the fold's integer pair as-is, so there is no rounding rule to name."
  - "Truncation sentence is built from total - listed, so it names the real total without the renderer knowing about closed Cycles."
requirements-completed: [RECD-09]
metrics:
  duration: "about 1h 10m wall clock, most of it cargo link and Gatekeeper time"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: 4799ffca564421cc9acff358e1f357c980c1738f
---

# Phase 14 Plan 02: Hierarchy statement, roadmap ahead, fold at scale Summary

The hierarchy statement was committed first, then the later Cycles appear as bounded single lines with the roster's truncated fact printed, and the Cycle fold is proven equal to an independent full count over 940 tasks (and strictly larger than the 200-row page).

## What was built

- **Task 1** (`f853e244`): `14-HIERARCHY.md`. The epic roster keeps the lead and the region orients (D-03, with both declined alternatives recorded). Three levels internal to the region: the current Cycle (loud), later Cycles (quiet), the frame (recessive). They are carried by type step, weight, spacing, position and the single surface step; colour is explicitly not a channel. Contains no hex colour and no contrast ratio. It is the first commit in the plan; the first commit touching `CycleRegion.tsx` is `8db0e8d8`.
- **Task 2** (RED `01520ef2`, GREEN `8db0e8d8`): `cycle_roster` is one bounded statement ordered `rank ASC, id ASC` with a correlated epic-count subquery, a second `COUNT(*)`, and `truncated = total > rows`. `reorder_cycle` follows `reorder_epic` (one fractional rank rewritten, `cycle.reordered` event). `cycle_region` carries `later`, `total`, `listed`, `truncated`. `CycleRegion` renders the active Cycle (goal, epic and agent counts, fraction), later Cycles as `<li>` lines, and a `role="status"` sentence when truncated. No scroll container, paging or expand control.
- **Task 3** (`e57f81ec`): `tests/cycle_progress.rs`, 8 tests over a 940-task fixture (const `VOLUME_TASKS`): equality with an independent `COUNT(*)` for total and done, strictly greater than the board page, outside-Cycle and other-Cycle exclusion, one task, zero tasks, zero epics, determinism.

## Judgement procedure (Task 1 acceptance)

Applied by someone who has not read the plans, on the demo board or the running app with at least one later Cycle: (1) squint two seconds and say what the eye lands on; the roster or the region's Level 1 must win and the region must not outweigh the roster. (2) Name the loud thing, the quiet things and the frame in order; two equally loud things, a later line that looks like a second current Cycle, or a frame with its own box, icon or banner is a fail. (3) Remove all colour; the three levels must still separate. (4) Read the figure aloud; it must state a position only, with no trend, comparison, target, praise or reproach. (5) Force the three empty cases (no active Cycle, no epics, no tasks); each must say something true in words. All five must pass.

## Verification

- `cargo test -p core --test cycle_progress` 8, `cycle_roster` 10, `cycle_region` 11, `epic_progress` 7, `epic_roster` 12, `ranking` 3, `perf_seed_1000` 8, `pm_vocabulary_gate` 10, `spine_pin` 6; earlier run also `--lib` 20, `migration_safety` 12, `table_classification` 2, `db_bootstrap` 11; `cargo test -p desktop --test handler_roster` 2.
- `cargo check --workspace` passes.
- `npx vitest run`: 1513 passed, 2 expected fail; `cycle-region.test.tsx` 9 tests. `npx tsc --noEmit`: only the two pre-existing `brand-rule.test.ts` errors (plan 14-07).
- Mutation check: a temporary `LIMIT 200` subquery in the fold made 4 of the 8 `cycle_progress` tests fail; the source was restored (`git status` clean for it).
- Acceptance greps: `CYCLE_ROSTER_CEILING` 3 in the source and 8 in the roster test; `truncated` 2 in the region; `rank_*` 6 in `cycle.rs`; paging/expand wording 0 in the region; `DEFAULT_LIMIT` 6, `COUNT(*)` 3 and a 940 literal in the progress test; percentage outside comments 0.

## Deviations from Plan

**1. [Rule 3 - Blocking] `query::DEFAULT_LIMIT` does not exist**
- **Found during:** Task 3.
- **Issue:** The plan says to read the page size from `query::DEFAULT_LIMIT`. The board's 200 is a private const in the Tauri crate (`commands/board.rs`), unreachable from a core test. Core's only same-named const is `query::authoring::DEFAULT_LIMIT` (200).
- **Fix:** the test uses `core::query::authoring::DEFAULT_LIMIT` and also reads the real board window through `list_board` with it, asserting the window is at most that size. Both values are 200 today; the link between them is a comment, not a compile-time tie.
- **Files modified:** `packages/core/tests/cycle_progress.rs`.
- **Commit:** `e57f81ec`.

**2. [Minor] Tests use `common::seeded_project` instead of a hand-rolled scratch helper.** It already migrates a fresh DB and leaks its temp dir as `perf_seed_1000.rs` does, and 14-01's `cycle_region.rs` uses it. `common/mod.rs` is not edited.

**3. [Minor] The zero-epic and zero-task fold fix was not needed.** The 14-01 fold already answers zeroes; the new tests pin that. Only the module header was extended. Task 3's cases passed on first run (characterization of existing behaviour); the mutation check above stands in for a RED.

**4. [Minor] RED was a compile failure** (`cycle_roster`, `reorder_cycle` and `CycleLine` did not exist), the same shape as 14-01's RED. One test fixture bug (fake rank `00000000` is not a valid fractional index when `create_cycle` follows it) was fixed in the GREEN commit.

**5. [Minor] `list_cycles` replaced by `cycle_roster`.** It had no callers anywhere. `CycleRoster.cycles` changed from `Vec<Cycle>` to `Vec<CycleLine>`.

**Total deviations:** 1 blocking-rule adjustment, 4 minor. **Impact:** none on scope; all acceptance criteria hold.

## Known Stubs

None. `reorder_cycle` has no IPC command or UI yet by design (no plan task adds one); it is a tested core writer.

## Threat Flags

None. `cycle_region` stays read-only and binds the project id through `params![]` in both roster statements (T-14-02-04, cross-project test). The ceiling and `truncated` fact cover T-14-02-02, the `id` tie-break covers T-14-02-03, and the page-exceeding equality covers T-14-02-01.

## TDD Gate Compliance

Task 2: RED `01520ef2` (`test(14-02)`) precedes GREEN `8db0e8d8` (`feat(14-02)`). Task 3 is a `test(14-02)` commit over behaviour that already held; no `feat` was warranted.

## Self-Check: PASSED

Files verified present: `14-HIERARCHY.md`, `packages/core/tests/cycle_roster.rs`, `packages/core/tests/cycle_progress.rs`. Commits `f853e244`, `01520ef2`, `8db0e8d8`, `e57f81ec` are in `git log`.
