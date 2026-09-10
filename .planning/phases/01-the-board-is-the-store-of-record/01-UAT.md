---
status: diagnosed
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md]
started: 2026-09-09T23:15:00Z
updated: 2026-09-10T00:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live walkthrough of the new hierarchy UI and the layer guard

expected: Launch a real `tauri dev` build and, with the mouse untouched, exercise the newly-built hierarchy UI specifically: select a task and press `m` to open the epic picker, assign and clear an epic; open an issue row's parent button (Tab-reachable, not click) and set/change/detach its parent through the grouped Epics/Tasks menu; open the item detail panel and confirm Cmd-N / Cmd-Shift-N / Cmd-F / bare `/` / Cmd-1..9 / Cmd-Shift-O are all inert while it is open, and Cmd-K still opens the palette over it without stealing focus. Every action completes with no perceptible lag or visual jank; the epic pill and issue parent button show real key/title values, not placeholders; clicking a different issue's parent button while the detail panel is open does nothing rather than opening a second trapped picker.
result: issue
reported: "item detail panel Cmd-N is actually closing the panel and doing the command"
severity: major

### 2. Perceived responsiveness at 1,000+ items

expected: With a project seeded past 1,000 items (no seed tooling exists yet — see the note carried from the previous round), reorder, filter, search, and switch projects with the mouse untouched throughout. No perceptible lag or visual jank at volume.
result: [pending]

## Summary

total: 2
passed: 1
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-01-1
  truth: "While the item detail panel is open, the global Cmd-N shortcut is inert — it neither dismisses the panel nor runs the new-item command."
  status: failed
  reason: "User reported: item detail panel Cmd-N is actually closing the panel and doing the command"
  severity: major
  test: 1
  root_cause: |
    The native macOS menu owns Cmd-N as an accelerator, so the keystroke never reaches the
    webview and the layer guard never runs. menu.rs binds `create-task` to `CmdOrCtrl+N`;
    macOS consumes the accelerator at the menu layer, fires `on_menu_event`, and main.rs
    forwards the id over `menu:action`. App.tsx's bridge then treats every forwarded id as a
    mouse click on a menu item — `if (actionId !== "open-palette") returnToBoardLayer()` —
    which calls `setDetailItemId(null)` and closes the panel outright, and only then calls
    `dispatchAction("create-task")`. The synthesized keydown now passes
    `bindingAllowedInLayer` because the layer it was meant to be blocked by has just been
    dismantled. `useGlobalBindings`'s guard is correct and untouched; it is simply bypassed.

    The defect is the conflation in the bridge: `menu:action` is emitted identically for a
    menu CLICK (an unambiguous request from outside the keyboard, where returning to the
    board layer is right) and for a menu ACCELERATOR (a keystroke, which must obey the layer
    guard like every other keystroke). Only the click reading was implemented.

    Why the existing tests are green: every test file stubs `subscribeMenuAction` to a no-op,
    so the menu bridge is absent under test. `layer-guard.test.tsx:162`
    ("cmd_n_and_cmd_shift_n_do_not_open_quick_add_over_the_detail_panel") dispatches a
    synthetic webview keydown, which does correctly hit the guard — but on real macOS that
    keydown never happens, because the menu ate the accelerator first. The test's model of
    the keystroke does not match the platform.
  artifacts:
    - path: "packages/desktop/src/App.tsx"
      line: 149
      issue: "Menu bridge calls returnToBoardLayer() for every forwarded id except open-palette, closing the detail panel before the layer guard can refuse the action. Cannot distinguish an accelerator from a click."
    - path: "packages/desktop/src-tauri/src/menu.rs"
      line: 35
      issue: "create-task is bound to CmdOrCtrl+N as a native accelerator, so macOS consumes the keystroke before the webview sees it."
    - path: "packages/desktop/src-tauri/src/main.rs"
      line: 16
      issue: "FORWARDED_MENU_ACTIONS forwards register-project, create-task, create-epic and open-palette identically for click and accelerator origins."
    - path: "packages/desktop/src/board/__tests__/layer-guard.test.tsx"
      line: 55
      issue: "subscribeMenuAction stubbed to a no-op in every test file, so the menu:action path carrying this bug is untested."
  missing:
    - "Make the menu bridge obey the layer guard rather than pre-empting it: either stop calling returnToBoardLayer() and let bindingAllowedInLayer decide for all forwarded ids, or carry the event origin (accelerator vs click) so only a real click returns to the board layer."
    - "Cover all four forwarded ids, not just create-task: create-epic (Cmd-Shift-N) and register-project (Cmd-Shift-O) travel the identical path and are expected to show the same panel-closing symptom even though this session's walkthrough read them as inert. Re-test all three during fix verification."
    - "Add a regression test that exercises the menu:action bridge with a real detail layer open, instead of stubbing subscribeMenuAction to a no-op."

## Prior Round

A previous UAT round (2026-09-09T17:55Z–20:05Z) ran 3 tests: 3 passed with 2 issues raised.
Those two issues became gaps G-01-EPIC-ASSIGN and G-01-FOCUS, which plans 01-12 through 01-15
have since closed; a post-gap-closure code review then found and fixed 2 blockers and 2 warnings
(CR-01, CR-02, WR-01, WR-02). That round's full record remains in git history at commit 6e49677.

The two tests above are what the re-verification could not settle from the codebase alone:
test 1 covers a UI surface that did not exist when the prior round ran, and test 2 is the
volume clause the prior round explicitly recorded as not exercised (the board held 1 project /
1 task / 1 issue at the time).
