# Phase 11 deferred items

## Found by plan 11-14

### A refused "Approve and start" is invisible on any plan taller than the dialog

- File: `packages/desktop/src/dispatch/WavePlanSheet.tsx` (`approveError` renders at the end of `.wave-plan-body`, which scrolls).
- Evidence: `dispatch-layout.browser.test.tsx`, `it.fails("a failed approval is visible without scrolling the body")`. At 1440x900 a four-task draft is enough for the alert's bottom edge to sit about 50px below the body's visible bottom (797.8 vs 748.3).
- Effect: the user clicks Approve, the core refuses, Approve re-enables, and nothing visible changes unless they scroll to the bottom. Per-task edit refusals are not affected; they render beside the task being edited.
- Why not fixed in 11-14: pre-existing, not caused by this plan's changes, and the plan forbids restructuring that file (11-11 adds stuck-task rows to it in a later wave).
- Fix shape: render `approveError` in `.wave-plan-footer` beside the buttons, or scroll it into view. Flip the `it.fails` to `it` when done.

## Found by plan 11-15

### Back from a session opened on the fleet loses the selected row

- Files: `packages/desktop/src/fleet/FleetSurface.tsx` (`selectedRunId` is `useState` local to the surface), `packages/desktop/src/App.tsx` (the session branch renders instead of the fleet, so the surface unmounts).
- Evidence: `jump.test.tsx`, `it.fails("Back from the session returns to the fleet with the same row selected")`. The fleet does come back (asserted, passing); no row carries `data-selected` when it does.
- Effect: after reading one agent's session you press Back and the `j`/`k` selection starts again from nothing, so draining a queue of agents costs a re-navigation per agent. Not a wrong answer, a lost position.
- Why not fixed in 11-15: the plan is a test plan; the fix is a product change (hoist the selection into `uiStore`, or keep the surface mounted). The 10-CONTEXT decisions do not promise it, so it may be a deliberate omission: owner call.
- Fix shape: store `fleetSelectedRunId` in `uiStore` and read it as the initial value. Flip the `it.fails` to `it`.

### A finished run with an empty log opens a session that says "Starting session..."

- File: `packages/desktop/src/session/SessionSurface.tsx` (`StartingSessionRow` renders whenever `feedRows` is empty, regardless of run status).
- Evidence: `jump.test.tsx`, `it.fails("a finished run with no output opens a session that does not claim to be starting")`. The page text for a failed run with `total: 0` reads "Starting session... This run has ended. Nothing more will be added to this transcript."
- Effect: a run that failed before writing a line, or whose log was removed, shows a contradiction. The fleet row is a plain jump with no check that there is anything to open.
- Why not fixed in 11-15: pre-existing, in a file this plan does not edit.
- Fix shape: render `StartingSessionRow` only while the run is live; for a terminal run with an empty feed say that no output was recorded. Flip the `it.fails` to `it`.
