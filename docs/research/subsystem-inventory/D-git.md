# Group D — git, forge & review: subsystem inventory (facts only)

Repo: `/Users/cymarechal/cymarechal/HighKnow-harness-worktrees/mvp`, branch `mvp` at `812533ef`. Measured 2026-10-16. Read-only.

## 1. Summary table

| Subsystem | Source lines | Test lines (+UAT) | Depends on it | Record types assumed | Planning (phases/plans) | Commits (fix) |
|---|---|---|---|---|---|---|
| 1. Worktree lifecycle (incl. git.rs, branch.rs, proc.rs, git_retry.rs) | 3,533 (core 2,250 · tauri 101 · desktop 1,182). Not counted, shared with other owners: 637 | 4,037 (core 2,968 + 25 inline · desktop 1,044) + UAT: uat-05 (219, shared with shim) and 1 of 4 sections of uat-12 (313) | **git.rs** (the only `Command::new("git")`): context_packet, dispatch_exec, domain/{agent_run,epic,file_set,worktree}, drift, epic_context_packet, forge/mod, git_facts, git_hooks, git_identity, merge, query/change_flags, review; tauri commands/{agent_run,file_set,review}, scheduler. **domain::worktree**: context_packet, dispatch_exec, domain/{agent_run,file_set}, drift, git_facts, merge, query/{change_flags,fleet}; tauri commands/{agent_run,fleet,worktree_open}, main.rs. **branch.rs**: context_packet, domain/{epic,worktree}, forge/request_body, git_facts, git_identity. **proc.rs**: git.rs, forge/github, forge/gitlab. **git_retry**: git.rs, domain/agent_run, shim/src/main.rs, tauri sidecar.rs. UI: ItemDetailPanel → WorktreeSummary; App.tsx, ProjectRail, uiStore → WorktreeInventory | worktree (`worktrees` table, 24 refs), task, project, agent_run, issue (1), events (1), settings (open-command template) | 22 plans, 3 gap-closure: p02: 2 · p03: 7 (2 gap) · p04: 1 · p07: 3 (1 gap) · p08: 2 · p08.1: 1 · p10: 3 · p11: 1 · p13: 2. Requirements WORK-01..08, LINK-01, LINK-11, PROC-02. D-REV-54, 55, 68. Todos pending: 2 (proc timeout) | 50 (10) |
| 2. Git truth / git facts (incl. change flags, outside-commit detection) | 861 (core 514 · tauri 159 · desktop 188) | 1,597 (core 1,113 · desktop 484) + UAT: 0 | git_facts: dispatch_exec (`observe`), status_derivation (`git_facts_for_task`), tauri scheduler.rs (`record_outside_commits`, 2 call sites), tauri commands/git_truth. change_flags: tauri commands/change_flags → desktop BoardView/BoardRow/useBoardQuery. UI: ItemDetailPanel → GitFactsSection | task, worktree, agent_run, epic, project, events (writes `events` rows only) | 5 plans, 1 gap-closure: p07: 3 (07-01, 07-06, 07-11 gap) · p08.1: 2. Requirements LINK-02, LINK-09, LINK-10. D-REV-09 and D-REV-28 cover it in part | 17 (3) |
| 3. Drift detection (drift.rs + cycle scope drift) | 510 (core drift.rs 446 · query/cycle_scope.rs 64) | 1,405 (core only) + UAT: 0 | drift: context_packet (`DriftWarning`), domain/agent_run, tauri commands/agent_run (`detect_drift`, line 479), tauri sidecar.rs (`scope_backstop_*`, lines 1108–1117). cycle_scope: tauri commands/cycle.rs (lines 56–61) → desktop CycleRegion.tsx | drift.rs: session_summaries (decisions JSON), events, plus in-memory inputs (file paths, refs, decision ids). cycle_scope.rs: events, cycle, epic | 6 plans, 1 gap-closure: p04: 2 (04-11, 04-12) · p09: 1 · p13: 2 (13-12 gap) · p14: 1 (14-06). Requirements CTX-06, RECD-10. D-REV: 0 | 11 (1) |
| 4. Forge integration (GitHub/GitLab, transitions, request body, epic request) | 3,202 (core 1,900 · tauri 558 · desktop 744) | 3,725 (core 2,677 incl. tests/bin/forge_probe.rs 120 · desktop 1,048) + UAT: 0 | status_derivation (`forge::transitions`, `ForgeState`, `query::forge::latest_forge_baseline`), tauri scheduler.rs (forge tick: `detect_forge_from_origin`, `request_for_branch_at`, `apply_forge_observation`), tauri commands/forge. UI: ItemDetailPanel → ForgeSection; ReviewSurface → EpicRequestSheet; BoardRow (CI pill from `board_forge_flags`) | project (`forge` column), task, epic (integration_branch), acceptance_criterion, criterion_anchor, worktree, events (17 refs; forge observations are stored as events) | 23 plans, 9 gap-closure: p07: 7 (3 gap) · p08: 7 (5 gap) · p08.1: 3 · p11: 1 · p13: 3 (1 gap) · p15: 1 · quick 261005-mn5 (forge-tick lost-update race). Requirements LINK-05..08, REVW-05. D-REV-03. Todos: 2 pending, 1 done | 47 (6) |
| 5. Review & merge | 3,412 (core 941 · tauri 587 · desktop 1,884) | 5,211 (core 1,400 · tauri inline 60 · desktop 3,751, of which browser tests 1,573) + UAT: 0 dedicated (uat-13 section 3/4 runs the auto-merge, owned by dispatch) | review: context_packet, query/change_flags, tauri commands/review. merge: dispatch.rs, dispatch_exec.rs, domain/task.rs, forge/request_body.rs, query/fleet.rs, review.rs, tauri commands/review. UI: App.tsx, BoardView, CommandPalette, SessionSurface, ProjectRail, uiStore → ReviewSurface | task, epic (integration_branch), project, acceptance_criterion, criterion_anchor, worktree, events | 23 plans, 8 gap-closure: p08: 14 (7 gap) · p08.1: 2 · p11: 5 · p13: 2 (1 gap). Requirements REVW-01..04. D-REV-02, 04, 05, 06, 07, 08, 15, 19 (8), plus D-REV-58 shared with dispatch | 58 (13) |
| 6. Git identity & credentials | 540 (core 449 · tauri 91) | 1,027 (core 828 · sidecar 199) + UAT: 0 | git_identity: tauri commands/git_identity → desktop board/useBoardQuery.ts (command palette). credentials: tauri commands/settings.rs (`settings_set_credential_mode`), tauri sidecar.rs (`resolve_credential` at spawn) | git_identity: project, task, worktree, epic. credentials: settings (9 refs), project, events | 5 plans, 1 gap-closure: p02: 1 (02-09) · p07: 1 (07-05) · p11: 1 (11-19) · p13: 2 (13-13 gap). Requirements LINK-04, AGNT-03, AGNT-04. Todos: 1 completed (SQL table name built with `format!`) | 11 (1) |
| 7. Git hooks (see the note in §2.7; not counted above) | 574 | 1,472 | domain/project.rs (install at register and relocate), git_identity.rs (trailer key constants) | none (no SQL) | 5 plans: p07: 1 (07-02) · p12: 3 (1 gap) · p13: 1 | 10 (1) |

