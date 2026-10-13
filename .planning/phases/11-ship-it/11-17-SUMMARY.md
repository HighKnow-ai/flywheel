---
phase: 11-ship-it
plan: 17
subsystem: finish-review-and-captures
tags: [impeccable-finish-reviewer, webkit, captures, app-shell, deferred-review, design-review]
requires: ["11-13", "11-14"]
provides:
  - nine independent finish-reviewer runs over regenerated captures, light and dark (D-REV-11, 12, 14, 15, 16, 17, 18, 19, 26)
  - a capture of the board mounted in the real app shell (`<App />` -> `AppShell`) and two captures that did not exist (the launch sheet's Review feedback section, the permission-rules table)
  - 11-FINISH-REVIEW.md: 61 rows, each with a severity, a disposition and its evidence, plus the reviewers' verbatim returns
  - eight fixes, each with a WebKit or jsdom assertion shown red first
affects: [11-18 (rows addressed to it), 11-21 (D-196 board filing), the owner (five decisions)]
actuals:
  tokens: 33600
  tasks: 3
  commits: 7
tech-stack:
  added: []
  patterns:
    - "an independent reviewer from a tool-limited executor: a fresh `claude -p --agent <registered agent>` per group, Read/Glob/Grep only, no session persistence"
    - "mount the real shell (`<App />` in a `#root` container) over a Tauri bridge that answers from the real-board export, so a capture is the app and not a page of components"
    - "a fixture that mirrors derived text takes it from the source data, and asserts the two are word for word"
key-files:
  created:
    - .planning/phases/11-ship-it/11-FINISH-REVIEW.md
  modified:
    - packages/desktop/src/board/__tests__/browser/board-group.browser.test.tsx
    - packages/desktop/src/board/__tests__/browser/states-group.browser.test.tsx
    - packages/desktop/src/review/__tests__/browser/review-group.browser.test.tsx
    - packages/desktop/src/review/__tests__/merge-sheet.test.tsx
    - packages/desktop/src/session/__tests__/browser/session-group.browser.test.tsx
    - packages/desktop/src/settings/__tests__/browser/admin-group.browser.test.tsx
    - packages/desktop/src/settings/__tests__/settings-surface.test.tsx
    - packages/desktop/src/settings/PermissionRulesTable.tsx
    - packages/desktop/src/projects/ProjectUnreachable.tsx
    - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
    - packages/desktop/src/review/MergeConfirmSheet.tsx
    - packages/desktop/src/App.css
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "The reviewers' findings were triaged by the plan's two scope rules: a finding that contradicts a deliberate contract choice is rejected with the sentence quoted; a finding outside this plan is recorded for D-196 or addressed to 11-18. Nothing was closed by assertion."
  - "The nine high findings were not fixed here. They are owner decisions or larger than a finish pass: no masthead and a split controls row in the shell, the review surface's pane order and file column, no +/- sign on the diff, the session header not naming its task, the proposal row's stacked kind label, the triage button wall, the rail's missing counts."
  - "The five files plan 11-18 owns (BoardRow, FeedRow, AssigneePicker, type.css, review.css) were not touched; 15 rows are addressed to it."
requirements-completed: [DIST-04]
coverage:
  - id: D1
    description: "The board is captured mounted inside the real app shell over a bridge answering from the real-board export, and compared against the approved comp by an independent reviewer (D-REV-12)."
    requirement: "DIST-04"
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/board/__tests__/browser/board-group.browser.test.tsx#board group one, mounted in the real app shell"
        status: pass
    human_judgment: false
  - id: D2
    description: "Nine reviewer runs exist over regenerated light and dark captures, and every one of 58 findings plus 3 coverage gaps carries a disposition and evidence (D-REV-11, 12, 14, 15, 16, 17, 18, 19, 26)."
    requirement: "DIST-04"
    verification:
      - kind: other
        ref: "grep -cE '^\\| (one|two|three|four|five|six|review-foot|app-shell)' .planning/phases/11-ship-it/11-FINISH-REVIEW.md  (70 rows; 61 dispositions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Eight fixed findings: epic distribution caption on one line, merge-sheet title unbroken inside branch names, unreachable path in mono, orphan consequence line above its choices, permission rules table (tool name title, revoke once, failure named), launch-sheet feedback fixture word for word."
    requirement: "DIST-04"
    verification:
      - kind: automated_ui
        ref: "npm --prefix packages/desktop run test:browser and test:browser:dark (15 files, 125 passed + 1 expected fail, each scheme)"
        status: pass
      - kind: unit
        ref: "npm --prefix packages/desktop test (87 files, 1454 passed + 2 expected fail)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The nine high findings and the design-direction questions inside the recorded rows (masthead, pane order, triage weight, rail counts) need an owner decision before they can be built."
    verification: []
    human_judgment: true
    rationale: "Each is a product or design-direction call the owner has not made (a Phase 8 layout reversal, a new surface, a contract amendment). These are decisions, not verification steps, so they are not deferred under the human-verification rule."
duration: ~30 min
completed: 2026-10-13
status: complete
commits: 7
plan_head_before: b4de2ec91d65ce10a09d35844c223e7d22d351a2
---

# Phase 11 Plan 17: Finish review, second pass Summary

**Nine independent finish-reviewer runs over regenerated captures all returned `fix`, not `ship`: 58 findings, of which 8 are fixed with assertions, 8 rejected with the contract sentence quoted and 45 recorded, nine of them high and all owner decisions or larger than this plan.**

## Performance

- **Duration:** ~30 min (wall clock, including nine reviewer runs of about a minute each)
- **Tasks:** 3 of 3
- **Commits:** 7 (measured from the persisted ledger, `plan_head_before` above)
- **Files:** 14 changed, +1253 / -25 lines (the review record is most of the added text)

## What was done

1. **Task 1, the board in the real shell (D-REV-12), commit 3d5ccfe.** `board-group.browser.test.tsx` now mounts `<App />` (which renders `AppShell`, not exported) in a `#root` container, because App.css gives `#root` the window's height and a bare test container would not, over a Tauri bridge that answers from the same real-board export the group capture uses. The two staged challenges reuse that file's `proposal()` helper and FIXTURE labelling; no second fixture. It asserts the masthead, filter bar, lens toggle, summary line and rack stack top-down, then writes `board-shell-built-{scheme}-1440x900`. The first attempt rendered at content height (a missing `#root`) and the second opened an epic below the virtualised fold; both were corrected before the capture was used.
2. **Task 2, regenerate and review, commits a451e19, 9d6042d, 3ed7237.** `test:browser` then `test:browser:dark` were run green and the Phase 08 UAT screenshots they overwrite were restored. Three captures were added because a group's truth named a surface that had none: the launch sheet's Review feedback section, and (after the group-five reviewer said it could not see it) the permission-rules table. Eight groups plus that follow-up were then reviewed. The record is `11-FINISH-REVIEW.md`.
3. **Task 3, fix what is material, commits dfe2cd5, e0d06e9, fbde010 (register).** Eight fixes, each shown red against the unfixed source first (the merge-sheet title is red only structurally, because the spans did not exist before the fix, and the capture addition has no red).

## How the reviewers were run (the thing to know before trusting the verdicts)

The executor has no Agent tool, so it could not spawn the reviewer as a subagent. Each run was a fresh `claude -p --agent impeccable:impeccable-finish-reviewer` process (claude 2.1.287), tools limited to Read, Glob and Grep, no session persistence, no shared context with the builder. That is the registered agent definition with its own system prompt and an independent context, which is what D-24 asks for; it is not an in-thread self-review. The reviewers judged the captures as they stood before this plan's fixes. No reviewer has seen the fixed groups.

## Outcome by register item

| id | group | result |
|----|-------|--------|
| D-REV-11 | one | `fix`, 8 findings: 1 fixed, 1 rejected, 6 recorded |
| D-REV-12 | app-shell | `fix`, 7 findings: the shell does not match the comp (no masthead or subhead, the lens toggle on its own band, a different summary line). 1 rejected, 6 recorded |
| D-REV-14 | two | `fix`, 8 findings: 2 rejected, 6 recorded |
| D-REV-15 | three | `fix`, 6 findings: 1 fixed, 5 recorded (3 high) |
| D-REV-16 | four | `fix`, 8 findings: 2 rejected, 6 recorded (1 high: the header never names its task) |
| D-REV-17 | five, five-rules | `fix` twice, 13 findings: 2 fixed, 2 rejected, 9 recorded (2 high) |
| D-REV-18 | six | `fix`, 5 findings: 2 fixed, 3 recorded |
| D-REV-19 | review-foot | RAN (it read NOT RUN), `fix`, 3 findings: 1 fixed, 2 recorded |
| D-REV-26 | all | RAN (it read NOT RUN) as nine runs; none returned `ship` |

Dispositions and evidence per finding are in `11-FINISH-REVIEW.md`; the register entries carry the same outcomes under `update_11-17`.

## Deviations from Plan

**1. [Rule 3 - Blocking] No Agent tool.** Task 2 said to spawn `impeccable-finish-reviewer` once per group. The executor's tools are Read, Write, Edit, Bash and Skill. Used `claude -p --agent` from Bash instead (above). Disclosed in the record and in the register.

**2. [Rule 2 - Missing critical coverage] Two captures were added that the plan did not list.** The launch sheet's Review feedback section (D-REV-19's truth names it and no capture showed it; commit a451e19, in `session-group.browser.test.tsx`) and the permission-rules table (the group-five reviewer reported both settings captures cut off before it; commit 9d6042d, in `admin-group.browser.test.tsx`). A follow-up reviewer run (`five-rules`) was added, so there are nine runs, not eight.

