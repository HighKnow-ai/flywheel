---
status: complete
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md]
started: 2026-09-09T23:15:00Z
updated: 2026-09-10T00:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live walkthrough of the new hierarchy UI and the layer guard

expected: Launch a real `tauri dev` build and, with the mouse untouched, exercise the newly-built hierarchy UI specifically: select a task and press `m` to open the epic picker, assign and clear an epic; open an issue row's parent button (Tab-reachable, not click) and set/change/detach its parent through the grouped Epics/Tasks menu; open the item detail panel and confirm Cmd-N / Cmd-Shift-N / Cmd-F / bare `/` / Cmd-1..9 / Cmd-Shift-O are all inert while it is open, and Cmd-K still opens the palette over it without stealing focus. Every action completes with no perceptible lag or visual jank; the epic pill and issue parent button show real key/title values, not placeholders; clicking a different issue's parent button while the detail panel is open does nothing rather than opening a second trapped picker.
result: issue
reported: "item detail panel Cmd-N is actually closing the panel and doing the command"
severity: major

### 2. Perceived responsiveness at 1,000+ items

expected: With a project seeded past 1,000 items (no seed tooling exists yet — see the note carried from the previous round), reorder, filter, search, and switch projects with the mouse untouched throughout. No perceptible lag or visual jank at volume.
result: [pending]

## Summary

total: 2
passed: 1
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-01-1
  truth: "While the item detail panel is open, the global Cmd-N shortcut is inert — it neither dismisses the panel nor runs the new-item command."
  status: failed
  reason: "User reported: item detail panel Cmd-N is actually closing the panel and doing the command"
  severity: major
  test: 1
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis

## Prior Round

A previous UAT round (2026-09-09T17:55Z–20:05Z) ran 3 tests: 3 passed with 2 issues raised.
Those two issues became gaps G-01-EPIC-ASSIGN and G-01-FOCUS, which plans 01-12 through 01-15
have since closed; a post-gap-closure code review then found and fixed 2 blockers and 2 warnings
(CR-01, CR-02, WR-01, WR-02). That round's full record remains in git history at commit 6e49677.

The two tests above are what the re-verification could not settle from the codebase alone:
test 1 covers a UI surface that did not exist when the prior round ran, and test 2 is the
volume clause the prior round explicitly recorded as not exercised (the board held 1 project /
1 task / 1 issue at the time).
