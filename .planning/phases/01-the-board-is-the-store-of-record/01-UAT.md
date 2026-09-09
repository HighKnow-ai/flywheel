---
status: testing
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md]
started: 2026-09-09T17:55:00Z
updated: 2026-09-09T17:55:00Z
---

## Current Test

number: 1
name: Drive the entire board from the keyboard in a real `tauri dev` build, mouse untouched
expected: |
  Every action from BOARD-01/02/04/05/06/07/09/10 is reachable and completes with no
  perceptible input lag or visual jank, matching 01-UI-SPEC.md's Performance Contract
  (150ms keystroke-to-query debounce, render settles within 250ms of a pause) and each
  plan's own deferred <human-check> block.
awaiting: user response

## Tests

### 1. Full keyboard walkthrough of a real running build
expected: Launch `tauri dev`. Create, edit and delete epics/tasks/issues; reorder with ⌘↑/⌘↓; filter and search a project seeded past 1,000 items; open the command palette with ⌘K; register 2-3 real local repositories and switch between them — with the mouse untouched from start to finish. No perceptible lag, no visual jank.
result: [pending]

### 2. Visual read of the Flight Progress Strips direction
expected: The rack, the five status bands, the legend, the activity trail and the epic pill render as the direction intends — strips read as printed stock on a rack, Archivo's tabular figures keep columns aligned down the list, and nothing meaningful is conveyed by colour alone.
result: [pending]

### 3. Crash and relaunch, observed live
expected: Force-quit the app mid-work and relaunch. No committed change is lost or corrupted, and the board is exactly as it was. (Proven by automated SIGKILL tests, but unobserved in the real app.)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

Known-open, deliberately not fixed — see 01-VERIFICATION.md:
- `"csp": null` in tauri.conf.json (WR-03) — a real Tauri v2 CSP needs design plus live verification in a running window.
- `DoneWarning.tsx` renders "{checked}/{total} criteria unchecked", labelling the CHECKED count as unchecked. The code is faithful to 01-UI-SPEC.md's Copywriting Contract; the contract is the defect. Owner decision pending between "{total − checked}/{total} … unchecked" and "{checked}/{total} … checked".
- Epic-filter chip list derives from the loaded board window rather than a dedicated `epic_list` command, so an epic with no items in the window cannot be filtered by — a BOARD-06 partial needing a new Tauri command.
