---
phase: 03-nothing-lost-nothing-left-running
plan: 01
subsystem: worktree-lifecycle
tags: [rust, tauri, react, tanstack-query, git, radix-ui]

requires:
  - phase: 02-supervised-agents-that-answer-for-themselves
    provides: worktree_summary/WorktreeSummary read path (WorktreeSummary.tsx, agent_runs.rs), the
      DeleteConfirm.tsx Radix overlay pattern, PermissionRequestCard.tsx's RowState idiom
provides:
  - "worktree_remove_check / worktree_remove Tauri commands: a fresh, never-cached porcelain read
    and a removal verb that re-checks porcelain itself before ever touching git"
  - "core::domain::worktree::remove_worktree_for_task / porcelain_entries / PorcelainEntry — the
    ONE removal call chain WORK-07 (Phase 10) and D-44 (plan 03-05) both call into"
  - "WorktreeRemovalDialog.tsx — Checking/Clean/Dirty overlay wired into WorktreeSummary.tsx"
affects: [03-05, phase-10]

actuals:
  tokens: 17594
  tasks: 3
  commits: 3
plan_head_before: 0f607c977e5ac24e16ea4f1104132d7a34d5fb1e

tech-stack:
  added: []
  patterns:
    - "Re-read-before-destroy: the domain function that performs a destructive git action
      (remove_worktree_for_task) re-reads the safety check itself rather than trusting an earlier
      renderer-side read, closing the check-then-act window structurally"
    - "Source-scanning no-escape-hatch gate (supervisor_cwd.rs's own idiom), applied to a
      product-level safety guarantee (D-43) rather than only a process-hygiene rule (PROC-02)"

key-files:
  created:
    - packages/core/tests/worktree_removal.rs
    - packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx
    - packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx
  modified:
    - packages/core/src/git.rs
    - packages/core/src/domain/worktree.rs
    - packages/core/src/query/agent_runs.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/WorktreeSummary.tsx
    - DESIGN.md

key-decisions:
  - "worktree_remove takes exactly two path parameters (repo_path, worktree_path) and no
    boolean/option/flag of any kind — there is no parameter anywhere in the call chain that could
    skip the dirty-tree guard (D-43), proven structurally by a source-scanning test"
  - "query::agent_runs::WorktreeSummary gained a task_key field (JOIN tasks) rather than a second
    query function, so worktree_remove_check reuses the existing read path instead of duplicating
    SQL; WorktreeSummaryDto's own wire shape (branch/path only) is unchanged"
  - "The Remove button uses PermissionRequestCard.tsx's RowState `{ removing, error }` idiom, not
    react-query's own isPending flag directly, matching the established codebase convention for a
    guarded, retry-friendly async action button"
  - "A partial/unparseable worktree_remove_check response (dirtyCount>0 with empty entries, or an
    entry with an empty path) renders the Dirty refusal with a 'this list may be incomplete' note
    rather than the Clean confirm — fail-closed per the UI-SPEC's E1 partial backstop"

requirements-completed: [WORK-03]

coverage:
  - id: D1
    description: "A clean worktree is removed end to end: directory deleted from disk, worktrees row deleted, one worktree.removed event appended"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_removal.rs#removing_a_clean_worktree_deletes_it_from_disk_and_the_database_and_appends_one_event"
        status: pass
    human_judgment: false
  - id: D2
    description: "A dirty worktree (modified or untracked file) is refused, with every porcelain entry surfaced and the worktree provably byte-identical afterwards"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_removal.rs#removing_a_worktree_with_a_modified_file_is_refused_and_leaves_everything_in_place"
        status: pass
      - kind: integration
        ref: "packages/core/tests/worktree_removal.rs#removing_a_worktree_with_only_an_untracked_file_is_also_refused"
        status: pass
      - kind: integration
        ref: "packages/core/tests/worktree_removal.rs#refusal_leaves_everything_untouched"
        status: pass
    human_judgment: false
  - id: D3
    description: "No force flag, stash path, or commit path exists anywhere in the removal call chain (D-43's structural no-escape-hatch)"
    requirement: "WORK-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_removal.rs#no_escape_hatch::the_removal_call_chain_carries_no_force_stash_or_commit_git_subcommand_token"
        status: pass
    human_judgment: false
  - id: D4
    description: "WorktreeRemovalDialog's Dirty state renders exactly one button, named OK — no 'Remove Anyway' path"
    verification:
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx#renders exactly one button in the Dirty state, and it is OK — D-43's structural no-escape-hatch"
        status: pass
    human_judgment: false
  - id: D5
    description: "WorktreeRemovalDialog visually matches DeleteConfirm.tsx's craft-floor-approved overlay/destructive-button treatment in the running desktop app"
    verification: []
    human_judgment: true
    rationale: "No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display available to this executor). The Impeccable design hook ran automatically on every edit and found no deterministic issues, but final visual confirmation in the packaged app is deferred to /gsd-verify-work per workflow.human_verify_mode: end-of-phase."

