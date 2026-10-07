---
status: partial
phase: 08-review-and-merge-inside-flywheel
source: [08-VERIFICATION.md]
started: 2026-10-06T16:50:00Z
updated: 2026-10-07T13:20:00Z
---

## Current Test

[testing paused — 1 item outstanding: test 4 awaits a live-forge run on the account owner's machine]

## How these were run

Five of the six items were automated rather than performed by hand, per the standing preference
for runnable harnesses over manual walkthroughs. Three new harnesses were built for this phase:

| Harness | Command | Covers |
|---|---|---|
| Real-browser arm (WebKit via Playwright) | `npm --prefix packages/desktop run test:browser` | items 1, 2, 3 (keyboard half), 6 |
| Live GitHub arm (`#[ignore]`d, opt-in) | `FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture` | item 4 |
| Existing Rust integration suite | `cargo test -p core --test review_merge --test epic_request_draft --test forge_live_chain --test review_diff --test criterion_anchors` | item 3 (core half) — 117 tests, all green |

WebKit is the browser because the macOS Tauri shell renders in WKWebView. jsdom cannot reach any of
these three properties: it has no layout (so nothing scrolls), it does not resolve `color-mix()`
(so the diff tints are unmeasurable), and it does not synthesise a click from Enter on a focused
button — `src/review/__tests__/keyboard-activation.test.tsx` says so in its own header and *models*
the rule instead of measuring it.

## Tests

### 1. Read a multi-language task diff in light AND dark themes at review width
expected: Added/removed tints do not fight token colour; text stays legible (VALIDATION manual row 1)
result: issue
reported: "Measured in WebKit at 1440×900 across five languages: 11 syntax-token roles fall below WCAG AA (4.5:1) on the tinted diff rows. Worst: insert/keyword 2.91:1, insert/punctuation 3.09:1, insert/string 3.45:1, delete/keyword 3.47:1, insert/number|function|boolean 3.61:1, delete/punctuation 3.68:1, delete/string 4.12:1, delete/number 4.31:1. The same roles on an untouched row score 6.5–8.0:1, so the tint is exactly what costs the legibility. The worst cases sit on the 30% edit-block mixes (#335a4b added, #613e3e removed), not the 12% row mixes."
severity: major
notes: |
  The item's "light AND dark themes" half is vacuous, not skipped: the product ships ONE palette.
  `styles/tokens.css` declares every token under a bare `:root` with no `prefers-color-scheme`
  block and no `[data-theme]` selector, and every diff colour is a `*-rack` role. The rack/strip
  split is the one palette, not a light mode and a dark mode. A regression test now asserts that,
  so introducing a real second theme re-opens this item deliberately.
  Evidence: `uat-screenshots/uat-01-review-diff-1440x900.png`,
  `packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx` (currently red).

### 2. Review a real multi-file task: check each criterion against selected lines without losing scroll position, then toggle to whole-epic scope and read the new Tasks roll-up beneath the epic's own criteria
expected: The rail stays usable over a long diff; scroll position survives each check; the roll-up counts match what the board shows (VALIDATION manual row 2)
result: pass
notes: |
  Five assertions, all green in WebKit over a 24-hunk diff: scroll position is byte-identical
  across a check made against a gutter selection; identical across a check made with no selection;
  the rail scrolls in its own container (scrolling the diff to its end leaves `rail.scrollTop` at
  0); the three panes fit at review width with no horizontal page scroll; and every roll-up row's
  rendered text is compared field-by-field against the board's own counts rather than a hand-typed
  string, with the roll-up proven to sit below the epic's own criteria by real geometry.
  Evidence: `uat-screenshots/uat-02-epic-rail-1440x900.png`,
  `packages/desktop/src/review/__tests__/browser/ergonomics.browser.test.tsx`.

### 3. Open the merge confirm sheet, then a conflicting merge, in the packaged/dev app
expected: Wording reads clearly; the conflict names each file and offers 'start a session' and 'open worktree'; the board shows the integrated marker after a clean merge
result: pass
notes: |
  Conflict half measured in a real engine: the sheet lists both conflicted paths by name and both
  exits ("Start a session to resolve", "Open in editor") activate with Enter, calling
  `worktreeOpen(t1, editor)` and `startAgentRun(t1, acceptEdits, …)`.
  Core half: `cargo test -p core --test review_merge` — 37 tests green, covering the three
  outcomes, the already-integrated no-commit case, the dirty-worktree refusal, the per-epic
  concurrency guard, and the integrated marker deriving from event plus live ancestry.
  Wording: `src/review/__tests__/merge-sheet.test.tsx` plus the screenshot above.
  Residue, and it is small: no automation can drive the PACKAGED binary on macOS — WKWebView
  exposes no WebDriver endpoint and `tauri-driver` supports Linux and Windows only. If you want
  that last mile by eye, `npm --prefix packages/desktop run tauri dev` is the whole command.

### 4. Open an epic request against a real authenticated GitHub/GitLab repo, twice in a row
expected: First call pushes and opens one request; second surfaces the existing request read-only rather than creating a duplicate
result: blocked
blocked_by: third-party
reason: "Automated but not run: `packages/core/tests/forge_live_github.rs` drives `open_epic_request_at` twice against real GitHub and asserts the second call returns AlreadyOpen with the SAME request number, then closes the PR and deletes the branch it made. It opens a real pull request on a real repository, so it is `#[ignore]`d and left for the account owner to run. One-time setup `gh repo create flywheel-uat --private --add-readme`, then `FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture`."

### 5. Open the epic request sheet, change state in another window (check a criterion or merge a task), then confirm
expected: Per WR-08 of the review the published body can differ from the previewed one; decide whether a content-hash guard is required before this ships
result: issue
reported: "Decision taken: the content-hash guard IS required before this ships. The whole product thesis is agents mutating the board while a human reviews, which makes the preview/confirm window routine rather than theoretical, and the body is published to a possibly-public forge."
severity: minor
notes: |
  Not a test — a decision, and the evidence for it is now settled by reading rather than by
  driving two windows. `commands/forge.rs::forge_open_epic_request` takes an epic id and nothing
  else, and re-reads the board (`epic_request_inputs` + `epic_draft_inputs`) at confirm time; the
  preview came from a separate earlier `forge_epic_request_draft` call. There is no hash parameter
  in the IPC signature, so the guard cannot exist by construction. `useEpicRequestDraft` does
  subscribe to `board:changed`, which narrows the window — but the refetch is async, so a confirm
  can still fire against a stale render.

### 6. Keyboard-only pass through review in the real WebView: j/k files, Enter to expand, c to check, Tab to Merge, Enter and Space on the confirm button, same for 'Open request'
expected: Every step completes without the mouse (line selection itself is gutter-click only). The CR-03 guard is proven in jsdom only; real button-activation semantics are not
result: issue
reported: "Measured in WebKit: Tab focuses ZERO buttons in 60 presses, so the Merge button is never reached and neither is the sheet's confirm button. The same probe in Chromium reaches Merge after 4 button stops — identical page, identical harness, so this is the engine, not the test. WebKit omits <button> from sequential focus navigation unless full keyboard access is on (WKPreferences.tabFocusesLinks, NO by default, mirroring Safari's 'Press Tab to highlight each item on a webpage'). Nothing in src-tauri sets it, and the command palette registers no merge or request command, so on macOS there is no keyboard route to either confirmation at all."
severity: major
notes: |
  CR-03 itself HOLDS, and is now measured rather than modelled: with the button focused, Enter and
  Space each activate it in the real engine, exactly once, without the window-level region binding
  also firing (the file list's expanded state is unchanged). Both the header Merge button and the
  sheet's confirm button were proven this way, as were both conflict exits.
  Everything that does not depend on Tab passes keyboard-only: j/k move the file focus, Enter
  expands the focused file, and `c` checks the rail's focused criterion carrying the gutter
  selection as evidence — the criteria list is reachable because it carries an explicit
  `tabIndex={0}` rather than relying on being a button, which is also the shape of the fix.
  Evidence: `packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx`
  (the reachability test is currently red; the seven activation tests are green).

## Summary

total: 6
passed: 2
issues: 3
pending: 0
skipped: 0
blocked: 1

## Gaps

- gap_id: G-08-1
  truth: "Added/removed diff tints do not fight token colour; text stays legible at review width"
  status: failed
  reason: "Measured in WebKit: 11 syntax-token roles fall below WCAG AA on tinted diff rows, worst insert/keyword at 2.91:1 against #335a4b. The same roles score 6.5-8.0:1 on untouched rows. The 30% edit-block mixes (--diff-code-insert-edit-background-color / --diff-code-delete-edit-background-color in review.css) are the dominant cause; the 12% row mixes are survivable."
  severity: major
  test: 1
  artifacts:
    - path: "packages/desktop/src/review/review.css"
      issue: "`color-mix(... 30%, transparent)` edit-block tints drop every token role below AA; the 12% row tints cost less but still push keyword and punctuation under 4.5:1 on deletes"
  missing:
    - "Lower the edit-block mix percentages, or lift the token colours on tinted rows, until every role/row pair clears 4.5:1"
    - "The measurement is already a test — legibility.browser.test.tsx goes green when it holds"
  debug_session: ""

- gap_id: G-08-6
  truth: "Every review step completes without the mouse, including Tab to Merge and Enter/Space on the confirm button"
  status: failed
  reason: "Measured in WebKit: 0 buttons focused in 60 Tab presses; Merge unreachable. Chromium reaches it after 4. WKWebView excludes buttons from sequential focus navigation by default and nothing sets WKPreferences.tabFocusesLinks; no key binding or palette command offers another route to Merge or Open request."
  severity: major
  test: 6
  artifacts:
    - path: "packages/desktop/src-tauri"
      issue: "no webview preference enables full keyboard access, so <button> is outside the Tab order on macOS"
    - path: "packages/desktop/src/state/keyboard.ts"
      issue: "REVIEW_SURFACE_ACTION_IDS has no binding for merge or open-request, so the keyboard has no alternative route"
    - path: "packages/desktop/src/board/CommandPalette.tsx"
      issue: "registers no merge or epic-request command"
  missing:
    - "Either enable full keyboard access on the webview, or give Merge and Open request real bindings in the review-surface layer (and update the reachability test to assert the binding rather than Tab)"
    - "CR-03's activation half needs no change — it is proven correct in the real engine"
  debug_session: ""

- gap_id: G-08-5
  truth: "What you previewed in the epic request sheet is what gets published to the forge"
  status: failed
  reason: "WR-08, decided in UAT: `forge_open_epic_request` takes an epic id alone and re-reads the board at confirm time, so any change since the preview (an agent checking a criterion, a merge landing) publishes a body the user did not see. There is no hash parameter in the IPC signature, so the guard cannot exist by construction; the sheet's `board:changed` subscription narrows the window but its refetch is async, so a confirm can still fire against a stale render."
  severity: minor
  test: 5
  artifacts:
    - path: "packages/desktop/src-tauri/src/commands/forge.rs"
      issue: "`forge_open_epic_request` re-reads the board and re-assembles the draft at confirm time, with no reference to what the preview showed"
    - path: "packages/desktop/src/review/EpicRequestSheet.tsx"
      issue: "confirms with the epic id alone, so it cannot assert that the body it rendered is the body that will be published"
  missing:
    - "Return a SHA-256 of title plus body alongside the preview from `forge_epic_request_draft`"
    - "Accept that hash on `forge_open_epic_request` and refuse with `draftChanged` on mismatch"
    - "Have the sheet re-fetch and re-render on `draftChanged` rather than publishing"
  debug_session: ""
