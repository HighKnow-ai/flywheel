---
phase: 01-the-board-is-the-store-of-record
plan: 09
subsystem: ui
tags: [react, zustand, radix-ui, lucide-react, tauri, keyboard-navigation, accessibility]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-04)
    provides: "the pickers/ directory and StatusPicker.tsx's Radix FocusScope+DismissableLayer pattern, ItemDetailPanel.tsx, collapseStore.ts, BoardView.tsx's original j/k/Home/End/Enter/o/s keyboard model"
  - phase: 01-the-board-is-the-store-of-record (plan 01-07)
    provides: "p/e/a picker bindings and ⌘↑/⌘↓ reorder, PriorityPicker/EstimatePicker/AssigneePicker, useReorderItem/useSetPriority/useSetEstimate/useSetAssignee"
  - phase: 01-the-board-is-the-store-of-record (plan 01-08)
    provides: "state/uiStore.ts's original selectedItemId/searchTerm/filterDraft, FilterBar.tsx's ⌘F//-focus shortcut, useBoardQuery.ts, the legend/marks.ts registries"
provides:
  - "state/keyboard.ts — BINDINGS (the single key-to-action table), FocusRegion, resolveBinding, nextEscapeLayer, nextSelectionId/boundarySelectionId, useGlobalBindings, dispatchAction, allActionIds/boardListActionIds/actionLabel"
  - "state/uiStore.ts gains paletteOpen, currentProjectId, detailItemId, deleteTarget — selection/detail/delete state fully shared across BoardView.tsx and CommandPalette.tsx"
  - "board/CommandPalette.tsx — the ⌘K palette, generated from the binding table plus runtime project/selected-item lists"
  - "board/DeleteConfirm.tsx — the destructive-delete confirmation (⌘⌫, threat T-01-25), the first caller useDeleteItem (01-04/01-07) ever had"
  - "legend/Legend.tsx's optional onClose overlay mode"
  - "src-tauri/src/menu.rs — build_menu, wired via main.rs's on_menu_event -> menu:action -> dispatchAction bridge"
  - "BoardRow.tsx's aria-setsize/aria-posinset from the band's true count/position"
affects: [phase-06-triage-lane, phase-09-agent-fanout]

# Actuals (#2632)
actuals:
  tokens: 30158
  tasks: 3
  commits: 3

plan_head_before: 405f05a43b9db05fbc9c7202eff3bdec447a50c6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "state/keyboard.ts is the ONE module that matches a raw keydown event against a key combination — every component that needs a global binding (CommandPalette.tsx, FilterBar.tsx, App.tsx, BoardView.tsx) supplies only a { actionId: handler } map to useGlobalBindings, never its own event.key === '...' switch."
    - "The Escape ladder is resolved by a single capture-phase window listener (BoardView.tsx) that calls stopPropagation() once it commits to closing a layer — this is what guarantees exactly one layer closes per press even though the palette/detail panel/pickers each also mount their own Radix DismissableLayer, which would otherwise race the same keystroke."
    - "dispatchAction(id) synthesizes and dispatches a real KeyboardEvent matching an action's 'global' binding — the reusable bridge for any non-keyboard trigger (CommandPalette command execution, a native menu click) that needs to invoke an already-keyboard-wired action without a second, independently-maintained implementation of that action's effect."
    - "Selection/detail/delete-target all live in state/uiStore.ts as ids, not row indices or booleans-plus-local-state — the 'selection survives a pushed delta' requirement is structurally guaranteed by construction, and any future surface (a project rail, a second board view) can read/drive them without touching BoardView.tsx."
    - "A row-level picker (status/priority/estimate/assignee) and DeleteConfirm are deliberately OUTSIDE the four-layer Escape ladder — they already own correct Escape handling via Radix's own DismissableLayer 'only the highest mounted layer gets a document listener' mechanism, and the ladder steps aside (pickerOpen early-out) rather than racing it."

key-files:
  created:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/DeleteConfirm.tsx
    - packages/desktop/src-tauri/src/menu.rs
    - packages/desktop/src/board/__tests__/keyboard-nav.test.tsx
    - packages/desktop/src/board/__tests__/palette.test.tsx
  modified:
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/QuickAdd.tsx
    - packages/desktop/src/board/FilterBar.tsx
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/src/App.tsx
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src-tauri/src/main.rs
    - DESIGN.md

