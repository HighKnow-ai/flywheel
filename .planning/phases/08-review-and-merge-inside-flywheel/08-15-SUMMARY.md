---
phase: 08-review-and-merge-inside-flywheel
plan: 15
subsystem: review
tags: [keyboard, react, radix-focus-scope, webkit, wkwebview, tdd, gap-closure]
gap_closure: true
gap_ids: [G-08-6]

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "ReviewSurface, MergeConfirmSheet, EpicRequestSheet, useRegionBindings activation guard (CR-03), real-browser test arm (plans 08-01..08-14)"
provides:
  - "open-merge (m) and open-epic-request (r) as review-surface bindings, refused in every other layer"
  - "MergeConfirmSheet and EpicRequestSheet focus their primary button on open"
  - "A reachability test that asserts the binding route in WebKit instead of a Tab probe"
  - "No dead command-palette entry for any review-surface action"
affects: [08 verification, 08-UAT item 6]

actuals:
  tokens: 6300
  tasks: 3
  commits: 3
plan_head_before: fb38e90891df758a66eb66c48a5df006ddf35b3c
commits: 3

tech-stack:
  added: []
  patterns:
    - "One const per action, read by both the button and the key binding, so a keystroke and its button cannot be offered under different conditions"
    - "A binding registered with an empty handler map while its action is unavailable, so the key is left unclaimed rather than swallowed"
    - "Sheet focus restored by a keyed once-per-appearance effect; Radix initial focus suppressed with onMountAutoFocus"

key-files:
  created: []
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/review/ReviewSurface.tsx
    - packages/desktop/src/review/MergeConfirmSheet.tsx
    - packages/desktop/src/review/EpicRequestSheet.tsx
    - packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx
    - packages/desktop/src/board/__tests__/layer-guard.test.tsx

key-decisions:
  - "Shape (b), real bindings, not shape (a), a webview preference: the acceptance harness is Playwright's WebKit, which src-tauri does not configure, so WKPreferences.tabFocusesLinks could not be observed by the test that found the gap"
  - "Final keys: m = open-merge (task scope), r = open-epic-request (epic scope), both in the review-surface region"
  - "EpicRequestBar passes an empty handler map when the action is not offered, instead of a handler that returns early, because useRegionBindings preventDefaults any key whose id has a handler"
  - "The epic sheet's focus effect is keyed on which button is primary (confirm or close) and resets while the request is in flight, so a draftChanged refusal that remounts Open request gets focus back"

patterns-established:
  - "A key that opens a confirmation must be gated on the same expression that renders its button"

requirements-completed: [REVW-03, REVW-04, REVW-05]

coverage:
  - id: D1
    description: "m on the review surface opens the merge sheet with its Merge button focused, and Enter or Space confirms exactly once with the task id as the whole input"
    requirement: REVW-04
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#m opens the merge sheet with its Merge button already focused, and Enter confirms exactly once"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#m opens the merge sheet with its Merge button already focused, and Space confirms exactly once"
        status: pass
    human_judgment: false
  - id: D2
    description: "r in epic scope opens the request sheet with its Open request button focused, and Enter confirms once carrying the previewed content hash"
    requirement: REVW-05
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#r opens the epic request sheet with its Open request button already focused, and Enter confirms once with the previewed hash"
        status: pass
    human_judgment: false
  - id: D3
    description: "m and r are inert where their button is not offered: precheck refused, the other scope, a sheet already open"
    requirement: REVW-03
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#m does nothing when the precheck refuses the merge: the key and the button are offered together"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#m is inert in epic scope and r is inert in task scope"
        status: pass
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#m and r do nothing while a sheet is already open: one dialog, focus stays on its confirm button"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both new actions are admitted only in the review-surface layer, asserted over every UiLayer"
    requirement: REVW-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/layer-guard.test.tsx#bindingAllowedInLayer_admits_open_merge_and_open_epic_request_only_in_the_review_surface_layer"
        status: pass
    human_judgment: false
  - id: D5
    description: "CR-03 activation is untouched: the seven pre-existing activation tests are green and useRegionBindings / isActivationTarget are byte-identical"
    verification:
      - kind: automated_ui
        ref: "npm --prefix packages/desktop run test:browser (23/23); git diff fb38e90..HEAD -- src/state/keyboard.ts touches neither"
        status: pass
    human_judgment: false
  - id: D6
    description: "No command-palette entry exists for expand-file, check-with-selection, open-merge or open-epic-request"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/palette.test.tsx (existing entries unchanged, passes)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-10-07
status: complete
---

# Phase 8 Plan 15: Keyboard route to merge and epic request Summary

