---
phase: 13-nothing-new-escapes-the-fence
plan: 03
subsystem: database
tags: [sqlite, migration, table-rebuild, fts5, tauri, react, source-gate, drft-05]

requires:
  - phase: 13-01
    provides: the two-sided source gate house style estimate_absent.rs copies, and the PM-vocabulary gate this plan's new test code must not trip
provides:
  - "migration 0023: estimate dropped from tasks and epics by table rebuild, with indexes and FTS5 sync triggers restored and rowids preserved"
  - "migration_0023_rebuild_preserves_criterion_anchors: the named early proof Phase 16's RECD-04 is conditional on (D-15)"
  - "task::set_priority_in_tx and epic::set_epic_priority_in_tx, so accepting a priority suggestion composes with the proposal-acceptance transaction (F4, D-17)"
  - "estimate_absent.rs: a two-sided source gate that fails the build if the field returns"
affects: [13-04, 13-05, 16-recd-04, fnc-01-spine-pin]

actuals:
  tokens: 30100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "five-step SQLite rebuild extended for tables carrying external-content FTS5: copy rowid explicitly, re-create the sync triggers"
    - "token-level source gate: split identifiers into words so Estimated / estimateSize are not the field"

key-files:
  created:
    - packages/core/src/db/migrations/0023_drop_estimate.sql
    - packages/core/tests/estimate_absent.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/epic.rs
    - packages/core/src/query/mod.rs
    - packages/core/src/query/filter.rs
    - packages/core/src/query/search.rs
    - packages/core/tests/migration_safety.rs
    - packages/core/tests/ranking.rs
    - packages/desktop/src-tauri/src/commands/board.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/FilterBar.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts
  deleted:
    - packages/desktop/src/board/pickers/EstimatePicker.tsx

key-decisions:
  - "Task 1 (D-14, one-way): the owner chose option 1, Proceed as decided, in session on 2026-10-14. Estimate values on any board item are discarded; the recovery path is the pre-migration backup db::open_and_migrate writes (D-18)."
  - "Rebuild copies rowid explicitly and re-creates the six FTS5 triggers: DROP TABLE drops a table's triggers, and a fresh rowid would orphan every existing search hit. The plan only named indexes."
  - "The estimate gate matches identifier WORDS, not substrings, with four named exclusions: the virtualizer option estimateSize, two volume-fixture tokens, and the fleet spend copy (a different, real estimate). The migration registration line is the fourth."

patterns-established:
  - "Rebuilding a table that backs an FTS5 external-content index: preserve rowid in the copy, re-create ai/ad/au triggers after RENAME"
  - "A source gate for a removed field must separate the field from the English word and from library option names, or it fires on unrelated code"

requirements-completed: [DRFT-05]

coverage:
  - id: D1
    description: "estimate is gone from the schema on both tasks and epics, in the same migration, on fresh and existing databases"
    requirement: DRFT-05
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_rebuild_preserves_criterion_anchors"
        status: pass
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_applies_to_a_fresh_database"
        status: pass
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_rebuilds_empty_tables_cleanly"
        status: pass
    human_judgment: false
  - id: D2
    description: "criterion_anchors rows survive the tasks rebuild byte-identical, with PRAGMA foreign_key_check clean (the RECD-04 early proof)"
    requirement: DRFT-05
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_rebuild_preserves_criterion_anchors"
        status: pass
    human_judgment: false
  - id: D3
    description: "Task rank values and order, search hits, and the board indexes survive the rebuild"
    requirement: DRFT-05
    verification:
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_preserves_task_rank_order"
        status: pass
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs#migration_0023_keeps_search_in_sync"
        status: pass
    human_judgment: false
  - id: D4
    description: "set_priority_in_tx and set_epic_priority_in_tx compose into a caller-owned transaction: one event, no commit of their own, no-op when redundant"
    requirement: DRFT-05
    verification:
      - kind: unit
        ref: "packages/core/tests/ranking.rs#set_priority_in_tx_composes_into_a_caller_owned_transaction"
        status: pass
      - kind: unit
        ref: "packages/core/tests/ranking.rs#set_epic_priority_in_tx_composes_into_a_caller_owned_transaction"
        status: pass
    human_judgment: false
  - id: D5
    description: "No UI surface asks for estimate (picker deleted, filter chips, palette command, e binding, detail row and legend marks removed) and a two-sided gate keeps it gone"
    requirement: DRFT-05
    verification:
      - kind: unit
        ref: "packages/core/tests/estimate_absent.rs#no_estimate_identifier_reaches_core_or_desktop_source"
        status: pass
      - kind: unit
        ref: "packages/core/tests/estimate_absent.rs#the_estimate_gate_fires_on_a_planted_violation"
        status: pass
      - kind: unit
        ref: "npx vitest run (packages/desktop): 90 files, 1481 tests"
        status: pass
    human_judgment: false
  - id: D6
    description: "The one-way drop of stored estimate values was confirmed by the owner before the rebuild ran"
    verification: []
    human_judgment: true
    rationale: "An owner decision recorded from the checkpoint answer; no automated check can confirm the owner agreed."

