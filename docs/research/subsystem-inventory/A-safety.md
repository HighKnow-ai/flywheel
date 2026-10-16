# Group A: safety and guards (facts only)

Repo: `/Users/cymarechal/cymarechal/HighKnow-harness-worktrees/mvp`, branch `mvp`, HEAD `812533ef` (1968 commits reachable). Counted 2026-10-16.

Layer names come from `docs/destructive-gate-trust-boundary.md` (976 lines), which names four layers, each with one "Implementing file":
Layer 0 = `packages/core/src/shim.rs`, Layer 1 = `packages/sidecar/src/pretooluse-hook.ts`, Layer 2 = `packages/shim/src/main.rs`, Layer 3 = `packages/core/src/git_hooks.rs`. The shared classifier `packages/core/src/destructive.rs` is not one of the four layers. Layers 0, 1 and 2 use it, and Layer 3 imports its `DestructiveCategory`. It has its own row below.

## Summary table

| Subsystem | Source lines | Test lines (+UAT) | Depends on it | Record types assumed | Planning (phases/plans) | Commits (fix) |
|---|---|---|---|---|---|---|
| 1a. Gate Layer 0: supervisor install (`shim.rs`) | 376 | 0 dedicated (+0 UAT) | tauri `sidecar.rs` (`merge_shim_env_for_run` → `shim_env_for_run`), `commands/agent_run.rs` (test helper `resolve_shim_binary`), core `git_hooks.rs` (`resolve_real_git`, `resolve_shim_binary`); exercised by core tests `destructive_classifier`, `git_hooks_pre_push`, `git_retry`, `lock_contention`, `scope_marker_contract`, `scope_widen`, test bins `uat_fanout_ops`, `uat_session_env` | agent_run (per-run dir `<runtime>/shim/<run_id>/`); no SQL | phase 3: 03-04, 03-25 (gap) = 2 plans | 4 (0) |
| 1b. Gate Layer 1: PreToolUse hook (`pretooluse-hook.ts` + `sessionstart-hook.ts`) | 404 | 3288 (+330 UAT) | sidecar `claude-code-adapter.ts` (`writeHookSettings` registers both hooks, sets `FLYWHEEL_SHIM_BIN`); tauri `sidecar.rs` (spawn-time comment and contract) | none (env + `CLAUDE_CONFIG_DIR` shell snapshots); no SQL | phase 3: 03-07, 03-19, 03-24, 03-26, 03-28, 03-29, 03-30, 03-31, 03-32, 03-34, 03-36, 03-38; phase 12: 12-03, 12-05; quick 260920-duy. 15 plans, 11 gap-closure | 43 (6) |
| 1c. Gate Layer 2: shim binary (`packages/shim`) | 1696 (+24 Cargo.toml) | 767 (+0 UAT) | Layer 1 (`--classify-invocation`), scope hook (`--scope-check`), Layer 3 pre-push script (`shim_bin`), PATH-shadowed `git`/`rm` in every agent session; staged as `externalBin` `flywheel-shim` by `packages/sidecar/scripts/stage-runtime.mjs` and `tauri.conf.json` | agent_run (run id / runtime dir), permission_requests (through the permission socket, written by core), scope marker file per run; no SQL | phase 3: 03-04, 03-07, 03-13, 03-19, 03-24, 03-28, 03-30, 03-32, 03-33, 03-35, 03-37; phase 9: 09-01; phase 12: 12-01, 12-04; quick 260920-duy. 15 plans, 8 gap-closure | 26 (4) |
| 1d. Gate Layer 3: git pre-push hook (`git_hooks.rs`) | 574 | 1472 (+0 UAT) | core `domain/project.rs` (`install_pre_push_hook`, `install_commit_msg_hook` on project register), core `git_identity.rs` (`TRAILER_RUN_KEY`, `TRAILER_TASK_KEY`) | project (hooks dir keyed by project_id), worktree; commit-msg trailers name task + agent_run; no SQL | phase 7: 07-02; phase 12: 12-02, 12-04, 12-06 (gap); phase 13: 13-01. 5 plans, 1 gap-closure | 10 (1) |
| 1e. Gate shared classifier (`destructive.rs`, migration 0007, gate-wide tests, trust-boundary doc) | 333 (+23 SQL, +976 doc) | 1310 (+660 UAT) | shim `main.rs` (`classify`, `DestructiveCategory`, `Verdict`), core `git_hooks.rs`, core `domain/permission_request.rs`, tauri `commands/agent_run.rs` (`DestructiveCategory::from_str_name`), test bin `commit_stress_harness.rs` | projects (`default_branch` input), permission_requests (`destructive_category` column added by 0007) | phase 3: 03-07, 03-14, 03-27, 03-28, 03-29, 03-30, 03-32, 03-33, 03-35, 03-37; phase 12: 12-01, 12-02, 12-05, 12-06. 14 plans, 10 gap-closure | 33 (3) |
| **1. Destructive gate TOTAL (1a–1e)** | **3383** (+24 toml, +23 SQL, +976 doc) | **6837 (+990 UAT)** | see rows 1a–1e | projects, agent_runs, permission_requests, worktree, task (trailers) | **AGNT-07: 31 plans (23 gap-closure)**: phase 3: 24 plans (03-07, 03-12, 03-14, 03-16, 03-19…03-38); phase 12: 6 of 6 plans; quick: 1 (260920-duy). 3 debug files. | **95 (14)** |
| 2. Permission requests / rules | 3025 (1325 excl. `mcp-permission-server.ts`) (+118 SQL) | 1504 (+381 UAT) | tauri `commands/agent_run.rs` (all core permission fns), tauri `sidecar.rs` (`register_pending_permission_request`, `relay_permission_answer*`), sidecar `claude-code-adapter.ts` (imports `mcp-permission-server`), core test `start_pin_ordering.rs`; UI: `RunsSection.tsx`, `BlockedQueue.tsx`, `SessionSurface.tsx` import `PermissionRequestCard`; `SettingsSurface.tsx` imports `PermissionRulesTable`; `useBoardQuery.ts` → `pendingPermissionRequests` | permission_requests, permission_rules, agent_runs, events, tasks; task_id / epic_id / project_id columns (0014 adds authoring linkage) | AGNT-06: 4 plans (02-03, 02-05, 02-06, 02-10), 0 gap. Plans touching its files: 25 (7 gap), of which 12 come in through the shared MCP server or card (phases 4, 5, 6, 8.1, 9, 10, 13, 15). 1 debug file. | 44 (7) |
| 3. File-set scope fence | 1624 (+345 inline test) | 4017 + 345 inline = 4362 (+626 UAT) | core `dispatch.rs`, `dispatch_exec.rs`, `domain/dispatch_plan.rs`, `drift.rs`, `context_packet.rs`, `git_facts.rs`, `runtime_protocol.rs` (`ScopeMarker` uses `file_set` parsing); shim `main.rs` (`file_set::covers` in `--scope-check`); tauri `commands/agent_run.rs` (`arm_scope_marker_with`), `commands/dispatch.rs`, `sidecar.rs` (`record_scope_denied`, `record_backstop_denials`); sidecar `claude-code-adapter.ts` (wires `scope-hook`); UI `FeedRow.tsx` (`widenFileSet`), `useBoardQuery.ts` (`boardScopeFlags`), `dispatch/queries.ts` (`taskFileSetProvenance`, `repoTrackedPaths`) | task_file_set_entries, tasks, agent_runs, events, projects, dispatch_plans, dispatch_plan_tasks, dispatch_edges, actors, triggers | PLAN-04: 1 (09-01); PLAN-05: 2 (09-02, 09-06). Plans touching its files: 11 (1 gap): phase 9: 09-01, 09-02, 09-03, 09-06, 09-11 (gap); phase 11: 11-09, 11-10; phase 13: 13-10; phase 15: 15-02, 15-04, 15-05. 0 debug files. | 30 (4) |
| 4. Limit gate (account / rate limit) | 510 | 1060 (+594 UAT) | core `dispatch.rs` (`read_gate`, `may_spawn`, `may_advance`), `dispatch_exec.rs` (`resume_if_due`, `clear_expired_warning`); tauri `commands/dispatch.rs` (`dispatch_gate_state`, `dispatch_gate_resume_now`), `sidecar.rs` (`apply_rate_limit_signal_for_run`, `read_gate`); UI `EpicDispatchControls.tsx` imports `DispatchGateLine`, `dispatch/queries.ts` → `dispatchGateState`; test bins `uat_fanout_ops`, test `dispatch_auto_merge.rs` | settings (one global row), events (`dispatch.gate_changed`), agent_runs, tasks | AGNT-05: 1 (09-05); DRFT-12: 2 (15-03, 15-04). Plans touching its files: 6, 0 gap (09-05, 09-09, 11-10, 11-14, 15-03, 15-04). AGNT-05 unchecked in v0.1.0-REQUIREMENTS; DRFT-12 unchecked in REQUIREMENTS. 0 debug files. | 14 (0) |
| 5. Git lock retry / spawn floor (`git_retry.rs`) | 280 | 1465 (+219 UAT) | core `git.rs` (`git_at` → `with_lock_retry`), `domain/agent_run.rs` (`exhaustion_event_payload`); shim `main.rs` (`with_lock_retry_notify`, `LockExhausted`); tauri `sidecar.rs` (`SpawnFloor`) | events (exhaustion event payload), agent_runs (per-run collision counter), worktree | WORK-04: 8 plans (5 gap); WORK-05: 7 (5 gap); union = 03-04, 03-08, 03-13, 03-14, 03-22, 03-31, 03-36, 03-38. Plans touching its files: 6 (1 gap): 03-04, 03-08, 03-13, 03-25 (gap), 09-07, 13-01. 0 debug files. | 17 (1) |

