---
phase: 06-agents-file-their-own-backlog
plan: 06
subsystem: authoring
tags: [rust, sqlite, tauri, typescript, react-query, authoring-proposal, triage]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-03)
    provides: "merge_proposal/defer_proposal, MergeTarget/MergeOutcome, reject_proposals_bulk/defer_proposals_bulk, BulkDecisionOutcome"
  - phase: 06-agents-file-their-own-backlog (plan 06-04)
    provides: "duplicate_of/duplicate_score written at staging time"
  - phase: 06-agents-file-their-own-backlog (plan 06-05)
    provides: "rationale/origin_log_offset provenance fields, PROPOSAL_LIMIT_PER_RUN, proposal_limit_notices"
  - phase: 06-agents-file-their-own-backlog (plan 06-01)
    provides: "the recorded gap: ProposalDto carried no rationale field yet"
provides:
  - "query::authoring::list_deferred_proposals and the five-status ProposalStatusCounts (merged/deferred added)"
  - "Five Tauri commands: authoring_proposal_merge, authoring_proposal_defer, authoring_proposals_reject_bulk, authoring_proposals_defer_bulk, authoring_proposals_deferred"
  - "ProposalDto widened with rationale/originLogOffset/duplicateOf/duplicateScore — closes the gap 06-01-SUMMARY.md recorded"
  - "Six typed transport wrappers and six TanStack hooks (mergeAuthoringProposal/useMergeProposal, deferAuthoringProposal/useDeferProposal, rejectAuthoringProposalsBulk/useRejectProposalsBulk, deferAuthoringProposalsBulk/useDeferProposalsBulk, authoringProposalsDeferred/useDeferredProposals, authoringProposalLimitNotices/useProposalLimitNotices)"
affects: [06-07, 06-08, 06-09]

actuals:
  tokens: 12530
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "ProposalUndecidable's Display text crosses the Tauri command boundary through a plain .map_err(|e| e.to_string()) — no Rust-side downcast exists anywhere in commands/authoring.rs; the frontend's ProposalRow.tsx already matches on the stable Display substring (\"undecidable, not auto-rejected\"). The merge command follows this exact existing convention rather than inventing a new one."
    - "list_deferred_proposals mirrors list_pending_proposals's signature/cursor/PROPOSAL_COLUMNS/resolve_limit exactly, differing only in the WHERE clause's status literal — the same shape-copy discipline this module already established for list_rejected_for_epic."

key-files:
  created: []
  modified:
    - packages/core/src/query/authoring.rs
    - packages/core/tests/proposal_triage_verbs.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/authoring/useAuthoringQuery.ts
    - packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx
    - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
    - packages/desktop/src/board/__tests__/triage-lane.test.tsx

key-decisions:
  - "A merge into a deleted target needs no Rust-side downcast in the command layer. Grepping the whole desktop crate found ProposalUndecidable is NEVER downcast in commands/authoring.rs — accept_proposal_accept's existing .map_err(|e| e.to_string()) already lets the typed error's own Display text (which contains the stable substring \"undecidable, not auto-rejected\") reach the renderer verbatim, and ProposalRow.tsx's isUndecidableError already matches on exactly that substring. authoring_proposal_merge follows the identical, simpler pattern rather than adding a new downcast."
  - "useAuthoringQuery.ts's own module header already claimed to be the file's one transport seam, but useRejectProposal/useAmendProposal/useAcceptSubtree(ForProject) called invokeCommand directly — a pre-existing gap. This plan's own acceptance criteria require the file's invokeCommand count to be exactly zero, so closing that gap (adding rejectAuthoringProposal/amendAuthoringProposal/acceptAuthoringSubtree wrappers, switching the four hooks to use them, updating three test files' vi.mock factories) was treated as in-scope (Rule 3 — blocking, since the task cannot otherwise satisfy its own verify step)."
  - "list_deferred_proposals returns the same ProposalWindow shape as list_pending_proposals (proposals + five-status counts), not a bare Vec<Proposal> like list_rejected_for_epic — the plan's own task text calls for 'an empty window' in its test description, and reusing ProposalWindow lets the deferred lane report scale from the same struct without a second read."
  - "MergeOutcomeDto's issueKey is resolved with one follow-up single-row SELECT after merge_proposal returns (which only carries issue_id) — mirrors authoring_subtree_accept's own existing follow-up read for agent_run_id immediately above it in the same file."

