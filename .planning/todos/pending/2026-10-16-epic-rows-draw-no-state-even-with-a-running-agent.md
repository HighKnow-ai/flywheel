---
created: 2026-10-16T00:00:00.000Z
title: Epic rows draw no state, even an epic with a running agent
area: desktop
severity: minor
files:
  - packages/desktop/src/board/BoardRow.tsx
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

Epic rows in the roster draw no state at all, including FLY-1015, which has a running agent. The task rows below it do. Whether epic rows should carry state is a per-surface budget question, so it needs an owner decision on which states an epic row earns before any code.

## Acceptance

- Decision recorded on which epic states are drawn, then a test that an epic with a running agent is not silent.
