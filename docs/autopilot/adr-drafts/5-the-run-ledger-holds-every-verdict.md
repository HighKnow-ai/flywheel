# The Run ledger holds every verdict, and replaces check_runs

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then. It re-expresses ADR 0012 and keeps its meaning.

## Context

`check_runs` holds Check results keyed by Story and Check, with no run, actor or Landing id. Reviews live in their own tables. A Correction record has no home. "The run of record" is defined only as the hand-off run (ADR 0012).

Autopilot needs one place for every verdict. The Batcher needs a Batch's Merge gate result. Escalation counts a Story's corrections. The `retro` pass reads every Check result, Agent review and Correction record.

## Decision

- **One append-only table, the Run ledger, holds every verdict.** Each row has:
  - a run id;
  - a subject (a Story or a Landing);
  - a kind (Check, Agent review, Merge gate, Correction or Skip);
  - the actor;
  - the head commit;
  - the verdict;
  - a reference to its evidence;
  - the time.
- **Nothing updates or deletes a row.**
- **`check_runs` migrates into the ledger,** as rows of kind Check.
- **The run of record is a query:** the latest Check rows for the head the Story last handed off. ADR 0012's staleness rule is the same query, with the same meaning.
- **A Story's correction count is the number of its Correction rows.** The third one escalates it.

## Rejected alternatives

- **A ledger beside `check_runs`.** A Check result would then have two homes.
- **Reusing the events table.** Events record state changes for the UI and the audit, and carry no verdict or evidence.

## Consequences

- A migration moves the `check_runs` rows into the ledger.
- `current_result` and the staleness reads become ledger queries.
- The learning edge reads one table.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/run_ledger.rs`: `the_run_of_record_is_the_latest_check_rows_for_the_handed_off_head` `a_check_run_against_an_older_head_reads_stale_as_adr_0012_says` `the_third_correction_row_escalates` `no_statement_updates_or_deletes_a_ledger_row`
- `packages/core/tests/roster_query.rs` `a_passed_check_counts_until_a_hand_off_moves_the_head_past_it` (ADR 0012's test), unchanged.
