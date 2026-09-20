---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-20T10:50:00Z
status: gaps_found
score: 4/5 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/STATE.md"
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
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-14-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-14-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-15-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-15-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-16-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-16-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-17-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-17-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-18-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-18-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-19-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-19-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-core.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-frontend.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-sidecar.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-tauri.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-UAT.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/deferred-items.md"
  - ".planning/quick/260920-duy-fix-cr-01-shimwillintercept-must-not-def/260920-duy-PLAN.md"
  - ".planning/quick/260920-duy-fix-cr-01-shimwillintercept-must-not-def/260920-duy-SUMMARY.md"
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
  - "packages/core/src/ids.rs"
  - "packages/core/src/lib.rs"
  - "packages/core/src/query/agent_runs.rs"
  - "packages/core/src/query/mod.rs"
  - "packages/core/src/query/permissions.rs"
  - "packages/core/src/query/recovery.rs"
  - "packages/core/src/runtime_protocol.rs"
  - "packages/core/src/session_log.rs"
  - "packages/core/src/shim.rs"
  - "packages/core/tests/bin/commit_stress_harness.rs"
  - "packages/core/tests/bin/uat_seed_ui.rs"
  - "packages/core/tests/bin/uat_session_env.rs"
  - "packages/core/tests/db_bootstrap.rs"
  - "packages/core/tests/destructive_classifier.rs"
  - "packages/core/tests/git_retry.rs"
  - "packages/core/tests/launch_reconciliation.rs"
  - "packages/core/tests/lock_contention.rs"
  - "packages/core/tests/reconcile_worktrees.rs"
  - "packages/core/tests/recovery_statuses.rs"
  - "packages/core/tests/recovery_summary.rs"
  - "packages/core/tests/session_log_window.rs"
  - "packages/core/tests/spawn_stagger.rs"
  - "packages/core/tests/task_delete_with_run_history.rs"
  - "packages/core/tests/worktree_removal.rs"
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
  - "packages/desktop/src/item-detail/ActivityTrail.tsx"
  - "packages/desktop/src/item-detail/RunsSection.tsx"
  - "packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx"
  - "packages/desktop/src/item-detail/WorktreeSummary.tsx"
  - "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/runs-section.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx"
  - "packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx"
  - "packages/desktop/src/legend/__tests__/legend.test.tsx"
  - "packages/desktop/src/legend/marks.ts"
  - "packages/desktop/src/projects/ProjectRail.tsx"
  - "packages/desktop/src/recovery/OrphanRecoveryModal.tsx"
  - "packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx"
  - "packages/desktop/src/session/FeedRow.tsx"
  - "packages/desktop/src/session/PermissionRequestCard.tsx"
  - "packages/desktop/src/session/SessionSurface.tsx"
  - "packages/desktop/src/session/__tests__/feed-row.test.tsx"
  - "packages/desktop/src/session/__tests__/permission-card.test.tsx"
  - "packages/desktop/src/session/__tests__/session-surface.test.tsx"
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
  - "scripts/uat/README.md"
  - "scripts/uat/lib/long-lived-backend.mjs"
  - "scripts/uat/lib/sidecar-harness.mjs"
  - "scripts/uat/lib/supervisor.mjs"
  - "scripts/uat/run-all.sh"
  - "scripts/uat/uat-01-supervisor-kill.sh"
  - "scripts/uat/uat-03-destructive-gate.mjs"
  - "scripts/uat/uat-05-concurrent-commits.mjs"
  - "scripts/uat/uat-ui-setup.sh"
