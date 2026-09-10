---
status: complete
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md]
started: 2026-09-09T23:15:00Z
updated: 2026-09-10T14:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live walkthrough of the new hierarchy UI and the layer guard

expected: Launch a real `tauri dev` build and, with the mouse untouched, exercise the newly-built hierarchy UI specifically: select a task and press `m` to open the epic picker, assign and clear an epic; open an issue row's parent button (Tab-reachable, not click) and set/change/detach its parent through the grouped Epics/Tasks menu; open the item detail panel and confirm Cmd-N / Cmd-Shift-N / Cmd-F / bare `/` / Cmd-1..9 / Cmd-Shift-O are all inert while it is open, and Cmd-K still opens the palette over it without stealing focus. Every action completes with no perceptible lag or visual jank; the epic pill and issue parent button show real key/title values, not placeholders; clicking a different issue's parent button while the detail panel is open does nothing rather than opening a second trapped picker.
result: issue
reported: "item detail panel Cmd-N is actually closing the panel and doing the command"
severity: major
resolution: |
  Closed, not retracted. The reported Cmd-N defect was real; plans 01-14 through 01-16 fixed it
  (G-01-1 `status: closed`). Its code half is independently verified in 01-VERIFICATION.md
  truth #16 (BOARD-07c) via `menu-bridge.test.tsx` — the regression test G-01-1's `missing[2]`
  demanded, exercising the `menu:action` bridge with a real detail layer instead of stubbing
  `subscribeMenuAction` to a no-op. Its visual-affordance half passed as test 3. Its remaining
  owner-observable half — the three-accelerator sweep G-01-1's `missing[1]` demanded — is
  carried into test 4 rather than being silently assumed from the code read.

### 2. Perceived responsiveness at 1,000+ items