The PATH shim (subsystem 5 in the request) is covered by gate rows 1a and 1c, so it has no row of its own. Row 5 holds only `git_retry.rs`.

## How the numbers were derived (all subsystems)

- **Source lines** come from `wc -l` on non-test files. Of every attributed Rust source file, only `packages/desktop/src-tauri/src/commands/file_set.rs` has an inline `#[cfg(test)]`, at line 350. Its lines 350–694 (345) count as test and lines 1–349 as source. Migrations (`.sql`), `Cargo.toml` and the trust-boundary doc are shown in parentheses and are not added to Source.
- **Test lines** count dedicated test files plus test fixtures attributed to the subsystem. UAT means `scripts/uat/*.mjs` only. The shared UAT harness `scripts/uat/lib/*` is not attributed to any subsystem.
- **Plans** were found by a script that parses the `files_modified:` frontmatter of all 294 `*PLAN.md` under `.planning/`. A plan is counted for a subsystem if it lists any of that subsystem's files, source or test. "gap" means `gap_closure: true` in the frontmatter. One plan can count for several subsystems or layers. Requirement-ID counts come from the `requirements:` frontmatter line.
- **Commits** were counted with `git log --format=%s -- <all attributed files incl. tests/UAT/doc/migration>`. Fix commits are subjects matching `^fix` (case-insensitive). The gate total is one `git log` over the union of rows 1a–1e, not the sum of the rows.
- **Depends on it** was found by grepping `crate::<mod>`, `flywheel_core::<mod>`, TS `import`, and adapter `invokeCommand("<cmd>")` callers outside `__tests__`.

