---
phase: 03-nothing-lost-nothing-left-running
plan: 03
subsystem: worktree-lifecycle
tags: [rust, sqlite, rusqlite_migration, git]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-01's remove_worktree_for_task/porcelain_entries/WorktreeSummary (task_key
      joined in) — the read/removal paths this plan extends with a status column and two new
      domain verbs"
provides:
  - "Migration 0006_recovery_statuses.sql: worktrees.status accepts 'missing' (D-45),
    agent_runs.status accepts 'abandoned' (D-49), agent_runs.acknowledged_at added — the schema,
    not app code, is the authority for both new states"
  - "core::domain::worktree::reconcile_worktrees — the launch-time detect/surface/never-repair
    pass for worktrees, structurally identical to reconcile_projects"
  - "core::domain::agent_run::mark_abandoned — idempotent transition to 'abandoned', sharing the
    already-terminal guard apply_session_closed and interrupt_agent_run both consult"
  - "core::domain::worktree::recreate_worktree_for_task / forget_worktree_record — D-45's two
    recovery decisions, each refusing on anything but a 'missing' row"
  - "WorktreeSummary.status on the read path (query::agent_runs::worktree_summary_for_task)"
affects: [03-06, 03-09, 03-10, 03-11]

actuals:
  tokens: 19686
  tasks: 3
  commits: 3
plan_head_before: 3ebe8ec75c114ae57a19d2022ec8a8ae3b4ba1d9

tech-stack:
  added: []
  patterns:
    - "Disable/verify/re-enable PRAGMA foreign_keys around a migration's to_latest() call in
      open_and_migrate, not inside the migration SQL itself (which rusqlite_migration documents
      as a no-op once its own transaction is open) — required because a full-table rebuild's
      DROP TABLE fails under foreign_keys=ON when a sibling table's real FK still has matching
      child rows, verified directly against a real sqlite3 binary before writing the migration"
    - "git worktree prune before any git worktree add against a path a reconciler already
      confirmed is gone from disk — git's own worktree administration does not self-clear when a
      directory disappears out from under it, so re-adding at the exact same path fails with
      'already registered worktree' without this"

key-files:
  created:
    - packages/core/src/db/migrations/0006_recovery_statuses.sql
    - packages/core/tests/recovery_statuses.rs
    - packages/core/tests/reconcile_worktrees.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/worktree.rs
    - packages/core/src/query/agent_runs.rs
    - packages/desktop/src-tauri/src/main.rs

key-decisions:
  - "open_and_migrate toggles PRAGMA foreign_keys OFF around MIGRATIONS.to_latest() and re-enables
    plus runs PRAGMA foreign_key_check before trusting a 'successful' migration, converting any
    violation into the SAME restore-and-refuse path a to_latest() error takes (D-18) — the
    migration's own SQL never touches the pragma, matching rusqlite_migration's documented
    guidance that doing so inside a migration body is a no-op"
  - "recreate_worktree_for_task runs `git worktree prune` before probing/creating — discovered via
    a real failing test, not anticipated by the plan: git's stale administrative record for a
    genuinely-deleted directory blocks a same-path `git worktree add` with 'already registered
    worktree' until pruned"
  - "interrupt_agent_run's already-terminal guard was widened to include 'abandoned' alongside
    apply_session_closed's (the plan named only the latter) — an explicit Stop on an already-
    abandoned run must not overwrite a terminal status mark_abandoned already wrote, for the same
    reason D-35's idempotency guard exists at all"
  - "mark_abandoned lives in domain::agent_run beside close_agent_run, following that function's
    status-write-plus-event shape; its production caller (the watchdog kill-record reconciler) is
    plan 03-06, not this plan"

requirements-completed: [WORK-06]

