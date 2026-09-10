---
status: testing
phase: 01-the-board-is-the-store-of-record
source: [01-VERIFICATION.md, 01-19-SUMMARY.md, 01-20-SUMMARY.md, 01-21-SUMMARY.md]
started: 2026-09-10T08:02:21Z
updated: 2026-09-10T08:02:21Z
---

## Current Test

number: 1
name: Live `tauri dev` walkthrough of the G-01-4 focus pipeline and the CR-01 collapse property
expected: |
  On the real seeded 1,067-item / 13-epic THRE board: scroll deep, then ⌘N lands the cursor in
  the quick-add input with no extra click and no Tab. ⌘⇧N does the same for an epic. A re-press
  returns focus after clicking elsewhere. A collapsed Backlog band expands and takes focus. The
  detail panel refuses all three bindings without scrolling. No visual jank during any of it.

  Then, the CR-01 property this round closed: with quick-add open, click the Backlog band header.
  It collapses and STAYS collapsed — it must not spring back open on the next render, nor when you
  interact with another band, scroll, or switch to another project and return.
awaiting: user response

## Tests

### 1. Live walkthrough of the G-01-4 focus pipeline and the CR-01 collapse property
expected: Every step completes exactly as the automated suite proves it does under jsdom — no perceptible lag, no visual jank, cursor lands in the input without an extra click or Tab, and a manual Backlog collapse click sticks (including across a project round-trip).
result: [pending]

### 2. Perceived responsiveness at 1,000+ items, after three rounds of render-path change
expected: Reorder, filter, search, and switch projects with the mouse untouched, on the real seeded board, including with quick-add open. No perceptible lag or visual jank at volume. The expected direction is strictly better than the pre-01-21 code, since CR-01's fix removes a self-sustaining render-path write rather than merely retiming it.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

## Notes

This file supersedes the previous UAT round (4 tests, `status: complete`, closed 2026-09-10T14:45:00Z),
which is preserved in git history. It is re-opened for two reasons, both raised by the phase verifier:

- **Test 1 was never run.** 01-20-PLAN.md Task 3's live walkthrough is still owed by every prior
  session. This round adds the CR-01 collapse property to it, since that property has only ever been
  proven under jsdom.
- **Test 2's prior `pass` is not propagated.** The previous file was already internally inconsistent
  on this point — the test-2 entry read `pass` while its own `note:` field said the check "stays
  pending" — and `BoardView.tsx`'s render-path effects have changed twice since it was recorded
  (01-19/01-20, then 01-21's CR-01 fix and its per-project-Set follow-up). A stale pass over changed
  code is not evidence, so a fresh owner confirmation is required.

Everything else in Phase 1 is verified automatically: 22/22 must-haves, 15/15 requirement IDs.
See `01-VERIFICATION.md`.
