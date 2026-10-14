---
phase: 01-the-board-is-the-store-of-record
plan: 19
subsystem: ui
tags: [react, zustand, tanstack-virtual, focus-management, virtualization, jsdom]

requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: BoardView's virtualized rack, the layer guard (G-01-1), the epic-roster fix (G-01-2)
provides:
  - A consume-once focus-request mechanism (`quickAddFocusPending`) that survives a virtualized
    row mounting after the keystroke that asked for it
  - A scroll-into-view effect (`virtualizer.scrollToIndex`) that mounts the quick-add row before
    focus is expected, guarded on the request flag rather than on `quickAddOpen`
  - An idempotent `collapseStore.expand` action so opening quick-add can no longer be swallowed by
    a collapsed Backlog band
  - The first test in this repo rendering the board above the virtualizer's overscan window
affects: [any future BoardView.tsx virtualization change, ROW_HEIGHT/overscan/BAND_ORDER changes]

actuals:
  tokens: 8410
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Consume-once request flag on a Zustand store, rather than a ref handle or a
      mount-keyed effect, for focus that must survive both late-mounting (virtualization) and
      re-application (pressing the same shortcut twice)"
    - "jsdom test-setup stub for a DOM API (`Element.prototype.scrollTo`) that
      @tanstack/virtual-core calls optionally — without it a scroll-into-view test passes for the
      wrong reason (silent no-op)"

key-files:
  created:
    - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
  modified:
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/QuickAdd.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/collapseStore.ts
    - packages/desktop/src/test/setup.ts