covered_digest: "v1:sha256:4e52e046bdefce409f5acead30ac0cc3858cba868b61c6e77c582205879f5961"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 3/5
  gaps_closed:
    - "SC2 (PROC-03/PROC-04, whole-application kill -9 proof): now measured live via scripts/uat/uat-01-supervisor-kill.sh (03-UAT.md test 1, pass) — the previous verification's PRESENT_BEHAVIOR_UNVERIFIED status for this truth is closed."
    - "SC3 (WORK-06/PROC-05, crash-relaunch orphan recovery proof): now measured live, human + harness, against the real running application with a genuinely live orphan (03-UAT.md test 2, pass) — the previous verification's PRESENT_BEHAVIOR_UNVERIFIED status for this truth is closed."
    - "SC5/AGNT-07 destructive-card rendering: now produced by a live, unprompted session rather than only a seeded database row (03-UAT.md test 4, pass; 03-19-SUMMARY retires the seeding caveat)."
    - "SC4/WORK-04/WORK-05 packaged-app concurrent-commit proof: now measured through a live agent session, not only the stress harness (03-UAT.md test 5, pass)."
    - "CR-01 (03-REVIEW.md, Critical): shimWillIntercept's deferral branch could be bypassed by any command text that shadows bash's own name resolution ahead of PATH search (shell function, alias, hash -p, PATH= reassignment, env PATH=) — allowing a destructive command through with ZERO gating. Fixed by quick task 260920-duy: the shim's classifier now computes text_can_shadow_path_resolution and refuses to report invokedBareName: true for any of these shapes; confirmed by direct source read and by re-running the shipped hook's own CR-01 regression test in this session (2/2 pass)."
  gaps_remaining:
    - "G-03-3 half 2 (sustained block until a human answers, SC5/AGNT-07): still open. See gaps below."
  regressions: []
advisory: []
behavior_unverified_items: []
coincidental_reliance_items: []
gaps:
  - truth: "An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete, and the session stays blocked until a human answers (Success Criterion 5, AGNT-07; 03-UAT.md gap G-03-3's own compound truth statement)."
    status: partial
    reason: "The 'raises a pending permission request' half is now measured true (plan 03-19 + quick task 260920-duy fixed the classifier-bypass regression CR-01 introduced). The 'blocks the session until a human answers' half remains unproven: across five independent live measurements (03-19-SUMMARY.md 'Issues Encountered'; STATE.md line 231), a real claude 2.1.267 session self-terminates (session_closed, reason: 'failed') roughly 15-16 seconds after the deliberate permission_request is raised and left unanswered — before any human could realistically answer, and before the request is ever resolved. The watchdog's own heartbeat-staleness kill was explicitly ruled out by measurement (a run with FLYWHEEL_HEARTBEAT_STALE_MS=120000, confirmed to propagate to the watchdog process, failed identically at the same ~15-16s mark). Root cause is unconfirmed: it may be an internal claude 2.1.267 behavior when a Bash tool call produces no output for an extended period, or some other session-lifecycle mechanism in claude-code-adapter.ts/watchdog.ts neither plan 03-19 nor the CR-01 fix touched. No work has landed against packages/sidecar/src/watchdog.ts or packages/sidecar/src/claude-code-adapter.ts since this was discovered (confirmed: no commits touch either file since 03-18)."
    artifacts:
      - path: "packages/sidecar/src/watchdog.ts"
        issue: "Ruled out as the direct cause (heartbeat-staleness override did not change the ~15-16s termination), but the actual mechanism terminating the session under a pending, unanswered permission_request has not been identified in this file or elsewhere."
      - path: "packages/sidecar/src/claude-code-adapter.ts"
        issue: "Named as a candidate location for the unidentified session-lifecycle mechanism; not yet investigated."
    missing:
      - "A dedicated follow-up plan/spike, run in a clean environment (no inherited personal ~/.claude/ configuration), that identifies why the session terminates ~15-16s into an unanswered destructive-gate block and either fixes it or proves it does not reproduce in a packaged, production-shaped run."
      - "A reconciled statement of AGNT-07's status: REQUIREMENTS.md marks AGNT-07 'Complete' and 03-19-SUMMARY.md's own frontmatter claims requirements-completed: [AGNT-07], but that same SUMMARY's key-decisions section explicitly states 'AGNT-07 is NOT re-certified as fully closed by this plan.' This verifier's read is that AGNT-07's core defect (refusal instead of confirmation) is fixed, but the requirement's own wording ('always require explicit confirmation') is not yet demonstrated to survive realistic answer latency — the two documents should not both claim 'Complete' without qualifying this."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-20T10:50:00Z
