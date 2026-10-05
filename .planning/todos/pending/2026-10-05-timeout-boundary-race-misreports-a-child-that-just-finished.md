---
created: 2026-10-05T16:31:00.000Z
title: Timeout-boundary race misreports a child that just finished as TimedOut
area: core
severity: minor
files:
  - packages/core/src/proc.rs:91-106
  - packages/core/src/proc.rs:108-131
source: phase-07 gap-closure code review (07-REVIEW.md, MED-01)
---

## Problem

`output_with_timeout`'s deadline loop breaks to the kill branch as soon as `try_wait()`
returns `None` and `start.elapsed() >= timeout`. There is no final `try_wait()` immediately
before `child.kill()`.

If the child exits — successfully or not — in the small window between the loop's last
`try_wait()` and the `kill()` call, the function still kills and waits on it and then
unconditionally returns `Err(TimedOut)`, discarding the child's real exit status and output.

For a call site like `fetch_origin` or a forge poll that completed its real work right at the
ceiling, a legitimate success (or a legitimate, informative failure) is reported as an opaque
timeout. That then propagates as "forge read failed… skipping this worktree without applying
an observation" rather than the actual result, so a poll that genuinely succeeded is thrown
away and the board goes another tick without the update.

The window is narrow, so this is unlikely to be seen often — but when it happens it is
invisible, and it discards real data rather than failing loudly.

## Why this is not a phase-07 blocker

It breaks no phase-07 roadmap success criterion, and the next tick recovers the observation
120s later. Filed rather than fixed in the gap-closure round under the project rule that a
phase closes on its roadmap success criteria, with other findings logged.

## Fix

Call `child.try_wait()` once more immediately before `child.kill()`. If it now reports
`Some(status)`, take the `Some` branch — join stdin/stdout/stderr and return the real
`Output` — instead of falling through to the timeout path.
