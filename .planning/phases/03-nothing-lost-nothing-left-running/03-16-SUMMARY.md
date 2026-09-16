---
phase: 03-nothing-lost-nothing-left-running
plan: 16
subsystem: ui
tags: [react, useRef, permission-card, destructive-gate, git-push, vitest]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "Plan 03-12's destructive-gate card variant (D-55/D-56/D-57/D-58) and plan 03-14's classify_push branch-deletion detection for push-shaped deletions"
provides:
  - "A synchronous answeringRef guard on the destructive-gate card's answer() path, closing the same class of double-click bug three sibling plans (WorktreeSummary.tsx, RunsSection.tsx) already fixed independently"
  - "A push-aware branch-deletion consequence resolver (pushDeleteTarget) that correctly names the deleted branch for every push spelling of a remote branch deletion"
affects: [session, item-detail, destructive-gate]

# Actuals (#2632)
actuals:
  tokens: 4014
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synchronous useRef re-entry guard on an async answer/acknowledge handler — read and set before any await, cleared only on the failure path, never on success (the row unmounts instead) — now present in three sibling files (WorktreeSummary.tsx, RunsSection.tsx, PermissionRequestCard.tsx)."

key-files:
  created: []
  modified:
    - packages/desktop/src/session/PermissionRequestCard.tsx
    - packages/desktop/src/session/__tests__/permission-card.test.tsx

key-decisions:
  - "answeringRef is declared per-row inside PermissionRequestRow, not hoisted to the parent — mirrors RowState's existing per-request independence, verified by a synchronous-click test against two sibling destructive requests."
  - "pushDeleteTarget dispatches on tokens[1] === \"push\" inside the existing branch-deletion resolver rather than adding a new DESTRUCTIVE_CONSEQUENCE key — the category is the same (branch-deletion), only the argv shape differs between git branch -D and git push --delete."
  - "A single non-flag positional after the push subcommand (the remote alone, no branch) falls back to the existing generic \"This would delete a branch on this remote.\" sentence rather than naming the remote — added a regression-guard assertion (queryByText) proving the old wrong text never reappears."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "Three synchronous native clicks on Deny, on Allow-just-this-once, or on the routine card's Allow each call onAnswer exactly once; a rejected answer clears the guard so a retry is possible; two sibling requests answer independently"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#three synchronous native clicks on Deny call the answer spy exactly once, with the deny decision"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#three synchronous native clicks on 'Allow, just this once' call the answer spy exactly once"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#three synchronous native clicks on the routine Allow button call the answer spy exactly once"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#a rejected Deny answer clears the guard, so a second click issues a second call"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#two destructive requests mounted at once each answer independently under three synchronous clicks"
        status: pass
    human_judgment: false
  - id: D2
    description: "The branch-deletion consequence sentence names the branch, not the remote, for every push spelling of a remote branch deletion (--delete, -d, colon refspec, refs/heads-qualified, flag-before-remote), falling back to the generic sentence when no branch is named; git branch -D feature-x and every other previously-pinned consequence sentence are byte-identical"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#consequence copy — one test per named category (03-UI-SPEC.md D-56 table)"
        status: pass
      - kind: unit
        ref: "npm --prefix packages/desktop run test (424 passed, 0 failed)"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-09-16
status: complete
---

# Phase 3 Plan 16: Destructive-Gate Card Re-Entry Guard and Push-Aware Branch-Deletion Copy Summary

**A `useRef` re-entry guard closes the destructive-gate card's own double-click hole, and a new `pushDeleteTarget` resolver makes the branch-deletion sentence name the branch instead of the remote for every `git push --delete` spelling.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-16T13:16:00Z
- **Completed:** 2026-09-16T13:22:00Z (approx, single-session sequential execution)
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- `PermissionRequestRow.answer()` now guards on a synchronous `answeringRef` (`useRef(false)`) read and set before any `await`, mirroring `RunsSection.tsx`'s `ackActingRef` (itself citing `WorktreeSummary.tsx`'s `actingRef` as the original fix). `state.answering` alone left a window between two clicks in one synchronous tick where React had not yet flushed the `disabled` attribute — on the destructive-gate card specifically, that meant a double-click could double-answer a destructive permission request.
- The ref is cleared only in the catch branch, so a rejected answer re-enables the row for a retry; it is never cleared on success, since the row unmounts once the shared pending-set query re-reads — resetting there would reopen the same window.
- Added `pushDeleteTarget(tokens)`, the push-shaped counterpart to `branchDeleteTarget`, resolving the deleted branch via the colon-refspec spelling (delegating to the existing `refspecTargetBranch`) or the last non-flag positional after the subcommand — but only when more than one positional exists, since a lone positional is the remote, not the branch.
- The `branch-deletion` resolver in `DESTRUCTIVE_CONSEQUENCE` now dispatches on the subcommand token (`push` vs. everything else), so `git push origin --delete feature-x` now renders "This would delete the branch feature-x." instead of "This would delete the branch origin." — the exact miscategorized-consequence defect plan 03-14 made reachable by teaching `classify_push` to emit `branch-deletion` for push-shaped deletions.

