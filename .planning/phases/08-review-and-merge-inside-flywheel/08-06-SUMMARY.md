---
phase: 08-review-and-merge-inside-flywheel
plan: 06
subsystem: review
tags: [react, react-diff-view, criteria, evidence, keyboard, legend]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "review_criteria_state and criterion_check_with_anchor commands plus adapter wrappers (08-02); the three-pane review surface and FileDiff (08-01); the layer gate and pinned board letters (08-04)"
provides:
  - "CriteriaRail: the item panel's own criteria list composed beside the diff, with a no-evidence footer count"
  - "AcceptanceCriteriaList renders evidence (path, range, short sha), freshness, staleness and the no-evidence marker, in the item panel and the rail alike"
  - "Surface-owned line selection (selection.ts); FileDiff selectedChanges, gutterEvents and widgets"
  - "check-with-selection action (c) in the review-surface layer; useCheckAgainstSelection"
  - "Legend marks: criterion-no-evidence, criterion-anchor-fresh, criterion-anchor-stale, integrated (the last rendered by 08-07)"
affects: [08-07, 08-08]

requirements-completed: [REVW-03]

actuals:
  tokens: 36000
  tasks: 2
  commits: 2
plan_head_before: abf21077716d37c86fe31c42b92a179805d50772

coverage:
  - deliverable: "Rail shows each criterion's evidence, freshness or no-evidence marker, and a footer count that disappears at zero"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Unknown staleness never renders as fresh; stale keeps the criterion checked"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Select lines then check: path, min/max range, old side only for deletion-only selections, no sha, plain check omits the anchor, selection alone writes nothing"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "All four new marks defined once in the legend and rendered with their printed word"
    verification:
      - kind: test
        ref: "packages/desktop/src/legend/__tests__/legend.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Rail layout, widget badge look and the select-then-check feel in the real app"
    human_judgment: true
    rationale: "Visual and interaction judgement only; deferred to end-of-phase human verification."

tech-stack:
  added: []
  patterns:
    - "The rail composes the item panel's list; the list reads evidence under one shared query key so the rail, surface and item panel make one fetch"
    - "A selection is surface state; the check, not the selection, is the only write"

key-files:
  created:
    - packages/desktop/src/review/CriteriaRail.tsx
    - packages/desktop/src/review/selection.ts
    - packages/desktop/src/review/__tests__/criteria-rail.test.tsx
  modified:
    - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
    - packages/desktop/src/review/ReviewSurface.tsx
    - packages/desktop/src/review/FileDiff.tsx
    - packages/desktop/src/review/useReviewQuery.ts
    - packages/desktop/src/review/review.css
    - packages/desktop/src/review/__tests__/review-surface.test.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx

key-decisions:
  - "The check-against-selection key is c, bound in the review-surface layer only; the row's own Space/Enter plain check is untouched"
  - "A mixed deletion-and-insertion selection anchors to the new side; deletions are skipped from its range. Only an all-deletion selection uses the old side"
  - "Selecting in a second file replaces the selection; the selection survives a check so one range can evidence several criteria"
  - "The rail wrapper stops j/k/Space/Enter from reaching the surface's window listener, so a key pressed in the criteria list is never also a file-list action"

duration: 8min
completed: 2026-10-06
---

# Phase 8 Plan 06: Criteria Rail Summary

**The item's acceptance criteria now sit beside the diff as the same list the item panel uses; clicking diff line numbers selects a range, and an explicit check (button or `c`) records that path and range as the criterion's evidence, while a check with nothing selected is stored and shown as "No evidence".**

## Accomplishments

- **Evidence everywhere a criterion appears.** `AcceptanceCriteriaList` now reads `review_criteria_state` and, for a checked criterion, prints `path:range (side) @ shortsha` plus a freshness mark, or the quiet "No evidence" mark. Unchecked rows print nothing extra. This is the item panel and the rail from one change (D-140).
- **Four staleness states, none conflated.** Untouched is "Evidence current", changed names the commit count, moved-or-changed says so, and unknown prints "recorded commit can no longer be found" and can never render as fresh. A stale criterion stays checked.
- **The rail.** `CriteriaRail` composes the list and adds a plain statement of what a check would attach ("Selected: path:2 (new)" or "No lines selected... records no evidence") and a footer "N criteria checked without evidence", absent at zero.
- **Selection.** `ReviewSurface` owns it; `FileDiff` takes `selectedChanges`, `gutterEvents` and `widgets` (no `Decoration`). Clicking a gutter toggles a change; a click in another file replaces the selection. Anchored lines in an open file get a badge naming the criterion; badge text is board text only.
- **The check.** `useCheckAgainstSelection` calls `criterionCheckWithAnchor` with the min and max line on one side. No sha is built anywhere in the review directory. The `c` key is `check-with-selection`, added to `REVIEW_SURFACE_ACTION_IDS` and refused in every other layer.
- **Legend.** Four marks added to the criteria channel, each asserted by test.

