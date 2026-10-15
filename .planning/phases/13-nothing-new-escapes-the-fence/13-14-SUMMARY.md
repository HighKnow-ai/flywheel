---
phase: 13-nothing-new-escapes-the-fence
plan: 14
subsystem: core-tests
tags: [rust, source-gates, fnc-04, drft-04, drft-05, gap-closure, fts5]

requires:
  - phase: 13-01
    provides: the PM vocabulary gate and A-02's whole-word amendment
  - phase: 13-03
    provides: migration 0023 and its rowid carry
  - phase: 13-07
    provides: the single tasks.status writer and its source gate
provides:
  - PM vocabulary gate matching a corpus word as an identifier-component prefix (has_word_prefix_at_boundary)
  - SCANNED_EXTENSIONS named const recording the deliberate .sql non-decision
  - no_agent_status_write matcher that normalises the body and tests the whole SET list for status
  - migration_0023_keeps_search_in_sync joining the FTS index back to the base table on rowid, over a rowid gap, plus FTS5 integrity-check
affects: [phase-13-verification, phase-14-schema]

status: complete
plan_head_before: 22c4e81472d8abfd1d939b5e222390d54cf64895
actuals:
  tokens: 14000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Gate matchers prove both directions with planted cases; the migration guard has a companion test that shows the new assertion fails where the old one passed"
    - "When a widened gate fires on legitimate code, rename the identifier; do not grow the exclusion list or re-narrow the matcher"

key-files:
  created: []
  modified:
    - packages/core/tests/pm_vocabulary_gate.rs
    - packages/core/tests/no_agent_status_write.rs
    - packages/core/tests/migration_safety.rs
    - packages/core/tests/lock_contention.rs
    - packages/core/tests/proc_timeout_boundary.rs
    - packages/desktop/src/board/BoardView.tsx

key-decisions:
  - "Eleven pre-existing `deadline` identifiers (timeout Instants in two test files, a UI focus timer) were renamed rather than given a third-to-fifth IDIOM_EXCLUSIONS entry, so D-20's exactly-two exclusions stay exactly two."
  - ".sql stays unscanned; the counter-argument and the one-token reversal are recorded in the SCANNED_EXTENSIONS doc comment for the owner (T-13-14-02 accepted)."

requirements-completed: [FNC-04, FNC-03, DRFT-04, DRFT-05]

coverage:
  - id: D1
    description: "A corpus word used as a compound identifier component fails the PM vocabulary gate; both idiom exclusions still hold and a PM use sharing a line with with_capacity is still an offender"
    requirement: FNC-04
    verification:
      - kind: integration
        ref: "packages/core/tests/pm_vocabulary_gate.rs#the_gate_fires_on_a_corpus_word_used_as_a_compound_identifier_component"
        status: pass
      - kind: integration
        ref: "packages/core/tests/pm_vocabulary_gate.rs#the_gate_is_silent_on_each_named_idiom_exclusion"
        status: pass
    human_judgment: false
  - id: D2
    description: "tasks.status cannot be written past the gate by reordering the SET list, lowercasing or breaking the statement across lines; the updated_at-only touch stays silent; the writer still exists exactly once"
    requirement: DRFT-04
    verification:
      - kind: integration
        ref: "packages/core/tests/no_agent_status_write.rs#the_status_write_gate_fires_on_a_planted_raw_update"
        status: pass
      - kind: integration
        ref: "packages/core/tests/no_agent_status_write.rs#no_module_outside_set_task_status_in_tx_writes_tasks_status"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration 0023's rowid carry is asserted by a join back to the base table over a seeded rowid gap, FTS5 integrity-check runs, and a companion test proves the join detects a wrong rowid a count would pass"
    requirement: DRFT-05
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_safety.rs#migration_0023_keeps_search_in_sync"
        status: pass
      - kind: integration
        ref: "packages/core/tests/migration_safety.rs#the_fts_rowid_join_detects_an_index_that_points_at_the_wrong_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "The .sql scope question is surfaced to the owner, not silently taken or dropped"
    requirement: FNC-04
    verification: []
    human_judgment: true
    rationale: "Owner decision on a locked CONTEXT.md deferral; recorded in SCANNED_EXTENSIONS and in this summary."
---

# Phase 13 Plan 14: Close the three "gate narrower than its own docs" findings Summary

**The PM vocabulary gate now fails on `sprint_id` / `overdueCount` / `velocity_per_week` / `story_points_total`, the status-write gate sees a reordered or split `UPDATE tasks SET ... status`, and migration 0023's `rowid` carry is a behavioural test with a mutation that breaks it.**

## Accomplishments

