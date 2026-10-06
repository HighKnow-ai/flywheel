---
status: testing
phase: 08-review-and-merge-inside-flywheel
source: [08-VERIFICATION.md]
started: 2026-10-06T16:50:00Z
updated: 2026-10-06T16:50:00Z
---

## Current Test

number: 1
name: Read a multi-language task diff in light AND dark themes at review width
expected: |
  Added/removed tints do not fight token colour; text stays legible (VALIDATION manual row 1)
awaiting: user response

## Tests

### 1. Read a multi-language task diff in light AND dark themes at review width
expected: Added/removed tints do not fight token colour; text stays legible (VALIDATION manual row 1)
result: [pending]

### 2. Review a real multi-file task: check each criterion against selected lines without losing scroll position, then toggle to whole-epic scope and read the new Tasks roll-up beneath the epic's own criteria
expected: The rail stays usable over a long diff; scroll position survives each check; the roll-up counts match what the board shows (VALIDATION manual row 2)
result: [pending]

### 3. Open the merge confirm sheet, then a conflicting merge, in the packaged/dev app
expected: Wording reads clearly; the conflict names each file and offers 'start a session' and 'open worktree'; the board shows the integrated marker after a clean merge
result: [pending]

### 4. Open an epic request against a real authenticated GitHub/GitLab repo, twice in a row
expected: First call pushes and opens one request; second surfaces the existing request read-only rather than creating a duplicate
result: [pending]

### 5. Open the epic request sheet, change state in another window (check a criterion or merge a task), then confirm
expected: Per WR-08 of the review the published body can differ from the previewed one; decide whether a content-hash guard is required before this ships
result: [pending]

### 6. Keyboard-only pass through review in the real WebView: j/k files, Enter to expand, c to check, Tab to Merge, Enter and Space on the confirm button, same for 'Open request'
expected: Every step completes without the mouse (line selection itself is gutter-click only). The CR-03 guard is proven in jsdom only; real button-activation semantics are not
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