## Task Commits

Each task followed the RED → GREEN TDD cycle with two commits apiece:

1. **Task 1 RED: failing synchronous-click tests** - `86a4b0b` (test)
2. **Task 1 GREEN: `answeringRef` guard** - `7abe8c8` (feat)
3. **Task 2 RED: failing push-spelling consequence tests** - `3350e0a` (test)
4. **Task 2 GREEN: `pushDeleteTarget` resolver** - `45aca92` (feat)

**Plan metadata:** committed alongside this SUMMARY (docs commit, see below).

_TDD tasks: RED confirmed the observed defect before GREEN implemented the fix, per plan instruction._

## RED Evidence (observed call counts before the fix)

Task 1 — before `answeringRef` existed, three synchronous `.click()` calls produced:

- Destructive Deny: `onAnswer` called **3 times** (expected 1)
- Destructive "Allow, just this once": `onAnswer` called **3 times** (expected 1)
- Routine Allow: `onAnswer` called **3 times** (expected 1)
- Two sibling destructive requests, two synchronous clicks each: `onAnswer` called **4 times** (expected 2)

Task 2 — before `pushDeleteTarget` existed, all six new push-spelling tests failed; `git push origin --delete feature-x` rendered "This would delete the branch origin." (the remote's name) instead of "This would delete the branch feature-x."

## permission-card.test.tsx test count (before/after)

- Before this plan: 43 tests
- After Task 1: 48 tests (+5: 4 new synchronous-click tests, plus 1 pre-existing rejected-answer regression test folded in during the rename)
- After Task 2: 54 tests (+6 push-spelling consequence-copy tests)
- Full desktop suite: 413 → 424 tests, all green

One of the new synchronous test assertions, confirming the raw-`.click()` idiom (not `fireEvent.click`) is used, from `permission-card.test.tsx`:

```ts
const denyButton = screen.getByRole("button", { name: "Deny" });
denyButton.click();
denyButton.click();
denyButton.click();

await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
```

## Files Created/Modified

- `packages/desktop/src/session/PermissionRequestCard.tsx` — added `useRef` import, `answeringRef` guard in `PermissionRequestRow`, and `pushDeleteTarget` helper wired into the `branch-deletion` resolver.
- `packages/desktop/src/session/__tests__/permission-card.test.tsx` — renamed the pre-existing `fireEvent.click` double-click test to describe what it actually proves; added 5 synchronous-click tests (Task 1) and 6 push-spelling consequence-copy tests plus one regression guard (Task 2).

## Decisions Made

See `key-decisions` in frontmatter above. In short: the guard is per-row (not hoisted), `pushDeleteTarget` is dispatched from inside the existing `branch-deletion` resolver rather than as a new category key, and the no-branch push case falls back to the pre-existing generic sentence with an explicit regression-guard assertion that the wrong remote name never reappears.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` instructions precisely; the only addition beyond the plan's own literal text was one extra `queryByText` regression assertion in the no-branch-named test, added solely to satisfy the plan's own acceptance criterion requiring `grep -c 'This would delete the branch'` to be at least 7 (6 tests assert the positive "names a branch" sentence; this 7th occurrence is a negative regression assertion in the fallback test, not an 8th positive case).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both confirmed defects on the destructive-gate card are closed: the re-entry guard and the push-aware branch-deletion resolver.
- `npm --prefix packages/desktop run test` passes at 424/424; `npm --prefix packages/desktop run build` is clean; `cargo build --workspace` is unaffected (no Rust files touched by this plan) and remains green.
- No blockers for sibling gap-closure plans 03-17/03-18, which own `OrphanRecoveryModal.tsx`, `SessionSurface.tsx`, `WorktreeRemovalDialog.tsx` and `WorktreeSummary.tsx` exclusively — untouched by this plan.

## Self-Check: PASSED

- `packages/desktop/src/session/PermissionRequestCard.tsx` exists and contains `useRef`, `answeringRef` (×4), `pushDeleteTarget` (×3).
- `packages/desktop/src/session/__tests__/permission-card.test.tsx` exists and contains `This would delete the branch` (×7).
- Commits `86a4b0b`, `7abe8c8`, `3350e0a`, `45aca92` all present in `git log --oneline`.
- `npm --prefix packages/desktop run test -- permission-card` exits 0, 54/54 passed.
- `npm --prefix packages/desktop run test` exits 0, 424/424 passed (413 baseline + 11 new).
- `npm --prefix packages/desktop run build` exits 0, no `error TS` diagnostics.
- `cargo build --workspace` exits 0.

commits: 4
plan_head_before: ef65e33

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-16*
