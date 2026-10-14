---
phase: 11-ship-it
plan: 13
subsystem: desktop-frontend-tests
tags: [webkit, browser-tests, contrast, motion, epic-lens, deferred-review]
requires: []
provides:
  - measured coverage of register items D-REV-06, 07, 09, 10, 23, 27
  - epic-lens header narrowing under filters (A-04 any-child)
affects: [11-21 closure pass, 11-17, 11-18]
tech-stack:
  added: []
  patterns:
    - "sample CSSAnimation/CSSTransition at fixed currentTime instead of racing timers"
    - "bind token assertions to shipped bytes via ?raw, reading the ink from the component source"
key-files:
  created:
    - packages/desktop/src/board/__tests__/browser/lens-narrowing.browser.test.tsx
  modified:
    - packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx
    - packages/desktop/src/review/__tests__/browser/ergonomics.browser.test.tsx
    - packages/desktop/src/theme/__tests__/contrast.test.ts
    - packages/desktop/src/board/__tests__/browser/board-group.browser.test.tsx
    - packages/desktop/src/board/__tests__/browser/motion.browser.test.tsx
    - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
    - packages/desktop/src/styles/motion.css
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/BoardView.tsx
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "Epic lens narrows from the core's own filtered read (epic rows plus epics of matching tasks), failing open while pending or when the answer fills the 500-row limit; no new Rust command."
  - "Header counts stay board-wide; a filter-aware aggregate is not built."
requirements-completed: [DIST-04]
status: complete
duration: ~17 min
completed: 2026-10-13
commits: 10
plan_head_before: b36d2373932384c1388a7078859c828adda821a8
actuals:
  tokens: 7500
  tasks: 3
  commits: 10
---

# Phase 11 Plan 13: Six deferred-review items, measured Summary

Six register items filed as "needs a human" are now WebKit or contrast assertions; three of them caught real defects (a clipped criteria rail, a stepped group wipe, a missing epic-header narrowing), and the aesthetic residue is routed to 11-21 with thresholds.

## Per register id: tests, and whether the check passed immediately

| id | Test(s) now covering it | Outcome |
|----|-------------------------|---------|
| D-REV-06 | `legibility.browser.test.tsx` > "keeps every token leaf at 4.5:1 and in the code's own ink while a row is gutter-selected (D-REV-06)" (gutter click on a delete and an insert row, then the existing AA loop, extracted into `belowAA`, not duplicated) | **Passed immediately.** Min painted contrast 14.71:1 on both selected rows (5 and 12 token leaves). The register's 4.02 / 4.21 `.token.deleted`/`.token.inserted` case is unreachable: 08.1 removed all syntax hues and no `diff` grammar is registered. |
| D-REV-07 | `ergonomics.browser.test.tsx`: the two existing scrollTop tests (already asserted preservation; kept) and new "keeps the {task,epic}-scope rail scrollable, unclipped and starting at its first criterion at 900px wide" | **Caught a real defect.** RED commit 8c99052: Check-against-selection spanned x 142-272 in a 0-260 rail and the Edit pencil sat wholly outside; the statement was squeezed to a word a line. Fixed in `AcceptanceCriteriaList.tsx` (row wraps; statement `flex: 1 1 10rem`). |
| D-REV-09 | Painted focused-vs-unfocused rule and painted Dot at >= 3:1 were already in `board/__tests__/browser/legibility.browser.test.tsx` (08.1-14; `getComputedStyle` in WebKit, both schemes). New: `contrast.test.ts` > "the uncommitted-changes Dot clears 3:1 on every row surface, in the ink its components declare" (reads the ink from `BoardRow` and `EpicHeaderRow` source and resolves through `tokens.css?raw`, both modes) | **Passed immediately.** The Dot's ink is an alias of `--text-muted-rack`, in no role list before, so nothing had measured it as a graphic. |
| D-REV-10 | `board-group.browser.test.tsx` > "challenge row at 48px, measured in WebKit": long title ellipsizes; label, Accept, Reject stay in the 48px box (`getBoundingClientRect`); same with a failed decision's error beside them, title still >= 80px. Accept raising the epic total, task appearing, failed accept: already in `challenge-inline.test.tsx` (jsdom, fake core) | **Passed immediately** at 716px (900 minus the 184px rail). Mutation-checked: at 380px the detector fails and names Accept/Reject escaping the row. |
| D-REV-23 | `motion.browser.test.tsx` > "reveals an expanding group top-down and monotonically, and never paints a revealed row into the rows travelling below it (D-REV-23)" (animations paused and set to 0.25/0.4/0.75/1.0 of 180ms; clip-path and rects read). It replaces the polling "a transform transition exists" test; its reduced-motion half is kept inside the new one. | **Caught a real defect.** RED commit 1feb5d4: reveal `[2,2,5,6]` rows, no row ever mid-wipe. The `row-enter` keyframe had no `to`, and WebKit does not interpolate `inset()` with `none`, so each row popped in whole. Fixed in `motion.css` with an explicit `to`. Now one row is mid-wipe at each mid sample, reveal is monotonic and top-down, and the wipe front never passes the travelling row. Green in default and reduced-motion arms. |
| D-REV-27 | New `lens-narrowing.browser.test.tsx`: chip on narrows headers to the epics that own worktree rows in the fixture (computed, not 13/5), "No epic" bucket drops, chip off restores; second test pins fail-open on a full 500-row answer | **RED then GREEN.** The register's "implementation gap" was real: all 13 headers rendered under the chip. Implemented `useFilteredEpics` + the `groups` filter in `BoardView.tsx`. |

