---
phase: 05-socratic-epic-authoring
plan: 07
subsystem: agent-authoring
tags: [react, tanstack-query, keyboard-map, legend, tauri-invoke-seam]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-06's full accept/reject/amend/accept-subtree command surface (authoring_proposal_accept/_reject/_amend, authoring_subtree_accept) and plan 05-02's first-cut ProposalTray.tsx/staging schema — both driven here, never re-derived. plan 05-03's proposal-pending legend mark and the a/d/Shift+A permission-card vocabulary the tray's own region reuses."
provides:
  - "useAuthoringQuery.ts: the one authoring query layer (useRunProposals plus the four mutation hooks) plan 05-08's board triage lane will also read through — invalidated on board:changed ONLY, deliberately never agent:event, which is the structural mechanism (not a test artifact) behind the tray/feed re-render isolation D-85 depends on"
  - "ProposalRow.tsx: the tray's full row anatomy — a proposal-pending mark, each payload field its own element, the verb when not create, D-96's no-project-key guarantee, and the complete four-verb action cluster (accept/reject/amend/accept-subtree), each guarded by a synchronous useRef against a double-click double-dispatch"
  - "ProposalAmendEditor.tsx: the staged row's own field-by-field editor (D-94) — writes to staging only, never routes through the board's own criteria/item-detail editors"
  - "ProposalTray.tsx: groups the flat backend-ordered list into roots-with-nested-children (D-16: an orphaned child whose parent already decided still renders), owns the accept-subtree guard (a Set keyed by root id) and the tray's own j/k/arrow-key selection"
  - "state/keyboard.ts: a proposal-tray FocusRegion/UiLayer carrying four bindings (a/d/e/Shift+A) reusing the permission card's own vocabulary in a distinct region namespace, plus a move-down/move-up allowance for the tray layer"
affects: [05-08-*, phase-05-verification]

actuals:
  tokens: 23300
  tasks: 3
  commits: 3
  plan_head_before: 1efbac74ad17a8566b990c83fb03b93e4c924ead

tech-stack:
  added: []
  patterns:
    - "A query hook invalidated on board:changed ONLY, never the live agent:event push, when the backend's own inbound handler already re-emits board:changed for the event that would have justified a second subscription (handle_inbound_proposal_created) — the deliberate omission is what makes an unrelated feed event structurally unable to touch the tray's own query, not merely unlikely to in practice"
    - "A Set-keyed-by-id ref (mirrors recovery/OrphanRecoveryModal.tsx's killingRef) paired with a state Set for rendering, used a second time in this codebase for a genuinely concurrent multi-target guard (accept-subtree) rather than a single boolean"
    - "A region-scoped per-row useRegionBindings call gated on a selected prop (mirrors session/PermissionRequestCard.tsx's keyboardEnabled), reused a second time for a list of independently-keyboard-actionable rows sharing one tray-level selection index"

key-files:
  created:
    - packages/desktop/src/authoring/useAuthoringQuery.ts
    - packages/desktop/src/authoring/ProposalRow.tsx
    - packages/desktop/src/authoring/ProposalAmendEditor.tsx
    - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
  modified:
    - packages/desktop/src/authoring/ProposalTray.tsx
    - packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/state/keyboard.ts

key-decisions:
  - "useAuthoringQuery.ts's useRunProposals invalidates on board:changed only, never subscribeAgentEvent — a deliberate divergence from plan 05-02's original useAuthoringProposals (which listened to both). The backend's handle_inbound_proposal_created already re-emits board:changed for every proposal_created event, so a second subscription was redundant AND would have made 'a feed event does not re-render the tray's rows' (Task 3's own acceptance criterion) false by construction rather than true by construction."
  - "board/useBoardQuery.ts's now-superseded useAuthoringProposals hook and its query key were removed (its only caller, ProposalTray.tsx, was rewritten to read useAuthoringQuery.ts instead) rather than left as dead code beside the new single query layer Task 1's own action text calls for ('the one query layer both this tray and plan 05-08's board lane read through') — two independently-invalidated implementations of the same read would have been a structural drift risk, not a convenience."
  - "The undecidable state (Task 1(d)) is detected reactively, on an accept attempt failing with the core's typed ProposalUndecidable error, rather than pre-computed — this plan's own file list carries no Rust changes, and the backend only actually checks target existence at materialisation time (accept_proposal's ensure_target_exists), so there is no earlier moment the frontend could know a target is gone without duplicating that check itself. Matched via a stable substring ('undecidable, not auto-rejected') from the error's own Display text, never the whole message (whose interpolated ids are not stable across rows)."
  - "The reject action's optional-reason field is an always-visible inline input beside the Reject button, not a click-to-open composer — Task 2's own acceptance criterion groups 'reject' among the single-click-produces-one-backend-call verbs (alongside accept/amend-save/subtree-accept), which a two-step open-then-confirm flow would not satisfy."
  - "The tray reuses the proposal-pending mark (plan 05-03) for every row's own glyph rather than inventing per-target-type marks — no per-target-type mark exists in legend/marks.ts yet, and Task 1's own instruction names 'the agent channel plan 05-03 added' specifically, which is this one mark."
  - "SessionSurface.tsx needed no code change: mounting ProposalTray was already unconditional on authoringStage since plan 05-02, and none of this plan's three tasks touch the session feed itself — only its own test file exercises SessionSurface, as a harness for the tray/feed isolation and status-strip assertions."

patterns-established:
  - "useAuthoringQuery.ts's board:changed-only invalidation is the template for any future authoring-surface query (plan 05-08's board triage lane) that reads a table whose own writer already re-emits board:changed — subscribe to the narrower channel, not the broader one, when the broader one would only ever re-deliver the same signal."

requirements-completed: []

coverage:
  - id: D1
    description: "The tray renders one row per pending proposal with drafted criteria nested under their task (grouped by parentProposalId, children ordered by position, roots left in the Rust read's own createdAt-desc/id-desc order); a criterion row renders its statement and verification hint as two distinct elements; an amend/delete proposal renders its verb and a create proposal renders none; no pending row renders project-key-shaped text"
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx (Task 1 section: 9 tests covering row rendering, nesting/order, criterion two-element rendering, verb rendering, no-key-shape)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (513/513)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A staged proposal can be amended field-by-field (title/description, statement/verification_hint, or assumption/answer depending on kind) and saved to staging without ever touching the board; a subsequent accept materialises the amended text, never the agent's original"
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx#the_amend_editor_saves_and_the_row_stays_pending_with_the_new_text"
        status: pass
      - kind: other
        ref: "grep gate: zero AcceptanceCriteriaList/ItemDetailPanel references in ProposalAmendEditor.tsx (comment-stripped)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A proposal whose target row no longer exists renders as undecidable (accept disabled, reject still live) rather than disappearing or failing silently on click; rejecting always offers an optional reason field, passed to the backend verbatim when typed and omitted (never blocking) when empty"
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx (undecidable-state test, empty-reason test, typed-reason test)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (513/513)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Accept-subtree is the ONE bulk path, rendering only on a task root with at least one pending drafted criterion, labelled with the exact child count; every one of the four verbs (accept/reject/amend-save/subtree-accept) is guarded so three synchronous clicks issue exactly one backend call, and two different subtree roots can act concurrently"
    requirement: SHAPE-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx (Task 2 section: subtree-visibility test, two-roots-concurrent test, three-synchronous-clicks tests for accept/reject)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (513/513); cargo test --workspace (0 failures, including the accept-all-identifier source-scanning gate over packages/desktop/src)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The tray's four verbs are single-letter keyboard actions (a/d/e/Shift+A) reusing the permission card's own vocabulary, scoped to the tray's own selection; Shift+A is inert (no backend call) on a criterion row and a childless task; j/k move selection and an empty tray takes no focus; typing in the amend editor's own field never leaks to the region; a proposal_created log entry never disturbs the status strip's cost/token readings; a board:changed invalidation updates the tray without re-rendering the feed's own underlying query"
    requirement: SHAPE-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx (8 tests: four-keys-act-on-focused-row, Shift+A inert x2, j-moves, k-moves, empty-tray-no-focus, editor-focus-guard, status-strip-non-interference)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx#the_tray_re_renders_on_board_changed_without_re_rendering_the_feed_s_own_rows"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test -- src/state (17/17), npm --prefix packages/desktop run test -- src/session (130/130), npm --prefix packages/desktop run test (513/513 full suite)"
        status: pass
    human_judgment: false

duration: ~180min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 07: The Proposal Tray's Row Anatomy, Its Four Verbs and Its Keyboard Region Summary

**Every staged proposal is now a fully decidable row — nested criteria under their task, an inline field-by-field amend editor that never touches the board, an accept-subtree action scoped to exactly one task at a time, and a single-letter keyboard region (a/d/e/Shift+A) that reuses the permission card's own vocabulary — with the tray and the live feed proven structurally unable to force each other's queries to refetch.**

## Performance

- **Duration:** ~180 min
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 5

## Accomplishments

- **Task 1 — the tray's data layer and row anatomy.** `useAuthoringQuery.ts` (new) is the one query layer this tray and plan 05-08's board triage lane will both read through: `useRunProposals` plus mutation hooks for accept/reject/amend/subtree-accept, all invalidated on the SAME `authoring-proposals` query key — deliberately on `board:changed` alone, never `subscribeAgentEvent`, since the backend's own `handle_inbound_proposal_created` already re-emits `board:changed` for every `proposal_created` event and a second subscription would have defeated the exact tray/feed re-render isolation D-85 depends on. `ProposalRow.tsx` (new) renders one proposed item as one row: the `proposal-pending` mark (plan 05-03's agent-channel glyph, never a bare coloured dot), the payload's own fields each their own element (a criterion's statement and verification hint render as two distinct `<span>`s), the verb when it is not `create`, and D-96's guarantee that no pending row ever renders project-key-shaped text. `ProposalTray.tsx` groups the flat, backend-ordered proposal list into roots with nested children — grouped by `parentProposalId`, children sorted by staging `position`, roots left in the exact order the Rust read already returns them (`created_at DESC, id DESC`) so the two can never disagree — and treats a proposal whose named parent is no longer in the pending set (already decided) as its own root rather than dropping it (D-16). `board/useBoardQuery.ts`'s now-superseded `useAuthoringProposals` hook and query key were removed, since `ProposalTray.tsx` was its only caller and the plan's own action text calls for exactly one query layer, not two independently-invalidated copies.
- **Task 2 — the four verbs, at the row.** Accept carries plan 05-02's own synchronous `acceptingRef` guard forward unchanged; reject gets its own matching `rejectingRef`; both, plus amend-save and accept-subtree, guarantee three synchronous clicks issue exactly one backend call — the sixth and seventh siblings of this codebase's own re-entry-guard pattern. Reject renders an always-visible inline optional-reason field beside its button (submitting empty rejects with no reason; a typed reason passes through verbatim), satisfying the plan's own grouping of reject among the single-click verbs. `ProposalAmendEditor.tsx` (new) opens the staged row's payload for field-by-field editing — title/description, statement/verification hint, or assumption/answer, depending on the payload's own `kind` — validated with the exact non-empty/length-bound rules the core's `validate_payload` applies (`MAX_PROPOSAL_TITLE_LEN`/`MAX_PROPOSAL_TEXT_LEN`), and imports neither `AcceptanceCriteriaList` nor `ItemDetailPanel` (D-94: amending writes to staging only). Accept-subtree renders only on a task root with at least one pending drafted criterion, labelled "Accept task and its N criteria"; `ProposalTray.tsx` owns its guard as a `Set` keyed by root id (mirroring `OrphanRecoveryModal.tsx`'s `killingRef`) so two different subtrees can act concurrently while a repeat of the same one is suppressed — no control on this surface ever accepts more than one subtree, and none accepts the whole tray.
- **Task 3 — the tray's keyboard region, and staying live while the feed streams.** `state/keyboard.ts` gained a `proposal-tray` `FocusRegion`/`UiLayer` with four bindings — `a` (accept), `d` (reject), `e` (amend), `Shift+A` (accept-subtree) — reusing the permission card's exact `a`/`d`/`Shift+A` vocabulary in a distinct region namespace (never colliding with it), plus `move-down`/`move-up` (`j`/`k`/arrow keys) sharing the board list's own action ids. `bindingAllowedInLayer` scopes the four verbs to the `proposal-tray` layer only (T-05-07-02) and grants `move-down`/`move-up` an additive allowance there. `board/CommandPalette.tsx` excludes all four new action ids from the generated command list — the palette's own selection model has no "selected proposal" concept, so leaving them to fall through to the generic board-list handler would have produced a dead menu entry, the exact defect `return-stage`'s own case was added to avoid in plan 05-03. `ProposalRow.tsx` registers its own `useRegionBindings` call per row, gated on a `selected` prop (mirroring `PermissionRequestCard.tsx`'s `keyboardEnabled`); `ProposalTray.tsx` owns the tray's own selection index via `state/keyboard.ts`'s `nextSelectionId` — an empty tray takes no focus, and a row removed from the list can never stay selected. `proposal-keyboard.test.tsx` (new) proves all of this plus the `Shift+A`-inert cases, the amend editor's own typing-target guard, and — reusing `proposal-tray.test.tsx`'s own render-count-proxy mechanism — that a `board:changed` push never causes the feed's own underlying query (`agent_run_log_window`) to refetch, and that a `proposal_created` log entry never disturbs the status strip's cost/token readings against a control log.

## Task Commits

Each task was committed atomically:

1. **Task 1: The tray's data layer and row anatomy** - `22f2995` (feat)
2. **Task 2: The four verbs, at the row** - `b9aab4e` (feat)
3. **Task 3: The tray's keyboard region, and staying live while the feed streams** - `9dd952f` (feat)

**Plan metadata:** see below.

## Files Created/Modified

- `packages/desktop/src/authoring/useAuthoringQuery.ts` (new) — the one authoring query layer: `useRunProposals`, `useAcceptProposal`, `useRejectProposal`, `useAmendProposal`, `useAcceptSubtree`
- `packages/desktop/src/authoring/ProposalRow.tsx` (new) — one proposed item, one row, with its full four-verb action cluster
- `packages/desktop/src/authoring/ProposalAmendEditor.tsx` (new) — the staged row's field-by-field editor
- `packages/desktop/src/authoring/ProposalTray.tsx` — grouping/nesting, the accept-subtree guard, the tray's own keyboard-driven selection
- `packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx` — extended: 17 tests across row anatomy, the four verbs, and the board:changed/feed isolation boundary
- `packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx` (new) — 8 tests covering the keyboard region
- `packages/desktop/src/board/useBoardQuery.ts` — removed the now-superseded `useAuthoringProposals`/`authoringProposalsQueryKey`
- `packages/desktop/src/board/CommandPalette.tsx` — excludes the tray's four action ids from the generated command list
- `packages/desktop/src/state/keyboard.ts` — the `proposal-tray` region, its four bindings, and `bindingAllowedInLayer`'s gating

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `board/CommandPalette.tsx` needed explicit exclusion cases for the four new proposal-tray action ids**
- **Found during:** Task 3, after adding the four new `ActionId`s to `state/keyboard.ts`
- **Issue:** `CommandPalette.tsx`'s command list is generated from `allActionIds()`, so `accept-proposal`/`reject-proposal`/`amend-proposal`/`accept-proposal-subtree` would appear in the palette automatically via the generic board-list fallback (`runBoardListAction(id)`) — but the palette's own selection model has no "selected proposal" concept, and `bindingAllowedInLayer` gates all four to the `proposal-tray` layer only, so a palette-issued dispatch could never actually reach one. This is the exact dead-menu-entry defect `05-03-SUMMARY.md`'s own Deviations section records fixing for `return-stage`.
- **Fix:** Added a `continue`-only case for the four ids, mirroring `open-palette`'s own continue-without-pushing pattern.
- **Files modified:** `packages/desktop/src/board/CommandPalette.tsx`
- **Verification:** `npm --prefix packages/desktop run build` succeeds; full test suite green.
- **Committed in:** `9dd952f` (Task 3's own commit)

**2. [Rule 1 - Bug] `board/useBoardQuery.ts`'s now-superseded `useAuthoringProposals` hook and query key were left as dead code once `ProposalTray.tsx` moved to `useAuthoringQuery.ts`**
- **Found during:** Task 1, immediately after writing the new query layer
- **Issue:** Leaving both implementations in place would have created two independently-invalidated readers of the same `authoring_proposals_for_run` data — a structural drift risk (the two subscribe to different event sets, per the `board:changed`-only decision above) rather than a convenience, and `ProposalTray.tsx`'s only caller of the old hook was being rewritten anyway.
- **Fix:** Removed `useAuthoringProposals`/`authoringProposalsQueryKey` and the now-unused `authoringProposalsForRun` import from `useBoardQuery.ts`. Confirmed via grep that no other file (including `CommandPalette.tsx`, which only used `startAuthoringSessionForProject` from the same module) referenced either symbol.
- **Files modified:** `packages/desktop/src/board/useBoardQuery.ts`
- **Verification:** `npm --prefix packages/desktop run build` succeeds; full test suite green.
- **Committed in:** `22f2995` (Task 1's own commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs directly caused by this plan's own new symbols reaching pre-existing generic-fallback code paths not designed to expect them). **Impact:** Both are necessary consequences of implementing the plan's own action items as written; neither touches product behaviour beyond what the plan specifies.

## Issues Encountered

None beyond the deviations above. Two testing-technique corrections were made while writing `proposal-tray.test.tsx`/`proposal-keyboard.test.tsx` (not deviations from the plan — internal to getting the tests themselves right): a `vi.spyOn` attempt against the mocked `adapters/tauri` module was replaced with a plain handler-array capture (`boardChangedHandlers`), and raw `element.value =` + `dispatchEvent` input simulation was replaced with `fireEvent.change`/`fireEvent.click` (this codebase's own established pattern, per `settings/__tests__/settings-surface.test.tsx`) after the former failed to trigger React's controlled-input `onChange`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The proposal tray is now fully decidable end to end: every proposed item is its own row, criteria nest under their task, an amend edits staging (never the board), accept-subtree is the one bulk path, and all four verbs are reachable by a single keyboard key scoped to the tray's own selection.
- `SHAPE-03`/`SHAPE-04` are this plan's own declared requirements but are NOT yet marked complete: the shared-ID gate (`requirements.ready-ids`) reports `0/2 requirement(s) ready to mark complete` — both are also declared by plan `05-08` (still in progress). They will flip to `Complete` automatically once every plan declaring them has a `*-SUMMARY.md`.
- `useAuthoringQuery.ts`'s `useRunProposals`/mutation hooks are ready for plan 05-08's board-level triage lane to read directly — no changes needed there beyond importing them.
- `SessionSurface.tsx` needed no code change in this plan; it already mounted `ProposalTray` unconditionally on `authoringStage` since plan 05-02. Only this plan's own test files exercise it, as a harness for the tray/feed isolation and status-strip assertions.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 4 created files found on disk (`useAuthoringQuery.ts`, `ProposalRow.tsx`, `ProposalAmendEditor.tsx`, `proposal-keyboard.test.tsx`).
- All 3 task commit hashes (`22f2995`, `b9aab4e`, `9dd952f`) found in git history.
- `npm --prefix packages/desktop run build` succeeds.
- `npm --prefix packages/desktop run test` — 513/513 pass across 35 files, including `proposal-tray.test.tsx` 17/17 and `proposal-keyboard.test.tsx` 8/8.
- `cargo build --workspace` succeeds (only the one pre-existing, unrelated `StartRunOutcome` dead-code warning); `cargo test --workspace` — 0 failures across every crate.
- Named grep gates: 0 `invoke(` occurrences in `ProposalTray.tsx`/`ProposalRow.tsx`, 0 hex-colour literals in `ProposalTray.tsx`/`ProposalRow.tsx`/`ProposalAmendEditor.tsx`, 0 `AcceptanceCriteriaList`/`ItemDetailPanel` references (comment-stripped) in `ProposalAmendEditor.tsx`, `useRef` present in `ProposalRow.tsx` (4 occurrences), 0 keydown/keyup listeners registered in any tray component file, 14 occurrences of the literal `"proposal-tray"` in `state/keyboard.ts` — all return their expected values.
- `commits: 3` measured via `git rev-list --count 1efbac74ad17a8566b990c83fb03b93e4c924ead..HEAD` (matches `plan_head_before` in frontmatter).
