---
phase: 06-agents-file-their-own-backlog
plan: 05
subsystem: authoring
tags: [rust, sqlite, mcp, typescript, sidecar, proposal-limit, duplicate-detection]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-04)
    provides: "duplicate_of/duplicate_score columns populated at staging time, query::search::duplicate_candidate_for/DuplicateCandidate, the FTS5 authoring_proposals_fts index"
  - phase: 06-agents-file-their-own-backlog (plan 06-01)
    provides: "the propose_item MCP tool, ProposalOutcome (Ignored/UnknownRun/TerminalRun/Created), create_proposal_in_tx's single write path, stageAuthoringProposal"
provides:
  - "PROPOSAL_LIMIT_PER_RUN = 10: a fixed, non-configurable ceiling on how many proposals one agent run may ever stage"
  - "ProposalOutcome::LimitExhausted { limit, count }, returned by create_proposal_in_tx/apply_proposal_created when a run is at or past the limit — no row inserted, one proposal.limit_exhausted event appended in the same transaction"
  - "query::authoring::resolve_duplicate_candidate_label / DuplicateCandidateLabel — one bounded LIMIT-1 lookup turning a duplicate_of id back into kind/key/title"
  - "query::authoring::proposal_limit_notices / ProposalLimitNotice — one notice per throttled run, derived from proposal.limit_exhausted events on every read, never a second stored copy"
  - "Tauri command authoring_proposal_limit_notices + ProposalLimitNoticeDto"
  - "stageAuthoringProposal's duplicateCandidate passthrough (D-108), additive and byte-identical when absent"
  - "packages/core/tests/proposal_limit.rs (12 tests) and 4 new sidecar socket-level tests"
affects: [06-06, 06-07, 06-09]

actuals:
  tokens: 17435
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "RED via short-circuit, not via a compile error: for a Rust TDD task introducing brand-new symbols (a const, an enum variant, a changed return type), the RED commit includes the full structural scaffolding needed to compile, with the actual behavioral check disabled behind `if false && <real condition>` — so the target tests fail on their own assertions, never on a compile error that would prevent test discovery entirely."
    - "Bounded LIMIT-1 UNION ALL lookup by id, mirroring the sibling scoring lookup's own four-corpora shape (query::search::duplicate_candidate_for), so 'resolve this id back to a label' and 'find a candidate for this text' are two thin, obviously-related reads rather than one doing both jobs."
    - "GROUP BY stream_id over an append-only events table as the derivation for a per-run human-facing notice — never a second table, never a stored warning string; D-74/D-75's 'derived, not stored' rule applied to a brand-new event type."

key-files:
  created:
    - packages/core/tests/proposal_limit.rs
  modified:
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/query/authoring.rs
    - packages/core/tests/authoring_board_read.rs
    - packages/core/tests/authoring_proposal.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - packages/core/tests/epic_context_packet.rs
    - packages/core/tests/proposal_duplicates.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/test/propose-item-wire.test.mjs