Rows 1–6 total 12,058 source lines and 17,012 test lines. Row 7 is reported separately.

## 2. Per subsystem: files and derivation

Common derivation:
- Source and test lines are `wc -l`.
- For a Rust file, an inline module counts as test from its first top-level `#[cfg(test)]` line to EOF. Only `git.rs` (line 651, 25 lines) and `commands/review.rs` (line 588, 60 lines) in this group have one.
- Paths are relative to `packages/`.
- Plans were attributed by matching each `*PLAN.md`'s `files_modified` frontmatter against the subsystem's file list (294 PLAN.md files scanned). A plan that touches two subsystems is counted in both. "gap" means the plan's frontmatter has `gap_closure: true`.
- Commits are `git log --oneline -- <all files listed, source + test> | wc -l`. Fix count is `git log --format=%s -- <files> | grep -ciE '^fix'`.
- Debug files: none of the 5 in `.planning/debug/` is about these subsystems. `uat-03-closes-while-blocked.md` and `uat-06b-bash-gate-regression.md` mention "worktree" or "merge" in passing, but both concern the destructive gate.
- v0.1.0-MILESTONE-AUDIT.md lines matching each keyword set: worktree 8; git facts/LINK-02/09/10 1; drift/CTX-06 0; forge/LINK-05..08/REVW-05 2; review/merge/REVW-01..04 8; credential/LINK-04/AGNT-03/04 2; hooks/LINK-03 0.

### 2.1 Worktree lifecycle — 3,533 source / 4,037 test

**Core source (2,250 lines)**

| File | Lines |
|---|---|
| core/src/domain/worktree.rs | 1,030 |
| core/src/git.rs | 650 (+25 inline test) |
| core/src/branch.rs | 120 |
| core/src/proc.rs | 170 |
| core/src/git_retry.rs | 280 |

