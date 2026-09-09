---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-09T14:25:54.759Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | packages/desktop/src/board/BoardView.tsx |  | Issue parent options (ParentPicker) and quick-add's indent target are derived from the loaded board window only — an epic/task outside it cannot be offered as a parent; shares its cause with the existing epic-filter-chip window limitation (01-VERIFICATION.md row 12) | open |  | 2026-09-09T14:25:54.759Z |  |

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
  }
]
````
