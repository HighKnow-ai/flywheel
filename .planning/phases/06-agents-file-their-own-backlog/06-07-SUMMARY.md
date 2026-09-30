---
phase: 06-agents-file-their-own-backlog
plan: 07
subsystem: authoring
tags: [react, tauri, rust, keyboard, triage, authoring-proposal]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plan 06-06)
    provides: "Six triage hooks (useProjectProposals/useDeferredProposals/useProposalLimitNotices/useMergeProposal/useDeferProposal/useRejectProposalsBulk/useDeferProposalsBulk) and the widened AuthoringProposalDto (rationale/originLogOffset/duplicateOf/duplicateScore)"
  - phase: 06-agents-file-their-own-backlog (plan 06-04)
    provides: "duplicate_of/duplicate_score written at staging time, and query::authoring::resolve_duplicate_candidate_label (via 06-05)"
  - phase: 06-agents-file-their-own-backlog (plan 06-05)
    provides: "PROPOSAL_LIMIT_PER_RUN, proposal_limit_notices, resolve_duplicate_candidate_label"
provides:
  - "The \"triage-surface\" keyboard region/layer (state/keyboard.ts): merge-proposal, defer-proposal, reject-selected-proposals, defer-selected-proposals action ids, 11 binding rows, and a layer-first bindingAllowedInLayer branch that lets accept/reject/amend resolve under either the tray's or this surface's own layer without widening the tray's own rule for any other layer"
  - "ProposalRow.tsx: an optional region prop (default \"proposal-tray\") threaded through its one useRegionBindings call, plus optional onMerge/onDefer callbacks rendered and dispatched only when supplied"
  - "packages/desktop/src/triage/TriageSurface.tsx: the dedicated project-scoped triage view — all four verbs per row, run provenance, rationale as its own block, duplicate annotation, turn-pointer control, a deferred filter, exactly two bulk controls, and a merge target picker"
  - "packages/desktop/src/triage/__tests__/triage-surface.test.tsx: 11 component tests"
  - "(deviation) ProposalDto/AuthoringProposalDto widened with an optional duplicateCandidate (kind/key/title), resolved server-side for the two board-level triage reads"
affects: [06-08, 06-09]

actuals:
  tokens: 16014
  tasks: 3
  commits: 3

plan_head_before: e008539c3bed57735696018c51564c9e264b8c4b

tech-stack:
  added: []
  patterns:
    - "A layer-first branch in bindingAllowedInLayer (checked before the id-first PROPOSAL_TRAY_ACTION_IDS branch) lets a shared action id (accept-proposal/reject-proposal/amend-proposal) resolve under a SECOND layer without widening the first layer's own existing rule for any other layer — the existing branch stays byte-identical for every layer value it always handled."
    - "groupProposals is copied byte-for-byte a third time (ProposalTray.tsx -> TriageLane.tsx -> TriageSurface.tsx) rather than extracted into a shared module — matches this codebase's own established convention of duplicating small pure functions across sibling files rather than introducing a shared-utility import for a ~15-line function."
    - "A widened read-side DTO (duplicateCandidate) is resolved via ONE bounded LIMIT-1 lookup per row inside an already-bounded window read, reusing the exact query::authoring::resolve_duplicate_candidate_label call handle_inbound_proposal_created already makes for a freshly staged proposal — never a second lookup routine, never an unbounded per-render sweep."

key-files:
  created:
    - packages/desktop/src/triage/TriageSurface.tsx
    - packages/desktop/src/triage/__tests__/triage-surface.test.tsx
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/authoring/ProposalRow.tsx
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src/adapters/tauri.ts