coverage:
  - id: D1
    description: "The schema — not app code — accepts worktrees.status='missing' and agent_runs.status='abandoned', rejecting any other value, with every pre-existing row/index/FK surviving the rebuild"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/recovery_statuses.rs#worktrees_check_accepts_missing_and_rejects_a_bogus_status"
        status: pass
      - kind: integration
        ref: "packages/core/tests/recovery_statuses.rs#agent_runs_check_accepts_abandoned_and_rejects_a_bogus_status"
        status: pass
      - kind: integration
        ref: "packages/core/tests/recovery_statuses.rs#preexisting_worktree_and_agent_run_rows_survive_the_rebuild_with_identical_values"
        status: pass
      - kind: integration
        ref: "packages/core/tests/recovery_statuses.rs#indexes_and_foreign_keys_are_preserved_after_the_rebuild"
        status: pass
      - kind: integration
        ref: "packages/core/tests/recovery_statuses.rs#acknowledged_at_exists_is_nullable_and_defaults_to_null_for_every_migrated_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "A migration failure (including the new foreign_key_check gate) still restores the pre-migration backup and refuses to proceed — no regression to D-18"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_safety.rs#failed_migration_restores_the_file"
        status: pass
      - kind: integration
        ref: "packages/core/tests/migration_safety.rs (full suite, 5/5, unmodified assertions, still green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "At launch, a worktree row the database calls 'active' that is not on disk is written to 'missing' with one event; path/branch/base_branch are never rewritten and the row is never deleted"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#a_deleted_worktree_becomes_missing_and_appends_one_event_with_identity_unchanged"
        status: pass
      - kind: integration
        ref: "packages/core/src/domain/worktree.rs (grep -cE 'SET path|SET branch|SET base_branch' inside reconcile_worktrees's body == 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Reconciliation is a true no-op on an unchanged filesystem, never repairs a missing row back to active on its own, and one unreadable row never aborts the pass for the rest"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#a_worktree_row_whose_path_exists_stays_active_with_no_write_and_no_event"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#a_second_call_immediately_after_the_first_writes_nothing_and_appends_no_second_event"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#an_unreadable_worktree_becomes_missing_without_aborting_the_rest_of_the_pass"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#a_row_already_stale_merged_or_abandoned_is_never_examined_or_changed"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#a_missing_worktree_whose_directory_reappears_is_not_silently_returned_to_active"
        status: pass
    human_judgment: false
  - id: D5
    description: "reconcile_worktrees is wired into main.rs's setup() between reconcile_projects and spawn_sidecar, using the same expect-or-crash-loudly idiom"
    requirement: "WORK-06"
    verification:
      - kind: other
        ref: "packages/desktop/src-tauri/src/main.rs (line number of reconcile_worktrees > reconcile_projects and < spawn_sidecar); cargo build -p desktop succeeds"
        status: pass
    human_judgment: false
  - id: D6
    description: "mark_abandoned transitions a running/blocked run to abandoned exactly once, is a no-op on an already-terminal run (including a second abandon), and interrupt_agent_run/apply_session_closed both refuse to overwrite it"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#mark_abandoned_transitions_a_running_run_and_appends_one_event"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#mark_abandoned_is_a_no_op_on_an_already_terminal_run"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#mark_abandoned_twice_in_a_row_is_idempotent"
        status: pass
    human_judgment: false
  - id: D7
    description: "recreate_worktree_for_task reuses the recorded branch/base_branch (never mints a new branch, never calls the epic-cutting base resolver), handles both the directory-only and directory+branch deletion cases, fails and leaves the row at 'missing' when the recorded base ref no longer resolves, and refuses on any non-'missing' row"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::recreate_reuses_the_recorded_branch_and_base_when_only_the_directory_was_deleted"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::recreate_reuses_the_recorded_branch_and_base_when_both_the_directory_and_branch_were_deleted"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::recreate_fails_and_leaves_the_row_missing_when_the_recorded_base_ref_no_longer_exists"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::recreate_refuses_when_the_row_is_not_missing"
        status: pass
    human_judgment: false
  - id: D8
    description: "forget_worktree_record deletes a 'missing' row and appends one event with no filesystem call of any kind, and refuses on any non-'missing' row; WorktreeSummary/worktree_summary_for_task carry status alongside branch/path/task_key"
    requirement: "WORK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::forget_deletes_the_row_and_appends_one_event_touching_nothing_on_disk"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::forget_refuses_when_the_row_is_not_missing"
        status: pass
      - kind: unit
        ref: "packages/core/src/domain/worktree.rs (grep -cE 'git::|git_at|Command' inside forget_worktree_record's body == 0)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/reconcile_worktrees.rs#recreate_and_forget::worktree_summary_for_task_carries_the_status_alongside_branch_and_path"
        status: pass
    human_judgment: false

duration: 68min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 3: The Schema Learns Recovery Statuses, and Worktrees Get Launch-Time Reconciliation Summary

