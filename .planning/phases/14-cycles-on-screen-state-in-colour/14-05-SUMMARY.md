---
phase: 14-cycles-on-screen-state-in-colour
plan: 05
subsystem: status-derivation
tags: [status, deriver, epic, ipc-surface, roster-gate, folded-todos]
status: complete
requires: ["14-01"]
provides:
  - "status_derivation::derive_epic_candidate (pure) and derive_epic_status_in_tx: epic status derived from its tasks under the task deriver's own max(candidate, current) floor"
  - "domain::epic::set_epic_status_in_tx: the single epics.status writer; set_epic_status wraps it"
  - "handler_roster.rs ROSTER_COUNT exact pin (144), asserted in both directions"
affects: [14-06]
tech-stack:
  added: []
  patterns: ["epic derived after its task inside derive_status_in_tx (no new trigger)", "named exact-count const with planted one-more / one-fewer / match cases"]
key-files:
  created: []
  modified:
    - packages/core/src/status_derivation.rs
    - packages/core/src/domain/epic.rs
    - packages/core/tests/status_derivation.rs
    - packages/core/tests/no_agent_status_write.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/tests/handler_roster.rs
key-decisions:
  - "D-13: an epic with no tasks has no candidate (None) and is left where it is; zero tasks is not 'all tasks done'"
  - "D-13: the epic deriver is invoked from derive_status_in_tx after the task derivation, for every non-Refused outcome, so it adds no scheduler, cron entry or interval"
  - "D-14: epic_set_status and task_set_status deleted (functions and roster entries); the domain writers remain for seeding and tests"
requirements-completed: [RECD-08]
commits: 4
plan_head_before: c390ec4bc5868e5f1936ffe4e453df0766633459
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
duration: 25 min
completed: 2026-10-15
---

# Phase 14 Plan 05: Epic status derived, set-status commands deleted Summary

Epic status is derived from its tasks under the same forward-only floor as the task deriver, and the two unused IPC status writers are deleted with the command roster pinned to an exact count.

## Both folded todos are resolved

- **D-13 (epic status has no writer after StatusPicker deletion):** resolved. `derive_epic_status_in_tx` is the one machine writer of `epics.status`.
- **D-14 (task_set_status and epic_set_status remain IPC-reachable):** resolved. Both commands are gone and the roster count is pinned exactly. This closes Phase 13 criterion 3 in structure, not only in practice.

Both todo files moved from `.planning/todos/pending/` to `.planning/todos/completed/`, each noting plan 14-05 and its commit.

## What was built

**Task 1 (D-13).** `derive_epic_candidate` is pure: `in_progress` if any task is; `done` if all done; `in_review` if all are in_review/done; `todo` if any todo; else `backlog`; `None` for zero tasks. `derive_epic_status_in_tx` writes `max(candidate, current)` over `BAND_ORDER` via `band_rank`, so `done` is terminal as a consequence of the floor and a status a human set stands until the tasks' own candidate is higher. It runs inside `derive_status_in_tx` after the task derivation, in the same transaction, so there is no new trigger. `set_epic_status` was split so the deriver can compose into a caller's transaction (`set_epic_status_in_tx`). `no_agent_status_write.rs` now also scans `UPDATE epics SET status` with a planted half (one writer, `domain/epic.rs`).

**Task 2 (D-14).** `epic_set_status` and `task_set_status` command functions and roster lines deleted in one diff. `handler_roster.rs` replaces both `> 100` floors with `const ROSTER_COUNT: usize = 144`, with a sanity assert that the pin is above 100 and three planted cases (one more fails, one fewer fails, exact match passes).

## Roster counts

| | Count |
|---|---|
| Pre-change | 146 (confirmed by the RED run: "roster holds 146 commands but ROSTER_COUNT pins 144") |
| Post-change | 144 |
| Difference | 2 |

The plan text did not state a number; 146 was derived from the tree, after 14-01 and 14-02 had added commands.

Scheduler registration grep (`Job::new|cron|interval` in `scheduler.rs`): 7 before, 7 after (file untouched).

## TDD

RED `4b6783c6` (nine assertion failures against stubs, not unresolved imports), GREEN `650035ca`. Task 2 followed the same shape: the pin const was written first and failed on the real roster (146 vs 144), then the deletion made it pass (`6abeb1f3`).

## Deviations from Plan

None - plan executed exactly as written. One judgment call inside the plan: the empty-epic and human-lowered cases are tested through the `Fx` fixture, and the epic deriver also runs on an `Unchanged` task outcome (not only after a write), so an epic stale from before this change catches up on the next tick over any of its tasks.

## Verification

- `cargo test -p core --test status_derivation` 42 passed; `--test no_agent_status_write` 10 passed
- `cargo test -p core --test hierarchy_workflow --test epic_progress --test epic_roster --test status_transitions` all passed
- Core gates (`spine_pin`, `pm_vocabulary_gate`, `migration_safety`, `table_classification`, `db_bootstrap`, `--lib`) passed
- `cargo test -p desktop --test handler_roster` 5 passed
- `npx vitest run src/board/__tests__/workflow.test.tsx src/board/__tests__/ci-flag.test.tsx` 13 passed
- `cargo check --workspace` passes; the only warning (`StartRunOutcome` unread fields) is pre-existing
- `grep StatusPicker packages/desktop/src` returns nothing

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

All eight modified files present; commits `4b6783c6`, `650035ca`, `6abeb1f3` and the todo-filing commit exist.