**Status:** gaps_found
**Re-verification:** Yes — against the current tree, superseding a stale 2026-09-16 report that
predates plans 03-14 through 03-19, code review 03-REVIEW.md, and quick task 260920-duy (the CR-01
fix). This report does not carry forward the prior report's conclusions; every truth below was
re-derived from source, tests run in this session, and the phase's own dated artifacts.

**A note on ROADMAP mode:** Phase 3's ROADMAP entry is tagged `Mode: mvp`, but its goal text
("Cyril can quit, crash or interrupt Flywheel...") is not in the `As a ... I want ... so that ...`
User Story shape the MVP verification path requires (`user-story.validate` returns `valid: false`
against it). The prior verification round already treated this phase under the standard
Success-Criteria goal-backward method, not MVP User Flow Coverage, and produced a report the project
accepted; this report follows that same precedent rather than halting on a tagging inconsistency
that predates both verification rounds. Flagging this as an `info`-level note, not a blocker — the
ROADMAP's `Mode: mvp` tag on this phase should be corrected or the goal reworded in a future pass.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | `remove_worktree_for_task` re-reads `git status --porcelain` unconditionally before every removal; `worktree_removal.rs` and `WorktreeRemovalDialog.tsx`'s `removingRef` guard (03-18) are exercised by the full `cargo test --workspace` and `npx vitest run` runs I executed directly this session — both fully green (see Behavioral Spot-Checks). No live UAT harness targets SC1 specifically; code-level proof is what this truth has always rested on, unchanged in kind from the initial verification. |
| 2 | User quits the application while a session is running and no agent process survives — confirmed in the OS process table — including when the supervisor is killed rather than closed cleanly. | ✓ VERIFIED | **Upgraded from PRESENT_BEHAVIOR_UNVERIFIED.** `03-UAT.md` test 1 (`scripts/uat/uat-01-supervisor-kill.sh`, automated, pass): the watchdog force-kills the session's whole process group within one stale window and writes a kill record naming run id, pid, reason and timestamp under `<app-data>/runtime/kills/`. Documented scope note in the UAT record itself: the leaf of the process tree is a long-lived stub rather than a real `claude` process, because `claude` 2.1.267's own turns end (~16s) before the 15s stale window under its tool policy — a defensible test-design necessity, not a gap in the product, since everything above the leaf (the watchdog, process-group signalling, kill-record write) is the real product code. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database, and decides what happens to each; nothing is silently resumed and nothing is silently repaired. | ✓ VERIFIED | **Upgraded from PRESENT_BEHAVIOR_UNVERIFIED.** `03-UAT.md` test 2 (human + harness, pass): confirmed against the real running application with a genuinely live orphan — modal blocked the board, Escape did nothing (screenshot-verified before/after), only Kill/Kill All were offered, Kill resolved the row, the run showed Abandoned with reason `killed-by-user-at-launch`, and Acknowledge cleared it. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — index-lock collisions back off and retry instead of failing a task, and staggered spawn timing stops parallel starts colliding in the first place. | ✓ VERIFIED | `03-UAT.md` test 5 (automated, pass): all ten commits reachable through a real `claude` session (not just the stress harness), zero shim retry-budget exhaustions, shim resolution proven by the agent's own `command -v git` resolving to the per-run shim directory. `lock_contention.rs`/`spawn_stagger.rs` also pass in my own `cargo test --workspace` run this session. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete — and the session stays blocked until a human answers (SC5, AGNT-07; the compound truth `03-UAT.md`'s own gap G-03-3 was filed against). | ◐ PARTIAL — see gap | **Half 1 (raises a pending permission request): VERIFIED.** Plan 03-19 rewrote `pretooluse-hook.ts` to defer to the shim's own permission socket instead of refusing every non-safe verdict outright, closing the original G-03-3 defect (03-UAT.md test 3, `non_execution_kind: "permission-rule"` refusal with zero `permission_request`s raised, ever). A subsequent code review (03-REVIEW.md CR-01, Critical) found the new deferral branch could itself be bypassed by any command text that shadows bash's own PATH resolution (a shell function/alias/`PATH=` reassignment ahead of the destructive segment) — allowing the destructive command through with **zero** gating, worse than pre-03-19 behaviour. Quick task 260920-duy fixed this: `packages/shim/src/main.rs`'s classifier now computes `text_can_shadow_path_resolution` and reports `invokedBareName: false` for every shape CR-01 named (function def, alias, `function` keyword, `hash -p`, `PATH=`, `env PATH=`), forcing the hook's deny path instead. Confirmed directly this session: source read of `pretooluse-hook.ts`/`main.rs` shows the fix present and documented; I re-ran the shipped hook's own CR-01 regression test (`the hook denies the measured CR-01 bypass commands and still defers to the ordinary case, in the same shim directory`) — **1/1 pass** — and the companion missing-shadow-entry test — **1/1 pass**. The card-render truth this same SC references (03-UAT.md test 4: stop-sign glyph, branch-not-remote consequence copy, no allow-always affordance anywhere including Settings) is also now produced by a live, unprompted session rather than a seeded row, and passes. **Half 2 (blocks the session until a human answers): NOT VERIFIED — open gap.** See Gaps below. |

