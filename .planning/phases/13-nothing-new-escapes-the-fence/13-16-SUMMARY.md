---
phase: 13-nothing-new-escapes-the-fence
plan: 16
subsystem: core-status-deriver
tags: [rust, drft-04, gap-closure, wr-06, wr-07, compare-and-swap]

requires:
  - phase: 13-07
    provides: the single tasks.status writer (derive_status_in_tx) and D-123's surfaced-not-closed contract
provides:
  - task.done_with_unmet_criteria appended inside derive_status_in_tx, so every route to done records it
  - a source test asserting exactly one producer of that event
  - a bounded one-shot retry of a review edge lost to a system-caused compare-and-swap refusal
affects: [phase-13-verification]

status: complete
plan_head_before: 5a434f5d505c79cd7d74b39c01373a43a652377a
actuals:
  tokens: 9000
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A documented event is appended at the seam every route passes through, never on the one path its author thought of"
    - "A retry is bounded by construction: one extra derive_status_in_tx call in a match arm, no loop"

key-files:
  created: []
  modified:
    - packages/core/src/status_derivation.rs
    - packages/core/src/forge/transitions.rs
    - packages/core/tests/status_derivation.rs
    - packages/core/tests/status_transitions.rs
    - packages/desktop/src-tauri/src/scheduler.rs

key-decisions:
  - "The retry guard is narrower than the plan's band comparison alone: a refusal is retried only when the found status is strictly above the status the write expected (the card moved forward) AND strictly below the intended band. The plan's guard (found < intended) is true for EVERY Refused result, because the deriver only refuses when the winner exceeds the current status, so on its own it would have re-applied a merge over a human's backward drag and failed the scheduler manual-move test."
  - "The retry applies to the review edge only. A merge is a standing level the next cold tick re-applies; the review edge fires on one tick and is otherwise lost."
  - "TransitionOutcome.events_appended no longer counts the unmet-criteria event, because the deriver appends it. The scheduler already refreshes on status_changed_to, which is Some on any done write, so no refresh is lost."

requirements-completed: [DRFT-04]

coverage:
  - id: D1
    description: "Every route to done (forge tick, cold tick, ensure_worktree, refused-then-cold-tick) records exactly one task.done_with_unmet_criteria event when a criterion is unchecked, and none when all are checked or the derivation is Unchanged/Refused"
    requirement: DRFT-04
    verification:
      - kind: integration
        ref: "packages/core/tests/status_derivation.rs#a_merge_refused_by_the_compare_and_swap_then_the_cold_tick_records_the_unmet_event_once"
        status: pass
      - kind: integration
        ref: "packages/core/tests/status_derivation.rs#ensure_worktree_reaching_done_with_an_unmet_criterion_records_one_event"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly one module appends the event; re-adding the forge-path append fails the build"
    requirement: DRFT-04
    verification:
      - kind: integration
        ref: "packages/core/tests/status_derivation.rs#one_producer_appends_the_unmet_criteria_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "A review edge lost to a system move is repaired once in the same transaction; a card a person dragged back, moved forward past the band, or already at the band is not written"
    requirement: DRFT-04
    verification:
      - kind: integration
        ref: "packages/core/tests/status_derivation.rs#a_review_edge_lost_to_a_system_move_is_repaired_once_in_the_same_transaction"
        status: pass
      - kind: integration
        ref: "packages/core/tests/status_derivation.rs#a_review_edge_is_not_retried_against_a_card_a_human_moved_backwards"
        status: pass
      - kind: integration
        ref: "packages/desktop/src-tauri/src/scheduler.rs#a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation"
        status: pass
    human_judgment: false
  - id: D4
    description: "The scheduler manual-move test comment states the behaviour the code has"
    requirement: DRFT-04
    verification:
      - kind: command
        ref: "grep -c 'never retries the overwrite' packages/desktop/src-tauri/src/scheduler.rs  (0)"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 16: Status deriver seams (WR-06, WR-07) Summary

The `done_with_unmet_criteria` event now comes from the deriver's own write path, so no route to `done` can drop it, and a review edge lost to a refusal the system caused is retried once against the status the write found.

## What changed

**Task 1 (WR-06).** `derive_status_in_tx` calls a new private `record_unmet_criteria` right after the status write when the winner is `done`. The same SQL the forge path used moved with it. The append in `apply_forge_observation` is deleted and replaced by a pointer comment. The constant stays defined in `forge::transitions` (one definition; the deriver imports it).

Remaining occurrence in `transitions.rs` (the acceptance check): line 51 only, `pub const EVENT_DONE_WITH_UNMET_CRITERIA: &str = "task.done_with_unmet_criteria";`. No call site remains.

Replacement scheduler comment (verbatim, `scheduler.rs`, manual-move test):