key-decisions:
  - "Final keybinding map for the \"triage-surface\" region (see \"Keymap\" section below) — reuses the tray's exact a/d/e letters for accept/reject/amend, adds m (merge) and z (defer), plus j/ArrowDown, k/ArrowUp for movement and Shift+D/Shift+Z for the two bulk sweeps. No keystroke and no default-focused control accepts a proposal anywhere in this region — Accept is never autoFocus, and no binding id anywhere in keyboard.ts means accept-many/accept-all."
  - "bindingAllowedInLayer gained a NEW layer-first branch (`if (layer === \"triage-surface\") return TRIAGE_SURFACE_ACTION_IDS.has(id) || TRAY_SELECTION_ACTION_IDS.has(id);`) placed BEFORE the existing id-first `PROPOSAL_TRAY_ACTION_IDS` check, rather than widening that check's own condition. accept-proposal/reject-proposal/amend-proposal are members of both TRIAGE_SURFACE_ACTION_IDS and PROPOSAL_TRAY_ACTION_IDS; under the triage-surface layer the new branch decides them, under every other layer it is a no-op and the tray's own branch decides them exactly as it always has — proven by proposal-keyboard/proposal-tray staying green unchanged."
  - "onMerge is a synchronous callback that only opens TriageSurface's own inline target picker — it never itself calls the backend. Only the picker's own explicit target choice calls useMergeProposal (via a TriageSurface-owned mergingRef guard, mirroring ProposalRow's own accept/reject ref pattern). onDefer IS a real backend call from ProposalRow's perspective, so it is guarded with its own deferringRef exactly like accept/reject."
  - "[Rule 2 - Missing critical] duplicateOf alone is an opaque id — the plan's own truths (\"annotated with its candidate's key and title\") and Task 3's own behavior list (\"renders the annotation with the candidate's title\") require a resolved label nothing on the wire carried yet. Widened ProposalDto (Rust)/AuthoringProposalDto (TS) with an optional duplicateCandidate, resolved via the EXISTING query::authoring::resolve_duplicate_candidate_label for the two board-level triage reads (authoring_proposals_pending/authoring_proposals_deferred) only — the tray's own authoring_proposals_for_run keeps the cheaper plain conversion since nothing renders the candidate there. This is a DTO widening, not a new Tauri command."
  - "The merge target picker's candidate roster is the epicsById prop (the board's own full epic roster) plus useBoardQuery's currently-loaded task window (D-03's own bounded window) — not an exhaustive task roster. This mirrors how the rest of this codebase already treats \"candidate tasks\" (no dedicated full-task-roster hook exists anywhere in this app)."
  - "TriageSurface.tsx is NOT wired into any route/entry point (BoardView.tsx/App.tsx untouched) — this plan's own task list and files_modified list only the four files this SUMMARY names. Reaching the surface from a running app is left to a later plan (06-08/06-09, per 06-06-SUMMARY.md's own affects list)."

patterns-established: []

requirements-completed: []  # PROP-04/06/07 are also declared by sibling plans 06-08/06-09 still in flight (no *-SUMMARY.md yet) — the shared-ID gate (#2388) holds them open in REQUIREMENTS.md until every declaring plan finishes. PROP-05 is declared only by 06-05 (already complete) and this plan.