**Score:** 4/5 truths verified (0 present-behavior-unverified; 1 partial, blocking — Truth 5's
"sustained block" half remains an open, measured, unresolved finding).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes; refused and surfaced if any exist | ✓ SATISFIED | Unchanged from prior round; re-confirmed by a fully green `cargo test --workspace`/`npx vitest run` this session. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git operations retry with exponential backoff/jitter on lock contention | ✓ SATISFIED | `git_retry.rs`'s single shared policy; `lock_contention.rs` (green); now additionally live-proven through a real agent session (03-UAT.md test 5). |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | `SpawnFloor`/`wait_turn`; `spawn_stagger.rs` (green); live-proven alongside WORK-04 (03-UAT.md test 5). |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees on disk vs database, surfaces discrepancy rather than repairing | ✓ SATISFIED | `reconcile_worktrees`; `MissingWorktreeBanner` gated on `status` alone (03-18); live crash-relaunch proof now closed (03-UAT.md test 2). |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups so termination kills the whole tree | ✓ SATISFIED | `watchdog.ts` process-group leader, negative-pid signalling; live-proven (03-UAT.md test 1). |
| PROC-04 | 03-02, 03-10, 03-15, 03-17 | No agent process survives application quit; worker self-terminates if supervisor disappears | ✓ SATISFIED | Watchdog heartbeat/force-kill mechanism, unit-tested and now live-proven (03-UAT.md test 1). |
| PROC-05 | 03-06, 03-10, 03-11, 03-17 | Orphaned processes/in-flight runs detected and surfaced on launch, never silently resumed | ✓ SATISFIED | `reconcile_agent_runs`, `OrphanRecoveryModal` re-entry-guarded; live-proven (03-UAT.md test 2). |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19, quick-260920-duy | Destructive actions always require confirmation, even in auto-accept mode | ◐ PARTIAL (see gap) | The refusal-instead-of-confirmation defect (G-03-3's original filing) is fixed and live-proven (03-19); the classifier-bypass regression that fix introduced (CR-01) is fixed and regression-tested (260920-duy). The requirement's own wording — "always require explicit confirmation" — is not yet demonstrated to hold when a human takes longer than ~15-16s to answer: five independent live measurements show the session self-terminating before that point, unanswered. **REQUIREMENTS.md marks this Complete; this verifier does not consider that fully accurate without a qualifier**, and 03-19-SUMMARY.md's own key-decisions section agrees ("AGNT-07 is NOT re-certified as fully closed by this plan"). |

All 8 requirement IDs are present in REQUIREMENTS.md and mapped to a phase-03 plan; no orphaned
requirement IDs found (direct grep, not SUMMARY trust). AGNT-07's REQUIREMENTS.md status line reads
`Complete` — this verifier flags that as premature pending the gap below, not as a fabrication (the
underlying defect this requirement was originally filed against genuinely is fixed).

### Required Artifacts (Delta Since Stale 2026-09-16 Verification)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/shim/src/main.rs` (`--classify-invocation`, `text_can_shadow_path_resolution`) | Reports whether a destructive invocation is reachable by the shim's shadow PATH entry, refusing to call it "bare" if the text itself can pre-empt PATH resolution | ✓ VERIFIED | Confirmed present at source (`resolve_segment_program_index`, `text_can_shadow_path_resolution`, `invoked_bare_name` field on `ClassifiedInvocation`). |
| `packages/sidecar/src/pretooluse-hook.ts` (`shimWillIntercept`, two-branch decision) | Defers to the shim's socket only when interception is provable; denies otherwise, including the CR-01 shadow-bypass class | ✓ VERIFIED | Confirmed present at source; doc comment explicitly documents the two-fact split (TEXT property via the shim classifier, ENVIRONMENT property via `shimWillIntercept`) added by the CR-01 fix. Regression test for the exact CR-01 bypass commands re-run directly: 1/1 pass. |
| `packages/sidecar/src/mcp-permission-server.ts` (`socketBaseDir`) | Permission socket binds under `/tmp` to fit `SUN_LEN`, falling back to `os.tmpdir()` | ✓ VERIFIED | Confirmed present at source. **Not hardened**: no `fs.chmodSync` call anywhere in this file — WR-01 from 03-REVIEW.md (socket left at default umask permissions under the now-shared `/tmp`) remains open; see Anti-Patterns. |
| `packages/core/src/db/mod.rs` (`app_data_dir`, `FLYWHEEL_APP_DATA_DIR`) | Test/production seam for the fleet database directory | ✓ VERIFIED (present, functions) | Present and functioning for its stated purpose. **Not hardened**: no `is_absolute()` check — WR-02 from 03-REVIEW.md (a non-empty relative override silently resolves against CWD, contrary to the function's own doc comment) remains open; see Anti-Patterns. |
| `scripts/uat/uat-03-destructive-gate.mjs` | Live E2E measurement of the destructive gate against a real session | ✓ VERIFIED present and current | Retargeted in 03-19 to the two-phase flow; not re-run live in this verification session (see Behavioral Spot-Checks for why) — relies on the orchestrator's own fresh measurement table plus my own regression-test confirmation of the underlying code fix. |

### Key Link Verification (Delta)

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/shim/src/main.rs` (`--classify-invocation`) | `packages/sidecar/src/pretooluse-hook.ts` (`shimWillIntercept` + `invokedBareName` check) | hook shells out to the shim's classify-invocation mode and requires BOTH the text proof and the environment proof before deferring | ✓ WIRED | Confirmed via the passing shipped-hook regression test exercising both the shim binary and the hook script together, not a mock of either. |
| `packages/sidecar/src/pretooluse-hook.ts` (deny branch) | `packages/sidecar/src/mcp-permission-server.ts` (permission socket) | shim's `request_permission` connects to the socket ONLY when the hook defers | ✓ WIRED (per 03-19-SUMMARY's live measurement) | A live agent-issued `git push origin --delete <branch>` produced a genuine `permission_request` carrying `destructiveCategory: "branch-deletion"` — not re-measured live by this verifier (see Behavioral Spot-Checks), taken from the orchestrator's directly-reported, fresh (this-session) measurement. |
| `packages/sidecar/src/mcp-permission-server.ts` (held request) | a human's Allow/Deny answer | the session is expected to remain blocked, unresolved, until `resolvePermission` is called | ✗ NOT CONFIRMED SUSTAINED | This is the crux of the open gap: the connection/request is real and raised, but the session terminates on its own before this link is ever exercised to completion in any of five live measurements. |

### Behavioral Spot-Checks (Run Directly, This Session)

| Behavior | Command | Result | Status |
|---|---|---|---|
| CR-01 shadow-bypass commands are denied; ordinary bare command still defers | `node --test --test-name-pattern 'shadow\|CR-01\|bypass' packages/sidecar/test/destructive-gate.test.mjs` | `# tests 2`, `# pass 2`, `# fail 0` | ✓ PASS |
| Full Rust workspace suite | `cargo test --workspace` | every `test result: ok` line, 0 failed across all binaries (core, shim, desktop, relay_client) | ✓ PASS |
| Full sidecar suite (Node) | `npm --prefix packages/sidecar run test` | first run: `65 pass / 1 fail` (a timing-sensitive watchdog stale-window test); clean re-run: `66 pass / 0 fail` | ✓ PASS (flaky on cold run, deterministic on rerun — noted, not a code defect this verifier could attribute to any phase-03 change) |
| Full desktop suite (Vitest) | `npx vitest run` (packages/desktop) | `Test Files 32 passed (32)`, `Tests 440 passed (440)` | ✓ PASS |
| Live E2E destructive-gate measurement (`scripts/uat/uat-03-destructive-gate.mjs`) | not re-run this session | N/A | ? SKIP — spawns a real `claude` session against live credentials; the orchestrator's own fresh measurement (reported in this task's briefing) plus this session's source-level and unit-test confirmation of the underlying fix were judged sufficient without repeating a slow, costly live run that the SUMMARY/STATE.md already document exhaustively (5 independent runs) |
| No debt markers introduced in any file touched since the stale verification | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all 13 files 03-19 + quick-260920-duy touched | no matches | ✓ CONFIRMED clean |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention exists in this repository. This project
uses `scripts/uat/*.sh`/`*.mjs` harnesses instead, covered under Behavioral Spot-Checks and
Requirements Coverage above.

### Anti-Patterns Found (Status Update)

| File | Pattern | Severity | Resolution |
|---|---|---|---|
| `packages/sidecar/src/pretooluse-hook.ts` (`shimWillIntercept`) | CR-01: deferral branch provable-reachable but not provable-actually-reached (shadow-bypass) | 🛑 Critical (03-REVIEW.md) | **RESOLVED** — quick task 260920-duy, confirmed by source read + re-run regression test this session. |
| `packages/sidecar/src/mcp-permission-server.ts` (`socketBaseDir`) | WR-01: permission socket now binds under shared `/tmp` (widened from per-user `os.tmpdir()`) with no explicit `chmod` hardening | ⚠️ Warning (03-REVIEW.md) | **STILL OPEN.** Confirmed via source read: no `fs.chmodSync` call exists in this file. Lower severity per the review's own assessment (requires a second local account on the same single-developer machine — outside this product's stated threat model), but unresolved. Not touched by 260920-duy. |
| `packages/core/src/db/mod.rs` (`app_data_dir`) | WR-02: `FLYWHEEL_APP_DATA_DIR` accepts a non-empty relative value without rejecting it, contrary to its own doc comment's claim | ⚠️ Warning (03-REVIEW.md) | **STILL OPEN.** Confirmed via source read: no `is_absolute()` check exists. Low blast radius (test/harness-only env var in practice), unresolved. Not touched by 260920-duy. |
| `packages/desktop/src-tauri/src/sidecar.rs` (`push_bounded_stderr_tail`) | IN-01: doc comment overstates the peak-memory guarantee (whole chunk is decoded before truncation) | ℹ️ Info (03-REVIEW.md) | Not a defect — informational only, explicitly low-urgency per the review itself. Unchanged. |
| `packages/core/src/destructive.rs` (`classify_git`) | Leading global git flag (`-C`, `-c`) misclassifies as `Uncategorized` (destructive), fails closed | ⚠️ Warning (pre-existing, carried since initial verification) | **STILL OPEN, deliberately out of scope.** Newly observed to fire on `claude`'s own internal session-startup housekeeping now that the gate can block real commands (03-19-SUMMARY "Blockers/concerns for follow-up"). Degrades usability, never compromises safety. |

