---
phase: 13-nothing-new-escapes-the-fence
plan: 12
subsystem: core
tags: [rust, rusqlite, fnc-05, drift, unbounded-reads, gap-closure]

requires:
  - phase: 13-02
    provides: SUMMARY_WINDOW, the bounded context packet, and D-05's "resolve the lookup before detect_drift" contract
provides:
  - decision_ids_on_record as ONE bounded statement (capped, deduped, in-scope ids subtracted, LIMIT bound)
  - DriftInputs::echoed_ids_on_record_beyond_scope as Option (None = lookup did not run)
  - PRIOR_AUTHORING_RUNS_LIMIT and a bounded PRIOR_AUTHORING_RUNS_SQL
  - SCANNED_SINGLE_FILES, with drift.rs inside the unbounded-reads gate
affects: [phase-13-verification, drift-warnings, epic-authoring-prompt]

status: complete
plan_head_before: a161c885496b56c4fd5326059fb800c370ebd209
actuals:
  tokens: 9700
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Option on a pure detector's input to distinguish 'lookup did not run' from 'nothing found'"
    - "a scanned-file list as a named const, existence-asserted, so a rename cannot shrink a gate silently"

key-files:
  created: []
  modified:
    - packages/core/src/drift.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/tests/drift.rs
    - packages/core/tests/epic_context_packet.rs
    - packages/core/tests/five_cycle_reconstitution.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs

key-decisions:
  - "MAX_ECHOED_DECISION_CANDIDATES is derived from compaction::SUMMARY_WINDOW (25) rather than a second literal, so the two cannot drift apart"
  - "PRIOR_AUTHORING_RUNS_LIMIT = 10; the epic prompt states no run count, so the cap contradicts no text"
  - "The scan list stays an explicit named list plus the src/query walk; a derived walk of packages/core/src would need dozens of out-of-scope allow-list entries"

requirements-completed: [FNC-05]

coverage:
  - id: D1
    description: "decision_ids_on_record issues one LIMITed statement for any input length; cap boundary exact; empty input issues no statement"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/drift.rs#the_candidate_cap_boundary_returns_exactly_the_cap_and_never_panics"
        status: pass
      - kind: integration
        ref: "packages/core/tests/drift.rs#an_empty_candidate_list_returns_empty_without_touching_the_database"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed read-back omits the fabricated-echo detector instead of recording a false drift.detected"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/drift.rs#a_none_lookup_result_omits_the_fabricated_echo_warning"
        status: pass
      - kind: integration
        ref: "packages/core/tests/drift.rs#a_malformed_decisions_blob_is_an_error_not_an_empty_list"
        status: pass
    human_judgment: false
  - id: D3
    description: "PRIOR_AUTHORING_RUNS_SQL is bounded, newest runs kept, allow-list entry removed"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#prior_authoring_runs_are_bounded_and_keep_the_newest"
        status: pass
    human_judgment: false
  - id: D4
    description: "drift.rs is scanned by the unbounded-reads gate, and the gate fires on a planted json_each lookup without LIMIT"
    requirement: FNC-05
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#the_unbounded_reads_gate_fires_on_a_planted_violation"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 12: Bound the three unbounded reads Summary

`decision_ids_on_record` is now one capped, `LIMIT`ed `json_each` statement whose read error omits the fabricated-echo detector instead of defaulting to "none on record"; the epic packet's authoring-run read is bounded at 10; and `drift.rs` is inside the unbounded-reads gate.

Started 2026-10-15, three tasks, three commits, six files.

## Accomplishments

- **Task 1 (tracer), `ff59d98`.** `decision_ids_on_record(conn, task_id, candidate_ids, already_in_scope)` filters out in-scope ids, dedupes in first-seen order, truncates to `MAX_ECHOED_DECISION_CANDIDATES`, returns early on an empty list without preparing a statement, and otherwise issues exactly one statement with the candidates as a bound JSON array (`?2`) and the cap as a bound `LIMIT ?3`. `DriftInputs::echoed_ids_on_record_beyond_scope` became `Option<&[String]>`; `detect_decision_read_back` returns after its unacknowledged half when it is `None`. The desktop caller passes the packet's in-scope decision ids, logs a read error with `eprintln!`, and passes `None`.
- **Task 2, `b47fa84`.** `PRIOR_AUTHORING_RUNS_SQL` carries `LIMIT ?2` bound to `PRIOR_AUTHORING_RUNS_LIMIT as i64`; the allow-list entry and its "recorded debt" paragraph are deleted.
- **Task 3, `71169ca`.** `SCANNED_SINGLE_FILES` replaces the hand-written scan calls (existence-asserted), includes `src/drift.rs`, and carries the reasoning for not deriving a walk of all of `packages/core/src`. The planted-violation test gained a `pub fn` chunk shaped like the old lookup.