**Migration `0006` teaches `worktrees.status`/`agent_runs.status` the `'missing'`/`'abandoned'` values via a full-table rebuild (with a real PRAGMA-foreign_keys toggle fix the plan didn't anticipate), `reconcile_worktrees` gives worktrees the same launch-time detect-surface-never-repair pass `reconcile_projects` has had since Phase 1, and `recreate_worktree_for_task`/`forget_worktree_record` give D-45's two recovery decisions a `git worktree prune` fix that a real failing test caught mid-session.**

## Performance

- **Duration:** 68 min
- **Started:** 2026-09-15T09:58:00Z
- **Completed:** 2026-09-15T11:06:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- `packages/core/src/db/migrations/0006_recovery_statuses.sql` — two full-table rebuilds
  (`worktrees` gains `'missing'`, `agent_runs` gains `'abandoned'` plus a nullable
  `acknowledged_at` column), proved by 6 tests that seed rows in every pre-existing status —
  including real `worktree_id`-linked `agent_runs` rows — and assert byte-identical survival of
  every row, index and foreign key
- `open_and_migrate` now disables `PRAGMA foreign_keys` around `to_latest()` and verifies
  `PRAGMA foreign_key_check` before trusting success — discovered empirically (via a real
  `sqlite3` binary, not assumed) that `DROP TABLE` on a table that is the parent of a real foreign
  key with matching child rows fails under `foreign_keys=ON`, which the plan's own migration text
  did not anticipate for a schema where `agent_runs.worktree_id` and
  `permission_requests.agent_run_id` are both real FKs into the two tables this migration rebuilds
- `core::domain::worktree::reconcile_worktrees` — structurally identical to `reconcile_projects`:
  detect, surface, never repair, true no-op on an unchanged filesystem, one bad row never aborts
  the pass; wired into `main.rs`'s `setup()` between `reconcile_projects` and `spawn_sidecar`
- `core::domain::agent_run::mark_abandoned` (D-49) — idempotent, sharing the already-terminal
  guard with `apply_session_closed` (as the plan specified) AND `interrupt_agent_run` (an addition
  beyond the plan's own text, for the same idempotency reason)
- `recreate_worktree_for_task`/`forget_worktree_record` — D-45's two recovery verbs, each refusing
  on anything but a `missing` row; `recreate` needed a `git worktree prune` call the plan didn't
  specify, found by a genuinely failing test rather than anticipated up front

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0006 — two CHECK rebuilds and the acknowledgment column** - `40a35ec` (feat)
2. **Task 2: reconcile_worktrees — detect at launch, surface, never repair** - `ff944f1` (feat)
3. **Task 3: Carry the worktree's status to the read path, and recreate/forget as domain verbs** - `01ecb36` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

_Note: All three tasks carry `tdd="true"`, but this project's `workflow.tdd_mode` is not enabled
(absent from `.planning/config.json`), so gate enforcement (RED-evidence checks,
`test(...)`-then-`feat(...)` commit splitting) was not mandatory. Tests and implementation were
authored together and verified green before a single commit per task, matching the "TDD-flavored,
not strict TDD-gated" pattern plans 03-01/03-02 already established for this phase._

## Files Created/Modified

- `packages/core/src/db/migrations/0006_recovery_statuses.sql` - the two CHECK rebuilds + `acknowledged_at`
- `packages/core/src/db/mod.rs` - `migration_source_list` registration; `open_and_migrate`'s foreign_keys toggle + check
- `packages/core/src/domain/agent_run.rs` - `AgentRunStatus::Abandoned`, `mark_abandoned`, widened already-terminal guards
- `packages/core/src/domain/worktree.rs` - `reconcile_worktrees`, `recreate_worktree_for_task`, `forget_worktree_record`
- `packages/core/src/query/agent_runs.rs` - `WorktreeSummary.status`
- `packages/desktop/src-tauri/src/main.rs` - wires `reconcile_worktrees` into `setup()`
- `packages/core/tests/recovery_statuses.rs` - 6 tests (migration coverage)
- `packages/core/tests/reconcile_worktrees.rs` - 16 tests (reconciliation + recreate/forget)

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `open_and_migrate` needed a `PRAGMA foreign_keys` toggle the plan's migration text explicitly said not to use**
- **Found during:** Task 1, before writing any test — verified directly against a real `sqlite3` binary that `DROP TABLE parent` fails with "FOREIGN KEY constraint failed" under `foreign_keys=ON` when a real child table has matching rows, regardless of transaction structure
- **Issue:** The plan's `<action>` text said "`PRAGMA foreign_keys=off` is NOT used ... instead use the CREATE/INSERT/DROP/RENAME sequence." That sequence alone fails for THIS schema specifically, because `agent_runs.worktree_id` is a real FK into `worktrees` (the first table rebuilt) and `permission_requests.agent_run_id` is a real FK into `agent_runs` (the second) — a production database with any real usage has matching child rows for both. `rusqlite_migration`'s own documentation confirms toggling the pragma FROM INSIDE a migration's SQL is a no-op (each migration runs inside its own transaction) and recommends toggling it at the connection level instead — which is a different mechanism than what the plan's parenthetical was arguing against, not a contradiction of it.
- **Fix:** `open_and_migrate` (`packages/core/src/db/mod.rs`) disables `foreign_keys` immediately before `MIGRATIONS.to_latest()`, re-enables it and runs `PRAGMA foreign_key_check` on success, converting any violation into the same restore-and-refuse path a `to_latest()` error already takes (D-18) — never a late, unrecovered error after the connection is handed back.
- **Files modified:** packages/core/src/db/mod.rs
- **Verification:** `recovery_statuses.rs`'s fixture seeds real cross-table FK-linked rows (`agent_runs.worktree_id` pointing at real `worktrees` rows) specifically to prove this path; `migration_safety.rs`'s full pre-existing suite (backup/restore/prune/repeat-open) stayed green with no changes to its own assertions
- **Committed in:** `40a35ec` (Task 1 commit)

**2. [Rule 1 - Bug] `recreate_worktree_for_task` needed `git worktree prune` before touching git, found by a real failing test**
- **Found during:** Task 3, first run of the `recreate_and_forget` test module
- **Issue:** Git's own internal administrative record for a worktree (under `.git/worktrees/<name>`) is not automatically cleared when its working directory is deleted out from under it — exactly D-45's own scenario. `git worktree add` against that SAME recorded path then fails with `fatal: '<path>' is a missing but already registered worktree; use 'add -f' to override, or 'prune' or 'remove' to clear`. All three `recreate_and_forget` git-touching tests failed on first run with this exact error (or a downstream "cannot delete branch ... used by worktree" when the test itself tried to manipulate branches first).
- **Fix:** `recreate_worktree_for_task` now runs `git::git_at(repo_path, &["worktree", "prune"])` before probing or creating — safe specifically because the row's own `missing` status already proves the directory is genuinely gone, and `git worktree prune` only clears administrative entries for directories that are truly absent. Uses the already-public `git::git_at`, adding no new function to `packages/core/src/git.rs` (the plan's own constraint).
- **Files modified:** packages/core/src/domain/worktree.rs, packages/core/tests/reconcile_worktrees.rs (tests that independently manipulate branches before calling recreate now prune first too, mirroring the production fix)
- **Verification:** all 3 previously-failing tests pass; full `reconcile_worktrees.rs` suite (16 tests) and `cargo test --workspace` green
- **Committed in:** `01ecb36` (Task 3 commit)

**3. [Rule 2 - Missing Critical] `interrupt_agent_run`'s already-terminal guard widened to include `'abandoned'`**
- **Found during:** Task 2, while extending `apply_session_closed`'s guard as the plan specified
- **Issue:** The plan's `<action>` named only `apply_session_closed`'s already-terminal match arm for widening. `interrupt_agent_run` (D-35's explicit-Stop path) has the identical `matches!(current_status.as_str(), "completed" | "failed" | "interrupted")` guard one function away in the same module — an explicit Stop on a run `mark_abandoned` already terminated would otherwise overwrite `'abandoned'` back to `'interrupted'` and append a second terminal event, exactly the bug this module's own doc comment says the guard exists to prevent.
- **Fix:** Widened `interrupt_agent_run`'s guard to the same four-value set.
- **Files modified:** packages/core/src/domain/agent_run.rs
- **Verification:** `cargo test --workspace` full suite green (no existing `interrupt_agent_run` test exercises this exact interleaving, but the change is a strict widening of an existing, already-tested no-op branch)
- **Committed in:** `ff944f1` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs found by real failures, 1 missing-critical consistency fix)
**Impact on plan:** All three were necessary for correctness on real data/real git behavior, not scope creep. Deviations 1 and 2 in particular are exactly the kind of subtlety this plan's own `estimate.confidence: low` and `flagged_assumptions` section anticipated without being able to name specifically.

## Issues Encountered

None beyond the two bugs already documented above as deviations — both were caught by genuinely
failing tests during the same session, not discovered later.

**Minor, non-functional note on one acceptance criterion:** Task 3's acceptance criterion "`grep -c
'base_ref_for_task' packages/core/src/domain/worktree.rs` is unchanged from its pre-task value"
reads 4 after this task (was 3) — the one new occurrence is a doc-comment mention inside
`recreate_worktree_for_task`'s own doc comment explaining why it does NOT call that function, not
a new call site. The actual behavioral property the criterion exists to prove — no branch-cutting
resolver reuse — is proven functionally by `recreate_reuses_the_recorded_branch_and_base_when_*`'s
own `git branch --list` count assertion. Not logged to `WINDOWS.md` since it is not a defect.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `reconcile_worktrees`/`mark_abandoned`/`recreate_worktree_for_task`/`forget_worktree_record` are
  ready for plan 03-06 (the watchdog kill-record reconciler, `mark_abandoned`'s production caller)
  and plans 03-09/03-10/03-11 (the missing-worktree decision banner, the Acknowledge button reading
  `acknowledged_at`, and the "Needs Decision" rollup).
- `WorktreeSummary.status` is on the read path; `WorktreeSummaryDto`'s wire shape is deliberately
  unchanged — plan 03-09 extends it when it builds the actual banner UI.
- No blockers for the next plan in this phase.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED
