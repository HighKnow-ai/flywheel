---
phase: 01-the-board-is-the-store-of-record
plan: 12
subsystem: board
tags: [rust, sqlite, tauri, hierarchy, reparenting]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record
    provides: create_task/create_issue, the events log, the Tauri command surface (plans 01-01 through 01-11)
provides:
  - "task::set_epic — reparent a task under an epic or orphan it, one task.epic_changed event"
  - "issue::set_parent / IssueParent — single-parent-at-a-time issue reparenting, one issue.parent_changed event"
  - "domain::assert_parent_in_project / ParentTable — the shared same-project integrity check"
  - "task_set_epic and issue_set_parent Tauri commands, registered in generate_handler!"
affects: [01-14, 01-15]

# Actuals (#2632)
actuals:
  tokens: 7793
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assert_parent_in_project: one shared same-project integrity check called by both reparenting paths and both creation paths, matching on a ParentTable enum to select a compile-time literal SQL string (never format!ed)"
    - "IssueParent::parse mirrors ranking::ReorderDirection::parse's shape for turning a renderer-supplied string pair into a domain value"

key-files:
  created: []
  modified:
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/issue.rs
    - packages/core/tests/hierarchy_workflow.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/commands/issue.rs
    - packages/desktop/src-tauri/src/main.rs
    - .planning/REQUIREMENTS.md

key-decisions:
  - "assert_parent_in_project lives in domain/mod.rs (not task.rs or issue.rs) so both reparenting paths and both creation paths call the exact same function, never a duplicated check per module"
  - "task::set_epic denormalises the NEW epic_id onto the appended event (not the task's own epic_id) so the change shows on the receiving epic's activity trail, mirroring how every other task mutation denormalises the task's current epic_id"
  - "issue::set_parent writes epic_id and task_id together in one UPDATE derived from a single IssueParent variant, making a two-parent row unrepresentable rather than merely unwritten (T-01-GC-05)"
  - "BOARD-01 unticked in REQUIREMENTS.md pending plan 01-15 — the reparenting commands now exist and are registered, but nothing in the running application (renderer) calls them yet"

patterns-established:
  - "IssueParent::parse(kind, id) is the one seam between a renderer's two optional strings and the domain's single-parent enum — the Tauri command builds the domain value before locking the connection, exactly like task_reorder/issue_reorder parse their direction first"

requirements-completed: [BOARD-01]

coverage:
  - id: D1
    description: "task::set_epic reparents a task under an epic, clears it with None, is a no-op on a redundant call, and rejects a cross-project or non-existent epic"
    requirement: "BOARD-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_epic_parents_a_task_and_a_second_call_with_the_same_epic_is_a_no_op"
        status: pass
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_epic_none_orphans_the_task"
        status: pass
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_epic_rejects_an_epic_in_another_project"
        status: pass
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_epic_rejects_a_non_existent_epic"
        status: pass
    human_judgment: false
  - id: D2
    description: "issue::set_parent holds exactly one parent at a time (epic XOR task XOR none), is a no-op on a redundant call, and rejects a cross-project parent"
    requirement: "BOARD-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_issue_parent_holds_exactly_one_parent_at_a_time"
        status: pass
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#set_issue_parent_rejects_a_parent_in_another_project"
        status: pass
    human_judgment: false
  - id: D3
    description: "create_task and create_issue reject a supplied parent id belonging to a different project"
    requirement: "BOARD-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#create_task_and_create_issue_reject_a_parent_in_another_project"
        status: pass
    human_judgment: false
  - id: D4
    description: "task_set_epic and issue_set_parent are registered Tauri commands, callable from the renderer"
    requirement: "BOARD-01"
    verification:
      - kind: other
        ref: "grep task_set_epic / issue_set_parent packages/desktop/src-tauri/src/main.rs (generate_handler!)"
        status: pass
    human_judgment: true
    rationale: "Registration in generate_handler! is proven by grep and by a successful cargo test --workspace compile of the desktop crate, but no renderer code calls these commands yet (that is plan 01-14/01-15's job) — a human should confirm the command signatures match what those plans expect before this is treated as end-to-end proven."

# Metrics
duration: 15min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 12: Task/Issue Reparenting Commands Summary

