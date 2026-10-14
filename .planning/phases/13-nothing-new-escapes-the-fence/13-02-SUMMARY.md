---
phase: 13-nothing-new-escapes-the-fence
plan: 02
subsystem: core
tags: [rust, context-packet, compaction, drift, fnc-05, source-gate]

requires:
  - phase: 13-01
    provides: PM-vocabulary gate (not tripped by this plan)
provides:
  - "compaction::SUMMARY_WINDOW (25): the one declaration of how many summaries enter the packet"
  - "SUMMARIES_SQL bounded to the newest window, oldest-first, LIMIT bound as a parameter"
  - "CompactionBoundary::board_total + with_board_total; boundary sentence names what was left out"
  - "drift::decision_ids_on_record + DriftInputs::echoed_ids_on_record_beyond_scope"
  - "unbounded-reads gate now scans context_packet.rs, with a planted-violation half"
affects: [13-03, 16-records, CTX-06]

actuals:
  tokens: 21000
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "bound the input of a pure fold, not the fold (the fold stays lossless over whatever it is given)"
    - "bounded point lookup resolved by the caller so a pure detector stays pure"

key-files:
  created:
    - packages/core/tests/context_packet_bound.rs
  modified:
    - packages/core/src/compaction.rs
    - packages/core/src/context_packet.rs
    - packages/core/src/drift.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/core/tests/compaction.rs
    - packages/core/tests/drift.rs
    - packages/core/tests/five_cycle_reconstitution.rs
    - packages/core/tests/epic_context_packet.rs

key-decisions:
  - "LIMIT is bound as ?2 = SUMMARY_WINDOW, not interpolated via concat!/LazyLock: keeps the 'every SQL is a literal bound through params!' header true and still declares the window once"
  - "The detector change and the LIMIT land in one commit (d624e77), per D-05 (costly)"
  - "SUMMARIES_SQL passes the gate by carrying a LIMIT; it is not allowlisted"

patterns-established:
  - "Two-sided scanner gate: scan_source_for_unbounded_selects is shared by the real-tree scan and the planted-violation test"

requirements-completed: [FNC-05]

coverage:
  - id: D1
    description: "A 200-summary task reads at most 25 summary rows; the packet does not grow with task age"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#the_packet_does_not_grow_with_task_age"
        status: pass
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#the_packet_is_strictly_smaller_for_a_small_fixture"
        status: pass
    human_judgment: false
  - id: D2
    description: "The packet states its inclusion boundary: included count, true board total, a named route to the rest, no excluded ids"
    requirement: FNC-05
    verification:
      - kind: unit
        ref: "packages/core/tests/compaction.rs#twenty_six_on_the_board_name_the_total_and_the_one_session_left_out"
        status: pass
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#the_packet_names_its_own_inclusion_boundary_and_the_true_board_total"
        status: pass
    human_judgment: false
  - id: D3
    description: "A correctly echoed decision older than the window does not fire FabricatedDecisionEcho; a decision recorded nowhere still does"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/drift.rs#a_correctly_echoed_decision_older_than_the_window_does_not_fire_a_fabricated_echo"
        status: pass
      - kind: integration
        ref: "packages/core/tests/drift.rs#an_echoed_id_recorded_nowhere_still_fires_a_fabricated_echo_naming_exactly_it"
        status: pass
    human_judgment: false
  - id: D4
    description: "context_packet.rs is inside the unbounded-reads gate; SUMMARIES_SQL is fixed, not allowlisted; the gate fires on a planted violation"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist"
        status: pass
      - kind: unit
        ref: "packages/core/tests/epic_context_packet.rs#the_unbounded_reads_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
  - id: D5
    description: "acknowledged_decisions never affects packet inclusion; a superseded record leaves the packet byte-identical"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#acknowledged_decisions_never_affects_packet_inclusion"
        status: pass
      - kind: integration
        ref: "packages/core/tests/context_packet_bound.rs#adding_a_superseded_record_leaves_the_packet_byte_identical"
        status: pass
    human_judgment: false

duration: 45 min
completed: 2026-10-14
status: complete
plan_head_before: d4b98308be45480a0206cfb3242fe0af295f9b0b
commits: 2
---

# Phase 13 Plan 02: Bounded context packet Summary

**The context packet reads at most the newest 25 session summaries (one const, bound as the SQL LIMIT), says what it left out and how to reach it, and the drift read-back resolves echoed ids beyond the window so the bound never fabricates an accusation.**

## Performance

- **Duration:** about 45 min, 16 of which were the first `cargo check -p desktop` (macOS Gatekeeper scan)
- **Started:** 2026-10-14T12:15Z
- **Completed:** 2026-10-14T13:00Z
- **Tasks:** 3
- **Files modified:** 9 (1 created, 8 edited)

## Accomplishments
- `SUMMARY_WINDOW = 25` declared once beside `VERBATIM_WINDOW`; the folded count is `SUMMARY_WINDOW - VERBATIM_WINDOW`, never declared.
- `SUMMARIES_SQL` takes the newest 25 rows and returns them oldest-first; `SUMMARIES_TOTAL_SQL` supplies the true board total.
- Boundary sentence for a windowed task: "... Summaries 176-200 of 200 read; 175 earlier sessions are on the task, readable from the task's own session history." No excluded decision id is ever named.
- `decision_ids_on_record` (one `LIMIT 1` point lookup per echoed id, both ids bound) feeds `DriftInputs::echoed_ids_on_record_beyond_scope`; `detect_drift` stays pure. The module doc and `compaction.rs` header state the D-06 consequence.
- The unbounded-reads gate scans `context_packet.rs`; its first run flagged only `SUMMARIES_SQL`, which now passes by carrying a LIMIT.

