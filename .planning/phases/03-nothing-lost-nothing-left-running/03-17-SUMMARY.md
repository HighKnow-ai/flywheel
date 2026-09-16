---
phase: 03-nothing-lost-nothing-left-running
plan: 17
subsystem: ui
tags: [react, useRef, re-entry-guard, tdd, recovery, session-surface]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-10's OrphanRecoveryModal and D-46's undismissable-modal contract; 02-02's SessionSurface Stop control; 03-16's answeringRef sibling fix on PermissionRequestCard"
provides:
  - "A per-run synchronous re-entry guard (killingRef) on OrphanRecoveryModal's handleKill and handleKillAll"
  - "A synchronous re-entry guard (stoppingRef) on SessionSurface's handleStop"
affects: [03-VERIFICATION, recovery, session]

actuals:
  tokens: 3695
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Per-run Set<string> ref guard for a control that dispatches N concurrent calls (Kill All), generalising the single-boolean ref pattern (ackActingRef/answeringRef/actingRef) to the fan-out case"

key-files:
  created: []
  modified:
    - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
    - packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx

key-decisions:
  - "killingRef is a Set<string>, not a boolean, because Kill All dispatches one call per row concurrently by design — a single boolean would let the first dispatch suppress every sibling row."
  - "killOne releases the guard entry on the not-killed and thrown branches only, never on the killed branch — that row is removed from state and can never be re-activated, so deleting there would reopen the exact window the guard closes."
  - "stoppingRef is cleared only in handleStop's .catch path, never in .then — a successful stop drives status to a terminal value and the Stop button unmounts, so there is nothing left to guard; a failed stop must stay retryable, since the alternative is an agent that keeps spending."

requirements-completed: [PROC-04, PROC-05]

coverage:
  - id: D1
    description: "OrphanRecoveryModal's handleKill and handleKillAll each carry a per-run synchronous re-entry guard (killingRef), so three synchronous clicks issue exactly one orphanKill call per targeted row."
    requirement: "PROC-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx#OrphanRecoveryModal — synchronous double activation (03-17, T-03-17-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SessionSurface's handleStop carries a synchronous re-entry guard (stoppingRef), so three synchronous clicks send exactly one agent_run_stop command, and a rejected stop still leaves the control retryable."
    requirement: "PROC-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#SessionSurface Stop control (plan 02-02 Task 3, D-35)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-09-16
status: complete
---

# Phase 03 Plan 17: Process-termination re-entry guards Summary

**Kill and Stop now fire once per human click: a per-run `Set<string>` ref closes the Kill/Kill All fan-out gap, and a boolean ref closes the Stop gap — both found by real failing raw-`.click()` tests before the fix, mirroring the third and fourth sibling fixes of the same defect class this phase.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-16T13:26:00Z
- **Completed:** 2026-09-16T13:32:23Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `OrphanRecoveryModal.tsx`'s `handleKill` and `handleKillAll` now share a per-run `killingRef` (`useRef<Set<string>>`), closing T-03-17-01: three synchronous clicks of one row's Kill button issue exactly one `orphanKill` call; three synchronous clicks of Kill All issue exactly one call per targeted row; two rows clicked independently in the same tick each get their own call; a Kill All click followed by that same row's own Kill click in the same tick still produces only one call for that row.
- `killOne` releases the guard entry on the not-killed and thrown outcome branches, never on the killed branch (the row disappears there and can never be re-activated) — closing T-03-17-04 for this surface.
- `SessionSurface.tsx`'s `handleStop` now guards with `stoppingRef` (`useRef<boolean>`), closing T-03-17-03: three synchronous clicks send exactly one `agent_run_stop` command. The ref clears only on `.catch`, so a rejected stop still re-enables the control and a further click sends a second command — closing T-03-17-04 for this surface too.
- Every pre-existing guarantee on both surfaces is unchanged and still green: the recovery modal is still undismissable (Escape/click-outside/no close-dismiss-cancel button), still offers only Kill and Kill All, still seeds its row list exactly once, and the Stop control's status/warning handling from a successful stop is untouched.