patterns-established: []

requirements-completed: []  # PROP-04/06/07 are also declared by sibling plans 06-07/06-08/06-09 still in flight — shared-ID gate (#2388) holds them open in REQUIREMENTS.md until every declaring plan finishes, even though this plan's own coverage below is complete.

coverage:
  - id: D1
    description: "list_deferred_proposals reads every deferred proposal for a project, newest-first, through the same indexed (project_id, status, created_at DESC) path list_pending_proposals uses, clamped through the module's own resolve_limit"
    requirement: PROP-06
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_triage_verbs.rs#deferred_read_returns_only_deferred_rows_ordered_newest_first, #deferred_read_on_a_project_with_none_returns_an_empty_window_and_no_error, #deferred_read_clamps_to_max_limit"
        status: pass
    human_judgment: false
  - id: D2
    description: "ProposalStatusCounts reports all five statuses (merged/deferred added) so a decided row is never invisible in the triage lane's totals"
    requirement: PROP-06
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_triage_verbs.rs#all_five_status_counts_are_reported_including_merged_and_deferred"
        status: pass
    human_judgment: false
  - id: D3
    description: "rationale/origin_log_offset/duplicate_of/duplicate_score reach the pending-proposal read projection intact (PROP-04, PROP-07) — pinned at the query layer, not merely assumed from PROPOSAL_COLUMNS composition"
    requirement: PROP-07
    verification:
      - kind: unit
        ref: "packages/core/tests/proposal_triage_verbs.rs#pending_read_projection_carries_a_staged_proposals_rationale_turn_pointer_and_duplicate_verdict_intact"
        status: pass
    human_judgment: false
  - id: D4
    description: "Merge, defer, and both D-104 bulk verbs are each reachable as a registered Tauri command delegating to the core's canonical writer, writing no SQL of their own; a merge into a deleted target reaches the renderer as ProposalUndecidable's own distinguishable error text, never a generic failure; no bulk-accept command exists at any layer"
    requirement: PROP-06
    verification:
      - kind: integration
        ref: "cargo build --workspace"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_proposal (42/42, including the Phase-5 accept-all source gate over packages/desktop/src, re-run and still green)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ProposalDto carries the four new fields (rationale/originLogOffset/duplicateOf/duplicateScore) reaching the renderer — closes the gap 06-01-SUMMARY.md recorded ('ProposalDto carries no rationale field yet')"
    requirement: PROP-07
    verification:
      - kind: unit
        ref: "grep for originLogOffset/duplicateOf/duplicateScore in packages/desktop/src-tauri/src/commands/authoring.rs"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run build (tsc typechecks AuthoringProposalDto against the widened wire shape)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Six typed transport wrappers and six TanStack hooks exist; every new call goes through adapters/tauri.ts's single invokeCommand seam; useAuthoringQuery.ts keeps exactly one distinct event-subscription helper (subscribeBoardChanged) and now genuinely contains zero direct invokeCommand calls"
    verification:
      - kind: unit
        ref: "grep checks: six wrapper exports in adapters/tauri.ts, six hook exports + deferredProposalsQueryKey in useAuthoringQuery.ts, invokeCommand count = 0, subscribe-call count == subscribeBoardChanged count"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop test (552/552 across 38 files, including proposal-tray.test.tsx, proposal-keyboard.test.tsx and triage-lane.test.tsx against the widened DTO and the refactored hooks)"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 6: Merge, Defer, Bulk and the Deferred Filter Reach the App Summary

**The four-verb triage vocabulary plan 06-03 built in the core now has a full Tauri command surface (merge/defer/bulk-reject/bulk-defer/deferred-read) and a full React surface (six typed wrappers, six hooks), and `ProposalDto` finally carries the rationale field 06-01-SUMMARY.md flagged as missing.**

## Performance

