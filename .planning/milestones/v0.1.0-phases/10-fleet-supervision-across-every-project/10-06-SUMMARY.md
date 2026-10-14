---
phase: 10-fleet-supervision-across-every-project
plan: 06
subsystem: fleet
tags: [react, zustand, keyboard, board, navigation]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-01 fleet surface, fleet branch below the session branch, initialStatus on SessionSurface; 10-05 blocked queue view and keyboard ownership"
provides:
  - "A fleet row's primary target: Enter or a click opens that run's session with run id, task id, stage, epic id and the row's status in one call"
  - "A fleet selection model (j/k/arrows, Enter) with a --selection-rule left rule"
  - "A secondary target: the subject key as its own button and the key b, reaching the row's board item in any project"
  - "pendingFocusItemId in useUiStore: a one-shot, read-and-clear cross-project focus request"
  - "BoardView consumes the request in its own effect, opens a collapsed group, and drops an unresolvable request"
  - "activeAgentRunInitialStatus in useUiStore, passed by App.tsx to SessionSurface"
affects: [10-07, 10-08, 10-09]

requirements-completed: [FLEET-03]

actuals:
  tokens: 14126
  tasks: 2
  commits: 2
plan_head_before: 45bdc2d0f85e3d66f4b036475811352126afa9c1
commits: 2

tech-stack:
  added: []
  patterns:
    - "A cross-surface request that must outlive a clearing effect is a one-shot store field read and cleared in one call, acted on by a separate effect declared after the clear"
    - "A bounded wait: a settled-window signal for the normal give-up, a deadline timer as the backstop"

key-files:
  created:
    - packages/desktop/src/fleet/__tests__/jump.test.tsx
    - packages/desktop/src/board/__tests__/board-pending-focus.test.tsx
  modified:
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/fleet/__tests__/fleet-spend.test.tsx
    - packages/desktop/src/state/__tests__/keyboard-fleet.test.ts

key-decisions:
  - "open-fleet-row-subject is bound to b (board item); Enter is a second new id, open-fleet-row. Neither collides with a, d or shift-a, and no dismiss key exists to avoid"
  - "The consume effect is declared after the project-change clear effect in BoardView, so the synchronous store clear has already run when it reads; the clear itself is unchanged"
  - "An unresolvable request is dropped when the window is the right project's (windowSettled), the epic roster has loaded and the id is in neither; a 4000 ms deadline backstops every other case"
  - "An epic-subject target routes to the detail panel (setDetailItemId), not to the review path"
  - "Dismissal still has no key: 10-04's constraint is restated, not lifted, now that rows have a selection model"

completed: 2026-10-12
status: complete

coverage:
  - id: D1
    description: "Enter or a click on a fleet row opens that run's session with run id, task id, authoring stage, epic id and the row's status together; a row with no subject opens it with nulls"
    requirement: FLEET-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/jump.test.tsx#the primary target: a row opens that run's session"
        status: pass
    human_judgment: false
  - id: D2
    description: "The fleet field is left set when a session opens, and the shell checks the session branch before the fleet branch, so the session's back action lands on the fleet"
    requirement: FLEET-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/jump.test.tsx#opening a session leaves the fleet open, so popping the session lands on the fleet"
        status: pass
    human_judgment: false
  - id: D3
    description: "A pending focus request survives BoardView's project-change clear, is consumed exactly once, is held for a later window, opens a collapsed group, and is dropped without opening anything when it cannot resolve"
    requirement: FLEET-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/board-pending-focus.test.tsx#pendingFocusItemId"
        status: pass
    human_judgment: false
  - id: D4
    description: "The subject key reaches its board item in another project and lands on its detail, never opens the session, and is absent on a row with no board subject or in an unreachable project"
    requirement: FLEET-03
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/jump.test.tsx#the secondary target: the subject key reaches its board item"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/state/__tests__/keyboard-fleet.test.ts#the fleet row jumps (plan 10-06, FLEET-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The jump works in the real shell and the subject button reads well at row density"
    verification: []
    human_judgment: true
    rationale: "No test mounts App.tsx with a switched project, and the look is an aesthetic judgement in a WKWebView with no WebDriver. Queued as D-REV-51, not observed."
---

# Phase 10 Plan 06: Fleet row jumps Summary

**Enter or a click on a fleet row opens that agent's live output in the right shape, and the subject key (or `b`) reaches its board item even in another project, through a one-shot `pendingFocusItemId` that outlives `BoardView`'s project-change clear.**

## What was built

1. **Primary target (`b8539b4`).** `FleetSurface` gained a selection model (`j`/`k`/arrows through the rows in drawn order, a 4px `--selection-rule` left rule on the selected row) and `Enter` or a row click calls `setActiveAgentRunId(runId, taskId, authoringStage, epicId, null, status)`. `status` is the raw run status, so an awaiting-review row opens as the `completed` run it is. `uiStore` carries it as `activeAgentRunInitialStatus` and `App.tsx` passes it to `SessionSurface` as `initialStatus`. The fleet field is never cleared, so the session's back lands on the fleet. Dismiss now stops its click from reaching the row.
2. **Secondary target (`9f8e7a3`).** The subject key renders as a button (`SubjectTarget`) only when the row has a board subject (`taskId ?? epicId`) and its project is reachable. It sets the current project, sets `pendingFocusItemId`, and closes the fleet. `b` does the same for the selected row. `BoardView` acts on the request in a separate effect.

## Required records

- **Key chosen for `open-fleet-row-subject`:** `b`, in the `fleet-surface` region. Enter is a second new id, `open-fleet-row`, which the plan did not name but the primary target needs. Both are refused on every layer except `fleet-surface`, and the uniqueness test passes.
- **Ordering of the consume effect against the clear.** The consume effect is declared after the project-keyed clear in `BoardView`. Effects run in declaration order and the clear writes to the store synchronously, so the consume effect reads state after the clear and its selection is the last write. A mutation that made the clear also wipe the pending request failed six of the nine board tests. The clear's lines are untouched in the diff.
- **Bound on an unresolvable request.** Two limits. (a) Give up immediately once `windowSettled` (new optional `BoardView` prop, `!isPlaceholderData` from `Board`), the epic roster has stopped loading, and the id is in neither the window nor the roster. (b) A 4000 ms deadline timer drops any request still pending, for cases no signal covers (a failed group fetch, a filter hiding the item). Neither opens anything.
- **Epic-subject routing.** To the detail panel, via `setDetailItemId`, not to the review path the palette's second entry uses. A test asserts `reviewSurface` stays null.
- **Constraint from 10-04.** Rows now have a selection model, but dismissal still has no key; restated in the `FleetSurface.tsx` header comment.

## Deviations from Plan

**1. [Rule 3 - Blocking] `App.tsx` and a new store field were needed for the status**
- **Found during:** Task 1
- **Issue:** 10-01 left `initialStatus` on `SessionSurface`, but nothing carried a status from a store call to the surface, and `App.tsx` is not in this plan's file list.
- **Fix:** `activeAgentRunInitialStatus` in `uiStore` (a sixth optional argument to `setActiveAgentRunId`, default null so other callers are unchanged), read and passed by `App.tsx`.
- **Commit:** b8539b4

**2. [Rule 3 - Blocking] A second new action id, `open-fleet-row`**
- **Issue:** Enter had no binding in the fleet region. The plan names only `open-fleet-row-subject`.
- **Fix:** added `open-fleet-row` (Enter) to the `ActionId` union, the region and the allow-list.
- **Commit:** b8539b4

**3. [Rule 2 - Missing critical] `BoardView` needed a settled-window signal**
- **Issue:** `useBoardQuery` keeps the previous project's rows while a switched-to project loads, so "the window settled" cannot be read from `items` alone. Judging a jump against those rows would drop it.
- **Fix:** optional `windowSettled` prop on `BoardView` (default true), passed by `Board` in `App.tsx`.
- **Commit:** 9f8e7a3

**4. [Rule 1 - Bug] A collapsed group hid the target**
- **Issue:** the epic lens starts every group collapsed and the status lens lets a band be collapsed, so a task in a collapsed group is in the window but not in any row, and the detail panel resolves only from rows.
- **Fix:** the consume effect opens the item's group when it is closed, and only then, so an open group still waiting on its fetch cannot loop. Covered by a test.
- **Commit:** 9f8e7a3

**5. [Rule 1 - Bug] Layer allow-list let the new ids through on the board layer**
- **Found during:** Task 2, by the new keyboard test.
- **Fix:** `bindingAllowedInLayer` refuses `open-fleet-row` and `open-fleet-row-subject` outside the fleet layer, the way it already refuses the review surface's ids.
- **Commit:** 9f8e7a3

**6. [Rule 3 - Blocking] `fleet-spend.test.tsx` selectors**
- **Issue:** three selectors took the first `button` in a row, which is now the subject button. Narrowed to `[data-field="dismiss"] button`. The assertions themselves are unchanged.
- **Commit:** 9f8e7a3

**Total deviations:** 6 (2 bugs, 1 missing-critical, 3 blocking). **Impact:** no change to scope; the epic-roster loaded check and the deadline are the only additions beyond the plan's described behaviour.

## Verification run

- `npm --prefix packages/desktop test`: 82 files, 1,397 tests passed. `npm --prefix packages/desktop run build`: clean. `cargo test -p desktop`: 110 passed (no Rust change).
- Gates: `setActiveAgentRunId` appears in `FleetSurface.tsx` outside comments; no `setFleetSurface(null)` before a session opens (the only call is in the subject jump, which leaves for the board); `pendingFocusItemId` appears at least three times in `uiStore.ts` and in `BoardView.tsx`; no removed line in `BoardView.tsx` clears selection, detail or delete; `open-fleet-row-subject` appears at least twice in `keyboard.ts`.
- Mutation: making the project-change clear also drop the pending request fails six of the nine `board-pending-focus` tests.

## Known Stubs

None.

## Threat Flags

None. T-10-06-01 (one-shot, asserted by the consumed-once test), T-10-06-02 (clear untouched, diff-gated) and T-10-06-04 (the target only writes store fields and stops its click) hold. An unreachable project's row exposes no target, so a held request cannot be stranded behind the relocate screen.

## Deferred review

D5 is queued as D-REV-51 in `.planning/DEFERRED-REVIEW.md` with `automatable: PARTLY`. It was not observed.

## Self-Check: PASSED

`jump.test.tsx` and `board-pending-focus.test.tsx` exist; commits `b8539b4` and `9f8e7a3` resolve; `commits: 2` is measured from `git rev-list --count 45bdc2d..HEAD`.
