---
created: 2026-10-16T00:00:00.000Z
title: Dark needs-you wash is not visible and cannot be inside the current contrast envelope
area: desktop
severity: minor
files:
  - packages/desktop/src/styles/tokens.css,packages/desktop/src/theme/tokens.ts,.planning/phases/14-cycles-on-screen-state-in-colour/14-DIRECTION.md
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

The dark needs-you wash cannot be seen against the dark ground. A bounded search found the best reachable value inside every gate gives a contrast ratio of 4.79 against 4.43 shipped, bounded by the dark brand text lift. Recorded in `14-DIRECTION.md`. The owner saw the board in Dark with this known and passed it.

Revisiting it needs the envelope itself to change, which is most likely the dark-first work in Phase 18 (VIS-05, VIS-08). No wash value can fix it alone.

## Acceptance

- Either the dark needs-you wash reads as a plate under `wash-visibility.test.ts`, or the dark row carries the fact another way and the direction document says so.