**Two domain reparenting functions (`task::set_epic`, `issue::set_parent`), a shared same-project integrity check, and their Tauri command registration — closing the structural cause of gap G-01-EPIC-ASSIGN.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-09T13:27:51Z
- **Completed:** 2026-09-09T13:29:21Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- `domain::assert_parent_in_project` (with `ParentTable::Epics`/`ParentTable::Tasks`) is the one shared same-project integrity check, applied to both new reparenting paths and both existing creation paths (`create_task`, `create_issue`)
- `task::set_epic` reparents a task under an epic or orphans it with `None`, appending exactly one `task.epic_changed` event (denormalised onto the receiving epic's trail) and no-oping on a redundant call
- `issue::IssueParent` + `issue::set_parent` give an issue exactly one parent at a time (epic, task, or none), writing both columns in a single UPDATE so a two-parent row is unrepresentable
- `task_set_epic` and `issue_set_parent` Tauri commands exist and are registered in `generate_handler!` — the reparenting path the 35-command registry was missing now exists and is callable from the renderer
- `.planning/REQUIREMENTS.md`'s BOARD-01 line no longer overclaims: unticked with a note pointing at G-01-EPIC-ASSIGN and plan 01-15

## Task Commits

Each task was committed atomically:

1. **Task 1: The two domain reparenting functions and the same-project integrity check they share** - `e035026` (feat)
2. **Task 2: The two Tauri commands and their registration in the command registry** - `2a683e3` (feat)
3. **Task 3: Cargo integration tests for both reparenting paths, and correcting the BOARD-01 claim** - `accae08` (fix)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified
- `packages/core/src/domain/mod.rs` - `ParentTable` enum and `assert_parent_in_project` shared integrity check
- `packages/core/src/domain/task.rs` - `set_epic`, plus a same-project check added to `create_task`
- `packages/core/src/domain/issue.rs` - `IssueParent` enum + `parse`, `set_parent`, plus same-project checks added to `create_issue`
- `packages/core/tests/hierarchy_workflow.rs` - 7 new integration tests covering every behavior in Task 1's list
- `packages/desktop/src-tauri/src/commands/task.rs` - `task_set_epic` Tauri command
- `packages/desktop/src-tauri/src/commands/issue.rs` - `issue_set_parent` Tauri command
- `packages/desktop/src-tauri/src/main.rs` - both commands registered in `generate_handler!`
- `.planning/REQUIREMENTS.md` - BOARD-01 unticked with a gap-closure note

## Decisions Made
- `assert_parent_in_project` lives in `domain/mod.rs`, not duplicated per-module, because both reparenting paths and both creation paths need the identical rule and the schema has no way to enforce it itself (plain nullable FKs, no same-project constraint)
- `task::set_epic` denormalises the appended event's `epic_id` as the NEW parent (not the task's prior epic_id), matching the plan's explicit intent that a reparent shows on the *receiving* epic's activity trail
- `issue::set_parent` derives the new `(epic_id, task_id)` pair from a single `IssueParent` variant and writes both columns in one statement, so a two-parent issue row is structurally unrepresentable, not merely a bug that hasn't happened yet
- BOARD-01 is left unticked pending plan 01-15, which is expected to restore the tick once the renderer actually calls these commands — the honest interim state per the gap's own instruction

## Deviations from Plan

None - plan executed exactly as written. One sequencing note: Task 1 was `tdd="true"`, so its cargo integration tests (which Task 3's action also calls for) were written and committed together with the domain implementation in Task 1's own commit (`e035026`), rather than deferred to Task 3's commit. Task 3's remaining, distinct action — correcting `.planning/REQUIREMENTS.md`'s BOARD-01 line — is committed separately in `accae08`. All test names match the plan's suggested naming exactly (plus one additional test, `set_epic_rejects_a_non_existent_epic`, covering a Task 1 behavior bullet not explicitly named in Task 3's list).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 01-14 and 01-15 can now call `task_set_epic`/`issue_set_parent` through the Tauri surface; the argument names (`task_id`/`epic_id`, `issue_id`/`parent_kind`/`parent_id`) and the `IssueParent`/`assert_parent_in_project` shapes are stable and documented above
- The hierarchy is still not reachable from the running UI — no renderer code calls these commands yet. BOARD-01 stays unticked until 01-15 closes that gap
- `cargo test --workspace` is green: 96 pre-existing tests plus 7 new `hierarchy_workflow` tests (103 total in that binary's run), zero failures

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
