# Phase 11 deferred items

## Found by plan 11-14

### A refused "Approve and start" is invisible on any plan taller than the dialog

- File: `packages/desktop/src/dispatch/WavePlanSheet.tsx` (`approveError` renders at the end of `.wave-plan-body`, which scrolls).
- Evidence: `dispatch-layout.browser.test.tsx`, `it.fails("a failed approval is visible without scrolling the body")`. At 1440x900 a four-task draft is enough for the alert's bottom edge to sit about 50px below the body's visible bottom (797.8 vs 748.3).
- Effect: the user clicks Approve, the core refuses, Approve re-enables, and nothing visible changes unless they scroll to the bottom. Per-task edit refusals are not affected; they render beside the task being edited.
- Why not fixed in 11-14: pre-existing, not caused by this plan's changes, and the plan forbids restructuring that file (11-11 adds stuck-task rows to it in a later wave).
- Fix shape: render `approveError` in `.wave-plan-footer` beside the buttons, or scroll it into view. Flip the `it.fails` to `it` when done.