```
// D4: the baseline still advances to Merged on the refusal, so the forge tick never
// re-observes an edge. That does NOT protect the human's move for long: `merged` is now a
// standing LEVEL, and the next cold tick re-derives `done` from it with
// `expected_status: None`, so the compare-and-swap shields the move for at most
// `COLD_TICK_SECS` and the move is then re-applied. This test deliberately asserts only
// the instant right after the forge write; the re-application is covered by the deriver's
// own tests (`tests/status_derivation.rs`). Whether a human move should stand against a
// merge is a product decision this test does not settle.
```

The assertion message was reworded from "never retries the overwrite" to match. Scheduler behaviour is unchanged.

**Task 2 (WR-07).** `apply_forge_observation` now matches the first derivation and, in one arm, re-derives once:

```rust
let outcome = match first {
    Derivation::Refused { intended, actual }
        if review_edge && lost_edge_is_repairable(expected_status, &actual, &intended) =>
    {
        derive_status_in_tx(&tx, task_id, actor_id, Some(&actual), review_edge)?
    }
    other => other,
};
```

`lost_edge_is_repairable` returns true only when `band_rank(expected) < band_rank(actual) < band_rank(intended)`, with any unknown status giving false. The retry is one extra call; there is no `while` or `loop`, and the comment names the "at most once" bound.

## Planted-direction confirmations

- **WR-06 (RED, before the deriver append existed):** `a_merge_refused_by_the_compare_and_swap_then_the_cold_tick_records_the_unmet_event_once` failed at the final count with `left: 0, right: 1`, i.e. zero events where one is expected. The cold-tick, `ensure_worktree` and one-producer tests failed the same way (`left: 1, right: 0` for the one-producer test, which saw the forge-path append).
- **WR-07 (retry arm neutralised with `if false &&`):** `a_review_edge_lost_to_a_system_move_is_repaired_once_in_the_same_transaction` failed with `left: "in_progress", right: "in_review"`. Restored afterwards; 31/31 pass.

## Deviations from Plan

**1. [Rule 1 - Bug] The plan's band guard does not separate a human from the system**
- **Found during:** Task 2 design, confirmed by reading `derive_status_in_tx`.
- **Issue:** the deriver returns `Refused` only when `winner != current`, and `winner = max(candidate, current)`, so `band_rank(actual) < band_rank(intended)` holds for every refusal. Two plan behaviours follow from this being impossible as written: (a) a "found status above the intended band" case never reaches `Refused` (it is `Unchanged`, so no `forge.status_write_skipped` event is recorded for it); (b) with only the plan's guard, a human dragging a card backwards inside the window would be retried and overridden, and `a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation` would fail.
- **Fix:** added the second condition `expected < actual` (the card moved forward since capture) and restricted the retry to the review edge. Human-protection is pinned by `a_review_edge_is_not_retried_against_a_card_a_human_moved_backwards` (one skip event, no `task.status_changed` from the tick, status unchanged). A forward move past the band is pinned as "stays done, no status event"; it records no skip event because nothing was refused.
- **Files modified:** `packages/core/src/forge/transitions.rs`, `packages/core/tests/status_derivation.rs`
- **Commit:** 27195da

**2. [Rule 1 - Bug] Two existing tests encoded the old behaviour**
- `status_transitions.rs::merged_with_unmet_criteria_names_the_count...` asserted `events_appended == 2` (state-change plus unmet event). The deriver now appends the second, so it is 1; the unmet-event count assertion beside it is unchanged at 1. Commit a3f48ab.
- `status_derivation.rs::a_refused_forge_edge_leaves_the_skipped_trace...` refused a card at `todo` against a captured `backlog`, which is exactly the forward-move case the retry now repairs. Changed the captured status to `in_progress` (a backward drag) so it still tests the skip trace. Commit 27195da.

**Total deviations:** 2 auto-fixed (both Rule 1). **Impact:** the retry is narrower than the plan text, which is the safer direction and keeps T-13-16-03 true. The plan's flagged DRFT-04 assumption (a system retry is still "derived from forge state") is unchanged by this narrowing but still wants the owner's sign-off.

## Verification

All run scoped, `RUST_TEST_THREADS=1`:
- `core --test status_derivation`: 31 passed (19 before)
- `core --test status_transitions`: 22 passed
- `core --test forge_board_flags`: 8 passed
- `core --test forge_live_chain`: 19 passed
- `core --test no_agent_status_write`: 8 passed (deriver still the single `UPDATE tasks SET status` writer)
- `core --test pm_vocabulary_gate`: 5 passed (no forbidden identifier components introduced)
- `desktop --bin desktop scheduler::`: 9 passed, manual-move test included

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; T-13-16-01 through -04 are mitigated as planned.

## Commits

- 530000e test(13-16): pin the unmet-criteria event to every route to done
- a3f48ab feat(13-16): append the unmet-criteria event in the deriver, not the forge path
- 76d9495 test(13-16): pin the lost review edge and the human-move guards
- 27195da feat(13-16): retry a review edge lost to a system-caused refusal, once

## Self-Check: PASSED

All five modified files exist, all four commits are present in `git log`, and the commit count measured from the ledger is 4.
