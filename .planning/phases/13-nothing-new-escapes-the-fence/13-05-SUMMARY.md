---
phase: 13-nothing-new-escapes-the-fence
plan: 05
subsystem: testing
tags: [rust, sqlite, source-gate, schema-pin, classification, fnc-01, fnc-02]

requires:
  - phase: 13-01
    provides: two-sided gate house style and the PM-vocabulary gate the new code does not trip
  - phase: 13-03
    provides: migration 0023, so the spine pin is written against the post-drop schema (no estimate, rebuilt-by-RENAME quoting)
  - phase: 13-04
    provides: documents reconciled; recorded that FNC-01's spine pin is this plan's
provides:
  - "schema_classification::TABLE_CLASSES: all 25 tables in five classes with no catch-all, and canonical_tables()"
  - "table_classification.rs: sqlite_master compared with the list in both directions, proven to fire on a planted table"
  - "spine_pin.rs: normalised CREATE TABLE text of epics, tasks, issues pinned; epics' foreign-key parents pinned"
  - "proposal_no_promotion.rs: Gate 1's write patterns derived from the canonical class; prd/adr/cycle_assignment corpus cases; crate-wide no-interpolated-table-name gate"
affects: [14-cycles, 16-records, fnc-01, fnc-02]

actuals:
  tokens: 9000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "closed-world table classification: const list in core, checked against sqlite_master by a test, never an enum"
    - "derive a gate's coverage from data (canonical_tables) and assert the derivation is non-empty"
    - "pin a table's DDL as read from sqlite_master through a comment- and whitespace-stripping normaliser"

key-files:
  created:
    - packages/core/src/schema_classification.rs
    - packages/core/tests/table_classification.rs
    - packages/core/tests/spine_pin.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/query/search.rs
    - packages/core/tests/proposal_no_promotion.rs
    - .planning/todos/completed/2026-10-05-git-identity-builds-a-table-name-into-sql-with-format.md

key-decisions:
  - "Classification is data, not an enum: a migration is SQL text and reaches the database without the compiler seeing it (D-22). TableClass has five variants and no catch-all."
  - "The pin captures the post-0023 shape as sqlite_master renders it, including the quoted names \"epics\" and \"tasks\" that migration 0023's RENAME left behind; issues is unquoted because it was never rebuilt."
  - "The unreachable half of Phase 13 criterion 1 (chain above epics ends at the cycle table) is recorded in the test's doc comment as a one-const edit for Phase 14; no cycles table, placeholder or skipped test was created."

patterns-established:
  - "Adding a table: classify it in TABLE_CLASSES in the same diff, or table_classification.rs fails the build"
  - "Adding a canonical table: classifying it Canonical is enough for Gate 1 to cover it"

requirements-completed: [FNC-01, FNC-02]

coverage:
  - id: D1
    description: "Every table in a migrated database is classified exactly once and every classification names a real table; an unclassified table fails the build"
    requirement: FNC-02
    verification:
      - kind: unit
        ref: "packages/core/tests/table_classification.rs#every_table_in_the_database_is_classified_and_every_classification_exists"
        status: pass
      - kind: unit
        ref: "packages/core/tests/table_classification.rs#the_classification_gate_fires_on_a_planted_table"
        status: pass
    human_judgment: false
  - id: D2
    description: "The DDL of epics, tasks and issues is pinned against the post-0023 schema, and the pin is proven to fire"
    requirement: FNC-01
    verification:
      - kind: unit
        ref: "packages/core/tests/spine_pin.rs#the_spine_ddl_is_pinned"
        status: pass
      - kind: unit
        ref: "packages/core/tests/spine_pin.rs#the_spine_pin_fires_on_a_planted_ddl_change"
        status: pass
      - kind: unit
        ref: "packages/core/tests/spine_pin.rs#normalisation_ignores_comments_and_whitespace_but_not_a_column"
        status: pass
    human_judgment: false
  - id: D3
    description: "The foreign-key parents of epics are pinned, so a new parent fails the build until the const is edited"
    requirement: FNC-01
    verification:
      - kind: unit
        ref: "packages/core/tests/spine_pin.rs#the_parent_chain_above_epics_is_pinned"
        status: pass
    human_judgment: false
  - id: D4
    description: "The no-promotion gate derives its canonical write patterns from the classification, with a non-empty, one-per-table assertion"
    requirement: FNC-02
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#the_derived_write_patterns_cover_every_canonical_table"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#no_agent_reachable_module_writes_a_canonical_table"
        status: pass
    human_judgment: false
  - id: D5
    description: "prd, adr and cycle_assignment target types are refused at the staging boundary on both entry routes and write no canonical row"
    requirement: FNC-02
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#every_corpus_case_proves_zero_canonical_rows_before_triage"
        status: pass
    human_judgment: false
  - id: D6
    description: "No SQL in core builds a table name in; the gate is proven to fire"
    requirement: FNC-02
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#no_sql_statement_interpolates_a_table_name"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_no_promotion.rs#the_table_name_interpolation_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
  - id: D7
    description: "Phase 13 criterion 1's clause that the chain above epics ends at the cycle table"
    verification: []
    human_judgment: true
    rationale: "The cycles table does not exist until Phase 14. The mechanism is in place and the deferral is recorded in source, but the clause itself cannot be satisfied or checked here."

