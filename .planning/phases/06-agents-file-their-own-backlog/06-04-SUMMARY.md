---
phase: 06-agents-file-their-own-backlog
plan: 04
subsystem: authoring
tags: [rust, sqlite, fts5, bm25, duplicate-detection, authoring-proposal]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-01)
    provides: "migration 0015's duplicate_of/duplicate_score columns (shaped ahead of time, unwritten), create_proposal_in_tx, ProposalProvenance"
  - phase: 06-agents-file-their-own-backlog (plan 06-03)
    provides: "the four-verb triage vocabulary and the amend_proposal write path this plan's re-score hooks into"
provides:
  - "migration 0016: authoring_proposals_fts, an external-content FTS5 index over authoring_proposals with its three sync triggers and an initial rebuild"
  - "query::search::duplicate_candidate_for / duplicate_score_lookup — one bounded, indexed bm25 lookup across open tasks, epics, issues, and every proposal (pending + decided)"
  - "query::search::DUPLICATE_BM25_THRESHOLD (-21.0, measured), DUPLICATE_BM25_WEIGHTS, DUPLICATE_CANDIDATE_LIMIT, is_flagged_as_duplicate"
  - "domain::authoring_proposal::ProposalPayload::duplicate_search_text — the (title, body) pair every payload variant feeds the detector"
  - "create_proposal_in_tx and amend_proposal both write duplicate_of/duplicate_score in their own existing INSERT/UPDATE, never a follow-up statement"
affects: [06-05, 06-06, 06-07, 06-09]

actuals:
  tokens: 16637
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Bag-of-words FTS5 MATCH built by calling the existing per-term escaping helper (to_fts5_prefix_phrase) once PER WORD and OR-ing the results, rather than once over an entire multi-sentence blob — the shape a bm25 relevance ranking is built to score, versus a single literal phrase requiring exact contiguous wording"
    - "Raw-lookup / thresholded-wrapper split (duplicate_score_lookup -> duplicate_candidate_for), mirroring this crate's existing _in_tx/thin-wrapper extraction shape, so the threshold comparison lives in exactly one place (is_flagged_as_duplicate) and a test file can measure the real, unthresholded score distribution through the SAME query rather than a second copy of it"

key-files:
  created:
    - packages/core/src/db/migrations/0016_authoring_proposals_fts.sql
    - packages/core/tests/proposal_duplicates.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/query/search.rs
    - packages/core/src/domain/authoring_proposal.rs

key-decisions:
  - "DUPLICATE_BM25_THRESHOLD pinned at -21.0, measured against a seeded fixture: 8 near-duplicate pairs (same finding, different wording) scored in [-49.38, -26.23]; 8 unrelated pairs (different findings sharing only generic project vocabulary) scored in [-16.87, -6.77], across all four corpora (task/epic/issue/already-decided-proposal). The ranges do not overlap; -21.0 sits with roughly 5 points of margin on each side. Recorded in the constant's own doc comment with the fixture, the ranges and the date, per the plan's own instruction not to pin a guessed number."
  - "Rule 1 bug fix, found while writing the Task 2 measurement: the plan's literal instruction to build the MATCH term by calling to_fts5_prefix_phrase on the whole concatenated title+body produces ONE FTS5 phrase query requiring the entire text to appear as an exact, contiguous token run inside the matched row. Verified empirically (a real sqlite3 session) that this can only ever match a near-verbatim copy — never 'the same finding, different wording', which this task's own <behavior> requires and which the RED test proved (zero rows matched for every genuinely-reworded near-duplicate). Fixed by calling to_fts5_prefix_phrase once PER WORD and OR-ing the results — still the SAME escaping routine, reused per-token instead of once over the whole blob, satisfying 'never a second quote-doubling routine' literally while producing a working bag-of-words bm25 query."
  - "duplicate_candidate_for was split into duplicate_score_lookup (the raw, unthresholded query) plus a thin threshold-applying wrapper, and the threshold comparison itself was extracted into its own named, exported predicate (is_flagged_as_duplicate). This mirrors the crate's existing _in_tx/thin-wrapper convention and let Task 2's measurement test assert 'a score exactly equal to the threshold is not flagged' directly against the real production comparison, rather than trying to engineer a database row whose measured float score lands exactly on a boundary."
  - "The 'task' corpus scores measurably weaker for near-duplicates than epic/issue/proposal (-26.23 vs. -36 to -49) because domain::task::create_task has no description parameter at all — a task's duplicate-detection surface is title-only. This is a genuine, structural finding (not a bug in this plan's own code) recorded in DUPLICATE_BM25_THRESHOLD's doc comment; the threshold still cleanly separates all four corpora at the pinned value, so no corpus-specific threshold split was needed."
  - "amend_proposal's re-score passes Some(proposal_id) as exclude_proposal_id specifically because the SELECT that scores the amended content runs BEFORE the UPDATE that overwrites the row — the proposal's own OLD content is still present in authoring_proposals_fts at read time, so without the exclusion a re-amend to unchanged content would match itself. Proven directly by a dedicated test (re-amending to identical content and asserting duplicate_of never names the proposal's own id)."

