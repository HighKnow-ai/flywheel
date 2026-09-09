---
phase: 01-the-board-is-the-store-of-record
verified: 2026-09-09T09:29:11Z
status: gaps_found
score: 15/17 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-01-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-02-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-03-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-04-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-05-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-06-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-07-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-08-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-09-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-10-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-PLAN.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-11-SUMMARY.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-RESEARCH.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md"
  - ".planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md"
  - "DESIGN.md"
  - "packages/core/Cargo.toml"
  - "packages/core/src/db/backup.rs"
  - "packages/core/src/db/migrations/0002_board_schema.sql"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/domain/acceptance_criterion.rs"
  - "packages/core/src/domain/actor.rs"
  - "packages/core/src/domain/epic.rs"
  - "packages/core/src/domain/event.rs"
  - "packages/core/src/domain/issue.rs"
  - "packages/core/src/domain/mod.rs"
  - "packages/core/src/domain/project.rs"
  - "packages/core/src/domain/task.rs"
  - "packages/core/src/lib.rs"
  - "packages/core/src/marker.rs"
  - "packages/core/src/query/events.rs"
  - "packages/core/src/query/filter.rs"
  - "packages/core/src/query/mod.rs"
  - "packages/core/src/query/search.rs"
  - "packages/core/src/ranking.rs"
  - "packages/core/tests/activity_trail.rs"
  - "packages/core/tests/bin/crash_harness.rs"
  - "packages/core/tests/common/mod.rs"
  - "packages/core/tests/crash_safety.rs"
  - "packages/core/tests/criteria.rs"
  - "packages/core/tests/cursor_resume.rs"
  - "packages/core/tests/db_bootstrap.rs"
  - "packages/core/tests/fixtures/README.md"
  - "packages/core/tests/hierarchy_workflow.rs"
  - "packages/core/tests/migration_safety.rs"
  - "packages/core/tests/outbox.rs"
  - "packages/core/tests/perf_seed_1000.rs"
  - "packages/core/tests/project_reconciliation.rs"
  - "packages/core/tests/ranking.rs"
  - "packages/core/tests/search_filter.rs"
  - "packages/desktop/package-lock.json"
  - "packages/desktop/package.json"
  - "packages/desktop/src-tauri/Cargo.toml"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/actor.rs"
  - "packages/desktop/src-tauri/src/commands/board.rs"
  - "packages/desktop/src-tauri/src/commands/criterion.rs"
  - "packages/desktop/src-tauri/src/commands/epic.rs"
  - "packages/desktop/src-tauri/src/commands/events.rs"
  - "packages/desktop/src-tauri/src/commands/issue.rs"
  - "packages/desktop/src-tauri/src/commands/mod.rs"
  - "packages/desktop/src-tauri/src/commands/project.rs"
  - "packages/desktop/src-tauri/src/commands/task.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src-tauri/src/menu.rs"
  - "packages/desktop/src-tauri/src/state.rs"
  - "packages/desktop/src/App.css"
  - "packages/desktop/src/App.tsx"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/board/BoardRow.tsx"
  - "packages/desktop/src/board/BoardView.tsx"
  - "packages/desktop/src/board/CommandPalette.tsx"
  - "packages/desktop/src/board/DeleteConfirm.tsx"
  - "packages/desktop/src/board/DoneWarning.tsx"
  - "packages/desktop/src/board/FilterBar.tsx"
  - "packages/desktop/src/board/FirstRun.tsx"
  - "packages/desktop/src/board/IssuesLane.tsx"
  - "packages/desktop/src/board/QuickAdd.tsx"
  - "packages/desktop/src/board/StatusBand.tsx"
  - "packages/desktop/src/board/__tests__/board-view.test.tsx"
  - "packages/desktop/src/board/__tests__/filter.test.tsx"
  - "packages/desktop/src/board/__tests__/keyboard-nav.test.tsx"
  - "packages/desktop/src/board/__tests__/palette.test.tsx"
  - "packages/desktop/src/board/__tests__/reorder.test.tsx"
  - "packages/desktop/src/board/__tests__/workflow.test.tsx"
  - "packages/desktop/src/board/collapseStore.ts"
  - "packages/desktop/src/board/pickers/AssigneePicker.tsx"
  - "packages/desktop/src/board/pickers/EstimatePicker.tsx"
  - "packages/desktop/src/board/pickers/PriorityPicker.tsx"
  - "packages/desktop/src/board/pickers/StatusPicker.tsx"
  - "packages/desktop/src/board/useBoardQuery.ts"
  - "packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx"
  - "packages/desktop/src/item-detail/ActivityTrail.tsx"
  - "packages/desktop/src/item-detail/ItemDetailPanel.tsx"
  - "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/criteria.test.tsx"
  - "packages/desktop/src/legend/Legend.tsx"
  - "packages/desktop/src/legend/marks.ts"
  - "packages/desktop/src/projects/ProjectRail.tsx"
  - "packages/desktop/src/projects/ProjectUnreachable.tsx"
  - "packages/desktop/src/projects/RegisterProjectFlow.tsx"
  - "packages/desktop/src/projects/__tests__/project-rail.test.tsx"
  - "packages/desktop/src/state/keyboard.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/test/setup.ts"