key-decisions:
  - "The exact refusal message text an over-limit agent reads: \"proposal limit reached: this run has already staged {count} of {limit} allowed proposals — this one was NOT staged. Call report_summary and put it in the remains field instead.\" Recorded here verbatim per this plan's own <output> instruction, since it is the string the model actually acts on."
  - "create_proposal_in_tx's return type changed from Result<Proposal> to Result<ProposalOutcome> so both Created and LimitExhausted flow through one type. apply_proposal_created now simply forwards that outcome unchanged. create_proposal (the direct, non-event entry point ~100 existing test call sites use) keeps its original Result<Proposal> signature: it commits the transaction unconditionally first (so a refusal's own event is never rolled back), then converts a LimitExhausted outcome into a loud Err — preserving every existing call site's signature while still never silently dropping a refusal."
  - "Four pre-existing test files staged more rows through create_proposal on a single run than PROPOSAL_LIMIT_PER_RUN now permits, because their own subject was a READ-side clamp/threshold property, not proposal authoring: authoring_board_read.rs's and authoring_proposal.rs's exact-ceiling/ten-million-request clamp tests, epic_context_packet.rs's two bounded-read tests, and proposal_duplicates.rs's 20-filler-proposal corpus fixture. Each was fixed with a narrowly-scoped, documented direct-INSERT helper bypassing create_proposal's write-side rule — never by weakening PROPOSAL_LIMIT_PER_RUN itself. proposal_duplicates.rs specifically needed a NEW helper (seed_throwaway_run, no tasks row) rather than reusing the existing seed_agent_run, because seed_agent_run also creates a task row per call — calling it once per filler proposal (20 times) would have polluted tasks_fts with 20 extra documents and perturbed the exact bm25 IDF statistics DUPLICATE_BM25_THRESHOLD (plan 06-04) was measured and pinned against. Verified: an earlier version of this fix did exactly that and flipped a previously-clean unrelated-pair case into a false positive; the final fix reproduces plan 06-04's own pinned score ranges exactly."
  - "`gsd_run check tdd-red-evidence` only parses Node's TAP test-reporter output (`# tests N` / `# pass N` / `ok N - <name>`), not `cargo test`'s native harness format — every Rust RED phase is misclassified as INVALID_RED (zero_tests_discovered) regardless of genuine failure content, verified directly against this plan's own real RED run. RED evidence was instead verified directly via `cargo test -p core --test proposal_limit`'s own output (2 tests passing unaffected, 5 tests failing on real assertion mismatches — captured in the RED commit message), matching how plan 06-04 proceeded under the same limitation. This is a cross-plan tooling gap, not something in this plan's own scope to fix."

patterns-established: []

requirements-completed: [PROP-05, PROP-04]

coverage:
  - id: D1
    description: "PROPOSAL_LIMIT_PER_RUN is a fixed, non-configurable constant (10); the 10th proposal a run stages succeeds and the run holds exactly 10 rows; the 11th is refused inside the same transaction as the INSERT that would have run, creating no row"
    requirement: PROP-05
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_limit.rs#proposal_limit_per_run_is_exactly_ten, #staging_the_tenth_proposal_succeeds_and_the_run_holds_exactly_ten_rows, #staging_an_eleventh_proposal_is_refused_and_creates_no_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "The count is every row the run ever staged regardless of status or verb (a rejected proposal still counts); ten consecutive refusals leave the run at exactly 10 rows; two different runs on the same project each get their own budget of 10; a refusal still commits its own proposal.limit_exhausted event rather than rolling back"
    requirement: PROP-05
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_limit.rs#the_count_includes_every_row_regardless_of_status_or_verb, #ten_consecutive_refusals_leave_the_run_at_exactly_ten_rows_and_ten_events, #two_different_runs_in_the_same_project_each_get_their_own_budget_of_ten, #a_refusal_still_commits_its_limit_exhausted_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "The refused call relays a loud Err naming the limit and pointing the agent at report_summary's remains field — never a silent drop; handle_inbound_proposal_created's outcome match stays exhaustive"
    requirement: PROP-05
    verification:
      - kind: unit
        ref: "packages/sidecar/test/propose-item-wire.test.mjs#an answer carrying an error naming the limit rejects with that message intact"
        status: pass
      - kind: unit
        ref: "grep for report_summary in packages/desktop/src-tauri/src/commands/authoring.rs"
        status: pass
    human_judgment: false
  - id: D4
    description: "A human-facing notice for a throttled run is derived, on every read, from the proposal.limit_exhausted events that run's refusals appended — never a second stored copy — via query::authoring::proposal_limit_notices and the Tauri command authoring_proposal_limit_notices"
    requirement: PROP-05
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_limit.rs#a_run_with_three_refusals_yields_exactly_one_notice_with_refused_count_three, #two_runs_in_one_project_yield_two_notices, #a_project_with_no_refusals_yields_an_empty_vector, #the_notice_read_is_clamped_to_max_limit, #a_second_call_to_proposal_limit_notices_returns_the_same_values"
        status: pass
    human_judgment: false
  - id: D5
    description: "A flagged proposal's duplicate candidate (kind/key/title/score) reaches the model in the same tool-call answer that staged it, resolved through one bounded lookup, present only when a candidate exists; the authoring propose_* answer shape is unchanged when it does not"
    requirement: PROP-04
    verification:
      - kind: unit
        ref: "packages/sidecar/test/propose-item-wire.test.mjs#an answer carrying a staged id and a duplicate candidate resolves with both present in the text block, #an answer carrying only a staged id resolves with exactly the shape the authoring path produces today, #an answer carrying a malformed candidate still resolves successfully with the staged id"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test (215/215, including the untouched authoring-proposal-wire.test.mjs)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The constant is the only source of the limit — no settings key, projects column or environment variable exists anywhere that could change it — and it is actually consulted by production code, not merely declared"
    requirement: PROP-05
    verification:
      - kind: unit
        ref: "shell: grep -c PROPOSAL_LIMIT_PER_RUN across packages/core/src, packages/desktop/src-tauri/src, packages/sidecar/src, packages/desktop/src (non-comment lines >= 2)"
        status: pass
    human_judgment: false

