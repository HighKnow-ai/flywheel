---
phase: 02-one-agent-one-worktree-watched-live
plan: 13
subsystem: database
tags: [rusqlite, sqlite, foreign-keys, task-deletion, regression-fix]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "0003_agent_runtime.sql / 0004_permission_gate.sql (triggers, worktrees, agent_runs, permission_requests tables) and domain::task::delete_task from plan 01"
provides:
  - "Decided, tested deletion semantics for a task with agent-run history — D-40, recorded in 02-CONTEXT.md"
  - "delete_task blocks deletion (does not cascade) when triggers/worktrees/agent_runs/permission_requests rows exist for the task, with a human-actionable Err message"
  - "packages/core/tests/task_delete_with_run_history.rs — the regression test CR-01 explicitly asked for"
affects: [phase-03-worktree-lifecycle, board-delete-action]

actuals:
  tokens: 4760
  tasks: 3
  commits: 3
  plan_head_before: 3245b5e06af2d20fcc7288d50259d7b820282fa2

tech-stack:
  added: []
  patterns:
    - "delete_task guards on agent-runtime row counts before mutating, inside its existing transaction — no new migration"

key-files:
  created:
    - packages/core/tests/task_delete_with_run_history.rs
  modified:
    - packages/core/src/domain/task.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - .planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md

key-decisions:
  - "D-40 (checkpoint, plan 02-13): Deleting a task with agent-run history is BLOCKED, with an actionable message — never cascaded. Human's verbatim answer: option-a — 'Block the deletion, with an actionable message.'"

requirements-completed: [DATA-06]

coverage:
  - id: D1
    description: "delete_task blocks deletion of a task with any triggers/worktrees/agent_runs/permission_requests row, returning a human-actionable Err (never a raw SQLite FOREIGN KEY message)"
    requirement: "DATA-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_with_agent_run_history_produces_the_decided_outcome"
        status: pass
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#no_task_delete_error_ever_contains_a_raw_sqlite_constraint_message"
        status: pass
    human_judgment: false
  - id: D2
    description: "A task with no agent-run history still deletes exactly as before this phase's regression (pre-existing feature preserved)"
    requirement: "DATA-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/task_delete_with_run_history.rs#deleting_a_task_that_never_started_work_still_succeeds"
        status: pass
      - kind: integration
        ref: "packages/core/tests/hierarchy_workflow.rs#delete_is_idempotent"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Task 1 decision checkpoint was answered by the human and recorded verbatim, both in the plan's context (D-40 in 02-CONTEXT.md) and in this SUMMARY"
    verification: []
    human_judgment: true
    rationale: "A recorded product decision is not something an automated check classifies as pass/fail — it is verified by a human reading the decision text against what was actually asked."

duration: 22min
completed: 2026-09-11
status: complete
---

# Phase 02 Plan 13: Block Task Deletion With Agent-Run History Summary

**`delete_task` now blocks (never cascades) deleting a task with any `triggers`/`worktrees`/`agent_runs`/`permission_requests` row, replacing SQLite's raw `FOREIGN KEY constraint failed` with a human-actionable message naming the agent-run count and worktree presence — closing CR-01 gap 3 / DATA-06.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-11T04:22:00Z (continuation after checkpoint resolution)
- **Completed:** 2026-09-11T04:44:00Z
- **Tasks:** 3 (1 checkpoint decision + 2 implementation/test tasks)
- **Files modified:** 4 (1 created, 3 modified)

## The Task 1 Checkpoint — Answered

**Decision:** What happens when the user deletes a task that has agent-run history — block the deletion, or cascade the agent-runtime rows?

**Human's verbatim answer:** `option-a` — "Block the deletion, with an actionable message." In the human's own framing: deletion refuses while the task still has rows in `triggers` / `worktrees` / `agent_runs` / `permission_requests`, but it must fail with a legible, actionable sentence naming what is holding it — NOT the raw `FOREIGN KEY constraint failed` SQLite message that surfaced before this plan.

