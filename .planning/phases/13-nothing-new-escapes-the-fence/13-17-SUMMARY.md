---
phase: 13-nothing-new-escapes-the-fence
plan: 17
subsystem: core-db-compaction-desktop-keyboard
tags: [rust, typescript, gap-closure, wr-01, wr-10, wr-12, in-03, fnc-06, fnc-05, drft-04]

requires:
  - phase: 13-02
    provides: the boundary sentence (D-03) and its determinism assertions
  - phase: 13-04
    provides: the F7 schema-too-far-ahead refusal
  - phase: 13-08
    provides: activeSurface and the flat App.tsx switch (FNC-06)
provides:
  - a too-far-ahead refusal that writes nothing (no backup, no restore, no fs::copy over the live file)
  - a boundary sentence with one ordinal base per clause
  - SURFACE_LAYERS removed; App.tsx's switch ending in never is the single UiSurface exhaustiveness check
  - task.rs and epic.rs comments that no longer describe a state nothing enters
affects: [phase-13-verification]

status: complete
plan_head_before: 5d9f5b35443d111e07cff42c357918e4019ee92e
actuals:
  tokens: 11000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A refusal is decided from a read-only connection before any filesystem write, so the hazard is removed rather than detected"
    - "Migrations::current_version against the same Migrations value to_latest will use, so the pre-check cannot disagree with the migrator"

key-files:
  created: []
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/tests/migration_schema_too_far_ahead.rs
    - packages/core/src/compaction.rs
    - packages/core/tests/compaction.rs
    - packages/core/tests/context_packet_bound.rs
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/__tests__/surface-union.test.ts
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/epic.rs

key-decisions:
  - "WR-01 pre-check uses a read-only rusqlite connection plus rusqlite_migration's Migrations::current_version (SchemaVersion::Outside) rather than backup::read_user_version plus a migration count. Migrations exposes no length, so a count would need an in-memory migration probe on every launch; current_version compares against the very Migrations value to_latest uses. The read-only open means the check cannot checkpoint or rewrite the file."
  - "The generic restore branch is kept unchanged for genuine mid-migration failure; its doc comment is narrowed to say it exists for a migration that may have half-run."
  - "WR-10 takes the count-only option (not renumbering headings to board ordinals): the fold clause stays window-relative to match the rendered Session N headings."
  - "WR-12 takes DELETE, not wire: feeding SURFACE_LAYERS into topLayer would change keyboard behaviour on five surfaces with no finding asking for it. FNC-06's coupling clause is read as met by activeSurface plus the flat switch ending in never (flagged assumption 2 stands for the owner to confirm)."

requirements-completed: [FNC-06, FNC-05, DRFT-04]

coverage:
  - id: D1
    description: "A database ahead of the migration list is refused before any file is touched: no new backups_dir entry, live file bytes and mtime unchanged, ten refusals do not grow backups_dir"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#the_refused_database_is_left_byte_for_byte_intact"
        status: pass
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#repeated_refused_opens_do_not_grow_the_backups_directory"
        status: pass
    human_judgment: false
  - id: D2
    description: "A genuine mid-migration failure still takes a backup and restores it"
    requirement: DRFT-04
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_schema_too_far_ahead.rs#a_genuine_mid_migration_failure_still_takes_a_backup_and_restores_it"
        status: pass
    human_judgment: false
  - id: D3
    description: "The boundary sentence has one ordinal base per clause and stays a pure, byte-identical function of board state"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/compaction.rs#the_window_clause_carries_no_ordinal_range"
        status: pass
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#the_packet_names_its_own_inclusion_boundary_and_the_true_board_total"
        status: pass
    human_judgment: false
  - id: D4
    description: "SURFACE_LAYERS no longer exists; adding a UiSurface member without handling it fails tsc at the App.tsx switch"
    requirement: FNC-06
    verification:
      - kind: command
        ref: "npx tsc --noEmit -p tsconfig.json with a planted UiSurface member"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/state/__tests__/surface-union.test.ts"
        status: pass
    human_judgment: true
    rationale: "Whether 'inside the keyboard layer model' means activeSurface plus the flat switch, or the layer stack consulting activeSurface, is the owner's reading (flagged assumption 2)."
---

# Phase 13 Plan 17: Refusal that touches nothing, one ordinal base, no orphan Summary

**A too-far-ahead database is now refused from a read-only connection before any backup or copy, the boundary sentence states counts instead of a second ordinal range, and the unread `SURFACE_LAYERS` export is gone.**

## Performance

- **Tasks:** 3 (all `type="auto"`, tdd)
- **Files modified:** 9
- **Commits:** 3 (measured against `plan_head_before`)

## Accomplishments

### Task 1: refusal decided before any write (WR-01) - `9a151d37`

New `refuse_if_schema_ahead` runs first in `open_and_migrate_with`:

```rust
    // Decided before every filesystem write (WR-01): see `refuse_if_schema_ahead`.
    refuse_if_schema_ahead(db_path, backups_dir, migrations)?;

    let backup_path = backup_database_file(db_path, backups_dir)
```

It opens the file `SQLITE_OPEN_READ_ONLY`, calls `migrations.current_version(&conn)` and, on `SchemaVersion::Outside`, returns the F7 message (versions and recovery action unchanged) wrapped in the original `DatabaseTooFarAhead` error. No lock detection is attempted: not writing removes the hazard.