- **Duration:** ~32 min
- **Started:** 2026-09-30T07:56:00Z (approx., following 06-05's completion)
- **Completed:** 2026-09-30T08:27:54Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- `query::authoring::list_deferred_proposals` (D-102) reads every deferred proposal for a project through the same indexed `(project_id, status, created_at DESC)` path `list_pending_proposals` uses, returning the same `ProposalWindow` shape (proposals + five-status counts) so the deferred lane can report scale from one struct
- `ProposalStatusCounts` widened to all five statuses (`merged`/`deferred` added) — a decided row is never invisible in the totals
- Five new Tauri commands registered and reachable: `authoring_proposal_merge` (D-101, target kind restricted to `"task"`/`"epic"`), `authoring_proposal_defer` (D-102), `authoring_proposals_reject_bulk`/`authoring_proposals_defer_bulk` (D-104, the only two bulk paths — no bulk-accept exists at any layer, and the Phase-5 accept-all source gate was re-run to prove it), and `authoring_proposals_deferred`
- `ProposalDto` widened with `rationale`/`originLogOffset`/`duplicateOf`/`duplicateScore` — closes the gap 06-01-SUMMARY.md explicitly recorded ("`ProposalDto` carries no `rationale` field yet")
- `MergeOutcomeDto`/`BulkDecisionDto` added; a merge into a deleted target relays `ProposalUndecidable`'s own `Display` text through the same plain `.map_err(.to_string())` pattern `authoring_proposal_accept` already uses (no Rust-side downcast exists anywhere in this file — verified by grep before writing new code)
- `adapters/tauri.ts` gained six new typed wrappers plus `MergeOutcomeDto`/`BulkDecisionDto`/`ProposalLimitNoticeDto`; `useAuthoringQuery.ts` gained `deferredProposalsQueryKey` and six new hooks, each copying `useAcceptProposal`/`useRejectProposal`'s real mutation shape (read in full per `06-PATTERNS.md`'s flagged gap — see "Known reading gap closed here" below)
- 5 new Rust tests in `proposal_triage_verbs.rs`; all five plan-level `<verification>` commands re-run and green: `cargo test -p core --test proposal_triage_verbs` (18/18), `cargo build --workspace`, `cargo test -p core --test authoring_proposal` (42/42), `npm --prefix packages/desktop run build`, `npm --prefix packages/desktop test` (552/552 across 38 files)

## Task Commits

Each task was committed atomically:

1. **Task 1: The reads — deferred proposals, five-status counts, and the new columns in the projection** - `f316c10` (feat)
2. **Task 2: The Tauri commands for merge, defer, both bulk verbs and the deferred window** - `42e7e3c` (feat)
3. **Task 3: The transport wrappers and the TanStack hooks** - `cfdf997` (feat)

**Plan metadata:** commit follows this SUMMARY

_Note: TDD is not applicable to this plan._