## Task Commits

1. Task 1: `fba2352` rail, evidence rendering, `useReviewCriteriaState`, legend marks (12 tests)
2. Task 2: `1b65d20` selection, gutter events, widgets, check action and key (27 tests in the file in total)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Structural] No separate "row component" existed to export**
- **Found during:** Task 1
- **Issue:** the plan says to export the criteria row; in this file the row is inline in `AcceptanceCriteriaList`'s map and tied to its focus and edit state, so extracting it would have been a large refactor of tested code.
- **Fix:** the rail composes the whole list instead (the plan's stated intent: same rows, revision markers, check interaction, key grammar). The list gains two optional props, `onFocusChange` and `onCheckSelected`, instead of the planned anchor/staleness/in-rail props, and reads evidence itself under the shared query key. There is no `inRail` flag because nothing needed one.
- **Files modified:** `AcceptanceCriteriaList.tsx`
- **Commit:** fba2352

**2. [Rule 3 - Structural] `CriterionDto` not extended; evidence is a separate read**
- **Issue:** the plan extends `CriterionDto` with anchor fields, but `criterion_list` does not return anchors (08-02 kept them in their own table). Evidence comes from `review_criteria_state`, which the list now queries.
- **Impact:** none on behaviour. Nothing is claimed until that query has loaded.

**3. [Rule 1 - Bug] Keys in the criteria list were also acting on the file list**
- **Issue:** the list handles `j`/`k`/Space/Enter locally, and the surface listens for the same keys on `window`, so one keystroke would have both moved a criterion and moved or expanded a file.
- **Fix:** the rail wrapper stops those four keys. `c` and Escape still reach the surface.
- **Commit:** fba2352 (wrapper), 1b65d20 (check key)

**4. [Rule 3 - Blocking] `review-surface.test.tsx` updated**
- **Issue:** the surface now mounts the rail, which has its own `role="list"`, so a "no list" assertion became ambiguous, and the adapter mock needed the rail's functions.
- **Fix:** the mock gained `reviewCriteriaState`, `invokeCommand` and `criterionCheckWithAnchor`; the assertion is scoped to the Changed files nav.
- **Commit:** 1b65d20

**5. Minor.** The `integrated` mark is in the `criteria` channel as the plan says; the `agent` channel is pinned at exactly fifteen entries by an existing test, so it could not go there. The rail is the leftmost of three panes (rail, file list, diffs).

**Total deviations:** 4 auto-fixed (1 bug, 3 structural/blocking), 1 minor. **Impact:** none on scope; every `<behavior>` bullet is covered.

## Verification

- `npm --prefix packages/desktop run test`: 48 files, 698 tests passed. `criteria-rail.test.tsx`: 27 tests. `legend.test.tsx`: 16. `src/item-detail/__tests__`: passed.
- `npm --prefix packages/desktop run build`: no `error TS`. `npx tsc --noEmit`: exit 0.
- Grep gates: four marks once each in `marks.ts`; no `checkbox` or `<input` in `CriteriaRail.tsx`; one `item-detail/AcceptanceCriteriaList` import; no `Decoration` in `FileDiff.tsx`; no `sha:` anywhere in `src/review/`; `selectedChanges`, `gutterEvents`, `widgets` all present in `FileDiff.tsx`.

## Issues Encountered

- A debugging command of mine hung on a stray `cat` waiting for stdin and was killed; nothing was left behind.
- Visual and feel checks (rail width, badge look, the click-select-check flow in the real app) were not performed; deferred to end-of-phase human verification.

## Known Stubs

None. The `integrated` legend mark has no renderer yet by design; plan 08-07 renders it.

## Next Phase Readiness

Ready for 08-07. The legend already defines `integrated`. The rail and its selection are independent of the merge flow.

## Self-Check: PASSED

- `CriteriaRail.tsx`, `selection.ts` and `criteria-rail.test.tsx` exist on disk.
- Commits `fba2352` and `1b65d20` are in `git log`; `git rev-list --count` from `plan_head_before` is 2.
