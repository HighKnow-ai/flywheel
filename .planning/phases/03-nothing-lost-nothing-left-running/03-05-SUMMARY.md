---
phase: 03-nothing-lost-nothing-left-running
plan: 05
subsystem: database
tags: [rust, rusqlite, sqlite, task-deletion, agent-runs, foreign-keys]

# Dependency graph
requires:
  - phase: 03-01
    provides: "remove_worktree_for_task — the worktree-removal path D-40 was waiting for"
provides:
  - "delete_task's guard narrowed to worktree-only (D-44), superseding D-40's permanent block"
  - "Cascade of triggers/agent_runs/permission_requests on a permitted deletion, summarised by one task.history_deleted event"
  - "A fix to remove_worktree_for_task / forget_worktree_record: agent_runs.worktree_id is nulled before the worktrees row is deleted, closing a latent FK-constraint bug"
affects: [board-deletion-flows, worktree-removal, phase-3-verification]

actuals:
  tokens: 7805
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Cascade counts come from each DELETE statement's own affected-row return value, not a separate COUNT(*) query beforehand"
    - "One summarising event per multi-row cascade (task.history_deleted), not one event per deleted row"

key-files:
  created: []
  modified:
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/worktree.rs
    - packages/core/tests/task_delete_with_run_history.rs

key-decisions:
  - "D-44 disposition (Task 1 checkpoint): Option A — cascade triggers/agent_runs/permission_requests inside the same transaction as the task delete, once no worktrees row exists. Rationale (user's own): consistent with delete_task's existing acceptance-criteria cascade, leaves no unreachable rows, needs no migration; the append-only events log (no FK to tasks) is the durable non-repudiable record regardless, and it is never touched by the cascade."
  - "Session transcripts at <app-data>/sessions/<agent-run-id>.jsonl are LEFT ON DISK under Option A — they are files, not rows, referenced by no surviving row, and deleting a user-inspectable transcript as a side effect of a board deletion is exactly the silent destruction this phase refuses."
  - "Options B (keep blocking) and C (soft-delete tombstone) were considered and rejected by the user: B contradicts D-44's own wording and reinstates the permanently-undeletable task D-44 exists to fix; C's migration-plus-predicate blast radius across packages/core/src/query/ is out of proportion to this plan."

requirements-completed: [WORK-03]

coverage:
  - id: D1
    description: "Deleting a task with a live worktrees row is blocked, with a refusal that names the fix (remove the worktree first) rather than merely stating the block"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_with_a_worktree_is_blocked_and_names_the_fix"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deleting a task with recorded agent-run history but no worktree succeeds, cascading triggers/agent_runs/permission_requests in the same transaction with one summarising event"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_with_agent_run_history_but_no_worktree_succeeds_and_cascades_history"
        status: pass
    human_judgment: false
  - id: D3
    description: "No sequence of product actions deletes a task out from under uncommitted work: a dirty worktree blocks both the task delete and the worktree removal; once committed, both succeed in order"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#the_full_two_step_order_holds_end_to_end"
        status: pass
    human_judgment: false
  - id: D4
    description: "The append-only events log is never touched by a task deletion; the record of what an agent did survives the cascade"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_with_agent_run_history_but_no_worktree_succeeds_and_cascades_history"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/domain/task.rs | grep -c 'DELETE FROM events' == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The ordinary case (a task that never started work) is unchanged — no regression, no extra event"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_that_never_started_work_still_succeeds_with_no_history_event"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 5: Task Deletion Cascades Agent History Once No Worktree Remains Summary

**`delete_task`'s D-40 block narrows to a single worktree-only guard (D-44); a permitted deletion now cascades `triggers`/`agent_runs`/`permission_requests` in one transaction with one summarising event, and a latent FK bug in `remove_worktree_for_task`/`forget_worktree_record` that this plan's own test exposed is fixed alongside it.**

## Performance

