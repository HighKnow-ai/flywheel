---
created: 2026-10-16T00:00:00.000Z
title: Demo seeder Cycle goals include the rest of the roadmap line
area: core
severity: minor
files:
  - packages/core/tests/bin/demo_board.rs
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

The seeder takes each Cycle goal from the roadmap and the text runs on into the following line (`Mode: mvp Depends on: ... Success Criteria (what must be TRUE):`). The goal clamp in the Cycle region makes this harmless to the region, but it makes the demonstration board's goals unrealistic, and the board is what design work is judged on (VIS-06).

## Acceptance

- Seeded Cycle goals end at the goal sentence; a test asserts none contains `Depends on`.