`git_retry.rs` is git index-lock backoff (WORK-04). It is called by `git.rs` and by the PATH shim, `shim/src/main.rs`.

**Tauri source (101 lines)**
- commands/worktree_open.rs: 101

**Desktop source (1,182 lines)**

| File | Lines |
|---|---|
| desktop/src/fleet/WorktreeInventory.tsx | 450 |
| desktop/src/item-detail/WorktreeSummary.tsx | 414 |
| desktop/src/item-detail/WorktreeRemovalDialog.tsx | 318 |

**Shared, not counted (637 lines, attributed to other owners)**

| File | Lines | What it holds |
|---|---|---|
| core/src/query/fleet.rs | 294–529 (236) | worktree inventory/measure/size queries |
| desktop/src-tauri/src/commands/fleet.rs | 239–463 (225) | `worktree_inventory`, `worktree_measure`, `worktree_reclaim` |
| desktop/src-tauri/src/commands/agent_run.rs | 2194–2369 (176) | `worktree_summary`, `worktree_remove_check`, `worktree_remove`, `worktree_recreate`, `worktree_forget_record` |

**Core tests (2,968 lines)**

| File | Lines |
|---|---|
| core/tests/worktree_inventory.rs | 260 |
| core/tests/worktree_lifecycle.rs | 137 |
| core/tests/worktree_reclaim.rs | 271 |
| core/tests/worktree_removal.rs | 315 |
| core/tests/worktree_size.rs | 174 |
| core/tests/reconcile_worktrees.rs | 546 |
| core/tests/open_worktree.rs | 170 |
| core/tests/branch_naming.rs | 175 |
| core/tests/git_retry.rs | 631 |
| core/tests/proc_timeout_boundary.rs | 91 |
| core/tests/subprocess_timeout.rs | 198 |

**Desktop tests (1,044 lines)**

| File | Lines |
|---|---|
| fleet/__tests__/worktree-inventory.test.tsx | 215 |
| fleet/__tests__/worktree-reclaim.test.tsx | 215 |
| item-detail/__tests__/worktree-removal.test.tsx | 190 |
| item-detail/__tests__/worktree-summary.test.tsx | 424 |

**Related tests not counted (other owners)**

| File | Lines | Why not counted |
|---|---|---|
| core/tests/supervisor_cwd.rs | 254 | source gate on `git.rs` |
| core/tests/lock_contention.rs | 466 | shim + git_retry |
| core/tests/bin/commit_stress_harness.rs | 128 | shim + git_retry |
| core/tests/diff_so_far.rs | 410 | context packet |

**UAT**
- scripts/uat/uat-05-concurrent-commits.mjs (219): WORK-04/05 lock contention through a live session.
- scripts/uat/uat-12-fleet-live-reads.mjs (313): only section D-REV-55 (`worktree_reclaim`) of its 4 sections.

**Plans (22)**
- 02-01, 02-08
- 03-01, 03-03, 03-04, 03-08, 03-09, 03-18 (gap), 03-25 (gap)
- 04-07
- 07-01, 07-04, 07-10 (gap)
- 08-01, 08-03
- 08.1-15
- 10-02, 10-08, 10-09
- 11-15
- 13-01, 13-07

Several of these touch `git.rs` only to add a read helper (07-01, 08-01, 08-03, 04-07).

**Other planning records**
- Pending todos: `2026-10-05-timeout-boundary-race-misreports-a-child-that-just-finished.md` and `2026-10-05-timeout-guard-leaks-reader-threads-under-sustained-outage.md`. `tests/proc_timeout_boundary.rs` exists and addresses the first one.
- D-REV-54 and D-REV-55 (owner-question, phase 10).
- D-REV-68 (open): a data race in `worktree_lifecycle.rs` on a process-global env var.

**Git history:** 50 commits, 10 of them fixes. First commit 2026-09-10, last 2026-10-16. Without git_retry.rs and its test, the counts are 3,253 source and 3,406 test lines.

### 2.2 Git truth / git facts — 861 source / 1,597 test

**Source**

| File | Lines |
|---|---|
| core/src/git_facts.rs | 404 |
| core/src/query/change_flags.rs | 110 |
| desktop/src-tauri/src/commands/git_truth.rs | 92 |
| desktop/src-tauri/src/commands/change_flags.rs | 67 |
| desktop/src/item-detail/GitFactsSection.tsx | 188 |

`GitFactsSection.tsx` imports `porcelainStatusWord` from `WorktreeRemovalDialog.tsx`.

