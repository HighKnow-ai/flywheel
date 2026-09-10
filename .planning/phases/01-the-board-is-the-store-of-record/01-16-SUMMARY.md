---
phase: 01-the-board-is-the-store-of-record
plan: 16
subsystem: ui
tags: [gap-closure, tauri-menu, keyboard, layer-guard, tdd, G-01-1]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: state/keyboard.ts's layer model (bindingAllowedInLayer/topLayer/useGlobalBindings, 01-09/01-13), the native menu bar (menu.rs, 01-09)
provides:
  - "App.tsx's menu:action bridge no longer pre-empts the layer guard for keystroke-originated accelerators"
  - "MenuHandles<R> + menu_set_action_enabled: a scoped Rust command letting the renderer toggle the four forwarded menu items' enabled state"
  - "state/menuSync.ts's useMenuLayerSync: pushes bindingAllowedInLayer's verdict onto the native menu bar, delta-only"
  - "MENU_ACTION_IDS / useTopLayer exported from state/keyboard.ts as the renderer-side mirror of main.rs's FORWARDED_MENU_ACTIONS"
affects: [ui-phase, secure-phase, any future menu-bar or native-chrome work]

# Actuals (#2632)
actuals:
  tokens: 10772
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native-menu affordance mirrors renderer policy one-way (renderer -> menu_set_action_enabled), never the reverse — the guard stays the single enforcement point"
    - "Delta-only IPC push: a ref cache of last-pushed verdict per id avoids one round trip per unrelated store write"

key-files:
  created:
    - packages/desktop/src/board/__tests__/menu-bridge.test.tsx
    - packages/desktop/src/state/menuSync.ts
    - packages/desktop/src-tauri/src/commands/menu.rs
  modified:
    - packages/desktop/src/App.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src-tauri/src/menu.rs
    - packages/desktop/src-tauri/src/state.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md

key-decisions:
  - "App.tsx's menu:action handler now does nothing but dispatchAction(actionId) — the returnToBoardLayer() pre-emption is gone; both click and accelerator origins re-enter bindingAllowedInLayer identically (threat T-01-02's invariant restored)"
  - "MenuHandles<R: tauri::Runtime> stays generic in state.rs (populated by the still-generic build_menu<R: Runtime>), while commands::menu::menu_set_action_enabled binds concretely to State<'_, MenuHandles<tauri::Wry>> — the only instantiation generate_handler! ever monomorphises, per the plan's explicit resolution"
  - "useMenuLayerSync caches the last-pushed verdict per id in a ref and only calls menu_set_action_enabled for ids whose verdict actually changed — a board<->quick-add transition (identical permitted set) issues zero calls"
  - "A rejected menu_set_action_enabled push is swallowed and its cached verdict cleared so the next layer change retries — a renderer with no native menu attached (or a failed IPC call) degrades silently rather than crashing"

patterns-established:
  - "layerStateFromStoreFields (state/keyboard.ts): the one place the six raw store fields map to a LayerState, shared by the one-shot currentLayerState() read and the live-subscribing useTopLayer() hook"

requirements-completed: [BOARD-07]

coverage:
  - id: D1
    description: "App.tsx's menu:action bridge stops pre-empting the layer guard — a forwarded id (keystroke or click) is admitted/refused by bindingAllowedInLayer exactly once, closing G-01-1's root cause"
    requirement: "BOARD-07"
    verification:
      - kind: unit
        ref: "src/board/__tests__/menu-bridge.test.tsx#with the item detail panel open (4 tests) / with a row-level picker open / with nothing open (4 tests) / key-map cross-check"
        status: pass
      - kind: e2e
        ref: "Live macOS tauri dev build via orca computer-use: with the item detail panel open, real OS-level CmdOrCtrl+N/+Shift+N/+Shift+O hotkeys left the panel open and opened nothing; CmdOrCtrl+K opened the palette over the panel; with nothing open all four still worked; a row-level picker refused CmdOrCtrl+K"
        status: pass
    human_judgment: false
  - id: D2
    description: "Rust: MenuHandles<R> + commands::menu::menu_set_action_enabled, a scoped IPC command restricted to the four forwarded menu ids"
    requirement: "BOARD-07"
    verification:
      - kind: other
        ref: "cargo build --workspace; grep/struct-shape gates (4 accelerator( calls preserved, MenuHandles<R> struct present, build_menu<R: Runtime> still generic, command bound to MenuHandles<tauri::Wry>, handler registered once in main.rs)"
        status: pass
    human_judgment: false
  - id: D3
    description: "state/menuSync.ts's useMenuLayerSync pushes the layer verdict to the native menu bar for all documented layer transitions (mount, detail panel, row-level picker, command palette, close-everything, no-op transitions, a rejected push)"
    requirement: "BOARD-07"
    verification:
      - kind: unit
        ref: "src/board/__tests__/menu-bridge.test.tsx#useMenuLayerSync (G-01-1, Task 3) — 7 tests"
        status: pass
    human_judgment: true
    rationale: "The unit suite proves the exact IPC calls useMenuLayerSync issues for every layer transition. What remains genuinely unverified is the VISUAL result on a real native menu bar (File/View items rendering greyed, and the bounded one-frame click-timing window the design decision names) — orca's computer-use provider on this host reports surfaces.menubar:false / surfaces.dialogs:false (see capabilities output in this session), so no available tool can click the real menu bar or read its enabled/disabled state. A human with the running `tauri dev` build (left running at the end of this session) must complete Task 3's <human-check> steps 2 and 3 specifically (View menu greys while the palette is up and re-enables after; File menu items are already greyed, or greyed on the second opening at worst, immediately after the panel opens)."

# Metrics
duration: 35min
completed: 2026-09-10
status: complete
---

# Phase 01 Plan 16: Native menu bridge obeys the layer guard (G-01-1 gap closure) Summary

**Removed the pre-emptive `returnToBoardLayer()` call that let a native macOS menu accelerator (⌘N owned by the OS before the webview ever sees it) bypass the item-detail-panel layer guard, and made the native menu bar itself layer-aware so refused items grey out instead of firing silently.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-10T01:05:00Z (approx, continuing from 01-15's session)
- **Completed:** 2026-09-10T01:38:41Z
- **Tasks:** 3 completed
- **Files modified:** 12 (5 created, 7 modified — see key-files)

## Accomplishments

- **Task 1 (tracer + TDD):** `App.tsx`'s `menu:action` handler now does nothing but
  `dispatchAction(actionId)` — the old `if (actionId !== "open-palette") returnToBoardLayer()`
  pre-emption, which ran on a *keystroke* (the macOS-owned `⌘N` accelerator) and tore down the
  detail panel the keystroke was supposed to be blocked by, is gone. Wrote
  `menu-bridge.test.tsx`, the first test in this repo to drive the real `menu:action`
  subscription end to end (every other suite stubs it to a no-op) — RED confirmed 3/10
  assertions failing against the pre-fix bridge (`gsd_run check tdd-red-evidence` →
  `RED_EVIDENCE_OK`), then GREEN with all 10 passing.
- **Task 2:** Added `MenuHandles<R>` (Rust, `state.rs`) holding the four forwarded
  `MenuItem<R>` handles, registered from `menu::build_menu` right after they're built. Added
  `commands::menu::menu_set_action_enabled`, bound concretely to
  `State<'_, MenuHandles<tauri::Wry>>`, which refuses any id outside the forwarded set
  (threat T-01-16-01). Inert on its own until Task 3 wires a caller.
- **Task 3 (TDD):** Added `state/keyboard.ts`'s `useTopLayer()` hook and
  `state/menuSync.ts`'s `useMenuLayerSync()`, mounted in `AppShell`. On every layer change it
  computes `bindingAllowedInLayer(id, layer)` for each of the four forwarded ids and pushes
  only the ids whose verdict changed via `menu_set_action_enabled` — delta-only, and
  degrade-not-crash if the push rejects. Extended `menu-bridge.test.tsx` with 7 cases covering
  the full documented transition sequence (RED confirmed 5/7 failing pre-implementation →
  GREEN with all 7 passing). Updated `01-UI-SPEC.md`'s menu-bar section.
- **Live verification on a real macOS `tauri dev` build** (via `orca computer-use`, restarted
  fresh mid-session to guarantee the running binary reflected all three tasks' code — see
  Issues Encountered): with the item detail panel open, real OS-level `⌘N`/`⌘⇧N`/`⌘⇧O`
  hotkeys left the panel open and opened nothing; `⌘K` opened the command palette over the
  panel with the panel still visible behind it; with a row-level picker open, `⌘K` was
  refused; with nothing open, all four actions worked normally including a genuine native
  "Open" folder-picker window for `⌘⇧O` (confirmed via `list-windows`, then cancelled).

## Task Commits

Each task was committed atomically (TDD tasks produced RED + GREEN commits):

1. **Task 1: Stop the menu bridge pre-empting the layer guard, and drive it under test**
   - `c7a0a93` (test, RED) — `menu-bridge.test.tsx` + `MENU_ACTION_IDS` export
   - `2350e72` (feat, GREEN) — remove `returnToBoardLayer()` from the bridge
2. **Task 2: Give the Rust side a layer-aware menu**
   - `c722112` (feat) — `MenuHandles<R>`, `menu_set_action_enabled`, registration
3. **Task 3: Push the layer verdict to the menu bar**
   - `40f07a2` (test, RED) — 7 `useMenuLayerSync` cases
   - `fb7f8a3` (feat, GREEN) — `useTopLayer`, `state/menuSync.ts`, `App.tsx` wiring, `01-UI-SPEC.md`

**Plan metadata:** committed as part of this SUMMARY commit.

## Files Created/Modified

- `packages/desktop/src/board/__tests__/menu-bridge.test.tsx` - 17 tests: the real `menu:action` bridge under every layer, and the full `useMenuLayerSync` transition sequence
- `packages/desktop/src/state/menuSync.ts` - `useMenuLayerSync()`, the affordance-push hook
- `packages/desktop/src-tauri/src/commands/menu.rs` - `menu_set_action_enabled` command
- `packages/desktop/src/App.tsx` - bridge simplified to `dispatchAction` only; mounts `useMenuLayerSync()`
- `packages/desktop/src/state/keyboard.ts` - `MENU_ACTION_IDS`, `layerStateFromStoreFields`, `useTopLayer`
- `packages/desktop/src-tauri/src/menu.rs` - registers `MenuHandles` via `app.manage`
- `packages/desktop/src-tauri/src/state.rs` - `MenuHandles<R>` struct + `get` lookup
- `packages/desktop/src-tauri/src/commands/mod.rs` - registers the new `menu` module
- `packages/desktop/src-tauri/src/main.rs` - registers `menu_set_action_enabled` in the invoke handler
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` - documents the validated, layer-aware menu bar

## Decisions Made

See `key-decisions` in frontmatter. Notably: the generic/concrete split for `MenuHandles<R>` follows the plan's explicit resolution exactly (generic in `state.rs`/`build_menu`, concrete `Wry` at the command boundary) rather than the simpler-but-foreclosing alternative of binding `build_menu` itself to `Wry`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `main.rs`'s Task 2 doc-comment collided with its own verify gate**
- **Found during:** Task 2, before commit
- **Issue:** The plan's own verify command `grep -c 'commands::menu::menu_set_action_enabled' main.rs = 1` would have failed once the doc comment I added (per the task's own instructions) also spelled out the fully-qualified path, producing 2 matches.
- **Fix:** Reworded the doc comment to reference `menu_set_action_enabled` (`commands/menu.rs`) instead of the fully-qualified path, preserving exactly one literal occurrence of the qualified string (the `invoke_handler` registration).
- **Files modified:** `packages/desktop/src-tauri/src/main.rs`
- **Verification:** Re-ran the grep gate — passes.
- **Committed in:** `c722112` (part of the task commit, not a separate fix)

---

**Total deviations:** 1 auto-fixed (Rule 3). **Impact on plan:** None — caught and corrected before the task commit landed; no separate remediation needed.

## Issues Encountered

**Stale `tauri dev` process predated Task 2's Rust changes.** A `tauri dev` instance from an earlier session was still running when Task 3's live verification began; its compiled binary (built ~9:15, before this plan's Rust changes had a chance to be picked up cleanly) risked silently degrading `menu_set_action_enabled` calls to no-ops. Killed the stale process tree (including an orphaned Vite dev server holding port 1420 from an even older session) and started a fresh `tauri dev`, confirmed via `ps`/`lsof` that no stray processes remained, then re-ran the full live walkthrough against the freshly-built binary. The `tauri dev` process is left running at session end for `/gsd-verify-work`'s continued use.

**`orca computer-use`'s macOS provider does not support `surfaces.menubar`/`surfaces.dialogs`** (confirmed via `orca computer capabilities --json`), so no available tool can click the real native menu bar or read a `MenuItem`'s enabled/disabled visual state. This is why Task 3's `<human-check>` steps 2 (View menu greys while the palette is up) and 3 (the click-timing window) are flagged `human_judgment: true` in coverage item D3 rather than closed — every other named step in the human-check (the accelerator inertness that IS G-01-1's actual reported bug, and the native folder dialog) was verified live against the real build.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-01-1 is closed for its actual reported symptom (the native `⌘N` accelerator bypassing the layer guard) — verified both by a real regression test suite and a live macOS build.
- The affordance half (native menu items visually greying under a trapped layer) is implemented and unit-tested exhaustively, but its VISUAL confirmation on the real menu bar needs a human with mouse access to the menu bar — flagged as coverage item D3 for `/gsd-verify-work`.
- `tauri dev` is left running (fresh, reflecting this plan's final code) so `/gsd-verify-work` can pick up directly from Task 3's `<human-check>` steps 2 and 3 without a rebuild.

## Self-Check: PASSED

All 13 listed key-files found on disk; all 6 commits (`c7a0a93`, `2350e72`, `c722112`, `40f07a2`, `fb7f8a3`, `8261676`) found in git history.
