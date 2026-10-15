---
phase: 14-cycles-on-screen-state-in-colour
plan: 06
subsystem: cycles
tags: [sqlite, event-log, tauri, react, authority, drift]
requires: ["14-01", "14-02", "14-04", "14-05"]
provides:
  - "query::cycle_scope::cycle_scope_drift and cycle_scope_sentence (drift derived from the event log)"
  - "domain::cycle::close_cycle, EpicDisposition, EpicChoice, unfinished_epics"
  - "cycle_close Tauri command; CycleRegionDto.unfinishedEpics and scopeDrift"
  - "CycleCloseDialog and the drift sentence on the Cycle rows"
affects: [14-07, 14-08, 14-09]
tech-stack:
  added: []
  patterns: ["a derived fact read from the append-only log, no column", "writer-side refusal that the IPC path cannot skip", "in-transaction single-epic writers shared by two callers"]
key-files:
  created:
    - packages/core/src/query/cycle_scope.rs
    - packages/core/tests/cycle_close.rs
    - packages/core/tests/cycle_scope_drift.rs
    - packages/desktop/src/board/CycleCloseDialog.tsx
    - packages/desktop/src/board/__tests__/cycle-close.test.tsx
  modified:
    - packages/core/src/domain/cycle.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/commands/cycle.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/tests/handler_roster.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/CycleRegion.tsx
    - packages/desktop/src/board/__tests__/cycle-region.test.tsx
    - packages/desktop/src/styles/states-and-confirms.css
key-decisions:
  - "Disposition enum is EpicDisposition { MoveTo(String), Unassign, LeaveHere }; the obvious name for the first is gate-forbidden (FORBIDDEN_PM_WORDS)"
  - "Tie rule: an event is after the start when occurred_at is later, or equal with the same origin and a higher sequence; equal timestamp from another origin does not count"
  - "Drift counts events, not net difference; an epic moved to another Cycle counts as removed from the old one via the new Cycle's assigned event (before = old id)"
  - "A no-drift Cycle returns None, both for never-started and for started with no events since; the sentence never prints a zero"
  - "Unfinished means status != done and archived_at IS NULL; one definition, in unfinished_epics"
requirements-completed: [RECD-10]
duration: "about 1h 15m wall clock, mostly cargo link time"
completed: 2026-10-15
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 6
commits: 6
plan_head_before: ec31391cc1e6c67b1d43d7e1e2550bde7fdb70d1
---

# Phase 14 Plan 06: Closing a Cycle per epic, and scope drift from the log Summary

Closing a Cycle now refuses in the core until every unfinished epic has one of three dispositions, and a Cycle whose scope changed after it started prints "2 epics added, 1 removed since this Cycle started", derived from the append-only event log with no column added.

## What was built