## 1. Destructive gate: files

**1a Layer 0** (source 376): `packages/core/src/shim.rs`.
**1b Layer 1** (source 404): `packages/sidecar/src/pretooluse-hook.ts` (343) and `packages/sidecar/src/sessionstart-hook.ts` (61). The second file was added in plan 12-03 and puts the shim directory on PATH via `CLAUDE_ENV_FILE`. Tests: `packages/sidecar/test/destructive-gate.test.mjs` (3135) and `packages/sidecar/test/sessionstart-hook.test.mjs` (153). UAT: `scripts/uat/uat-11-env-file-ordering.mjs` (330).
**1c Layer 2** (source 1696): `packages/shim/src/main.rs`, plus `packages/shim/Cargo.toml` (24). Tests: `packages/shim/tests/classify_invocation.rs` (663) and `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt` (104).
**1d Layer 3** (source 574): `packages/core/src/git_hooks.rs`. Tests: `packages/core/tests/git_hooks_pre_push.rs` (1080) and `packages/core/tests/commit_msg_hook.rs` (392).
**1e Classifier** (source 333): `packages/core/src/destructive.rs`. Migration: `packages/core/src/db/migrations/0007_destructive_gate.sql` (23). Doc: `docs/destructive-gate-trust-boundary.md` (976). Tests: `packages/core/tests/destructive_classifier.rs` (926), `destructive_gate_layer_coverage.rs` (180) and `destructive_gate_no_new_launcher_tokens.rs` (204). UAT: `scripts/uat/uat-03-destructive-gate.mjs` (317) and `uat-07-launcher-shape-gate.mjs` (343).

