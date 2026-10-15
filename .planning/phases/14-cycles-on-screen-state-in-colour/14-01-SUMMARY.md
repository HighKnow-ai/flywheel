---
phase: 14-cycles-on-screen-state-in-colour
plan: 01
subsystem: cycles
tags: [sqlite, migration, tauri, react-query, spine-pin, pm-vocabulary-gate]
requires: []
provides:
  - "cycles table (migration 0024) and epics.cycle_id"
  - "domain::cycle writers (create/start/assign/remove, active_cycle, list_cycles)"
  - "query::cycle_progress read-time fold"
  - "cycle_region Tauri command, cycleRegion adapter, useCycleRegionQuery, CycleRegion mounted above the virtualizer"
  - "spine_pin cycle assertions, SQL scanned by the PM vocabulary gate"
affects: [14-02, 14-04, 14-06]
tech-stack:
  added: []
  patterns: ["partial unique index as the one-active rule", "read-time grouped fold, no row window", "pin regenerated from sqlite_master in the same diff"]
key-files:
  created:
    - packages/core/src/db/migrations/0024_cycles.sql
    - packages/core/src/domain/cycle.rs
    - packages/core/src/query/cycle_progress.rs
    - packages/core/tests/cycle_region.rs
    - packages/desktop/src-tauri/src/commands/cycle.rs
    - packages/desktop/src/board/CycleRegion.tsx
    - packages/desktop/src/board/useCycleRegionQuery.ts
    - packages/desktop/src/board/__tests__/cycle-region.test.tsx
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/mod.rs
    - packages/core/src/query/mod.rs
    - packages/core/src/schema_classification.rs
    - packages/core/tests/spine_pin.rs
    - packages/core/tests/pm_vocabulary_gate.rs
    - packages/core/tests/migration_safety.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/BoardView.tsx
decisions:
  - "Task 1 ruling: option B, REFERENCES on project_id and created_by (see Owner Ruling)"
  - "Undated means no calendar-point or work-duration column; created_at/updated_at stay"
  - "Cycle event types: cycle.created, cycle.started, cycle.epic_assigned, cycle.epic_removed"
metrics:
  duration: "continuation dispatch, Tasks 2 and 3"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 2120f25e5f6ca803db29191a9fef89364a6e38bd
---

# Phase 14 Plan 01: Cycle record and board region Summary

A Cycle is now a real record (goal, ordering, exit criteria, no scheduling column) whose goal and read-time-folded task progress print in a sticky region above the board's virtualized list, with the spine pin, table classification and PM vocabulary gate all edited in the same diff.

## Owner Ruling (Task 1, decision checkpoint)

- **Option:** B (the house `REFERENCES` clauses; criterion 2 read as a spine statement).
- **Owner:** Cyril Marechal, the project owner.
- **Date:** 2026-10-15.
- **`project_id` clause written by Task 2:** `project_id TEXT NOT NULL REFERENCES projects(id)`
- **`created_by` clause written by Task 2:** `created_by TEXT NOT NULL REFERENCES actors(id)`
- **`spine_pin.rs` assertion form:** the allowed-parent-set form, not a zero-row `pragma_foreign_key_list`. `the_chain_above_epics_terminates_at_the_cycle_table` asserts the exact parent set `{projects, actors}` and that both are `TableClass::Infrastructure`. The reading "a Cycle has no parent in the board spine" is recorded in that test's doc comment. `no_table_other_than_epics_references_the_cycle_table` asserts the other half of criterion 2.
- **Undated reading (the flagged RECD-08 assumption), confirmed by the owner:** "undated" bars calendar-point and work-duration columns, not audit metadata. `created_at` and `updated_at` stay on `cycles`. Task 3 asserts exactly this: no start/end date, no duration column, audit pair present and accepted.

## What was built

