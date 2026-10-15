---
created: 2026-10-16T00:00:00.000Z
title: App shell content child has no min-width: 0
area: desktop
severity: minor
files:
  - packages/desktop/src/App.tsx:101,packages/desktop/src/App.tsx:395
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

The application shell's content child has no `min-width: 0` (`App.tsx` lines about 101 and 395). Any wide intrinsic content widens the whole board. Plan 14-09 hit this with a long goal and fixed the symptom (the goal clamp and the roster ladder) but not the shell.

## Acceptance

- A browser test that puts wide intrinsic content in the content child fails before the fix and passes after, with the board width unchanged.
