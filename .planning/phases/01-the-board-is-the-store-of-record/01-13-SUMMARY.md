---
phase: 01-the-board-is-the-store-of-record
plan: 13
subsystem: ui
tags: [react, zustand, radix-focus-scope, keyboard, focus-management]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: >
      state/uiStore.ts's paletteOpen/detailItemId/deleteTarget and state/keyboard.ts's
      BINDINGS/resolveBinding/nextEscapeLayer/useGlobalBindings (01-09), and
      item-detail/ItemDetailPanel.tsx's FocusScope-trapped panel (01-09/01-10)
provides:
  - "state/keyboard.ts: UiLayer, LayerState, topLayer(), bindingAllowedInLayer(), returnToBoardLayer() — the single fire/do-not-fire decision every consumer of useGlobalBindings and the board-list container now shares"
  - "state/uiStore.ts: the complete layer stack (paletteOpen, detailItemId, deleteTarget, activePicker, quickAddOpen, quickAddKind, pendingDone) plus PickerKind, PendingDone and resetUiState()"
  - "item-detail/ItemDetailPanel.tsx: an optional trapped prop so the palette can render over the panel without two trapped FocusScopes fighting for focus"
  - "board/__tests__/layer-guard.test.tsx: regression coverage for every G-01-FOCUS instance"
affects: ["01-14 (epic-picker layer)", "01-15", "any future surface that opens over the board or the item detail panel"]

# Actuals (#2632)
actuals:
  tokens: 12795
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One pure layer model (topLayer/bindingAllowedInLayer) consulted by every useGlobalBindings consumer AND the board-list container's own key handler, instead of per-consumer detail-panel guards"
    - "Layer state read via useUiStore.getState() inside the window keydown listener at event time, never captured in a stale effect closure"
    - "A region-changing action calls returnToBoardLayer() before dispatching a synthesized keystroke, so the layer guard admits it instead of dropping it"

key-files:
  created:
    - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/item-detail/ActivityTrail.tsx
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/__tests__/keyboard-nav.test.tsx
    - packages/desktop/src/board/__tests__/palette.test.tsx
    - packages/desktop/src/board/__tests__/filter.test.tsx
    - packages/desktop/src/projects/__tests__/project-rail.test.tsx

key-decisions:
  - "The layer stack fields moved wholesale into uiStore.ts (activePicker, quickAddOpen, quickAddKind, pendingDone) so one module can answer 'what layer is on top' — pickerAnchor stayed BoardView-local since it is screen geometry, not layer state"
  - "bindingAllowedInLayer has exactly two rules: open-palette is allowed everywhere except picker/palette; every other action id is allowed only in board/quick-add — no per-action exception list"
  - "EscapeLadderState now extends LayerState (a type-level change only) so the Escape ladder and the new guard are provably the same subject read two ways"
  - "pendingDone (the Done warning) counts toward pickerOpen in BOTH the layer guard and the Escape ladder, since DoneWarning already owns its own Enter/Escape the same way a real picker does"
  - "create-task/create-epic call closeToBoard() BEFORE dispatchAction — Zustand's set is synchronous, so the synthesized keydown reaches the window listener already on the board layer instead of being dropped by the new guard"

requirements-completed: [BOARD-07]

coverage:
  - id: D1
    description: "Global shortcuts (Cmd-N, Cmd-Shift-N, Cmd-F, bare /, Cmd-1..9, Cmd-Shift-O) are inert while the item detail panel, a row-level picker, the delete confirmation, or the Done warning is open"
    requirement: BOARD-07
    verification:
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_n_and_cmd_shift_n_do_not_open_quick_add_over_the_detail_panel"
        status: pass
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_f_and_bare_slash_do_not_steal_focus_from_the_detail_panel"
        status: pass
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_1_does_not_switch_project_over_the_detail_panel"
        status: pass
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_shift_o_does_not_open_the_folder_dialog_over_the_detail_panel"
        status: pass
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_k_does_not_open_the_palette_over_a_row_level_picker"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cmd-K still opens the command palette from the board, from quick-add, and from the item detail panel, landing focus in the palette's own input, with the panel staying open behind it (no two trapped FocusScopes at once)"
    requirement: BOARD-07
    verification:
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#cmd_k_still_opens_the_palette_over_the_detail_panel_with_focus_in_its_own_input"
        status: pass
    human_judgment: false
  - id: D3
    description: "A region-changing palette command (Create Task) returns to the board layer first, so it is not silently dropped by the new guard"
    verification:
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#running_create_task_from_the_palette_closes_the_detail_panel_and_opens_quick_add"
        status: pass
    human_judgment: false
  - id: D4
    description: "With nothing open, every global binding still fires exactly as it did before (Cmd-N, Cmd-F, Cmd-1 baseline)"
    verification:
      - kind: integration
        ref: "board/__tests__/layer-guard.test.tsx#with_nothing_open_every_global_binding_still_fires"
        status: pass
    human_judgment: false
  - id: D5
    description: "The pure layer model (topLayer, bindingAllowedInLayer) implements the documented fixed precedence order and the two-rule guard, independent of any component wiring"
    verification:
      - kind: unit
        ref: "board/__tests__/layer-guard.test.tsx#topLayer_returns_the_fixed_precedence_order"
        status: pass
      - kind: unit
        ref: "board/__tests__/layer-guard.test.tsx#bindingAllowedInLayer_admits_open_palette_everywhere_except_picker_and_palette_and_refuses_every_other_action_outside_board_and_quick_add"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 13: Layer-Gated Global Keyboard Bindings Summary