covered_digest: "v1:sha256:887406a617a6ab93a6a9f5719f7b742320de76e2038d2827a9f8e5d6c3206de7"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "BOARD-01 — user can delete epics/tasks with no way to reconfigure the hierarchy"
    status: failed
    reason: >
      Deleting an epic or task that has any linked issue fails outright with a raw SQLite
      "FOREIGN KEY constraint failed" error, contradicting delete_epic's and delete_task's own
      doc comments ("Idempotent... Children are orphaned, never cascade-deleted... never fails").
      issues.epic_id and issues.task_id reference epics(id)/tasks(id) with the default NO ACTION
      FK action, foreign_keys=ON is set on every connection, and neither delete function clears
      the issues table before its own DELETE statement (it clears child *tasks* on epic delete,
      and its own criteria, but never issues). Reproduced directly against the compiled schema.
    artifacts:
      - path: "packages/core/src/domain/epic.rs"
        issue: "delete_epic (lines ~200-257) orphans child tasks but never runs `UPDATE issues SET epic_id = NULL ... WHERE epic_id = ?` before `DELETE FROM epics`"
      - path: "packages/core/src/domain/task.rs"
        issue: "delete_task (lines ~205-256) never runs `UPDATE issues SET task_id = NULL ... WHERE task_id = ?` before `DELETE FROM tasks`"
      - path: "packages/core/tests/hierarchy_workflow.rs"
        issue: "No test creates an issue linked to an epic/task and then deletes the parent — the failure path is untested and invisible to the green suite"
    missing:
      - "Orphan referencing issues.epic_id / issues.task_id inside delete_epic's and delete_task's existing transaction, before the DELETE FROM epics/tasks statement"
      - "A regression test mirroring hierarchy_workflow.rs's existing orphan-child-tasks test, but for a linked issue, asserting the delete succeeds and the issue's epic_id/task_id is NULL afterward"
  - truth: "BOARD-10 — user registers local git repositories as projects, with failures surfaced rather than silently swallowed"
    status: failed
    reason: >
      RegisterProjectFlow.tsx's useRegisterProjectFlow hook deliberately returns isError/error
      for the caller to render; only FirstRun.tsx (which bypasses the hook and calls
      useRegisterProject() directly) actually renders an error. App.tsx's ⌘⇧O handler,
      CommandPalette.tsx's "Register Project..." command, and ProjectRail.tsx's rail `+` button
      all destructure only { registerProjectFlow } and discard isError/error. A reachable failure
      exists: FirstRun.tsx's deriveKeyPrefix (reused by RegisterProjectFlow) has no minimum-length
      or leading-letter guard, so a directory name like "2024-app" or a 1-character name derives a
      prefix that fails domain/project.rs's validate_key_prefix (2-10 uppercase alnum, must start
      with a letter). On any of these 3 of 4 entry points, the folder picker just closes with zero
      feedback — no board, no error, no retry hint.
    artifacts:
      - path: "packages/desktop/src/App.tsx"
        issue: "line 94: `const { registerProjectFlow } = useRegisterProjectFlow();` — isError/error discarded"
      - path: "packages/desktop/src/board/CommandPalette.tsx"
        issue: "line 132: same discard pattern"
      - path: "packages/desktop/src/projects/ProjectRail.tsx"
        issue: "line 79: same discard pattern (the rail's `+` button, a primary registration entry point)"
    missing:
      - "Every caller of useRegisterProjectFlow renders isError/error (a transient toast/notice), matching the pattern App.tsx/ProjectRail.tsx already use for the alreadyRegistered notice"
      - "Harden FirstRun.tsx's deriveKeyPrefix to always emit a prefix that satisfies validate_key_prefix (pad short results, force a leading letter), so the common failure case is prevented outright rather than only handled"
