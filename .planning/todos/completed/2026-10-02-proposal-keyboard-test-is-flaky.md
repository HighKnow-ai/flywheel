---
created: 2026-10-02T00:00:00.000Z
resolved: 2026-10-04T00:00:00.000Z
title: proposal-keyboard test fails intermittently in the desktop suite
area: testing
severity: major
status: resolved
resolution_commit: c5f2c1e
files:
  - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
---

## What

`src/authoring/__tests__/proposal-keyboard.test.tsx > the proposal tray's keyboard region >
each of the four keys dispatches its action on the focused (selected) row` failed
intermittently — roughly 1 run in 5 when first observed during Phase 7 wave 4, then
reliably (2 runs out of 2) by the end of wave 7.

## Root cause

Not a product defect, and not genuine nondeterminism in the component. `ProposalTray`
initialises `selectedId` to `null` and sets it to the first row inside an effect
(`ProposalTray.tsx:80-87`), which commits a render *after* the row and its "Accept" button
first appear. Each row's accept/reject/amend verbs are gated on `selected`
(`ProposalRow.tsx:279-294`).

The test waited only for the Accept button to be in the document, then immediately fired
`keyDown`. That left a window in which the key press landed while `selectedId` was still
`null` and every verb was gated off, so no backend call fired and the assertion saw only the
two initial load calls.

## Why the failure rate climbed

Phase 7 added roughly 38 desktop tests (600 → 638) and six new Rust integration test
binaries. The extra parallel jsdom load slowed the selection effect's flush enough to turn a
race that usually won into one that reliably lost. Phase 7 did not touch
`packages/desktop/src/authoring/` at all — it changed the timing, not the code.

## Fix

Wait for selection to actually commit before dispatching keys, which is what the test's own
name claims it does. Selection is rendered as the row's focus-ring outline, so the test now
awaits a non-`none` outline on the row before firing. Confirmed by three consecutive full-suite
runs at 638/638, against two consecutive failures immediately before the change.

## Lesson for similar tests

Waiting on a rendered control is not the same as waiting on the state that gates it. Where a
keyboard verb is gated on selection or focus, assert the gate, not a sibling element that
renders a commit earlier.