Tests: the old byte-for-byte test now also snapshots `backups_dir` entries and compares mtime; added `repeated_refused_opens_do_not_grow_the_backups_directory` (ten refusals) and `a_genuine_mid_migration_failure_still_takes_a_backup_and_restores_it`.

Planted direction: with the refusal moved below `backup_database_file`, `the_refused_database_is_left_byte_for_byte_intact` failed with `left: ["pre-migration-24-1792044119849.db"]` against an empty snapshot ("a refused open must not add a file to the backups directory"), and the ten-refusal test failed with ten `pre-migration-24-*.db` entries where none were expected. Restored afterwards.

### Task 2: one ordinal base per clause (WR-10) - `5a2e92d2`

For the 200-summary fixture (25-row window) `boundary_sentence()` now returns:

`Summaries 1-20 are folded; 21-25 are carried verbatim. 25 of 200 summaries read; 175 earlier sessions are on the task, readable from the task's own session history.`

The 26-summary case keeps the singular (`25 of 26 summaries read; 1 earlier session is on the task`). The doc comment records the one-base invariant and why count-only was chosen over renumbering the headings. `context_packet_bound.rs` changes by one line (`176-200 of 200` -> `25 of 200 summaries read`).

Planted direction: restoring `ordinal_range_str((left_out + 1, self.board_total))` made `the_window_clause_carries_no_ordinal_range` fail with `left: "... Summaries 176-200 of 200 read; 175 earlier sessions ..."`.

### Task 3: orphan and comment cleanup (WR-12, IN-03) - `e8e434ed`

`SURFACE_LAYERS`, its doc comment, its test cases and its import are deleted (`grep -rc SURFACE_LAYERS packages/desktop/src` is all zero). The comment now above `activeSurface`:

> The one exhaustiveness check over `UiSurface` is `App.tsx`'s flat `switch` on this value, which ends in `never`: a new member that is not handled there fails the build. Per-surface keyboard layers are registered by each surface component (`useRegionBindings("...-surface", ...)`), not mapped here.

Planted `| "planted-surface"` on `UiSurface` produced exactly one new tsc error: `src/App.tsx(381,15): error TS2322: Type '"planted-surface"' is not assignable to type 'never'.` The member was removed again.

`task.rs` now says `backlog` is a legacy band with no producer (tasks and accepted proposals land at `CREATED_BAND`, proposals live in `authoring_proposals`, human-typed `backlog` rows are not migrated). `epic.rs` states that epics are still created at `backlog` by a human, deliberately, and points at the owner's open Phase 14 decision. Comment-only: no UPDATE statement changed, so the Gate 1 allow-list and ledger are untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The one-range invariant as written cannot hold**
- **Found during:** Task 2
- **Issue:** The plan asserts exactly ONE `N-M` range in the whole sentence, but the fold clause itself carries two (`1-20`, `21-25`). The first run of the test failed with count 2.
- **Fix:** The test splits at `verbatim. `, asserts the fold clause has 2 ranges and the window clause has 0. The invariant intended (no second ordinal base) is preserved.
- **Files modified:** `packages/core/tests/compaction.rs`
- **Commit:** `5a2e92d2`

**2. [Rule 1 - Bug] A pinned string the plan did not list**
- **Found during:** Task 2
- **Issue:** `tests/compaction.rs` also pinned `"Summaries 221-245 of 245 read"` (the plan only said :232 is unchanged).
- **Fix:** Updated to `"25 of 245 summaries read"`.
- **Commit:** `5a2e92d2`

**3. [Mechanism deviation] Pre-check does not call `backup::read_user_version`**
- **Found during:** Task 1
- **Issue:** The plan's acceptance criterion greps `read_user_version` in `db/mod.rs`. `Migrations` exposes no length, so that comparison would need an in-memory migration probe on every launch. `Migrations::current_version` over a read-only connection compares against the same `Migrations` value `to_latest` uses and never writes.
- **Impact:** The literal grep criterion does not match; the behavioural criteria (refusal above `backup_database_file`, planted-direction failure, tests) are all met. `backup.rs` is untouched.

**Total deviations:** 3 (2 Rule 1 test corrections, 1 mechanism choice). **Impact:** none on scope.

## Verification

- `migration_schema_too_far_ahead` 5 passed, `migration_safety` 12 passed
- `compaction` 21 passed, `context_packet` 30 passed, `context_packet_bound` 6 passed
- `status_derivation` 31 passed (>= 19), `pm_vocabulary_gate` and `authority_human_only` 28 + 5 passed, `proposal_no_promotion` (Gate 1) 15 passed
- vitest `surface-union` + `layer-guard`: 27 passed
- `tsc --noEmit`: only the two pre-existing `brand-rule.test.ts` TS2305 errors
- `cargo check -p core` clean; no bare `cargo test` run

## Known Stubs

None.

## Threat Flags

None. The refusal path now performs no write, which is the T-13-17-01/02 mitigation.

## Issues Encountered

None beyond the deviations above.

## Self-Check: PASSED

- Commits `9a151d37`, `5a2e92d2`, `e8e434ed` exist on the branch.
- All nine modified files exist; `SURFACE_LAYERS` absent from `packages/desktop/src`.
