---
phase: 04-clear-is-free
plan: 05
subsystem: context-reconstitution
tags: [rust, pure-function, compaction, fold, ctx-05]

requires:
  - phase: 04-clear-is-free
    provides: "plan 04-01's session_summaries table and ContextPacket.summaries/SummaryEntry —
      compact_summaries folds the packet's own SummaryEntry values directly, no conversion layer"
provides:
  - "packages/core/src/compaction.rs: VERBATIM_WINDOW (fixed at 5, D-69), CompactedSummary,
    CompactionBoundary (with boundary_sentence()), CompactedHistory, compact_summaries — a pure
    fold, lossless for decisions and file paths, total for narrative, with no model anywhere"
affects: [04-07, 04-08, 04-09, 04-14]

actuals:
  tokens: 4356
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Pure-fold module with a plain #[cfg(test)] mod tests block (no Connection, no fixture
      module) — the same structural template as git.rs's git_version_tests, now with a second
      instance and a matching zero-database integration test file"
    - "Position-only branching: compact_summaries never inspects a summary's content, only its
      index in the oldest-first list — the mechanism that makes 'lossless for decisions, total
      for narrative' checkable by reading the type rather than by trusting a convention"

key-files:
  created:
    - packages/core/src/compaction.rs
    - packages/core/tests/compaction.rs
  modified:
    - packages/core/src/lib.rs

key-decisions:
  - "boundary_sentence() renders a singleton range as a bare ordinal ('1') rather than '1-1', while
    a multi-entry range renders as 'start-end' ('1-4', '5-9') — keeps the six-summary case
    ('Summaries 1 are folded; 2-6 are carried verbatim.') readable without a second sentence
    template; the nine-summary literal the plan itself specifies ('Summaries 1-4 are folded; 5-9
    are carried verbatim.') is unaffected since neither of its ranges is a singleton"
  - "CompactedSummary is a distinct struct from SummaryEntry with the narrative fields (changed_prose,
    remains, next_session_must_know) simply absent, not present-and-cleared — makes 'total for
    narrative' a compile-time-checkable property of the type, proven at runtime by the
    narrative_is_dropped_structurally_not_just_unrendered JSON test"
  - "folded_range/verbatim_range are Option<(usize, usize)>, None exactly when their count is 0 —
    never a placeholder (0, 0) pair — so boundary_sentence()'s None branch is driven by the same
    folded_count == 0 check the struct's own fields already carry"

requirements-completed: []

coverage:
  - id: D1
    description: "The verbatim window is a single fixed constant of 5 with no configuration path,
      and the threshold behaves identically one step either side of it (four/five fold nothing,
      six folds exactly the oldest one)"
    requirement: CTX-05
    verification:
      - kind: unit
        ref: "packages/core/src/compaction.rs#compaction::tests::exactly_six_summaries_fold_exactly_the_oldest_one"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#exactly_four_summaries_fold_nothing"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#exactly_five_summaries_fold_nothing_the_window_is_inclusive"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#exactly_six_summaries_fold_exactly_the_oldest_one"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#nine_summaries_fold_four_and_carry_five_verbatim"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/compaction.rs | grep -c 'VERBATIM_WINDOW: usize = 5' == 1, no function parameter named window size"
        status: pass
    human_judgment: false
  - id: D2
    description: "Compaction is lossless for decisions and file paths, total for narrative: a
      folded summary keeps every decisions entry and every changed_files path (identity, not
      length), keeps auto_generated, and structurally has no field for changed_prose/remains/
      next_session_must_know"
    requirement: CTX-05
    verification:
      - kind: integration
        ref: "tests/compaction.rs#a_folded_summary_keeps_every_decision_and_every_changed_file_in_order"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#a_folded_summary_of_an_auto_generated_run_keeps_that_flag"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#narrative_is_dropped_structurally_not_just_unrendered"
        status: pass
      - kind: other
        ref: "CompactedSummary struct declares no field named changed_prose, remains or next_session_must_know (compile-time)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No truncation, ellipsis, character budget or token budget exists anywhere in the
      fold; compact_summaries is pure (no database, process, network or clock read) and
      deterministic across calls"
    requirement: CTX-05
    verification:
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/compaction.rs | grep -cE 'Command::new|reqwest|ureq|rusqlite|Connection|Utc::now|SystemTime' == 0"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/compaction.rs | grep -cE 'truncate|ellipsis|max_chars|max_tokens|budget' == 0"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#two_compact_summaries_calls_on_the_same_input_are_equal"
        status: pass
    human_judgment: false
  - id: D4
    description: "The boundary reports as 1-based inclusive ordinals and renders as a sentence a
      person can say out loud, with the exact nine-summary wording locked by a literal-string test"
    requirement: CTX-05
    verification:
      - kind: integration
        ref: "tests/compaction.rs#the_boundary_sentence_for_nine_summaries_matches_the_exact_expected_string"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#folded_and_verbatim_vectors_are_each_oldest_first_and_concatenate_to_the_original_order"
        status: pass
    human_judgment: false
  - id: D5
    description: "An empty summary list folds to an empty history with a zero total and no
      boundary, and a single-element list is carried verbatim with no boundary"
    requirement: CTX-05
    verification:
      - kind: unit
        ref: "packages/core/src/compaction.rs#compaction::tests::zero_summaries_fold_to_an_empty_history_with_no_boundary"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#zero_summaries_fold_to_an_empty_history_with_no_boundary"
        status: pass
      - kind: integration
        ref: "tests/compaction.rs#one_summary_is_carried_verbatim_with_no_boundary"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 5: Compaction — The Fold, Proven From Both Sides Summary

