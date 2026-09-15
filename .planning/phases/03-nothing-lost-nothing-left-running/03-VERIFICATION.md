---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-15T09:36:05Z
status: gaps_found
score: 2/5 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-01-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-01-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-02-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-02-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-03-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-03-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-04-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-04-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-05-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-05-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-06-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-06-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-07-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-07-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-08-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-08-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-09-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-09-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-10-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-10-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-11-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-11-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-12-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-12-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-13-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-13-SUMMARY.md"
  - "Cargo.toml"
  - "DESIGN.md"
  - "packages/core/Cargo.toml"
  - "packages/core/src/db/migrations/0006_recovery_statuses.sql"
  - "packages/core/src/db/migrations/0007_destructive_gate.sql"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/destructive.rs"
  - "packages/core/src/domain/agent_run.rs"
  - "packages/core/src/domain/permission_request.rs"
  - "packages/core/src/domain/task.rs"
  - "packages/core/src/domain/worktree.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/git_retry.rs"
  - "packages/core/src/lib.rs"
  - "packages/core/src/query/agent_runs.rs"
  - "packages/core/src/query/mod.rs"
  - "packages/core/src/query/permissions.rs"
  - "packages/core/src/query/recovery.rs"
  - "packages/core/src/runtime_protocol.rs"
  - "packages/core/src/shim.rs"
  - "packages/core/tests/bin/commit_stress_harness.rs"
  - "packages/core/tests/destructive_classifier.rs"
  - "packages/core/tests/git_retry.rs"
  - "packages/core/tests/launch_reconciliation.rs"
  - "packages/core/tests/lock_contention.rs"
  - "packages/core/tests/recovery_statuses.rs"
  - "packages/core/tests/recovery_summary.rs"
  - "packages/core/tests/reconcile_worktrees.rs"
  - "packages/core/tests/spawn_stagger.rs"
  - "packages/core/tests/task_delete_with_run_history.rs"
  - "packages/core/tests/worktree_removal.rs"
  - "packages/shim/Cargo.toml"
  - "packages/shim/src/main.rs"
  - "packages/sidecar/src/claude-code-adapter.ts"
  - "packages/sidecar/src/index.ts"
  - "packages/sidecar/src/mcp-permission-server.ts"
  - "packages/sidecar/src/pretooluse-hook.ts"
  - "packages/sidecar/src/watchdog.ts"
  - "packages/sidecar/test/adapter.test.mjs"
  - "packages/sidecar/test/destructive-gate.test.mjs"
  - "packages/sidecar/test/watchdog.test.mjs"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/agent_run.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src-tauri/src/sidecar.rs"
  - "packages/desktop/src-tauri/src/state.rs"
  - "packages/desktop/src/App.tsx"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/board/BoardRow.tsx"
  - "packages/desktop/src/board/BoardView.tsx"
  - "packages/desktop/src/board/__tests__/needs-decision.test.tsx"
  - "packages/desktop/src/board/useBoardQuery.ts"
  - "packages/desktop/src/item-detail/RunsSection.tsx"
  - "packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx"
  - "packages/desktop/src/item-detail/WorktreeSummary.tsx"
  - "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/runs-section.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx"
  - "packages/desktop/src/item-detail/ActivityTrail.tsx"
  - "packages/desktop/src/legend/__tests__/legend.test.tsx"
  - "packages/desktop/src/legend/marks.ts"
  - "packages/desktop/src/projects/ProjectRail.tsx"
  - "packages/desktop/src/recovery/OrphanRecoveryModal.tsx"
  - "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx"
  - "packages/desktop/src/session/FeedRow.tsx"
  - "packages/desktop/src/session/PermissionRequestCard.tsx"
  - "packages/desktop/src/session/__tests__/feed-row.test.tsx"
  - "packages/desktop/src/session/__tests__/permission-card.test.tsx"
covered_digest: "v1:sha256:708f1b5d6bc38a0b51ef1051b9d30957b12390fd2817763ab1576129ccd5edbe"
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5, AGNT-07)."
    status: failed
    reason: "destructive.rs's classify_push only recognises --force/-f and a push targeting the project's default branch. `git push origin --delete <branch>`, `git push origin -d <branch>` and `git push origin :<branch>` on a NON-default branch fall through every check and return Verdict::Safe — no permission gate fires. This is a genuine, real, remote branch deletion (functionally equivalent to the already-correctly-caught `git branch -D`), and it is completely unguarded. No test in destructive_classifier.rs exercises --delete/-d/colon-refspec on push at all — untested as well as unhandled."
    artifacts:
      - path: "packages/core/src/destructive.rs"
        issue: "classify_push (lines 186-220) has no delete/-d/colon-refspec detection; falls through to `Verdict::Safe` for any push shape it does not recognise as force or default-branch-targeting, violating the module's own stated fail-closed contract (\"Safe is returned ONLY from an explicit, named, recognised-harmless invocation shape\")."
    missing:
      - "Detect a delete-shaped push (--delete/-d flag, or an empty-source colon refspec) in classify_push and classify it as Verdict::Destructive(DestructiveCategory::BranchDeletion) regardless of which branch is named."
      - "Add positive test cases in destructive_classifier.rs for `git push origin --delete <branch>`, `git push origin -d <branch>`, and `git push origin :<branch>` on a non-default branch, each asserting Verdict::Destructive."
deferred: []
advisory: []
behavior_unverified_items:
  - truth: "User quits the application while a session is running and no agent process survives — confirmed in the OS process table — including when the supervisor is killed rather than closed cleanly (Success Criterion 2, PROC-03/PROC-04)."
    test: "With Flywheel running and one agent session live, find the app's process id and run `kill -9 <pid>` from a terminal (not the Quit menu item). Within ~20 seconds, confirm with `ps -ax | grep claude` that no `claude` process from that session survives, and confirm a kill-record file exists under `<app-data>/runtime/kills/` naming that run."
    expected: "No agent process (or its subprocesses) from the killed session remains in the OS process table; a kill record naming the run id, pid, reason and timestamp exists on disk."
    why_human: "The watchdog's own unit tests (watchdog.test.mjs) exercise heartbeat staleness with real spawned processes and pass, which proves the mechanism in isolation, but proving the WHOLE application (Rust supervisor + Node sidecar + watchdog process-group tree) survives a hard `kill -9` of the supervisor itself requires a packaged, running app — no harness in this repository stands that up. Plan 03-02 explicitly deferred this to end-of-phase human verification."
  - truth: "User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database, and decides what happens to each; nothing is silently resumed and nothing is silently repaired (Success Criterion 3, WORK-06/PROC-05)."
    test: "With a session running, force-quit Flywheel with a kill signal rather than the Quit menu item, then relaunch. Confirm the orphan recovery modal blocks the board if any process survived, that Escape/click-outside do nothing, that Kill resolves each row, and the board becomes reachable only once the list is empty. Open the affected task and confirm its run reads Abandoned with an explanation, and Acknowledge clears the item."
    expected: "The blocking overlay appears exactly when a live orphan exists, offers only Kill (never resume/adopt), and the board is unreachable until the list is empty; abandoned runs show their kill-record reason and clear only on Acknowledge."
    why_human: "The launch classification logic itself (reconcile_worktrees, reconcile_agent_runs's three-way split, pid-reuse-safe liveness) is exercised by passing cargo tests (reconcile_worktrees.rs, launch_reconciliation.rs) against a real DB and real process rows — that part is code-verified. What remains unverified is the full live-application UX: the modal actually blocking paint, Escape/click-outside truly doing nothing, and the recovery flow completing in a packaged app rather than jsdom. Plan 03-10 explicitly deferred this to end-of-phase human verification."