- **PM gate (FNC-04).** `has_whole_word` is replaced by `has_word_prefix_at_boundary`: a corpus word must start at a component boundary (line start, a non-alphabetic predecessor, or a camelCase uppercase), and what follows is unconstrained. Both `IDIOM_EXCLUSIONS` are unchanged in shape. `SCANNED_EXTENSIONS` is a named const that the walker-reach test iterates. `story_points_total` flipped from silent to one offender.
- **Status gate (DRFT-04).** `scan_body_for_raw_status_writes` now follows the `priority_is_opt_in.rs` shape (drop comment lines, join, collapse whitespace, lowercase). Each `update tasks set` is cut at the next ` where ` or closing `"`, and flagged when `status` is assigned anywhere in that SET list. The main gate also asserts each scanned tree yielded files, and sorts hits.
- **FTS guard (DRFT-05).** The fixture now creates three tasks and three epics and deletes the first of each, so survivors sit above rowid 1. `fts_match_base_titles` joins `<table>_fts` to `<table>` on `rowid` and the test asserts titles, then runs FTS5 `integrity-check` on both indexes. A companion test, `the_fts_rowid_join_detects_an_index_that_points_at_the_wrong_row`, shows a count passes where the join fails.

## Verification evidence

- **Real-tree offender count under the widened PM gate: 11, not 0.** The plan expected only `with_capacity` and `src/proc.rs`. The 11 were all `deadline`: `stress_deadline` and `deadline_instant` in `lock_contention.rs` (7 lines), `just_before_its_deadline` test names in `proc_timeout_boundary.rs` (2) and `PENDING_FOCUS_DEADLINE_MS` in `BoardView.tsx` (2). After the rename the gate reports 0 offenders (5 tests pass).
- **Planted direction, PM gate.** With the whole-word predicate restored: `assertion left == right failed: snake_case suffix  left: 0 right: 1` (the `sprint_id` case), and the `Vec::with_capacity(sprint_capacity)` case also failed (`left: 0 right: 1`).
- **Planted direction, status gate.** With a first-column-only matcher restored: `assertion left == right failed: status after another column  left: 0 right: 1`. (The restored matcher kept the new normalisation, so the split-statement case was not the one that failed; the column-order case is the evasion WR-03 named.)
- **Planted direction, FTS guard.** With `rowid` stripped from the explicit-column copies in `0023_drop_estimate.sql` (reverted afterwards, file clean): `migration_0023_keeps_search_in_sync` failed with `left: ["pelican before"]  right: ["zebrafish before"]`. A count-only assertion would have passed this mutation.
- Final runs, all green: `pm_vocabulary_gate` 5, `no_agent_status_write` 8, `migration_safety` 12 (was 11), `status_derivation` 19, `estimate_absent` 2 (`estimateSize` stays silent, `estimate` standalone still an offender), `lock_contention` 6 and `proc_timeout_boundary` 4 after the renames.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Eleven legitimate `deadline` identifiers fired the widened gate**
- **Found during:** Task 1, step 2 (the real-tree offender check)
- **Issue:** The plan's step 2 said a non-zero count means a third legitimate idiom and an `IDIOM_EXCLUSIONS` entry. The hits were in three more files, so that would mean three more path-scoped entries and a list of five against D-20's "exactly two".
- **Fix:** Renamed the identifiers instead (`stress_timeout`, `give_up_at`, `..._just_before_its_timeout_...`, `PENDING_FOCUS_TIMEOUT_MS`). This is the response `<notes_on_shape>` prescribes for an identifier that fires the widened gate, and it neither re-narrows the matcher nor grows the exclusion list. Behaviour is unchanged.
- **Files modified:** packages/core/tests/lock_contention.rs, packages/core/tests/proc_timeout_boundary.rs, packages/desktop/src/board/BoardView.tsx
- **Verification:** `pm_vocabulary_gate` passes; `cargo check -p core --tests` clean; `lock_contention` and `proc_timeout_boundary` pass.
- **Commit:** ebff257

**2. [Rule 2 - Missing critical] Status gate had no non-vacuity check per scanned tree**
- **Found during:** final verification (truth 6 asks each gate to assert its walker reached files)
- **Fix:** Added a per-tree non-empty assertion to the main status gate. `estimate_absent` and the PM gate already had one.
- **Commit:** ef3ee15

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact:** none on scope beyond three test/UI identifier renames.

## Decision for the owner: `.sql` scanning

Not implemented, deliberately (T-13-14-02, accepted). The spine pin covers three `CREATE TABLE` bodies and table classification covers table names, so a Phase 14 table with a `sprint_length_days` column passes all three gates. Reversal is one token: add `"sql"` to `SCANNED_EXTENSIONS` and bump its array length. It fires on nothing today.

## Flagged assumptions (unchanged, unresolved)

- FNC-04: the ten-word corpus plus two exclusions, matched as an identifier-component prefix, is the intended reading of the criterion.
- DRFT-04: a source gate plus an IPC-only command satisfies "no agent-writable path"; a database-level refusal on `set_task_status_in_tx` is not required.

## Known Stubs

None.

## Threat Flags

None.

## Issues Encountered

`cargo test -p flywheel-core` is not a package name; the package is `core`. `tsc --noEmit` in `packages/desktop` reports two errors in `src/theme/__tests__/brand-rule.test.ts` (`node:fs` has no `existsSync` or `globSync`), in a file this plan does not touch.

## Self-Check: PASSED

- Files modified all exist; commits ebff257, 66bd818, c7a406f, ef3ee15 are on the branch.
