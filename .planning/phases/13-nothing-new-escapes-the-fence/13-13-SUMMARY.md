---
phase: 13-nothing-new-escapes-the-fence
plan: 13
subsystem: core-source-gates
tags: [rust, fnc-01, fnc-02, fnc-03, gap-closure, wr-03, wr-04, wr-05, wr-13]

requires:
  - phase: 13-05
    provides: Gate 1 (no agent-reachable module writes a canonical table) with a derived INSERT side
  - phase: 13-09
    provides: the authority ledger and ALLOWED_CANONICAL_UPDATE_SITES
provides:
  - Gate 1 derives both INSERT and UPDATE patterns from canonical_tables(), with one owner per table
  - case- and whitespace-normalised matching covering INSERT OR REPLACE and REPLACE INTO
  - allow-list entries that exempt one exact normalised statement, with an exactly-once stale check
  - Gate 6 scanning core, desktop src-tauri and sidecar with a non-vacuity assertion
  - an authority ledger that records the status-writer and branch-merge scoping decision (WR-13)
affects: [phase-14-schema-work, phase-16-prd-adr-tables]

status: complete
plan_head_before: 51acfef9b7e6fa3dea7f42bb294ae2122faf08f5
actuals:
  tokens: 14000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A source gate matches against whitespace-collapsed lowercased text with identifier-boundary checks, and maps a hit back to the line it starts on"
    - "Ownership is declared per table and checked against the classification in both directions"

key-files:
  created: []
  modified:
    - packages/core/tests/proposal_no_promotion.rs
    - packages/core/src/domain/actor.rs
    - packages/desktop/src-tauri/src/commands/git_identity.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - .planning/phases/13-nothing-new-escapes-the-fence/13-AUTHORITY-ALLOWLIST.md

key-decisions:
  - "Per-table ownership (CANONICAL_TABLE_OWNERS) replaces the file-level 'owns all inserts/updates' model. Owning issues no longer grants tasks."
  - "An allow-list entry exempts a hit only when the statement at that spot equals the entry and ends at a closing quote, a semicolon or end of body. A longer statement that merely begins with the entry is an offender."
  - "Offenders are reported once per line (the line a statement starts on), so a line holding both an INSERT and an UPDATE is one offender and a statement split over lines is still caught."
  - "Status writers and branch merge stay outside FNC-03 as a recorded scoping decision; the gate was not widened."

requirements-completed: [FNC-02, FNC-03, FNC-01]

coverage:
  - id: D1
    description: "Gate 1's UPDATE side is derived from canonical_tables() and every Canonical table has exactly one owner, asserted in both directions; an empty derivation fails loudly on both sides"
    requirement: FNC-02
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#every_canonical_table_has_exactly_one_owner"
        status: pass
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#an_empty_derivation_fails_loudly_on_both_sides"
        status: pass
    human_judgment: false
  - id: D2
    description: "Matching is case- and whitespace-insensitive, covers INSERT OR REPLACE / REPLACE INTO, does not cross-match tasks_fts, and reports one sorted offender per line"
    requirement: FNC-02
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#the_canonical_update_gate_fires_on_a_planted_parent_touch"
        status: pass
    human_judgment: false
  - id: D3
    description: "An allow-list entry exempts one exact statement; a second or longer statement in the same file is an offender; a stale or duplicated entry fails the build"
    requirement: FNC-03
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#a_second_statement_in_an_allowlisted_file_is_still_an_offender"
        status: pass
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#every_allowlisted_update_site_still_exists"
        status: pass
    human_judgment: false
  - id: D4
    description: "Gate 6 scans the three trees its comment names and the git_identity interpolation is gone"
    requirement: FNC-01
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#no_sql_statement_interpolates_a_table_name"
        status: pass
      - kind: integration
        ref: "packages/core/tests/proposal_no_promotion.rs#the_table_name_interpolation_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
  - id: D5
    description: "The authority ledger records the status-writer and branch-merge scoping decision with a revisit condition, and actor.rs no longer claims to cover merging"
    requirement: FNC-03
    verification:
      - kind: command
        ref: "grep -c 'Deliberately outside FNC-03' 13-AUTHORITY-ALLOWLIST.md"
        status: pass
    human_judgment: true
    rationale: "Whether the recorded reasoning is the right boundary is a product judgment; the test only proves the section exists."

duration: 25 min
completed: 2026-10-15
---

# Phase 13 Plan 13: Gate widening for FNC-02, FNC-03 and FNC-01 Summary

**Gate 1 now derives both its INSERT and UPDATE patterns from the table classification, matches on normalised text with one owner per table, exempts only exact statements, and Gate 6 scans the three trees it announces.**

## Accomplishments

- **Task 1 (7544fb4):** `canonical_update_patterns()` derives `update <table> set` from `canonical_tables()`. `CANONICAL_UPDATE_PATTERNS`, `CANONICAL_WRITER_SUFFIXES` and `CANONICAL_UPDATE_OWNERS` are deleted. `CANONICAL_TABLE_OWNERS` names one owner per table. `normalise_sql` follows the `priority_is_opt_in.rs` shape. Hits respect identifier boundaries, so `tasks_fts` does not match `tasks`.
- **Task 2 (e68bfbe):** the stale check asserts exactly one occurrence. A planted test proves a second and a longer statement in an allow-listed file are offenders. The ledger gained the detach rows and `## Deliberately outside FNC-03 (WR-13)`. `actor.rs` no longer lists merging among the helper's transitions.
- **Task 3 (b9e64fe):** Gate 6 walks `packages/core/src`, `packages/desktop/src-tauri/src` and `packages/sidecar/src` (Rust files only) and asserts more than 50 files scanned. `git_identity.rs` selects between two static statements with a `match`.