## Task Commits

Each task followed the RED → GREEN TDD cycle with its own commits:

1. **Task 1 RED: failing tests for the orphan-kill guard** - `adda0f9` (test)
2. **Task 1 GREEN: per-run `killingRef` guard** - `646d2d3` (feat)
3. **Task 2 RED: failing test for the Stop guard** - `a303f50` (test)
4. **Task 2 GREEN: `stoppingRef` guard** - `c0c5350` (feat)

No REFACTOR commits — both implementations were minimal on first pass; nothing to clean up.

## Files Created/Modified

- `packages/desktop/src/recovery/OrphanRecoveryModal.tsx` - Added `killingRef` (`Set<string>`), guarded `handleKill`/`handleKillAll`, released the guard on the two non-terminal `killOne` outcome branches.
- `packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx` - Added a "synchronous double activation" describe block: 5 new tests (one-row triple-click, Kill-All triple-click, two-rows-independent, Kill-All-then-row-click, and a reject-then-Kill-All interplay check).
- `packages/desktop/src/session/SessionSurface.tsx` - Added `stoppingRef` (`boolean`), guarded `handleStop`, cleared only in `.catch`.
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` - Added 2 new tests to the existing Stop-control describe block (triple-click guard, re-enable-after-reject-then-second-call).

## Observed Call Counts (RED evidence)

**Task 1 — `orphan-recovery.test.tsx`** (pre-task: 18 passed → post-task: 23 passed, +5):

| Test | Expected calls | Received calls (first failing run) |
|---|---|---|
| One row's Kill clicked 3x synchronously | 1 | 3 |
| Kill All clicked 3x synchronously (2 rows) | 2 | 6 |
| Kill All then that row's own Kill in the same tick | 2 | 3 |

**Task 2 — `session-surface.test.tsx`** (pre-task: 34 passed → post-task: 36 passed, +2):

| Test | Expected calls | Received calls (first failing run) |
|---|---|---|
| Stop clicked 3x synchronously | 1 | 3 |

**Full suite:** 424 passed (pre-task HEAD) → 431 passed (post-task), +7 — matching the 5 + 2 new tests added across both files, zero regressions.

## Decisions Made

- `killingRef` is a `Set<string>`, not a single boolean, because `handleKillAll` dispatches one call per row concurrently by design; a boolean would let the first row's dispatch suppress every sibling row's dispatch.
- `killOne`'s guard release is asymmetric by outcome: released on the not-killed and thrown branches (the call is "over" and the row is still addressable), never on the killed branch (the row is removed from `rows` and can never be clicked again, so releasing there would only reopen the closing window pointlessly).
- `stoppingRef` clears only in `.catch`, matching the plan's explicit reasoning: a successful stop drives `status` to a terminal value, `showStop` goes false, and the Stop button unmounts — there is no second click to guard against on that path.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` sections were followed literally: the guard shapes, release semantics, and comment content all mirror `RunsSection.tsx`'s `ackActingRef` and `PermissionRequestCard.tsx`'s `answeringRef` as instructed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Closes 2 of the 4 Warning rows in 03-VERIFICATION.md's anti-patterns table that named a missing `useRef` guard on process-termination controls (`handleKill`/`handleKillAll` and `handleStop`); combined with 03-09's `actingRef` and 03-16's `answeringRef`, this closes the full set of known re-entry-guard gaps for this phase's process-termination surfaces.
- No blockers for the phase verifier re-run.

## Self-Check: PASSED

- FOUND: packages/desktop/src/recovery/OrphanRecoveryModal.tsx
- FOUND: packages/desktop/src/session/SessionSurface.tsx
- FOUND: .planning/phases/03-nothing-lost-nothing-left-running/03-17-SUMMARY.md
- FOUND commits: adda0f9, 646d2d3, a303f50, c0c5350

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-16*
