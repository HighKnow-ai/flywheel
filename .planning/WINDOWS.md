---
schema_version: 1
open_count: 6
waived_count: 0
fixed_count: 0
total_count: 6
last_updated: 2026-09-11T02:15:22.725Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/desktop/src/board/BoardView.tsx |  | Issue parent options (ParentPicker) and quick-add's indent target are derived from the loaded board window only — an epic/task outside it cannot be offered as a parent; shares its cause with the existing epic-filter-chip window limitation (01-VERIFICATION.md row 12) | open |  | 2026-09-09T14:25:54.759Z |  |
| 2 | 02 | deviation | packages/core/tests/worktree_lifecycle.rs |  | Same unsynchronized FLYWHEEL_WORKTREE_ROOT env-var race fixed in stop_lifecycle.rs (this plan) exists here unguarded from plan 02-01 — cargo test's default concurrent test execution can let a run fall through to the real ~/Flywheel default and leak a directory onto the dev machine. Not fixed here (out of this plan's file scope). | open |  | 2026-09-10T13:23:12.459Z |  |
| 3 | 02 | unrun-verify | .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md |  | Plan 02-02's own manual verification step (start a real session, press Stop, confirm from a bare terminal that the worktree is intact and no process survives under it) has not been observed by a human — deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. | open |  | 2026-09-10T13:23:12.599Z |  |
| 4 | 02 | deviation | packages/desktop/src/item-detail/ItemDetailPanel.tsx | 219 | hard-codes color: #ffffff on the Start Work button label instead of a token — pre-existing since plan 02-01, blocks 02-03 Task 1's own hex-literal verify gate but is outside 02-03's files_modified scope | open |  | 2026-09-10T13:38:00.146Z |  |
| 5 | 02 | deviation | packages/desktop/src/legend/marks.ts |  | Task 2's verify gate grep -c 'export const MARKS' reports 2 (also matches the pre-existing export const MARKS_BY_ID substring) — false negative predating this plan; the real single-MARKS-array criterion is verified separately and holds | open |  | 2026-09-10T13:38:00.282Z |  |
| 6 | 02 | deviation | packages/desktop/src/item-detail/WorktreeSummary.tsx |  | T-02-37 'missing from disk' clause not mitigated (no backend disk-existence signal); only the null-field case is implemented. Deferred to Phase 3 WORK-06 reconciliation. | open |  | 2026-09-11T02:15:22.725Z |  |

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
    "description": "Plan 02-02's own manual verification step (start a real session, press Stop, confirm from a bare terminal that the worktree is intact and no process survives under it) has not been observed by a human — deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase.",
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
  }
]
````