human_verification:
  - test: "With Flywheel running and one agent session live, kill the supervisor with `kill -9 <pid>` (not Quit) and confirm within ~20s that no `claude` process from that session survives in `ps -ax`, and a kill record exists under `<app-data>/runtime/kills/`."
    expected: "No orphaned agent process in the OS process table; a kill record naming run id, pid, reason and timestamp exists."
    why_human: "Requires a packaged, running app and a real OS process table check; plan 03-02 deferred this explicitly."
  - test: "Force-quit Flywheel while a session runs, relaunch, and confirm the orphan recovery modal blocks the board (no Escape/click-outside dismissal), Kill resolves each row, and the board is reachable only once the list is empty; then confirm the run shows Abandoned with the watchdog's own reason and Acknowledge clears it."
    expected: "Blocking overlay behavior, per-row Kill, Kill All, and the abandoned-run badge/Acknowledge flow all work as specified in the real application."
    why_human: "Plan 03-10 explicitly deferred this — no jsdom test can stand up the real modal-blocks-paint guarantee."
  - test: "Start a real session on a scratch repository in an auto-accept permission mode and instruct the agent to force-push. Confirm the board shows a pending permission request, the session sits blocked rather than proceeding, and the remote branch is unchanged. Deny it and confirm the agent receives an explanation naming the refusal."
    expected: "The destructive gate stops the agent and asks a human before the force-push executes; denial surfaces a clear refusal to the agent, not a bare non-zero exit."
    why_human: "Plan 03-07 explicitly deferred this — it requires a real session against the real installed backend binary in auto-accept mode, which no harness in this repository stands up."
  - test: "With a real session running in auto-accept permission mode, have the agent attempt two different destructive categories in turn. Confirm the card shows the stop-sign glyph, the correct consequence sentence, Deny filled/primary and Allow outline/secondary reading \"just this once,\" and that no allow-always option is offered anywhere, including in the Settings permission-rules table after answering Allow."
    expected: "Destructive-variant card renders correctly with reversed button emphasis and no standing-grant affordance in the real application."
    why_human: "Plan 03-12 explicitly deferred this — requires a live session and visual confirmation of the card's rendered state."
  - test: "In the packaged application, drive ten concurrent commits into worktrees of one repository through a live agent session (not just the automated stress harness) and confirm every commit lands and the agent's own git invocations resolve through the installed PATH shim."
    expected: "All ten commits are reachable; the shim (not a bare system git) is what resolved the agent's own commits."
    why_human: "The automated `lock_contention.rs`/`commit_stress_harness.rs` suite drives the shim directly and passes (WORK-04/WORK-05 code-verified), and 03-08's own SUMMARY records a manual by-hand run confirming a real commit through the shim — but neither is the full packaged app driving a real agent session end to end. No packaged app was available to any executor in this phase; noted for end-of-phase confirmation per project convention."
---