- **Task 1** (decision, no commit): ruling above.
- **Task 2** (tracer, TDD): RED `a9d0ce5b` (tests did not compile), GREEN `a5c6f7d7`. Migration 0024 with `idx_cycles_one_active_per_project` (partial unique index) and `epics.cycle_id` plus two supporting indexes; `domain::cycle` where `start_cycle` calls `assert_human_actor_in_tx` first; `query::cycle_progress` (three grouped reads, no window, no order, no percentage); `cycle_region` command, adapter, hook, `CycleRegion` mounted as a `flex: none` sibling above `.board-view`. `EPICS_DDL_PIN` and `FOREIGN_KEY_PARENTS_ABOVE_EPICS` updated from the `sqlite_master` text the test printed; `CYCLES_DDL_PIN` added.
- **Task 3** (`d357bcb7`): `"sql"` added to `SCANNED_EXTENSIONS` (length 4) with a planted-violation and a clean-migration half; `the_cycle_table_carries_no_scheduling_column` and its planted half (matches whole `_` components so `updated_at` is not read as containing `date`); `spine_pin`'s planted-column test now also runs against `cycles` via one shared `PINNED_TABLES` const.

## Verification

- `cargo test -p core --test cycle_region` 11 passed; `spine_pin` 6; `pm_vocabulary_gate` 8; `table_classification` 2; `migration_safety` 12; `status_derivation` 31; `db_bootstrap` 11; `epic_progress` 7; `epic_roster` 12; `hierarchy_workflow` 18.
- `cargo check --workspace` passes; `cargo test -p desktop --test handler_roster` 2 passed.
- `npx vitest run src/board`: 34 files, 404 tests passed (includes the 4 new region tests).
- `ROW_HEIGHT_BY_KIND|estimateSize` count in `BoardView.tsx`: 4 before, 4 after (virtualizer untouched). `CycleRegion` appears twice in `BoardView.tsx` (import and mount) and the mount precedes `className="board-view"`.

## Deviations from Plan

**1. [Rule 1 - Bug] migration_safety 0023 tests broke when 0024 became the newest migration**
- **Found during:** Task 2 regression run.
- **Issue:** `build_n_minus_1_fixture` means "every migration except the newest". The four `migration_0023_*` tests relied on that fixture still containing `tasks.estimate`; once 0024 landed, the fixture was built after 0023 and `migration_0023_rebuild_preserves_criterion_anchors` failed with "no such column: estimate" (the other three would have kept passing while no longer testing the 0023 rebuild).
- **Fix:** added `build_fixture_through(count)` and `build_pre_0023_fixture` (first 22 migrations); the four 0023 tests use it. The generic N-1 tests are unchanged.
- **Files modified:** `packages/core/tests/migration_safety.rs`
- **Commit:** `a5c6f7d7`

**2. [Minor] Task 3's spine_pin planted-column edit and `PINNED_TABLES` const were committed with Task 3, not Task 2.** `CYCLES_DDL_PIN` itself landed in Task 2 (its acceptance count needs it there).

## Deferred Issues (out of scope)

- `npx tsc --noEmit` reports two errors in `packages/desktop/src/theme/__tests__/brand-rule.test.ts` (`node:fs` has no `existsSync`/`globSync`). The file is untouched by this plan; no errors in any file this plan touched.
- `cargo check -p desktop` warns that `StartRunOutcome` fields are never read (`commands/agent_run.rs`); pre-existing.

## Known Stubs

None. This tracer returns the active Cycle only by design; later-Cycle lines, the close flow, scope drift and state colour are plans 14-02, 14-06 and 14-04.

## Threat Flags

None beyond the plan's threat model. `cycle_region` is read-only, takes a project id only, and every statement binds it through `params![]` (T-14-01-04). `start_cycle` is human-only (T-14-01-02), the one-active rule is the partial unique index (T-14-01-03), and no percentage column exists (T-14-01-06).

## TDD Gate Compliance

RED commit `a9d0ce5b` (`test(14-01)`) precedes GREEN `a5c6f7d7` (`feat(14-01)`). No REFACTOR commit.

## Self-Check: PASSED

All created files exist and commits `a9d0ce5b`, `a5c6f7d7`, `d357bcb7` are present in `git log`.