**Reasoning accepted:** preserves the non-repudiable record of agent work (the product's core value), cannot orphan an on-disk worktree holding uncommitted changes, needs no migration, and stays cheap to revisit once Phase 3 adds a worktree-removal path. Accepted cost: a task started by mistake stays on the board until that path exists — but note today's behavior already blocked it; this only makes the error legible instead of newly forbidding anything.

Recorded as **D-40** in `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md`, alongside D-23 through D-39.

## Accomplishments

- `delete_task` (`packages/core/src/domain/task.rs`) counts rows in `triggers` (on `target_task_id`), `worktrees`, `agent_runs` and `permission_requests` for the task, inside its existing transaction, using four compile-time-literal `SELECT COUNT(*)` statements with a single bound parameter each. If any count is non-zero, it `anyhow::bail!`s (never `.context(...)`-wrapped) with a message naming the agent-run count and whether a worktree exists, telling the user what to do instead — no rows are touched, the transaction rolls back cleanly.
- `task_delete` (`packages/desktop/src-tauri/src/commands/task.rs`) already used `.map_err(|e| e.to_string())` with no intermediate wrapping, so the new bail message reaches the renderer verbatim; its doc comment now records this explicitly.
- `packages/core/tests/task_delete_with_run_history.rs` — the regression test CR-01 asked for: seeds a real git project, starts a real agent run (creating real `triggers`/`worktrees`/`agent_runs` rows and a real worktree under a scratch root), raises a real pending permission request, then asserts the blocked outcome — nothing destroyed, no `task.deleted` event, message names the run count and contains no `FOREIGN KEY` substring. A second test proves a task with no agent-run history still deletes exactly as before. A third test asserts the "no raw SQLite message" invariant holds under whichever outcome `delete_task` returns.
- A task with **no** agent-run history is completely unaffected: `cargo test -p core --test hierarchy_workflow` (18 tests, including the pre-existing `delete_is_idempotent`) still passes unchanged.

## Task Commits

Each task was committed atomically, following genuine TDD RED→GREEN ordering (the test file was written and proven to fail against the pre-fix `delete_task` before the fix was re-applied — see "TDD Gate Compliance" below for why the git-commit order differs from the plan's task numbering):

1. **Task 1: Decide the deletion semantics** — `61e32f1` (docs) — records D-40 (option-a) in `02-CONTEXT.md`.
2. **Task 3 content, committed as RED evidence** — `15153b8` (test) — `task_delete_with_run_history.rs` created and proven to fail against the pre-fix `delete_task` (2 passed, 1 failed — the target test).
3. **Task 2: Implement the decided semantics** — `abc1dd7` (feat) — the blocking guard in `delete_task`, re-applied after RED was captured; all three new tests now pass (GREEN), plus the full workspace suite.

**Plan metadata:** committed together with this SUMMARY.

_No REFACTOR commit — the initial GREEN implementation needed no cleanup._

## Files Created/Modified

- `packages/core/src/domain/task.rs` — `delete_task` gained the four-table history guard and an expanded doc comment recording D-40.
- `packages/desktop/src-tauri/src/commands/task.rs` — `task_delete`'s doc comment now records the new failure mode and confirms `e.to_string()` surfaces it unwrapped. No behavior change (the existing `.map_err(|e| e.to_string())` already surfaced it correctly).
- `packages/core/tests/task_delete_with_run_history.rs` — new integration test binary, 3 tests, `with_scratch_worktree_root` guard copied from `stop_lifecycle.rs`.
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — added D-40.

## Decisions Made

- **D-40** (see "The Task 1 Checkpoint — Answered" above): block, don't cascade. No migration; `0006_task_delete_semantics.sql` was NOT created (Option B's schema-level form does not apply).

## TDD Gate Compliance

Both Task 2 and Task 3 carry `tdd="true"`, but the plan's own task decomposition assigns implementation to Task 2 and all test-writing to Task 3 — the reverse of literal test-first ordering at the per-task level. To honor genuine RED→GREEN rather than a test-after-the-fact commit relabeled as `test(...)`, this executor:

1. Implemented Task 2's guard in the working tree (uncommitted).
2. Set the diff aside and reverted `packages/core/src/domain/task.rs` to its pre-fix state (`git checkout --` on that single file — the destructive-git prohibition's explicit single-file carve-out, not a blanket reset).
3. Wrote Task 3's full test file against the **pre-fix** code and ran it: `cargo test -p core --test task_delete_with_run_history` reported **2 passed, 1 failed** — the failing test was exactly the intended target, `deleting_a_task_with_agent_run_history_produces_the_decided_outcome`, failing on the assertion that the blocked-deletion message names the agent-run count (pre-fix `delete_task` only produced an opaque `"failed to delete task"` with no decided semantics). This is genuine RED evidence: a real, named test failed on the intended assertion, not a crash, syntax error, or unrelated failure.
4. Committed the test file alone as `test(02-13): ...` (RED gate commit).
5. Re-applied the Task 2 guard (`git apply` on the saved diff) and reran: `cargo test -p core --test task_delete_with_run_history` reported **3 passed, 0 failed** (GREEN).
6. Committed the implementation as `feat(02-13): ...` (GREEN gate commit).

Note: `gsd_run check tdd-red-evidence` was not invoked for this RED evidence — that tool's TAP-format parser (`parseNodeTestSummary`) targets Node's test runner output and does not parse Rust `cargo test`'s libtest text format. RED evidence is instead documented above (command, exit code, named failing test, and why it failed) and is reproducible by any reviewer via the two-commit sequence in git history. `workflow.tdd_mode` is not set in `.planning/config.json`, so the orchestrator-level RED/GREEN grep gate is not active for this project regardless.

| Plan | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 02-13 | ✓ (`15153b8`, manually verified — 2 passed/1 failed against pre-fix code) | ✓ (`abc1dd7`, 3 passed/0 failed) | — (none needed) | Pass |

## Deviations from Plan

### Auto-fixed Issues

None — the implementation matches the plan's Option A branch exactly as specified (`anyhow::bail!`, no `.context(...)`, four compile-time-literal `SELECT COUNT(*)` statements, message naming the agent-run count and worktree presence).

### Process note (not a code deviation)

**Git-commit ordering vs. task numbering.** The plan numbers Task 2 (implement) before Task 3 (test). To achieve genuine TDD RED→GREEN evidence (rather than writing tests against already-passing code, which cannot demonstrate a real RED phase), this executor wrote and committed the test file first — against a temporarily-reverted `task.rs` — then reapplied and committed the implementation. The final working tree and every acceptance criterion in both Task 2 and Task 3 are satisfied identically to what direct plan-order execution would have produced; only the git history's commit order (and thus which commit is `test(...)` vs `feat(...)`, and which came first) differs from a literal top-to-bottom reading of the plan. Documented here per the plan's own instruction that "the decision is recorded in the plan and in the SUMMARY, not left implicit."

---

**Total deviations:** 0 auto-fixed. **Impact:** none — a process/sequencing note only, no functional or scope change.

## Issues Encountered

- **Pre-existing `~/Flywheel/FLY` directory.** The plan's verification step `test -z "$(ls -A "$HOME/Flywheel" 2>/dev/null | grep -x FLY || true)"` fails on this development machine because `~/Flywheel/FLY` already existed, dated **2026-09-10 21:54** — before this session started and before any file this plan created. Confirmed via `find ~/Flywheel -newer <file created at session start>` returning nothing. This directory was NOT created by `task_delete_with_run_history.rs`'s tests (all three are wrapped in `with_scratch_worktree_root`, verified via `grep -c with_scratch_worktree_root` = 5, well above the required 4) — it is leftover from an earlier, unrelated test run on this machine, out of scope for this plan per the deviation rules' scope boundary (not caused by this plan's changes). Not fixed; not this plan's responsibility to clean up a developer machine's stray directory.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- CR-01 gap 3 (DATA-06) is closed: an explicit product decision about task deletion with agent-run history now exists (D-40), expressed in code (`delete_task`'s guard) and proven by a real integration test that starts an agent run and then deletes the task.
- Phase 3 ("Nothing Lost, Nothing Left Running") is the natural place to revisit D-40 once a worktree-removal action exists — at that point a task blocked by this guard gets an unblock path beyond "wait."
- No blockers for the remaining gap-closure plans in this round (`02-11` already landed; `02-12` and `02-14` own disjoint files and were not touched here).

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*