key-decisions:
  - "A consume-once request flag (`quickAddFocusPending` in state/uiStore.ts) rather than a ref
    handle (fails: row is unmounted at press time, nothing to call focus() on) or a
    quickAddOpen-keyed effect (fails: re-pressing ⌘N while already open sets no new state, so no
    effect re-runs — the owner's literal 'not stealing the focus when re-applied' complaint)"
  - "collapseStore gets a new `expand` action (idempotent, sets false unconditionally) rather than
    reusing `toggle` — a second consecutive ⌘N press must not re-close an already-open band"
  - "The expand-Backlog effect is keyed on `effectiveQuickAddOpen`, not on the focus-request flag,
    so every route that opens quick-add (⌘N, c, palette, native menu, empty-board default) gets a
    band it can appear in; the layer guard upstream already refuses a trapped keystroke before it
    ever sets quickAddOpen"
  - "align: 'auto' for scrollToIndex — the minimum-distance alignment 01-UI-SPEC.md's Focus &
    selection model requires, and deterministic here since the row is always approached from below"

requirements-completed: [BOARD-07, BOARD-08]

coverage:
  - id: D1
    description: "⌘N at volume (60-row board scrolled 1,600px) mounts, scrolls to, and focuses the quick-add row"
    requirement: BOARD-08
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#cmd_n_focuses_quick_add_when_the_row_is_scrolled_out_of_the_mounted_window"
        status: pass
    human_judgment: false
  - id: D2
    description: "⌘⇧N does the identical thing for an epic — the same funnel, not a second implementation"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#cmd_shift_n_focuses_quick_add_for_an_epic_at_volume"
        status: pass
    human_judgment: false
  - id: D3
    description: "⌘N with Backlog collapsed expands exactly that band for exactly that project and then focuses the row"
    requirement: BOARD-08
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#cmd_n_expands_a_collapsed_backlog_band_and_focuses_the_row"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#expanding_backlog_for_quick_add_leaves_every_other_band_alone"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#expand_is_idempotent_and_does_not_toggle_an_already_expanded_band"
        status: pass
    human_judgment: false
  - id: D4
    description: "A re-press of ⌘N while quick-add is open but focus has moved away returns the cursor to the input"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#cmd_n_refocuses_quick_add_when_it_is_already_open_but_focus_moved_away"
        status: pass
    human_judgment: false
  - id: D5
    description: "The focus request is consumed exactly once — a re-mount does not steal focus, an unconsumed request does not survive quick-add closing"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#scrolling_the_row_back_into_view_does_not_steal_focus_a_second_time"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#escaping_quick_add_clears_an_unconsumed_focus_request"
        status: pass
    human_judgment: false
  - id: D6
    description: "A refused ⌘N/⌘⇧N (detail panel or a row-level picker on top) moves nothing — no scroll, no focus, no state change (G-01-1 re-asserted at volume)"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#cmd_n_over_the_detail_panel_scrolls_nothing_and_moves_no_focus"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#a_picker_layer_also_refuses_cmd_n_without_scrolling"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/layer-guard.test.tsx"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/menu-bridge.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "Preserved defaults: empty board still pre-focuses quick-add; the issues lane's quick-add never takes focus on load; no raw internal identifier renders at volume (G-01-2 re-asserted)"
    requirement: BOARD-08
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_empty_board_still_opens_quick_add_pre_focused"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#the_issues_lane_quick_add_never_takes_focus_on_load"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/quick-add-focus.test.tsx#no_row_renders_a_raw_internal_identifier_at_volume"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-10
status: complete
---

# Phase 01 Plan 19: Quick-Add Focus Survives Virtualization Summary

**A consume-once focus request in `state/uiStore.ts` plus a `virtualizer.scrollToIndex` effect replace mount-time `autoFocus`, so ⌘N/⌘⇧N land the cursor in quick-add from any scroll position and any Backlog collapse state — closing UAT gap G-01-4.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-10T05:36:00Z (approx.)
- **Completed:** 2026-09-10T06:11:42Z
- **Tasks:** 3
- **Files modified:** 5 (1 new test file, 4 production files)

## Accomplishments

- `⌘N` pressed on a 60-row board scrolled 1,600px down now mounts the quick-add row, scrolls it
  into view by the minimum distance (`align: "auto"`), and leaves the cursor in its input —
  proven by a test that first asserts the row was genuinely absent (half one of G-01-4: the
  `autoFocus`-only, mount-time focus mechanism).
- `⌘⇧N` does the identical thing for an epic, via the same funnel — not a second implementation.
- Opening quick-add with Backlog collapsed now expands exactly that band for exactly that project
  before focusing the row (half two of G-01-4: `rows`' `if (collapsedByStatus[status]) continue;`
  short-circuit was silently dropping the quick-add row's insertion).
- Pressing ⌘N again while quick-add is open but focus has moved elsewhere re-focuses the input —
  the owner's literal report that the accelerators were "not stealing the focus when re-applied."
- The focus request is provably consumed exactly once: a row that re-mounts because the user
  scrolled back does not steal focus, and closing quick-add before the row mounts does not leave a
  stale request behind.
- G-01-1's layer guard and G-01-2's no-raw-identifier property are both re-asserted at the volume
  this gap exposed, in the same suite, and neither `BoardRow.tsx` nor `App.tsx` was touched by
  this plan.
- The first test in this repo renders the board above the virtualizer's overscan window (60 rows,
  vs. the previous largest fixture's 13) — this class of defect is now reachable under test.

## Task Commits

Each task was committed with its own RED/GREEN pair (both tasks were TDD):

1. **Task 1: End-to-end "⌘N at volume lands the cursor in quick-add"** — `7bb7144` (test, RED), `5b128f2` (feat, GREEN)
2. **Task 2: A collapsed Backlog band can no longer swallow the quick-add row** — `07220e0` (test, RED), `da40a7b` (feat, GREEN)
3. **Task 3: The focus request is honoured exactly once, and never at all when refused** — `a75fe55` (test-only, no production file touched)

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

- `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx` — new; 14 test cases across five
  `describe` groups: the volume tracer, the four collapse cases, the re-press case, the epic
  keystroke, the two consume-once cases, the two refusal cases, and the three preserved-default
  cases.
- `packages/desktop/src/state/uiStore.ts` — `quickAddFocusPending: boolean` field,
  `clearQuickAddFocusPending()` action; `openQuickAdd` now raises the flag, `setQuickAddOpen(false)`
  now clears it, `resetUiState` now resets it.
- `packages/desktop/src/board/QuickAdd.tsx` — `focusPending`/`onFocusHandled` props and the
  `useRef`-backed focus effect that consumes the request; `autoFocus`'s contract narrowed to the
  empty-board mount-time default only.
- `packages/desktop/src/board/BoardView.tsx` — `quickAddRowIndex` memo (derived from `rows`, not
  hard-coded); the scroll-into-view effect (`virtualizer.scrollToIndex`, guarded on the pending
  flag and a non-negative index); the expand-Backlog effect (guarded on `effectiveQuickAddOpen`
  and Backlog being collapsed); `<QuickAdd>`'s render now passes both new props and narrows
  `autoFocus` to `items.length === 0`.
- `packages/desktop/src/board/collapseStore.ts` — `expand(projectId, status)`, the idempotent
  counterpart of `toggle` that sets a band's collapsed value to `false` unconditionally.
- `packages/desktop/src/test/setup.ts` — `Element.prototype.scrollTo` stub; jsdom implements
  `scrollTop` but not `scrollTo`, so `scrollToIndex` was a silent no-op under test without it.

## Decisions Made

- A consume-once request flag on the Zustand store, not a ref handle (fails at press time — the
  row is unmounted, nothing to call `focus()` on) and not a `quickAddOpen`-keyed effect (fails the
  re-press case — no state change on a second press with no new value, so no effect re-runs).
- `collapseStore.expand` is a new, distinct action rather than a reuse of `toggle` — proven
  necessary by `expand_is_idempotent_and_does_not_toggle_an_already_expanded_band`: reusing
  `toggle` would close an already-open band on the second consecutive press.
- The expand-Backlog effect keys on `effectiveQuickAddOpen`, not on the focus-request flag, so
  every route into quick-add (not only ⌘N) gets a band it can appear in.
- `align: "auto"` for `scrollToIndex` — 01-UI-SPEC.md's minimum-distance scroll requirement, and
  deterministic here because the row is always approached from below in this fixture.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] `escaping_quick_add_clears_an_unconsumed_focus_request` rewritten to avoid a flaky intermediate assertion**
- **Found during:** Task 3
- **Issue:** The first draft asserted `quickAddFocusPending === true` immediately after calling
  `openQuickAdd` and scrolling away, before calling `setQuickAddOpen(false)`. In practice, opening
  quick-add itself triggers the scroll-into-view effect, which (in this fixture) scrolls the board
  back near the top and mounts the row in the same React commit — consuming the flag before the
  test's intermediate assertion could observe it `true`. This was a test-authoring bug, not a
  production defect: the effect ordering is correct behavior.
- **Fix:** Batched `openQuickAdd` and `setQuickAddOpen(false)` inside one `act()` call and asserted
  only the end state (`quickAddOpen: false`, `quickAddFocusPending: false`) — still proves a
  stale request cannot survive quick-add closing, without depending on an unobservable
  intermediate render.
- **Files modified:** `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx`
- **Verification:** Full suite green, 14/14 cases in this file pass.
- **Committed in:** `a75fe55` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 test-authoring correction, no production code affected).
**Impact on plan:** None on scope or behavior — the fix corrects a test's own assumption about
effect timing; the contract it proves (`quickAddFocusPending` cannot survive `setQuickAddOpen(false)`)
is exactly what the plan specified.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-01-4 is closed: both independent failure paths (mount-time `autoFocus` on a
  virtualized row; the collapsed-Backlog short-circuit) are fixed, tested at volume, and the two
  prior gaps in this phase (G-01-1's layer guard, G-01-2's no-raw-identifier property) are
  re-verified in the same suite rather than assumed still-correct.
- `01-UAT.md` test 2 (perceived lag at 1,000+ items) is still the owner's to re-run manually — not
  planned as an executable task here, per 01-VERIFICATION.md's reasoning that running it before
  the fix conflates "lag" with the defect under repair.
- No blockers for the next plan in this phase or for milestone completion.

## Self-Check: PASSED

- All 6 key files (5 modified + 1 created) verified present on disk.
- All 5 commits (`7bb7144`, `5b128f2`, `07220e0`, `da40a7b`, `a75fe55`) verified in `git log`.
- All 14 test cases in `quick-add-focus.test.tsx` re-verified passing; `layer-guard.test.tsx` (12),
  `menu-bridge.test.tsx` (17), `epic-roster.test.tsx` + `epic-assign.test.tsx` (28), and the full
  desktop suite (141) re-verified green.
- `npm --prefix packages/desktop run build` re-verified clean (no `error TS`).
- All plan-level `<verification>` grep gates re-verified: `scrollToIndex` ≥1 in `BoardView.tsx`,
  `returnToBoardLayer` = 0 in `App.tsx`, `epicUnresolvedMark` ≥1 in `BoardRow.tsx`.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-10*