patterns-established: []

requirements-completed: []  # PROP-04 is also declared by 06-05/06-06/06-07/06-09, still in flight — shared-ID gate (#2388) holds it open in REQUIREMENTS.md until every declaring plan finishes.

coverage:
  - id: D1
    description: "authoring_proposals_fts (migration 0016) exists as a fourth external-content FTS5 index with all three sync triggers and an initial rebuild, following the same pattern as tasks_fts/epics_fts/issues_fts"
    requirement: PROP-04
    verification:
      - kind: integration
        ref: "cargo test -p core --test migration_safety (6 tests, including the pre-existing 0015 rebuild case, unaffected by 0016's addition)"
        status: pass
      - kind: unit
        ref: "shell: grep for the three CREATE TRIGGER statements + the single include_str! registration line"
        status: pass
    human_judgment: false
  - id: D2
    description: "duplicate_candidate_for scores a proposal's title/body with bm25 against open tasks, epics, issues and every proposal (pending + decided) in one bounded UNION ALL statement with an explicit LIMIT and a deterministic ORDER BY score ASC, id ASC tie-break"
    requirement: PROP-04
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#duplicate_candidate_for_flags_near_duplicates_and_clears_unrelated_pairs"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#threshold_separates_near_duplicates_from_unrelated_pairs_across_all_four_corpora"
        status: pass
    human_judgment: false
  - id: D3
    description: "DUPLICATE_BM25_THRESHOLD is a measured constant (-21.0), pinned from a committed test's observed score distribution, with the strict less-than comparison verified directly (a score exactly at the threshold is not flagged)"
    requirement: PROP-04
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#a_score_exactly_equal_to_the_threshold_is_not_flagged"
        status: pass
    human_judgment: false
  - id: D4
    description: "create_proposal_in_tx writes duplicate_of/duplicate_score in its own INSERT (never a follow-up UPDATE); amend_proposal re-scores and writes both columns in its own existing UPDATE (never a second statement); a detector error degrades to NULL rather than failing the staging/amend call"
    requirement: PROP-04
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#staging_flags_a_proposal_restating_an_existing_open_task (+ _open_epic, _open_issue, _against_an_already_rejected_proposal)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#create_proposal_in_tx_never_issues_a_follow_up_update_for_duplicate_columns"
        status: pass
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#amend_proposal_rescores_the_amended_content_and_never_flags_its_own_row"
        status: pass
    human_judgment: false
  - id: D5
    description: "A flagged proposal is still returned by the pending read with status = 'pending' and the canonical row count is unchanged beyond the staged row itself — nothing is ever auto-dropped, auto-rejected or auto-merged"
    requirement: PROP-04
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#a_flagged_proposal_is_still_pending_and_returned_by_the_pending_read"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test proposal_no_promotion (7 tests, unaffected — the detector added no canonical write)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Scoring against an empty corpus and a model-authored FTS5-syntax title both degrade to NULL/no-candidate and raise no error, at both the detector layer and the staging layer"
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_duplicates.rs#scoring_against_an_empty_corpus_returns_none_with_no_error, #staging_against_an_entirely_empty_project_writes_null_and_raises_no_error, #a_title_containing_fts5_query_syntax_degrades_to_no_candidate_rather_than_an_error, #a_title_containing_fts5_syntax_stages_successfully_with_both_columns_null"
        status: pass
    human_judgment: false