**Tests**

| File | Lines |
|---|---|
| core/tests/git_facts.rs | 271 |
| core/tests/change_flags.rs | 305 |
| core/tests/outside_commit_detection.rs | 537 |
| desktop/src/item-detail/__tests__/git-facts-section.test.tsx | 273 |
| desktop/src/board/__tests__/change-cue.test.tsx | 211 |

**Shared, not counted:** tauri scheduler.rs hot-tier call sites (lines 37, 181, 265).

**Plans (5):** 07-01, 07-06, 07-11 (gap), 08.1-01, 08.1-15.

**Git history:** 17 commits, 3 fixes. First commit 2026-10-02, last 2026-10-09.

### 2.3 Drift detection — 510 source / 1,405 test

**Source**
- core/src/drift.rs: 446
- core/src/query/cycle_scope.rs: 64, the `cycle_scope_drift` function, derived from the `events` log (RECD-10).

These are separate mechanisms that share the word "drift".

**Tests**
- core/tests/drift.rs: 1,203
- core/tests/cycle_scope_drift.rs: 202

**Shared, not counted**
- `DriftWarningDto` and the `detect_drift` call site in tauri commands/agent_run.rs (lines 202–214 and 370–479).
- The scope backstop call in tauri sidecar.rs (lines 1108–1117).
- The cycle region DTO in tauri commands/cycle.rs (lines 56–61).

**Plans (6):** 04-11, 04-12, 09-02, 13-02, 13-12 (gap), 14-06.

**Git history:** 11 commits, 1 fix. First commit 2026-09-23, last 2026-10-15.

### 2.4 Forge integration — 3,202 source / 3,725 test

**Core source (1,900 lines)**

| File | Lines |
|---|---|
| core/src/forge/mod.rs | 478 |
| core/src/forge/github.rs | 232 |
| core/src/forge/gitlab.rs | 268 |
| core/src/forge/transitions.rs | 297 |
| core/src/forge/request_body.rs | 431 |
| core/src/query/forge.rs | 194 |

**Tauri source:** commands/forge.rs, 558.

**Desktop source (744 lines)**
- item-detail/ForgeSection.tsx: 359
- review/EpicRequestSheet.tsx: 385

**Shared, not counted**
- tauri scheduler.rs forge tick (lines ~36, 377–508).
- `domain::settings::{project_forge,set_project_forge}` (settings owner).
- Migration `0017_forge_setting.sql`.

**Core tests (2,677 lines)**

| File | Lines |
|---|---|
| forge_board_flags.rs | 174 |
| forge_degrade.rs | 217 |
| forge_epic_request_ordering.rs | 158 |
| forge_live_chain.rs | 911 |
| forge_live_github.rs | 171 |
| forge_normalize.rs | 300 |
| forge_request_body.rs | 279 |
| bin/forge_probe.rs | 120 |
| epic_request_draft.rs | 347 |

**Desktop tests (1,048 lines)**
- item-detail/__tests__/forge-section.test.tsx: 431
- review/__tests__/epic-request.test.tsx: 522
- board/__tests__/ci-flag.test.tsx: 95

**Plans (23)**
- 07-03, 07-07, 07-08, 07-09, 07-10 (gap), 07-11 (gap), 07-12 (gap)
- 08-05, 08-08, 08-09 (gap), 08-11 (gap), 08-12 (gap), 08-14 (gap), 08-15 (gap)
- 08.1-15, 08.1-16, 08.1-21
- 11-12
- 13-07, 13-10, 13-16 (gap)
- 15-02
- quick 261005-mn5

**Todos**
- Pending: `forge-resolution-failures-are-not-cached-so-they-retry-per-worktree` and `forge-urls-reach-an-anchor-href-without-scheme-validation`.
- Done: `live-chain-tests-inconsistently-assert-the-fake-was-reached`.

**Git history:** 47 commits, 6 fixes. First commit 2026-10-02, last 2026-10-16.

### 2.5 Review & merge — 3,412 source / 5,211 test

**Core source (941 lines)**
- core/src/review.rs: 471
- core/src/merge.rs: 470

**Tauri source:** commands/review.rs, 587 (+60 inline test).