**3. [Rule 1 - Bug, found by a reviewer] Eight fixes outside the plan's file list**, all in surfaces the reviewers named: `PermissionRulesTable.tsx`, `ProjectUnreachable.tsx`, `OrphanRecoveryModal.tsx`, `MergeConfirmSheet.tsx`, `App.css`, one fixture. `merge-sheet.test.tsx` was updated because it matched the title on a single text node.

**4. One reviewer claim did not survive testing.** Group two said the path value's detached ellipsis comes from `text-align: left` on the right-to-left box. A scratch WebKit test (discarded) rendered the same button with `text-align` left, start, right and unset, and all four drew identically. The row is recorded (two-3) with that evidence, not fixed.

**5. One fix adapts the reviewer's remedy.** Group six asked for the unreachable path on its own line with reworded copy. The sentence is the Copywriting Contract's, word for word, so the path is its own mono span inside it and the sentence is unchanged (asserted).

**Total deviations:** 5 (1 blocking, 1 coverage, 1 reviewer-found fixes, 2 documented dispositions).

## Known Stubs

None. The captures' FIXTURE rows are labelled stand-ins that existed before this plan.

## Residual and honest limits

- **Nothing passed.** The reviewers returned `fix` on all nine runs. The fixed items are test-proven, not reviewer-approved, and no third pass was run. Nothing in Phase 8.1 may be described as passing an independent review after its fixes.
- **Three coverage gaps remain uncaptured, so unreviewed:** the raw log (D-REV-16), the epic request sheet (D-REV-15), the review foot's nothing-unchecked and no-criteria notes and could-not-send alert (D-REV-19).
- **Reviewer coverage was partial by its own account.** Every run's "not read" line is in the record; most did not read DESIGN.md or PRODUCT.md in full.
- **Fifteen rows are addressed to plan 11-18**, because they sit in its five files or are made moot by D-198/D-199. One is a warning: the developer's turn in the brand (`FeedRow.tsx:458`) is not covered by D-199's widened rule, so 11-18's enforcement test will flag it.
- **Thirty-five rows are listed for D-196 filing in plan 11-21**; five of them are owner decisions and should be filed as decisions.

## Threat Flags

None. Nothing here adds a network, auth or file surface. The permission-rules fix narrows one (a granted rule's full name stays readable, a revoke fires once). T-11-47 and T-11-48 are met: nine runs over regenerated captures with a grep-checked disposition on every row, and both scope rules applied (8 rejected with a quoted sentence, 45 recorded rather than silently fixed or dropped).

## Self-Check: PASSED

The review record, the four modified test files, `PermissionRulesTable.tsx`, the shell, feedback and rules captures all exist; commits 3d5ccfe, a451e19, dfe2cd5, 9d6042d, e0d06e9, 3ed7237 and fbde010 are present; none of BoardRow.tsx, FeedRow.tsx, AssigneePicker.tsx, type.css or review.css appears in the diff; the full jsdom suite (87 files, 1454 passed) and both browser configurations (15 files, 125 passed + 1 expected fail each) were green at the last code commit; the plan's three grep gates (70 group rows, nine register ids, 61 dispositions) pass.