duration: 22 min
completed: 2026-10-14
status: complete
plan_head_before: dd04e4c998bfafbfd9eaa0412f4dfd7718eda01b
commits: 3
---

# Phase 13 Plan 05: The schema is closed-world Summary

**Every one of the 25 tables is classified in a core const checked against `sqlite_master`, the spine's post-0023 DDL and the foreign-key parents of `epics` are pinned, and the no-promotion gate now derives its canonical-table coverage from the classification instead of naming tables.**

## Performance

- **Duration:** 22 min (first-exec Gatekeeper scans were most of it)
- **Started:** 2026-10-14T15:20:00Z
- **Completed:** 2026-10-14T15:43:00Z
- **Tasks:** 3
- **Files modified:** 8 (3 created, 4 edited, 1 todo moved and amended)

## Accomplishments

- `TABLE_CLASSES` holds **25** entries, and the test reads exactly 25 non-`sqlite_`, non-FTS-shadow tables from a migrated database. Split: 5 Canonical, 1 Staging, 10 Runtime, 5 Infrastructure, 4 SearchIndex. The plan's enumeration matched the database's own answer exactly on the first run.
- A table added to the schema without an entry, or an entry naming a table that is not there, fails `table_classification.rs`, with both offender lists sorted by name. The planted-table test proves the comparison fires.
- The three spine DDL literals were generated from `sqlite_master` through `normalise_ddl`, not hand-typed. They pin the post-0023 shape: no `estimate`, and `"epics"`/`"tasks"` quoted as migration 0023's `RENAME` left them.
- `canonical_write_patterns()` replaces the hardcoded list; adding a table classified `Canonical` extends Gate 1 with no other edit.
- Three corpus cases (`prd`, `adr`, `cycle_assignment`) prove the target type is refused four ways: the enum, the typed payload, the migration 0015 CHECK on a raw INSERT, and `apply_proposal_created` returning `Ignored` with nothing staged.
- The crate-wide interpolation gate ran against the real tree and found one real site (see Deviations 2).

## Task Commits

1. **Task 1: The classification list, checked against sqlite_master** - `177cd42` (feat)
2. **Task 2: The spine DDL pin and the foreign-key chain above epics** - `5c6468b` (test)
3. **Task 3: Gate coverage by class, corpus, interpolation gate, todo closed** - `34149ad` (test)

**Plan metadata:** the docs commit following this file.

## Files Created/Modified

- `packages/core/src/schema_classification.rs` - `TableClass`, `TABLE_CLASSES`, `canonical_tables()`
- `packages/core/src/lib.rs` - module declaration
- `packages/core/tests/table_classification.rs` - the two-direction check and its firing half
- `packages/core/tests/spine_pin.rs` - the DDL pins, `normalise_ddl`, the foreign-key pin, four tests
- `packages/core/tests/proposal_no_promotion.rs` - derived patterns, three corpus cases, Gate 6
- `packages/core/src/query/search.rs` - one static `MATCH` clause per FTS table
- `.planning/todos/completed/2026-10-05-git-identity-builds-a-table-name-into-sql-with-format.md` - moved with `git mv`, Resolution appended

## Decisions Made

See key-decisions. One note on `git_identity.rs`: the grep confirmed it no longer interpolates a table name. Its two `format!` calls build `--disambiguate=` and `--format=` git arguments. No code change was made there; the todo's Resolution records this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan arithmetic] The corpus already had 17 cases, not 14**
- **Found during:** Task 3
- **Issue:** the plan says to raise the floor to 17, assuming 14 existing cases. `CORPUS` held 17 before this plan, so three new cases make 20. A floor of 17 would let three cases be deleted unnoticed.
- **Fix:** the floor is 20. The test keeps its name `corpus_declares_at_least_14_labelled_adversarial_cases` because the plan names it as an artifact; only the number and message changed.
- **Files modified:** `packages/core/tests/proposal_no_promotion.rs`
- **Committed in:** `34149ad`