duration: 65min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 5: Proposal Volume Limit and the Duplicate Candidate Reaching the Model Summary

**`PROPOSAL_LIMIT_PER_RUN` fixes every agent run's proposal budget at 10, refused loudly inside the write transaction with a `proposal.limit_exhausted` event and a derived human-facing notice, while a flagged proposal's duplicate candidate now rides back to the model in the same staging answer.**

## Performance

- **Duration:** ~65 min
- **Started:** 2026-09-30T06:51:00Z (approx.)
- **Completed:** 2026-09-30T07:56:00Z
- **Tasks:** 3
- **Files modified:** 12 (1 created, 11 modified)

## Accomplishments
- `PROPOSAL_LIMIT_PER_RUN: usize = 10` — a compile-time constant, declared exactly once, consulted from `create_proposal_in_tx`'s in-transaction `COUNT(*)` check (reads through `idx_authoring_proposals_run_status`'s leading column) — no settings key, `projects` column or environment override anywhere
- `ProposalOutcome::LimitExhausted { limit, count }` flows through both entry points (`create_proposal`, `apply_proposal_created`) — a refusal is never folded into the existing `Ignored` variant (which means malformed input) and never silently dropped; its own `proposal.limit_exhausted` event still commits even when the caller reports the refusal as an `Err`
- The refused call relays the exact text: *"proposal limit reached: this run has already staged {count} of {limit} allowed proposals — this one was NOT staged. Call report_summary and put it in the remains field instead."*
- `query::authoring::proposal_limit_notices` derives one notice per throttled run from however many `proposal.limit_exhausted` events exist — `GROUP BY stream_id`, bounded, newest-last-refusal first — exposed through the new `authoring_proposal_limit_notices` Tauri command
- `query::authoring::resolve_duplicate_candidate_label` resolves a `duplicate_of` id back to `kind`/`key`/`title` with one bounded `LIMIT 1` lookup; `handle_inbound_proposal_created`'s `Created` arm folds it into the relayed answer as `duplicateCandidate`, present only when a candidate exists
- `stageAuthoringProposal` (sidecar) passes `duplicateCandidate` through when well-formed, degrading to "no candidate" on anything malformed or absent — one staging function still serves both authoring-session and execution-run proposals
- 12 new Rust tests (`proposal_limit.rs`) and 4 new sidecar socket-level tests; `cargo test --workspace` (77/77 binaries) and `npm --prefix packages/sidecar test` (215/215) both green

## Task Commits

Task 1 followed the RED-GREEN TDD cycle (`tdd="true"`); Tasks 2 and 3 are standard `type="auto"`:

1. **Task 1 RED: failing tests for the proposal volume limit** - `f9617e0` (test)
2. **Task 1 GREEN: pin PROPOSAL_LIMIT_PER_RUN at 10 and refuse the 11th proposal** - `7781bd2` (feat)
3. **Task 1 deviation: four pre-existing fixtures updated to accommodate the new limit** - `8d08d89` (fix)
4. **Task 2: duplicate candidate reaches the model, and a derived notice for throttled runs** - `6aded72` (feat)
5. **Task 3: duplicate candidate and limit refusal reach the model over the wire** - `36b9cb2` (feat)