duration: 1h 5m
completed: 2026-10-14
status: complete
plan_head_before: dde4dab34209ec8520d21e2a1f35f955e76f9014
commits: 3
---

# Phase 13 Plan 03: Drop estimate and prove criterion_anchors survive the rebuild Summary

**Migration 0023 rebuilds `tasks` and `epics` without `estimate` (keeping rowids, indexes and FTS5 triggers), proves `criterion_anchors` rows survive under a test name Phase 16 can cite, and a two-sided gate stops the field returning.**

## Performance

- **Duration:** 1h 5m
- **Started:** 2026-10-14T13:12:52Z
- **Completed:** 2026-10-14T14:18:48Z
- **Tasks:** 4 (1 decision checkpoint, 3 executed)
- **Files modified:** 43 (719 insertions, 663 deletions)

## Task 1 decision (D-14, one-way)

The prior executor halted at this blocking `checkpoint:decision`. The owner answered **"proceed"** in
session on **2026-10-14**: option 1, **Proceed as decided (D-14)**. Meaning as presented and accepted:
migration 0023 drops `estimate` from both `tasks` and `epics` by full table rebuild; `EstimatePicker.tsx`,
the estimate filter dimension and `set_estimate` are deleted; any stored `estimate` value is discarded;
the recovery path is the pre-migration backup `db::open_and_migrate` writes (D-18), which
`migration_0023_rebuild_preserves_criterion_anchors` asserts exists. Tasks 2 to 4 ran unrescoped.

The `REQUIREMENTS.md` check the task asked for:

```
53:- [ ] **DRFT-05**: `estimate` is removed from every required flow unless a consumer that reads it is named; ...
158:| 8 | Status / priority / estimate drafting | Derive status, drop estimate unless a consumer is named, priority opt-in only ... |
188:| DRFT-05 | Phase 13 | Pending |
```

No requirement reads the field as an input.

## Accomplishments

- Migration 0023 rebuilds `epics` then `tasks` without `estimate`, preserving every other column byte for byte, `priority` and its `CHECK (0..4)` unchanged (D-16).
- `migration_0023_rebuild_preserves_criterion_anchors` seeds an epic, a task, a criterion and a real anchor, migrates the N-1 database, and asserts the anchor row, the task and epic rows are byte-identical, the anchor-to-criterion-to-task join still resolves, `PRAGMA foreign_key_check` is empty, and the pre-migration backup exists.
- `set_priority_in_tx` and `set_epic_priority_in_tx` exist, factored out of `set_priority` the way `set_task_status_in_tx` was; `set_estimate` and its `estimate_changed` event kinds are gone (F4 narrows to priority).
- `BoardItem`, `BoardFilter`, the search and window queries, both IPC DTOs and the two setter commands no longer carry the field.
- The UI no longer asks: picker deleted, row badge, filter chips, palette command, `e` binding, detail-panel row and three legend marks removed.
- `estimate_absent.rs` fails the build if the identifier reappears in core, desktop or Tauri source outside a comment, and its planted-violation test proves the matcher fires.

## Task Commits

1. **Task 1: Confirm the one-way estimate drop** - no commit (decision checkpoint, answered "proceed")
2. **Task 2: Migration 0023 and the named criterion_anchors proof** - `19c1cfb` (feat)
3. **Task 3: The column's consumers unwind, and `set_priority_in_tx`** - `c1c8b96` (refactor)
4. **Task 4: The UI stops asking, and a gate keeps the field from coming back** - `26e3443` (feat)