duration: 55min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 1: Worktree Removal and the Refusal That Guards It Summary

**`worktree_remove_check`/`worktree_remove` Tauri commands and a three-state `WorktreeRemovalDialog` that refuses to remove a dirty worktree by re-reading `git status --porcelain` inside the domain layer itself, with a source-scanning test proving no force/stash/commit escape hatch exists anywhere in the call chain.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-15T08:35:00Z
- **Completed:** 2026-09-15T09:30:00Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- `packages/core/src/git.rs` gained `git_status_porcelain`/`worktree_remove` — the latter carrying
  no boolean/option/flag parameter of any kind, so no caller anywhere can skip the dirty-tree guard
- `packages/core/src/domain/worktree.rs` gained `remove_worktree_for_task`, which re-reads
  porcelain itself (never trusting the renderer's earlier check) and, on a verified-clean tree,
  deletes the `worktrees` row and appends one `worktree.removed` event in a single transaction
- `WorktreeRemovalDialog.tsx` — one component, three states (Checking/Clean/Dirty), reusing
  `DeleteConfirm.tsx`'s exact Radix overlay pattern, wired into `WorktreeSummary.tsx`'s new "Remove
  Worktree" action
- A source-scanning `no_escape_hatch` test (in the style of `supervisor_cwd.rs`) proves zero
  force/stash/commit git-subcommand tokens exist anywhere in the removal call chain

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — Remove Worktree refuses a dirty worktree and removes a clean one** - `0ab44f6` (feat)
2. **Task 2: The refusal's full contract — status words, volume, plurals, and failing closed** - `3f47723` (test)
3. **Task 3: Prove the no-escape-hatch promise structurally, not by comment** - `f3c78c5` (test)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

_Note: Tasks 2/3 are TDD-flavored (tests + implementation together where the plan called for
test-first authoring); Task 1 is the tracer's single feat commit._

## Files Created/Modified

- `packages/core/src/git.rs` - `git_status_porcelain`, `worktree_remove` (no force parameter)
- `packages/core/src/domain/worktree.rs` - `PorcelainEntry`, `porcelain_entries`, `remove_worktree_for_task`
- `packages/core/src/query/agent_runs.rs` - `WorktreeSummary` now joins `tasks.key`
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `worktree_remove_check`, `worktree_remove` commands
- `packages/desktop/src-tauri/src/main.rs` - registers both commands in `generate_handler!`
- `packages/desktop/src-tauri/capabilities/default.json` - roster comment updated
- `packages/desktop/src/adapters/tauri.ts` - `PorcelainEntryDto`, `WorktreeRemovalCheckDto`, typed wrappers
- `packages/desktop/src/board/useBoardQuery.ts` - `useWorktreeRemovalCheck`, `useRemoveWorktree`
- `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx` - the new overlay (Checking/Clean/Dirty)
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` - "Remove Worktree" action + dialog wiring
- `packages/core/tests/worktree_removal.rs` - 7 tests (5 behavior + refusal snapshot + no-escape-hatch scan)
- `packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx` - 8 tests
- `DESIGN.md` - new Phase 3 Plan 01 entry recording the reused pattern, zero new token/mark

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

None — plan executed exactly as written. The plan's own discretion points (exact "list may be
incomplete" copy for the E1 `partial` backstop, and the RowState-vs-react-query-isPending choice
for the Remove button's guard) were resolved within the plan's own stated latitude, not as
deviations from a pinned contract.

## Issues Encountered

None. All four of Task 1's `<verify>` commands, Task 2's two `<verify>` commands, and Task 3's
three `<verify>` commands passed on first run after implementation; `cargo test --workspace` and
`npm --prefix packages/desktop run test` (full suites) were re-run after each task with zero
regressions (325 passed → 328 total assertions across both languages by the end of Task 3, no
failures at any point).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `remove_worktree_for_task`/`porcelain_entries`/`PorcelainEntry` are ready for plan 03-05 (D-44's
  task-delete-blocked-by-worktree message) and Phase 10's `WORK-07` to call into directly.
- The tracer feedback gate passed (all four Task 1 `<verify>` commands green) before Task 2/3
  expansion began — no broken foundation was built on.
- No blockers for the next plan in this phase.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