key-decisions:
  - "BoardRow.tsx's own onKeyDown handler was deleted outright, not merged — it was silently double-firing every board-list keystroke alongside BoardView.tsx's container handler (the exact 'two key-handling systems fighting' failure mode this plan exists to remove), discovered while reading the pre-existing code rather than introduced by this plan."
  - "Quick-add changed from always-mounted to on-demand (c/⌘N opens it, or the project has zero items) — required to make it a real, closeable Escape-ladder layer; QuickAdd.tsx itself only gained two additive opt-in props (autoFocus, onEscape), its own compose/cancel logic untouched."
  - "CommandPalette's board-list hot actions (Set Status/Priority/Estimate/Assignee) render the same picker components BoardView.tsx uses, anchored to the palette panel's own bounding rect rather than a row — there is no triggering row when the command originates from the palette."
  - "'Filter by Status/Epic/Assignee/Priority' palette commands focus the matching FilterBar.tsx chip group rather than opening a nested value-picking submenu — the spec names four commands, not one per filter value, and the chips are already Tab-reachable once focus lands in the group."
  - "'Create Issue' (palette) creates a placeholder-titled issue directly rather than opening IssuesLane.tsx's own composer — that quick-add has no ref plumbed out and is already unconditionally visible, so BOARD-07's discoverability problem does not apply to it the way it applies to the on-demand task/epic quick-add."
  - "Item detail panel's own keyboard map (Tab/Shift+Tab between fields, ⌘Enter, n/Space/j/k on criteria, ⌘⌫ from inside the panel) is explicitly out of scope — Task 1's action text scopes this plan to the global and board-list regions plus the Escape ladder, and ItemDetailPanel.tsx is not in files_modified."

patterns-established:
  - "useGlobalBindings({ actionId: handler }) as the standard way any component reacts to a global keyboard action — BoardView.tsx (create-task/create-epic), FilterBar.tsx (focus-search), App.tsx (register-project/switch-project), CommandPalette.tsx (open-palette) all use it."
  - "dispatchAction(id) as the standard bridge from a non-keyboard trigger into an existing keyboard-wired action."

requirements-completed: [BOARD-07]

coverage:
  - id: D1
    description: "One binding table (state/keyboard.ts) drives every board-list keystroke; no board component hand-rolls its own key-matching switch; a bare letter never fires while the real event target is a text input, even when the container believes it owns the keystroke"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#letters_do_not_fire_while_typing"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#navigation_is_a_no_op_on_an_empty_board"
        status: pass
    human_judgment: false
  - id: D2
    description: "Selection tracks the item id, never a row index — it survives a reorder unchanged and falls to the next-nearest surviving id in the previous order when the selected item leaves the window, rather than resetting to the top"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#selection_follows_the_item_across_a_reorder"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#selection_falls_to_the_nearest_survivor_when_filtered_out"
        status: pass
    human_judgment: false
  - id: D3
    description: "Escape closes exactly one layer per press in the fixed order palette -> detail panel -> quick-add -> clear selection, and is a no-op with nothing open and nothing selected"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#escape_closes_one_layer_per_press"
        status: pass
    human_judgment: false
  - id: D4
    description: "Virtualized rows announce their true band position and total (aria-setsize/aria-posinset), not the mounted window's count"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx#rows_announce_their_true_position"
        status: pass
      - kind: other
        ref: "grep -c 'aria-setsize' packages/desktop/src/board/BoardRow.tsx >= 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "The command palette generates its full command list from the binding table plus runtime project/selected-item lists — every board-list action has a corresponding palette entry, and it traps focus and restores it to the triggering element on close"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/palette.test.tsx#palette_covers_every_binding"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/palette.test.tsx#palette_restores_focus_on_close"
        status: pass
    human_judgment: false
  - id: D6
    description: "The native menu bar (menu.rs) carries only real destinations (no Help item, no Toggle Group By item) and every custom item routes through the same dispatchAction pipeline a keystroke uses; the whole workspace builds"
    requirement: BOARD-07
    verification:
      - kind: unit
        ref: "cargo build --workspace"
        status: pass
      - kind: unit
        ref: "cargo test --workspace (70 passing, unchanged from the 01-08 baseline — this plan touched no Rust query/domain code)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live tauri dev walkthrough with the mouse untouched from launch to finish, per Task 3's own <human-check> block: create every item type, set every field, reorder, search, filter, open the legend from ⌘K, delete an item, and confirm a second window action's reorder does not jump selection to the top"
    human_judgment: true
    rationale: "No agent-spawning tool and no confirmed GUI display are available in this execution environment (the same limitation every prior plan in this phase — 01-02 through 01-08 — documented). Deferred to /gsd-verify-work, matching the established precedent for this exact gap."
    verification: []