## Files Created/Modified
- `packages/core/src/query/authoring.rs` - `list_deferred_proposals`, `ProposalStatusCounts` widened to five fields
- `packages/core/tests/proposal_triage_verbs.rs` - 5 new tests (ordering, empty project, clamp, five-status counts, provenance projection) plus a `seed_raw_deferred_proposal` test helper
- `packages/desktop/src-tauri/src/commands/authoring.rs` - `ProposalDto`/`ProposalStatusCountsDto` widened; `authoring_proposal_merge`, `authoring_proposal_defer`, `authoring_proposals_reject_bulk`, `authoring_proposals_defer_bulk`, `authoring_proposals_deferred`, `MergeOutcomeDto`, `BulkDecisionDto`
- `packages/desktop/src-tauri/src/main.rs` - registers the five new commands
- `packages/desktop/src/adapters/tauri.ts` - `AuthoringProposalDto`/`ProposalStatusCountsDto` widened; `MergeOutcomeDto`/`BulkDecisionDto`/`ProposalLimitNoticeDto`; nine new typed wrappers (six the plan named, plus `rejectAuthoringProposal`/`amendAuthoringProposal`/`acceptAuthoringSubtree` — see Deviations)
- `packages/desktop/src/authoring/useAuthoringQuery.ts` - `deferredProposalsQueryKey`, six new hooks; the four pre-existing direct-`invokeCommand` hooks switched to typed wrappers (see Deviations)
- `packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx`, `packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx`, `packages/desktop/src/board/__tests__/triage-lane.test.tsx` - `vi.mock("../../adapters/tauri", ...)` factories extended with the newly-required wrapper mocks (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter for full rationale. Summary:

1. **No Rust-side downcast for the merge command** — `ProposalUndecidable` is never downcast anywhere in `commands/authoring.rs`; its `Display` text already crosses the command boundary through a plain `.map_err(.to_string())`, and `ProposalRow.tsx` already matches on that stable substring. `authoring_proposal_merge` follows the identical existing pattern.
2. **`useAuthoringQuery.ts`'s pre-existing `invokeCommand` gap closed** — see Deviations below.
3. **`list_deferred_proposals` returns the full `ProposalWindow`** (proposals + five-status counts), not a bare `Vec<Proposal>`, so the deferred lane can report scale without a second read.
4. **`MergeOutcomeDto.issueKey`** resolved with one follow-up single-row `SELECT`, mirroring `authoring_subtree_accept`'s own existing follow-up read immediately above it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `useAuthoringQuery.ts` called `invokeCommand` directly in four pre-existing hooks, which this plan's own acceptance criteria forbid**
- **Found during:** Task 3, while reading `useAcceptProposal`/`useRejectProposal`/`useAmendProposal`/`useAcceptSubtree`'s bodies per the plan's mandated `<read_first>` (the exact reading gap `06-PATTERNS.md` flagged — see below)
- **Issue:** the module's own header doc comment already claimed to be "the ONLY file... that calls into the Tauri transport" through typed wrappers, but `useRejectProposal`, `useAmendProposal`, `useAcceptSubtree` and `useAcceptSubtreeForProject` all called `invokeCommand` directly, because no named wrapper existed yet for `authoring_proposal_reject`/`authoring_proposal_amend`/`authoring_subtree_accept`. This plan's own Task 3 acceptance criteria and verify step require `grep -c 'invokeCommand' useAuthoringQuery.ts` to equal exactly `0` — a requirement the task cannot pass without touching these four pre-existing hooks
- **Fix:** added `rejectAuthoringProposal`, `amendAuthoringProposal` and `acceptAuthoringSubtree` typed wrappers to `adapters/tauri.ts` (mirroring the existing wrapper convention exactly), switched all four hooks to call them instead of `invokeCommand`, removed the now-unused `invokeCommand`/`AuthoringProposalDto` imports, and reworded the one doc-comment line that named `invokeCommand` literally (so the grep-zero check holds against prose too, not just code)
- **Files modified:** `packages/desktop/src/adapters/tauri.ts`, `packages/desktop/src/authoring/useAuthoringQuery.ts`
- **Test-mock fallout:** `proposal-tray.test.tsx`, `proposal-keyboard.test.tsx` and `triage-lane.test.tsx` each mock `../../adapters/tauri` with a full-replacement object literal (not `vi.importActual`), and each test file actually clicks Reject/Amend/subtree-accept and asserts on the resulting `invokeCommandMock` call — so the newly-required wrapper names had to be added to each mock's factory object (routing through `invokeCommandMock` with the same command name/args shape as before), or those three test files would have broken
- **Files modified (test-only):** `packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx`, `packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx`, `packages/desktop/src/board/__tests__/triage-lane.test.tsx`
- **Verification:** `npm --prefix packages/desktop test` — 552/552 pass across all 38 files, including the three touched here
- **Committed in:** `cfdf997` (Task 3's own commit)

---

**Total deviations:** 1 auto-fixed (1 blocking fix required by the task's own acceptance criteria, with mechanical test-mock fallout across three files). **Impact:** necessary to satisfy Task 3's own literal verify step; no scope creep beyond the transport-seam gap the plan's own reading requirement (D-…, `06-PATTERNS.md`'s flagged excerpt) surfaced.

## Issues Encountered
None beyond the deviation documented above. `cargo test --workspace` (run once, without `--no-fail-fast`) surfaced one unrelated flaky failure in `packages/core/tests/worktree_lifecycle.rs::a_worktree_survives_two_runs_with_an_epic` (a `git worktree add` race under concurrent test load — `fatal: not a git repository`). Confirmed pre-existing and environmental, not caused by this plan's diff: (1) `worktree_lifecycle.rs` was last touched in an unrelated prior commit (`1911d54`, plan 02-01), (2) re-running `cargo test -p core --test worktree_lifecycle` in isolation passed 2/2, and (3) a full `cargo test --workspace --no-fail-fast` run afterward passed every test binary, 0 failures. Not fixed here (out of this plan's scope — matches `WINDOWS.md` entry #2's identically-shaped, already-recorded prior observation of this same file's concurrency sensitivity).

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Known reading gap closed here

`06-PATTERNS.md` flagged the bodies of `useAcceptProposal` and `useRejectProposal` as named but not excerpted. Having now read all four mutation hooks (`useAcceptProposal`, `useRejectProposal`, `useAmendProposal`, `useAcceptSubtree`) in full per Task 3's mandated `<read_first>`:

- Each is a thin `useMutation` wrapping a single async call, with `onSuccess: invalidate` where `invalidate` is a closure returned by a small `useInvalidateRunProposals(agentRunId)` helper that calls `queryClient.invalidateQueries({ queryKey: authoringProposalsQueryKey(agentRunId ?? "none") })`.
- Before this plan, three of the four (`useRejectProposal`, `useAmendProposal`, `useAcceptSubtree`) called `invokeCommand` directly inline inside `mutationFn` rather than through a named wrapper — the exact gap this plan's own acceptance criteria required closing (see Deviations above). Only `useAcceptProposal` already went through a named wrapper (`acceptAuthoringProposal`).
- The new hooks (`useMergeProposal`, `useDeferProposal`, `useRejectProposalsBulk`, `useDeferProposalsBulk`) copy this exact `useMutation`/`onSuccess` shape, but widen the invalidation set where the verb's own effect requires it: `useMergeProposal` invalidates run + project + `["board"]` (a merge mints a real issue a board lane renders); `useDeferProposal`/`useDeferProposalsBulk` invalidate the pending query AND the new deferred query (a defer moves a row from one lane to the other).

## Next Phase Readiness
- The full command/transport/hook surface for merge, defer, both bulk verbs, and the deferred filter now exists — plan 06-07 (the dedicated triage UI) can build directly on `useMergeProposal`/`useDeferProposal`/`useRejectProposalsBulk`/`useDeferProposalsBulk`/`useDeferredProposals`/`useProposalLimitNotices` with no further wiring.
- **Shared-ID note:** PROP-04/PROP-06/PROP-07 are each declared by sibling plans still in flight (06-07, 06-08, 06-09) — the shared-ID gate (#2388) holds them open in `REQUIREMENTS.md` until every declaring plan finishes, even though this plan's own coverage above is complete.
- **No new stubs, no skipped tests, no unrun `<verify>` blocks** — every task's automated `<verify>` command was run directly and every acceptance criterion checked with a real command (see Coverage above). No new `WINDOWS.md` entry was needed.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: packages/core/src/query/authoring.rs (list_deferred_proposals)
- FOUND: packages/core/tests/proposal_triage_verbs.rs (18 tests, 5 new)
- FOUND: packages/desktop/src-tauri/src/commands/authoring.rs (5 new commands)
- FOUND: packages/desktop/src-tauri/src/main.rs (5 new command registrations)
- FOUND: packages/desktop/src/adapters/tauri.ts (9 new wrappers)
- FOUND: packages/desktop/src/authoring/useAuthoringQuery.ts (6 new hooks, 0 invokeCommand)
- FOUND: f316c10 (Task 1 commit)
- FOUND: 42e7e3c (Task 2 commit)
- FOUND: cfdf997 (Task 3 commit)
- cargo test -p core --test proposal_triage_verbs: 18/18 pass
- cargo build --workspace: clean
- cargo test -p core --test authoring_proposal: 42/42 pass
- npm --prefix packages/desktop run build: clean, tsc typechecks
- npm --prefix packages/desktop test: 552/552 pass across 38 files
- All plan-level `<verification>` commands re-run and confirmed passing