**2. [Rule 3 - Blocking] The interpolation gate's first run found a real site in `query/search.rs`**
- **Found during:** Task 3
- **Issue:** `MATCH_WHERE` was a const template with `FROM {table} WHERE {table} MATCH`, filled by `.replace("{table}", "epics_fts")` and `"tasks_fts"`. Not caller-supplied, but exactly the shape the gate and the plan's own `grep` acceptance criterion exist to remove. The plan assumed `git_identity.rs` was the only candidate.
- **Fix:** two fully static consts, `EPICS_MATCH_WHERE` and `TASKS_MATCH_WHERE`. Statement text is byte-identical after substitution.
- **Files modified:** `packages/core/src/query/search.rs`
- **Verification:** `search_filter` 14 of 14, `migration_safety` 11 of 11 (includes the 0023 search-sync test), the plan's `grep` reports 0.
- **Committed in:** `34149ad`

**3. [Rule 1 - Plan wording] "BOTH entry routes" for `create_proposal` cannot take a target-type string**
- **Found during:** Task 3
- **Issue:** `create_proposal` accepts a typed `ProposalPayload`, so no `targetType` string reaches it, and `apply_proposal_created` ignores the event's `targetType` and derives it from the payload `kind`. "Drive both routes with a targetType" is not literal for the first.
- **Fix:** the route-1 proof is that `ProposalPayload` cannot parse the kind plus the CHECK refusing a raw staging INSERT; the route-2 proof is `apply_proposal_created` returning `Ignored` with zero rows staged. Both assert unchanged canonical counts.
- **Committed in:** `34149ad`

**4. [Rule 3 - Scope] Spine pin has four tests, and one behavior clause was not implemented**
- **Found during:** Task 2
- **Issue:** the plan expects 3 passing tests; a fourth (`normalisation_ignores_comments_and_whitespace_but_not_a_column`) was added because the "comment or whitespace change does not fail" behavior had no test of its own. Separately, the behavior bullet's second clause ("no other table declares a foreign key referencing a parent of `epics` that the const does not name") has no coherent reading for `projects` and `actors`, which most tables reference. The action text asks only for `pragma_foreign_key_list('epics')` equal to the const, which is what is implemented.
- **Committed in:** `5c6468b`

---

**Total deviations:** 4 (2 plan-wording, 1 plan arithmetic, 1 blocking find). **Impact:** none on scope. Deviation 2 is the gate working as intended.

## Issues Encountered

- First `cargo test` of each target paid the macOS Gatekeeper scan; `proposal_no_promotion` and `table_classification` relinked because `core` changed. Re-runs took under a second.

## Known Stubs

None. No placeholder, empty-value or TODO text introduced. `13-LIVE-PLANNING-RUN.md` remains the owner's open item from plan 13-04.

## Threat Flags

None. No endpoint, auth path or trust-boundary schema surface added; T-13-20 to T-13-23 are mitigated by the tests named above, T-13-24 accepted (no dependency added).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 14 adding `cycles` and `epics.cycle_id` fails `the_parent_chain_above_epics_is_pinned` and `table_classification.rs` until `FOREIGN_KEY_PARENTS_ABOVE_EPICS` and `TABLE_CLASSES` are edited in the same diff. That is the intended hand-off; the "cycles has no parent, nothing references it" half is two assertions added beside the existing one.
- Phase 16's record tables need classifying (almost certainly `Canonical`); Gate 1 then covers them by default. The prd/adr/cycle_assignment corpus cases flip from refused-at-the-boundary to staged-and-requires-triage when the CHECK and enum widen; their zero-canonical-rows assertion stays.

## Verification

- `cargo test -p core --test table_classification`: 2 passed
- `cargo test -p core --test spine_pin`: 4 passed
- `cargo test -p core --test proposal_no_promotion`: 10 passed (20 corpus cases)
- `cargo test -p core --test migration_safety --test pm_vocabulary_gate --test estimate_absent --test search_filter`: 11, 4, 2, 14 passed
- `cargo check -p core`: pass
- No cycle table or column in `packages/core/src/db/migrations`; migration 0015's `target_type IN` list unchanged (grep count 1).
- Not run: the rest of the 121 core test binaries (Gatekeeper cost; scoped runs per the environment note).

## Self-Check: PASSED

- FOUND: packages/core/src/schema_classification.rs, packages/core/tests/table_classification.rs, packages/core/tests/spine_pin.rs
- FOUND commits: 177cd42, 5c6468b, 34149ad (`git rev-list --count dd04e4c..HEAD` = 3)
- FOUND: todo under `.planning/todos/completed/`, none under `pending/`

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*
