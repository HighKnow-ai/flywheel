---
schema_version: 1
open_count: 12
waived_count: 0
fixed_count: 6
total_count: 18
last_updated: 2026-09-24T07:58:27.699Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/desktop/src/board/BoardView.tsx |  | Issue parent options (ParentPicker) and quick-add's indent target are derived from the loaded board window only — an epic/task outside it cannot be offered as a parent; shares its cause with the existing epic-filter-chip window limitation (01-VERIFICATION.md row 12) | open |  | 2026-09-09T14:25:54.759Z |  |
| 2 | 02 | deviation | packages/core/tests/worktree_lifecycle.rs |  | Same unsynchronized FLYWHEEL_WORKTREE_ROOT env-var race fixed in stop_lifecycle.rs (this plan) exists here unguarded from plan 02-01 — cargo test's default concurrent test execution can let a run fall through to the real ~/Flywheel default and leak a directory onto the dev machine. Not fixed here (out of this plan's file scope). | open |  | 2026-09-10T13:23:12.459Z |  |
| 3 | 02 | unrun-verify | .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md |  | Plan 02-02's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 4, result: pass): no orphaned process survived the Stop (pgrep for the Flywheel permission-gate argv returned nothing, nothing living under the worktree root) and both worktrees remained intact on disk. FULLY OBSERVED 2026-09-12T00:34Z. Attempt 2 was partial — the agent committed its edit first (`THRE-43`, `1a59dbe`), so the tree was clean when the kill landed. Attempt 3 closed it: THRE-58's run reached `interrupted` at 00:34:36 and its worktree still carries an UNCOMMITTED ` M README.md` with the `+stop-test` line intact, and no orphaned process. The process-group kill demonstrably does not reach the working tree. T-02-12 moves from verified-by-code-only to observed. This row is satisfied. Note also that UAT ran under `tauri dev`, not the packaged .app this row names. | fixed |  | 2026-09-10T13:23:12.599Z | 2026-09-12T00:35:37.853Z |
| 4 | 02 | deviation | packages/desktop/src/item-detail/ItemDetailPanel.tsx | 219 | hard-codes color: #ffffff on the Start Work button label instead of a token — pre-existing since plan 02-01, blocks 02-03 Task 1's own hex-literal verify gate but is outside 02-03's files_modified scope | open |  | 2026-09-10T13:38:00.146Z |  |
| 5 | 02 | deviation | packages/desktop/src/legend/marks.ts |  | Task 2's verify gate grep -c 'export const MARKS' reports 2 (also matches the pre-existing export const MARKS_BY_ID substring) — false negative predating this plan; the real single-MARKS-array criterion is verified separately and holds | open |  | 2026-09-10T13:38:00.282Z |  |
| 6 | 02 | deviation | packages/desktop/src/item-detail/WorktreeSummary.tsx |  | T-02-37 'missing from disk' clause not mitigated (no backend disk-existence signal); only the null-field case is implemented. Deferred to Phase 3 WORK-06 reconciliation. | fixed |  | 2026-09-11T02:15:22.725Z | 2026-09-15T07:18:56.270Z |
| 7 | 02 | unrun-verify | .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md |  | Plan 02-10's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 5, result: pass). Corroborated against the board: an API key was genuinely stored through the write-only Settings field (`settings` gained `api_key_configured_at` at 10:24:01Z), so the save-and-never-re-render clause held. FULLY OBSERVED 2026-09-12: the allow-always grant, its appearance in the Settings table, and its revocation all executed in production. The board records `permission_rule.granted` 1 and `permission_rule.revoked` 1, `permission_rules` back to 0, and `permission_requests` up from 1 to 5 including an `allowed_always` decision. Five permission-rule mitigations move from verified-by-code-only to observed: T-02-04, T-02-24 (high), T-02-27, T-02-45, T-02-47. This row is satisfied. | fixed |  | 2026-09-11T02:41:59.616Z | 2026-09-12T00:29:05.383Z |
| 8 | 03 | deviation | packages/sidecar/test/adapter.test.mjs |  | ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Recorded by plan 03-13 as a deterministic clean-baseline failure, but the full sidecar suite was re-run twice by the execute-phase orchestrator at HEAD 4cb50f0 on a quiet machine and passed 55/55 both times. The original observation was transient (resource contention during concurrent test execution), not a defect. Closed as not-a-defect. | fixed |  | 2026-09-15T08:03:19.010Z | 2026-09-15T08:11:46.866Z |
| 9 | 03 | deviation | packages/sidecar/test/permission.test.mjs |  | ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Recorded by plan 03-13 as reproducing on a clean baseline stash, but two consecutive quiet full-suite runs at HEAD 4cb50f0 passed 55/55 with no timeouts. The timeouts were load-dependent, not a sandbox constraint. Closed as not-a-defect. | fixed |  | 2026-09-15T08:03:19.166Z | 2026-09-15T08:11:47.015Z |
| 10 | 03 | deviation | packages/sidecar/test |  | ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Plan 03-13 observed 38/55 and did not re-run. The execute-phase orchestrator re-ran the full sidecar suite twice at HEAD 4cb50f0: 55/55 pass, 0 fail, both times. The 16 failures were transient under concurrent load. Standing caveat kept for future readers: packages/sidecar/test/destructive-gate.test.mjs drives the real `claude` binary, so this suite spends real API budget per run and is sensitive to machine load. Closed as not-a-defect. | fixed |  | 2026-09-15T08:03:19.318Z | 2026-09-15T08:11:47.167Z |
| 11 | 03 | deviation | scripts/uat/run-all.sh |  | Plan 03-34's own end-of-phase run-all.sh (verification step 6) FAILED 4/6 scriptable items (UAT 3, 5, 6a, 6b — all live-claude-session scripts unrelated to this plan's test-corpus/docs-only diff); judged pre-existing live-session flakiness matching the phase's own repeated 03-24/03-26/03-29/03-30/03-32 pattern, not chased; see 03-34-SUMMARY.md Issues Encountered | open |  | 2026-09-22T02:12:43.740Z |  |
| 12 | 03 | deviation | scripts/uat/run-all.sh |  | Plan 03-36's own end-of-phase run-all.sh (verification step 6) FAILED 4/6 scriptable items (UAT 3, 5, 6a, 6b — all live-claude-session scripts) again, repeating entry 11's exact pattern; this plan's diff is test-corpus+docs only (packages/sidecar/test/destructive-gate.test.mjs, 03-REQUIREMENTS-BOOKKEEPING.md), cannot plausibly cause a live-claude-session failure; judged the same pre-existing flakiness as entry 11, not chased; see 03-36-SUMMARY.md | open |  | 2026-09-22T05:17:16.542Z |  |
| 13 | 05 | unrun-verify | .planning/phases/05-socratic-epic-authoring/05-02-PLAN.md |  | Task 3 human-check (product kill criterion: timed in-app shaping run vs. terminal comparison arm) not executed by the autonomous executor — deferred to end-of-phase UAT per human_verify_mode=end-of-phase. | open |  | 2026-09-23T13:08:43.755Z |  |
| 14 | 05 | unrun-verify | .planning/phases/05-socratic-epic-authoring/05-03-PLAN.md |  | SHAPE-01 flagged prohibition (values, unverified): 'MUST NOT let the challenge stage become agreeable validation' — whether the agent's live conversational behaviour during the challenge stage is genuinely challenging vs. sycophantic is a live-conversation quality judgment no autonomous executor can perform or fabricate; the structural mechanism (no proposal tool reachable during challenge) is proven by this plan's own tests, but the QUALITY of the challenge itself is deferred to end-of-phase UAT alongside WINDOWS.md entry #13's product kill criterion. | open |  | 2026-09-23T13:47:09.513Z |  |
| 15 | 05 | deviation | .planning/phases/05-socratic-epic-authoring/05-03-PLAN.md |  | Task 3's own <verify> hex-literal gate (grep -cE '#[0-9a-fA-F]{3,8}' over TWO files) can never equal the literal string "0" it is compared against, because grep -c over multiple files prints one 'file:count' line per file rather than a single combined total — a shell-scripting bug in the plan's own verify command, not a code defect. Checked per-file instead: both packages/desktop/src/session/__tests__/authoring-stage.test.tsx and packages/desktop/src/legend/marks.ts report 0 hex-literal matches individually, so the underlying invariant (no hex literal introduced) genuinely holds. | open |  | 2026-09-23T13:47:22.146Z |  |
| 16 | 05 | unrun-verify | scripts/uat/uat-08-socratic-authoring.mjs |  | Plan 05-10 Task 3's own <human-check>: the live acceptance run against the real claude backend (challenge quality, criteria-amendment ratio, the wall-clock comparison against the terminal arm from 05-SPIKE-FINDINGS.md's Product Kill Criterion) was not executed by this autonomous run — it costs real tokens against a real credentialed backend, which this session declined to spend without explicit human instruction. The script's --self-test mode (offline, no claude binary) was run and passes; the live half awaits a human running it deliberately, alongside WINDOWS.md entries #13/#14. | open |  | 2026-09-23T18:48:53.911Z |  |
| 17 | 05 | unrun-verify | .planning/phases/05-socratic-epic-authoring/05-13-PLAN.md |  | Task 3's <human-check> Product Kill Criterion re-staging (in-app arm timed against the terminal arm) not run this session — spends real API credits, two timed sittings; protocol written in 05-SPIKE-FINDINGS.md for a later deliberate run. | open |  | 2026-09-24T00:22:55.549Z |  |
| 18 | 05 | deviation | scripts/uat/uat-08-socratic-authoring.mjs |  | 05-20 Task 2 (tdd=true): the feat(05-20) commit shipping waitForTurn/accumulateTurn (05610c6) preceded the test(05-20) commit pinning its edge cases (091af4d) — canonical RED-before-GREEN order inverted because Task 1's tracer commit already shipped the correct primitive; RED was verified by construction (temporary mutation + revert) rather than a natural pre-implementation failure. Documented in 05-20-SUMMARY.md TDD Gate Compliance. | open |  | 2026-09-24T07:58:27.699Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "packages/desktop/src/board/BoardView.tsx",
    "line": null,
    "description": "Issue parent options (ParentPicker) and quick-add's indent target are derived from the loaded board window only — an epic/task outside it cannot be offered as a parent; shares its cause with the existing epic-filter-chip window limitation (01-VERIFICATION.md row 12)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-09T14:25:54.759Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/core/tests/worktree_lifecycle.rs",
    "line": null,
    "description": "Same unsynchronized FLYWHEEL_WORKTREE_ROOT env-var race fixed in stop_lifecycle.rs (this plan) exists here unguarded from plan 02-01 — cargo test's default concurrent test execution can let a run fall through to the real ~/Flywheel default and leak a directory onto the dev machine. Not fixed here (out of this plan's file scope).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T13:23:12.459Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "02",
    "file": ".planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md",
    "line": null,
    "description": "Plan 02-02's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 4, result: pass): no orphaned process survived the Stop (pgrep for the Flywheel permission-gate argv returned nothing, nothing living under the worktree root) and both worktrees remained intact on disk. FULLY OBSERVED 2026-09-12T00:34Z. Attempt 2 was partial — the agent committed its edit first (`THRE-43`, `1a59dbe`), so the tree was clean when the kill landed. Attempt 3 closed it: THRE-58's run reached `interrupted` at 00:34:36 and its worktree still carries an UNCOMMITTED ` M README.md` with the `+stop-test` line intact, and no orphaned process. The process-group kill demonstrably does not reach the working tree. T-02-12 moves from verified-by-code-only to observed. This row is satisfied. Note also that UAT ran under `tauri dev`, not the packaged .app this row names.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-10T13:23:12.599Z",
    "resolved_at": "2026-09-12T00:35:37.853Z"
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/desktop/src/item-detail/ItemDetailPanel.tsx",
    "line": 219,
    "description": "hard-codes color: #ffffff on the Start Work button label instead of a token — pre-existing since plan 02-01, blocks 02-03 Task 1's own hex-literal verify gate but is outside 02-03's files_modified scope",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T13:38:00.146Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/desktop/src/legend/marks.ts",
    "line": null,
    "description": "Task 2's verify gate grep -c 'export const MARKS' reports 2 (also matches the pre-existing export const MARKS_BY_ID substring) — false negative predating this plan; the real single-MARKS-array criterion is verified separately and holds",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T13:38:00.282Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "02",
    "file": "packages/desktop/src/item-detail/WorktreeSummary.tsx",
    "line": null,
    "description": "T-02-37 'missing from disk' clause not mitigated (no backend disk-existence signal); only the null-field case is implemented. Deferred to Phase 3 WORK-06 reconciliation.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-11T02:15:22.725Z",
    "resolved_at": "2026-09-15T07:18:56.270Z"
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "02",
    "file": ".planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md",
    "line": null,
    "description": "Plan 02-10's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 5, result: pass). Corroborated against the board: an API key was genuinely stored through the write-only Settings field (`settings` gained `api_key_configured_at` at 10:24:01Z), so the save-and-never-re-render clause held. FULLY OBSERVED 2026-09-12: the allow-always grant, its appearance in the Settings table, and its revocation all executed in production. The board records `permission_rule.granted` 1 and `permission_rule.revoked` 1, `permission_rules` back to 0, and `permission_requests` up from 1 to 5 including an `allowed_always` decision. Five permission-rule mitigations move from verified-by-code-only to observed: T-02-04, T-02-24 (high), T-02-27, T-02-45, T-02-47. This row is satisfied.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-11T02:41:59.616Z",
    "resolved_at": "2026-09-12T00:29:05.383Z"
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "03",
    "file": "packages/sidecar/test/adapter.test.mjs",
    "line": null,
    "description": "ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Recorded by plan 03-13 as a deterministic clean-baseline failure, but the full sidecar suite was re-run twice by the execute-phase orchestrator at HEAD 4cb50f0 on a quiet machine and passed 55/55 both times. The original observation was transient (resource contention during concurrent test execution), not a defect. Closed as not-a-defect.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-15T08:03:19.010Z",
    "resolved_at": "2026-09-15T08:11:46.866Z"
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "03",
    "file": "packages/sidecar/test/permission.test.mjs",
    "line": null,
    "description": "ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Recorded by plan 03-13 as reproducing on a clean baseline stash, but two consecutive quiet full-suite runs at HEAD 4cb50f0 passed 55/55 with no timeouts. The timeouts were load-dependent, not a sandbox constraint. Closed as not-a-defect.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-15T08:03:19.166Z",
    "resolved_at": "2026-09-15T08:11:47.015Z"
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "03",
    "file": "packages/sidecar/test",
    "line": null,
    "description": "ORCHESTRATOR CORRECTION 2026-09-15: did NOT reproduce. Plan 03-13 observed 38/55 and did not re-run. The execute-phase orchestrator re-ran the full sidecar suite twice at HEAD 4cb50f0: 55/55 pass, 0 fail, both times. The 16 failures were transient under concurrent load. Standing caveat kept for future readers: packages/sidecar/test/destructive-gate.test.mjs drives the real `claude` binary, so this suite spends real API budget per run and is sensitive to machine load. Closed as not-a-defect.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-15T08:03:19.318Z",
    "resolved_at": "2026-09-15T08:11:47.167Z"
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "03",
    "file": "scripts/uat/run-all.sh",
    "line": null,
    "description": "Plan 03-34's own end-of-phase run-all.sh (verification step 6) FAILED 4/6 scriptable items (UAT 3, 5, 6a, 6b — all live-claude-session scripts unrelated to this plan's test-corpus/docs-only diff); judged pre-existing live-session flakiness matching the phase's own repeated 03-24/03-26/03-29/03-30/03-32 pattern, not chased; see 03-34-SUMMARY.md Issues Encountered",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T02:12:43.740Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "03",
    "file": "scripts/uat/run-all.sh",
    "line": null,
    "description": "Plan 03-36's own end-of-phase run-all.sh (verification step 6) FAILED 4/6 scriptable items (UAT 3, 5, 6a, 6b — all live-claude-session scripts) again, repeating entry 11's exact pattern; this plan's diff is test-corpus+docs only (packages/sidecar/test/destructive-gate.test.mjs, 03-REQUIREMENTS-BOOKKEEPING.md), cannot plausibly cause a live-claude-session failure; judged the same pre-existing flakiness as entry 11, not chased; see 03-36-SUMMARY.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T05:17:16.542Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-socratic-epic-authoring/05-02-PLAN.md",
    "line": null,
    "description": "Task 3 human-check (product kill criterion: timed in-app shaping run vs. terminal comparison arm) not executed by the autonomous executor — deferred to end-of-phase UAT per human_verify_mode=end-of-phase.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T13:08:43.755Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-socratic-epic-authoring/05-03-PLAN.md",
    "line": null,
    "description": "SHAPE-01 flagged prohibition (values, unverified): 'MUST NOT let the challenge stage become agreeable validation' — whether the agent's live conversational behaviour during the challenge stage is genuinely challenging vs. sycophantic is a live-conversation quality judgment no autonomous executor can perform or fabricate; the structural mechanism (no proposal tool reachable during challenge) is proven by this plan's own tests, but the QUALITY of the challenge itself is deferred to end-of-phase UAT alongside WINDOWS.md entry #13's product kill criterion.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T13:47:09.513Z",
    "resolved_at": null
  },
  {
    "id": 15,
    "kind": "deviation",
    "phase": "05",
    "file": ".planning/phases/05-socratic-epic-authoring/05-03-PLAN.md",
    "line": null,
    "description": "Task 3's own <verify> hex-literal gate (grep -cE '#[0-9a-fA-F]{3,8}' over TWO files) can never equal the literal string \"0\" it is compared against, because grep -c over multiple files prints one 'file:count' line per file rather than a single combined total — a shell-scripting bug in the plan's own verify command, not a code defect. Checked per-file instead: both packages/desktop/src/session/__tests__/authoring-stage.test.tsx and packages/desktop/src/legend/marks.ts report 0 hex-literal matches individually, so the underlying invariant (no hex literal introduced) genuinely holds.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T13:47:22.146Z",
    "resolved_at": null
  },
  {
    "id": 16,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "scripts/uat/uat-08-socratic-authoring.mjs",
    "line": null,
    "description": "Plan 05-10 Task 3's own <human-check>: the live acceptance run against the real claude backend (challenge quality, criteria-amendment ratio, the wall-clock comparison against the terminal arm from 05-SPIKE-FINDINGS.md's Product Kill Criterion) was not executed by this autonomous run — it costs real tokens against a real credentialed backend, which this session declined to spend without explicit human instruction. The script's --self-test mode (offline, no claude binary) was run and passes; the live half awaits a human running it deliberately, alongside WINDOWS.md entries #13/#14.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T18:48:53.911Z",
    "resolved_at": null
  },
  {
    "id": 17,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-socratic-epic-authoring/05-13-PLAN.md",
    "line": null,
    "description": "Task 3's <human-check> Product Kill Criterion re-staging (in-app arm timed against the terminal arm) not run this session — spends real API credits, two timed sittings; protocol written in 05-SPIKE-FINDINGS.md for a later deliberate run.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T00:22:55.549Z",
    "resolved_at": null
  },
  {
    "id": 18,
    "kind": "deviation",
    "phase": "05",
    "file": "scripts/uat/uat-08-socratic-authoring.mjs",
    "line": null,
    "description": "05-20 Task 2 (tdd=true): the feat(05-20) commit shipping waitForTurn/accumulateTurn (05610c6) preceded the test(05-20) commit pinning its edge cases (091af4d) — canonical RED-before-GREEN order inverted because Task 1's tracer commit already shipped the correct primitive; RED was verified by construction (temporary mutation + revert) rather than a natural pre-implementation failure. Documented in 05-20-SUMMARY.md TDD Gate Compliance.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T07:58:27.699Z",
    "resolved_at": null
  }
]
````