**Plan metadata:** commit follows this SUMMARY

## Files Created/Modified
- `packages/core/src/domain/authoring_proposal.rs` - `PROPOSAL_LIMIT_PER_RUN`, `ProposalOutcome::LimitExhausted`, the in-transaction count check and refusal-event append in `create_proposal_in_tx`, `create_proposal`'s commit-then-convert wrapper, `apply_proposal_created`'s direct forward
- `packages/core/src/query/authoring.rs` - `DuplicateCandidateLabel`/`resolve_duplicate_candidate_label`, `ProposalLimitNotice`/`proposal_limit_notices`
- `packages/desktop/src-tauri/src/commands/authoring.rs` - the `LimitExhausted` match arm, the duplicate-candidate resolution + relay in `handle_inbound_proposal_created`, `ProposalLimitNoticeDto` + `authoring_proposal_limit_notices` command
- `packages/desktop/src-tauri/src/main.rs` - registers `authoring_proposal_limit_notices`
- `packages/sidecar/src/mcp-permission-server.ts` - `isWellFormedDuplicateCandidate`, `stageAuthoringProposal`'s `duplicateCandidate` passthrough
- `packages/core/tests/proposal_limit.rs` - new: 12 tests (7 Task 1, 5 Task 2)
- `packages/sidecar/test/propose-item-wire.test.mjs` - 4 new socket-level tests
- `packages/core/tests/authoring_board_read.rs`, `packages/core/tests/authoring_proposal.rs`, `packages/core/tests/epic_context_packet.rs`, `packages/core/tests/proposal_duplicates.rs` - fixture fixes for the new limit (see Deviations)
- `packages/core/tests/bin/uat_authoring_ops.rs` - exhaustiveness fix for the new `ProposalOutcome` variant

## Decisions Made

See `key-decisions` in the frontmatter for full rationale. Summary:

1. **Exact refusal message text** recorded verbatim (see frontmatter and Accomplishments above) — this plan's own `<output>` instruction requires it, since it is what the agent reads and acts on.
2. **`create_proposal_in_tx` returns `ProposalOutcome`; `create_proposal` keeps its `Result<Proposal>` signature** by committing unconditionally then converting a refusal into an `Err` — preserving ~100 existing test call sites' signatures while still reporting a refusal loudly.
3. **Four pre-existing test files fixed, not weakened** — each staged more proposals on one run than the new limit permits for a READ-side property unrelated to authoring itself; each fix is narrowly scoped and documented in-place.
4. **`gsd_run check tdd-red-evidence` tooling gap** — does not support `cargo test`'s output format; RED evidence verified directly instead, matching plan 06-04's precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Regression] Four pre-existing test fixtures broken by the new write-path limit**
- **Found during:** Task 1's GREEN phase, first `cargo test --workspace` after enabling the count check
- **Issue:** `authoring_board_read.rs`'s `list_proposals_at_the_exact_ceiling_...`, `authoring_proposal.rs`'s `pending_proposals_lane_clamp_holds_for_a_ten_million_request`, `epic_context_packet.rs`'s two "bounded at the context packet read limit" tests, and `proposal_duplicates.rs`'s `seed_filler` fixture (used by 9 of its 16 tests) all staged well over 10 proposals through `create_proposal` on a single run to exercise an unrelated READ-side clamp/threshold property — none of these are `authoring_proposal.rs`'s or `commands/authoring.rs`'s own declared files, but the plan's own notes anticipated this collision explicitly (plan 06-05's dispatch notes named `proposal_no_promotion.rs`/`proposal_duplicates.rs` as at-risk)
- **Fix:** added a narrowly-scoped, documented direct-`INSERT` helper to each file (`seed_raw_pending_proposal`, `seed_raw_decided_proposal`, `seed_throwaway_run`), bypassing `create_proposal`'s write-side rule ONLY for the specific test(s) whose subject is the read arithmetic, never for tests whose subject is authoring itself
- **Files modified:** `packages/core/tests/authoring_board_read.rs`, `packages/core/tests/authoring_proposal.rs`, `packages/core/tests/epic_context_packet.rs`, `packages/core/tests/proposal_duplicates.rs`
- **Verification:** all four files' full suites pass; `proposal_duplicates.rs`'s measured bm25 scores are byte-for-byte identical to plan 06-04's own pinned ranges (`NEAR_DUPLICATE_PAIRS` `[-49.38, -26.23]`, `UNRELATED_PAIRS` `[-16.87, -6.77]`), confirming the fix introduced no corpus drift
- **Committed in:** `8d08d89`