# Phase 03: Nothing Lost, Nothing Left Running — Verification Report

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-15T09:36:05Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | `remove_worktree_for_task` (`packages/core/src/domain/worktree.rs:239`) unconditionally re-reads `git status --porcelain` with no force/override parameter anywhere in the call chain — confirmed careful and well-tested by the independent code review. `packages/core/tests/worktree_removal.rs` (315 lines, 8 tests) proves the refusal. `WorktreeRemovalDialog.tsx` (301 lines) renders every porcelain entry as its own row. Two non-blocking frontend edge-case bugs noted below (CR-02, CR-05) do not compromise this core guarantee — see Anti-Patterns. |
| 2 | User quits the application while a session is running and no agent process survives — confirmed in the OS process table — including when the supervisor is killed rather than closed cleanly. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Watchdog mechanism (`packages/sidecar/src/watchdog.ts`, 224 lines) is present, wired as process-group leader, force-kills its own group with no grace window on heartbeat staleness, and is exercised with real spawned processes in `watchdog.test.mjs` (part of the measured-green 55-test sidecar suite). The WHOLE-APPLICATION `kill -9` proof against a packaged app is explicitly deferred to end-of-phase human verification by plan 03-02. See `behavior_unverified_items`. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database, and decides what happens to each; nothing is silently resumed and nothing is silently repaired. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `reconcile_worktrees` and `reconcile_agent_runs` (three-way classification) are present, wired into `main.rs`'s `.setup()` in the correct order, and exercised by real-DB cargo tests (`reconcile_worktrees.rs`, `launch_reconciliation.rs`), part of the measured-green 388-test core suite. `OrphanRecoveryModal.tsx` is wired to a real DB-backed `pending_orphans` state (not static data). The full live-application blocking-overlay UX is explicitly deferred to end-of-phase human verification by plan 03-10. See `behavior_unverified_items`. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — index-lock collisions back off and retry instead of failing a task, and staggered spawn timing stops parallel starts colliding in the first place. | ✓ VERIFIED | `packages/core/tests/lock_contention.rs` (466 lines, 7 tests) and `spawn_stagger.rs` (124 lines, 5 tests) exercise real concurrent commits through `commit_stress_harness.rs`, spawned via `CARGO_BIN_EXE`, going through the PATH shim (not `git_at`) exactly as WORK-04's must-have requires. Part of the measured-green 388-test suite. `git_retry.rs`'s single shared backoff/jitter/budget module (280 lines) is the one retry policy both `git_at` and the shim call into (`is_lock_contention`'s general lock-shape matcher, not a literal `index.lock` string, confirmed at line 77). 03-08-SUMMARY records an additional manual by-hand confirmation. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete. | ✗ FAILED | `classify_push` in `packages/core/src/destructive.rs` (lines 186-220) has no handling for `git push --delete`/`-d`/colon-refspec branch deletion. For any branch OTHER than the project's default branch, this returns `Verdict::Safe` — the destructive gate never fires. Local branch deletion (`git branch -d/-D`) IS correctly caught by `classify_branch`; force-push and default-branch pushes ARE caught; recursive delete (`classify_rm`) IS caught. The gap is specifically: pushing a delete of a non-default remote branch. Confirmed present in source, matches CR-01 in `03-REVIEW-part-core.md`, untested in `destructive_classifier.rs`. See `gaps`. |

**Score:** 2/5 truths verified (2 present, behavior-unverified; 1 failed)

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05 | Worktree never destroyed without checking for uncommitted changes; refused and surfaced if any exist | ✓ SATISFIED | `remove_worktree_for_task`, `WorktreeRemovalDialog.tsx`, `worktree_removal.rs` (8 tests); `delete_task`'s D-44 worktree guard, `task_delete_with_run_history.rs`. |
| WORK-04 | 03-04, 03-08, 03-13 | Concurrent git operations retry with exponential backoff/jitter on lock contention | ✓ SATISFIED | `git_retry.rs`'s single shared policy; `lock_contention.rs` (7 tests, zero commits lost); shim-relayed retry/exhaustion notices in `FeedRow.tsx`/`ActivityTrail.tsx`. |
| WORK-05 | 03-04, 03-08 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | `SpawnFloor`/`wait_turn` in `git_retry.rs`; `spawn_stagger.rs` (5 tests); `send_spawn_request` is the sole spawn path (structurally asserted by a source-scanning test). |
| WORK-06 | 03-03, 03-09, 03-11 | Launch reconciles worktrees on disk vs database, surfaces discrepancy rather than repairing | ✓ SATISFIED | `reconcile_worktrees`, `worktrees.status = 'missing'` CHECK-constrained state, `MissingWorktreeBanner`, `reconcile_worktrees.rs`. Live end-to-end confirmation deferred to human verification (SC3). |
| PROC-03 | 03-02 | Agent processes managed as process groups so termination kills the whole tree | ✓ SATISFIED | `watchdog.ts` becomes process-group leader and spawns the backend as its own child in that group; negative-pid signalling reaches both. |
| PROC-04 | 03-02, 03-10 | No agent process survives application quit; worker self-terminates if supervisor disappears | ⚠️ PARTIALLY SATISFIED (code-verified, live proof deferred) | Watchdog heartbeat/force-kill mechanism present and unit-tested with real processes; whole-application `kill -9` proof deferred to human verification (SC2). |
| PROC-05 | 03-06, 03-10, 03-11 | Orphaned processes/in-flight runs detected and surfaced on launch, never silently resumed | ⚠️ PARTIALLY SATISFIED (code-verified, live proof deferred) | `reconcile_agent_runs`'s three-way classification, `pending_orphans` state, `OrphanRecoveryModal`; full live UX deferred to human verification (SC3). |
| AGNT-07 | 03-07, 03-12 | Destructive actions always require confirmation, even in auto-accept mode | ✗ NOT FULLY SATISFIED | `destructive.rs`'s classifier and `PermissionRequestCard`'s destructive variant are present and wired for the categories they recognise, but `classify_push` fails to gate remote branch deletion on a non-default branch (CR-01) — see gap under Truth 5. |