**Desktop source (1,884 lines), all under desktop/src/review/**

| File | Lines |
|---|---|
| CriteriaRail.tsx | 110 |
| DecisionFoot.tsx | 109 |
| FileDiff.tsx | 211 |
| highlight.ts | 87 |
| MergeConfirmSheet.tsx | 391 |
| ReviewSurface.tsx | 454 |
| selection.ts | 50 |
| useReviewQuery.ts | 192 |
| review.css | 280 |

`EpicRequestSheet.tsx` is in the same folder but is counted under Forge.

**Shared, not counted**
- `domain::task::{request_changes, changes_request_state}` (board records owner).
- `git::merge_tree_check` and `git::ReviewFile` (inside git.rs, counted under Worktree).

**Core tests (1,400 lines)**
- review_changes_request.rs: 358
- review_diff.rs: 317
- review_merge.rs: 725

**Desktop tests (3,751 lines)**

| File | Lines |
|---|---|
| review/__tests__/criteria-rail.test.tsx | 460 |
| review/__tests__/finish.test.tsx | 195 |
| review/__tests__/keyboard-activation.test.tsx | 266 |
| review/__tests__/merge-sheet.test.tsx | 456 |
| review/__tests__/request-changes.test.tsx | 330 |
| review/__tests__/review-surface.test.tsx | 232 |
| review/__tests__/highlight.test.ts | 32 |
| review/__tests__/browser/* (7 files) | 1,573 |
| adapters/__tests__/changes-request-adapter.test.ts | 40 |
| board/__tests__/review-doors.test.tsx | 167 |

**Related test not counted:** core/tests/dispatch_auto_merge.rs (1,651), owned by dispatch.

**Plans (23)**
- 08-01, 08-02, 08-03, 08-04, 08-06, 08-07, 08-08, 08-09 (gap), 08-10 (gap), 08-11 (gap), 08-12 (gap), 08-13 (gap), 08-14 (gap), 08-15 (gap)
- 08.1-16, 08.1-21
- 11-10, 11-12, 11-13, 11-18, 11-22
- 13-10, 13-15 (gap)

Phase 08 has 15 PLAN.md files in total, and 14 of them match.

**Deferred-review items:** D-REV-02, 04, 05, 06, 07, 08, 15, 19.

**Git history:** 58 commits, 13 fixes. First commit 2026-10-06, last 2026-10-15.

### 2.6 Git identity & credentials — 540 source / 1,027 test

**Source**

| File | Lines |
|---|---|
| core/src/git_identity.rs | 251 |
| core/src/credentials.rs | 198 |
| desktop/src-tauri/src/commands/git_identity.rs | 91 |

**Shared, not counted**
- tauri sidecar.rs credential wrapper (lines 66–78).
- tauri commands/settings.rs `settings_set_credential_mode` (line 155).
- Migration `0005_credentials.sql`.

There is no desktop component dedicated to either module. Identifier resolution goes through `board/useBoardQuery.ts` and the command palette.

**Tests**

| File | Lines |
|---|---|
| core/tests/git_identity.rs | 371 |
| core/tests/credentials.rs | 457 |
| sidecar/test/credentials.test.mjs | 199 |

**Plans (5):** 02-09, 07-05, 11-19, 13-05, 13-13 (gap).

**Todos:** 1 completed, `git-identity-builds-a-table-name-into-sql-with-format`.

**Git history:** 11 commits, 1 fix. First commit 2026-09-11, last 2026-10-15.

### 2.7 Git hooks — NOTE: partly belongs to the destructive gate

`core/src/git_hooks.rs` (574 lines, no inline tests) holds two hooks in one file:

- **The `pre-push` hook is "Layer 3" of the destructive gate.** `docs/destructive-gate-trust-boundary.md` §"Layer 3 — git's own pre-push hook" names `packages/core/src/git_hooks.rs` as the implementing file. The file also has `interception_layers_for(DestructiveCategory)` at line 551. Per the brief, the pre-push part is left to the safety-gates inventory.
- **The `commit-msg` hook** stamps the task/run trailers (LINK-03, phase 7 plan 07-02). It is not part of the destructive gate. Its only consumers are `domain/project.rs` (install, lines 250–258) and `git_identity.rs` (`TRAILER_TASK_KEY`/`TRAILER_RUN_KEY`).

Both hooks share helpers in the same file: `current_hooks_path`, `is_flywheel_hooks_dir`, `default_hooks_entry` and `verify_install`. The uninstall of each checks for the other. So the file cannot be split by line range without judgement, and no per-hook line count is given.

**Whole-file facts**

| Item | Value |
|---|---|
| Source | 574 |
| Tests | core/tests/git_hooks_pre_push.rs 1,080 (destructive gate) · core/tests/commit_msg_hook.rs 392 (trailer) |
| Plans | 07-02 (commit-msg) · 12-02, 12-04, 12-06 (gap) (pre-push) · 13-01 |
| Git history | 10 commits, 1 fix |