TDD note: D-REV-06, 09, 10 had no RED and none was invented. D-REV-27's implementation was written before its test; RED was then demonstrated honestly by restoring the old `BoardView.tsx` for one run (both tests failed), and the test was committed before the implementation.

## Residual judgements routed to plan 11-21 (each names its physical reason)

1. **D-REV-07, ergonomic feel of the rail over a long diff** (human ergonomic judgement; no WebDriver can feel a read). Threshold, now enforced by test: at 900px wide (`tauri.conf.json` minWidth) the rail scrolls on its own, no control is clipped, the first criterion is on screen, the page does not scroll sideways, in both scopes. The one question left: "At 900px wide with src/long.ts open, can you check all three criteria and still see which lines you selected, without scrolling the rail sideways?"
2. **D-REV-09, does the Dot read at 12px beside a status glyph** (perceptual judgement; the ratio is measured).
3. **D-REV-10, does the expanded epic read well** at 48px (aesthetic judgement; the geometry is measured).
4. **D-REV-23, does the expansion read as growth** (aesthetic judgement; the shape is measured). Plus the wording question, unchanged and not reworded: ROADMAP SC3 says "animates its height"; the shipped technique animates no height (clip-path on the new rows, a transform on the rows below).

Not covered, automatable at Phase 11 against a real build: a live accept against the real core (D-REV-10) and the live-board 13-to-5 (D-REV-27; the SQL clause itself is proved in `packages/core/tests/search_filter.rs`, the test here uses a fake core that mimics it). D-REV-06 has no residue.

## Deviations from Plan

**1. [Rule 1 - Bug] Criteria rail clipped at 900px** (Task 1). Found by the new test. Shared component `AcceptanceCriteriaList.tsx` (not in the plan's file list). Fix is a wrap plus a flex-basis on the statement; the item-detail jsdom and WebKit suites stay green. Commits 8c99052 (RED), 6c3ebb5.

**2. [Rule 1 - Bug] Group wipe stepped instead of growing** (Task 3). `motion.css` keyframe given an explicit `to`. A one-line fix, not a rebuild of the animation. Commits 1feb5d4 (RED), 61b1c17.

**3. [Rule 2 / plan-directed] Epic-lens narrowing implemented** (Task 3). Plan said to implement if absent. Chose a client hook over the core's existing `board_list`/`board_search` rather than a new Rust command, filter-aware aggregate or DTO change (the register's `needs` named those; a cold Rust build would also exceed the watchdog). Limits: header counts remain board-wide; fails open past 500 rows. Commits af8130f, 7b83af2.

**4. Test placement.** The D-REV-27 test is a new file `lens-narrowing.browser.test.tsx`, not `states-group.browser.test.tsx`: that file is a static capture over a bridge that answers `1` to every unknown command and cannot drive `BoardView`. The plan's D-REV-09 computed-colour assertion was already present from 08.1-14, so no duplicate was added.

**Total deviations:** 4 (2 auto-fixed bugs, 1 plan-directed implementation, 1 placement).

## Verification (per-target; the workspace suite is the phase-end gate)

- jsdom: `src/board src/item-detail src/theme src/review` 829 passed (51 files).
- WebKit light: `src/board src/item-detail src/review` 59 passed (10 files).
- WebKit dark: `src/board` 24 passed. WebKit reduced-motion: `src/board` 24 passed.
- Not run, deliberately: bare `npm --prefix packages/desktop test` (whole jsdom suite) and the settings/session browser dirs, per the anti-stall rule; they sit outside the touched surfaces.
- Checked-in UAT screenshots rewritten by the suite runs were restored with `git checkout --` and never committed.

## Known Stubs

None.

## Threat Flags

None. No new network, auth or file surface; the one new read reuses `board_list`/`board_search`. T-11-39 and T-11-40 are met: the selected-state loop runs and every assertion is a painted/measured value, never a source grep standing in for a paint (the Dot test reads source only to find which token the component paints with, then measures the ratio).

## Self-Check: PASSED

All ten commits exist (`git log` from `plan_head_before`), `lens-narrowing.browser.test.tsx` exists, and the per-target suites above were green at HEAD.