No orphaned requirements — all 8 IDs mapped to Phase 3 in REQUIREMENTS.md are claimed by at least one plan.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/git.rs` (`worktree_remove`, `git_status_porcelain`) | Removal verb + dirty read | ✓ VERIFIED | Present, sole `Command::new("git")` site for these ops (per `git.rs` doc, minus WR-02's `rev_parse_verify` exception noted below). |
| `packages/core/src/domain/worktree.rs` (`remove_worktree_for_task`, `reconcile_worktrees`) | Porcelain-checked removal + launch reconciliation | ✓ VERIFIED | Both present, transactional, tested. |
| `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx` | Three-state dialog | ✓ VERIFIED | 301 lines (min 120 required), Checking/Clean/Dirty states present. |
| `packages/core/tests/worktree_removal.rs` | WORK-03 integration coverage | ✓ VERIFIED | 315 lines, 8 tests. |
| `packages/core/src/runtime_protocol.rs` | On-disk runtime protocol | ✓ VERIFIED | 370 lines, `touch_heartbeat`/`write_kill_record`/`read_kill_record`/`process_is_alive` all present. |
| `packages/sidecar/src/watchdog.ts` | Per-session wrapper/process-group leader | ✓ VERIFIED | 224 lines, force-kill-own-group on staleness present. |
| `packages/sidecar/test/watchdog.test.mjs` | Real-process PROC-04 proof | ✓ VERIFIED | 232 lines, 5 tests, part of green sidecar suite. |
| `packages/core/src/db/migrations/0006_recovery_statuses.sql` | CHECK-constrained missing/abandoned states | ✓ VERIFIED | Present, registered in `db/mod.rs`. |
| `packages/core/src/domain/agent_run.rs` (`reconcile_agent_runs`, `Abandoned`) | Three-way launch classification | ✓ VERIFIED | Present, wired into `main.rs` after `reconcile_worktrees`. |
| `packages/core/tests/launch_reconciliation.rs` | PROC-05 coverage | ✓ VERIFIED | Present. |
| `packages/core/src/git_retry.rs` | Shared backoff/jitter/budget + spawn floor | ✓ VERIFIED | 280 lines (min 170), general lock-shape matcher (not literal `index.lock`), `SpawnFloor`. |
| `packages/shim/src/main.rs` | PATH shim binary | ✓ VERIFIED | Dispatches on argv[0], resolves real binary by absolute path only (no PATH re-resolution), retries through `git_retry`. |
| `packages/core/tests/spawn_stagger.rs` | WORK-05 proof | ✓ VERIFIED | 124 lines, 5 tests. |
| `packages/core/src/domain/task.rs` (`delete_task`) | D-44 worktree guard | ✓ VERIFIED | Present, worktree-count guard confirmed at lines 260-268. |
| `packages/core/tests/task_delete_with_run_history.rs` | D-44 coverage | ✓ VERIFIED | Present. |
| `packages/desktop/src-tauri/src/state.rs` (`pending_orphans`) | Live-orphan carrier | ✓ VERIFIED | Present, real DB-backed (not static). |
| `packages/core/src/destructive.rs` | D-56 classifier | ⚠️ HOLLOW (functional gap) | 294 lines, present and largely correct, but `classify_push` has the CR-01 branch-deletion gap (Truth 5, gap below) — the artifact exists and is substantive but does not fully deliver the guarantee it claims. |
| `packages/core/src/db/migrations/0007_destructive_gate.sql` | `destructive_category` column | ✓ VERIFIED | Present. |
| `packages/sidecar/src/pretooluse-hook.ts` | Fast synchronous classify-never-wait hook | ✓ VERIFIED | 140 lines (min 60), calls the shared classifier via `--classify-command`. |
| `packages/sidecar/test/destructive-gate.test.mjs` | Real-backend AGNT-07 proof | ✓ VERIFIED | 353 lines (min 90), spawns the real installed `claude` binary. |
| `packages/desktop/src/legend/marks.ts` (worktree-missing, run-abandoned, destructive-gate marks) | Board legend entries | ✓ VERIFIED | Present across 03-09/03-10/03-12. |
| `packages/desktop/src/recovery/OrphanRecoveryModal.tsx` | Blocking launch-time overlay | ✓ VERIFIED | 160+ lines, per-row Kill, Kill All present; wired to real `pending_orphans` state via TanStack Query. |
| `packages/core/src/query/recovery.rs` | Recovery rollup for board pill/badge | ✓ VERIFIED | Present, reads `worktrees.status = 'missing'` and `agent_runs.status = 'abandoned' AND acknowledged_at IS NULL`. |
| `packages/desktop/src/session/PermissionRequestCard.tsx` (destructive variant) | Stop-sign variant, reversed emphasis, no allow-always | ✓ VERIFIED | Present, `destructiveCategory` selects the variant. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/sidecar/src/claude-code-adapter.ts` | `packages/sidecar/src/watchdog.ts` | `spawn(watchdogEntry, [bin, ...argv])` | ✓ WIRED | Confirmed in `claude-code-adapter.ts`. |
| `packages/desktop/src-tauri/src/sidecar.rs` | `packages/core/src/runtime_protocol.rs` | heartbeat writer task calls `touch_heartbeat` | ✓ WIRED | Confirmed. |
| `packages/desktop/src-tauri/src/main.rs` | `packages/core/src/domain/worktree.rs` | `setup()` calls `reconcile_worktrees` after `reconcile_projects`, before spawn | ✓ WIRED | Confirmed at `main.rs:67`, order matches must-have. |
| `packages/desktop/src-tauri/src/main.rs` | `packages/core/src/domain/agent_run.rs` | `setup()` calls `reconcile_agent_runs` after `reconcile_worktrees` | ✓ WIRED | Confirmed at `main.rs:81`. |
| `packages/shim/src/main.rs` | `packages/core/src/git_retry.rs` | shim depends on core crate, calls same retry executor | ✓ WIRED | Confirmed (`with_lock_retry_notify` call at `main.rs:313`). |
| `packages/desktop/src-tauri/src/sidecar.rs` | `packages/core/src/shim.rs` | `resolved_env_for_run` prepends shim dir to PATH | ✓ WIRED | Confirmed via `merge_shim_env_for_run` per 03-04-SUMMARY. |
| `packages/shim/src/main.rs` | `packages/core/src/destructive.rs` | shim classifies argv before executing | ✓ WIRED | Confirmed, but see Truth 5 gap — the classifier itself has a hole, not the wiring. |
| `packages/desktop/src/board/BoardView.tsx` | `packages/desktop/src/board/useBoardQuery.ts` | `useRecoverySummary` supplies task-id set | ✓ WIRED | Confirmed present in `board/__tests__/needs-decision.test.tsx` coverage. |
| `packages/desktop/src/item-detail/WorktreeSummary.tsx` | `packages/desktop/src/adapters/tauri.ts` | `worktreeRecreate`/`worktreeForgetRecord` wrappers | ✓ WIRED | Confirmed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `OrphanRecoveryModal.tsx` | `rows` (from `usePendingOrphans`) | `agent_runs_pending_orphans` Tauri command → `state.pending_orphans` (populated once at launch from `reconcile_agent_runs`'s real DB read) | Yes | ✓ FLOWING |
| `WorktreeSummary.tsx` missing-worktree banner | `summary.status === "missing"` | Board query reading `worktrees.status` column (CHECK-constrained, written by `reconcile_worktrees`) | Yes | ✓ FLOWING |
| `ProjectRail.tsx` recovery badge | recovery count | `recovery_count_for_project` (real SQL rollup over `worktrees`/`agent_runs`) | Yes | ✓ FLOWING |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/core/src/destructive.rs` | 186-220 | `classify_push` fails open (returns `Safe`) for non-default-branch delete pushes | 🛑 Blocker | Directly fails Success Criterion 5 / AGNT-07 (Truth 5 gap above). |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` | 858-870, 896-911 | `agent_run_id` from the IPC boundary is joined into a filesystem path with no shape/existence validation before `session_log_path` | 🛑 Blocker (security) | Path-traversal / arbitrary-file-read primitive reachable from any `invoke` caller; the identical guard (`is_plausible_run_id`) exists elsewhere in the same codebase but was not applied to this boundary. Does not directly break a Success Criterion truth but is a genuine security regression introduced in this phase's own changed files. |
| `packages/desktop/src-tauri/src/sidecar.rs` | 802-808 | `stderr_tail.truncate(...)` can panic on a non-UTF-8-char-boundary cut, inside a `block_on` setup closure documented as unable to unwind | ⚠️ Warning | Bears on the phase's own crash-avoidance discipline (SC2/SC3 spirit) — a reachable panic in the exact code path whose doc comment says a panic here previously aborted the app before any window was shown. Triggered by >4KB of multi-byte sidecar stderr during the 5s startup handshake, not by ordinary operation. |
| `packages/core/src/destructive.rs` (via `packages/shim/src/main.rs`) | 156-175 | `classify_git` treats a leading global flag (`-C`, `-c`, etc.) as the subcommand, so e.g. `git -C <dir> status` classifies as `Uncategorized`/Destructive | ⚠️ Warning | Fails closed (never unsafe), but degrades usability — an indefinite permission-gate block on a harmless read command. Does not compromise any Success Criterion's safety guarantee. |
| `packages/desktop/src/session/PermissionRequestCard.tsx`, `WorktreeRemovalDialog.tsx` | Allow/Deny, Remove handlers | State-only double-activation guard (`state.answering`/`removeState.removing`), no `useRef` guard, unlike sibling surfaces in the same phase (`WorktreeSummary.tsx`'s `actingRef`) | ⚠️ Warning | A rapid double-click can issue two identical IPC commands before React re-renders. Confirmed present in source. Does not cause data loss (`remove_worktree_for_task` re-checks porcelain status on every call), but is a real reliability defect. |
| `packages/desktop/src/recovery/OrphanRecoveryModal.tsx` | `handleKill`/`handleKillAll` | No re-entry guard whatsoever, not even a state check at entry | ⚠️ Warning | Confirmed present. Double-activation risk on the kill path. |
| `packages/desktop/src/session/SessionSurface.tsx` | `handleStop` | State-only guard (`disabled={stopping}`), no ref guard | ⚠️ Warning | Confirmed present, same class as above. |
| `packages/desktop/src/item-detail/WorktreeSummary.tsx` | 238-240 | Missing-worktree banner gate requires `isNonEmptyString(summary.path)` in addition to `status === "missing"`; when `path` is empty, execution falls through to the ordinary render and exposes "Remove Worktree" on a row Flywheel itself believes is missing from disk | ⚠️ Warning | Contradicts the file's own doc-comment guarantee ("the early return IS the guarantee"). Confirmed present in source. Does not cause actual data loss (nothing exists on disk to remove), but is a real correctness gap in an edge case. |

No `TBD`/`FIXME`/`XXX` debt markers found in any of the 69 unique source files this phase's plans declare as `files_modified`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `classify_push` fails to gate non-default branch deletion via push | Source inspection of `packages/core/src/destructive.rs:186-220` | No `--delete`/`-d`/colon-refspec handling present; falls through to `Verdict::Safe` | ✓ CONFIRMED (gap) |
| `classify_git` misclassifies leading global flags | Source inspection of `packages/core/src/destructive.rs:156-175` | `subcommand = expanded.first()`, no global-flag skip | ✓ CONFIRMED (warning) |
| `agent_run_id` unvalidated in log-window commands | Source inspection of `agent_run.rs:858-911` | No `is_plausible_run_id`-equivalent call before `session_log_path` | ✓ CONFIRMED (blocker) |
| `stderr_tail.truncate` boundary safety | Source inspection of `sidecar.rs:802-808` | `truncate(len.min(CAP))`, no char-boundary check | ✓ CONFIRMED (warning) |
| Double-click guard pattern (`actingRef`) exists elsewhere but not on 4 named surfaces | grep for `useRef`/`actingRef` across `PermissionRequestCard.tsx`, `WorktreeRemovalDialog.tsx`, `OrphanRecoveryModal.tsx`, `SessionSurface.tsx` vs `WorktreeSummary.tsx` | Confirmed present on `WorktreeSummary.tsx` only | ✓ CONFIRMED (warning) |

Per the orchestrator's measured state, the full test gate is green at HEAD (`cargo test --workspace`
388/388, `cargo build --workspace` clean, desktop `tsc && vite build` clean + `vitest run` 413/413,
sidecar `npm test` 55/55) and this was not re-run — treated as established fact per instructions.
Source-level confirmation of all nine Critical findings from `03-REVIEW.md` was performed directly
against the current HEAD (not from SUMMARY claims) as documented above; all nine are present in the
current source, unresolved.

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention and none is declared in
any PLAN/SUMMARY.

### Human Verification Required

See `behavior_unverified_items` and `human_verification` in frontmatter for full detail. Summary:

1. **Whole-application `kill -9` proof (SC2 / PROC-04)** — deferred by plan 03-02; no harness in
   this repository can stand up a packaged app to observe the OS process table.
2. **Live orphan-recovery / crash-relaunch proof (SC3 / WORK-06 / PROC-05)** — deferred by plan
   03-10; the underlying classification logic is code-verified but the full blocking-overlay UX
   needs a real running app.
3. **Live force-push-in-auto-accept-session proof (SC5 / AGNT-07)** — deferred by plan 03-07;
   requires a real session against the real installed backend binary.
4. **Live destructive-card UI proof (AGNT-07)** — deferred by plan 03-12; requires visual
   confirmation of the card's rendered state during a real session.
5. **Live shim PATH-resolution proof through a real agent session (WORK-04/WORK-05)** — the
   automated stress harness and a manual by-hand run both confirm the shim mechanism works, but
   neither is a packaged app driving a real agent end to end; no packaged app was available to any
   executor in this phase.

### Gaps Summary

One Success Criterion (5) is directly and demonstrably FAILED by source-level inspection: the
destructive-action classifier's `classify_push` does not gate `git push --delete`/`-d`/colon-refspec
deletion of any branch other than the project's default branch. This is not a hypothetical or
theoretical gap — it is a concrete, reproducible code path (confirmed by reading
`packages/core/src/destructive.rs` directly, not by trusting `03-REVIEW.md`'s prose) that returns
`Verdict::Safe` for a real, common form of destructive git operation the phase's own AGNT-07
requirement names explicitly ("branch deletion"). Local branch deletion, force-push, and recursive
delete are all correctly gated — the gap is narrow but real, and it is untested.

Two further Critical findings from the independent code review — the unvalidated `agent_run_id`
path-traversal primitive in the Tauri IPC command surface, and the reachable non-UTF-8-boundary
panic in the sidecar's crash-avoidance-critical startup handshake — were also confirmed present at
HEAD. Neither directly falsifies a Success Criterion's literal wording, but both are genuine,
unresolved security/reliability regressions introduced by this phase's own changed files, and are
recorded here as Blockers in the Anti-Patterns table so they are not lost. Five further Warning-
level findings (three double-click re-entry guards missing on destructive-adjacent action surfaces,
one missing-worktree banner bypass on empty path, one over-broad destructive-gate false positive)
were also confirmed present and are non-blocking but should be tracked.

Two Success Criteria (2 and 3) have their underlying mechanisms code-verified via passing automated
tests but their full live-application behavior explicitly deferred to end-of-phase human
verification by the plans themselves (03-02, 03-10) — this is expected under this project's
`end-of-phase` human-verify mode and is not itself a gap, but is recorded so it becomes the phase's
UAT list.

---

_Verified: 2026-09-15T09:36:05Z_
_Verifier: Claude (gsd-verifier)_
