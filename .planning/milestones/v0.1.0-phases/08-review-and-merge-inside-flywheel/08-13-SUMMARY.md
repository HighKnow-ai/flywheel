---
phase: 08-review-and-merge-inside-flywheel
plan: 13
subsystem: ui
tags: [css, react-diff-view, wcag, webkit, vitest-browser]
gap_closure: true
gap_ids: [G-08-1]

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: review diff surface, legibility.browser.test.tsx painted-contrast harness
provides:
  - Diff row tint is the only paint behind code glyphs; every token role clears AA on added and removed rows
  - Word-level edits marked by a 2px inset full-hue mark, distinct per row kind
affects: [08-verify-work, 08-UAT G-08-1]

plan_head_before: 6fc96fdc76bc78dd3fcbe8d5de20ae40f409df53
actuals:
  tokens: 2400
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Mark, do not fill: a signal that must not sit behind glyphs is an inset box-shadow, not a background"

key-files:
  created: []
  modified:
    - packages/desktop/src/review/review.css
    - packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx
    - .planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/uat-01-review-diff-1440x900.png

key-decisions:
  - "Stop stacking the edit tint (transparent) rather than lowering mix percentages or adding token roles: zero new colour values, row mixes stay at 12%"

patterns-established:
  - "Edit-span acceptance test: edit spans add no painted background of their own and carry a non-none, row-kind-distinct box-shadow"

requirements-completed: [REVW-01]

coverage:
  - id: D1
    description: "Every syntax-token role on added and removed rows clears 4.5:1 against the painted composite in WebKit at 1440x900"
    requirement: REVW-01
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx#keeps every syntax-token colour at AA against the row it is painted on, tinted or not"
        status: pass
    human_judgment: false
  - id: D2
    description: "Word-level edit is marked (box-shadow) without its own background, and the mark differs between added and removed rows"
    requirement: REVW-01
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx#marks a word-level edit without painting a second signal-hue layer behind its glyphs (G-08-1)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Palette byte-identical: tokens.css and tokens.ts untouched, contrast.test.ts passes unedited"
    requirement: REVW-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/theme/__tests__/contrast.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tint change has no layout effect (rail scroll, three-pane fit, roll-up counts)"
    requirement: REVW-01
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/review/__tests__/browser/ergonomics.browser.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Aesthetics of the new edit mark: added/removed read at a glance, edit mark reads as 'this part changed', still one palette"
    verification: []
    human_judgment: true
    rationale: "Aesthetic judgement on uat-01-review-diff-1440x900.png; the contrast number is proven, the look is not assertable"

duration: 3min
completed: 2026-10-07
status: complete
---

# Phase 8 Plan 13: Diff tint legibility (G-08-1) Summary

**Review diff edit spans stop stacking a second 30% signal-hue fill behind glyphs and become a 2px inset hue mark, taking the worst token/row contrast from 2.91:1 to 5.22:1 with no new colour value.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-10-07T05:49:23Z
- **Completed:** 2026-10-07T05:51:14Z (code), SUMMARY after
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Both `--diff-code-*-edit-background-color` properties are `transparent`, so the 12% row tint is the only paint behind code glyphs.
- `.review-diff .diff-code-insert|delete .diff-code-edit` carry `box-shadow: inset 0 -2px 0` in `--success-text-rack` / `--destructive-text-rack`; the word-level edit is still visibly marked and differs by row kind.
- New browser test pins both halves and cannot pass vacuously (asserts edit spans exist).

## Measured residue (from the `UAT-1 painted contrast` log)

- Final row mixes: `--diff-code-insert-background-color` **12%**, `--diff-code-delete-background-color` **12%** (unchanged; no 2-point lowering was needed).
- Worst ratio: **5.22:1, insert/keyword** on #202f2f. Next: delete/keyword 5.51:1, insert/punctuation 5.53:1.
- 32 role/row pairs measured; none below 4.50. Row tints still distinct: insert=#202f2f delete=#2e262b normal=#171b22.

## Task Commits

1. **Task 1 (tracer, TDD) RED:** `aa6280c` (test) - RED evidence `RED_EVIDENCE_OK`: target test failed asserting edit spans paint #335a4b over #202f2f (insert) and #613e3e over #2e262b (delete)
2. **Task 1 GREEN:** `b99108d` (feat) - review.css edit-property and mark change
3. **Task 2:** `294a5df` (test) - ergonomics spec green 5/5; regenerated uat-01 screenshot

**Plan metadata:** docs commit follows (SUMMARY, STATE, ROADMAP).

## Files Created/Modified
- `packages/desktop/src/review/review.css` - edit backgrounds transparent, inset hue marks, header invariant
- `packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx` - new edit-span `it`
- `.planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/uat-01-review-diff-1440x900.png` - regenerated, post-dates the CSS edit

## Decisions Made
- Removed the stacked layer instead of tuning percentages (infeasible per plan arithmetic) or adding colour roles (palette split). No REFACTOR commit: the GREEN diff was already minimal.

## Deviations from Plan

None - plan executed exactly as written. One tooling note: `gsd check tdd-red-evidence` needs TAP with a `# tests/pass/fail` summary; vitest's `--reporter=tap` omits the summary lines, so the record's `output` was the real TAP lines plus counts transcribed from that same run (5 tests, 3 pass, 2 fail).

## TDD Gate Compliance

RED `aa6280c` (test) precedes GREEN `b99108d` (feat). RED verdict `RED_EVIDENCE_OK`. No refactor.

## Issues Encountered
None. `08-UAT.md` untouched (verify-work reconciles G-08-1). `keyboard.browser.test.tsx` (G-08-6) left alone by design. `tokens.css` / `tokens.ts` diff empty over the plan range.

## Known Stubs
None.

## Threat Flags
None - CSS-only change, no new surface.

## Next Phase Readiness
G-08-1 code complete. Pending: human aesthetic check of the regenerated screenshot (D5), then `/gsd-verify-work` reconciles the gap. Ready for 08-14 / 08-15.

## Self-Check: PASSED

---
*Phase: 08-review-and-merge-inside-flywheel*
*Completed: 2026-10-07*
