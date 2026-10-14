---
phase: 03-nothing-lost-nothing-left-running
plan: 18
subsystem: ui
tags: [react, worktree-removal, worktree-summary, useRef-guard, gap-closure]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: WorktreeRemovalDialog.tsx (plan 03-01), WorktreeSummary.tsx's missing-worktree banner (plan 03-09)
provides:
  - WorktreeRemovalDialog's handleRemove guarded by a synchronous removingRef, matching the ackActingRef/actingRef/answeringRef/killingRef pattern already established across RunsSection, WorktreeSummary, PermissionRequestCard, and OrphanRecoveryModal
  - WorktreeSummary's missing-worktree early return gated on status alone, closing the path where an empty/null/absent recorded path let a missing row fall through to the ordinary render and expose Remove Worktree
affects: [03-VERIFICATION.md anti-patterns table (useRef Warning row, missing-worktree-bypass Warning row)]

actuals:
  tokens: 3728
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Sixth sibling of the same re-entry-guard pattern (RunsSection's ackActingRef, WorktreeSummary's actingRef, PermissionRequestCard's answeringRef, OrphanRecoveryModal's killingRef, SessionSurface's stoppingRef): a boolean useRef checked synchronously before any state update, since removeState.removing/state.acting alone leaves a window where React has not yet flushed the disabled attribute before a second synchronous click fires."
    - "A pathless-safe body sentence: the banner computes isNonEmptyString(path) once and renders one of two complete sentences, never interpolating an empty value into fixed prose."

key-files:
  created: []
  modified:
    - packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx
    - packages/desktop/src/item-detail/WorktreeSummary.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx

key-decisions:
  - "removingRef is cleared only in the catch path, never on the success path — onClose() unmounts the dialog on success, and clearing there would reopen the exact window the guard exists to close."
  - "MissingWorktreeBanner's path prop widened to string | null | undefined; the banner itself decides which of two body sentences to render, rather than the caller pre-filtering an empty path before the component ever sees it."

patterns-established: []

requirements-completed: [WORK-03, WORK-06]

coverage:
  - id: D1
    description: "Three synchronous Remove clicks (raw .click(), never-resolving removal mutation) issue exactly one removal call; a rejected removal re-enables the button and stays retryable; a successful removal calls onClose exactly once."
    requirement: "WORK-03"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx#WorktreeRemovalDialog — re-entry guard (plan 03-18, T-03-18-01/T-03-18-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every row the database calls missing renders the decision banner (Recreate Worktree / Remove Record, no Remove Worktree) regardless of whether its recorded path is empty, null, or absent; the pathless banner reads as a complete sentence; a non-missing pathless row is not reclassified as missing."
    requirement: "WORK-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx#WorktreeSummary — missing worktree (WORK-06, D-45)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-09-16
status: complete
---

# Phase 03 Plan 18: Worktree Removal Re-entry Guard and Missing-Worktree Early-Return Gap Closure Summary

**Closed two confirmed defects: a `useRef`-less double-click guard on `WorktreeRemovalDialog`'s Remove button, and a `WorktreeSummary` missing-worktree early return that let a pathless `missing` row expose Remove Worktree.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-16T05:36:00Z (approx.)
- **Completed:** 2026-09-16T05:43:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `WorktreeRemovalDialog.tsx`'s `handleRemove` now guards on a synchronous `removingRef`
  (`useRef`), not `removeState.removing` alone — three raw `.click()`s in one tick, against a
  never-resolving removal mutation, now issue exactly one `worktreeRemove` call (previously 3).
  A rejected removal clears the ref in the catch path, keeping the Remove button retryable; a
  successful removal calls `onClose()` exactly once.
- `WorktreeSummary.tsx`'s missing-worktree early return now branches on `summary.status ===
  "missing"` alone — the `isNonEmptyString(summary.path)` conjunct is gone. A `missing` row with
  an empty string, `null`, or absent `path` now renders the decision banner (Recreate Worktree /
  Remove Record) with no Remove Worktree action reachable, exactly as the file's own doc comment
  already claimed. The banner's body sentence omits the location clause rather than interpolating
  an empty string when no usable path is recorded, while the populated case stays byte-identical
  to the pre-existing sentence.
- A non-missing row with an empty path was confirmed to still take the existing `hasPath`
  inline-notice path (`Path unavailable`) — this task did not reclassify an ordinary pathless
  ACTIVE row as missing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove Worktree means remove once** - `cb3370c` (fix)
2. **Task 2: A missing worktree is missing even when its recorded path is empty** - `8379cfb` (fix)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update)

## Files Created/Modified

- `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx` - `removingRef` synchronous re-entry guard on `handleRemove`, released in the catch path only
- `packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx` - three new tests: synchronous triple-click issues one call, rejected removal stays retryable, successful removal calls `onClose` once
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` - missing-worktree early return gated on `status` alone; `MissingWorktreeBanner`'s `path` prop widened; two-sentence body rendering
- `packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx` - six new tests: empty/null/absent path each reach the banner with no Remove Worktree; pathless sentence reads as a complete sentence; populated case stays byte-identical; non-missing pathless row is not reclassified

## Decisions Made

- `removingRef` clears only in the catch path (mirrors `WorktreeSummary.tsx`'s `actingRef` /
  `RunsSection.tsx`'s `ackActingRef` catch-path reset) — clearing on the success path would
  reopen the window the guard closes, since `onClose()` unmounts asynchronously relative to the
  resolved promise.
- The banner, not its caller, decides how to phrase a location it does not have: `path` is passed
  through unfiltered and `MissingWorktreeBanner` computes `isNonEmptyString(path)` once to choose
  between two complete sentences.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` instructions:
copy the existing `useRef`-guard pattern for Task 1, and drop one conjunct plus widen one prop
type for Task 2.

## Test Counts (RED → GREEN, plan-required disclosure)

- `worktree-removal.test.tsx`: 8 passed (pre-task) → confirmed RED (the synchronous triple-click
  test observed `worktreeRemoveMock` called **3 times** where 1 was expected, a live timeout on
  `waitFor`) → **11 passed** (post-task, +3).
- `worktree-summary.test.tsx`: 19 passed (pre-task) → confirmed RED (4 of 6 new tests failed
  against the unguarded component: the empty/null/absent-path cases each still found "Remove
  Worktree" reachable, and the pathless-sentence assertion found no matching text) → **25 passed**
  (post-task, +6).
- Early-return line, before and after (`packages/desktop/src/item-detail/WorktreeSummary.tsx`):
  - Before: `if (summary.status === "missing" && isNonEmptyString(summary.path)) {`
  - After: `if (summary.status === "missing") {`
- Full desktop suite: 431 passed (pre-task, 32 files) → **440 passed** (post-task, 32 files,
  zero failures) — clears the plan's ≥413 floor with room to spare.
- `cargo test -p core --test worktree_removal`: 7 passed, 0 failed — the backend refusal this
  plan's UI changes sit on top of is untouched.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

This closes the final gap-closure plan (03-18) of Phase 03, itself the last plan in the phase.
Re-running the phase verifier should now find both previously-flagged anti-pattern rows resolved:
the `useRef` Warning row (Task 1) and the missing-worktree-bypass Warning row (Task 2) in
`03-VERIFICATION.md`. No known blockers for closing out Phase 03.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-16*

## Self-Check: PASSED

- `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx` — FOUND
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` — FOUND
- `packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx` — FOUND
- `packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx` — FOUND
- Commit `cb3370c` — FOUND in `git log --oneline --all`
- Commit `8379cfb` — FOUND in `git log --oneline --all`
- `npm --prefix packages/desktop run test` — 440 passed, 0 failed (≥413 required)
- `npm --prefix packages/desktop run build` — exits 0, zero TypeScript diagnostics
- `cargo test -p core --test worktree_removal` — 7 passed, 0 failed