- **Task 1, scope drift** (RED `6f0cf027`, GREEN `a6a5ffd7`): `cycle_scope_drift` is one literal statement over `events`, joined to the Cycle's own `cycle.started` row. "Added" is a `cycle.epic_assigned` on this Cycle whose `before` is not this Cycle. "Removed" is a `cycle.epic_removed` on this Cycle, or a `cycle.epic_assigned` on another Cycle whose `before` is this one (a move writes one event, on the Cycle it moved to, so the old Cycle's loss is only visible there). Returns `Option`: `None` for a never-started Cycle and for one with no events since. `cycle_scope_sentence` names only the non-zero half. 12 tests.
- **Task 2, the close** (RED `08b96525`, GREEN `781b6ac0`): `close_cycle` asserts a human actor first in its own transaction, then refuses an already-closed Cycle, a choice for an epic that is not an unfinished epic of this Cycle, two choices for one epic, a closed or self target, and any unfinished epic with no disposition (error names the epic key and quotes the DRFT-07 wording). Each epic is applied through the shared in-transaction assign/remove helpers (the public writers now wrap them) and appends one `cycle.epic_disposed` event, then `cycle.closed`. `cycle_close` resolves the actor from the store and takes no actor argument. 15 tests, including both directions of the authority gate and two source assertions over the command module.
- **Task 3, the dialog** (RED `d8087b7a`, GREEN `3aca15ec`): `CycleCloseDialog` renders one `radiogroup` per unfinished epic with three radios, nothing checked, a target select that is disabled until "move" is picked, a confirm that stays disabled with a `role="status"` count of undecided rows, and `invalidateQueries` on the cycle-region key. `cycle_region` now carries `unfinishedEpics` and `scopeDrift` (the core's sentence, printed as-is). The active row gets a "Close this cycle" button, which is what mounts the dialog; the later-Cycle targets are the region's own `later` lines.

## Tie rule (Task 1 acceptance)

An event counts as after the start when its `occurred_at` is later than the start event's, or the two are equal, from the same origin, and the event has the higher `sequence`; an equal timestamp from a different origin does not count. The doc comment on `cycle_scope_drift` and the header of `cycle_scope_drift.rs` state the same sentence, and the tie test and the other-origin test assert it.

## Handler roster pin

`ROSTER_COUNT` moved from 144 to 145 (one new command, `cycle_close`).

## Flagged assumption (RECD-10)

"Scope changed" counts events, not net difference, as the plan's edge section proposed. An epic assigned in and out again after the start counts in both; the swap test passes against a net count of zero. If the owner wants net difference, the sentence and `an_epic_assigned_in_then_out_after_the_start_counts_in_both` change together.

## Verification

- `cargo test -p core --lib --test spine_pin --test pm_vocabulary_gate --test migration_safety --test table_classification --test db_bootstrap`: all pass. `--test cycle_region --test cycle_roster --test cycle_progress --test demo_board --test status_derivation --test no_agent_status_write`: all pass. `--test cycle_close` 15, `--test cycle_scope_drift` 12, plus `scope_events`, `activity_trail`, `authority_human_only`, `authoring_proposal`: all pass.
- `cargo test -p desktop --test handler_roster --test board_changed_payload`: pass. `cargo check --workspace`: pass.
- `npx vitest run`: 1604 passed, 2 expected fail. `npx tsc --noEmit`: only the two pre-existing `brand-rule.test.ts` errors (plan 14-07).
- Acceptance greps: `assert_human_actor_in_tx` 3 in `cycle.rs`; enum variant count 3 (the plan's one-liner contains a stray `\&` from XML escaping and was run unescaped); no apply-to-all identifiers outside comments; no literal colour, no pre-selection attribute, no `App.css` reference in the dialog, `invalidateQueries` 1; `App.css` untouched by the commit.
- Roster after close: `a_closed_cycle_leaves_the_roster_and_frees_the_active_slot` shows a closed Cycle leaves `cycle_roster` (so it cannot consume `CYCLE_ROSTER_CEILING`), `active_cycle` is `None`, and the next planned Cycle can start.

## Deviations from Plan

**1. [Rule 3 - Blocking] `project_of` had no `cycles` arm**
- **Found during:** Task 2.
- **Issue:** `cycle_close` must emit `board:changed` scoped to a project; `project_of` maps only a fixed table list and returned `None`, which broadcasts.
- **Fix:** one `"cycles"` arm in `commands/mod.rs`.
- **Commit:** `781b6ac0`.

**2. [Rule 2 - Missing functionality] Nothing mounted the dialog**
- **Found during:** Task 3.
- **Issue:** the plan lists `CycleRegion.tsx` but names no entry point, and neither the region nor the DTO carried the unfinished epics the dialog needs.
- **Fix:** `unfinishedEpics` on the active Cycle's DTO (from `domain::cycle::unfinished_epics`, the same function the writer uses) and a "Close this cycle" button on the active row. No new command.
- **Commit:** `3aca15ec`.

**3. [Minor] Drift also counts moves out through `assign_epic_to_cycle`.** The plan names only assignment and removal events; a move between Cycles writes a single assigned event on the destination, so counting only the old Cycle's own stream would miss the loss. Covered by `an_epic_moved_out_to_another_cycle_counts_as_removed_here`.

**4. [Minor] Both REDs are assertion failures, not compile failures**, via a no-op `close_cycle` and a `None`-returning drift stub (the 14-05 standard). The Task 3 RED used a `null`-returning dialog stub plus the adapter types.

**Total deviations:** 1 blocking, 1 missing-functionality, 2 minor. **Impact:** none on scope.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-14-06-01 to -07 are mitigated and asserted: both authority directions, the writer-side refusal, no wholesale shape in the DTO or dialog, one event per epic, closed-target refusal, the swap test, and `spine_pin` passing with the `cycles` DDL unchanged.

## TDD Gate Compliance

Each task has its RED `test(14-06)` commit before its GREEN `feat(14-06)` commit. No REFACTOR commit.

## Self-Check: PASSED

Files verified present: `cycle_scope.rs`, `cycle_close.rs`, `cycle_scope_drift.rs`, `CycleCloseDialog.tsx`, `cycle-close.test.tsx`. Commits `6f0cf027`, `a6a5ffd7`, `08b96525`, `781b6ac0`, `d8087b7a`, `3aca15ec` are in `git log`.
