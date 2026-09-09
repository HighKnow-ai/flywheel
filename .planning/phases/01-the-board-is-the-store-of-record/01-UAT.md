---
status: complete
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md]
started: 2026-09-09T17:55:00Z
updated: 2026-09-09T20:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Full keyboard walkthrough of a real running build
expected: Launch `tauri dev`. Create, edit and delete epics/tasks/issues; reorder with ⌘↑/⌘↓; filter and search a project seeded past 1,000 items; open the command palette with ⌘K; register 2-3 real local repositories and switch between them — with the mouse untouched from start to finish. No perceptible lag, no visual jank.
result: pass
note: "Board held 1 project / 1 task / 1 issue; the >1,000-item volume clause was not exercised (no seed tooling exists)." 

### 2. Visual read of the Flight Progress Strips direction
expected: The rack, the five status bands, the legend, the activity trail and the epic pill render as the direction intends — strips read as printed stock on a rack, Archivo's tabular figures keep columns aligned down the list, and nothing meaningful is conveyed by colour alone.
result: pass
note: "Visual direction passes. Two functional defects surfaced while looking (G-01-EPIC-ASSIGN, G-01-FOCUS) — neither is a visual finding."

### 3. Crash and relaunch, observed live
expected: Force-quit the app mid-work and relaunch. No committed change is lost or corrupted, and the board is exactly as it was. (Proven by automated SIGKILL tests, but unobserved in the real app.)
result: pass
evidence: "Pre-kill and post-relaunch snapshots identical: 2 projects, 1 epic, 5 tasks, 1 issue, 40 events. Clean startup, no errors." 

## Summary

total: 3
passed: 3
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

### Discovered during test 2 (functional, not visual)

- gap_id: G-01-EPIC-ASSIGN
  truth: "A task can be placed under an epic, and an issue under an epic or task — the fixed three-level hierarchy BOARD-01 claims is reachable from the UI."
  status: failed
  reason: "User reported: I don't have the impression I can assign a task to an epic. Confirmed in code and in the live database."
  severity: blocker
  test: 2
  artifacts:
    - path: "packages/desktop/src/board/useBoardQuery.ts"
      issue: "line 220 useCreateTask sends {projectId, title} — drops the epicId that task_create accepts; line 244 useCreateIssue sends {projectId, title, kind} — drops both epicId and taskId that issue_create accepts"
    - path: "packages/desktop/src-tauri/src/main.rs"
      issue: "command registry has no task_set_epic / issue_set_parent — no post-creation reparenting path exists"
    - path: "packages/desktop/src-tauri/src/commands/task.rs"
      issue: "task_update (line 85) patches only title/description; epic_id is not patchable"
    - path: "packages/desktop/src-tauri/src/commands/issue.rs"
      issue: "issue_update (line 105) patches only title/body; epic_id/task_id are not patchable"
  missing:
    - "Pass epicId through useCreateTask, and epicId/taskId through useCreateIssue, so the parent survives creation"
    - "Add task_set_epic and issue_set_parent Tauri commands plus their domain functions, for reparenting after creation"
    - "Add a keyboard-reachable epic picker to the board-list region and the palette (no binding exists; s/p/e/a are taken by status/priority/estimate/assignee)"
  evidence: "Live DB: all 5 tasks have epic_id NULL and the 1 issue has epic_id and task_id NULL — nothing has ever been parented."
  impact: "BOARD-01 ('fixed three-level hierarchy') is marked [x] Complete in .planning/REQUIREMENTS.md:23 but is structurally unreachable through the UI. Every item is permanently flat in the backlog; the BoardRow epic pill can only ever render its 'No epic' fallback and the epic filter chips can only ever match the null bucket."


Known-open, deliberately not fixed — see 01-VERIFICATION.md:
- `"csp": null` in tauri.conf.json (WR-03) — a real Tauri v2 CSP needs design plus live verification in a running window.
- `DoneWarning.tsx` renders "{checked}/{total} criteria unchecked", labelling the CHECKED count as unchecked. The code is faithful to 01-UI-SPEC.md's Copywriting Contract; the contract is the defect. Owner decision pending between "{total − checked}/{total} … unchecked" and "{checked}/{total} … checked".
- Epic-filter chip list derives from the loaded board window rather than a dedicated `epic_list` command, so an epic with no items in the window cannot be filtered by — a BOARD-06 partial needing a new Tauri command.

- gap_id: G-01-FOCUS
  truth: "With the item detail panel open, global shortcuts either do not fire or move focus coherently — a shortcut never opens a surface the user cannot then type into."
  status: failed
  reason: "User reported: there are issues with the right panel + shortcuts. Shortcuts still work when the panel is open but then the focus and typing is wrong. The misfocus is happening at several places."
  severity: major
  test: 2
  root_cause: "useGlobalBindings (packages/desktop/src/state/keyboard.ts:326) is a bare window keydown listener with no layer awareness. Every global binding fires regardless of which layer is on top. The board-list container handler already stands down correctly (BoardView.tsx:353 `if (activePicker || detailItemId || deleteTarget) return`), and the Escape ladder already models the layer stack (nextEscapeLayer, keyboard.ts:245) — but that model is consulted ONLY for Escape. No other global binding reads it."
  artifacts:
    - path: "packages/desktop/src/state/keyboard.ts"
      issue: "line 326 useGlobalBindings has no layer/disabled guard; resolveGlobalBinding only guards bare keys via isTypingTarget, and modifier-bearing bindings are explicitly exempted"
    - path: "packages/desktop/src/board/BoardView.tsx"
      issue: "line 409 registers create-task/create-epic globally with no detailItemId guard; quick-add renders as a virtual row (line ~505, autoFocus) that the panel's trapped FocusScope immediately steals focus back from"
    - path: "packages/desktop/src/item-detail/ItemDetailPanel.tsx"
      issue: "line 79 <FocusScope trapped> correctly traps Tab movement but cannot stop window-level keydown handlers from opening surfaces outside the scope"
    - path: "packages/desktop/src/board/FilterBar.tsx"
      issue: "line 66 focus-search calls inputRef.current?.focus() unconditionally on an input outside the trapped scope"
  instances:
    - "CMD-N / CMD-SHIFT-N with panel open: quick-add row appears and is visible, but FocusScope pulls focus back into the panel — typing lands in the panel's title input. Headline symptom."
    - "/ or CMD-F with panel open: search input is .focus()'d, FocusScope yanks focus back, typing lands in the panel. Intermittent because the bare `/` is suppressed by isTypingTarget while the title field holds focus, but not while focus sits on the close/status buttons — which is why it reads as happening 'at several places'."
    - "CMD-1..CMD-9 with panel open: switches project underneath an open detail panel; the panel renders on detailItemId && selectedItem, which then resolves against a different project's items."
    - "CMD-SHIFT-O with panel open: opens the native folder dialog from behind a trapped focus scope."
    - "Palette opened over the panel: two trapped FocusScopes mounted at once (CommandPalette.tsx:443), and the palette can issue board-list actions (CommandPalette.tsx:237) against a board behind the panel."
  missing:
    - "Give useGlobalBindings the layer awareness the Escape ladder already has — drop any binding not owned by the topmost open layer, rather than each consumer hand-rolling a guard"
    - "Move quickAddOpen and activePicker into uiStore alongside the paletteOpen/detailItemId/deleteTarget it already holds (uiStore.ts:74,83,86), so one place knows the full layer stack"
    - "Add regression tests asserting each global binding is inert while the detail panel is open"