Notes:
- **`packages/shim/src/main.rs` serves three subsystems.** It is attributed to Layer 2, but it also holds two other jobs:
  - the scope fence's `--scope-check` mode: `resolve_scope_target` starts at l.424 and `run_scope_check` runs from l.471 to about l.531;
  - the git lock-retry path: `run_git` starts at l.532 and calls `git_retry::with_lock_retry_notify`, and `write_contention_record` starts at l.655.

  None of these lines were moved out of 1c.
- **`git_hooks.rs` also holds the LINK-03 commit-msg trailer hook** (phase 7, plan 07-02). It is attributed to Layer 3, and so is its test `commit_msg_hook.rs` (392 lines).
- **The gate and permission requests are coupled.** A destructive request is stored as a `permission_requests` row with `destructive_category` (migration 0007). The shim sends requests over the permission socket owned by `mcp-permission-server.ts`. `PermissionRequestCard.tsx` mentions "destructive" 23 times. All of those files are counted under subsystem 2, not here.
- **Other planning artifacts:**
  - `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` is 146 lines.
  - Phase 12's `.md` files total 4301 lines.
  - Phase 3 has 38 plans in all, 24 of which carry AGNT-07. Phase 12 has 6 plans, all AGNT-07.
  - Debug files: `.planning/debug/uat-03-closes-while-blocked.md` (status: awaiting_human_verify) and `uat-06b-bash-gate-regression.md` (status: reverted_routed_to_planning).
  - Quick task `260920-duy` (fix CR-01, `shimWillIntercept`).
  - `DEFERRED-REVIEW.md` mentions AGNT-07 5 times. `v0.1.0-MILESTONE-AUDIT.md` mentions it 0 times.
  - AGNT-07 is checked in `v0.1.0-REQUIREMENTS.md`.
- The trust-boundary doc records review rounds five through ten, each with its own section, plus a section titled "## The rule for round six".

## 2. Permission requests / rules: files

Source (3025):
- `packages/core/src/domain/permission_request.rs` (388), `domain/permission_rule.rs` (199), `query/permissions.rs` (133)
- `packages/sidecar/src/mcp-permission-server.ts` (1700)
- `packages/desktop/src/session/PermissionRequestCard.tsx` (426), `packages/desktop/src/settings/PermissionRulesTable.tsx` (179)

Migrations: `0004_permission_gate.sql` (63) and `0014_permission_requests_authoring.sql` (55).

Tests (1504): `packages/core/tests/permission_gate.rs` (395), `packages/sidecar/test/permission.test.mjs` (270), `socket-permissions.test.mjs` (82), `packages/desktop/src/session/__tests__/permission-card.test.tsx` (757). UAT: `scripts/uat/uat-06-permission-block-lifecycle.mjs` (381).

Notes:
- **`mcp-permission-server.ts` is shared.** It exports 14 tool names, and only one, `approve_action`, is the permission prompt. The other 13 are the authoring and proposal write surface: `report_summary`, `propose_task`, `propose_epic`, `propose_criterion`, `propose_assumption`, `amend_proposal`, `delete_proposal`, `board_search`, `epic_get`, `task_list`, `proposal_list`, `propose_item`, `submit_plan`. It also relays the shim's lock-retry notices. Because of this, source is reported with and without the file (3025 / 1325). Most of the 25 plans that touch this subsystem's files arrive through this shared file.
- **Tauri commands live in `commands/agent_run.rs`**, a shared file not attributed here: `agent_run_answer_permission`, `permission_rules_list`, `permission_rule_revoke`, `agent_run_pending_permissions`, plus `process_inbound_permission_request` / `handle_inbound_permission_request`.
- **Relay functions live in tauri `sidecar.rs`**, also not attributed here.
- **Planning:** debug file `.planning/debug/uat-08-live-run-starves-on-permission-requests.md` (root-cause-found). AGNT-06 has 0 mentions in the audit and 0 in DEFERRED-REVIEW, and is checked in v0.1.0 requirements.

## 3. File-set scope fence: files

Source (1624):
- `packages/core/src/file_set.rs` (240), `domain/file_set.rs` (649), `query/scope.rs` (44), `query/file_set_provenance.rs` (102)
- `packages/sidecar/src/scope-hook.ts` (240)
- `packages/desktop/src-tauri/src/commands/file_set.rs` (349 source + 345 inline test)

