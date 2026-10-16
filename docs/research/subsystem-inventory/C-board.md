# Group C — board, records & authoring: subsystem inventory (facts only)

Repo: `/Users/cymarechal/cymarechal/HighKnow-harness-worktrees/mvp`, branch `mvp` @ `812533ef`, measured 2026-10-16. Repo total: 1968 commits, 139 with a subject starting `fix`.

## 1. Summary table

Source lines = `wc -l` of attributed non-test files; Rust inline `#[cfg(test)] mod` blocks (to EOF) moved to the test column. Test lines = dedicated test files + inline modules. UAT = attributable `scripts/uat/*` and `scripts/*` tooling. Planning = PLAN.md files whose `files_modified` frontmatter names any attributed file (source, test or UAT); "gap" = those with `gap_closure: true`. Commits = `git log -- <all attributed files>` (fix = subject matches `^fix`, case-insensitive); the source-only figure is in section 2.

| Subsystem | Source lines | Test lines (+UAT) | Depends on it | Record types assumed | Planning (phases/plans) | Commits (fix) |
|---|---|---|---|---|---|---|
| 1a DB + migrations + event log | 2,846 (34 files: 1,455 Rust in 10 files + 1,391 SQL in 24 migrations) | 3,086 (13 files; inline 0) (+0) | Every other row in this group (actor/event/ids imported by 1b, 2, 3, 5, 6; `db` by 1e, 7). Outside group C: domain/agent_run, dispatch_plan, file_set, permission_request, permission_rule, session_summary, trigger, worktree; credentials, dispatch, limit_gate, merge, git_facts, forge/transitions, runtime_protocol, session_log; tauri commands agent_run, dispatch, file_set, forge, review, settings, update, worktree_open; tauri notify.rs, scheduler.rs, sidecar.rs | Final schema = 26 tables: acceptance_criteria, actors, agent_runs, authoring_proposals, authoring_proposals_fts, criterion_anchors, cycles, dispatch_edges, dispatch_plan_tasks, dispatch_plans, epics, epics_fts, event_sequence_counters, events, issues, issues_fts, permission_requests, permission_rules, projects, session_summaries, settings, task_file_set_entries, tasks, tasks_fts, triggers, worktrees (same 26 listed in `schema_classification.rs` TABLE_CLASSES). No PRD or ADR table exists (RECD-01..07 are in REQUIREMENTS.md) | 55 plans in 15 phases (P01 10, P13 8, P03 5, P07 5, P02 4, P04 4, P09 4, P05 3, P08 3, P06 2, P10 2, P15 2, P11 1, P12 1, P14 1); 7 gap | 72 (2) |
| 1b Record domain (epic/task/issue/project) | 4,043 (9 files) | 4,485 (13 files 4,406 + inline 79) (+0) | 1e (commands board/epic/task/issue/project); 2 (`status_derivation`, `query` items); 3 (`domain::epic`, `epic_progress` in cycle_progress); 5 (`query::authoring` reuses `ORDER_BY`, `BoardCursor`, `BoardItem`); 6 (`domain::epic/issue/task`, query row mappers); 7 (`query::search` reuses `query/mod.rs` mappers and `filter.rs`). Outside: context_packet, dispatch_exec, git, git_identity, domain/worktree, domain/agent_run, forge/transitions; tauri commands agent_run, change_flags, dispatch, file_set, forge, review, settings, update; tauri scheduler.rs, sidecar.rs, main.rs | tasks, epics, issues, projects, acceptance_criteria, events, actors, agent_runs, worktrees, triggers, permission_requests, authoring_proposals, cycles (word-matches in source) | 44 plans in 15 phases (P01 10, P13 7, P02 4, P08.1 4, P15 4, P14 3, others 1–2); 8 gap | 75 (5) |
| 1c Board UI | 6,169 (17 files) | 9,385 (40 files incl. 7 browser tests) (+0) | 8 (App.tsx renders BoardView, CommandPalette, FilterBar, FirstRun); 6 (BoardRow, collapseStore, useBoardQuery); 7 (FirstRun, useBoardQuery); 1d, 3 (useBoardChangedInvalidation). Outside: `useBoardQuery`/`useBoardChangedInvalidation` imported by dispatch/, item-detail/{Forge,GitFacts,Runs,WorktreeSummary,WorktreeRemovalDialog}, launch-sheet/, recovery/, review/{MergeConfirmSheet,ReviewSurface,useReviewQuery}, session/SessionSurface, settings/{PermissionRulesTable,SettingsSurface}; dispatch/EpicDispatchControls imports BoardRow | DTO kinds named in source (regex hits): Project 437, Epic 417, Task 200, run 145, Proposal 79, Worktree 63, Issue 51, Criterion 49, Dispatch 25, Permission 16, Cycle 1 | 62 plans in 13 phases (P01 16, P08.1 12, P03 5, P13 7, P05 4, P07 3, P11 3, P14 3, others 1–2); 11 gap | 156 (19) |
| 1d Item detail UI | 822 (3 files) | 649 (3 files) (+0) | 1c (BoardView renders ItemDetailPanel); 2 and item-detail/RunsSection import `item-detail.css` | Task, Epic, Issue, Criterion, run, Worktree, Proposal, Project, Permission (regex hits 2–18 each) | 19 plans in 9 phases (P01 4, P02 4, P13 3, P07 2, P08.1 2, others 1); 2 gap | 26 (3) |
| 1e IPC seam (adapter + board/record commands) | 4,123 (12 files; `adapters/tauri.ts` alone 2,217, `main.rs` 314) | 422 (3 files incl. 2 src-tauri/tests) (+0) | Every desktop surface: `adapters/tauri.ts` imported by 1c, 1d, 2, 3, 6, 7, 8 and by dispatch/ (4 files), item-detail/ (4), launch-sheet/, recovery/, review/ (5), session/ (3), settings/ (3), update/ (2). `main.rs` registers 153 `commands::` references (audit: 148 commands) for every subsystem | tasks, epics, issues, projects, acceptance_criteria, events, actors, agent_runs, worktrees, triggers, permission_requests, permission_rules, settings, authoring_proposals, cycles, dispatch_plans (word-matches in Rust source) | 91 plans in 15 phases (P01 12, P02 11, P03 7, P05 7, P08 7, P09 7, P10 7, P07 6, P11 5, P15 5, P04 4, P08.1 4, P14 4, P13 3, P06 2); 12 gap | 125 (6) |
| 2 Acceptance criteria | 2,498 (5 files) | 2,994 (10 files 2,946 + inline 48) (+0) | 1b (`domain::acceptance_criterion` used by epic/task), 6 (`authoring_proposal` uses `criterion_lint` + `acceptance_criterion`), 1d (ItemDetailPanel renders AcceptanceCriteriaList). Outside: context_packet.rs, review.rs, tauri commands agent_run/review, desktop launch-sheet/LaunchSheet and review/CriteriaRail import AcceptanceCriteriaList | acceptance_criteria, criterion_anchors, tasks, epics, issues, events, agent_runs, triggers, authoring_proposals, settings | 13 plans in 7 phases (01-06; 04-04, 04-10; 05-06; 08-02, 08-06, 08-09; 08.1-03, 08.1-15; 13-09, 13-10; 15-01, 15-06); 1 gap | 36 (6) |
| 3 Cycles | 1,199 (7 files) | 3,263 (11 files) (+379 scripts: demo-board.sh 172, capture-cycle-region.mjs 207) | 1c only (BoardView renders CycleRegion). No core module outside the row imports `domain::cycle`/`cycle_progress`/`cycle_scope` (only `query/mod.rs` declares them, `main.rs` registers commands) | cycles, epics, tasks, events, projects, actors, agent_runs | 8 plans: P14 6 (14-01, 14-02, 14-03, 14-06, 14-09, 14-10), P13 2 (13-01, 13-14); 1 gap | 25 (3) |
| 4 Provisional tier | 168 (1 file) | 797 (3 files) (+0) | 5 (`commands/authoring.rs` `item_provisional_values`), 6 (`authoring_proposal.rs` refers to it) ; desktop reads via `adapters/tauri.ts` → ItemDetailPanel | authoring_proposals, tasks, epics, issues, actors | 1 plan: 15-07; 0 gap | 6 (0) |
| 5 Socratic authoring | 2,894 (4 files) | 5,717 (16 files 5,701 + inline 16) (+10,922 UAT: uat-08 9,322, uat-09 527, lib/fake-authoring-claude 1,073) | 1e (`main.rs` registers commands; `query::authoring` used by tauri sidecar.rs, commands/dispatch.rs, commands/task.rs), 6 (`authoring_proposal.rs` uses `authoring_session`). Outside: domain/agent_run.rs, domain/trigger.rs, epic_context_packet.rs, query/recovery.rs; sidecar `claude-code-adapter.ts` writes the PreToolUse entry that runs `stage-gate-hook.ts`. Desktop UI lives in `session/SessionSurface.tsx` (not attributed here; 78 "authoring" mentions) | authoring_proposals, agent_runs, tasks, epics, issues, acceptance_criteria, events, projects | 53 plans: P05 37 (of the phase's 50), P15 5, P13 4, P06 3, P11 1, quick 3; 30 gap | 131 (10) |
| 6 Proposal tray / agent backlog & triage | 4,413 (8 files; `domain/authoring_proposal.rs` 2,304) | 9,025 (15 files) (+864 UAT: uat-10) | 4, 5, 7 (`domain::authoring_proposal`); 1c (BoardView renders TriageLane, ChallengeRow; useAuthoringQuery); 1d (useAuthoringQuery); 8 (App.tsx renders TriageSurface). Outside: domain/agent_run.rs, epic_context_packet.rs, desktop session/SessionSurface (ProposalTray, useAuthoringQuery); sidecar `mcp-permission-server.ts` defines the `propose_item` tool | authoring_proposals, tasks, epics, issues, acceptance_criteria, agent_runs, events, projects, settings | 26 plans: P06 9 (all of phase 6), P13 7, P05 4, P08.1 3, P15 3; 2 gap | 73 (8) |
| 7 Fleet / search / ranking / project rail | 3,534 (12 files) | 5,264 (18 files 5,117 + inline 147) (+313 UAT: uat-12) | `ranking` used by 1b (epic/task/issue), 2, 3, 6 and tauri commands epic/task/issue; `query::search` by 1e (commands/board.rs), 5 (query/authoring), 6; `query::fleet` by core domain/worktree.rs; ProjectRail/RegisterProjectFlow/ProjectUnreachable/useWatchedRun by App.tsx (8), FirstRun (1c); useFleet by update/UpdateBanner, update/useUpdate | agent_runs, worktrees, projects, tasks, epics, issues, triggers, permission_requests, authoring_proposals, and the 4 FTS tables | 28 plans: P10 8, P01 5, P08.1 5, P13 3, P11 2, others 1; 2 gap | 65 (11) |
| 8 Keyboard/UI state, legend, theme, shell, styles | 5,436 (24 files incl. 2 svg assets, 5 css, App.tsx 441) | 2,609 (16 files incl. 3 test-setup files) (+0) | 1c, 1d, 2, 3, 6, 7 import keyboard/uiStore/marks/StateBadge/styles; outside: dispatch/{EpicDispatchControls,WavePlanSheet}, item-detail/RunsSection, recovery/OrphanRecoveryModal, review/{EpicRequestSheet,MergeConfirmSheet,ReviewSurface}, session/{PermissionRequestCard,SessionSurface}, settings/ (3 files), update/UpdateBanner | none (no table read; UI kinds named in source: Project 167, run 135, Task 99, Epic 96, Proposal 70, Worktree 46, Criterion 40, Permission 39) | 66 plans in 13 phases (P01 18, P08.1 9, P08 5, P10 5, P02 4, P03 4, P05 4, P11 4, P14 4, P13 3, others 2); 11 gap | 142 (21) |

Totals for group C: source 38,145 lines; test 47,696 lines (+12,478 UAT/scripts lines). Sums of the rows above; 1a counts all 24 migrations, including those for tables owned by other groups.

## 2. Per-subsystem detail

### Attribution rules and shared files (read before using the numbers)

- One owner per file. Shared files and where they were put:
  - `core/domain/authoring_proposal.rs` (2,304 lines) → row 6. It holds both the authoring staging writes (row 5) and the agent-filed channel: `create_proposal` (l.514), limits `PROPOSAL_LIMIT_PER_EXECUTION_RUN = 10` (l.403), `OPEN_DRAFTS_PER_PROJECT = 30` (l.438), triage verbs accept/merge/defer/reject/amend/bulk (l.1393–2282), `confirm_provisional_values_for_task` (l.1533, row 4).
  - `tauri/commands/authoring.rs` (1,494 lines; 1,478 source + 16 inline test from l.1479) → row 5. Lines ~596–1144 are proposal-triage commands (`authoring_proposals_for_run` … `authoring_proposal_amend`, row 6); `item_provisional_values` (l.1469) serves row 4.
  - `core/query/authoring.rs` (818) → row 5. It also holds the triage-lane reads `list_pending_proposals` (l.305), `list_deferred_proposals` (l.377), `proposal_limit_notices` (l.682) used by row 6.
  - `desktop/adapters/tauri.ts` (2,217) and `tauri/main.rs` (314) → row 1e; both carry every subsystem's IPC surface (all 148 commands per the milestone audit).
  - `desktop/App.tsx`, `App.css`, `main.tsx`, `test/*` setup files → row 8.
  - All 24 SQL migrations → row 1a, including 0003–0008, 0010–0021 for agent runtime, permission gate, credentials, destructive gate, session summaries, authoring, forge, fan-out and fleet.
- Not attributed to group C (left to other agents): `core/query/scope.rs`, `core/query/change_flags.rs`, `tauri/commands/change_flags.rs`, `tauri/commands/settings.rs`, `core/domain/trigger.rs`, `desktop/session/*` (holds the Socratic authoring composer UI), `desktop/item-detail/{RunsSection,ForgeSection,GitFactsSection,WorktreeSummary,WorktreeRemovalDialog}.tsx`, `desktop/adapters/__tests__/changes-request-adapter.test.ts`, core tests `status_transitions.rs`, `task_header_read.rs`, `epic_context_packet.rs`, `worktree_*`, `lock_contention.rs`.
- Test attribution choices: `authority_human_only.rs` (FNC-03, covers criterion check + request-changes + proposal decisions) → 6; `open_drafts_cap.rs`, `draft_revision_pin.rs`, `criterion_draft_tracer.rs`, `criteria_pin.rs`, `criterion_anchors.rs` → 2; `pm_vocabulary_gate.rs`, `demo_board.rs`, `tests/bin/demo_board.rs` → 3; `priority_is_opt_in.rs`, `estimate_absent.rs`, `perf_seed_1000.rs` → 1b; `tests/common/mod.rs` (288, shared by all core tests) → 1a; desktop `session/__tests__/authoring-*.test.tsx` → 5.
- "Depends on it" derivation: grep over `packages/core/src`, `packages/desktop/src-tauri/src`, `packages/sidecar/src` for `crate::`/`flywheel_core::`/`super::` paths (incl. `{…}` groups) and bare `module::fn(` calls; desktop: non-test `import … from '…<basename>'`. Test files excluded. A path appearing only in a doc comment can count.
- "Record types assumed" derivation: Rust/SQL source — whole-word match of each of the 26 table names; TS/TSX source — regex hit counts of record-kind words (approximate; e.g. "run" also matches prose).
- Commit counts include commits that touched only the subsystem's tests.

### Planning artefacts beyond PLAN.md counts

Phase totals for the phases that built these rows (PLAN.md count / of which `gap_closure: true`): P01 board store of record 21/10; P05 Socratic authoring 50/40; P06 agents file their own backlog 9/0; P08.1 visual polish 21/0; P10 fleet 9/0; P13 fence 18/7; P14 cycles & state colour 10/0; P15 drafting 10/0.

| Row | Debug files | Quick tasks | Todos | Other |
|---|---|---|---|---|
| 1a | 0 | 0 | 0 | — |
| 1b | 0 | 0 | completed: `epic-status-has-no-writer-after-statuspicker-deletion`, `task-and-epic-set-status-remain-ipc-reachable`; pending: `work-definition-layer-must-be-swappable-not-compiled-in` | REQUIREMENTS.md DRFT-04/05/06 (status/estimate/priority) |
| 1c | 0 | 0 | pending: `epic-rows-draw-no-state-even-with-a-running-agent` | — |
| 1d | 0 | 0 | 0 | — |
| 1e | 0 | 0 | 0 | Audit: "Adapter rule … held", 148 commands registered |
| 2 | 0 | 0 | 0 | Audit tech debt: D-REV-04 (phase 08) "no task with a worktree carries any acceptance criteria" |
| 3 | 0 | 0 | pending: `demo-board-does-not-exercise-ci-failed-merged-or-proposal-mark`, `demo-board-script-prefers-stale-release-binary`, `demo-seeder-cycle-goals-include-rest-of-roadmap-line` | REQUIREMENTS.md RECD-08..10, RECD-13 (Cycle); RECD-01..07, 11, 12 (PRD/ADR) have no table in the schema |
| 4 | 0 | 0 | 0 | REQUIREMENTS.md DRFT-03, DRFT-07 |
| 5 | 3: `authoring-session-has-no-human-turn-surface.md`, `uat-08-live-run-starves-on-permission-requests.md`, `uat-08-live-transcript-unjudgeable.md` | 3: `260929-lq1`, `260929-nxq`, `260929-p61` | pending: `g-05-8-askuserquestion-invisible-and-board-unwritable-in-liv`, `socratic-challenge-should-be-structured-like-gsd` | Audit: phase 05 VERIFICATION 56/56 passed |
| 6 | 0 | 0 | completed: `proposal-keyboard-test-is-flaky` | Audit: phase 06 5/5, 1 behaviour_unverified "later observed"; REQUIREMENTS DRFT-08, DRFT-09 |
| 7 | 0 | 0 | pending: `rail-needs-decision-count-is-red-beside-amber-blocked` | DEFERRED-REVIEW: 9 items with phase "10"; audit: phase 10 register 7 queued |
| 8 | 0 | 0 | pending: `app-shell-content-child-has-no-min-width-zero`, `dark-needs-you-wash-not-visible-inside-contrast-envelope` | DEFERRED-REVIEW: 23 items with phase "08.1" (of 68); audit: phase 08.1 score 8/12, "Overrides 2" in the table, prose says 4 of 12 must-haves closed on owner override; REQUIREMENTS VIS-01..08 |

### 1a DB + migrations + event log

Source (34 files, 2846 lines; inline #[cfg(test)] lines moved to test: 0):
`core/db/mod.rs` 334, `core/db/backup.rs` 114, `core/domain/event.rs` 130, `core/domain/actor.rs` 122, `core/domain/settings.rs` 341, `core/domain/mod.rs` 85, `core/ids.rs` 40, `core/schema_classification.rs` 94, `core/query/events.rs` 158, `core/lib.rs` 37

Migrations (24 files, 1391 lines): `0001_actors.sql` 16, `0002_board_schema.sql` 189, `0003_agent_runtime.sql` 92, `0004_permission_gate.sql` 63, `0005_credentials.sql` 39, `0006_recovery_statuses.sql` 100, `0007_destructive_gate.sql` 23, `0008_session_summaries.sql` 55, `0009_criteria_revisions.sql` 36, `0010_authoring_runs.sql` 105, `0011_authoring_staging.sql` 51, `0012_authoring_proposals_project_status_index.sql` 10, `0013_authoring_summaries.sql` 67, `0014_permission_requests_authoring.sql` 55, `0015_proposal_triage_extension.sql` 86, `0016_authoring_proposals_fts.sql` 59, `0017_forge_setting.sql` 16, `0018_criterion_anchors.sql` 26, `0019_fan_out.sql` 73, `0020_fleet.sql` 33, `0021_fleet_review_backlog.sql` 28, `0022_project_hidden.sql` 10, `0023_drop_estimate.sql` 118, `0024_cycles.sql` 41

Tests (13 files, 3086 lines): `core/tests/crash_safety.rs` 145, `core/tests/db_bootstrap.rs` 278, `core/tests/ids.rs` 49, `core/tests/migration_safety.rs` 745, `core/tests/migration_schema_too_far_ahead.rs` 158, `core/tests/outbox.rs` 514, `core/tests/cursor_resume.rs` 232, `core/tests/activity_trail.rs` 207, `core/tests/table_classification.rs` 103, `core/tests/spine_pin.rs` 196, `core/tests/settings_notifications.rs` 54, `core/tests/bin/crash_harness.rs` 117, `core/tests/common/mod.rs` 288

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 10/8/2; 02-one-agent-one-worktree-watched-live: 4/4/0; 03-nothing-lost-nothing-left-running: 5/5/1; 04-clear-is-free: 4/4/0; 05-socratic-epic-authoring: 3/3/0; 06-agents-file-their-own-backlog: 2/2/0; 07-the-board-tells-the-git-truth: 5/5/1; 08-review-and-merge-inside-flywheel: 3/3/0; 09-planned-fan-out-that-does-not-collide: 4/4/0; 10-fleet-supervision-across-every-project: 2/2/0; 11-ship-it: 1/1/0; 12-destructive-gate-trust-boundary-redesign: 1/1/0; 13-nothing-new-escapes-the-fence: 8/6/3; 14-cycles-on-screen-state-in-colour: 1/1/0; 15-nothing-typed-that-an-agent-could-draft: 2/2/0

Git: 72 commits touch any attributed file (2 with subject starting `fix`); 59 touch source only (2 fix).

### 1b Record domain (epic/task/issue/project)

Source (9 files, 4043 lines; inline #[cfg(test)] lines moved to test: 79):
`core/domain/epic.rs` 815, `core/domain/task.rs` 1013, `core/domain/issue.rs` 523 (+79 inline test), `core/domain/project.rs` 618, `core/status_derivation.rs` 301, `core/query/mod.rs` 425, `core/query/filter.rs` 128, `core/query/epic_progress.rs` 135, `core/marker.rs` 85

Tests (13 files, 4406 lines): `core/tests/hierarchy_workflow.rs` 725, `core/tests/epic_roster.rs` 399, `core/tests/epic_progress.rs` 291, `core/tests/status_derivation.rs` 680, `core/tests/no_agent_status_write.rs` 348, `core/tests/task_created_at_todo.rs` 97, `core/tests/task_delete_with_run_history.rs` 295, `core/tests/project_hide.rs` 375, `core/tests/project_reconciliation.rs` 407, `core/tests/estimate_absent.rs` 198, `core/tests/priority_is_opt_in.rs` 239, `core/tests/perf_seed_1000.rs` 185, `core/tests/bin/file_board_items.rs` 167

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 10/9/3; 02-one-agent-one-worktree-watched-live: 4/4/1; 03-nothing-lost-nothing-left-running: 2/2/0; 04-clear-is-free: 1/1/0; 05-socratic-epic-authoring: 1/1/0; 06-agents-file-their-own-backlog: 1/1/0; 07-the-board-tells-the-git-truth: 2/2/0; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 4/4/0; 09-planned-fan-out-that-does-not-collide: 1/1/0; 10-fleet-supervision-across-every-project: 1/1/0; 11-ship-it: 1/1/0; 12-destructive-gate-trust-boundary-redesign: 2/2/1; 13-nothing-new-escapes-the-fence: 7/6/3; 14-cycles-on-screen-state-in-colour: 3/3/0; 15-nothing-typed-that-an-agent-could-draft: 4/4/0

Git: 75 commits touch any attributed file (5 with subject starting `fix`); 53 touch source only (5 fix).

### 1c Board UI

Source (17 files, 6169 lines; inline #[cfg(test)] lines moved to test: 0):
`desktop/board/BoardRow.tsx` 514, `desktop/board/BoardView.tsx` 1593, `desktop/board/CommandPalette.tsx` 832, `desktop/board/DeleteConfirm.tsx` 97, `desktop/board/EpicHeaderRow.tsx` 347, `desktop/board/FilterBar.tsx` 325, `desktop/board/FirstRun.tsx` 132, `desktop/board/IssuesLane.tsx` 136, `desktop/board/QuickAdd.tsx` 162, `desktop/board/StatusBand.tsx` 51, `desktop/board/collapseStore.ts` 69, `desktop/board/summaryLine.ts` 55, `desktop/board/useBoardChangedInvalidation.ts` 96, `desktop/board/useBoardQuery.ts` 1287, `desktop/board/pickers/AssigneePicker.tsx` 171, `desktop/board/pickers/ParentPicker.tsx` 169, `desktop/board/pickers/PriorityPicker.tsx` 133

Tests (40 files, 9385 lines): `desktop/board/__tests__/blocked-indicator.test.tsx` 140, `desktop/board/__tests__/board-changed-adoption.test.tsx` 72, `desktop/board/__tests__/board-changed-routing.test.tsx` 220, `desktop/board/__tests__/board-pending-focus.test.tsx` 171, `desktop/board/__tests__/board-view.test.tsx` 427, `desktop/board/__tests__/change-cue.test.tsx` 211, `desktop/board/__tests__/ci-flag.test.tsx` 95, `desktop/board/__tests__/command-palette-resolve.test.tsx` 240, `desktop/board/__tests__/epic-assign.test.tsx` 289, `desktop/board/__tests__/epic-roster.test.tsx` 1301, `desktop/board/__tests__/epic-sublabel.test.tsx` 51, `desktop/board/__tests__/filter.test.tsx` 212, `desktop/board/__tests__/first-run.test.tsx` 169, `desktop/board/__tests__/issue-parent.test.tsx` 336, `desktop/board/__tests__/keyboard-nav.test.tsx` 211, `desktop/board/__tests__/layer-guard.test.tsx` 389, `desktop/board/__tests__/lens.ts` 9, `desktop/board/__tests__/menu-bridge.test.tsx` 473, `desktop/board/__tests__/needs-decision.test.tsx` 195, `desktop/board/__tests__/overlay-finish.test.tsx` 81, `desktop/board/__tests__/palette-sections.test.tsx` 97, `desktop/board/__tests__/palette.test.tsx` 99, `desktop/board/__tests__/quick-add-focus.test.tsx` 721, `desktop/board/__tests__/reopen-epic.test.tsx` 199, `desktop/board/__tests__/reorder.test.tsx` 100, `desktop/board/__tests__/review-doors.test.tsx` 167, `desktop/board/__tests__/row-tail.test.tsx` 55, `desktop/board/__tests__/scope-badge.test.tsx` 157, `desktop/board/__tests__/selection-rule.test.tsx` 92, `desktop/board/__tests__/state-pills.test.tsx` 45, `desktop/board/__tests__/states-finish.test.tsx` 190, `desktop/board/__tests__/summary-line.test.ts` 79, `desktop/board/__tests__/volume.ts` 138, `desktop/board/__tests__/workflow.test.tsx` 100, `desktop/board/__tests__/browser/board-group.browser.test.tsx` 460, `desktop/board/__tests__/browser/forced-colors.browser.test.tsx` 192, `desktop/board/__tests__/browser/legibility.browser.test.tsx` 213, `desktop/board/__tests__/browser/lens-narrowing.browser.test.tsx` 153, `desktop/board/__tests__/browser/motion.browser.test.tsx` 315, `desktop/board/__tests__/browser/states-group.browser.test.tsx` 521

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 16/14/9; 02-one-agent-one-worktree-watched-live: 2/2/0; 03-nothing-lost-nothing-left-running: 5/5/0; 05-socratic-epic-authoring: 4/4/0; 07-the-board-tells-the-git-truth: 3/3/0; 08-review-and-merge-inside-flywheel: 2/2/1; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 12/11/0; 09-planned-fan-out-that-does-not-collide: 2/2/0; 10-fleet-supervision-across-every-project: 1/1/0; 11-ship-it: 3/1/0; 13-nothing-new-escapes-the-fence: 7/5/1; 14-cycles-on-screen-state-in-colour: 3/2/0; 15-nothing-typed-that-an-agent-could-draft: 2/2/0

Git: 156 commits touch any attributed file (19 with subject starting `fix`); 106 touch source only (16 fix).

### 1d Item detail UI

Source (3 files, 822 lines; inline #[cfg(test)] lines moved to test: 0):
`desktop/item-detail/ItemDetailPanel.tsx` 367, `desktop/item-detail/ActivityTrail.tsx` 192, `desktop/item-detail/item-detail.css` 263

Tests (3 files, 649 lines): `desktop/item-detail/__tests__/activity-trail.test.tsx` 167, `desktop/item-detail/__tests__/browser/detail-group.browser.test.tsx` 269, `desktop/item-detail/__tests__/finish.test.tsx` 213

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 4/4/1; 02-one-agent-one-worktree-watched-live: 4/4/0; 03-nothing-lost-nothing-left-running: 1/1/0; 05-socratic-epic-authoring: 1/1/0; 07-the-board-tells-the-git-truth: 2/2/0; 08-review-and-merge-inside-flywheel: 1/1/0; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 2/2/0; 13-nothing-new-escapes-the-fence: 3/3/1; 15-nothing-typed-that-an-agent-could-draft: 1/1/0

Git: 26 commits touch any attributed file (3 with subject starting `fix`); 21 touch source only (1 fix).

### 1e IPC seam (adapter + board/record commands)

Source (12 files, 4123 lines; inline #[cfg(test)] lines moved to test: 0):
`desktop/adapters/tauri.ts` 2217, `desktop/adapters/queryClient.ts` 19, `tauri/commands/board.rs` 324, `tauri/commands/epic.rs` 257, `tauri/commands/task.rs` 257, `tauri/commands/issue.rs` 217, `tauri/commands/project.rs` 183, `tauri/commands/events.rs` 112, `tauri/commands/actor.rs` 34, `tauri/commands/mod.rs` 105, `tauri/state.rs` 84, `tauri/main.rs` 314

Tests (3 files, 422 lines): `desktop/adapters/__tests__/queryClient.test.ts` 19, `tauri/tests/board_changed_payload.rs` 196, `tauri/tests/handler_roster.rs` 207

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 12/12/3; 02-one-agent-one-worktree-watched-live: 11/11/3; 03-nothing-lost-nothing-left-running: 7/7/0; 04-clear-is-free: 4/4/0; 05-socratic-epic-authoring: 7/7/2; 06-agents-file-their-own-backlog: 2/2/0; 07-the-board-tells-the-git-truth: 6/6/0; 08-review-and-merge-inside-flywheel: 7/7/3; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 4/4/0; 09-planned-fan-out-that-does-not-collide: 7/7/1; 10-fleet-supervision-across-every-project: 7/7/0; 11-ship-it: 5/5/0; 13-nothing-new-escapes-the-fence: 3/3/0; 14-cycles-on-screen-state-in-colour: 4/4/0; 15-nothing-typed-that-an-agent-could-draft: 5/5/0

Git: 125 commits touch any attributed file (6 with subject starting `fix`); 124 touch source only (6 fix).

### 2 Acceptance criteria

Source (5 files, 2498 lines; inline #[cfg(test)] lines moved to test: 48):
`core/domain/acceptance_criterion.rs` 1191, `core/criterion_lint.rs` 177 (+31 inline test), `core/query/criterion_coverage.rs` 54, `desktop/item-detail/AcceptanceCriteriaList.tsx` 704, `tauri/commands/criterion.rs` 372 (+17 inline test)

Tests (10 files, 2946 lines): `core/tests/criteria.rs` 861, `core/tests/criteria_pin.rs` 205, `core/tests/criterion_anchors.rs` 406, `core/tests/criterion_coverage.rs` 248, `core/tests/criterion_draft_tracer.rs` 172, `core/tests/draft_revision_pin.rs` 240, `core/tests/open_drafts_cap.rs` 244, `core/tests/bin/seed_criteria.rs` 184, `desktop/item-detail/__tests__/criteria.test.tsx` 234, `desktop/item-detail/__tests__/lint-advice.test.tsx` 152

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 1/1/0; 04-clear-is-free: 2/2/0; 05-socratic-epic-authoring: 1/1/0; 08-review-and-merge-inside-flywheel: 3/2/1; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 2/1/0; 13-nothing-new-escapes-the-fence: 2/2/0; 15-nothing-typed-that-an-agent-could-draft: 2/2/0

Git: 36 commits touch any attributed file (6 with subject starting `fix`); 21 touch source only (4 fix).

### 3 Cycles

Source (7 files, 1199 lines; inline #[cfg(test)] lines moved to test: 0):
`core/domain/cycle.rs` 491, `core/query/cycle_progress.rs` 88, `core/query/cycle_scope.rs` 64, `tauri/commands/cycle.rs` 209, `desktop/board/CycleRegion.tsx` 155, `desktop/board/CycleCloseDialog.tsx` 170, `desktop/board/useCycleRegionQuery.ts` 22

Tests (11 files, 3263 lines): `core/tests/cycle_close.rs` 270, `core/tests/cycle_progress.rs` 205, `core/tests/cycle_region.rs` 286, `core/tests/cycle_roster.rs` 216, `core/tests/cycle_scope_drift.rs` 202, `core/tests/pm_vocabulary_gate.rs` 346, `core/tests/demo_board.rs` 339, `core/tests/bin/demo_board.rs` 771, `desktop/board/__tests__/cycle-region.test.tsx` 180, `desktop/board/__tests__/cycle-close.test.tsx` 136, `desktop/board/__tests__/browser/cycle-region.browser.test.tsx` 312

UAT/scripts (379 lines): `scripts/capture-cycle-region.mjs` 207, `scripts/demo-board.sh` 172

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 13-nothing-new-escapes-the-fence: 2/0/1; 14-cycles-on-screen-state-in-colour: 6/4/0

Git: 25 commits touch any attributed file (3 with subject starting `fix`); 12 touch source only (2 fix).

### 4 Provisional tier

Source (1 files, 168 lines; inline #[cfg(test)] lines moved to test: 0):
`core/query/provisional_values.rs` 168

Tests (3 files, 797 lines): `core/tests/provisional_start.rs` 64, `core/tests/provisional_tier.rs` 527, `desktop/item-detail/__tests__/provisional-ghost.test.tsx` 206

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 15-nothing-typed-that-an-agent-could-draft: 1/1/0

Git: 6 commits touch any attributed file (0 with subject starting `fix`); 3 touch source only (0 fix).

### 5 Socratic authoring

Source (4 files, 2894 lines; inline #[cfg(test)] lines moved to test: 16):
`core/domain/authoring_session.rs` 476, `core/query/authoring.rs` 818, `tauri/commands/authoring.rs` 1478 (+16 inline test), `sidecar/stage-gate-hook.ts` 122

Tests (16 files, 5701 lines): `core/tests/authoring_acceptance.rs` 913, `core/tests/authoring_board_read.rs` 258, `core/tests/authoring_criterion_reachability.rs` 174, `core/tests/authoring_distillation.rs` 263, `core/tests/authoring_lifecycle.rs` 449, `core/tests/authoring_measurement.rs` 641, `core/tests/authoring_stage_marker_contract.rs` 239, `core/tests/authoring_stage.rs` 330, `core/tests/authoring_tracer.rs` 335, `core/tests/bin/uat_authoring_ops.rs` 617, `sidecar/test/authoring-stage-gate.test.mjs` 240, `sidecar/test/authoring-staging-id.test.mjs` 212, `sidecar/test/authoring-tools.test.mjs` 450, `sidecar/test/authoring-proposal-wire.test.mjs` 105, `desktop/session/__tests__/authoring-composer.test.tsx` 235, `desktop/session/__tests__/authoring-stage.test.tsx` 240

UAT/scripts (10922 lines): `scripts/uat/uat-08-socratic-authoring.mjs` 9322, `scripts/uat/uat-09-product-kill-criterion.mjs` 527, `scripts/uat/lib/fake-authoring-claude.mjs` 1073

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 05-socratic-epic-authoring: 37/19/29; 06-agents-file-their-own-backlog: 3/2/0; 11-ship-it: 1/1/0; 13-nothing-new-escapes-the-fence: 4/3/1; 15-nothing-typed-that-an-agent-could-draft: 5/5/0; 260929-lq1-re-read-before-deciding-fix-stale-snapsh: 1/0/0; 260929-nxq-the-live-uat-driver-must-answer-the-agen: 1/0/0; 260929-p61-the-live-challenge-stage-asks-cyril-the-: 1/0/0

Git: 131 commits touch any attributed file (10 with subject starting `fix`); 41 touch source only (2 fix).

### 6 Proposal tray / agent backlog & triage

Source (8 files, 4413 lines; inline #[cfg(test)] lines moved to test: 0):
`core/domain/authoring_proposal.rs` 2304, `desktop/authoring/ProposalAmendEditor.tsx` 236, `desktop/authoring/ProposalRow.tsx` 431, `desktop/authoring/ProposalTray.tsx` 162, `desktop/authoring/useAuthoringQuery.ts` 294, `desktop/triage/TriageSurface.tsx` 588, `desktop/board/TriageLane.tsx` 268, `desktop/board/ChallengeRow.tsx` 130

Tests (15 files, 9025 lines): `core/tests/authoring_proposal.rs` 1488, `core/tests/proposal_channel.rs` 271, `core/tests/proposal_duplicates.rs` 937, `core/tests/proposal_limit_per_kind.rs` 421, `core/tests/proposal_limit.rs` 440, `core/tests/proposal_no_promotion.rs` 1643, `core/tests/proposal_triage_verbs.rs` 778, `core/tests/authority_human_only.rs` 506, `sidecar/test/propose-item-wire.test.mjs` 313, `desktop/authoring/__tests__/proposal-keyboard.test.tsx` 335, `desktop/authoring/__tests__/proposal-tray.test.tsx` 576, `desktop/triage/__tests__/triage-routing.test.tsx` 246, `desktop/triage/__tests__/triage-surface.test.tsx` 397, `desktop/board/__tests__/triage-lane.test.tsx` 241, `desktop/board/__tests__/challenge-inline.test.tsx` 433

UAT/scripts (864 lines): `scripts/uat/uat-10-agent-backlog.mjs` 864

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 05-socratic-epic-authoring: 4/4/0; 06-agents-file-their-own-backlog: 9/7/0; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 3/3/0; 13-nothing-new-escapes-the-fence: 7/4/2; 15-nothing-typed-that-an-agent-could-draft: 3/3/0

Git: 73 commits touch any attributed file (8 with subject starting `fix`); 43 touch source only (3 fix).

### 7 Fleet / search / ranking / project rail

Source (12 files, 3534 lines; inline #[cfg(test)] lines moved to test: 147):
`core/query/fleet.rs` 529, `core/query/search.rs` 532, `core/ranking.rs` 86 (+41 inline test), `tauri/commands/fleet.rs` 463 (+106 inline test), `desktop/fleet/BlockedQueue.tsx` 124, `desktop/fleet/FleetSurface.tsx` 582, `desktop/fleet/WorktreeInventory.tsx` 450, `desktop/fleet/useFleet.ts` 143, `desktop/fleet/useWatchedRun.ts` 24, `desktop/projects/ProjectRail.tsx` 415, `desktop/projects/ProjectUnreachable.tsx` 76, `desktop/projects/RegisterProjectFlow.tsx` 110

Tests (18 files, 5117 lines): `core/tests/fleet_perf.rs` 205, `core/tests/fleet_query.rs` 669, `core/tests/ranking.rs` 380, `core/tests/search_filter.rs` 420, `core/tests/bin/uat_fleet_ops.rs` 274, `desktop/fleet/__tests__/blocked-queue.test.tsx` 170, `desktop/fleet/__tests__/fleet-activity.test.tsx` 294, `desktop/fleet/__tests__/fleet-spend.test.tsx` 237, `desktop/fleet/__tests__/fleet-surface.test.tsx` 351, `desktop/fleet/__tests__/jump.test.tsx` 592, `desktop/fleet/__tests__/watched-run.test.tsx` 70, `desktop/fleet/__tests__/worktree-inventory.test.tsx` 215, `desktop/fleet/__tests__/worktree-reclaim.test.tsx` 215, `desktop/fleet/__tests__/browser/fleet-group.browser.test.tsx` 425, `desktop/fleet/__tests__/browser/fleet-jump.browser.test.tsx` 162, `desktop/projects/__tests__/project-rail.test.tsx` 321, `desktop/projects/__tests__/register-project-flow.test.tsx` 39, `desktop/projects/__tests__/unreachable-in-app.test.tsx` 78

UAT/scripts (313 lines): `scripts/uat/uat-12-fleet-live-reads.mjs` 313

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 5/4/1; 02-one-agent-one-worktree-watched-live: 1/1/0; 03-nothing-lost-nothing-left-running: 1/1/0; 05-socratic-epic-authoring: 1/0/0; 06-agents-file-their-own-backlog: 1/1/0; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 5/5/0; 10-fleet-supervision-across-every-project: 8/8/0; 11-ship-it: 2/1/0; 13-nothing-new-escapes-the-fence: 3/3/1; 14-cycles-on-screen-state-in-colour: 1/1/0

Git: 65 commits touch any attributed file (11 with subject starting `fix`); 46 touch source only (9 fix).

### 8 Keyboard/UI state, legend, theme, shell, styles

Source (24 files, 5436 lines; inline #[cfg(test)] lines moved to test: 0):
`desktop/state/keyboard.ts` 897, `desktop/state/menuSync.ts` 45, `desktop/state/uiStore.ts` 462, `desktop/legend/Legend.tsx` 212, `desktop/legend/StateBadge.tsx` 150, `desktop/legend/marks.ts` 598, `desktop/legend/runStatus.ts` 116, `desktop/theme/contrast.ts` 41, `desktop/theme/cvd.ts` 110, `desktop/theme/tokens.ts` 235, `desktop/shell/LaunchOverlapToast.tsx` 58, `desktop/styles/admin-surfaces.css` 444, `desktop/styles/motion.css` 135, `desktop/styles/states-and-confirms.css` 283, `desktop/styles/tokens.css` 288, `desktop/styles/type.css` 69, `desktop/App.tsx` 441, `desktop/App.css` 232, `desktop/main.tsx` 9, `desktop/vite-env.d.ts` 1, `tauri/menu.rs` 128, `tauri/commands/menu.rs` 36, `desktop/assets/logo-glyph.svg` 222, `desktop/assets/logo.svg` 224

Tests (16 files, 2609 lines): `desktop/state/__tests__/keyboard-agent.test.ts` 229, `desktop/state/__tests__/keyboard-fleet.test.ts` 121, `desktop/state/__tests__/surface-union.test.ts` 57, `desktop/legend/__tests__/legend.test.tsx` 393, `desktop/legend/__tests__/state-badge.test.tsx` 214, `desktop/theme/__tests__/brand-rule.test.ts` 161, `desktop/theme/__tests__/contrast.test.ts` 597, `desktop/theme/__tests__/cvd.test.ts` 169, `desktop/theme/__tests__/icons.test.ts` 165, `desktop/theme/__tests__/motion.test.ts` 139, `desktop/theme/__tests__/state-token-gate.test.ts` 159, `desktop/theme/__tests__/wash-visibility.test.ts` 44, `desktop/shell/__tests__/launch-overlap-toast.test.tsx` 40, `desktop/test/browser-setup.ts` 17, `desktop/test/node-shims.d.ts` 18, `desktop/test/setup.ts` 86

Plans touching any attributed file (files_modified frontmatter), per phase [total / touching source / gap_closure]: 01-the-board-is-the-store-of-record: 18/17/8; 02-one-agent-one-worktree-watched-live: 4/4/0; 03-nothing-lost-nothing-left-running: 4/4/0; 05-socratic-epic-authoring: 4/4/0; 06-agents-file-their-own-backlog: 2/2/0; 08-review-and-merge-inside-flywheel: 5/5/2; 08.1-visual-polish-brand-assets-and-confirmed-motion-inserted: 9/9/0; 09-planned-fan-out-that-does-not-collide: 2/2/0; 10-fleet-supervision-across-every-project: 5/5/0; 11-ship-it: 4/3/0; 13-nothing-new-escapes-the-fence: 3/3/1; 14-cycles-on-screen-state-in-colour: 4/4/0; 15-nothing-typed-that-an-agent-could-draft: 2/2/0

Git: 142 commits touch any attributed file (21 with subject starting `fix`); 119 touch source only (17 fix).