## Planted-direction confirmations

1. **Normalisation (task 1).** The line-join separator was temporarily changed from a space to a newline, which stops whitespace collapsing across lines. Observed: `assertion left == right failed: must be exactly one offender: "tx.execute(\"INSERT\n  INTO tasks (id) VALUES (?1)\", [id])?;\n"  left: 0 right: 1`. Restored.
2. **Exact statement (task 2).** The exact-statement check was temporarily relaxed to a bare `starts_with`. Observed: `assertion left == right failed: a prefix of the allow-listed statement is not the statement  left: 0 right: 1`. Restored. The plan's literal case (a second `UPDATE tasks SET status` beside the allow-listed touch) passes under both forms here, because the new matcher compares whole statements from the start; the longer-statement case is the one that distinguishes exact from prefix.
3. **Gate 6 over the widened tree (task 3).** The `format!` was temporarily restored in `git_identity.rs`. Observed: `.../packages/desktop/src-tauri/src/commands/git_identity.rs:69: .query_row(&format!("SELECT title FROM {title_table} WHERE id = ?1"), [&resolution.item_id], |row| row.get(0))`. Restored.

The `actor.rs` sentence now reads: "Branch merge is not among them: it records its event through `merge::record_merge_event`, which does not call this helper, and the reason is recorded in `13-AUTHORITY-ALLOWLIST.md` under "Deliberately outside FNC-03"." The only remaining occurrence of the word is inside that sentence ("Branch merge").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Third detach statement needed an allow-list entry**
- **Found during:** Task 1
- **Issue:** Per-table ownership makes `epic.rs`'s `UPDATE tasks SET epic_id = NULL` (the delete-epic child-task detach) an offender. The plan named only the two issue-detach statements. The old file-level rule had exempted it silently.
- **Fix:** Added an exact-statement entry for it (with reason) to `ALLOWED_CANONICAL_UPDATE_SITES` and a ledger row. The allow-list now has five entries, in the same order as the five ledger rows.
- **Files modified:** `packages/core/tests/proposal_no_promotion.rs`, `13-AUTHORITY-ALLOWLIST.md`
- **Commit:** 7544fb4, e68bfbe

**2. [Rule 3 - Blocking] Issue-detach entries landed in task 1, not task 2**
- **Found during:** Task 1
- **Issue:** The plan lets task 1 end with the real gate red until task 2 adds the entries. A red commit is not bisectable.
- **Fix:** The detach entries (and the full-statement form they need) went into the task 1 commit. Task 2 added the exactly-once check, the planted test and the ledger.
- **Commit:** 7544fb4

**3. [Rule 1 - Bug] Widened Gate 6 found a second interpolation site**
- **Found during:** Task 3
- **Issue:** `packages/desktop/src-tauri/src/commands/agent_run.rs` (a `#[cfg(test)]` row-count helper) built `SELECT COUNT(*) FROM {table}` with `format!`. Every call passes a literal, so it was not injectable.
- **Fix:** One static statement per table via `match`, with a panic arm for unknown names. The gate was not narrowed to skip test code, per the plan's prohibition.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Verification:** `cargo test -p desktop --bin desktop build_preview_dto_performs` passes.
- **Commit:** b9e64fe

**4. [Plan scope note] Offenders are line-numbered, not lost**
- The plan accepted losing line numbers to normalisation. The matcher keeps a byte-offset-to-line map instead, which is also what makes "one offender per line" hold.

**Total deviations:** 3 auto-fixed (2 Rule 3, 1 Rule 1) plus one scope note. **Impact:** none on the plan's goals; the allow-list has one more entry than the plan listed.

## Verification

- `cargo test -p core --test proposal_no_promotion`: 15 passed
- `cargo test -p core --test authority_human_only`: 28 passed
- `cargo test -p core --test table_classification`: 2 passed
- `cargo test -p core --test pm_vocabulary_gate`: 5 passed; `--test no_agent_status_write`: 8 passed
- `cargo build -p desktop`: finished (one pre-existing dead-field warning in `agent_run.rs`, not touched)
- `grep -c title_table git_identity.rs`: 0

## Known Stubs

None.

## Next Phase Readiness

Phase 14 can add tables against a Gate 1 that covers `UPDATE` by default. A new Canonical table must be named in `CANONICAL_TABLE_OWNERS` or `every_canonical_table_has_exactly_one_owner` fails.

## Self-Check: PASSED

- `packages/core/tests/proposal_no_promotion.rs`, `13-AUTHORITY-ALLOWLIST.md`, `actor.rs`, `git_identity.rs`, `agent_run.rs`: modified and committed.
- Commits 7544fb4, e68bfbe, b9e64fe exist; `git rev-list --count` from `plan_head_before` is 3.