Tests (4017):
- core: `file_set_overlap.rs` (454), `file_set_provenance.rs` (226), `file_set_undeclared.rs` (264), `scope_events.rs` (352), `scope_marker_contract.rs` (702), `scope_widen.rs` (722)
- sidecar: `scope-hook.test.mjs` (457), `scope-hook-live.test.mjs` (327), `scope-gate-fail-closed.test.mjs` (158)
- desktop: `board/__tests__/scope-badge.test.tsx` (157), `dispatch/__tests__/file-set-chips.test.tsx` (198)

UAT: `scripts/uat/uat-14-planner-file-set.mjs` (626).

Notes:
- **Two registered commands have no UI caller.** `commands/file_set.rs` registers 6 tauri commands. Two of them, `task_file_set_get` and `task_file_set_set`, appear in `main.rs` registration but are not invoked anywhere in `packages/desktop/src`, `scripts` or `packages/sidecar`.
- **Excluded files:**
  - The `task_file_set_entries` table is created in `0019_fan_out.sql`, which is shared with dispatch, so it is not counted.
  - `query/cycle_scope.rs` belongs to the Cycles subsystem. It handles epic scope drift, not the file-set fence.
  - The scope marker structs (`ScopeMarker`, `SCOPE_MARKER_VERSION`) live in the shared `runtime_protocol.rs`, which is not counted.
- **Requirement status:**
  - PLAN-04 and PLAN-05 are checked in v0.1.0.
  - PLAN-01 (the planner declares file-sets) is unchecked. It is carried as DRFT-01, which is unchecked.
  - Mentions: PLAN-04 has 1 in the audit and 6 in DEFERRED-REVIEW; PLAN-01 has 7 in the audit and 1 in DEFERRED-REVIEW.
- Plans 13-10 and 15-xx touch these files under the FNC-07 and DRFT-01 requirements.

## 4. Limit gate: files

Source (510): `packages/core/src/limit_gate.rs` (412) and `packages/desktop/src/dispatch/DispatchGateLine.tsx` (98).

Tests (1060): `packages/core/tests/dispatch_limit_floor.rs` (203), `dispatch_limit_gate.rs` (409), `packages/sidecar/test/rate-limit-wire.test.mjs` (190), fixture `packages/sidecar/test/fixtures/rate-limit-rejected.json` (134), `packages/desktop/src/dispatch/__tests__/limit-surface.test.tsx` (124). UAT: `scripts/uat/uat-15-account-limit.mjs` (594).

Notes:
- **The wire parse is not attributed here.** It lives in shared files: sidecar `claude-code-adapter.ts` (22 rate-limit mentions) and `adapter.ts` (12 mentions, the `rate_limit` event type), and tauri `sidecar.rs` (`process_inbound_rate_limit` / `handle_inbound_rate_limit`).
- **The rejected tier has never been seen live.** The `limit_gate.rs` header states: "No hard limit has ever been observed live in this project."
- **Requirement status:** AGNT-05 is unchecked, with 7 mentions in the audit and 2 in DEFERRED-REVIEW. It is carried as DRFT-12, also unchecked.
- `tests/proposal_limit*.rs` are excluded. They cover the authoring proposal cap, not this gate.

## 5. Git lock retry / spawn floor: files

Source (280): `packages/core/src/git_retry.rs`.

Tests (1465): `packages/core/tests/git_retry.rs` (631), `lock_contention.rs` (466), `spawn_stagger.rs` (240), test bin `packages/core/tests/bin/commit_stress_harness.rs` (128). UAT: `scripts/uat/uat-05-concurrent-commits.mjs` (219).

Notes:
- The shim-side retry call site is in `packages/shim/src/main.rs`, counted under 1c.
- WORK-04 and WORK-05 are checked in v0.1.0. They have 0 mentions in the audit and 0 in DEFERRED-REVIEW.
- Three plans (03-31, 03-36, 03-38) carry WORK-04/05 alongside AGNT-07 and PROC-03/04/05. They are cross-requirement phase-3 gap closures.

## Todos

No file in `.planning/todos/{pending,done,completed}` is named after any of these five subsystems. A keyword grep (`permission`, `lock`, `limit`, `scope`, `shim`) matches 14 todo files, but those hits are incidental mentions. They were not attributed.