**A single `bindingAllowedInLayer`/`topLayer` guard in `state/keyboard.ts` now decides whether any global keystroke may fire, replacing five independent places that never checked whether a trapped surface was on top.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-09T13:32:00Z
- **Completed:** 2026-09-09T13:52:00Z
- **Tasks:** 3
- **Files modified:** 12 (1 created, 11 modified)

## Accomplishments

- `state/uiStore.ts` now holds the complete UI layer stack — `paletteOpen`, `detailItemId`,
  `deleteTarget` (pre-existing) plus `activePicker`, `quickAddOpen`, `quickAddKind`, `pendingDone`
  (moved out of `BoardView`-local `useState`) — with `PickerKind`, `PendingDone` exported and a
  single `resetUiState()` test reset.
- `state/keyboard.ts` gained a pure layer model beside the Escape ladder: `UiLayer`, `LayerState`,
  `topLayer()`, `bindingAllowedInLayer()`, and `returnToBoardLayer()`. `EscapeLadderState` now
  extends `LayerState` — the ladder and the new guard are the same subject read two ways.
- `useGlobalBindings` consults `bindingAllowedInLayer(binding.id, topLayer(currentLayerState()))`
  before calling any handler, reading the store at keystroke time (never a stale closure) — this
  is the ONE place "may this fire" is decided for every global binding.
- `BoardView.tsx`'s board-list container (`handleContainerKeyDown`) and its Escape-ladder effect
  read the same layer decision, replacing the old three-field hand-rolled guard with the shared
  one — a strict superset (board-list keys now also stand down under an open palette and the Done
  warning, which the old check missed).
- `ItemDetailPanel.tsx` takes an optional `trapped` prop; `BoardView` passes
  `trapped={!paletteOpen}` so the palette can render over the panel without two trapped
  `FocusScope`s fighting for focus.
- `CommandPalette.tsx`'s region-changing commands (project switch, `focus-search`,
  `register-project`, `create-task`/`create-epic`, the four `filter-*` ids) call a new
  `closeToBoard()` (wrapping `returnToBoardLayer()`) instead of plain `close()`, so they are not
  silently dropped by the new guard. `create-task`/`create-epic` call it BEFORE `dispatchAction` —
  ordering that matters because Zustand's `set` is synchronous.
- `App.tsx`'s native-menu bridge calls `returnToBoardLayer()` before dispatching every forwarded
  menu action except `open-palette`.
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` (new): 10 tests covering every
  G-01-FOCUS instance plus the pure layer model, using two small probe components
  (`ProjectSwitcherProbe`, `RegisterProjectProbe`) that re-register `App.tsx`'s exact
  `switch-project`/`register-project` handlers over the exported `useGlobalBindings` hook — proving
  the SHARED guard blocks them, not merely that no consumer is listening.

## Task Commits

Each task was committed atomically:

1. **Task 1: Move the whole layer stack into uiStore and add the pure layer model beside the Escape ladder** - `8867ff1` (feat)
2. **Task 2: Gate every keystroke on the layer model, release the panel's trap under the palette, and return region-changing palette commands to the board** - `1b2a078` (feat)
3. **Task 3: Regression tests for every UAT instance, and pointing the existing suites at the shared reset** - `301fbee` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md)

## Files Created/Modified

- `packages/desktop/src/state/keyboard.ts` - `UiLayer`, `LayerState`, `topLayer`,
  `bindingAllowedInLayer`, `currentLayerState` (private), `returnToBoardLayer`; `useGlobalBindings`
  now layer-gated; `EscapeLadderState extends LayerState`
- `packages/desktop/src/state/uiStore.ts` - `PickerKind`, `PendingDone`, `activePicker`,
  `quickAddOpen`, `quickAddKind`, `pendingDone` fields + setters + `openQuickAdd`; `resetUiState()`
- `packages/desktop/src/board/BoardView.tsx` - layer `useState`s replaced with store subscriptions;
  `handleContainerKeyDown` and the Escape-ladder effect use the shared layer decision; passes
  `trapped={!paletteOpen}` to `ItemDetailPanel`
- `packages/desktop/src/board/CommandPalette.tsx` - `closeToBoard()` used by every region-changing
  command
- `packages/desktop/src/item-detail/ItemDetailPanel.tsx` - optional `trapped` prop (default `true`)
- `packages/desktop/src/item-detail/ActivityTrail.tsx` - `queryFn`/`getNextPageParam` hardened
  against a non-array page (deviation, see below)
- `packages/desktop/src/App.tsx` - menu bridge calls `returnToBoardLayer()` before dispatching
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` - new regression suite (10 tests)
- `packages/desktop/src/board/__tests__/keyboard-nav.test.tsx`,
  `packages/desktop/src/board/__tests__/palette.test.tsx`,
  `packages/desktop/src/board/__tests__/filter.test.tsx`,
  `packages/desktop/src/projects/__tests__/project-rail.test.tsx` - hand-written resets replaced
  with `resetUiState()`

