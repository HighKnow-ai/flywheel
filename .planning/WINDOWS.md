---
schema_version: 1
open_count: 4
waived_count: 0
fixed_count: 6
total_count: 10
last_updated: 2026-09-15T08:11:47.167Z
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
  }
]
````