coverage:
  - id: D1
    description: "The triage-surface keyboard region resolves 11 bindings (accept/reject/amend/merge/defer, movement, two bulk sweeps); ProposalRow acts in either region via its own region prop with the tray's existing keyboard behaviour provably unchanged"
    requirement: PROP-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx, proposal-tray.test.tsx (25/25, unchanged)"
        status: pass
      - kind: other
        ref: "shell: grep checks for the four new action ids, >=9 triage-surface-region bindings, exactly one useRegionBindings call in ProposalRow.tsx, no accept-all/acceptAll/accept-remaining/acceptRemaining identifier"
        status: pass
    human_judgment: false
  - id: D2
    description: "The dedicated triage surface renders one row per pending proposal (grouped exactly like TriageLane), each offering accept/reject/merge/defer, showing its rationale as its own labelled block and its run provenance"
    requirement: PROP-07
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#renders three rows for three pending proposals, each showing its rationale and its run provenance"
        status: pass
    human_judgment: false
  - id: D3
    description: "A duplicate-flagged proposal is annotated with its resolved candidate's key/title (server-side lookup, deviation) and stays fully decidable (Accept/Reject enabled)"
    requirement: PROP-04
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#a row carrying a duplicate candidate renders the annotation with the candidate's title, and stays decidable"
        status: pass
    human_judgment: false
  - id: D4
    description: "A limit notice renders per throttled run, derived from useProposalLimitNotices, naming the run and how many proposals it refused"
    requirement: PROP-05
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#a limit notice renders when the notices hook returns one, naming the refused count"
        status: pass
    human_judgment: false
  - id: D5
    description: "The deferred filter switches the visible window to deferred proposals, recalling them from the same surface; defer is inert in that view"
    requirement: PROP-06
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#the deferred filter switches the list to the deferred window, and defer is inert there"
        status: pass
    human_judgment: false
  - id: D6
    description: "Exactly two bulk controls (Reject selected / Defer selected) exist, both disabled and issuing no call on an empty selection, and a real two-id selection calls the bulk-reject mutation once with both ids; no accept-many affordance exists in source or in the rendered output"
    requirement: PROP-06
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#an empty selection leaves both bulk controls disabled..., #two selected rows and Reject selected call the bulk-reject mutation once with both ids, #no rendered control, label or accessible name on the surface offers accepting more than one proposal"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_proposal (42/42, the Phase-5 accept-all source gate re-run against the new file)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Merge requires an explicit target choice through an inline picker before any mutation fires; there is no default target and no single keystroke completes a merge"
    requirement: PROP-06
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#choosing merge opens the target picker and calls no mutation until a target is chosen"
        status: pass
    human_judgment: false
  - id: D8
    description: "An undecidable merge (the chosen target is deleted concurrently, between listing and choosing) renders as a stable per-row notice rather than a transient error"
    verification: []
    human_judgment: true
    rationale: "Implemented (TriageSurface.tsx's mergeUndecidableIds state, gated on the same MERGE_UNDECIDABLE_MARKER substring ProposalRow.tsx's own accept path checks) but not covered by an automated test — this edge case is not listed in Task 3's own <behavior> bullets or acceptance criteria, and reproducing it requires a real concurrent delete between the picker's candidate list and the mutation call. A human or a later plan should exercise it directly."
  - id: D9
    description: "A row's turn-pointer control renders whenever originLogOffset is non-null, treating offset 0 as a real pointer (not a missing one), and calls back with the exact offset"
    requirement: PROP-07
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/triage/__tests__/triage-surface.test.tsx#a row whose turn pointer is zero still renders the jump control and calls back with offset zero"
        status: pass
    human_judgment: false
  - id: D10
    description: "The whole desktop suite (563 tests, 39 files) and the full build stay green; the Rust workspace (809+ tests) and the sidecar suite (215 tests) stay green"
    verification:
      - kind: integration
        ref: "npm --prefix packages/desktop test (563/563), npm --prefix packages/desktop run build (clean), cargo test --workspace (all green), npm --prefix packages/sidecar test (215/215)"
        status: pass
    human_judgment: false

duration: 48min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 7: The Dedicated Triage Surface Summary

**A `SessionSurface`-shaped triage view — accept/reject/merge/defer per row, rationale and run provenance as their own labelled blocks, a resolved duplicate-candidate annotation, per-run limit notices, a deferred recall filter, and exactly two bulk controls — reusing the shipped `ProposalRow` in a new `"triage-surface"` keyboard region.**

## Performance