**A pure Rust fold (`compact_summaries`) that keeps the last 5 session summaries verbatim, folds
everything older into a decisions-and-file-paths-only record with narrative dropped entirely, and
reports the split as a sentence a developer can read aloud — proven at 4/5/6/9 summaries with zero
database in either test file.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-23T00:50:00Z (approx., following plan 04-04's completion commit)
- **Completed:** 2026-09-23T00:59:11Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `packages/core/src/compaction.rs`: `VERBATIM_WINDOW: usize = 5` declared exactly once, not
  configurable anywhere (D-69); `CompactedSummary` (decisions/changed_files/auto_generated kept,
  narrative fields structurally absent); `CompactionBoundary` with 1-based inclusive
  `folded_range`/`verbatim_range` and `boundary_sentence()`; `CompactedHistory`; `compact_summaries`
  splitting `summaries[..split]`/`summaries[split..]` by position only, never by content
- `packages/core/src/lib.rs`: `pub mod compaction;` registered alphabetically between `branch` and
  `context_packet`
- `packages/core/tests/compaction.rs`: 12 tests proving the threshold from both sides (4/5 fold
  nothing, 6 folds exactly one, 9 folds exactly four), the exact nine-summary boundary sentence as
  a literal string, decisions/changed_files identity (not length), the `auto_generated` flag
  surviving a fold, a structural (JSON-serialization-based) proof that narrative text is gone
  rather than merely unrendered, determinism across two calls, and oldest-first ordering for both
  the folded and verbatim vectors — zero database, `cargo test -p core --test compaction`
  completes in well under 5 seconds
- Two in-file smoke tests in `compaction.rs` itself (empty input, six-summary threshold), mirroring
  `git.rs`'s own plain-`#[test]`-function style with no `Connection` anywhere

## Task Commits

Each task was committed atomically:

1. **Task 1: The fold — lossless for decisions, total for narrative, with no model anywhere** -
   `23aa49c` (feat)
2. **Task 2: The threshold proven from both sides, with no database in the test at all** -
   `0c12420` (test)

_Following plan 04-01's precedent for `tdd="true"`-tagged tasks in an `execute`-type plan: one
atomic commit per task rather than a separate RED/GREEN/REFACTOR triad per task —
`workflow.tdd_mode` is not enabled in `.planning/config.json`, so the plan-level TDD gate does not
apply, and each task's own `<verify>` block (build + purity/budget greps + full test run) was
satisfied before its single commit._

## Files Created/Modified

- `packages/core/src/compaction.rs` - `VERBATIM_WINDOW`, `CompactedSummary`, `CompactionBoundary`,
  `CompactedHistory`, `compact_summaries`, two in-file smoke tests
- `packages/core/src/lib.rs` - `pub mod compaction;` registered
- `packages/core/tests/compaction.rs` - 12 zero-database integration tests over the fold's
  behaviour, precision and determinism

## Decisions Made

- `boundary_sentence()` renders a singleton ordinal range as a bare number (`"1"`) rather than
  `"1-1"` — reads naturally for the six-summary case (`"Summaries 1 are folded; 2-6 are carried
  verbatim."`) without needing a second sentence template; the plan's own literal nine-summary
  string (`"Summaries 1-4 are folded; 5-9 are carried verbatim."`) is unaffected, since neither of
  its ranges is a singleton
- `CompactedSummary` is a genuinely distinct struct from `SummaryEntry`, not the same struct with
  optional fields cleared — this is what makes "total for narrative" a property checkable by
  reading the type definition, reinforced at runtime by a JSON-serialization test proving the
  dropped prose text is absent from the wire format, not just unrendered
- `folded_range`/`verbatim_range` are `None` exactly when their count is `0`, never a placeholder
  `Some((0, 0))` — `boundary_sentence()`'s `None` branch and the struct's own `folded_count == 0`
  check stay in lockstep by construction

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<verify>` blocks (build, purity/budget grep
gates, `cargo test -p core --lib`, `cargo test -p core --test compaction`, `cargo test --workspace`)
passed without needing a fix-forward.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `compact_summaries`, `CompactedHistory`, `CompactionBoundary`, `CompactedSummary` and
  `VERBATIM_WINDOW` are exported from `packages/core/src/compaction.rs` and ready for plan 04-07 to
  thread into `ContextPacket` (the packet field and the rendered boundary marker in `render_prompt`)
  and for plan 04-08 to render on the launch sheet.
- CTX-05 is **not** marked complete by this plan: `packages/core/tests/compaction.rs` proves the
  fold itself, but the requirement's second half — "with the compaction boundary visible to the
  user" — is plan 04-08/04-09's UI work. `gsd_run query requirements.ready-ids` confirms CTX-05 is
  still blocked pending those sibling plans' summaries (the shared-ID gate, #2388); it stays
  `Pending` in `REQUIREMENTS.md` until they land.
- No blockers for 04-06 through 04-09.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/compaction.rs
- FOUND: packages/core/tests/compaction.rs
- FOUND commit 23aa49c in git log
- FOUND commit 0c12420 in git log