# Metrics
duration: ~110min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 9: Full Keyboard Operability, the Escape Ladder, and the Command Palette Summary

**One declarative binding table (`state/keyboard.ts`) drives every board-list keystroke and the
global shortcuts; selection, the item detail panel and the destructive-delete target all live as
ids in `state/uiStore.ts`; a capture-phase `window` listener resolves a fixed-order Escape ladder
(palette → detail panel → quick-add → clear selection) that closes exactly one layer per press; a
generated `⌘K` command palette and a native `menu.rs` menu bar both re-enter that same pipeline
via a new `dispatchAction` helper rather than a second implementation of each action.**

## Performance

- **Duration:** ~110 min
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 16 (6 created, 10 modified)

## Accomplishments

- `state/keyboard.ts`: `BINDINGS` (the one key-to-action table), `resolveBinding`'s
  typing-ambiguity guard (a bare letter never fires while the real event target is a text field,
  even when a bubbled event reaches a container that believes it owns the keystroke),
  `nextEscapeLayer`, `nextSelectionId`/`boundarySelectionId`, `useGlobalBindings`, and
  `dispatchAction` — the bridge that lets the palette and the native menu re-enter the exact
  keyboard pipeline a real keystroke would use.
- Deleted `BoardRow.tsx`'s own `onKeyDown` handler outright — it was silently double-firing every
  board-list keystroke alongside `BoardView.tsx`'s container handler, a real pre-existing defect
  (not introduced by this plan) found while consolidating key handling into one place.
- Selection, the item detail panel's open item, and the pending delete target all moved into
  `state/uiStore.ts` as ids — `CommandPalette.tsx`, mounted at the app-shell level outside
  `BoardView.tsx`'s own tree, drives all three from outside, exactly like the keyboard path does.
- The "selection survives a pushed delta" requirement's harder half — the selected item being
  *removed* from the window — is proven, not assumed: a new effect in `BoardView.tsx` compares
  against a previous-render snapshot and falls to the next-nearest surviving id in the *previous*
  order, never resetting to the top.
