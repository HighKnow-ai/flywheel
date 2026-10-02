---
created: 2026-10-02T00:00:00.000Z
title: proposal-keyboard test fails intermittently in the desktop suite
area: testing
severity: major
files:
  - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
---

## What

`src/authoring/__tests__/proposal-keyboard.test.tsx > the proposal tray's keyboard region >
each of the four keys dispatches its action on the focused (selected) row` fails
intermittently. Observed failing in 1 of 5 consecutive `npx vitest run` invocations on an
otherwise unchanged tree (599/600, then 600/600 on the next three runs, then 599/600 again).

## Why it matters

This suite is the post-merge test gate for every wave of every phase. An intermittent failure
in it means the gate cannot distinguish "this wave broke something" from "the flake fired
again", which is exactly the signal the gate exists to provide. It already cost one
investigation during Phase 7 wave 4.

## Provenance — not a Phase 7 regression

The file was last touched by `feat(05-07)` (the tray's keyboard region) and `feat(06-06)`
(typed hooks for merge/defer/bulk). Phase 7 never modified anything under
`packages/desktop/src/authoring/`. This is inherited intermittency from Phase 5/6, surfaced
by Phase 7's gate rather than caused by it.

## Likely shape

A keyboard-dispatch assertion racing a React state flush or a focus effect — the test asserts
four key actions against "the focused (selected) row", so whichever of focus-settling or
dispatch wins the race decides the outcome. Suspect a missing `await waitFor` / `act` around
the focus assertion rather than a product defect.

## Fix

Make the focus precondition explicit and awaited before dispatching keys, so the test cannot
observe a half-settled row. Confirm by running the single file 20x in a row green.