No new debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) in any file touched since the
last verification round.

### Human Verification Required

None beyond what's captured as the open gap above. Every item the prior (2026-09-16) verification
round deferred to end-of-phase human sign-off (whole-app `kill -9`, crash-relaunch orphan recovery,
live destructive-card rendering, packaged-app concurrent commits) is now closed by the
`scripts/uat/` harness suite recorded in `03-UAT.md` — genuine live measurement, not code-only
inference. The one remaining open item (sustained block under G-03-3) is not a "needs a human to
look at pixels" item; it is an unresolved engineering root-cause investigation, and is therefore
carried as a **gap**, not a human-verification checklist item.

### Gaps Summary

**Four of five Success Criteria are now fully, live-verified** — a materially stronger evidentiary
position than the stale 2026-09-16 report, which left SC2 and SC3 as code-only, behavior-unverified.
The `scripts/uat/` harness built in this phase's tail (03-15, 03-19) closed both of those gaps with
real measurements against the real application, not just unit tests.

**SC5/AGNT-07 remains genuinely open**, though not for the reason the stale report's own predecessor
(03-UAT.md's G-03-3) originally named. The original defect — the hook refusing every destructive
command outright, so the shim's socket (and any human confirmation) was structurally unreachable —
is fixed and live-proven by plan 03-19. A regression that same plan introduced (CR-01: a shell
function/alias/`PATH=` shadow ahead of the destructive segment could bypass BOTH the hook's refusal
and the shim's socket, executing with zero gating — objectively worse than the pre-03-19 behaviour)
is fixed and regression-tested by quick task 260920-duy, confirmed directly in this session.

What remains unresolved is a **newly discovered, unrelated, and still-uninvestigated** finding: in
every one of five live measurements, a real session self-terminates roughly 15-16 seconds after
raising the destructive-gate's permission request, before it is ever answered. The watchdog's own
heartbeat-staleness mechanism was explicitly ruled out by measurement. No commit since 03-18 has
touched `watchdog.ts` or `claude-code-adapter.ts` — the two files named as candidate locations for
the responsible mechanism — so this is not resolved by any work landed after 03-19. This is a real,
open risk to the phase's own goal statement: if a real user takes longer than ~15 seconds to look at
and answer a destructive-action permission card, their session may die before their answer is ever
read, undermining the "know that ... no agent is still spending his money" confidence the phase
promises (the destructive command itself does not execute in this failure mode — the remote/local
state stays safe — but the confirmation mechanism AGNT-07 requires does not reliably complete).

**Overall determination:** `gaps_found`. This is not a request to reopen the whole destructive-gate
mechanism — the request-raising half of G-03-3 is solidly fixed and tested, and the shadow-bypass
regression CR-01 found is closed. It is a request for a dedicated, scoped follow-up (a session-
lifecycle investigation, ideally in a clean environment) before AGNT-07 and Success Criterion 5 are
marked fully, reliably closed — consistent with 03-19-SUMMARY.md's own explicit recommendation and
STATE.md's own "before treating G-03-3/AGNT-07 as fully, reliably closed" framing, neither of which
this verifier is overriding.

---

_Verified: 2026-09-20T10:50:00Z_
_Verifier: Claude (gsd-verifier)_