human_verification:
  - test: "Launch a real `tauri dev` build and drive the entire board — create/edit/delete items, reorder, filter, search a project seeded past 1,000 items, open the command palette, register 2-3 real local repositories and switch between them with ⌘1-⌘9 — with the mouse untouched from start to finish."
    expected: "Every action from BOARD-01/02/04/05/06/07/09/10's plans is reachable and completes with no perceptible input lag or visual jank, matching 01-UI-SPEC.md's Performance Contract and each plan's own deferred <human-check> block."
    why_human: "Every plan from 01-04 onward (01-04, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11) explicitly deferred its own live tauri dev walkthrough — its SUMMARY records 'no confirmed GUI display / agent-spawning tool available to this executor' and defers the check to /gsd-verify-work. Only 01-01/01-02/01-03 captured real tauri dev screenshots. All server-side and component-level behavior is proven by 94 passing Rust tests and 51 passing Vitest tests, but 'no perceptible lag', full mouse-free operation end to end, and the actual visual read of the rack/legend/activity trail/epic pill have not been confirmed against a running window since early in the phase."
  - test: "Open a task that belongs to an epic on the board (not the detail panel) and read the epic reference in its row."
    expected: "A human-readable epic key/title, not a raw internal id."
    why_human: "Confirmed by code inspection, not disputed: BoardRow.tsx's epic-pill slot renders `{item.epicId ?? epicMark?.label ?? \"No epic\"}` — the raw 26-character epic_id ULID — because BoardRow is never passed an epicsById lookup the way FilterBar.tsx's epic filter chips are. This is a known, disclosed defect (WR-01), reported here as a human-facing check rather than a blocking gap because the underlying data (item.epicId, item.kind hierarchy) is correct and BOARD-01's CRUD/hierarchy truth does not depend on this specific row rendering — it degrades legibility, it does not break the hierarchy."
---

# Phase 1: The Board Is The Store Of Record Verification Report

**Phase Goal:** Cyril runs his real project structure on Flywheel's board — epics, tasks with
individually checkable acceptance criteria, and a workflow he cannot bend — and it is still
exactly there after a crash.

**Verified:** 2026-09-09T09:29:11Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

The repository is genuinely built out, not a stub: 94 Rust tests and 51 Vitest tests, all green
on a fresh run in this session (not trusted from SUMMARY claims — re-run directly, see Behavioral
Spot-Checks). The persistence layer (transactional outbox, ULIDs, actor model, crash safety,
migration safety, cursor-resumable event log) is unusually well tested for a Phase 1: several
suites exercise real behavior rather than presence — `crash_safety.rs` spawns a real child
process and sends it `SIGKILL`, `migration_safety.rs` builds a real N-1 schema fixture and proves
byte-identical backups and restore-on-failure, `cursor_resume.rs` proves the resumable stream is
gap-free and replay-equivalent to the live projection.

Two Critical defects — independently found by `01-REVIEW.md` and independently re-confirmed here
by reading the code directly, not by trusting the review's own text — sit squarely inside two of
this phase's five success criteria and are not covered by any override:

- **CR-01** makes deleting an epic or task **fail outright** the moment it has a linked issue —
  directly contradicting the delete functions' own "idempotent, never fails" contract and BOARD-01's
  "user can delete epics, tasks and issues." This is core-crate behavior, not a UI nicety, and is
  reachable through `issue_create`'s fully-supported `epic_id`/`task_id` parameters today (Phase 6's
  triage flow will link issues to epics/tasks routinely).