**`m` and `r` are now review-surface bindings that open the merge and epic-request confirmations with their confirm button already focused, replacing a Tab path that WKWebView does not have; measured in WebKit with no Tab press, fenced out of every other layer, and with no new palette entry.**

## Performance

- **Duration:** about 14 min (start time estimated from the first test run, 06:30Z)
- **Completed:** 2026-10-07T06:44Z
- **Tasks:** 3
- **Files modified:** 7

## Fix shape and why shape (a) was rejected

Shape (b): real bindings. Shape (a), setting `WKPreferences.tabFocusesLinks` in the Tauri shell, was rejected because the test that found G-08-6 runs in Playwright's WebKit, driven by `vitest.browser.config.ts`. `src-tauri` configures nothing about that browser, so the preference would have left the reachability test exactly as red as it was. A fix its own acceptance test cannot observe is not a closed gap. (b) also matches precedent (every other review verb is already a `review-surface` binding) and does not change Tab order across the app. Shape (a) stays available later as a general accessibility improvement.

## Final keys bound

| Key | Action id | Region | Offered when |
|-----|-----------|--------|--------------|
| `m` | `open-merge` | `review-surface` | task scope, not integrated, merge sheet not open, precheck `ready` (the `mergeOffered` const the Merge button also reads) |
| `r` | `open-epic-request` | `review-surface` | epic scope, no open request, a draft, no blocker (the `offered` const `EpicRequestBar` also reads) |

Both keys also exist in other regions (`open-epic-picker`; `continue-shaping`, `toggle-raw-view`). That is not a collision: `resolveBinding` filters by region.

## TDD Gate Compliance

The plan is `type: execute` with Task 3 marked `tdd="true"`, so the RED commit was moved first to satisfy the RED-before-GREEN contract.

- **RED evidence (before the rewrite):** `npm --prefix packages/desktop run test:browser`, exit 1, 17/18 passing. Failing target: `UAT 6 — reaching those buttons with the keyboard alone > puts the Merge button in the engine's sequential focus order`; expected `{ reached: true }`, actual `{ buttonsFocused: 0, reached: false }`.
- **RED commit `acf0ab7`** (`test(08-15)`): the Tab probe is replaced by the binding-route tests. Run against the unchanged implementation, 4 of 23 browser tests fail (`m` Enter, `m` Space, `r` Enter, and the sheet-already-open test, each "Unable to find role=dialog") and `layer-guard` fails on `open-merge in board: expected true to be false`. The three "inert" tests pass vacuously before the feature exists, which is expected for a guard.
- **GREEN commits** `d7d8985` (`m`) and `0feba26` (`r`): browser arm 23/23.
- `gsd_run check tdd-red-evidence` was not run: it classifies node:test TAP output and the browser arm reports in vitest's format, so the record above is the evidence. The plan frontmatter is not `type: tdd`, so the plan-level gate does not bind.
- No REFACTOR commit; nothing needed cleaning up.

## Accomplishments

- Both confirmations are reachable on macOS with the keyboard alone, measured in WebKit: `m` or `r`, then Enter or Space on the already-focused confirm button.
- `bindingAllowedInLayer` refuses both ids in all nine other layers, asserted by iterating the whole `UiLayer` union. Reverting the explicit refusal makes that test fail (checked).
- The palette no longer carries the two dead entries `expand-file` and `check-with-selection` contributed, and does not gain two more.
- CR-03 is untouched: `isActivationTarget` and `useRegionBindings` do not appear in the diff.

## Task Commits

1. **Task 3 (RED, moved first): rewrite the reachability test and fence the actions** - `acf0ab7` (test)
2. **Task 1: `m` to the merge confirmation** - `d7d8985` (feat)
3. **Task 2: `r` to the epic-request confirmation** - `0feba26` (feat)

**Plan metadata:** the docs commits that follow this summary.

## Files Created/Modified

- `packages/desktop/src/state/keyboard.ts` - two `ActionId`s, two `BINDINGS` rows, both ids in `REVIEW_SURFACE_ACTION_IDS` and in the explicit refusal
- `packages/desktop/src/board/CommandPalette.tsx` - one `continue` case for the four review-surface-only ids
- `packages/desktop/src/review/ReviewSurface.tsx` - `mergeOffered` const read by the button and by the `open-merge` handler
- `packages/desktop/src/review/MergeConfirmSheet.tsx` - confirm-button ref, `onMountAutoFocus`, once-per-open focus effect
- `packages/desktop/src/review/EpicRequestSheet.tsx` - `offered` const and `useRegionBindings` in `EpicRequestBar`; keyed focus effect and `onMountAutoFocus` in the sheet
- `packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx` - header records the measurement and the resolution; reachability block rewritten (7 tests, no Tab)
- `packages/desktop/src/board/__tests__/layer-guard.test.tsx` - one layer-wide assertion