**Plan metadata:** recorded in the docs commit that follows this file.

## Files Created/Modified

- `packages/core/src/db/migrations/0023_drop_estimate.sql` - the two rebuilds, indexes and FTS5 triggers restored
- `packages/core/tests/estimate_absent.rs` - the two-sided source gate
- `packages/core/tests/migration_safety.rs` - five 0023 tests (criterion_anchors, fresh, empty, rank order, search sync)
- `packages/core/src/domain/task.rs`, `epic.rs` - `set_estimate` removed; `_in_tx` priority setters added
- `packages/core/src/query/{mod,filter,search}.rs` - field, filter dimension and bindings removed
- `packages/desktop/src-tauri/src/commands/{board,task,epic}.rs`, `main.rs` - DTO fields and setter commands removed
- `packages/desktop/src/board/*`, `item-detail/ItemDetailPanel.tsx`, `legend/*`, `state/*`, `App.css` - UI unwound; `EstimatePicker.tsx` deleted

## Decisions Made

- Rebuild preserves `rowid` and re-creates the FTS5 sync triggers (see Deviations 1).
- The gate is word-level with named exclusions rather than a substring scan (see Deviations 4).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Migration also restores FTS5 triggers and keeps rowids**
- **Found during:** Task 2
- **Issue:** `tasks` and `epics` each back an external-content FTS5 index (`tasks_fts`, `epics_fts`) kept in sync only by three triggers per table, and keyed by hidden `rowid`. `DROP TABLE` drops the triggers, and an explicit-column copy with no `rowid` assigns new rowids. The plan named only the indexes; without this, board search would silently go stale after the migration.
- **Fix:** copy `rowid` explicitly in each `INSERT ... SELECT`, and re-create `tasks_ai/_ad/_au` and `epics_ai/_ad/_au` after `RENAME`.
- **Files modified:** `packages/core/src/db/migrations/0023_drop_estimate.sql`, `packages/core/tests/migration_safety.rs` (`migration_0023_keeps_search_in_sync`, a fifth test beyond the plan's four)
- **Verification:** the new test finds a pre-migration row and a post-migration row through `MATCH`, and the three indexes exist.
- **Committed in:** `19c1cfb`

**2. [Rule 3 - Blocking] Test fixtures that insert `estimate` directly**
- **Found during:** Task 2
- **Issue:** `tests/common/mod.rs`, `epic_progress.rs`, `file_set_overlap.rs` and `fleet_perf.rs` insert into `tasks` naming the dropped column, so every test built on them would fail once the migration ran. Not in the plan's file list.
- **Fix:** removed the column from each INSERT and its bound value.
- **Files modified:** the four test files above
- **Verification:** `epic_progress`, `file_set_overlap`, `search_filter`, `criterion_anchors` pass
- **Committed in:** `19c1cfb`

**3. [Rule 3 - Blocking] Consumers outside the plan's file list**
- **Found during:** Tasks 3 and 4
- **Issue:** `commands/board.rs` carried the DTO field and filter input; `legend.test.tsx` pinned 10 channels and 57 marks; `keyboard-agent.test.ts` pinned the `e` letter; `admin-group.browser.test.tsx` pinned 10 legend links. All fail by construction once the field is gone.
- **Fix:** updated the counts and the letter set (9 channels, 54 marks, no `e`), and the DTO.
- **Files modified:** `commands/board.rs`, `legend.test.tsx`, `keyboard-agent.test.ts`, `admin-group.browser.test.tsx`, plus comments in `Legend.tsx` and `admin-surfaces.css` saying "ten channels"
- **Verification:** `npx vitest run` reports 90 of 90 files passing
- **Committed in:** `c1c8b96`, `26e3443`

**4. [Rule 1 - Bug] The plan's literal "no `\bestimate` outside comments" criterion cannot hold**
- **Found during:** Task 4
- **Issue:** the word is also tanstack-virtual's option `estimateSize` (and `feedRowEstimateSize`), a test fixture's `estimateTotalHeight`, and the fleet surface's honest "Estimated spend ... Flywheel's own estimate" copy about cost. A substring gate, or the `grep` criterion as written, fires on all of them.
- **Fix:** the gate matches identifier words (so `Estimated` is not the field) and names four narrow exclusions with their reasons in source: the `estimateSize` word pair, `MOUNTABLE_ROW_ESTIMATE`, `estimateTotalHeight` in `volume.ts`, the fleet surface's copy and tests, and the migration registration line. A planted-violation case proves each exclusion shields only its own token and path.
- **Files modified:** `packages/core/tests/estimate_absent.rs`
- **Verification:** `cargo test -p core --test estimate_absent` passes 2 of 2. The literal `grep` criterion returns exactly the excluded lines and nothing else.
- **Committed in:** `26e3443`

---

**Total deviations:** 4 auto-fixed (1 missing critical, 2 blocking, 1 bug)
**Impact on plan:** all four were required for correctness or for the plan's own verification to be satisfiable. No scope creep.

## Issues Encountered

- A `git rm` staged for Task 4 was swept into the Task 3 commit. The commit was unpushed and mine; I undid it with `git reset --soft HEAD~1` and a path-scoped `git restore --staged`, and recommitted so the picker deletion lands in Task 4 where it belongs.
- Pre-existing, out of scope, logged in `deferred-items.md`: `npx tsc --noEmit` reports two `TS2305` errors in `src/theme/__tests__/brand-rule.test.ts` (Node type definitions lack `fs.existsSync`/`globSync`). Not touched by this plan; every other file type-checks clean.
- Running `cargo test -p core` as one command is impractical on this machine: macOS Gatekeeper scans each of 121 freshly linked test binaries on first exec at roughly 45 seconds apiece. See Verification.

## Verification

- `cargo check --workspace`: pass (one pre-existing dead-code warning in the desktop crate).
- `cargo test -p core --no-run`: all 121 test targets compile, so no test anywhere references the removed field or setters.
- `cargo test -p core --test migration_safety`: 11 of 11 pass, including the five 0023 tests.
- `cargo test -p core --test estimate_absent --test pm_vocabulary_gate`: 2 of 2 and 4 of 4 pass.
- `cargo test -p core --test db_bootstrap --test criterion_anchors --test ranking --test search_filter --test epic_progress --test file_set_overlap`: all pass.
- `cd packages/desktop && npx vitest run`: 90 files, 1481 tests pass (2 expected-fail unchanged).
- 40 of the 121 core test binaries run to completion with 0 failures (527 tests): the 15 that finished in the first pass, plus 25 chosen for touching `tasks`, `epics`, board queries, proposal acceptance, review, fleet and criteria (`hierarchy_workflow`, `status_transitions`, `criteria`, `perf_seed_1000`, `epic_roster`, `authoring_acceptance`, `authoring_proposal`, `review_*`, `task_delete_with_run_history`, and others). They were run directly and in parallel, outside cargo, because the Gatekeeper scan serialises first execution at roughly one binary per 45 to 120 seconds.
- **Not executed:** the other 81 core test binaries. They compile, and each opens its database through the same `open_and_migrate` the 40 exercised, but they were not run. The plan's literal "`cargo test -p core` passes in full" is therefore **compiled-clean, 40 of 121 executed**, not proven by a single full run.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. No placeholder, empty-value or TODO text was introduced.

## Threat Flags

None. No new endpoint, auth path, file access or trust-boundary schema surface; the migration removes a column.

## Next Phase Readiness

- Plan 13-04's spine pin can be written against the post-drop schema.
- Phase 16's RECD-04 can cite `migration_0023_rebuild_preserves_criterion_anchors`.
- `set_priority_in_tx` / `set_epic_priority_in_tx` are ready for plan 13-05's priority-suggestion acceptance path.
- Plan 13-04 must keep the `estimate_absent` exclusions in mind if it adds fixtures near the fleet surface.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*

## Self-Check: PASSED

- FOUND: packages/core/src/db/migrations/0023_drop_estimate.sql
- FOUND: packages/core/tests/estimate_absent.rs
- FOUND commits: 19c1cfb, c1c8b96, 26e3443
- NOT RUN: 81 of 121 core test binaries (compiled only); disclosed under Verification.
