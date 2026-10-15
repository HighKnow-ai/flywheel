---
created: 2026-10-15T00:00:00.000Z
title: task_set_status and epic_set_status remain IPC-reachable with no caller
area: desktop
severity: minor
resolves_phase: 14
resolved: 2026-10-15T00:00:00.000Z
status: resolved
resolution_plan: 14-05
resolution_commit: 6abeb1f3
files:
  - packages/desktop/src-tauri/src/commands/task.rs
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/desktop/src-tauri/src/main.rs
---

## Problem

Phase 13 criterion 3 requires that "a task's status is derived from git and forge state,
with the one non-derivable transition (backlog->todo) riding the acceptance of the task
itself and **no agent-writable path to any other status**".

Plan 13-07 removed the raw write in `start_agent_run` and deleted the UI control, so no
caller remains. But `task_set_status` and `epic_set_status` are **still registered Tauri
commands** in the `generate_handler!` roster. The path is unused, not absent.

Consequence: the criterion is satisfied in practice and not in structure. Anything that can
reach IPC — including a future surface, a test harness, or a sidecar tool wired by mistake —
can still set a task's status directly, bypassing the deriver and its floor. The
`no_agent_status_write.rs` gate asserts the absence of *source-level* writes; it does not
close the IPC surface.

Removing the commands was outside 13-07's declared file list, so the executor logged it
rather than widening scope.

## Why it is deferred to Phase 14

`epic_set_status` cannot be removed until the companion question is settled — whether epic
status becomes derived or keeps a human control (see the epic-status todo). Removing
`task_set_status` alone is safe and small, but the pair is best decided together so the
handler roster gate (13-04) is edited once.

## Acceptance

- `task_set_status` is unregistered, or allow-listed with its reason recorded in the same
  diff per the phase's allow-list convention.
- `epic_set_status` is unregistered or retained to match whatever epic status becomes.
- The 13-04 handler roster test is updated in the same diff (it pins the command count
  exactly, in both directions).

## Resolution

Closed by plan 14-05 (commit 6abeb1f3).
