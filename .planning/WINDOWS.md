---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 0
total_count: 7
last_updated: 2026-09-11T02:41:59.616Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/desktop/src/board/BoardView.tsx |  | Issue parent options (ParentPicker) and quick-add's indent target are derived from the loaded board window only — an epic/task outside it cannot be offered as a parent; shares its cause with the existing epic-filter-chip window limitation (01-VERIFICATION.md row 12) | open |  | 2026-09-09T14:25:54.759Z |  |
| 2 | 02 | deviation | packages/core/tests/worktree_lifecycle.rs |  | Same unsynchronized FLYWHEEL_WORKTREE_ROOT env-var race fixed in stop_lifecycle.rs (this plan) exists here unguarded from plan 02-01 — cargo test's default concurrent test execution can let a run fall through to the real ~/Flywheel default and leak a directory onto the dev machine. Not fixed here (out of this plan's file scope). | open |  | 2026-09-10T13:23:12.459Z |  |
| 3 | 02 | unrun-verify | .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md |  | Plan 02-02's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 4, result: pass): no orphaned process survived the Stop (pgrep for the Flywheel permission-gate argv returned nothing, nothing living under the worktree root) and both worktrees remained intact on disk. STILL UNEVIDENCED — the one clause this row now turns on: a Stop preserving the agent's UNCOMMITTED work. Both worktrees reported 0 dirty entries at verification time, so that half was never exercised. It is also the half most likely to regress silently, since it depends on the process-group kill never reaching the working tree, and it ties to T-02-12 (high) which 02-SECURITY.md records as verified by code reading only. Note also that UAT ran under `tauri dev`, not the packaged .app this row names. | open |  | 2026-09-10T13:23:12.599Z |  |
| 4 | 02 | deviation | packages/desktop/src/item-detail/ItemDetailPanel.tsx | 219 | hard-codes color: #ffffff on the Start Work button label instead of a token — pre-existing since plan 02-01, blocks 02-03 Task 1's own hex-literal verify gate but is outside 02-03's files_modified scope | open |  | 2026-09-10T13:38:00.146Z |  |
| 5 | 02 | deviation | packages/desktop/src/legend/marks.ts |  | Task 2's verify gate grep -c 'export const MARKS' reports 2 (also matches the pre-existing export const MARKS_BY_ID substring) — false negative predating this plan; the real single-MARKS-array criterion is verified separately and holds | open |  | 2026-09-10T13:38:00.282Z |  |
| 6 | 02 | deviation | packages/desktop/src/item-detail/WorktreeSummary.tsx |  | T-02-37 'missing from disk' clause not mitigated (no backend disk-existence signal); only the null-field case is implemented. Deferred to Phase 3 WORK-06 reconciliation. | open |  | 2026-09-11T02:15:22.725Z |  |
| 7 | 02 | unrun-verify | .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md |  | Plan 02-10's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 5, result: pass). Corroborated against the board: an API key was genuinely stored through the write-only Settings field (`settings` gained `api_key_configured_at` at 10:24:01Z), so the save-and-never-re-render clause held. STILL UNEVIDENCED — the one clause this row now turns on: granting an allow-always rule from a real permission request, seeing it listed with its project, and revoking it. Never executed across TWO attempts: `permission_rules` holds 0 rows, there are 0 `%rule%` events of any kind, and only one permission request was ever raised (answered, never converted to a rule). This is why 02-SECURITY.md records five permission-rule mitigations as verified by code reading only, including T-02-24 (high). | open |  | 2026-09-11T02:41:59.616Z |  |

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
    "description": "Plan 02-02's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 4, result: pass): no orphaned process survived the Stop (pgrep for the Flywheel permission-gate argv returned nothing, nothing living under the worktree root) and both worktrees remained intact on disk. STILL UNEVIDENCED — the one clause this row now turns on: a Stop preserving the agent's UNCOMMITTED work. Both worktrees reported 0 dirty entries at verification time, so that half was never exercised. It is also the half most likely to regress silently, since it depends on the process-group kill never reaching the working tree, and it ties to T-02-12 (high) which 02-SECURITY.md records as verified by code reading only. Note also that UAT ran under `tauri dev`, not the packaged .app this row names.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T13:23:12.599Z",
    "resolved_at": null
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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T02:15:22.725Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "02",
    "file": ".planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md",
    "line": null,
    "description": "Plan 02-10's own manual verification step. PARTIALLY OBSERVED by a human at end-of-phase UAT 2026-09-11 (02-UAT.md test 5, result: pass). Corroborated against the board: an API key was genuinely stored through the write-only Settings field (`settings` gained `api_key_configured_at` at 10:24:01Z), so the save-and-never-re-render clause held. STILL UNEVIDENCED — the one clause this row now turns on: granting an allow-always rule from a real permission request, seeing it listed with its project, and revoking it. Never executed across TWO attempts: `permission_rules` holds 0 rows, there are 0 `%rule%` events of any kind, and only one permission request was ever raised (answered, never converted to a rule). This is why 02-SECURITY.md records five permission-rule mitigations as verified by code reading only, including T-02-24 (high).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T02:41:59.616Z",
    "resolved_at": null
  }
]
````