duration: 60min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 4: Duplicate Detection at Staging Time Summary

**Every staged proposal is scored with FTS5 `bm25` against open tasks, epics, issues and every decided proposal, and the verdict — `duplicate_of`/`duplicate_score`, measured against a pinned threshold of -21.0 — lands in the same transaction and the same statement that creates the row, never a follow-up write.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-09-30T06:08:00Z (approx.)
- **Completed:** 2026-09-30T06:47:32Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Migration `0016_authoring_proposals_fts.sql` adds `authoring_proposals_fts`, a fourth external-content FTS5 index (alongside `tasks_fts`/`epics_fts`/`issues_fts`), with its three sync triggers and an initial rebuild
- `query::search::duplicate_candidate_for` scores a title/body against all four corpora in one bounded, indexed `UNION ALL` statement — open tasks/epics (terminal `done` status excluded), all issues, and every proposal regardless of status (pending and all four decided values) — returning at most one candidate via `ORDER BY score ASC, id ASC LIMIT 1`
- `DUPLICATE_BM25_THRESHOLD` is a measured constant (`-21.0`), pinned against a committed fixture of 8 near-duplicate pairs and 8 unrelated pairs spanning all four corpora; the two observed ranges (`[-49.38, -26.23]` vs. `[-16.87, -6.77]`) do not overlap
- `create_proposal_in_tx` writes `duplicate_of`/`duplicate_score` directly into its own `INSERT`; `amend_proposal` re-scores the amended content and writes both columns into its own existing `UPDATE`, excluding its own row so it never flags itself
- A detector error degrades to `NULL` rather than failing the staging/amend call, mirroring this same module's existing `count_lines(...).ok()` precedent for `origin_log_offset`
- 16 new tests in `packages/core/tests/proposal_duplicates.rs`; the full workspace (`cargo test --workspace`, 2000+ lines of test output across `core`, `desktop`, `relay_client`) stays green

## Task Commits

Each task followed the RED-GREEN TDD cycle (Tasks 2 and 3 carry `tdd="true"`):

1. **Task 1: The decided-proposal FTS index and the bm25 candidate lookup** - `95981ff` (feat) — no TDD gate (structural/registration task)
2. **Task 2 RED: failing test measuring the duplicate threshold** - `b760722` (test)
3. **Task 2 GREEN: pin `DUPLICATE_BM25_THRESHOLD` at -21.0** - `169a880` (feat)
4. **Task 3 RED: failing tests for the staging-time duplicate write** - `0541713` (test)
5. **Task 3 GREEN: write the duplicate flag at staging time** - `76d141d` (feat)

**Plan metadata:** commit follows this SUMMARY

## Files Created/Modified
- `packages/core/src/db/migrations/0016_authoring_proposals_fts.sql` - the fourth external-content FTS5 index, its three sync triggers, and an initial rebuild command
- `packages/core/src/db/mod.rs` - registers migration 0016 (single `include_str!` line, appended after 0015)
- `packages/core/src/query/search.rs` - `DuplicateCandidate`, `DUPLICATE_BM25_WEIGHTS`, `DUPLICATE_CANDIDATE_LIMIT`, `DUPLICATE_BM25_THRESHOLD`, `DUPLICATE_LOOKUP_SQL`, `duplicate_match_term`, `is_flagged_as_duplicate`, `duplicate_score_lookup`, `duplicate_candidate_for`
- `packages/core/src/domain/authoring_proposal.rs` - `ProposalPayload::duplicate_search_text`, the detector call site inside `create_proposal_in_tx` (before its `INSERT`), the re-score call site inside `amend_proposal` (inside its existing `UPDATE`)
- `packages/core/tests/proposal_duplicates.rs` - new: 16 tests covering the threshold measurement, the strict-comparison boundary, empty-corpus/empty-project degradation, FTS5-syntax degradation, staging-time writes across all four corpora, the pending-read visibility guarantee, the never-flags-itself amend property, and two structural gates (no follow-up `UPDATE`, exactly two call sites)

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on each of the five decisions below:

1. **`DUPLICATE_BM25_THRESHOLD` pinned at -21.0**, measured from a committed fixture's observed score distribution (near-duplicates `[-49.38, -26.23]`, unrelated `[-16.87, -6.77]`, no overlap).
2. **Rule 1 bug fix**: the MATCH term is a bag-of-words disjunction (one `to_fts5_prefix_phrase` call per word, OR'd), not one literal phrase over the whole blob — the literal-phrase form can only match near-verbatim text, never a genuine paraphrase, verified empirically before this fixture was written.
3. **`duplicate_score_lookup`/`duplicate_candidate_for` split** plus the extracted `is_flagged_as_duplicate` predicate, so the threshold comparison lives in exactly one place and can be tested directly.
4. **The "task" corpus scores structurally weaker** for near-duplicates because `create_task` has no `description` parameter — a genuine, recorded finding, not a defect; the pinned threshold still separates all four corpora cleanly.
5. **`amend_proposal`'s exclusion uses `Some(proposal_id)`** because the re-score reads the row's still-current (pre-`UPDATE`) content — proven directly by a re-amend-to-unchanged-content test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MATCH term rebuilt as a bag-of-words disjunction instead of one literal phrase**
- **Found during:** Task 2, while writing the measurement fixture — the very first near-duplicate query (a deliberately reworded paraphrase) matched ZERO rows
- **Issue:** Task 1's own action text specified building the MATCH term by calling `to_fts5_prefix_phrase` on the whole concatenated title+body. That function wraps its ENTIRE argument as one FTS5 *phrase* query, which requires the wrapped text to appear as an exact, contiguous token run inside the matched row. Verified empirically with a raw `sqlite3` session: a genuinely reworded restatement of a multi-sentence title+body never satisfies that. Calling it once over the whole blob can therefore only ever match a near-verbatim copy — never "the same finding, different wording," which this task's own `<behavior>` requires and which measurement immediately surfaced as a hard failure (a panic on "matched nothing at all"), not merely a weak score
- **Fix:** Added `duplicate_match_term`, which calls `to_fts5_prefix_phrase` once PER WORD and joins the results with `OR` — the same escaping routine, reused per-token instead of once over the whole blob (satisfying "never a second quote-doubling routine" literally), producing the standard bag-of-words shape a `bm25` relevance ranking is built to score
- **Files modified:** `packages/core/src/query/search.rs`
- **Verification:** Re-ran the measurement fixture after the fix — all 8 near-duplicate pairs scored well below threshold, all 8 unrelated pairs scored above it, across all four corpora
- **Committed in:** `b760722` (Task 2's RED commit — the fix was necessary infrastructure to get a meaningful RED signal at all, not the feature Task 2 itself pins)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact:** necessary for the detector to work as specified at all — without it, no genuinely-reworded duplicate could ever be found, which is the entire point of PROP-04. No scope creep: the fix is confined to the MATCH-term construction inside `query::search.rs`, reuses the existing escaping primitive, and every other Task 1 symbol/shape is unchanged.

## Issues Encountered
None beyond the deviation documented above.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `duplicate_of`/`duplicate_score` are now real, populated columns on every newly-staged proposal — plans 06-05 (volume limiting), 06-06 (Tauri command layer), 06-07 (the triage UI) can read and render the flag directly through `PROPOSAL_COLUMNS`/`row_to_proposal` with no further wiring.
- **Shared-ID note:** PROP-04 is declared by four sibling plans still in flight (06-05, 06-06, 06-07, 06-09) — the shared-ID gate (#2388) holds it open in `REQUIREMENTS.md` until every declaring plan finishes, even though this plan's own coverage above is complete.
- **Known scale nuance for a future plan to be aware of, not fix:** a task's duplicate-detection signal is weaker than epic/issue/proposal's because `domain::task::create_task` stores no description at all — if a future plan widens `create_task` to accept one, `DUPLICATE_BM25_THRESHOLD` should be re-measured against the richer corpus rather than assumed to still separate cleanly.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*