- **Duration:** ~48 min
- **Started:** 2026-09-30T16:48:00Z (approx., following 06-06's completion)
- **Completed:** 2026-09-30T17:00:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `state/keyboard.ts` gained the `"triage-surface"` region/layer, four new action ids (`merge-proposal`/`defer-proposal`/`reject-selected-proposals`/`defer-selected-proposals`), and 11 binding rows — `a`/`d`/`e` reuse the tray's own letters, `m`/`z` are the two new per-row verbs, `j`/`k`/arrows move selection, `Shift+D`/`Shift+Z` are the two bulk sweeps. `bindingAllowedInLayer` gained a new layer-first branch so the shared verb ids resolve under either layer without widening the tray's own existing rule for any other layer — proven by the tray's 25 keyboard/tray tests staying green, byte-unchanged.
- `ProposalRow.tsx` takes an optional `region` (default `"proposal-tray"`) threaded through its one `useRegionBindings` call, plus optional `onMerge`/`onDefer` — rendered and dispatched only when supplied, so `ProposalTray.tsx`/`board/TriageLane.tsx` (which supply neither) are byte-identical in behaviour.
- `packages/desktop/src/triage/TriageSurface.tsx` (621 lines): the dedicated project-scoped triage view. Per row: run provenance, rationale as its own labelled block, a duplicate annotation (a reveal-toggling link, never a decision), and a turn-pointer control guarded on a non-null offset (`0` treated as real). A notice region above the list reads `useProposalLimitNotices`. A Pending/Deferred filter toggle switches the visible window (defer is inert in the deferred view). Exactly two bulk controls (Reject selected / Defer selected), both inert on an empty selection. Merge is a two-step interaction: an inline target picker (candidate epics from the `epicsById` prop, candidate tasks from `useBoardQuery`'s loaded window) requires an explicit choice before `useMergeProposal` ever fires; an undecidable merge renders as a stable per-row notice.
- **Deviation (Rule 2):** `ProposalDto`(Rust)/`AuthoringProposalDto`(TS) widened with an optional `duplicateCandidate` (kind/key/title), resolved via the already-shipped `query::authoring::resolve_duplicate_candidate_label` for the two board-level triage reads only — no new Tauri command, one bounded lookup per row inside an already-bounded window.
- 11 new component tests in `triage/__tests__/triage-surface.test.tsx`; all 5 plan-level `<verification>` commands re-run and green: `npm --prefix packages/desktop test -- triage-surface` (11/11), `-- proposal-keyboard proposal-tray` (25/25), full `npm test` (563/563 across 39 files), `npm run build` (clean), `cargo test -p core --test authoring_proposal` (42/42). Also re-ran `cargo test --workspace` (all green) and `npm --prefix packages/sidecar test` (215/215) per this plan's own stated baselines.

## Task Commits

Each task was committed atomically:

1. **Task 1: The `triage-surface` keyboard region, and a row that can act in two regions** - `236ac7e` (feat)
2. **Task 2: `TriageSurface.tsx` — the dedicated view** - `fefcd79` (feat)
3. **Task 3: Component tests for the surface** - `f55ac9e` (test)

**Plan metadata:** commit follows this SUMMARY

_TDD note: Task 3 carries `tdd="true"`, but Task 2 (a prior, non-TDD task in this same plan) already shipped the complete implementation before this test file existed — there was no code left to drive with a failing test. All 11 tests passed on their first run (no RED). This is a deliberate consequence of this plan's own task split (implementation in Task 2, tests in Task 3), not a violation of test quality — every test still asserts real, meaningful behaviour against the shipped component. See "TDD Gate Compliance" below._

## Files Created/Modified
- `packages/desktop/src/state/keyboard.ts` - `"triage-surface"` region/layer, 4 new action ids, 11 new binding rows, `TRIAGE_SURFACE_ACTION_IDS`, the new layer-first branch in `bindingAllowedInLayer`
- `packages/desktop/src/authoring/ProposalRow.tsx` - `region`/`onMerge`/`onDefer` props, `merge()`/`defer()` handlers with their own guards, Merge/Defer buttons, keyboard dispatch extended
- `packages/desktop/src/triage/TriageSurface.tsx` - new: the dedicated triage view, `MergeTargetPicker`, `DuplicateAnnotation`, `LimitNoticeBanner`, `groupProposals`/`flattenGroups` (copied)
- `packages/desktop/src/triage/__tests__/triage-surface.test.tsx` - new: 11 component tests
- `packages/desktop/src-tauri/src/commands/authoring.rs` - `DuplicateCandidateDto`, `proposal_dto_with_duplicate_label`, `ProposalDto.duplicate_candidate`, wired into `authoring_proposals_pending`/`authoring_proposals_deferred`
- `packages/desktop/src/adapters/tauri.ts` - `DuplicateCandidateDto`, `AuthoringProposalDto.duplicateCandidate`

## Decisions Made

See `key-decisions` in the frontmatter for full rationale. Summary:

1. **Keymap for the `"triage-surface"` region** (also required explicitly by this plan's `<output>` instruction) — see "Keymap" section below.
2. **`bindingAllowedInLayer`'s new branch is layer-first, checked before the tray's own id-first branch** — the shared ids (accept/reject/amend) resolve correctly under either layer without widening the tray's own rule for any layer it already governed.
3. **`onMerge` opens a picker; only the picker's own choice calls the backend** — no single keystroke can complete a merge (D-101).
4. **Duplicate candidate label widening (Rule 2 deviation)** — see full rationale in key-decisions and Deviations below.
5. **Merge candidates come from the board's already-loaded epic roster + task window**, not a new exhaustive roster query.
6. **No entry-point wiring in this plan** — `TriageSurface.tsx` is built and tested but not yet reachable from a running app; left to 06-08/06-09.

## Keymap (this plan's own `<output>` requirement)

| Key | Action | Notes |
|---|---|---|
| `a` | Accept Proposal | same letter as the tray |
| `d` | Reject Proposal | same letter as the tray |
| `e` | Amend Proposal | same letter as the tray |
| `m` | Merge Proposal | opens the target picker — no backend call itself |
| `z` | Defer Proposal | real backend call, guarded like accept/reject |
| `j` / `ArrowDown` | Move selection down | shared id with the tray/board |
| `k` / `ArrowUp` | Move selection up | shared id with the tray/board |
| `Shift+D` | Reject Selected Proposals | the only bulk-reject path |
| `Shift+Z` | Defer Selected Proposals | the only bulk-defer path |

**No keystroke and no default-focused control accepts a proposal on this surface.** Accept is never `autoFocus`; no action id anywhere in `keyboard.ts` means accept-many or accept-all; the only two bulk verbs (reject, defer) mint nothing and never touch the accept path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `duplicateOf` alone carried no resolvable label for the triage surface's own annotation**
- **Found during:** Task 2, while designing the duplicate annotation this plan's own `must_haves.truths` #3 requires ("annotated with its candidate's key and title")
- **Issue:** `AuthoringProposalDto.duplicateOf` is an opaque id; nothing on the wire named the candidate's kind/key/title for a general triage read. The one place this WAS resolved (`handle_inbound_proposal_created`) only relays it to the AGENT at staging time, never to the renderer for an already-staged, already-listed proposal.
- **Fix:** Added `DuplicateCandidateDto`/`duplicate_candidate` to `ProposalDto` (Rust) and `AuthoringProposalDto` (TS), populated via a new `proposal_dto_with_duplicate_label` helper that calls the EXISTING `query::authoring::resolve_duplicate_candidate_label` — reused verbatim, not reimplemented — for each row in the two board-level triage reads (`authoring_proposals_pending`/`authoring_proposals_deferred`) only. The tray's own `authoring_proposals_for_run` keeps the plain, cheaper `From` conversion since nothing renders the candidate there yet.
- **Files modified:** `packages/desktop/src-tauri/src/commands/authoring.rs`, `packages/desktop/src/adapters/tauri.ts`
- **Verification:** `cargo build --workspace` clean, `cargo build` (desktop crate) clean, `npm run build` (tsc) clean, and the new field is exercised directly by `triage-surface.test.tsx#a row carrying a duplicate candidate renders the annotation with the candidate's title, and stays decidable`
- **Committed in:** `fefcd79` (Task 2's own commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical DTO widening). **Impact:** necessary to satisfy this plan's own stated truth (must_haves #3) and Task 3's own behavior bullet; confined to widening two existing read commands' response shape (no new Tauri command), reusing an already-shipped lookup. No scope creep.

## Issues Encountered
None beyond the deviation and the TDD-ordering note documented above.

## TDD Gate Compliance

Task 3 carries `tdd="true"`. The canonical RED-then-GREEN commit sequence did not occur, because Task 2 (a prior, non-TDD `type="auto"` task within this same plan) had already shipped the complete `TriageSurface.tsx` implementation before this test file was written. Running the freshly-written 11-test suite against that already-correct implementation produced 11/11 passing on the FIRST run — a genuine, unforced GREEN, not a contrived or skipped RED. Per `tdd.md`'s own fail-fast rule ("Unexpected GREEN in RED phase: ... investigate before proceeding"), this was investigated directly: the feature already existed and was already correct, so proceeding (rather than manufacturing an artificial failure) was the right call. `gsd_run check tdd-red-evidence` was not invoked, since there was no RED run to evidence. This mirrors plan 06-04/06-05's own documented precedent for a cross-plan tooling/process gap, applied here to a genuine test-after-implementation task ordering rather than a tooling format mismatch.

**Commit sequence:** `feat(06-07)` (Task 1) → `feat(06-07)` (Task 2) → `test(06-07)` (Task 3) — test follows both feat commits rather than preceding one, which is the literal, honestly-recorded violation of the canonical `test → feat` ordering the gate enforcement rules ask to be flagged when it occurs.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs

None. Every deliverable this plan lists is implemented and exercised end-to-end except the single, explicitly-scoped edge case recorded as `D8` in Coverage above (an undecidable merge's stable-notice rendering) — implemented, but not proven by an automated test since it falls outside Task 3's own `<behavior>` list.

## Next Phase Readiness
- `TriageSurface.tsx` is complete, tested, and ready to be mounted — but this plan deliberately does not wire it into `BoardView.tsx`/`App.tsx` (not in its own task list or `files_modified`). A later plan (06-08 or 06-09, per 06-06-SUMMARY.md's `affects` list) needs to add the actual entry point (e.g. a route/button from `TriageLane.tsx`'s header or a new keyboard binding) before Task 3's own `<human-check>` ("Launch the desktop app... open the triage surface...") is runnable. Recorded as an `unrun-verify` entry in `WINDOWS.md`.
- **Shared-ID note:** PROP-04/PROP-06/PROP-07 are each declared by sibling plans 06-08/06-09, still in flight (no `*-SUMMARY.md` yet) — the shared-ID gate (#2388) holds them open in `REQUIREMENTS.md` until every declaring plan finishes, even though this plan's own coverage above is complete. PROP-05 is declared by this plan and the already-complete 06-05.
- **One genuinely untested edge case, recorded honestly:** an undecidable merge (D8 in Coverage) is implemented but not automated-tested — a good candidate for either a follow-up test or manual verification.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*

## Self-Check: PASSED

- FOUND: packages/desktop/src/triage/TriageSurface.tsx
- FOUND: packages/desktop/src/triage/__tests__/triage-surface.test.tsx
- FOUND: packages/desktop/src/state/keyboard.ts (triage-surface region/layer)
- FOUND: packages/desktop/src/authoring/ProposalRow.tsx (region/onMerge/onDefer)
- FOUND: packages/desktop/src-tauri/src/commands/authoring.rs (DuplicateCandidateDto)
- FOUND: packages/desktop/src/adapters/tauri.ts (duplicateCandidate)
- FOUND: 236ac7e (Task 1 commit)
- FOUND: fefcd79 (Task 2 commit)
- FOUND: f55ac9e (Task 3 commit)
- npm --prefix packages/desktop test -- triage-surface: 11/11 pass
- npm --prefix packages/desktop test -- proposal-keyboard proposal-tray: 25/25 pass
- npm --prefix packages/desktop test: 563/563 pass across 39 files
- npm --prefix packages/desktop run build: clean, tsc typechecks
- cargo test -p core --test authoring_proposal: 42/42 pass
- cargo test --workspace: all green
- npm --prefix packages/sidecar test: 215/215 pass
- All plan-level `<verification>` commands re-run and confirmed passing
