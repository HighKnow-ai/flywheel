---
phase: 08-review-and-merge-inside-flywheel
plan: 03
subsystem: merge
tags: [rust, git, merge, worktree, sqlite-events]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "git::git_output_at (raw-output wrapper), review::review_files, seeded review fixture branches"
provides:
  - "git::merge_tree_check / MergePrecheck, merge_no_ff, merge_abort_if_in_progress, worktree_add_existing, push_branch"
  - "core::merge: MergePlan, MergeOutcome, plan_merge, run_merge, record_merge_event, ensure_epic_worktree, try_lock_epic / EpicMergeGuard, integrated_merge_commit, is_integrated"
  - "Event types task.integrated and task.merge_aborted (payload carries a label key)"
affects: [08-05, 08-07]

requirements-completed: [REVW-04]

duration: "~58 min"
completed: 2026-10-06

actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 8d3903be57e48dd3781004044be2361e126605c9

coverage:
  - deliverable: "Merge primitives: dry run that mutates nothing, --no-ff merge with abort-and-verify rollback, abort helper, existing-branch worktree add, plain push"
    verification:
      - kind: test
        ref: "packages/core/tests/review_merge.rs (14 git-level tests)"
        status: pass
    human_judgment: false
  - deliverable: "Task branch merges into the epic integration branch in a per-epic worktree; conflicts reported before anything is written; crash recovery; dirty-tree refusal; one event; no status write; per-epic lock; sequential merges both land"
    verification:
      - kind: test
        ref: "packages/core/tests/review_merge.rs (plan_merge_*, run_merge_*, record_merge_event_*, epic_merge_lock_*, two_sequential_merges_*)"
        status: pass
    human_judgment: false
  - deliverable: "Integrated marker derived from the recorded event plus live ancestry (empty branch, rewritten history, unresolvable commit, no-write)"
    verification:
      - kind: test
        ref: "packages/core/tests/review_merge.rs (marker_*)"
        status: pass
    human_judgment: false

key-files:
  created:
    - packages/core/src/merge.rs
    - packages/core/tests/review_merge.rs
  modified:
    - packages/core/src/git.rs
    - packages/core/src/lib.rs

key-decisions:
  - "A merge-tree exit 1 is a conflict only when stdout starts with a tree oid; an unknown ref also exits 1 (verified) with empty stdout and is an error"
  - "Per-epic lock lives in core::merge as a process-global set (not AppState); ceiling documented"
  - "Epic integration worktree has no table row; path derived as worktree root / key prefix / epic key, and an existing directory is reused only if it has a .git and is on the integration branch"
  - "GIT_TERMINAL_PROMPT=0 set once inside spawn_git rather than per push call"
---

# Phase 8 Plan 03: Merge in the core Summary

A task branch now merges into its epic's integration branch from the core, inside a per-epic worktree, with the conflict known before anything is written, a verified rollback if a started merge fails, one event, and no status write.

## Accomplishments

- **Git primitives (4c4c6a3).** `merge_tree_check` (dry run via `git merge-tree --write-tree`, conflict paths sorted and deduped), `merge_no_ff` (rolls back through the abort helper on any failure), `merge_abort_if_in_progress` (aborts then re-reads porcelain, a still-dirty tree is a loud named error), `worktree_add_existing` (copies `worktree_add`'s three refusals, prunes first), `push_branch` (plain push only, rejected non-ff and auth failures named, raw stderr logged not returned). All inside the one `spawn_git` construction site.
- **Three-half merge (16cc7c6).** `plan_merge` (connection) resolves and refuses by name (no branch, no epic, no integration branch cut, zero commits ahead); `run_merge` (no connection) runs the dry run first, so a conflict never creates or touches the epic worktree, then ensures the worktree, recovers a crash-left merge, refuses any other dirt, merges `--no-ff`; `record_merge_event` writes exactly one event in one transaction and never an UPDATE. `try_lock_epic` is a real mutual-exclusion guard.
- **Integrated marker (318692c).** `is_integrated` reads the recorded `task.integrated` event first, then a live `merge-base --is-ancestor`; an empty fresh branch, a reset integration branch and a fabricated sha all read as not integrated without an error.
- 37 tests in `packages/core/tests/review_merge.rs` (14 git-level, 16 merge, 7 marker) against real repositories.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | 4c4c6a3 | Merge git primitives |
| 2 | 16cc7c6 | merge.rs: plan / run / record, epic worktree, lock |
| 3 | 318692c | Integrated marker |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unknown ref made `merge_tree_check` report a false conflict**
- **Found during:** Task 1 (the nonexistent-ref test failed on first run)
- **Issue:** The plan states exit 1 means conflict and anything else is an error. Measured against git 2.54: an unknown ref ALSO exits 1, with empty stdout, and would have been reported as a conflict with no files.
- **Fix:** Exit 1 is a conflict only when stdout begins with a hex tree oid; otherwise it is an error carrying stderr.
- **Files modified:** packages/core/src/git.rs
- **Commit:** 4c4c6a3

**2. [Rule 3 - Blocking] `GIT_TERMINAL_PROMPT=0` added in `spawn_git`**
- The plan allowed this ("add it inside `spawn_git` if that is simpler"); recorded for visibility since it applies to every git call. supervisor_cwd gate still passes.

**Total deviations:** 1 auto-fixed bug, 1 plan-permitted placement choice. **Impact:** none on scope.

## Issues Encountered

- `cargo test --workspace` blocks forever on `packages/core/tests/credentials.rs`: it probes and mutates the real macOS Keychain entry and waits on a dialog in this unattended session. Pre-existing and environmental, not caused by this plan. Verification instead ran every other core test binary plus `--lib` (83 binaries, 0 failures) and `cargo test --workspace --exclude core` (0 failures), plus `cargo build --workspace`. The credentials binary was not run.
- `perf_seed_1000` and `worktree_lifecycle` (flagged flaky by 08-02) passed in this run.

## Follow-up (not implemented here, by plan)

- D-145 says the epic's merge carries its tasks to Done, but nothing in Phase 7 observes an epic request. An epic-request observer that carries an epic's tasks to Done when its request merges is needed in a later phase. This plan writes no status and adds no status writer. Should be filed as a backlog issue.

## Known Stubs

None. `push_branch` has no caller yet by design (plan 08-05 is its only caller).

## Threat Flags

None beyond the plan's `<threat_model>`. Mitigations verified: no `--force`/`--delete`/`--mirror`/`no-verify` in git.rs (grep gates), single `merge-tree` site, the task's own worktree compared unchanged across a merge, `worktree_add_existing` refuses a path equal to the repo or outside the worktree root.

## Next Phase Readiness

Plan 08-05 can call `push_branch`; plan 08-07 can call `plan_merge` / `run_merge` / `record_merge_event` / `try_lock_epic` / `is_integrated` from the command layer (resolve under the DB lock, drop it, then run).

## Self-Check: PASSED

Created files exist (merge.rs, review_merge.rs); commits 4c4c6a3, 16cc7c6, 318692c found; plan grep gates (single merge-tree site, no force/delete/mirror/no-verify, zero `UPDATE tasks|epics SET`, zero `ensure_epic_integration_branch`, exactly one `append_event`, one `pub mod merge;`, one `is-ancestor` in `is_integrated` below the event read) all hold.
