# Subsystem inventory (state of `main`, 2026-10-16)

Facts only, no recommendations. Input to "Which existing subsystems are kept, frozen or deleted for the MVP?" (HighKnow-ai/flywheel#12).

**Columns**
- **Src / Test**: `wc -l`. Inline Rust `#[cfg(test)]` modules are counted as test lines.
- **UAT**: lines of UAT scripts under `scripts/uat` attributable to the subsystem.
- **Plans (gap)**: PLAN.md files in `.planning/` whose `files_modified` names any of the subsystem's files. A plan that touches two subsystems counts in both. The figure in brackets is how many were gap-closure plans.
- **Commits (fix)**: `git log` over the subsystem's files. The figure in brackets is how many subjects start with `fix`.
- **Records**: the board tables the subsystem references.

The per-group files hold the file lists, the full dependents and the derivation notes:
[A safety](A-safety.md) · [B execution](B-execution.md) · [C board](C-board.md) · [D git](D-git.md) · [E shipping](E-shipping.md).

| # | Subsystem | Src | Test | UAT | Depends on it | Records | Plans (gap) | Commits (fix) |
|---|---|---:|---:|---:|---|---|---|---|
| **Safety & guards** |||||||||
| 1 | Destructive gate: 4 layers + shared classifier | 3,383 | 6,837 | 990 | sidecar adapter (hook wiring), `sidecar.rs` (shim env), `domain/project.rs` (hook install), permission requests | projects, agent_runs, permission_requests | 31 (23); phase 3: 24, phase 12: 6; 3 debug files | 95 (14) |
| 1.0 | — L0: supervisor shim install (`shim.rs`) | 376 | 0 | 0 | `sidecar.rs`, `git_hooks.rs` | agent_run dir | 2 (1) | 4 (0) |
| 1.1 | — L1: PreToolUse + SessionStart hooks (sidecar) | 404 | 3,288 | 330 | `claude-code-adapter.ts` | none | 15 (11) | 43 (6) |
| 1.2 | — L2: `flywheel-shim` binary | 1,696 | 767 | 0 | L1, scope hook, L3, every agent `git`/`rm` | agent_run, permission_requests | 15 (8) | 26 (4) |
| 1.3 | — L3: git pre-push hook (+ commit-msg trailer hook, same file) | 574 | 1,472 | 0 | `domain/project.rs`, `git_identity.rs` | project, worktree | 5 (1) | 10 (1) |
| 1.c | — shared classifier `destructive.rs` (+976-line trust-boundary doc) | 333 | 1,310 | 660 | shim, `git_hooks.rs`, `permission_request.rs` | projects, permission_requests | 14 (10) | 33 (3) |
| 2 | Permission requests / rules | 3,025 ¹ | 1,504 | 381 | `commands/agent_run.rs`, `sidecar.rs`, adapter, Runs/Blocked/Session UI, Settings | permission_requests, permission_rules, agent_runs, tasks | 25 (7); AGNT-06: 4 | 44 (7) |
| 3 | File-set scope fence | 1,624 | 4,362 | 626 | dispatcher, drift, context packet, git facts, shim `--scope-check`, FeedRow | task_file_set_entries, tasks, agent_runs, dispatch_* | 11 (1) | 30 (4) |
| 4 | Limit gate (account/rate limit) | 510 | 1,060 | 594 | `dispatch.rs`, `dispatch_exec.rs`, `sidecar.rs`, dispatch UI | settings, events, agent_runs, tasks | 6 (0) | 14 (0) |
| 5 | Git lock retry / spawn floor | 280 | 1,465 | 219 | `git.rs`, `domain/agent_run.rs`, shim, `sidecar.rs` | events, agent_runs, worktree | 6 (1) | 17 (1) |
| **Execution** |||||||||
| 6 | Sidecar supervision (Rust) | 2,133 | 2,002 | 566 | `main.rs`, commands agent_run/authoring/dispatch; `runtime_protocol` used by 7 core modules | agent_run, task, trigger, event, project, settings, dispatch_plan | 32 (11) | 49 (4) |
| 7 | Claude Code adapter (sidecar) | 3,337 | 3,245 | — ² | `sidecar.rs` (stdio protocol), `index.ts`; wires all 4 hook kinds | none (wire ids: runId, epicId) | 33 (13) | 63 (11) |
| 8 | Agent run domain + session UI | 6,800 ³ | 6,718 | 0 | 14 core/tauri modules; `SessionSurface` mounted by App, palette, fleet | agent_run, event, task, worktree, epic, permission_*, session_summary | 63 (12) | 133 (23) |
| 9 | Launch sheet | 1,025 | 1,015 | 0 | `App.tsx` | task, criterion, epic, worktree (via DTOs) | 11 (2) | 17 (1) |
| 10 | Fan-out dispatcher (incl. auto-merge) | 4,617 | 5,313 | 273 | scheduler dispatch tick, `git_facts`, `file_set`, settings, update, `submit_plan` | dispatch_plan(_task), dispatch_edge, task, agent_run, epic | 21 (5) | 62 (8) |
| 11 | Context packet & session summaries | 2,162 | 4,918 | 0 | compaction, drift, authoring query, dispatch_exec, forge request body | session_summary, agent_run, authoring_proposal, task, epic, criterion | 25 (5) | 51 (7) |
| 12 | Compaction | 211 | 328 | 0 | context packet, drift, `commands/agent_run.rs` | session summaries (in memory) | 3 (1) | 6 (1) |
| 13 | Scheduler (5 fixed-interval jobs) | 782 | 400 | 0 | `main.rs`, `sidecar.rs`, `commands/dispatch.rs` | task, project, worktree, trigger | 10 (2) | 15 (4) |
| 14 | Crash/launch reconciliation & orphan recovery | 576 ⁴ | 2,573 | 0 | `main.rs` setup, `commands/agent_run.rs`, `App.tsx` | agent_run, worktree, event | 11 (1) | 20 (3) |
| **Board, records & authoring** |||||||||
| 15 | DB + migrations + event log | 2,846 | 3,086 | 0 | everything | 26 tables (no PRD/ADR table) | 55 (7) | 72 (2) |
| 16 | Record domain (epic/task/issue/project) | 4,043 | 4,485 | 0 | every record-reading subsystem | tasks, epics, issues, projects, criteria, events | 44 (8) | 75 (5) |
| 17 | Board UI | 6,169 | 9,385 | 0 | `useBoardQuery` used by ~20 UI modules | Project/Epic/Task DTOs | 62 (11) | 156 (19) |
| 18 | Item detail UI | 822 | 649 | 0 | BoardView | Task/Epic/Issue/Criterion | 19 (2) | 26 (3) |
| 19 | IPC seam (`adapters/tauri.ts`, `main.rs`, board/record commands) | 4,123 | 422 | 0 | every desktop surface; 148 commands registered | 16 tables named | 91 (12) | 125 (6) |
| 20 | Acceptance criteria | 2,498 | 2,994 | 0 | epic/task, authoring proposals, context packet, review, launch sheet | acceptance_criteria, criterion_anchors | 13 (1) | 36 (6) |
| 21 | Cycles | 1,199 | 3,263 | 379 ⁵ | BoardView (`CycleRegion`) only | cycles, epics, tasks, events | 8 (1); phase 14: 6 | 25 (3) |
| 22 | Provisional tier | 168 | 797 | 0 | `commands/authoring.rs`, `authoring_proposal.rs` | authoring_proposals, tasks, epics, issues | 1 (0) | 6 (0) |
| 23 | Socratic authoring (UI is inside `SessionSurface`, counted in row 8) | 2,894 | 5,717 | 10,922 | `main.rs`, sidecar, dispatch, task commands, proposals | authoring_proposals, agent_runs, tasks, epics, issues, criteria | 53 (30); phase 5 alone: 50 plans, 40 gap; 3 debug, 3 quick | 131 (10) |
| 24 | Proposal tray / agent backlog / triage | 4,413 | 9,025 | 864 | authoring, provisional, search, BoardView, TriageSurface, `propose_item` tool | authoring_proposals, tasks, epics, issues, criteria | 26 (2); phase 6: 9 | 73 (8) |
| 25 | Fleet / search / ranking / project rail | 3,534 | 5,264 | 313 | ranking used by records; search by board/authoring/proposals | agent_runs, worktrees, projects, 4 FTS tables | 28 (2) | 65 (11) |
| 26 | UI state, keyboard, legend, theme, shell | 5,436 | 2,609 | 0 | every surface | none | 66 (11); phase 8.1: 9 | 142 (21) |
| **Git, forge & review** |||||||||
| 27 | Worktree lifecycle (`git.rs`, `branch.rs`, `proc.rs`, `domain/worktree.rs`) ⁶ | 3,253 | 3,406 | 532 | `git.rs` is the only `git` spawner: ~20 modules | worktree, task, project, agent_run | 22 (3) | 50 (10) |
| 28 | Git truth / git facts | 861 | 1,597 | 0 | dispatch_exec, status derivation, scheduler, board CI flags | task, worktree, agent_run, events | 5 (1) | 17 (3) |
| 29 | Drift detection (`drift.rs` + cycle scope drift) | 510 | 1,405 | 0 | context packet, agent run, `sidecar.rs`, CycleRegion | session_summaries, events, cycle | 6 (1) | 11 (1) |
| 30 | Forge integration (GitHub/GitLab, epic request) | 3,202 | 3,725 | 0 | status derivation, scheduler forge tick, ForgeSection, EpicRequestSheet | project, task, epic, criterion, events | 23 (9); 1 quick | 47 (6) |
| 31 | Review & merge | 3,412 | 5,211 | 0 | dispatcher (auto-merge), task, forge, fleet, ReviewSurface | task, epic, project, criterion, worktree | 23 (8); phase 8: 14 | 58 (13) |
| 32 | Git identity & credentials | 540 | 1,027 | 0 | settings, `sidecar.rs` spawn, command palette | settings, project, task | 5 (1) | 11 (1) |
| **Shipping, infra, verification** |||||||||
| 33 | Updater | 326 | 347 | 0 | `App.tsx`, `main.rs`, release.yml | agent_run (refuses while runs live) | 2 (0) | 3 (0) |
| 34 | Relay-client (16 doc-comment lines, 0 code) + open-core CI | 37 + 82 yml | 0 | 0 | nothing imports it; open-core.yml deletes it and builds | none | 3 (0) | 2 (0) |
| 35 | Packaging & release | 752 | 81 | 0 | `build:dist`, all 3 workflows | none | 8 (0); DIST-01 unmet | 14 (1) |
| 36 | Notifications & menu | 495 | 821 | 0 | `main.rs`, agent run, keyboard, pickers | agent_run, project, settings | 6 (2) | 17 (2) |
| 37 | Settings surface | 1,378 | 1,438 | 0 | credentials, dispatch, limit gate, worktree, forge | settings, project, permission_rule | 11 (1) | 25 (3) |
| 38 | Spikes & demo seeds | 2,328 | 524 | 0 | `demo-board.sh`, capture script; spikes referenced only in comments | demo seeds every table | 4 (0); 3 pending todos | 7 (0) |
| 39 | Source-scanning gates (21 dedicated files) | 0 | 4,538 | — | `cargo test`, vitest (ci.yml, open-core.yml); browser tests run by no workflow | per gate, see E §2 | 25 (7) | 130 (17) ⁷ |
| 40 | UAT harness (`scripts/uat` + `uat_*` bins) | 0 | — | 21,092 | `run-all.sh` only; **no CI workflow** | task, epic, issue, criterion, proposal, agent_run, worktree, … | 47 (35); phase 5: 33; 4 of 5 debug files; 5 quick | 116 (10) |

**Totals.** Rows 1–38: about 85,700 source and 109,000 test lines. Rows 39 and 40 are counted separately. Repo-wide `wc -l` across all of core, desktop, sidecar, shim and scripts is about 207,000 lines. The inventory covers almost all of it; what it leaves out is mainly shared harness plumbing and a few shared test files, listed in the group files. `.planning/` holds 294 PLAN.md files.

**Notes**
1. The permissions row includes `mcp-permission-server.ts` (1,700 lines), but only 1 of that file's 14 tools is about permissions. The other 13 are the authoring and proposal write surface. Without that file the row is 1,325 source lines.
2. The Claude Code adapter's UAT runs through the shared `sidecar-harness.mjs` (1,958 lines), which is counted in row 40.
3. `commands/agent_run.rs` (4,151 lines) is counted whole in row 8, but it also holds the permission commands (~560 lines), the worktree commands (~200) and the orphan commands (~80).
4. Recovery code also lives inside files counted in row 8, about 407 more lines.
5. Row 21's figure is the demo and capture scripts that cycles use, not UAT.
6. Row 27 excludes `git_retry.rs` (row 5) and `git_hooks.rs` (row 1.3). About 637 lines of worktree code sit in files owned by fleet and agent run.
7. The commit count covers 41 gate-related files. Beyond the 21 dedicated gate files, 17 Rust behaviour files, 3 sidecar files and 25 TS `?raw` tests also contain at least one source-scan assertion.

**Other facts recorded by the groups**
- **Unmet requirements.** The limit gate (AGNT-05) and the planner declaring file-sets (PLAN-01) are still unmet; PLAN-01 is recorded as "never run live". `limit_gate.rs` says no hard limit has been observed live.
- **Never called.** Two commands, `task_file_set_get` and `task_file_set_set`, are registered but have no caller.
- **Scheduler.** It has four trigger kinds, but only "user action" is ever created. It has no cron expressions.
- **UAT on real Claude.** By default, `run-all.sh` runs uat-03, 05, 06, 07 and 08 against the real `claude` binary and real credentials.
- **Unused release scripts.** No workflow or script runs `apply-tag-version.test.mjs`, and nothing references `verify-bundle-assets.sh` or `ax-drive.js`.
- **Deferred review.** `DEFERRED-REVIEW.md` holds 68 items: 23 tagged phase 8.1, 9 tagged phase 10 and 8 for review & merge.

**Caveats.**
- **Plan counts:** they come from the `files_modified` frontmatter. Plans that lack it (quick tasks) are listed by name in the group files.
- **Commit counts:** they include broad sweep commits such as "chore: commit remaining working state".
- **Records:** the record-type columns for React rows come from regex hit counts, so they are approximate.
- **Inline tests:** group B counted inline Rust test modules up to their closing brace, while the other groups counted to the end of the file. For `sidecar.rs` the two methods give 694 and 1,115 test lines.
