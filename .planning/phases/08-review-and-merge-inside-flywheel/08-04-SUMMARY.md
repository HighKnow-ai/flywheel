---
phase: 08-review-and-merge-inside-flywheel
plan: 04
subsystem: review
tags: [react, keyboard, command-palette, session-surface]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "reviewSurface store field with label, review-surface layer and region (08-01)"
provides:
  - "open-review action id, bound to v in the board-list region"
  - "BoardView open-review case: scope from row kind, refuses any other kind"
  - "Command palette review entry beside the default detail entry for a resolved branch or sha"
  - "SessionSurface 'Review changes' offer on a terminal run that has a task id"
  - "expand-file refused in every layer except review-surface"
affects: [08-05, 08-06, 08-07, 08-08]

requirements-completed: [REVW-01, REVW-02]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 3f599ae9ed76a30413aa111ffff8110a1afe1ab7

coverage:
  - deliverable: "Board keystroke v opens task scope on a task row, epic scope on an epic row, nothing otherwise; layer gate"
    verification:
      - kind: test
        ref: "packages/desktop/src/board/__tests__/review-doors.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Palette review entry for a resolved branch name or sha; detail stays the default"
    verification:
      - kind: test
        ref: "packages/desktop/src/board/__tests__/review-doors.test.tsx"
        status: pass
      - kind: test
        ref: "packages/desktop/src/board/__tests__/command-palette-resolve.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Finished-run review offer on the session surface (terminal status and task id both required)"
    verification:
      - kind: test
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx"
        status: pass
    human_judgment: false
  - deliverable: "Placement and styling of the Review changes button in the session header"
    human_judgment: true
    rationale: "Visual judgement only; deferred to end-of-phase human verification."

tech-stack:
  added: []
  patterns:
    - "A door onto a surface is one store write; the surface chain does the navigation"

key-files:
  created:
    - packages/desktop/src/board/__tests__/review-doors.test.tsx
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/desktop/src/state/__tests__/keyboard-agent.test.ts

key-decisions:
  - "Key is v (r is taken); open-review is deliberately absent from REVIEW_SURFACE_ACTION_IDS"
  - "The palette review entry is labelled 'Review: <title>' without the item key, so the existing one-entry-per-key palette test keeps its meaning"
  - "The session offer passes the label 'This task' because the surface knows only the task id"

duration: 15min
completed: 2026-10-06
---

# Phase 8 Plan 04: Review Doors Summary

**Three more doors onto the review surface: `v` on a focused board card (task or epic scope by row kind), a review entry beside the palette's resolved branch/sha entry, and a "Review changes" button on a finished run, each one a single `setReviewSurface` write.**

## Accomplishments

- **Board keystroke.** `open-review` bound to `v` in the board-list region. `BoardView` derives the scope from the selected row (task or epic) and does nothing for any other kind or with no selection.
- **Palette.** A resolved branch name or sha now yields two entries: the existing detail entry first (unchanged default), then `Review: <title>`, which sets the project and the review surface in the right scope for the resolved kind and closes the palette.
- **Session surface.** A run in `completed`, `failed` or `interrupted` with a task id shows a "Review changes" button in the header. Running and blocked runs, and terminal runs without a task id, show nothing.
- **Tests.** `review-doors.test.tsx` (10 tests), plus 6 new cases in `session-surface.test.tsx`. Full desktop suite 667 passed, build clean.

## Task Commits

1. Task 1: `d6fa2e3` board keystroke
2. Task 2: `ab40cb0` palette route, session offer, doors and session tests

## Deviations from Plan

**1. [Rule 1 - Bug] `expand-file` fell through the layer gate to the board clause**
- **Found during:** Task 1 (the plan's "review surface's own expand actions remain refused in the board layer" test failed)
- **Issue:** 08-01 only restricted ids when the layer is `review-surface`; under the board layer `expand-file` was permitted.
- **Fix:** one line in `bindingAllowedInLayer` refusing `expand-file` outside the review layer. `move-down`/`move-up` are shared with the board and cannot be refused, so the plan's "movement" half does not hold and is not asserted.
- **Files modified:** `packages/desktop/src/state/keyboard.ts`
- **Commit:** d6fa2e3

**2. [Rule 3 - Blocking] `keyboard-agent.test.ts` pinned the exact board-list letter set**
- **Fix:** excluded `open-review` from that pinned set with a comment; the test still guards the Phase 1 letters.
- **Commit:** d6fa2e3

**3. Palette label omits the item key.** `command-palette-resolve.test.tsx` counts options containing the key and expects one; a key in the review label would break that. The title names the item.

**4. Issue row.** The board list never selects issues (the item kind is `task | epic`), so the issue refusal is structural; the test proves the action's own guard with a cast kind.

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), 2 minor. **Impact:** none on scope.

## Verification

- `npm --prefix packages/desktop run test`: 47 files, 667 tests passed. `npm --prefix packages/desktop run build`: no `error TS`.
- Greps: `key: "v"` appears once; `open-review` absent from `REVIEW_SURFACE_ACTION_IDS`; `setReviewSurface` on 2 lines of `SessionSurface.tsx`.

## Issues Encountered

None.

## Known Stubs

None.

## Next Phase Readiness

All four D-133 doors are open. Ready for the remaining Phase 8 plans.

## Self-Check: PASSED

- `review-doors.test.tsx` exists; commits `d6fa2e3` and `ab40cb0` in `git log`; `git rev-list --count` from `plan_head_before` is 2.