**2. [Rule 3 - Blocking] `uat_authoring_ops.rs`'s outcome match needed a `LimitExhausted` arm**
- **Found during:** Task 1, `cargo test --workspace` (this binary is compiled as part of the workspace)
- **Issue:** non-exhaustive match over `ProposalOutcome` after adding the new variant
- **Fix:** added the arm, printing `{"outcome": "limit_exhausted", "limit": ..., "count": ...}`, matching this file's own existing per-outcome JSON convention
- **Files modified:** `packages/core/tests/bin/uat_authoring_ops.rs`
- **Verification:** `cargo build --workspace` clean
- **Committed in:** `f9617e0` (part of the RED commit's own compile scaffolding)

---

**Total deviations:** 2 auto-fixed (1 regression fix across 4 files, 1 blocking exhaustiveness fix). **Impact:** both necessary to keep `cargo test --workspace` green after this plan's own write-path change; neither weakens `PROPOSAL_LIMIT_PER_RUN` or any test's original property. No scope creep.

## Issues Encountered

**`gsd_run check tdd-red-evidence` does not support Rust's `cargo test` output format** — it is written against Node's TAP test-reporter output (`# tests N`, `ok N - <name>`) and reports `INVALID_RED (zero_tests_discovered)` for any `cargo test` run regardless of genuine failure content, verified directly against this plan's own real RED run. This is a cross-plan tooling gap (also absent from 06-04's own SUMMARY), not something in this plan's scope to fix. RED evidence was instead verified directly: `cargo test -p core --test proposal_limit` showed 2 tests passing unaffected and 5 tests failing on real assertion mismatches (not compile errors, not panics from unrelated causes) before the check was enabled, and all 7 passing after.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `PROPOSAL_LIMIT_PER_RUN`, `ProposalOutcome::LimitExhausted`, `proposal_limit_notices`, and the `duplicateCandidate` passthrough are all available for plan 06-06 (Tauri command layer widening) and 06-07 (the triage UI) to surface directly — the notice's DTO and the candidate's JSON shape are both stable.
- **Shared-ID note:** PROP-04 is declared by sibling plans 06-06/06-07/06-09 still in flight — the shared-ID gate (#2388) holds it open in `REQUIREMENTS.md` until every declaring plan finishes, even though this plan's own PROP-04 coverage above is complete. PROP-05 is declared only by this plan.
- **No new stubs, no skipped tests, no unrun `<verify>` blocks** — every task's automated `<verify>` command was run directly and every acceptance criterion checked with a real command (see Coverage above).

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: packages/core/src/domain/authoring_proposal.rs
- FOUND: packages/core/src/query/authoring.rs
- FOUND: packages/desktop/src-tauri/src/commands/authoring.rs
- FOUND: packages/desktop/src-tauri/src/main.rs
- FOUND: packages/sidecar/src/mcp-permission-server.ts
- FOUND: packages/sidecar/test/propose-item-wire.test.mjs
- FOUND: packages/core/tests/proposal_limit.rs
- FOUND: f9617e0 (Task 1 RED commit)
- FOUND: 7781bd2 (Task 1 GREEN commit)
- FOUND: 8d08d89 (fixture-fix commit)
- FOUND: 6aded72 (Task 2 commit)
- FOUND: 36b9cb2 (Task 3 commit)
- cargo test --workspace: 77/77 binaries pass, 0 failures
- npm --prefix packages/sidecar test: 215/215 pass, 0 failures
- All plan-level `<verification>` commands re-run and confirmed passing
