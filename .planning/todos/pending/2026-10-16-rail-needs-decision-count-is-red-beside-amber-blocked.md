---
created: 2026-10-16T00:00:00.000Z
title: Rail 'Needs decision' count is red beside the amber 'Blocked' count
area: desktop
severity: minor
files:
  - packages/desktop/src/projects/ProjectRail.tsx
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

The project rail shows the review-queue 'Needs decision' count in red next to the amber 'Blocked' count. It is the same fact drawn in a different class beside its own pill. Plan 14-09 moved the row pills (needs-decision, CI-failed) onto StateBadge; the rail count is a figure, not a pill, and was not named by that plan.

## Acceptance

- The rail count takes its colour from the same state class as the row pill for the same fact.