## Planted-direction confirmations

| Confirmation | Observed |
|---|---|
| `PRIOR_AUTHORING_RUNS_SQL` reverted to unbounded text | `epic_context_packet.rs: PRIOR_AUTHORING_RUNS_SQL contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS` |
| `LIMIT ?3` removed from `decision_ids_on_record` | `drift.rs: decision_ids_on_record contains a SELECT with no LIMIT and is not in ALLOWED_UNBOUNDED_SELECTS` |
| `decision_ids_on_record` reverted to per-candidate `.optional()?` | `the_candidate_cap_boundary_returns_exactly_the_cap_and_never_panics` fails: `left: 26, right: 25`. The malformed-blob test did NOT fail (see deviations). |

All three were restored; the final tree passes.

## Deviations from Plan

**1. [Plan premise wrong] The malformed-blob test does not catch a revert to the per-candidate lookup.**
- **Found during:** Task 1 acceptance criteria.
- **Issue:** the plan expects `a_malformed_decisions_blob_is_an_error_not_an_empty_list` to fail against the old implementation. The old code also propagated the `json_each` error through `.optional()?`, so it returns `Err` too. The old defect was the caller's `unwrap_or_default()`, not the callee.
- **Fix:** kept the malformed-blob test (it pins the contract the caller now depends on) and recorded the cap-boundary test as the one that detects the revert (`26 != 25`). The caller-side fix is pinned by `a_none_lookup_result_omits_the_fabricated_echo_warning`, which is two-sided.
- **Commit:** ff59d98

**2. [Rule 3 - Blocking] `usize` does not implement `rusqlite::ToSql`.**
- **Issue:** the plan asks to bind the cap "as the same integer type the cap constant is declared as". `usize` cannot be bound.
- **Fix:** `MAX_ECHOED_DECISION_CANDIDATES as i64`, the same cast `SUMMARY_WINDOW as i64` uses in `context_packet.rs`. The constant is 25, so the cast is exact; it is still a bound parameter, never formatted into the text.
- **Commit:** ff59d98

**3. [Simplification] No outer re-sort on `PRIOR_AUTHORING_RUNS_SQL`.**
- The plan asks for the `SUMMARIES_SQL` inner/outer shape. `render_epic_prompt` prints runs newest-first, which is the order the inner `ORDER BY ... DESC LIMIT` already yields, so a wrapper would be a no-op. Documented in a comment on the constant.
- **Commit:** b47fa84

**4. [Minor] Counts differ from the plan's arithmetic.**
- `epic_context_packet` runs 18 tests, not the plan's 19: the "fewer runs than the limit" half is one test with the over-limit half. `SCANNED_SINGLE_FILES` is `[&str; 3]`, not 4: only three files exist to scan. `decision_read_back_available` was not kept as a separate local binding (the `Option` carries it and an unused binding would warn).

**Total deviations:** 4 (1 wrong plan premise, 1 blocking type fix, 2 simplifications). **Impact:** none on the criterion; all must-have truths hold.

## Verification

- `RUST_TEST_THREADS=1 cargo test -p core --test drift`: 40 passed (was 34).
- `RUST_TEST_THREADS=1 cargo test -p core --test epic_context_packet`: 18 passed.
- `RUST_TEST_THREADS=1 cargo test -p core --test context_packet_bound`: 6 passed.
- `cargo check -p desktop`: finished; its one warning (`drift_event_count` dead code) predates this plan.
- `five_cycle_reconstitution` compiles with the `Some(&[])` literal.
- No bare `cargo test` was run.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; T-13-12-01..03 are mitigated as planned, T-13-12-04 accepted (the epic packet now withholds runs older than the newest 10).

## Self-Check: PASSED

- Commits `ff59d98`, `b47fa84`, `71169ca` exist.
- Modified files exist; `grep -n -A6 'decision_ids_on_record(' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -c unwrap_or_default` prints 0.