## Decisions Made

See `key-decisions` in the frontmatter above. The two load-bearing ones for future plans (01-14
extends this layer model with an epic-picker layer):

- `PickerKind` now lives in `state/uiStore.ts` as `"status" | "priority" | "estimate" | "assignee"`
  — 01-14 extends this union, it does not re-derive it.
- `LayerState` is exactly `{ paletteOpen: boolean; detailOpen: boolean; pickerOpen: boolean;
  quickAddOpen: boolean }`, mapped from the store by the module-private `currentLayerState()` in
  `state/keyboard.ts`. `pickerOpen` is `activePicker !== null || deleteTarget !== null ||
  pendingDone !== null` — any future picker-like layer (01-14's epic picker) folds into this same
  boolean rather than adding a new `LayerState` field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Hardened `ActivityTrail.tsx`'s `useInfiniteQuery` against a non-array page**
- **Found during:** Task 2 (verifying the full test suite after wiring `BoardView` to subscribe to
  `paletteOpen`)
- **Issue:** `BoardView` now subscribes to `paletteOpen` (needed so `trapped={!paletteOpen}`
  re-renders `ItemDetailPanel` when the palette opens/closes), which shifted the render timing
  enough to expose a pre-existing crash: if `events_activity_trail` ever resolves to a non-array
  value (a malformed IPC reply, or an unmocked test command resolving to `undefined`),
  `getNextPageParam`'s `lastPage.length` throws, and the render loop's `newestFirst.map` then
  indexes into an `undefined` array element. This crashed `keyboard-nav.test.tsx`'s
  `escape_closes_one_layer_per_press` (a pre-existing test, not new) once the timing shift let the
  mocked `undefined` reply actually reach a render.
- **Fix:** `queryFn` now coerces the IPC result with `?? []`; `getNextPageParam` optional-chains
  `lastPage?.length` as defense in depth.
- **Files modified:** `packages/desktop/src/item-detail/ActivityTrail.tsx`
- **Verification:** `npm --prefix packages/desktop run test` — all 57 pre-existing tests plus the
  10 new `layer-guard` tests pass (67/67).
- **Committed in:** `1b2a078` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — the crash was reachable in production (a
malformed/empty IPC reply), not just a test artifact. No scope creep beyond the one query hook.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-01-FOCUS is closed: the layer model is the single source of truth for "may this keystroke
  fire," consulted by every `useGlobalBindings` consumer and the board-list container.
- 01-14 (epic-picker layer) can extend `PickerKind` and fold its new picker into the existing
  `pickerOpen` boolean without touching `topLayer`/`bindingAllowedInLayer`'s fixed order.
- No blockers.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` FOUND (created, exists on disk)
- `packages/desktop/src/state/keyboard.ts` FOUND, exports `UiLayer`, `LayerState`, `topLayer`,
  `bindingAllowedInLayer`, `returnToBoardLayer` — confirmed via build/typecheck and direct imports
  in `layer-guard.test.tsx`
- `packages/desktop/src/state/uiStore.ts` FOUND, exports `PickerKind`, `PendingDone`,
  `resetUiState` — confirmed via build/typecheck and direct imports in four test files
- Commit `8867ff1` FOUND in `git log --oneline --all`
- Commit `1b2a078` FOUND in `git log --oneline --all`
- Commit `301fbee` FOUND in `git log --oneline --all`
- `npm --prefix packages/desktop run build` — PASSED (tsc + vite build)
- `npm --prefix packages/desktop run test` — PASSED (14 files, 67 tests, 0 failed)
- `cargo test --workspace` — PASSED (untouched by this plan, all suites green)
- All 9 `<behavior>` bullets from Task 3 have a named test in `layer-guard.test.tsx`
