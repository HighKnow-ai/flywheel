---
created: 2026-10-16T00:00:00.000Z
title: Demo board does not exercise ci_failed, merged, or the task-row proposal mark
area: core
severity: minor
files:
  - packages/core/tests/bin/demo_board.rs
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

`ci_failed`, `merged` and the task-row proposal mark are not shown anywhere on the demonstration board, so design work cannot be judged on them and the owner was never shown them in the running application.

## Acceptance

- The seed report counts each, and the capture shows each on a surface that draws it.