expected: The board is already seeded past 1,000 items and the data persists on disk (2 projects, 13 epics, 905 tasks, 161 issues in `~/Library/Application Support/Flywheel/flywheel.db` — written by the throwaway `fw-seed` tool through core's real domain API during the G-01-2 round, so keys, fractional ranks, the event log and the FTS index all landed as the app writes them). With that volume loaded, reorder, filter, search, and switch projects with the mouse untouched throughout. No perceptible lag or visual jank at volume.
result: pass
exercised_on: |
  A `tauri dev` build (dev profile, unoptimized + debuginfo — the harsher of the two profiles
  for a lag judgement, so a pass here is not flattered by release optimizations). Owner drove
  the seeded THRE project (`01M22XBK2AMH58GBVV4VDXT8H3`, key_counter 1078) after switching to
  it from the rail; the earlier duplicate registration `01M222FWC4FNCQKDZCXD8BEQ68` sits in the
  rail as `unreachable` and is correctly refused — `.flywheel/project.json` names the active
  project, so reconciliation is behaving as specified, not failing.

### 3. Menu-bar visual greying affordance (carried from G-01-1 Task 3)

expected: Launch a real `tauri dev` build. With the item detail panel open, open the View menu with the mouse while the command palette is also open, and confirm Toggle Command Palette reads visually greyed (not merely refused-but-enabled); reopen the same detail panel and go straight to the File menu to observe whether Register Project.../New Task/New Epic are greyed on the first opening or only the second (the plan's accepted, bounded one-frame window). Toggle Command Palette must re-enable when the palette closes; no menu item may sit permanently enabled-and-dead.
result: pass
why_human: orca's computer-use provider on this host cannot click the real native menu bar or read a MenuItem's visual enabled/disabled state (surfaces.menubar:false / surfaces.dialogs:false), so no automated tool can settle it — confirmed live this session against the running app (capabilities reported surfaces.menubar:false, surfaces.menus:false, surfaces.dialogs:false).
exercised_on: A `tauri dev` build, owner-driven against the real native macOS menu bar.

### 4. Accelerator re-test over the closed G-01-1 fix (all three forwarded ids)

expected: G-01-1's diagnosis closed with an explicit instruction — "Cover all four forwarded ids, not just create-task: create-epic (Cmd-Shift-N) and register-project (Cmd-Shift-O) travel the identical path and are expected to show the same panel-closing symptom. Re-test all three during fix verification." The code half is verified (`menu-bridge.test.tsx` 17/17 fresh this session; `App.tsx`'s only `returnToBoardLayer` occurrence is a comment), but no human has driven the three accelerators against a real build since the fix landed. With the item detail panel open, press Cmd-N, then Cmd-Shift-N, then Cmd-Shift-O: each must be wholly inert — the panel stays open, no new task/epic is created, no project-registration dialog appears. Then press Cmd-K and confirm the palette still opens over the panel without stealing focus, and Escape returns you to the panel rather than dismissing both.
result: issue
reported: "it works, only Cmd-N and others are not stealing the focus when re-applied." — clarified: the accelerators are correctly inert while the detail panel is open (G-01-1's fix holds, and its `missing[1]` three-id sweep is hereby discharged); once the panel closes they DO fire, but keyboard focus stays on the board / the old panel instead of moving into the new item's field, so a Tab or a click is needed before typing.
severity: major
severity_note: |
  The literal phrasing ("it works, only...") maps to `minor` under the severity guide's
  "works but..." row. Recorded as `major` instead because the product's stated invariant is
  mouse-free operation — 01-UI-SPEC.md's keyboard model and every UAT test in this phase say
  "with the mouse untouched" — and this forces a pointer or an extra blind keystroke onto the
  primary creation path. Downgrade to `minor` if the owner reads it as cosmetic.
carried_from: test 1 (G-01-1's `missing[1]`)
discharges: "G-01-1 missing[1] — all three forwarded ids (Cmd-N / Cmd-Shift-N / Cmd-Shift-O) driven against a real build with the detail panel open; all three confirmed inert."


## Summary

total: 4
passed: 3
issues: 2
pending: 0
skipped: 0
blocked: 0
issues_open: 1   # test 1's issue is closed (G-01-1); test 4 opened G-01-4

note: |
  G-01-2 was found by owner inspection AFTER test 2 was recorded as passed. Test 2's own
  criterion (responsiveness) genuinely passed and is not retracted; the volume it required is
  simply what made a separate, pre-existing correctness defect visible for the first time.

  Updated 2026-09-10 after the G-01-2 gap-closure round (plans 01-17, 01-18): both gaps below
  are now closed in code and independently re-verified in 01-VERIFICATION.md (20/20 must-haves,
  status human_needed). Test 1's reported issue is closed by plans 01-14 through 01-16; only its
  visual-affordance half remains, recorded above as new test 3. Test 2 stays pending — the
  1,000+ item perceived-lag check was deliberately NOT re-run during 01-18, so it is still the
  owner's to exercise.

## Gaps

- gap_id: G-01-1
  truth: "While the item detail panel is open, the global Cmd-N shortcut is inert — it neither dismisses the panel nor runs the new-item command."
  status: closed
  closed_by: "Plans 01-14 through 01-16 (code); the visual greying affordance remains open as UAT test 3"

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

- gap_id: G-01-2
  truth: "Every task's epic pill shows a human-readable `KEY Title`, never a raw internal ULID, and the epic filter chip list covers every epic in the project."
  status: closed
  closed_by: "Plans 01-17 and 01-18 — unwindowed epic roster (list_epics/epic_list_all/useEpics); re-verified 2026-09-10 in 01-VERIFICATION.md"

  reason: |
    Found by owner inspection of a seeded 1,067-item board on 2026-09-10, immediately after
    test 2 passed on responsiveness. Rows THRE-33, THRE-38, THRE-43, THRE-48, THRE-53 and
    THRE-58 render raw ULIDs (e.g. `01M24BE37SW6X6EHZJ9J4MVY9X`) in the epic pill, and the
    FilterBar offers only 4 epic chips out of the project's 13.
  severity: major
  test: 2
  root_cause: |
    The epic lookup is derived from the currently loaded board window, not from the project's
    epics. `BoardView.tsx:258-262` builds `epicsById` as
    `items.filter(i => i.kind === "epic")` over whatever the last `board_list` page returned,
    and `commands/board.rs:12` caps that page at `DEFAULT_LIMIT = 200` rows (`MAX_LIMIT = 500`).
    The core is windowed by design — `query/mod.rs:3`: "The core never returns the whole board:
    every call is LIMIT-bounded and cursor-resumable."

    So any task whose epic sorts outside the loaded 200-row window finds no entry in
    `epicsById`, and `BoardRow.tsx:120` falls back to rendering `item.epicId` — the raw ULID —
    as the pill's label. `FilterBar.tsx:81-84` and `ParentPicker`'s parent options
    (01-15-SUMMARY.md) read from the identical single-window derivation and degrade the same way.

    This was a KNOWN simplification, but its recorded limitation was the wrong one.
    01-08-SUMMARY.md's "Known Stubs" anticipates only the filter-composition case ("composing
    the epic filter with another active filter can hide an epic from its own chip"). Nobody
    anticipated the volume case, because at the time the board held 1 project / 1 task /
    1 issue — every epic trivially fitted in the first window. The assumption "the loaded window
    contains every epic a visible task references" is invisible at 1 epic and false at 13.
  artifacts:
    - path: "packages/desktop/src/board/BoardView.tsx"
      line: 258
      issue: "epicsById derived from the loaded window's epic rows only, so epics outside the page are unresolvable."
    - path: "packages/desktop/src/board/BoardRow.tsx"
      line: 120
      issue: "Fallback renders the raw epic_id ULID when the lookup misses, leaking an internal identifier onto the primary board surface."
    - path: "packages/desktop/src-tauri/src/commands/board.rs"
      line: 12
      issue: "DEFAULT_LIMIT = 200 bounds the window the epic lookup is built from."
    - path: "packages/desktop/src/board/FilterBar.tsx"
      line: 81
      issue: "Epic chip options read from the same single-window derivation; showed 4 of 13 epics."
  missing:
    - "Resolve epic labels from the project's epics rather than the loaded page — either a dedicated list-epics command (epics are a bounded, small set, unlike tasks) or have board_list return the referenced epics alongside the page."
    - "Replace BoardRow's raw-ULID fallback with something that can never leak an internal id, even if the lookup misses."
    - "Apply the same fix to FilterBar's chip list and ParentPicker's parent options, which share the derivation."
    - "Add a test at a volume that exceeds DEFAULT_LIMIT — every existing test runs against a handful of rows, where this defect is unreachable."

## Prior Round

A previous UAT round (2026-09-09T17:55Z–20:05Z) ran 3 tests: 3 passed with 2 issues raised.
Those two issues became gaps G-01-EPIC-ASSIGN and G-01-FOCUS, which plans 01-12 through 01-15
have since closed; a post-gap-closure code review then found and fixed 2 blockers and 2 warnings
(CR-01, CR-02, WR-01, WR-02). That round's full record remains in git history at commit 6e49677.

The two tests above are what the re-verification could not settle from the codebase alone:
test 1 covers a UI surface that did not exist when the prior round ran, and test 2 is the
volume clause the prior round explicitly recorded as not exercised (the board held 1 project /
1 task / 1 issue at the time).

- gap_id: G-01-4
  truth: "Opening quick-add from anywhere on the board lands the cursor in its input, so a task or epic can be created and typed without touching the mouse."
  status: failed
  reason: |
    User reported at test 4: "it works, only Cmd-N and others are not stealing the focus when
    re-applied." Clarified in session: the accelerators are correctly INERT while the item detail
    panel is open (G-01-1 holds), but once the panel is closed they fire and the command runs
    while keyboard focus stays on the board / the previously-focused element instead of moving
    into the new item's field — a Tab or a click is needed before typing.
  severity: major
  test: 4
  root_cause: |
    Quick-add's only focus mechanism is React's `autoFocus` prop, which fires ONLY on mount —
    and the row it sits on is virtualized, so at volume it never mounts.

    `BoardView.tsx:305` inserts the quick-add row at the top of the Backlog band, and
    `BAND_ORDER` (line 72) puts `backlog` first, so the row lands at **index 1** of the virtual
    row list. `useVirtualizer` (line 319) is configured `estimateSize: () => ROW_HEIGHT`
    (`ROW_HEIGHT = 40`, BoardRow.tsx:52) with `overscan: 10`. The row is therefore only mounted
    while the scroll position is within roughly `(1 + 10) x 40 = 440px` of the top of the board.

    Press Cmd-N (or Cmd-Shift-N) while scrolled further down than that on a 1,000-item board and
    the sequence is: `openQuickAdd` -> `storeOpenQuickAdd(kind)` -> `quickAddOpen: true` ->
    the row is added to the `rows` memo -> the virtualizer declines to mount it because it is
    outside the visible window plus overscan -> `<QuickAdd autoFocus>` (line 590-591) never
    mounts -> `autoFocus` never fires -> focus stays exactly where it was, and the input the
    user is meant to type into is scrolled off-screen entirely.

    There is no scroll-into-view anywhere to rescue it: `scrollToIndex`, `scrollToOffset` and
    `scrollIntoView` return ZERO hits across all of `packages/desktop/src/`. Nothing brings the
    quick-add row into view when it opens; the code assumes it is already there.

    Why every test is green, and why this is G-01-2's blind spot a second time: the largest
    fixture in the suite is `epic-roster.test.tsx`'s 13 epics. At any fixture that small the
    quick-add row is ALWAYS inside the mounted window, so `autoFocus` always fires and the
    defect is structurally unreachable under test. The assumption "the quick-add row is mounted
    whenever it is open" is invisible at 13 rows and false at 1,000 — exactly the shape of
    G-01-2's "the loaded window contains every epic a visible task references".
  artifacts:
    - path: "packages/desktop/src/board/BoardView.tsx"
      line: 305
      issue: "Quick-add row is inserted at the top of the Backlog band (index 1 of the virtual list), far from the user's scroll position at volume."
    - path: "packages/desktop/src/board/BoardView.tsx"
      line: 319
      issue: "useVirtualizer overscan: 10 at ROW_HEIGHT 40 means the quick-add row unmounts once the board is scrolled past ~440px, and no scrollToIndex ever brings it back."
    - path: "packages/desktop/src/board/BoardView.tsx"
      line: 590
      issue: "<QuickAdd autoFocus> relies on mount-time autoFocus as its sole focus mechanism; an unmounted row cannot self-focus."
    - path: "packages/desktop/src/board/QuickAdd.tsx"
      line: 33
      issue: "The autoFocus prop's contract ('lands the cursor in it immediately') is only honoured when the component actually mounts — an invariant nothing enforces."
  missing:
    - "Scroll the quick-add row into view when it opens — call the virtualizer's scrollToIndex for the quick-add row index inside the same state transition that sets quickAddOpen, so the row is mounted before focus is expected."
    - "Stop relying on mount-time autoFocus as the sole focus mechanism: focus the input from an effect keyed on quickAddOpen (or an imperative ref handle) so a row that mounts late still receives focus."
    - "Guarantee the Backlog band is expanded when quick-add opens — collapsedByStatus['backlog'] currently short-circuits the row's insertion entirely (BoardView.tsx:303), which is a second, independent way for Cmd-N to produce no focusable input."
    - "Add a test at a volume that exceeds the virtualizer's overscan window (>= ~50 rows) with the board scrolled away from the top — every existing test runs against a handful of rows, where this defect cannot occur."