## Task Commits

TDD, scope `(13-02)`:

1. **RED** - `6d7136f` (test): `context_packet_bound.rs`, the widened gate and planted-violation test, plus a bare `SUMMARY_WINDOW` const so the tests compile. RED evidence: `the_packet_does_not_grow_with_task_age` failed `left: 200 right: 25`; `acknowledged_decisions_never_affects_packet_inclusion` failed `left: 201 right: 25`; the boundary test failed on the old sentence; the gate failed naming `SUMMARIES_SQL`.
2. **GREEN, Tasks 1 and 2 together** - `d624e77` (feat): LIMIT, boundary, board total, detector change, desktop caller, compaction and drift tests. One commit on purpose: D-05 requires the detector to change in the same diff as the LIMIT, and its acceptance check reads this commit's file list (`drift.rs` and `context_packet.rs` both present).

Task 3's tests and gate widening are in the RED commit; they pass at GREEN.

**Plan metadata:** the docs commit following this file.

## Files Created/Modified
- `packages/core/src/compaction.rs` - `SUMMARY_WINDOW`, `board_total`, `with_board_total`, extended `boundary_sentence`, D-06 header text
- `packages/core/src/context_packet.rs` - bounded `SUMMARIES_SQL`, `SUMMARIES_TOTAL_SQL`, board total wired into the boundary and the rendered sentence
- `packages/core/src/drift.rs` - "summaries in scope" contract, new `DriftInputs` field, `decision_ids_on_record`
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - resolves the beyond-scope ids before the `DriftInputs` literal
- `packages/core/tests/context_packet_bound.rs` - `scale_fixture` (200 summaries, 3 decisions, 4 paths, 30 KB prose) and six tests
- `packages/core/tests/epic_context_packet.rs` - gate widened to `context_packet.rs`, allowlist reasons, planted-violation test
- `packages/core/tests/compaction.rs`, `drift.rs`, `five_cycle_reconstitution.rs` - new cases and the new field in every `DriftInputs` literal

## Decisions Made
- LIMIT bound as a `?2` parameter rather than interpolated. The plan offered `concat!`/`LazyLock<String>`; `concat!` cannot take a const and `LazyLock` needs `format!`, which the file header forbids. The window is still declared exactly once and the statement is still a literal `&str`.
- `compact_summaries` hunk list reviewed against `HEAD~1`: the only line inside its body is `board_total: total,` in the `CompactionBoundary` literal. The plan both requires that line and forbids any line inside the body; the field cannot exist without it. The signature, the split arithmetic and the fold are untouched. Other hunks: module header, `SUMMARY_WINDOW` and its doc, the struct field and its doc, `with_board_total`, `boundary_sentence`.
- Pre-change `drift` test count was 30; it is now 34 (+4: two behaviour cases, the point-lookup test, the purity test).

## Deviations from Plan

**1. [Rule 3 - Blocking] RED commit carries a bare `SUMMARY_WINDOW` const**
- **Found during:** RED
- **Issue:** tests referencing the const would not compile, and a compile error is not a valid intentional RED.
- **Fix:** declared the const (without its doc and arithmetic) in the RED commit; GREEN adds the doc.
- **Committed in:** 6d7136f

**2. [Rule 3 - Blocking] RED covers Task 3 and the DB-level half of Task 1 only**
- **Issue:** the `board_total` unit tests and the new `DriftInputs` field do not compile before the implementation, so a committed RED for them would be INVALID_RED. They were written with the implementation and pass. The DB-level tests exercise the same behaviour through the existing API and did fail on assertions.

**3. [Rule 1 - Bug in plan] `adding_a_superseded_record...` uses identical-wording revision**
- The plan says to supersede a revision and expect byte-identity, which only holds if the successor has the same wording. The test revises a locked criterion with identical statement and hint, so the only change on the board is the superseded row `CRITERIA_SQL` hides.

**4. [Scope] Strictness of "equal in length" test**
- Compared on the rendered `## Prior Sessions` section of a 200- and a 400-summary task, not on serialized JSON, because `created_at` uses `to_rfc3339`'s variable-width fraction. Fixture text and ids are fixed width.

**Total deviations:** 4 (2 blocking, 1 plan inconsistency, 1 test-method choice). **Impact:** none on scope or on the must-haves.

## Issues Encountered
- First `cargo check -p desktop` took 16 min (Gatekeeper scan of fresh binaries, not a hang). It passed; its one warning (`drift_event_count` never read) is pre-existing and out of scope.

## Known Stubs
None. The 40-ADR and 30 KB-PRD halves of criterion 4's fixture cannot exist until Phase 16 adds those tables; the fixture's prose volume stands in, and `context_packet_bound.rs` records that Phase 16 extends it.

## Threat Flags
None. The one new SQL statement binds both ids (T-13-08); no dependency was added.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
The bounded packet and the widened gate are in place. Anything that adds a `SELECT` to `context_packet.rs` now needs a LIMIT or a reasoned allowlist entry.

## Self-Check: PASSED
- Created file exists: `packages/core/tests/context_packet_bound.rs`; commits `6d7136f` and `d624e77` exist.
- `cargo test -p core --test compaction --test drift --test context_packet --test context_packet_bound --test epic_context_packet --test five_cycle_reconstitution --test pm_vocabulary_gate` all pass (20, 34, 30, 6, 17, 10, 4); `cargo check -p desktop` passes.

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*