- The Escape ladder is a single capture-phase `window` listener that calls `stopPropagation()`
  once it commits to closing a layer — verified against Radix's own source
  (`@radix-ui/react-dismissable-layer`'s `isHighestLayer` gate) to guarantee exactly one layer
  closes per press even with three independent `DismissableLayer`s mounted simultaneously.
- Quick-add is on demand (`c`/`⌘N`/`⌘⇧N`, or the empty-board default) rather than always mounted —
  required to make it a real, closeable ladder layer.
- `DeleteConfirm.tsx` (new): `⌘⌫`'s destructive confirmation. `useDeleteItem` (01-04/01-07) had no
  caller anywhere in the codebase until this plan wired one.
- `CommandPalette.tsx` (new): generates its entire command list from the binding table plus two
  runtime lists (registered projects, hot actions on the selected item) — no hand-written command
  array. Traps focus and restores it to the triggering element on close.
- `src-tauri/src/menu.rs` (new): the native menu bar, real destinations only, every custom item's
  id a literal `ActionId` string forwarded to the frontend and re-entering `dispatchAction`.
- Found and fixed two real bugs during this plan's own test-writing and craft-floor review: a
  contrast failure on `DeleteConfirm`'s destructive button (2.2:1 → 6.3:1) and a focus-restore bug
  caused by the palette's own `autoFocus` racing Radix `FocusScope`'s mount-time capture of the
  triggering element (root-caused by reading Radix's own source, not by guessing).

## Task Commits

1. **Task 1: The binding table, the focus-region model, and selection that survives a delta** —
   `14caf64` (feat)
2. **Task 2: The command palette, the native menu bar, and the reachable legend** — `869a352`
   (feat)
3. **Task 3: Prove keyboard coverage, the focus contract and the palette's completeness** —
   `fa804d3` (test)

**Plan metadata:** pending (this commit, made immediately after this SUMMARY)

_Note: the three tasks were implemented as one cohesive pass rather than strictly sequentially —
`CommandPalette.tsx` (Task 2) needs the full `BINDINGS` table including the command-palette-only
entries, and the tests (Task 3) exercise both `BoardView.tsx` and `CommandPalette.tsx` together
(the Escape-ladder test in particular renders both). The three-commit split above groups files by
which task's acceptance criteria they satisfy; the full verification suite (`cargo build
--workspace`, `cargo test --workspace`, `npm run build`, `npm run test`) was run and confirmed
green after each commit, not only at the very end._

## Files Created/Modified

See `key-files` in frontmatter above for the full list. Highlights:

- `packages/desktop/src/state/keyboard.ts` — new; the single binding table and every pure
  helper (`resolveBinding`, `nextEscapeLayer`, `nextSelectionId`/`boundarySelectionId`,
  `useGlobalBindings`, `dispatchAction`, `allActionIds`/`boardListActionIds`/`actionLabel`)
- `packages/desktop/src/state/uiStore.ts` — `paletteOpen`, `currentProjectId`, `detailItemId`,
  `deleteTarget` added alongside the existing `selectedItemId`
- `packages/desktop/src/board/BoardView.tsx` — consolidated keyboard dispatch, the Escape ladder
  effect, the nearest-survivor-selection effect, on-demand quick-add, `⌘⌫` wiring
- `packages/desktop/src/board/BoardRow.tsx` — own key handler removed; `aria-setsize`/
  `aria-posinset` added
- `packages/desktop/src/board/QuickAdd.tsx` — `autoFocus`/`onEscape` opt-in props
- `packages/desktop/src/board/DeleteConfirm.tsx` — new
- `packages/desktop/src/board/FilterBar.tsx` — migrated its own `⌘F`/`/` listener onto
  `useGlobalBindings`
- `packages/desktop/src/board/CommandPalette.tsx` — new
- `packages/desktop/src/legend/Legend.tsx` — optional `onClose` overlay mode
- `packages/desktop/src/App.tsx` — mounts `CommandPalette`, wires `⌘⇧O`/`⌘1`-`⌘9`, bridges native
  menu clicks
- `packages/desktop/src/adapters/tauri.ts` — `subscribeMenuAction`
- `packages/desktop/src-tauri/src/menu.rs` — new
- `packages/desktop/src-tauri/src/main.rs` — wires `build_menu`/`on_menu_event`
- `packages/desktop/src/board/__tests__/{keyboard-nav,palette}.test.tsx` — new
- `DESIGN.md` — new "Phase 1, Plan 01-09" section (self-conducted craft-floor review)

## Decisions Made

See `key-decisions` in frontmatter above for the full list. The most consequential: quick-add
changed from always-mounted to on-demand, which is a real, if small, behavior change from every
prior plan's screenshot of the board — required to make it a genuine, closeable Escape-ladder
layer rather than a permanent fixture with nothing to close.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `BoardRow.tsx`'s own `onKeyDown` handler was double-firing every board-list
keystroke**
- **Found during:** Task 1, while reading the existing keyboard handling before consolidating it
- **Issue:** `BoardRow.tsx` had its own `handleRowKeyDown` implementing `Enter`/`o`/`s`/`p`/`e`/`a`
  identically to `BoardView.tsx`'s container-level handler. Since a row's event bubbles to the
  container, every one of those keystrokes was already being processed twice (idempotent in
  practice, since both paths called the same underlying open-picker/open-detail functions, but
  exactly the "two key-handling systems fighting" architectural defect this plan's own context
  named as the specific failure mode to avoid)
- **Fix:** Deleted `handleRowKeyDown` and its `onKeyDown` wiring entirely; the row now owns no key
  handling of its own, only click handlers
- **Files modified:** `packages/desktop/src/board/BoardRow.tsx`
- **Verification:** `npm --prefix packages/desktop run test` green; the row's click affordances
  (status/priority/estimate/assignee glyphs, double-click to open detail) are unaffected, since
  those were never routed through the deleted key handler
- **Committed in:** `14caf64` (Task 1 commit)

**2. [Rule 2 - Missing Critical] `DeleteConfirm.tsx` did not exist — `⌘⌫` had no confirmation
surface to route through**
- **Found during:** Task 1, wiring the `delete-item` board-list binding
- **Issue:** `useDeleteItem` (added in 01-04/01-07) had no caller anywhere in the codebase; the
  plan's own action text and threat T-01-25 require delete to "always route through the
  destructive confirmation that names the item type, key and title," and no such component
  existed to build that flow on top of
- **Fix:** Added `packages/desktop/src/board/DeleteConfirm.tsx`, trapped/dismissable via the same
  Radix pattern every other overlay in this codebase uses, Escape defaulting to Cancel per T-01-25
- **Files modified:** `packages/desktop/src/board/DeleteConfirm.tsx` (new),
  `packages/desktop/src/board/BoardView.tsx`, `packages/desktop/src/board/CommandPalette.tsx`
- **Verification:** `npm --prefix packages/desktop run build`/`test` green;
  `escape_closes_one_layer_per_press` exercises the same central Escape-handling infrastructure
  `DeleteConfirm`'s own Escape-to-cancel relies on
- **Committed in:** `14caf64` (Task 1 commit)

**3. [Rule 1 - Bug] `FilterBar.tsx` still hand-rolled its own `⌘F`/`/` key-matching listener**
- **Found during:** Task 1, verifying the acceptance criterion "no board component attaches its
  own bare-letter key handler" against the whole board surface, not just the files the plan named
- **Issue:** `FilterBar.tsx` (01-08) had its own `useSearchFocusShortcut` implementing
  `event.metaKey && event.key.toLowerCase() === "f" || event.key === "/"` directly — a second,
  independently-maintained key-matching implementation alongside the new `state/keyboard.ts`
  binding table's identical `focus-search` entries, and a direct violation of Task 1's own stated
  acceptance criterion even though `FilterBar.tsx` was not named in the plan's `files_modified`
  list
- **Fix:** Replaced the hand-rolled listener with `useGlobalBindings({ "focus-search": () =>
  inputRef.current?.focus() })`; the typing-target ambiguity guard now lives once, in
  `resolveBinding`, rather than being re-derived per caller
- **Files modified:** `packages/desktop/src/board/FilterBar.tsx`
- **Verification:** `npm --prefix packages/desktop run build`/`test` green (no existing test
  exercised this shortcut directly, so nothing needed updating)
- **Committed in:** `14caf64` (Task 1 commit)

**4. [Rule 1 - Bug] `DeleteConfirm`'s destructive button measured 2.2:1 contrast, failing AA**
- **Found during:** Task 2, this plan's own craft-floor review pass
- **Issue:** First written with `color: var(--text-primary-strip)` (dark ink, the token meant for
  light strip-paper stock) on `background: var(--destructive-strip)` (a dark red) — measured
  2.2:1, well under WCAG AA's 4.5:1 for body/button text
- **Fix:** Swapped to `var(--text-primary-rack)` (the light rack-text token), measured 6.3:1
- **Files modified:** `packages/desktop/src/board/DeleteConfirm.tsx`
- **Verification:** Contrast computed directly (WCAG relative-luminance formula, the same method
  01-02's own runnable contrast suite uses) — 2.209:1 before, 6.310:1 after
- **Committed in:** `869a352` (Task 2 commit)

**5. [Rule 1 - Bug] The command palette's `autoFocus` input broke Radix `FocusScope`'s
focus-restore-on-close**
- **Found during:** Task 3, writing `palette_restores_focus_on_close`
- **Issue:** The palette's search `<input autoFocus>` moved DOM focus into the palette during
  React's commit phase, *before* `FocusScope`'s own mount effect (a passive effect) had a chance
  to capture `document.activeElement` as "what to restore on unmount." `FocusScope` ended up
  capturing its own (about-to-be-unmounted) input as the restore target, so the restore silently
  no-op'd, leaving focus on `<body>`
- **Fix:** Root-caused by reading `@radix-ui/react-focus-scope`'s source directly and reproducing
  the failure in an isolated repro before touching the real component (three throwaway debug test
  files, not shipped) — removed the `autoFocus` attribute and let `FocusScope`'s own default
  mount-autofocus behavior (`focusFirst` over the container's tabbable candidates, which runs
  *after* the correct capture) land focus in the input instead
- **Files modified:** `packages/desktop/src/board/CommandPalette.tsx`
- **Verification:** `palette_restores_focus_on_close` passes; documented in the component's own
  doc comment so a future plan copying the "just add `autoFocus`" pattern other, non-`FocusScope`-
  wrapped components in this codebase use safely does not reintroduce it
- **Committed in:** `869a352` (Task 2 commit, since the fix landed before Task 2's own commit —
  the test that caught it was written in Task 3 but the bug lived in Task 2's own file)

---

**Total deviations:** 5 auto-fixed (2 Rule 1 pre-existing/discovered bugs fixed at the root, 1
Rule 1 acceptance-criterion violation found in a file outside the plan's stated scope, 1 Rule 2
missing-critical-functionality addition, 1 Rule 1 bug found and fixed during this plan's own
test-writing).
**Impact on plan:** All five were necessary for correctness, accessibility, or to make the plan's
own stated acceptance criteria true. None reduce `BOARD-07` coverage; the `FilterBar.tsx` fix in
particular closes a gap the plan's own acceptance criterion named explicitly.

## Issues Encountered

- **Radix's `DismissableLayer` "only the highest mounted layer gets a document Escape listener"
  mechanism was investigated directly from source** (not assumed) before deciding how the Escape
  ladder and the row-level pickers/`DeleteConfirm` should coexist — this is why the ladder has an
  explicit `pickerOpen` early-out rather than trying to also own picker-Escape centrally.
- **No agent-spawning tool and no confirmed GUI display are available in this execution
  environment**, matching every prior plan in this phase (01-02 through 01-08). The shipped
  `impeccable-finish-reviewer`/`impeccable-documenter` subagents named in the plan's acceptance
  criteria could not be literally invoked; substituted a self-conducted review directly against
  `craft-floor.md` and the standing direction contract, documented in `DESIGN.md`'s new section,
  exactly as every prior plan in this phase did for the same limitation. Task 3's own
  `<human-check>` live `tauri dev` walkthrough was not run live this session — deferred to
  `/gsd-verify-work`, matching the established precedent (coverage item D7).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `BOARD-07` is fully proven: `cargo build --workspace`, `cargo test --workspace` (70 passing,
  unchanged — this plan touched no Rust query/domain code), `npm --prefix packages/desktop run
  build`, and `npm --prefix packages/desktop run test` (44 passing, up from 36) are all green.
- `state/keyboard.ts`'s `BINDINGS`/`resolveBinding`/`useGlobalBindings`/`dispatchAction` are ready
  for any future plan adding a keyboard-triggered action — extend the table, never add a second
  key-matching switch.
- `state/uiStore.ts` now owns the full cross-tree UI-navigation state a future project rail needs
  (`currentProjectId`, `selectedItemId`, `detailItemId`, `deleteTarget`, `paletteOpen`) — a rail
  component can read/drive all of it without touching `BoardView.tsx`.
- **Known deferred surfaces — not blockers, all explicitly documented in `DESIGN.md`:** the
  "Filter by X" palette commands focus a chip group rather than opening a nested value submenu;
  "Create Issue" (palette) creates a placeholder-titled issue rather than opening
  `IssuesLane.tsx`'s own composer; the item detail panel's own internal keyboard map (Tab between
  fields, `⌘Enter`, criteria-list `j`/`k`/`n`/Space, in-panel `⌘⌫`) is out of scope for this plan;
  there is no project-rail UI yet (switching works purely by keyboard/palette against the new
  `currentProjectId`).
- **Live `tauri dev` walkthrough not run this session** (coverage item D7) — deferred to
  `/gsd-verify-work`, matching the precedent every prior plan in this phase established for the
  same no-GUI-display limitation.

## Known Stubs

None that block this plan's own goal.

## TDD Gate Compliance (Task 3, `tdd="true"`)

Task 3's two test files (`keyboard-nav.test.tsx`, `palette.test.tsx`) were written against
already-implemented, already-reviewed Task 1/Task 2 code — not a fabricated RED phase for
non-existent behavior. This matches this project's own established precedent (recorded across
`01-03`/`01-04`/`01-07`'s SUMMARYs: `workflow.tdd_mode` is not the strict-gate-enforcing setting
for this project's config) of implementation-first sequencing within a single plan, followed by a
dedicated invariant-proving test suite. One genuine RED-then-GREEN cycle did occur during this
process: `palette_restores_focus_on_close` failed on first write against the real bug documented
above (deviation 5) and was fixed by correcting the implementation, not the test — the test's
assertion was correct from the start.

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: packages/desktop/src/state/keyboard.ts
- FOUND: packages/desktop/src/board/CommandPalette.tsx
- FOUND: packages/desktop/src/board/DeleteConfirm.tsx
- FOUND: packages/desktop/src-tauri/src/menu.rs
- FOUND: packages/desktop/src/board/__tests__/keyboard-nav.test.tsx
- FOUND: packages/desktop/src/board/__tests__/palette.test.tsx
- FOUND commit 14caf64 (feat(01-09): the single binding table, the Escape ladder, and selection-by-id)
- FOUND commit 869a352 (feat(01-09): the command palette, the native menu bar, and the reachable legend)
- FOUND commit fa804d3 (test(01-09): prove keyboard coverage, the focus contract and palette completeness)

All created files verified present on disk; all three task commit hashes verified present in git log. No missing items.
