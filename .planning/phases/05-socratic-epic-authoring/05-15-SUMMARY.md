---
phase: 05-socratic-epic-authoring
plan: 15
subsystem: authoring
tags: [rust, rusqlite, bounded-reads, measurement, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: plan 05-13's `measure_authoring_run` read-only measurement harness and its `uat_authoring_ops measure-run` binary branch
provides:
  - A last-acceptance read that no read bound can truncate (single-row `MAX()` aggregate)
  - An amended-ids read bounded by amended PROPOSAL, not by amendment event, so an old amendment still counts
  - A deterministic, specified order on every bounded read in the measurement path
affects: [05-REVIEW.md WR-05, 05-VERIFICATION.md truth #9 caveat, the Product Kill Criterion's in-app arm]

# Actuals (#2632)
actuals:
  tasks: 2
  commits: 3
plan_head_before: c4c3e97

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split one bounded read into two purpose-shaped reads when a single window cannot serve both ends of the same set"
    - "Single-row aggregate (`MAX`) instead of a bounded row scan when the answer is an extremum over the whole matching set — no bound survives to truncate it"
    - "`SELECT DISTINCT` on the bounded read so the window counts distinct subjects, not repeated events about one subject"

key-files:
  created: []
  modified:
    - packages/core/src/query/authoring.rs
    - packages/core/tests/authoring_measurement.rs

key-decisions:
  - "Followed the plan over the review's literal WR-05 prescription. Ordering the combined event read DESC before the LIMIT would fix `last_accepted_at` and simultaneously break `amended_before_accept`: an amendment always precedes the acceptance it belongs to, so a newest-first window discards exactly the rows the amended-ids answer needs. One window cannot serve both ends of one set."
  - "The last-acceptance read carries no ORDER BY and no LIMIT by design — it is a single-row `MAX(e.occurred_at)` aggregate over the whole matching set. `MAX` over an empty set yields SQL NULL, which `query_row` reads straight into `None`, so the existing no-acceptances case needs no special branch."
  - "The amended-ids read is `DISTINCT` by `stream_id` (proposal), not by amendment event, so a proposal amended repeatedly never spends the window more than once."
  - "The proposal read's tie-break (`ORDER BY created_at DESC, id DESC`) deliberately matches `list_rejected_for_epic`'s existing idiom rather than inventing a second ordering convention in the same module."

requirements-completed: [SHAPE-02]

coverage:
  - id: D1
    description: "The run's last acceptance reported by the measurement is the true newest one, whatever the read bound is"
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_last_acceptance_is_the_newest_even_when_the_event_count_exceeds_the_bound"
        status: pass
      - kind: other
        ref: "test \"$(grep -c 'MAX(e.occurred_at)' packages/core/src/query/authoring.rs)\" = \"1\" — the last-acceptance read is a single-row aggregate, not a bounded row scan"
        status: pass
    human_judgment: false
  - id: D2
    description: "An amendment that happened before the read bound's window still counts toward amended-before-accept"
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#an_amendment_older_than_the_bound_still_counts_toward_amended_before_accept"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every bounded read in the measurement has an explicit, deterministic order; two proposals created in the same instant are read back in the same order on every call"
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_proposal_read_is_stable_when_two_rows_share_a_created_at"
        status: pass
      - kind: other
        ref: "Direct inspection of every LIMIT-bearing statement in packages/core/src/query/authoring.rs (lines 121, 266, 274, 308, 371, 414, plus the composed statement at 61/71 ordered at 107) — all six carry an explicit ORDER BY. See the documented discrepancy below: the plan's count-based threshold of >=8 is wrong, the property it stands for holds."
        status: pass
    human_judgment: false
  - id: D4
    description: "The measurement still writes nothing and migrates nothing: two calls against an unchanged database leave it byte-identical, including under a bound smaller than the data"
    requirement: "SHAPE-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_measurement_writes_nothing_the_same_call_twice_leaves_the_database_byte_identical"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_measurement.rs#the_measurement_is_reproducible_under_a_bound_smaller_than_the_data"
        status: pass
      - kind: other
        ref: "test \"$(grep -v '^[[:space:]]*//' packages/core/src/query/authoring.rs | grep -cE '\\bconn\\.execute\\b|INSERT INTO|UPDATE |DELETE FROM')\" = \"0\""
        status: pass
    human_judgment: false
  - id: D5
    description: "Every statement in the measurement is a compile-time SQL literal with bound parameters"
    requirement: "SHAPE-02"
    verification:
      - kind: other
        ref: "test \"$(grep -cE 'format!\\(.*(SELECT|FROM|WHERE|ORDER BY|LIMIT)' packages/core/src/query/authoring.rs)\" = \"0\""
        status: pass
    human_judgment: false

completed: 2026-09-24
status: complete
---

# Phase 05 Plan 15: Purpose-Shaped Bounded Reads Summary

**`measure_authoring_run`'s one combined, wrongly-ordered event read is now two purpose-shaped reads — an unbounded `MAX()` aggregate for the last acceptance and a `DISTINCT`, separately-bounded read for amended proposal ids — so neither answer can be truncated by the other's window, and every bounded read in the path has a specified order.**

## Accomplishments

- **WR-05's first defect is closed.** The last acceptance is now `SELECT MAX(e.occurred_at) ...`, a single-row aggregate with no `LIMIT` — there is no bound left for a bound to truncate, so the newest acceptance always wins regardless of the requested limit. Previously the combined read ordered `ASC` before `LIMIT`, keeping the *oldest* events once a run exceeded the 200-event bound.
- **WR-05's second defect is closed.** The proposal read gained `ORDER BY created_at DESC, id DESC` before its `LIMIT`, matching `list_rejected_for_epic`'s existing tie-break, so two rows sharing a `created_at` come back in a stable, specified order instead of an unspecified one.
- **The amended-ids read became `DISTINCT` by proposal.** The bound now counts amended *proposals*, not amendment *events*, so a proposal amended repeatedly never spends the window more than once and an amendment far older than a later acceptance still survives a small bound.
- **Four new tests**, three of them genuine RED-then-GREEN against the defect, one added in Task 2 for reproducibility under a bound smaller than the data. `cargo test -p core --test authoring_measurement` reports 9 passed, 0 failed.
- **No regressions** in the suites that share these tables or this bounded-read idiom: `authoring_acceptance` 8/8, `authoring_proposal` 42/42 (including the no-accept-all regression gate), `epic_context_packet` 16/16. `cargo test --workspace` exits 0; `cargo build --workspace` and `cargo build -p core --bin uat_authoring_ops` are clean.

## Task Commits

1. **Task 1 RED:** `c1acaa5` — `test(05-15): add failing tests for correct bounded reads in measure_authoring_run` (+167 lines, 3 tests)
2. **Task 1 GREEN:** `a98e790` — `feat(05-15): split measure_authoring_run's bounded reads by purpose (WR-05)`
3. **Task 2:** `6b8826e` — `test(05-15): prove the measurement is reproducible under a bound smaller than the data` (+52 lines, 1 test)

## Files Created/Modified

- `packages/core/src/query/authoring.rs` — the combined `event_stmt` row scan and its hand-rolled fold replaced by a `MAX(e.occurred_at)` `query_row` aggregate plus a `SELECT DISTINCT e.stream_id` bounded statement; `ORDER BY created_at DESC, id DESC` added to the proposal read; the doc comment now records *why* these are two reads rather than one ordered read.
- `packages/core/tests/authoring_measurement.rs` — four new tests; `an_amendment_older_than_the_bound_still_counts_toward_amended_before_accept` was redesigned in the GREEN commit to hold total proposal count within the read's own limit, isolating the amended-ids defect from proposal-read truncation (a separate concern, out of this fix's scope).

## Deviations from Plan

### Documented discrepancy (plan arithmetic, not a code defect)

**Task 1's `<verify>` command `test "$(grep -v '^[[:space:]]*//' packages/core/src/query/authoring.rs | grep -c 'ORDER BY')" -ge "8"` FAILS — the actual count is 7.**

This is a miscount in the plan, not an unmet property. The baseline at `c4c3e97` was 6. The fix added two `ORDER BY` clauses (the proposal read at line 371, the amended-ids read at line 414) and *removed* one (the old combined event read's `ORDER BY e.occurred_at ASC`, whose replacement is the `MAX()` aggregate that correctly carries no ordering). Net is +1, giving 7 — the plan's threshold assumed both additions were net-new and did not account for the removal it was itself prescribing.

The property the count stands for — *"every bounded read in the measurement has an explicit, deterministic order"* — was verified directly instead of by count. Every `LIMIT`-bearing statement in the file carries an `ORDER BY`: lines 121, 266, 274, 308, 371 and 414, plus the composed statement whose `LIMIT` fragments are at 61/71 and whose ordering is at 107. The one statement with no `ORDER BY` is the `MAX()` aggregate, which also has no `LIMIT` and is documented in-code as ordering-free by design.

No code change was made to satisfy the count. Adding a redundant `ORDER BY` to a single-row aggregate purely to reach 8 would be ceremony that misrepresents the read's shape.

### Executor interruption (process, not code)

The dispatched executor stalled twice waiting on a `cargo test --workspace` run it had backgrounded, then terminated on an API error while writing this SUMMARY. All three task commits had already landed and the working tree was clean. The orchestrator closed the plan out per `execute-phase.md`'s `safe_resume_gate` recovery path (*"close out manually — inspect commits, write SUMMARY.md, then update STATE/ROADMAP"*), re-running every one of the plan's `<verify>` commands against the committed tree rather than accepting the executor's partial self-report. Every result recorded above is a measured run, not an inherited claim.

---

**Total deviations:** 0 auto-fixed. 1 documented plan-verify count discrepancy (no code impact). 1 process interruption recovered by manual close-out.

## Issues Encountered

The executor's stall-then-fail is recorded above. No code or design issues.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- WR-05 is closed, which matters beyond its Warning severity: `elapsed_minutes` and `amended_before_accept` are the two numbers the Product Kill Criterion's in-app arm reports, and plan 05-17 builds the comparison harness on top of them. That harness now reads from a measurement that cannot silently under-report on a long run.
- Remaining in this gap-closure round: `05-16` (WR-06, the live script's hardcoded SHAPE-05 result) and `05-17` (the two end-of-phase judgements).

## Self-Check: PASSED

- `packages/core/src/query/authoring.rs` — FOUND, modified
- `packages/core/tests/authoring_measurement.rs` — FOUND, modified
- Commit `c1acaa5` (test, Task 1 RED) — FOUND in `git log --oneline`
- Commit `a98e790` (feat, Task 1 GREEN) — FOUND in `git log --oneline`
- Commit `6b8826e` (test, Task 2) — FOUND in `git log --oneline`
- All Task 1 and Task 2 `<verify>` commands re-run against the committed tree; all pass except the `ORDER BY >= 8` count, documented above with the underlying property verified directly.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*
