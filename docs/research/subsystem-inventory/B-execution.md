# Group B: execution and dispatch, subsystem inventory (facts only)

Repo: `/Users/cymarechal/cymarechal/HighKnow-harness-worktrees/mvp`, branch `mvp`, HEAD `812533ef`. Read-only survey, 2026-10-16.

## 1. Summary table

Test lines = inline `#[cfg(test)]` modules + dedicated test files. UAT = `scripts/uat/*` lines attributed to the row. Commits = `git log --oneline -- <files>` over **all** attributed files (source + test + UAT), with source-only figures in brackets. Fix = subjects matching `^fix` (case-insensitive). Plans = PLAN.md files whose frontmatter `files_modified` lists at least one attributed file (288 PLAN.md files scanned, all have `files_modified`).

| Subsystem | Source lines | Test lines (+UAT) | Depends on it | Record types assumed | Planning (phases/plans) | Commits (fix) |
|---|---|---|---|---|---|---|
| 1a Sidecar supervision (Rust) | 2,133 | 2,002 (694 inline + 1,308 dedicated) + 566 UAT | `main.rs` (spawn, exit-time shutdown), `commands/agent_run.rs`, `commands/authoring.rs`, `commands/dispatch.rs`, `state.rs`. `runtime_protocol` is imported by `dispatch_exec.rs`, `domain/agent_run.rs`, `domain/authoring_session.rs`, `domain/file_set.rs`, `git_hooks.rs`, `shim.rs`, `db/mod.rs` | agent_run, task, trigger, event, project, settings, dispatch_plan (SQL in `sidecar.rs`) | 32 plans: P02:8, P03:8, P04:1, P05:8, P09:5, P11:1, P13:1. Gap-closure: 11 | 49 (4 fix) [src only: 40 (3)] |
| 1b Claude Code adapter (sidecar) | 3,337 | 3,245 + 0 UAT (shared harness, see notes) | `sidecar.rs` (stdio protocol), `claude-code-adapter.ts` is imported by `index.ts`. `watchdog.js` is spawned by `claude-code-adapter.ts`. `writeHookSettings` (in the adapter) wires the destructive-gate, scope, stage-gate and SessionStart hooks | No DB access. Wire ids: runId (122 occurrences in the adapter), epicId, worktree path. Carries authoring session, proposal and summary payloads | 33 plans: P02:8, P03:5, P04:1, P05:10, P06:1, P09:4, P10:1, P11:1, P12:1, P15:1. Gap-closure: 13 | 63 (11 fix) [src: 45 (7)] |
| 1c Agent run domain + session UI | 6,800 | 6,718 (1,664 inline + 5,054 dedicated) + 0 UAT | `domain::agent_run` imported by `authoring_proposal.rs`, `authoring_session.rs`, `dispatch_plan.rs`, `permission_request.rs`, `query/authoring.rs`, `query/fleet.rs`, tauri `authoring.rs`, `dispatch.rs`, `file_set.rs`, `update.rs`, `git_truth.rs`, `main.rs`, `sidecar.rs`, `state.rs`. `session_log` is also imported by tauri `fleet.rs`. UI: `SessionSurface` mounted by `App.tsx`, `CommandPalette.tsx`, `FleetSurface.tsx`; `FeedRow` reused by `FleetSurface.tsx`; `RunsSection` by `ItemDetailPanel.tsx` | agent_run (51 SQL refs), event, task, worktree, trigger, epic, actor, permission_request, permission_rule, project, session_summary | 63 plans: P02:12, P03:11, P04:11, P05:5, P06:1, P08:1, P08.1:3, P09:4, P10:4, P11:5, P13:5, P14:1. Gap-closure: 12 | 133 (23 fix) [src: 112 (20)] |
| 1d Launch sheet | 1,025 | 1,015 + 0 UAT | `App.tsx` mounts both `LaunchSheet` and `LaunchOverlapToast` | task, acceptance criterion (criteria-route drafting), epic, worktree, session summary (read via DTOs; no SQL) | 11 plans: P02:1, P04:2, P05:2, P08.1:2, P09:1, P11:1, P15:2. Gap-closure: 2 | 17 (1 fix) [src: 12 (1)] |
| 2 Fan-out dispatcher | 4,617 | 5,313 (185 inline + 5,128 dedicated) + 273 UAT | `dispatch_exec` called by `scheduler.rs` (dispatch tick) and tauri `commands/dispatch.rs`. `dispatch` module used by `git_facts.rs` (`observe`), `domain/file_set.rs`, tauri `settings.rs`, `update.rs`, `agent_run.rs`. `dispatch_plan` used by `domain/file_set.rs`, tauri `file_set.rs`, `sidecar.rs` (`handle_inbound_submit_plan`). UI: `EpicDispatchControls` mounted in `board/EpicHeaderRow.tsx`; `WavePlanSheet` in `App.tsx` | dispatch_plan, dispatch_plan_task, dispatch_edge, task, agent_run, epic, event, project, actor, trigger, worktree, task_file_set_entry | 21 plans: P09:10, P11:5, P13:3, P15:3. Gap-closure: 5 | 62 (8 fix) [src: 42 (7)] |
| 3 Context packet & session summaries | 2,162 | 4,918 + 0 UAT | `context_packet` used by `compaction.rs`, `drift.rs`, `epic_context_packet.rs`, `query/authoring.rs`, tauri `agent_run.rs`, `dispatch.rs`. `epic_context_packet` used by `dispatch_exec.rs`, `query/authoring.rs`, tauri `authoring.rs`. `session_summary` used by `domain/agent_run.rs`, `forge/request_body.rs`, tauri `agent_run.rs` | session_summary, agent_run, authoring_proposal, task, epic, acceptance criterion, criterion_anchor, project, worktree, event | 25 plans: P02:1, P04:10, P05:5, P08:1, P08.1:1, P09:2, P13:3, P15:2. Gap-closure: 5 | 51 (7 fix) [src: 26 (2)] |
| 4 Compaction | 211 | 328 (51 inline + 277 dedicated) + 0 UAT | `context_packet.rs`, `drift.rs`, tauri `commands/agent_run.rs` | None by SQL; operates on `context_packet::SummaryEntry` (session summary rows) | 3 plans: P04:1, P13:2. Gap-closure: 1 | 6 (1 fix) [src: 5 (1)] |
| 5 Scheduler | 782 | 400 (inline only) + 0 UAT | `main.rs` (`start_git_truth_scheduler`), `sidecar.rs` and `commands/dispatch.rs` (`nudge_dispatch`, 6 call sites). `domain::trigger` used by `domain/agent_run.rs`, `domain/authoring_session.rs`, `domain/dispatch_plan.rs` | task, project, worktree, trigger, dispatch_plan_task | 10 plans: P02:1, P07:4, P09:1, P10:1, P13:3. Gap-closure: 2. 1 quick task | 15 (4 fix) [src: 15 (4)] |
| 6 Crash/launch reconciliation & orphan recovery | 576 (+ about 407 lines inside files counted in 1c, see notes) | 2,573 + 0 UAT | `query::recovery` used only by tauri `commands/agent_run.rs` (`board_recovery_summary`). `reconcile_agent_runs` called from `main.rs` setup. `OrphanRecoveryModal` mounted in `App.tsx` | agent_run, worktree, event | 11 plans: P01:1, P03:5, P04:1, P05:1, P08.1:1, P10:1, P14:1. Gap-closure: 1 | 20 (3 fix) [src: 12 (3)] |

Sum of source lines across the 9 rows: 21,643. Sum of test lines: 26,512. Sum of attributed UAT: 839.

## 2. Method

- Source lines: `wc -l`. Includes `.sql` migrations and `.css` attributed to a row. For Rust files, test lines were counted per top-level `#[cfg(test)] mod … { … }` block, from the attribute line to the closing `}` at column 0. Two files have non-test code after their first test module, so the "first `#[cfg(test)]` to EOF" rule gives a different figure:
  - `sidecar.rs` has 5 test modules (`persist_tests` 1147–1544, `stderr_tail_tests` 1550–1599, `scope_denied_tests` 2011–2114, `rate_limit_tests` 2116–2171, `submit_plan_tests` 2176–2261). `spawn_sidecar` (1606–2006) sits between them. Brace-matched test lines: 694. Literal EOF rule: 1,115.
  - `scheduler.rs` (681–1018, 1019–1081): 400 brace-matched, 401 by the EOF rule. `commands/dispatch.rs` (750–804, 805–935): 185 brace-matched, 186 by the EOF rule.
  - One indented `#[cfg(test)]` constructor (`sidecar.rs:608`, `without_child_for_tests`) is counted as source.
- Dependents come from a grep for `<module>::` / `use` paths in `packages/core/src` and `packages/desktop/src-tauri/src`, with comment and string lines excluded. Desktop imports were checked with `from …/<Component>` greps.
- Record types come from `FROM|JOIN|INTO|UPDATE|TABLE <name>` matches in the row's `.rs` and `.sql` source files, plus DTO field names for the TS rows.
- Plans and gap-closure counts are matched on frontmatter `files_modified` against each row's full file set (source, test and UAT). The plan count touching source files only is: 1a 31, 1b 31, 1c 62, 1d 11, 2 17, 3 20, 4 3, 5 10, 6 8.

## 3. Per-subsystem file lists

### 1a Sidecar supervision (Rust)
Source:
- `packages/desktop/src-tauri/src/sidecar.rs`: 2,261 total, 1,567 source, 694 test. It also hosts the inbound handlers for other subsystems: `handle_inbound_git_lock_exhausted`, `handle_inbound_rate_limit` (limit gate), `handle_inbound_submit_plan` (dispatcher), `handle_inbound_scope_denied` and `handle_inbound_scope_backstop` (scope fence).
- `packages/core/src/runtime_protocol.rs`: 566. This is the on-disk heartbeat, kill-record and run-descriptor protocol shared with `watchdog.ts`. It also contains `process_is_alive` (l.520), which recovery uses.

Tests:
- `core/tests/runtime_protocol.rs` (334)
- `session_closed_call_site.rs` (167)
- `app_exit_ordering.rs` (169)
- `supervisor_cwd.rs` (254): a repo-wide PROC-02 cwd gate
- `runtime_context_call_sites.rs` (120): a `block_on` timer-construction gate on desktop call sites
- `sidecar/test/stub-invocation.test.mjs` (185)
- `packaged-sidecar.test.mjs` (79)

UAT (566):
- `uat-01-supervisor-kill.sh` (187)
- `lib/supervisor.mjs` (153)
- `lib/long-lived-backend.mjs` (36)
- `harness-supervision-gate.mjs` (190): this is the UAT harness's own heartbeat gate

Related, not attributed: `src-tauri/src/main.rs` (314; spawn, exit and reconcile call sites), `packages/sidecar/scripts/launcher.sh`, `packages/sidecar/scripts/stage-runtime.mjs`.

Planning:
- Debug file: `.planning/debug/uat-03-closes-while-blocked.md`. Its root cause was that the uat-03 harness never wrote the heartbeat, so `watchdog.ts` reaped the session. The files it changed are UAT harness files. Status: `awaiting_human_verify`.
- Gap-closure plans: 02-12, 02-14, 02-15, 02-18, 03-15, 03-23, 03-25, 05-12, 05-13, 05-14, 05-48.

### 1b Claude Code adapter (sidecar)
Source (3,337):
- `packages/sidecar/src/adapter.ts` (590)
- `claude-code-adapter.ts` (2,006): includes the authoring-session spawn and turn paths and `writeHookSettings`
- `index.ts` (388)
- `watchdog.ts` (292)
- `sessionstart-hook.ts` (61)

Tests (3,245), all in `packages/sidecar/test/`:
- `adapter.test.mjs` (1,027)
- `close-provenance.test.mjs` (459)
- `fake-claude.mjs` (290)
- `real-claude-argv.test.mjs` (453)
- `shutdown.test.mjs` (286)
- `stop.test.mjs` (222)
- `watchdog.test.mjs` (232)
- `sessionstart-hook.test.mjs` (153)
- `execution-hook-settings.test.mjs` (123)

Shared UAT plumbing, not attributed to any row: `scripts/uat/lib/sidecar-harness.mjs` (1,958), `run-all.sh` (129), `uat-ui-setup.sh` (190), `README.md` (1,183). `uat-06-permission-block-lifecycle.mjs` (381) measures session ending under a destructive-gate request and is left to the gate/permission inventory.

Imports from outside this row: `claude-code-adapter.ts` imports `mcp-permission-server.ts` (1,700 lines, which hosts the `report_summary` and `submit_plan` tools; other inventory).

Planning:
- Debug file: `uat-06b-bash-gate-regression.md`, a regression from the Phase 6 `--allowedTools` change in `claude-code-adapter.ts`. Status: `reverted_routed_to_planning`.
- Pending todos: `2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`, `2026-10-16-agent-runs-adapter-is-written-as-a-constant-never-threaded.md`.
- Gap-closure plans: 02-14, 02-15, 02-17, 02-18, 03-20, 03-21, 05-12, 05-30, 05-34, 05-37, 05-41, 05-44, 05-48.

### 1c Agent run domain + session UI
Source (6,800):
- `core/src/domain/agent_run.rs` (1,250). Lines 925–1250 (326 lines: `mark_abandoned`, `LiveOrphan`, `reconcile_agent_runs`, `kill_orphan`) are recovery code, counted here.
- `core/src/session_log.rs` (275)
- `core/src/query/agent_runs.rs` (115)
- `core/src/db/migrations/0003_agent_runtime.sql` (92)
- `src-tauri/src/commands/agent_run.rs`: 4,151 total, 2,487 source, 1,664 test. It has 24 `#[tauri::command]`s and also hosts:
  - permission-request handling, about l.1312–1869 (other inventory's domain)
  - worktree commands, l.2209–2406 (`worktree_summary/remove_check/remove/recreate/forget_record`)
  - orphan and recovery commands (`board_recovery_summary` l.1870, `agent_runs_pending_orphans` l.2407, `orphan_kill` l.2457 to 2487)
  - `agent_run_discard`
- `desktop/src/session/SessionSurface.tsx` (1,273): also renders the authoring-session stage and proposal tray
- `FeedRow.tsx` (538)
- `RawLogView.tsx` (115)
- `session.css` (284)
- `desktop/src/item-detail/RunsSection.tsx` (371)

Not attributed: `session/PermissionRequestCard.tsx` (426) and `permission-card.test.tsx` go to the permission inventory, and `authoring-composer/authoring-stage` tests go to authoring. `adapters/tauri.ts` (2,217) is shared and has 53 `agent_run`/`agentRun` references.

Tests (5,054 dedicated):
- `core/tests/agent_tracer.rs` (121)
- `session_close_lifecycle.rs` (331)
- `session_log_tail.rs` (165)
- `session_log_window.rs` (192)
- `stop_lifecycle.rs` (173)
- `run_kind.rs` (249)
- `agent_run_stop_ordering.rs` (103)
- `discard_lifecycle.rs` (622)
- `termination_atomicity_call_site.rs` (290)
- `tests/bin/uat_session_env.rs` (96)
- `session-surface.test.tsx` (1,183)
- `feed-row.test.tsx` (243)
- `session/__tests__/finish.test.tsx` (236)
- `browser/session-group.browser.test.tsx` (570): captures the session, permission card and launch sheet together
- `item-detail/__tests__/runs-section.test.tsx` (480)

Planning:
- Pending todo: `2026-10-16-epic-rows-draw-no-state-even-with-a-running-agent.md` (board UI).
- Gap-closure plans: 02-11, 02-12, 02-16, 02-17, 02-18, 03-15, 03-17, 04-15, 04-16, 05-12, 09-13, 13-12.

### 1d Launch sheet
Source (1,025):
- `desktop/src/launch-sheet/LaunchSheet.tsx` (967)
- `desktop/src/shell/LaunchOverlapToast.tsx` (58): the overlap warning for a launch over a live task, from plan 09-13

Tests (1,015):
- `launch-sheet.test.tsx` (795)
- `criteria-route.test.tsx` (180)
- `launch-overlap-toast.test.tsx` (40)

Gap-closure plans: 05-13, 09-13.

### 2 Fan-out dispatcher
Source (4,617):
- `core/src/dispatch.rs` (960; `decide` l.893)
- `core/src/dispatch_exec.rs` (356; `run_pass` l.193)
- `core/src/domain/dispatch_plan.rs` (1,328)
- `core/src/db/migrations/0019_fan_out.sql` (73)
- `src-tauri/src/commands/dispatch.rs`: 935 total, 750 source, 185 test. It has 15 commands: `dispatch_plan_create/get/edit/approve/pause/resume/stop`, `dispatch_advance_now`, `retry_task`, `skip_task`, `dispatch_why`, `dispatch_gate_state`, `dispatch_gate_resume_now`, `dispatch_planning_run`, `dispatch_plan_generate`.
- `desktop/src/dispatch/WavePlanSheet.tsx` (515)
- `EpicDispatchControls.tsx` (205)
- `DispatchGateLine.tsx` (98)
- `queries.ts` (95)
- `dispatch.css` (237)

Auto-merge is in `dispatch_exec.rs` and `dispatch.rs`. It is tested by `dispatch_auto_merge.rs` and calls the merge code in `core/src/merge.rs`, which belongs to another inventory.

Tests (5,128 dedicated):
- `core/tests/dispatch_auto_merge.rs` (1,651)
- `dispatch_cap.rs` (178)
- `dispatch_plan.rs` (1,162)
- `tests/bin/uat_fanout_ops.rs` (463)
- `sidecar/test/submit-plan-wire.test.mjs` (207)
- `dispatch-controls.test.tsx` (228)
- `dispatch-layout.browser.test.tsx` (355)
- `gate-line.test.tsx` (134)
- `stuck-task.test.tsx` (142)
- `wave-plan-sheet.test.tsx` (286)
- `file-set-chips.test.tsx` (198): renders `WavePlanSheet`, plan 15-05 file-set chips
- `limit-surface.test.tsx` (124): renders `DispatchGateLine`, plan 15-03 limit gate

The last two are candidates for reassignment to the file-set and limit-gate inventories.

UAT (273): `scripts/uat/uat-13-fan-out-live.mjs`.

Excluded and left to other inventories: `core/src/limit_gate.rs` (412), `tests/dispatch_limit_gate.rs` (409), `dispatch_limit_floor.rs` (203), `uat-15-account-limit.mjs` (594), `uat-14-planner-file-set.mjs` (626), `spawn_stagger.rs` (240; `SpawnFloor` lives in `git_retry.rs`).

Planning:
- DEFERRED-REVIEW items D-REV-34 (the live end-to-end fan-out in the installed app), D-REV-35 (a live `dispatch_plan_generate` planning run) and D-REV-36 (the installed-app wave sheet and dispatch cell) are all `owner-question` (2026-10-14, plan 11-21).
- The milestone audit lists D-REV-44 (the launch body vs. dispatcher case-folding rule) as open.
- REQUIREMENTS.md: PLAN-01 is "Unmet. Code path proven against a fake backend; never run live (D-REV-35)".
- Gap-closure plans: 09-10, 09-11, 09-12, 09-13, 13-15.

### 3 Context packet & session summaries
Source (2,162):
- `core/src/context_packet.rs` (751)
- `core/src/epic_context_packet.rs` (704)
- `core/src/domain/session_summary.rs` (652)
- `core/src/db/migrations/0008_session_summaries.sql` (55)

`0013_authoring_summaries.sql` is not attributed (authoring). The `report_summary` tool registration lives in `sidecar/src/mcp-permission-server.ts` (other inventory).

Tests (4,918):
- `context_packet.rs` (766)
- `context_packet_bound.rs` (299)
- `epic_context_packet.rs` (1,049)
- `five_cycle_reconstitution.rs` (570)
- `session_summary_lifecycle.rs` (690)
- `summary_report_wire.rs` (414)
- `start_pin_ordering.rs` (320)
- `diff_so_far.rs` (410): also covers the `git.rs` diff-stat read
- `sidecar/test/summary-report.test.mjs` (209)
- `five-cycle.test.mjs` (191)

Planning:
- The milestone audit marks "P2 → P4: session summaries feed context reconstitution" as wired.
- Gap-closure plans: 04-16, 05-13, 05-45, 13-12, 13-17.

### 4 Compaction
- Source: `core/src/compaction.rs`, 262 total, 211 source, 51 inline test.
- Tests: `core/tests/compaction.rs` (277).
- Gap-closure plan: 13-17.
- Matches in DEFERRED-REVIEW and the milestone audit: 0.

### 5 Scheduler
Source (782):
- `src-tauri/src/scheduler.rs`: 1,081 total, 681 source, 400 test. It registers 5 `tokio-cron-scheduler` `Job::new_repeated_async` jobs: git-facts hot tick, cold tick, `git fetch` tick, forge poll tick, and the fan-out dispatch tick (`run_dispatch_tick` → `dispatch_exec`). Its own module doc names the git-truth tick as "the first job `tokio-cron-scheduler` has ever actually run". There is no cron-expression trigger.
- `core/src/domain/trigger.rs` (101): `TriggerSource` has 4 variants (`UserAction`, `Schedule`, `Webhook`, `AgentProposal`). Only the `create_user_action_trigger*` constructors are called from outside the file (by `agent_run.rs`, `authoring_session.rs`, `dispatch_plan.rs`). There are no non-`user_action` producers in the code.

Tests: no dedicated test file. Inline modules are `forge_tick_tests` and `dispatch_tick_tests`.

Planning:
- Quick task: `261005-mn5-fix-the-forge-tick-lost-update-race` (`scheduler.rs`, `forge/transitions.rs`, `forge/mod.rs`).
- Gap-closure plans: 07-11, 13-16.

### 6 Crash/launch reconciliation & orphan recovery
Source (576):
- `core/src/query/recovery.rs` (117)
- `core/src/db/migrations/0006_recovery_statuses.sql` (100)
- `desktop/src/recovery/OrphanRecoveryModal.tsx` (359)

Recovery code inside files counted in other rows:
- `domain/agent_run.rs` l.925–1250 (326 lines, in 1c)
- tauri `commands/agent_run.rs` orphan commands l.2407–2487 (81 lines, in 1c), plus `board_recovery_summary`
- `runtime_protocol::process_is_alive` (in 1a)
- `domain/worktree.rs::reconcile_worktrees` (l.420; worktree inventory)
- the `main.rs` setup call to `reconcile_agent_runs`

Tests (2,573):
- `launch_reconciliation.rs` (643)
- `recovery_statuses.rs` (432)
- `recovery_summary.rs` (217)
- `reconcile_worktrees.rs` (546): tests `domain/worktree.rs`
- `crash_safety.rs` (145): DATA-07, a DB survives-kill test
- `tests/bin/crash_harness.rs` (117)
- `recovery/__tests__/orphan-recovery.test.tsx` (473)

Planning:
- Pending todo: `2026-10-16-app-launch-writes-false-abandoned-events-on-demo-runs.md`.
- Gap-closure plan: 03-17.

## 4. Cross-row planning context
- Phase totals (PLAN.md count) for the phases most of this group came from: 02 one-agent-one-worktree 18, 03 nothing-lost-nothing-left-running 38, 04 clear-is-free 16, 09 planned-fan-out 13. Phase 05 (socratic authoring, 50 plans) touches 1a, 1b and 1c through the authoring paths in the shared files.
- `.planning/debug`: 2 of 5 files concern this group (uat-03 for supervision/heartbeat, uat-06b for the adapter). The 3 others are authoring and uat-08.
- `.planning/quick`: 1 of 6 touches this group (261005-mn5, scheduler). 260918-nch built the shared UAT harness.
- Keyword hits in DEFERRED-REVIEW.md (1,607 lines): dispatch/fan-out/WavePlan 60, context_packet/summary 20, agent_run/SessionSurface/FeedRow 14, sidecar/supervis 11, recovery/orphan/reconcil 11, launch sheet 9, scheduler/tick 9, adapter 8, compaction 0. These are raw `grep -ci` line counts, not item counts.
