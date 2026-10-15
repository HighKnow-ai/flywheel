---
created: 2026-10-16T00:00:00.000Z
title: App launch writes false agent_run.abandoned events into seeded runs
area: core
severity: minor
files:
  - packages/core/src/domain/agent_run.rs,packages/desktop/src-tauri/src/main.rs
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

Each app launch against the demonstration database writes three false `agent_run.abandoned` events into the seeded runs' event trail. Plan 14-03's `BEFORE UPDATE` trigger cancels the reconciler's status write for the seeded running and blocked runs, but `mark_abandoned` appends the event and a fallback summary before the status write is ignored. The status is what the surfaces read, so the board is right, but the activity trail of those runs carries an "abandoned" entry that is not true. Found by 14-10 when the capture launched the app twice.

## Acceptance

- Launching the app against the seeded database leaves each seeded run's event trail unchanged, covered by a test.