## Decisions Made

See `key-decisions`. In short: shape (b); `m` / `r`; an empty handler map rather than an early-returning handler when the epic action is unavailable; a focus effect keyed on which footer button is primary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `r` would have been swallowed when the epic action is not offered**
- **Found during:** Task 2
- **Issue:** The plan has `EpicRequestBar` register a handler that returns early when the action is not offered. `useRegionBindings` calls `preventDefault()` for any key whose id has a handler, before the handler runs, so `r` would be cancelled with no forge or with an open request, contradicting Task 2's done criterion ("swallows no keystroke").
- **Fix:** Pass `offered ? { "open-epic-request": onOpen } : {}` to the hook. It is still called once, unconditionally, before every return.
- **Files modified:** `packages/desktop/src/review/EpicRequestSheet.tsx`
- **Verification:** epic-request.test.tsx including "no forge: renders nothing at all"; whole jsdom arm 768/768; browser arm 23/23
- **Committed in:** `0feba26`

**2. [Rule 1 - Bug] Epic sheet lost focus after a `draftChanged` refusal**
- **Found during:** Task 2
- **Issue:** A once-per-open focus guard would not refocus Open request after plan 08-14's refusal path unmounts it (the footer shows "Opening…") and remounts it, leaving a keyboard user with no focused confirm button.
- **Fix:** Key the effect on which button is primary (`confirm` or `close`) and reset the guard while the request is in flight, so each appearance is focused once. This also focuses Close on a result or blocker, as the plan asked.
- **Files modified:** `packages/desktop/src/review/EpicRequestSheet.tsx`
- **Committed in:** `0feba26`
- **Not covered by a test:** the refocus-after-`draftChanged` path has no browser test; the epic-request.test.tsx `draftChanged` test checks the refetch and notice, not focus.

**3. [Plan criterion not literally satisfiable] Three acceptance counts**
- `grep -c 'mergePrecheck.data?.state' ReviewSurface.tsx` reports 2, not 1: the second is the pre-existing `=== "refused"` refusal-note read (it was 2 before this plan). The merge-offered condition itself is one expression, `mergeOffered`.
- `grep -c useRegionBindings EpicRequestSheet.tsx` reports 2, not 1: the import line and the single call.
- `tsc --noEmit` reports 3 errors, all in the two named pre-existing files (`forge-section.test.tsx` 1, `settings-surface.test.tsx` 2), not 2; none is in a file this plan touched.

**4. [Plan criterion not true as written] Removing `onMountAutoFocus` alone does not fail the merge test**
- Run against that revert, the merge reachability tests still pass: the once-per-open focus effect runs after Radix's initial grab and moves focus to Merge anyway. `onMountAutoFocus` therefore only stops a transient focus on Cancel. The test was instead run against removing the focus call itself, and then 3 tests fail (`m` Enter, `m` Space, sheet-already-open), which is the property the criterion was after: the test measures focus, not just the dialog.

---

**Total deviations:** 2 auto-fixed (2 Rule 1), 2 plan criteria recorded as not literally satisfiable.
**Impact on plan:** No scope change. Both bug fixes are inside the plan's own files and serve its done criteria.

## Issues Encountered

- The real-browser arm regenerates tracked screenshots (`uat-01-review-diff-1440x900.png`, `uat-02-epic-rail-1440x900.png`) on every run. They were restored with `git checkout -- <file>` rather than committed, since this plan changes no pixels they capture.
- This working tree is an Orca worktree checked out on `cymarechal-devoteam/gsd-new-project-ade`, not an `agent-*` branch. The orchestrator dispatched this plan as a sequential executor on that tree and 08-14 committed there, so the agent-namespace guard was not applied; the branch is not the default branch (`git.base-branch --is-protected` returned false).

## Threat Flags

None. No new endpoint, auth path, file access or schema; the change is renderer-only.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 8 UAT item 6 is now both activation-proven and reachability-proven in WebKit.
- Open follow-up carried from 08-14: `forge_open_request` (the task request) still has no content-hash guard.
- Not verified: the real macOS WKWebView under Tauri. The route is proven in Playwright's WebKit only, which is the same engine family but not the shipped shell.

## Self-Check: PASSED

- Commits `acf0ab7`, `d7d8985`, `0feba26` present in `git log`.
- All seven modified files exist and `git diff --name-only fb38e90..HEAD` lists exactly them; `src-tauri` and `review-fixture.ts` untouched.
- Final runs: `npm --prefix packages/desktop run test:browser` 23/23, `npm --prefix packages/desktop test` 768/768, `cargo test --workspace` 1094 passed 0 failed.

---
*Phase: 08-review-and-merge-inside-flywheel*
*Completed: 2026-10-07*