- **Duration:** 25 min (continuation agent; resumed at Task 1's resolved decision)
- **Started:** 2026-09-15T00:00:00Z
- **Completed:** 2026-09-15T00:25:00Z
- **Tasks:** 2 (Task 1: checkpoint decision, resolved by the human before this agent started; Task 2: implementation)
- **Files modified:** 3

## Accomplishments

- Reopened D-40's deletion block per D-44: `delete_task` now bails only when a `worktrees` row exists for the task, with the exact Copywriting Contract sentence — `Cannot delete this task: a worktree exists for it. Remove the worktree first, then delete.`
- Once that guard clears, `permission_requests`, `agent_runs` and `triggers` rows for the task are deleted in the same transaction, in foreign-key-safe order, summarised by exactly one `task.history_deleted` event (never one per row)
- The append-only `events` log is provably untouched: a source-scanning verify command (`grep -c 'DELETE FROM events'` over non-comment lines) asserts zero occurrences, and a test compares the task's `events` row count before and after a cascading delete
- Discovered and fixed a latent bug (Rule 1/3 deviation, outside this plan's declared files): `remove_worktree_for_task` and `forget_worktree_record` both failed with a raw `FOREIGN KEY constraint failed` when deleting a `worktrees` row an `agent_runs.worktree_id` still pointed at — found by this plan's own two-step order test, not by any prior plan's coverage
- Full two-step order proven end to end: a dirty worktree blocks both `delete_task` and `remove_worktree_for_task`; committing the change lets both succeed in their required order

## Task Commits

Task 1 was a `checkpoint:decision` — no code changes, resolved by the human's response before this continuation agent started (see Decisions Made below). Task 2 is the sole code commit:

1. **Task 2: Implement the guard and the chosen disposition** - `4492db2` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md)

## Files Created/Modified

- `packages/core/src/domain/task.rs` - `delete_task`'s guard narrowed to worktree-only (D-44); cascades `permission_requests`/`agent_runs`/`triggers` and appends one `task.history_deleted` event on a permitted deletion with history
- `packages/core/src/domain/worktree.rs` - `remove_worktree_for_task` and `forget_worktree_record` now null `agent_runs.worktree_id` before deleting the `worktrees` row, closing the FK-constraint bug this plan's own test found
- `packages/core/tests/task_delete_with_run_history.rs` - rewritten against the D-44 contract: blocked-with-worktree, permitted-without-one with cascade assertions, no-history regression check, raw-constraint-message check, and the full two-step order test

## Decisions Made

- **D-44 disposition: Option A (cascade)**, decided by the human at Task 1's checkpoint. Rationale as given: consistent with `delete_task`'s existing cascade of acceptance criteria; a task the user deliberately deletes leaves no unreachable rows; needs no migration; the event log (`events.task_id` carries no foreign key to `tasks`) is the durable, non-repudiable record regardless of what happens to the projection tables.
- **Session transcripts left on disk.** `<app-data>/sessions/<agent-run-id>.jsonl` files (D-34) are not deleted by this path — they are files, not rows, named by run id and referenced by no surviving row after the cascade. Deleting a user-inspectable transcript as a side effect of deleting a board item is exactly the silent destruction this phase (D-42/D-43's "never silently drop a would-be-lost change" instinct) exists to refuse.
- **Options B and C rejected**, per the human's stated reasoning: Option B (keep blocking, narrow to worktree-only) contradicts D-44's own wording and reinstates the permanently-undeletable task D-44 exists to fix. Option C (soft-delete tombstone) needs its own migration plus a `WHERE deleted_at IS NULL` predicate across every query in `packages/core/src/query/` — out of proportion to this plan, which already covers Phase 3's WORK-03 requirement without it.
- **Accepted cost, stated explicitly by the human:** deleted tasks' run rows are no longer available for a future fleet/cost aggregation; recovery from an accidental deletion is the pre-migration backup set (`<app-data>/backups/`, D-18) and nothing more targeted. No undo affordance was built, matching the plan's own `<flagged_assumptions>`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Bug / Blocking] `remove_worktree_for_task` and `forget_worktree_record` failed with a raw FOREIGN KEY constraint error on a used worktree**
- **Found during:** Task 2, writing the full two-step order test
- **Issue:** `agent_runs.worktree_id` is a nullable `REFERENCES worktrees(id)`. Neither `remove_worktree_for_task` (plan 03-01) nor `forget_worktree_record` (plan 03-03) decoupled it before `DELETE FROM worktrees`, so removing a worktree that any agent run had ever used raised `Error code 787: constraint failed` — a real product bug this plan's own two-step order test (which is the plan's central proof) could not pass without fixing, and no prior plan's test coverage exercised worktree removal on a worktree an agent run had actually used.
- **Fix:** Both functions now run `UPDATE agent_runs SET worktree_id = NULL WHERE worktree_id = ?1` inside their existing transaction, immediately before `DELETE FROM worktrees`. `agent_runs.task_id` (the row's real history key) is untouched; only the now-defunct worktree pointer is cleared.
- **Files modified:** `packages/core/src/domain/worktree.rs`
- **Verification:** `cargo test -p core` (full suite, including `worktree_removal.rs`'s pre-existing 7 tests) passes; the new `the_full_two_step_order_holds_end_to_end` test specifically exercises this path (start a run, dirty the worktree, fail both guards, commit, remove the worktree, delete the task) and passes.
- **Committed in:** `4492db2` (part of the Task 2 commit — the fix lives in the same file the two-step order test requires to pass)

---

**Total deviations:** 1 auto-fixed (1 Rule 1/3 bug outside declared `files_modified`)
**Impact on plan:** Necessary for the plan's own central acceptance criterion (the two-step order test) to be provable at all. No scope creep beyond the two call sites sharing the identical root cause; `agent_runs.task_id` and all other columns are untouched.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-44 is closed: task deletion is no longer permanently blocked by agent-run history, and the worktree-first ordering this plan proves means no uncommitted work can ever be lost by a deletion.
- `remove_worktree_for_task`/`forget_worktree_record`'s FK fix is a general correctness improvement usable by any later plan that exercises worktree removal on a task with run history (e.g. the orphan-recovery flow, D-46 onward).
- No blockers for Phase 3's remaining plans.

## Self-Check: PASSED

- `packages/core/src/domain/task.rs` — FOUND
- `packages/core/src/domain/worktree.rs` — FOUND
- `packages/core/tests/task_delete_with_run_history.rs` — FOUND
- Commit `4492db2` — FOUND (`git log --oneline --all | grep 4492db2`)
- `cargo test -p core --test task_delete_with_run_history` — 5 passed, 0 failed
- `cargo test -p core` — full suite green, no regressions
- `grep -c 'Remove the worktree first, then delete.' packages/core/src/domain/task.rs` == 1 — PASS
- `grep -v '^\s*//' packages/core/src/domain/task.rs | grep -c 'DELETE FROM events'` == 0 — PASS
- `grep -c 'agent_run_count' packages/core/src/domain/task.rs` == 0 (Option A) — PASS

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