- **CR-02** means that registering a project through 3 of the app's 4 registration entry points
  (⌘⇧O, the command palette, the rail's `+`) gives **zero feedback** on failure — directly touching
  BOARD-10's "user registers... local git repositories as projects." A realistic failure mode
  (a derived key prefix starting with a digit, e.g. a folder named `2024-app`) is not hypothetical.

Because both are reachable, reproducible, documented-contract violations inside the specific
success criteria they touch — not defects incidental to the phase — this report does not round
them up to "passed because tests are green." Both fail the FAILED bar on their own; see Gaps.

Everything else checked — the transactional outbox, ULID identity, the actor model, fixed
workflow enforcement, criteria data model, fractional ranking, indexed search/filter, the
1,000-item performance budget (server-side), the activity trail's data path, and the project
marker/reconciliation model — holds up under direct code and test inspection. What remains
genuinely unconfirmed is the **live, running-window** experience: every plan from `01-04` onward
explicitly recorded that its own `<human-check>` walkthrough was never run against a real `tauri
dev` window in this execution environment (only `01-01`–`01-03` captured real screenshots). That
is reported honestly below as human verification, not silently marked passed.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DATA-01 — every mutation writes projection + event in one transaction | ✓ VERIFIED | `create_epic`/`create_task`/`create_issue`/`delete_epic`/`delete_task`/`set_*_status`/criterion mutations all call `append_event` inside the same `tx` they commit (`domain/*.rs`); `outbox.rs` and `hierarchy_workflow.rs` tests assert zero events on rollback and exactly one per real mutation |
| 2 | DATA-02 — every entity id is a client-generated ULID, never an auto-increment int | ✓ VERIFIED | `ids.rs::new_id` (monotonic ULID generator), every table's `id TEXT PRIMARY KEY CHECK (length(id) = 26)`; `ids.rs` and `db_bootstrap.rs` tests assert ascending/distinct ids within one millisecond |
| 3 | DATA-03 — humans and agents are distinct actors of one model, every mutation actor-attributed | ✓ VERIFIED | `migrations/0001_actors.sql`: `type TEXT NOT NULL CHECK (type IN ('human','agent','system'))`; `events.actor_id` is `NOT NULL` with an FK to `actors(id)`, `foreign_keys=ON` re-applied on every connection open (`db/mod.rs::apply_pragmas`) |
| 4 | DATA-05 — the event log is a gap-free, no-duplicate, resumable stream from a cursor | ✓ VERIFIED | `query/events.rs::events_since_cursor`; `cursor_resume.rs` — 5/5 tests including `cursor_batches_deliver_every_event_exactly_once` and `replay_reconstructs_the_projection`, a genuine behavioral proof, not presence |
| 5 | DATA-07 — the database survives an unclean termination with no loss/corruption of committed work | ✓ VERIFIED | `crash_safety.rs` spawns `crash_harness` as a real child process and sends real `SIGKILL`, both before- and after-commit; asserts `PRAGMA integrity_check` and exact row survival — a real behavioral test, not a pragma-presence check |
| 6 | DATA-08 — migrations run automatically on launch and are reversible within one version | ✓ VERIFIED | `migration_safety.rs` — 5/5 tests: N-1 fixture migrates forward with no data loss, backup byte-matches pre-migration file, a forced-bad migration restores the backup and refuses to open, repeat-open is a no-op, retention pruning is bounded |
| 7 | BOARD-01a — user creates and edits epics/tasks/issues in a fixed, non-reconfigurable 3-level hierarchy | ✓ VERIFIED | `domain/epic.rs`/`task.rs`/`issue.rs` CRUD; no settings screen, config file or affordance anywhere adds/removes a level (grepped the whole `packages/desktop/src` tree — none found); `hierarchy_workflow.rs` tests |
| 8 | BOARD-01b — deleting an epic or task never fails, orphaning (not cascading) linked issues | ✗ **FAILED** | See Gaps — CR-01: `delete_epic`/`delete_task` never orphan `issues.epic_id`/`issues.task_id`; `NO ACTION` FK + `foreign_keys=ON` makes the delete raise a raw SQLite error the moment any issue is linked to the parent |
| 9 | BOARD-02 — discrete, individually checkable acceptance criteria (statement + verification hint), not free prose | ✓ VERIFIED | `domain/acceptance_criterion.rs` — own table, own ULIDs, own rank; `criteria.rs` core tests (8/8) and `criteria.test.tsx` component tests (8/8); DoneWarning's copy defect noted separately (Anti-Patterns) — it does not break the checking/warning mechanism itself |
| 10 | BOARD-04 — fixed Backlog→Todo→In Progress→In Review→Done workflow, no reconfiguration path | ✓ VERIFIED | `domain/mod.rs::WORKFLOW_STATES` is the single source every picker and the schema `CHECK` constraint reads; `hierarchy_workflow.rs::redundant_status_transition_is_a_no_op` and an invalid-status-rejected-by-CHECK test both pass |
| 11 | BOARD-05 — reorder/reprioritize within an epic and within the backlog (fractional rank, priority tie-break) | ✓ VERIFIED | `ranking.rs::rank_after/rank_between/rank_before`; `ranking.rs` tests (8/8) — `priority_sorts_before_rank`, `a_move_rewrites_exactly_one_row`, `board_order_is_reproducible` |
| 12 | BOARD-06 — filter/search by text, status, epic, assignee as indexed SQL, no second client-side filter path | ✓ VERIFIED | `query/search.rs` (FTS5), `query/filter.rs`; `search_filter.rs` tests (8/8) including Unicode/FTS5-punctuation and empty-vs-no-match distinction; no second filtering pass found in the renderer (grepped `useBoardQuery.ts`/`FilterBar.tsx`) — known, disclosed limitation noted separately (Anti-Patterns: epic filter chip window) |
| 13 | BOARD-07 — every navigational and mutating action reachable entirely from the keyboard | ✓ VERIFIED (mechanism) | `state/keyboard.ts::BINDINGS`/`resolveBinding`, focus-region model, Escape ladder; `keyboard-nav.test.tsx` (7/7) including a genuine behavioral test of the state-transition invariant (`selection_follows_the_item_across_a_reorder`), `palette.test.tsx` proves palette command parity with `BINDINGS`. Full live mouse-free walkthrough not run — see Human Verification |
| 14 | BOARD-08 — board interactions complete without perceptible lag at 1,000+ items | ✓ VERIFIED (server) | `perf_seed_1000.rs`: real 1,000-item seed, unfiltered list/search/combined-filter each measured and asserted `< 50ms` server-side (01-UI-SPEC.md's own budget); `BoardView.tsx` uses one `useVirtualizer` call with no item-count branching (code-inspected, no threshold logic exists). Perceived UI lag in a live 1,000-item window not run — see Human Verification |
| 15 | BOARD-09 — every item shows a chronological, actor-attributed activity trail | ✓ VERIFIED (mechanism) | `query/events.rs::activity_trail`; `activity_trail.rs` core tests (5/5) including same-millisecond deterministic ordering and paging-covers-every-entry-once; `activity-trail.test.tsx` component tests (2/2). Live visual read not run — see Human Verification |
| 16 | BOARD-10a — user registers several local git repos as projects and switches boards (⌘1-⌘9, palette, rail) | ✓ VERIFIED | `marker.rs`, `domain/project.rs::register_project/reconcile_projects/relocate_project`; `project_reconciliation.rs` (14/14) proves canonicalized-path comparison, dedup-on-marker-id, constraint-not-ordering uniqueness under concurrent registration; happy path also live-verified with a real `tauri dev` launch and screenshots in `01-11`'s earlier task |
| 17 | BOARD-10b — a rejected registration is surfaced to the user, not silently swallowed | ✗ **FAILED** | See Gaps — CR-02: 3 of 4 registration entry points (`App.tsx` ⌘⇧O, `CommandPalette.tsx`, `ProjectRail.tsx`'s `+`) discard `useRegisterProjectFlow`'s `isError`/`error`; only `FirstRun.tsx` renders it |

**Score:** 15/17 truths verified (0 present-behavior-unverified — the two behavior-dependent
sub-claims found, selection-tracks-item-id-across-reorder and cursor/replay gap-freedom, are both
backed by real passing behavioral tests, not presence alone)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/domain/epic.rs` (`delete_epic`) | Idempotent, orphans children, never fails | ⚠️ **DEFECTIVE** | Orphans child tasks, never orphans linked issues — fails with FK error |
| `packages/core/src/domain/task.rs` (`delete_task`) | Idempotent, never fails | ⚠️ **DEFECTIVE** | Never orphans linked issues — fails with FK error |
| `packages/desktop/src/projects/RegisterProjectFlow.tsx` | Shared registration flow, error state surfaced by every caller | ⚠️ **PARTIAL** | Hook itself is correct (returns `isError`/`error`); 3 of 4 callers discard it |
| `packages/core/src/db/mod.rs`, `db/backup.rs` | WAL pragmas, crash safety, backup/restore | ✓ VERIFIED | Present, substantive, wired, behaviorally tested |
| `packages/core/src/domain/event.rs`, `query/events.rs` | Append-only log, cursor-resumable stream | ✓ VERIFIED | Present, substantive, wired, behaviorally tested |
| `packages/core/src/domain/acceptance_criterion.rs` | Discrete criteria CRUD | ✓ VERIFIED | Present, substantive, wired, tested |
| `packages/core/src/ranking.rs` | Fractional-index reorder | ✓ VERIFIED | Present, substantive, wired, tested |
| `packages/core/src/query/search.rs`, `query/filter.rs` | FTS5 search, indexed filter | ✓ VERIFIED | Present, substantive, wired, tested |
| `packages/desktop/src/state/keyboard.ts`, `board/CommandPalette.tsx` | Single binding table, palette parity | ✓ VERIFIED | Present, substantive, wired, tested |
| `packages/core/src/marker.rs`, `domain/project.rs` | Marker-based project identity, reconciliation | ✓ VERIFIED | Present, substantive, wired, tested |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `desktop/src-tauri/src/main.rs` | `core::db::open_and_migrate` | setup hook before any window shown | ✓ WIRED | `main.rs` calls it before the window is created |
| `desktop/src/App.tsx` | `desktop/src/adapters/tauri.ts` | every invoke/listen through one seam | ✓ WIRED | No direct `@tauri-apps/api` import found outside the adapter |
| `domain/task.rs` (create/delete/status) | `domain/event.rs::append_event` | same transaction | ✓ WIRED | Confirmed in every mutation function read |
| `desktop/src/board/useBoardQuery.ts` | `board:changed` (Rust `app.emit`) | push-invalidate, no client optimism | ✓ WIRED | Every mutating Tauri command emits `board:changed`; `useBoardQuery.ts::subscribeBoardChanged` invalidates on it |
| `desktop/src/board/BoardView.tsx` | `desktop/src/board/BoardRow.tsx` (epic display) | `epicsById` lookup mirroring `actorsById` | ✗ **NOT WIRED** | `BoardRow.tsx` was never passed an `epicsById` map; renders the raw `epic_id` ULID instead (WR-01, see Human Verification) |
| `desktop/src/projects/ProjectRail.tsx`/`App.tsx`/`CommandPalette.tsx` | `useRegisterProjectFlow`'s `isError`/`error` | render on failure | ✗ **NOT WIRED** | See CR-02 gap |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DATA-01 | 01-03, 01-04 | Transactional outbox | ✓ SATISFIED | Truth #1 |
| DATA-02 | 01-01, 01-03 | Client-generated ULIDs | ✓ SATISFIED | Truth #2 |
| DATA-03 | 01-03, 01-04 | Distinct human/agent actor model | ✓ SATISFIED | Truth #3 |
| DATA-05 | 01-10 | Cursor-resumable event stream | ✓ SATISFIED | Truth #4 |
| DATA-07 | 01-05 | Crash-safe persistence | ✓ SATISFIED | Truth #5 |
| DATA-08 | 01-01, 01-05 | Automatic, reversible migrations | ✓ SATISFIED | Truth #6 |
| BOARD-01 | 01-04 | CRUD in fixed 3-level hierarchy | ⚠️ **PARTIAL** | Truth #7 satisfied, Truth #8 (delete with linked issue) FAILED — CR-01 |
| BOARD-02 | 01-06 | Discrete checkable acceptance criteria | ✓ SATISFIED | Truth #9 |
| BOARD-04 | 01-04 | Fixed, non-reconfigurable workflow | ✓ SATISFIED | Truth #10 |
| BOARD-05 | 01-07 | Reorder/reprioritize | ✓ SATISFIED | Truth #11 |
| BOARD-06 | 01-08 | Filter/search across items | ✓ SATISFIED | Truth #12 |
| BOARD-07 | 01-02, 01-09 | Full keyboard operability | ? NEEDS HUMAN (mechanism satisfied) | Truth #13 |
| BOARD-08 | 01-02, 01-08 | No perceptible lag at 1,000+ items | ? NEEDS HUMAN (server-side satisfied) | Truth #14 |
| BOARD-09 | 01-10 | Chronological actor-attributed activity trail | ? NEEDS HUMAN (mechanism satisfied) | Truth #15 |
| BOARD-10 | 01-11 | Register/switch multiple project boards | ⚠️ **PARTIAL** | Truth #16 satisfied, Truth #17 (error surfacing) FAILED — CR-02 |

No orphaned requirements: the union of every plan's `requirements:` frontmatter across the 11
plans (`DATA-01,02,03,05,07,08`, `BOARD-01,02,04,05,06,07,08,09,10`) exactly matches the 15 IDs
`REQUIREMENTS.md`'s traceability table assigns to Phase 1.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Rust workspace test suite is green | `cargo test --workspace` (run once, this session) | 94 tests across 15 files, 0 failed | ✓ PASS |
| Full frontend test suite is green | `npm --prefix packages/desktop run test -- --run` (run once, this session) | 51 tests across 12 files, 0 failed | ✓ PASS |
| `delete_epic`/`delete_task` never fail (CR-01) | Direct source read of both functions + the `issues` FK declarations in `migrations/0002_board_schema.sql` | No `UPDATE issues ...` statement present in either function; `issues.epic_id`/`issues.task_id` are `NO ACTION` FKs with `foreign_keys=ON` | ✗ FAIL (confirms CR-01) |
| Registration failures render on all 4 entry points (CR-02) | `grep -n "isError\|error" App.tsx CommandPalette.tsx ProjectRail.tsx FirstRun.tsx` | Only `FirstRun.tsx` renders `isError`/`error` | ✗ FAIL (confirms CR-02) |
| No item-count-based virtualization strategy switch | Code read of `BoardView.tsx`'s single `useVirtualizer` call | No conditional branching found on item count | ✓ PASS |
| `board:changed` push-invalidate wired end to end | `grep -rn "board:changed"` across `src-tauri/src/commands/*.rs` and `useBoardQuery.ts` | Every mutating command emits it; the hook subscribes exactly once and invalidates | ✓ PASS |
| Marker holds only project id/key, no board content | Read `marker.rs::ProjectMarker` struct | `{ project_id: String, project_key: String }` — nothing else | ✓ PASS |
| Screen-reader row announcement wired | `grep -n "aria-setsize\|aria-posinset"` in `BoardRow.tsx` | Both present, sourced from the query window's true counts | ✓ PASS |

### Probe Execution

Not applicable — this is a desktop app phase with no `scripts/*/tests/probe-*.sh` convention and
none declared in any plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/domain/epic.rs` / `task.rs` | ~200-257 / ~205-256 | Unhandled FK failure on delete with linked issue (CR-01) | 🛑 Blocker | Deletion of a real, reachable epic/task permanently fails |
| `App.tsx`:94, `CommandPalette.tsx`:132, `ProjectRail.tsx`:79 | — | Swallowed mutation error state (CR-02) | 🛑 Blocker | Silent registration failure, no user feedback |
| `packages/desktop/src/board/BoardRow.tsx`:243 | 243 | Raw ULID rendered where a human-readable epic reference belongs (WR-01) | ⚠️ Warning | Board legibility — every task under an epic shows an unreadable id in its pill |
| `packages/core/src/domain/epic.rs`/`task.rs`/`issue.rs` `update_*` | — | Return DTO's `key` field is `String::new()` instead of the real value (WR-02) | ⚠️ Warning | Silent contract violation, currently masked because no caller reads it back yet |
| `packages/desktop/src-tauri/tauri.conf.json`:22-24 | 22-24 | `"csp": null` — no Content-Security-Policy | ⚠️ Warning | No live XSS vector today (plain-text titles only), but no defense-in-depth for future rich content |
| `packages/desktop/src/board/DoneWarning.tsx`:74 | 74 | Renders `"{checked}/{total} criteria unchecked"` — labels the CHECKED count as "unchecked" | ⚠️ Warning | Misleading warning copy; implemented faithfully to `01-UI-SPEC.md`'s own (defective) Copywriting Contract; the block/never-block mechanism itself is unaffected |
| `packages/desktop/src/board/FilterBar.tsx` | ~254-268 | Assignee filter chips do not exclude the `system` actor the way `AssigneePicker` does | ℹ️ Info | One permanently-dead filter chip, cosmetic |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 90 phase-modified
implementation files (`git log --name-only` diff over this phase's commit range, grepped directly
— zero hits).

### Human Verification Required

1. **Full live keyboard-only walkthrough, no live GUI confirmation since `01-03`**
   **Test:** Launch a real `tauri dev` build; create/edit/delete epics, tasks, issues; add and
   check acceptance criteria; move items through the full workflow; reorder within an epic and
   the backlog; search and filter a 1,000+ item project; register 2-3 real repositories and
   switch with ⌘1-⌘9 and the palette — mouse untouched throughout.
   **Expected:** Every action completes with no perceptible lag or visual jank; nothing requires
   the mouse; the rack, legend, detail panel and activity trail read correctly.
   **Why human:** Every plan from `01-04` through `01-11` explicitly recorded in its own SUMMARY
   that "no confirmed GUI display / agent-spawning tool available to this executor" and deferred
   its plan's own `<human-check>` block to `/gsd-verify-work`. Only `01-01`–`01-03` captured real
   `tauri dev` screenshots. Server-side latency, component rendering and keyboard-binding logic
   are all proven by passing automated tests, but the actual felt experience in a running window
   has not been confirmed for roughly two-thirds of this phase's surface area.

2. **Epic pill legibility (WR-01, already confirmed as a code defect, not merely uncertain)**
   **Test:** Open the board with at least one epic that has child tasks; look at a task row's
   epic pill.
   **Expected:** A human-readable epic key/title.
   **Why human, despite being a confirmed defect:** flagged here rather than silently absorbed,
   so a human explicitly decides whether this blocks sign-off or is accepted as a fast-follow —
   it is cosmetic (the underlying `epicId` data is correct) but visible on the very first board
   with an epic, which is a primary Phase 1 use case.

## Gaps Summary

Two Critical, independently-reproduced defects touch this phase's own success criteria directly:
CR-01 (delete cascade) breaks BOARD-01's "delete" guarantee the moment an issue is linked to an
epic or task — a state reachable today through the fully-implemented `issue_create` API even
though no shipped UI creates that link yet, and one Phase 6 (issue triage) will create routinely.
CR-02 (silent registration failure) breaks BOARD-10's implicit "the user can tell what happened"
contract on 3 of 4 entry points, and the specific trigger (`deriveKeyPrefix` producing an invalid
prefix for a digit-leading or very short directory name) is a realistic, not contrived, failure
for Cyril's own real directory names. Neither is a matter of degree or of tests being green — both
are reproducible by reading the code once and contradict documented contracts the phase's own
plans wrote. They are not deferred to a later phase in `ROADMAP.md`; nothing downstream claims
ownership of "fix the delete cascade" or "surface registration errors." Everything else checked —
the append-only event log, ULID identity, the actor model, the fixed workflow, criteria, ranking,
search/filter, and the marker/reconciliation model — holds up under direct inspection and (where
the claim is behavior-dependent, not just presence) under a real passing behavioral test.

---

_Verified: 2026-09-09T09:29:11Z_
_Verifier: Claude (gsd-verifier)_
