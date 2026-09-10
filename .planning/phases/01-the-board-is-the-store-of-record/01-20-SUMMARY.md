---
phase: 01-the-board-is-the-store-of-record
plan: 20
subsystem: testing
tags: [vitest, tanstack-virtual, focus-management, virtualization, jsdom, documentation]

requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: Plan 01-19's quick-add focus fix (consume-once request + scroll-into-view + Backlog
      auto-expand) — this plan hardens it, it does not change it.
provides:
  - A shared, named, self-checking volume fixture (`packages/desktop/src/board/__tests__/volume.ts`)
    that any future desktop test needing to exceed the virtualizer's mounted window can reuse
    instead of rebuilding one from scratch
  - Proof that G-01-4's fix holds on the real forwarded `menu:action` path — the one macOS
    actually takes for ⌘N — at a volume where the target row is not mounted, not only on a
    synthesized webview keydown
  - A documented focus-delivery contract in `01-UI-SPEC.md` so a future refactor of `BoardView`'s
    virtualization has a promise to keep, not an implementation detail to silently discard
affects: [any future BoardView.tsx virtualization change, any future test needing a fixture larger
  than the virtualizer's mounted window]

actuals:
  tokens: 6998
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A shared, self-checking test fixture whose adequacy is asserted by a dedicated test case
      (comparing the fixture size against a value computed from named constants) rather than
      trusted from a comment — so drift in the constants a fixture's adequacy depends on
      (ROW_HEIGHT, overscan, jsdom viewport height) fails the fixture's own self-check instead of
      silently shrinking the suite's effective coverage."
    - "Driving a regression test through the real captured native-bridge handler
      (`emitMenuAction`, `menu-bridge.test.tsx`'s existing pattern) rather than a synthesized
      keydown, extended to volume rather than only to the single-row case that shipped green
      before."

key-files:
  created:
    - packages/desktop/src/board/__tests__/volume.ts
  modified:
    - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
    - packages/desktop/src/board/__tests__/menu-bridge.test.tsx
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "MOUNTABLE_ROW_ESTIMATE is computed from three named local constants (jsdom viewport height,
    ROW_HEIGHT, overscan), each commented with the exact file/line it mirrors, rather than any of
    the three being imported cross-module — matches the plan's literal instruction ('named local
    constants') and keeps volume.ts's only real dependency on production code to the BoardItem
    type."
  - "DEEP_SCROLL_OFFSET is derived from MOUNTABLE_ROW_ESTIMATE plus a safety margin, converted to
    pixels, then clamped below an estimated total scrollable height (band headers + quick-add row
    + item rows) — never hard-coded, and never asking the virtualizer to scroll past its own
    content."
  - "buildVolumeItems assigns each row a 26-character Crockford base32 identifier (ULID-shaped)
    rather than short ids like the fixture it replaces used — a fixture built from short ids could
    never match plan 01-19's raw-identifier leak scan, making that assertion vacuous regardless of
    whether a real leak existed."
  - "The at-volume board_list mock in menu-bridge.test.tsx is installed per-case
    (installVolumeBoardMock), never in the shared beforeEach, so the file's 17 pre-existing cases
    keep their original single-row fixture unchanged in both size and behavior."

requirements-completed: [BOARD-07, BOARD-08]

coverage:
  - id: D1
    description: "The desktop suite has one named, shared, self-checking volume fixture — the suite fails on its own self-check if the fixture ever stops exceeding the virtualizer's mounted window"
    requirement: BOARD-08
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_volume_fixture_exceeds_what_the_harness_can_mount"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_quick_add_row_is_genuinely_unmounted_at_the_deep_scroll_offset"
        status: pass
    human_judgment: false
  - id: D2
    description: "The forwarded menu:action path (what macOS actually takes for ⌘N/⌘⇧N) lands the cursor in quick-add at volume, for both the task and the epic id"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/menu-bridge.test.tsx#create_task_at_volume_lands_the_cursor_in_quick_add"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/menu-bridge.test.tsx#create_epic_at_volume_lands_the_cursor_in_the_epic_quick_add"
        status: pass
    human_judgment: false
  - id: D3
    description: "The forwarded path at volume stays wholly inert over the detail panel — panel stays open, quickAddOpen stays false, scroll offset and document.activeElement both unchanged (G-01-1 re-proven at the volume that broke G-01-2 and G-01-4)"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/menu-bridge.test.tsx#create_task_at_volume_over_the_detail_panel_still_does_nothing_at_all"
        status: pass
    human_judgment: false
  - id: D4
    description: "A second forwarded create-task after focus moved away returns the cursor to the input — the owner's literal re-press wording, proven on the forwarded path"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/menu-bridge.test.tsx#a_second_create_task_at_volume_returns_the_cursor_to_the_input"
        status: pass
    human_judgment: false
  - id: D5
    description: "Plan 01-19's production fix is still intact under this plan's own grep gates: scrollToIndex in BoardView.tsx, quickAddFocusPending wired through uiStore.ts, no returnToBoardLayer in App.tsx — this hardening plan did not reopen a closed fix"
    requirement: BOARD-08
    verification:
      - kind: other
        ref: "grep gates in 01-20-PLAN.md Tasks 1 and 2 (scrollToIndex >=1, quickAddFocusPending >=4, returnToBoardLayer =0)"
        status: pass
    human_judgment: false
  - id: D6
    description: "01-UI-SPEC.md records the focus-delivery mechanism, the Backlog-expansion guarantee, the one allowed programmatic scroll, the new overflow consideration, and the volume lesson — each attributed to plan 01-20 (G-01-4)"
    requirement: BOARD-07
    verification:
      - kind: other
        ref: "grep gates in 01-20-PLAN.md Task 3 (G-01-4 count >=4, volume.ts named, new UI Considerations row present exactly once, pre-focused row intact)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The owner has driven ⌘N, ⌘⇧N, the re-press, the collapsed-band case and the refusal case on the real seeded 1,067-item board with the mouse untouched"
    requirement: BOARD-07
    verification: []
    human_judgment: true
    rationale: "This is a native macOS Tauri GUI walkthrough requiring visual judgment (cursor placement, absence of visual jank/thrash) and physical keyboard interaction with a live app window — not observable or executable by this automated executor. Deferred to the owner per workflow.human_verify_mode: end-of-phase (01-20-PLAN.md's own precondition scopes this explicitly to 'the owner walkthrough,' and 01-19-SUMMARY.md set the precedent of deferring the phase's remaining owner-only UAT item the same way). The seeded database (~/Library/Application Support/Flywheel/flywheel.db) was confirmed present on this machine before execution; the walkthrough itself was not run."

duration: 25min
completed: 2026-09-10
status: complete
---

# Phase 01 Plan 20: Volume Fixture, Forwarded-Path Proof, and UI-SPEC Contract for G-01-4 Summary

**A shared, self-checking `volume.ts` fixture replaces the inline 60-row fixture in
`quick-add-focus.test.tsx`, `menu-bridge.test.tsx` gains four cases proving plan 01-19's fix on the
real forwarded native-accelerator path at volume, and `01-UI-SPEC.md` now documents how ⌘N's
"focused" promise is actually kept — turning a symptom fix into a durable, attributed contract.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-10T14:20:00Z (approx.)
- **Completed:** 2026-09-10T14:45:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 4 (1 new test-helper module, 3 modified: 2 test files, 1 planning document)

## Accomplishments

- `packages/desktop/src/board/__tests__/volume.ts` is now the one fixture in the desktop suite
  large enough to leave `BoardView.tsx`'s virtualizer mounted window, and its adequacy is
  asserted rather than assumed: `MOUNTABLE_ROW_ESTIMATE` is computed from three named local
  constants (jsdom viewport height, `ROW_HEIGHT`, `overscan`), each commented with the exact file
  it mirrors, and a self-check case fails the suite the moment `VOLUME_ROW_COUNT`'s 20-row margin
  over that estimate erodes.
- `quick-add-focus.test.tsx`'s inline fixture, row count and scroll-and-fire helper are replaced
  by the shared module — no existing case's assertions, names or grouping changed — and the suite
  gained two self-check cases (16 total, up from 14).
- `menu-bridge.test.tsx` — the only suite driving the real captured `menu:action` handler rather
  than a synthesized keydown — gained a "menu-bridge at volume (G-01-4)" group with four cases,
  all driven through the existing `emitMenuAction` helper against the shared volume fixture
  instead of the single-row `ITEMS`: `create-task` and `create-epic` both land the cursor in
  quick-add from a deep scroll offset; a forwarded `create-task`/`create-epic` pair over an open
  detail panel changes nothing at all (panel state, `quickAddOpen`, scroll offset and
  `document.activeElement` all unchanged); a second forwarded `create-task` after focus moved away
  returns the cursor to the input. 21 cases total (up from 17), and all 17 pre-existing cases kept
  their original single-row fixture untouched.
- `01-UI-SPEC.md` gained four scoped, attributed amendments: a "Focus & selection model" block
  naming the focus-delivery mechanism and its refusal clause as a hard requirement; a "Quick-add
  (D-09)" bullet recording the Backlog-expansion guarantee; a "Performance Contract" clause naming
  the renderer's one allowed programmatic scroll (index-addressed, never item-id-addressed); and a
  new "UI Considerations" row for the quick-add-row-at-overflow-volume state, with the existing
  `board list, 1,000+ items` row's resolution text amended to note its original claim covered
  rendering, not off-window focus. A volume-lesson paragraph names G-01-2, G-01-4 and the shared
  `volume.ts` fixture for the next planner.
- Plan 01-19's production fix is unmoved: `BoardView.tsx` still has an executable `scrollToIndex`
  call, `uiStore.ts` still wires `quickAddFocusPending` through at least four executable lines, and
  `App.tsx` still has zero executable calls to the bridge helper G-01-1 removed. This plan's
  `files_modified` contains no production source file — verified: every commit below touches only
  test files, a test-helper module, or a planning document.

## Task Commits

Each task was committed as a single atomic commit — Tasks 1 and 2 are test-only (no production
file touched, matching plan 01-19's own precedent for a task with no production change) and Task 3
is documentation-only:

1. **Task 1: A named volume fixture whose adequacy is asserted, not assumed** — `e138fcb` (test)
2. **Task 2: Prove the fix on the path macOS actually takes — a forwarded menu accelerator, at volume** — `00e9160` (test)
3. **Task 3: Record the focus-delivery contract, the one allowed programmatic scroll, and the volume lesson in 01-UI-SPEC.md** — `49d8bab` (docs)

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

- `packages/desktop/src/board/__tests__/volume.ts` — new; exports `MOUNTABLE_ROW_ESTIMATE`,
  `VOLUME_ROW_COUNT` (60), `buildVolumeItems`, `DEEP_SCROLL_OFFSET`, `scrollBoardTo`.
- `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx` — re-points its fixture at
  `volume.ts`; gains `the_volume_fixture_exceeds_what_the_harness_can_mount` and
  `the_quick_add_row_is_genuinely_unmounted_at_the_deep_scroll_offset` as a new first
  `describe` block; every other case's assertions unchanged.
- `packages/desktop/src/board/__tests__/menu-bridge.test.tsx` — gains `VOLUME_ITEMS`,
  `installVolumeBoardMock`, `scrollBoardToDeepOffset`, and the "menu-bridge at volume (G-01-4)"
  `describe` block with four cases; the shared `beforeEach` and all 17 pre-existing cases
  unchanged.
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — four scoped amendments
  (Focus & selection model, Quick-add (D-09), Performance Contract, UI Considerations) plus the
  volume-lesson paragraph, each attributed to plan `01-20` (G-01-4).

## Decisions Made

- `MOUNTABLE_ROW_ESTIMATE`'s three inputs are named local constants inside `volume.ts`, not
  imports from `BoardRow.tsx`/`BoardView.tsx`/`test/setup.ts` — matches the plan's literal
  instruction and keeps the module's only production dependency to the `BoardItem` type.
- `DEEP_SCROLL_OFFSET` is derived (from `MOUNTABLE_ROW_ESTIMATE` plus a safety margin, in pixels)
  and clamped below an estimated total row count (band headers + quick-add row + items) rather
  than hard-coded — this reproduces the existing `1600`-offset test behavior almost exactly
  (computes to `1840` given the current constants, vs. the prior literal `1600`) while making the
  relationship explicit and self-adjusting.
- `buildVolumeItems` uses 26-character Crockford base32 ids (ULID-shaped) rather than the
  short `task-${i}` ids the fixture it replaces used, so the existing raw-identifier leak scan
  (`no_row_renders_a_raw_internal_identifier_at_volume`, G-01-2) is a real assertion against this
  fixture rather than a vacuous one.
- The at-volume `board_list` mock in `menu-bridge.test.tsx` is installed per-case rather than in
  the shared `beforeEach`, preserving every pre-existing case's original fixture and behavior
  exactly.

## Deviations from Plan

None — plan executed exactly as written. All automated `<verify>` gates across all three tasks
passed on the first run with no fix-forward needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Human Verification — Deferred to the Owner

Task 3's `<human-check>` (a live walkthrough on `npm --prefix packages/desktop run tauri dev`
against the real seeded 1,067-item / 13-epic THRE project) was **not** run by this executor. This
is a native macOS Tauri GUI walkthrough requiring physical keyboard interaction with a live app
window and visual judgment (cursor placement, absence of jank/thrash) — outside what an automated
executor can observe or perform, and explicitly scoped in the plan's own `<precondition>` as "the
owner walkthrough." This follows the same precedent 01-19-SUMMARY.md set for `01-UAT.md` test 2
(the phase's other outstanding owner-only item), and matches `workflow.human_verify_mode:
end-of-phase` (the project's configured default): a `<human-check>` embedded in a `type="auto"`
task's `<verify>` is harvested at end-of-phase UAT rather than executed mid-flight.

**Precondition status (verified, read-only):** this machine is macOS (darwin) and the seeded
database exists at `~/Library/Application Support/Flywheel/flywheel.db` (confirmed present,
2.4MB, last modified during this session) — the walkthrough is runnable here whenever the owner
performs it. Every automated gate in this plan ran and passed without either.

The walkthrough steps (01-20-PLAN.md Task 3's `<human-check>`, steps 1-7: scroll deep, ⌘N lands
the cursor with no click/Tab, ⌘⇧N does the same for an epic, re-press returns focus after a click
elsewhere, a collapsed Backlog expands and focuses, the detail panel refuses all three bindings
without scrolling, and no visual jank during any of the above) remain open for the owner to run
and report against. **Not part of this check:** `01-UAT.md` test 2 (perceived lag at 1,000+ items)
stays separately open, unaffected by this plan.

## Next Phase Readiness

- G-01-4 is now hardened, not just fixed: the desktop suite has a shared, self-checking volume
  fixture; the real forwarded native-accelerator path is proven at volume for both the task and
  epic ids, over the detail panel, and on re-press; and `01-UI-SPEC.md` records the mechanism as a
  contract a future virtualization refactor must keep.
- Two open owner-only items remain from this phase, both explicitly deferred rather than silently
  dropped: `01-UAT.md` test 2 (perceived lag at 1,000+ items) and this plan's Task 3
  `<human-check>` walkthrough on the real seeded board. Neither blocks this plan's own completion;
  both should be run together by the owner, since they touch the same seeded project.
- BOARD-07 and BOARD-08 are the last requirements this gap-closure round declares; per this
  plan's own scoping note, this is the last plan declaring either, so both are eligible to be
  marked complete in `REQUIREMENTS.md` by the shared-ID gate.
- No blockers for the next plan in this phase or for milestone completion.

## Self-Check: PASSED

- All 4 key files (1 created + 3 modified) verified present on disk.
- All 3 commits (`e138fcb`, `00e9160`, `49d8bab`) verified in `git log`.
- `quick-add-focus.test.tsx` re-verified: 16/16 passing. `menu-bridge.test.tsx` re-verified:
  21/21 passing. `layer-guard.test.tsx` + `epic-roster.test.tsx` (G-01-1/G-01-2 regression
  coverage) re-verified: 33/33 passing. Full desktop suite re-verified: 147/147 passing.
- `npm --prefix packages/desktop run build` re-verified clean (no `error TS`).
- `cargo test --workspace` re-verified: all test binaries report `test result: ok`, zero `FAILED`
  lines.
- All plan-level grep gates re-verified: `volume.ts` exports ≥5 named symbols; `VOLUME_ROW_COUNT`
  referenced in `quick-add-focus.test.tsx`; `scrollToIndex` ≥1 in `BoardView.tsx`;
  `quickAddFocusPending` ≥4 executable lines in `uiStore.ts`; `emitMenuAction` ≥14 occurrences and
  `buildVolumeItems` ≥1 occurrence in `menu-bridge.test.tsx`; `returnToBoardLayer` = 0 in
  `App.tsx`; `G-01-4` ≥4 (actually 7) occurrences, `volume.ts` ≥1, the new UI Considerations row
  exactly once, and `Quick-add is pre-focused` still present in `01-UI-SPEC.md`.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-10*
