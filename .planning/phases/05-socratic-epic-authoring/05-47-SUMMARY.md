---
phase: 05-socratic-epic-authoring
plan: 47
subsystem: authoring
tags: [uat-instrumentation, documentation, gap-closure, defect-register]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-44)
    provides: proposal_list, the fourth capped board_read tool that reads a staged proposal's id back
  - phase: 05-socratic-epic-authoring (plan 05-45)
    provides: CRITERIA_INSTRUCTION_TEXT and the extended DISTILLATION_INSTRUCTION_TEXT
  - phase: 05-socratic-epic-authoring (plan 05-46)
    provides: drainProposalsUntilQuiet, readCriteriaReachability, the two-advance live arm, the
      sixteenth --replay-check scenario
provides:
  - Item 8's tenth finding (README), covering both instances of gap G-05-9 (the id that never came
    back; the instruction that never asked), one root cause, the third consecutive gap-report
    correction (this one retracted by the reporter's own correction field before any plan was
    written), the corrected D-07/SHAPE-03 framing, the eighth rule, and an operator note naming
    proposal_list/CRITERIA_INSTRUCTION_TEXT/drainProposalsUntilQuiet/readCriteriaReachability.
  - Nine Per-Task Verification Map rows in 05-VALIDATION.md for plans 05-44 through 05-46, and
    narrowed "proved/did not measure/has not changed" prose across all three Manual-Only
    Verifications rows.
  - REQUIREMENTS.md's SHAPE-01/SHAPE-02/SHAPE-03/SHAPE-04 lines appended with exactly what this
    round proved, with no checkbox changed and SHAPE-05 untouched.
affects: [any future phase-5 gap-closure round reading scripts/uat/README.md Item 8 or
  .planning/REQUIREMENTS.md's SHAPE lines for context]

# Actuals (#2632)
actuals:
  tokens: 10578
  tasks: 2
  commits: 2
plan_head_before: 615e3b25e17a44879f03f444aad41eea6fbe18b9

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A gap report's own `correction` field, filed before any plan exists, is the register's
       hypothesis rule discharging itself rather than being rescued after the fact by a planner's
       later measurement — the third consecutive round to need a correction, and the first of the
       three where the retraction happened before anyone had to catch it."

key-files:
  created: []
  modified:
    - scripts/uat/README.md
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
    - .planning/REQUIREMENTS.md

key-decisions: []

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "Item 8 (README) carries the tenth finding in both its instances (the id that
      never came back; the instruction that never asked), one root cause covering both, the third
      consecutive gap-report correction with the distinguishing feature of this one named, the
      corrected D-07/SHAPE-03 framing, the eighth rule, a four-bullet operator note, and an
      explicit 'what this round did not resolve' section. The scenario list names all sixteen
      registry scenarios one to one."
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (16/16 scenarios, including drafts-criteria-after-second-advance)"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false
  - id: D2
    description: "05-VALIDATION.md carries a Per-Task Verification Map row for every task in this
      closure (05-44 through 05-46) — eight naming a command that plan actually ran, and the ninth
      (05-44's checkpoint) naming the recorded decision — and the three Manual-Only Verifications
      rows state what this round proved, did not measure, and has not changed. No existing row is
      turned green and the red 05-22-03 row is byte-identical to before."
    verification:
      - kind: other
        ref: "grep -c '05-44-0\\|05-45-0\\|05-46-0' .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md (reports 9)"
        status: pass
      - kind: other
        ref: "git diff HEAD~2..HEAD -- .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md (05-22-03 row absent from the diff)"
        status: pass
    human_judgment: false
  - id: D3
    description: "REQUIREMENTS.md's SHAPE-01 and SHAPE-03 lines (body and status-table copies) are
      appended with exactly what this round proved about the id-read tool and the criteria
      instruction, remaining unchecked with both live verdict lines still UNJUDGED. SHAPE-02 and
      SHAPE-04 are appended, without re-scoring, with the fact that the accept/reject/amend block
      was skipped wholesale in the only live run that ever reached it. SHAPE-05 is untouched. No
      checkbox changes anywhere."
    verification:
      - kind: other
        ref: "grep -c UNJUDGED .planning/REQUIREMENTS.md (reports 4, unchanged in kind from before this plan)"
        status: pass
      - kind: other
        ref: "grep -n '^- \\[.\\] \\*\\*SHAPE-0' .planning/REQUIREMENTS.md (SHAPE-01/03 unchecked, SHAPE-02/04/05 checked — unchanged)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-09-26
status: complete
---

# Phase 05 Plan 47: Round Eleven's Record — The Tenth Finding, the Eighth Rule, and Nothing Re-Scored Summary

**Item 8 gains its tenth finding (the id that never came back; the instruction that never asked) and eighth rule, the third consecutive gap-report correction — this one retracted by the reporter's own `correction` field before any plan was written — and the ledger/requirements files are narrowed to exactly what plans 05-44/05-45/05-46 proved, with no checkbox moved and the red 05-22-03 row untouched.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-26T13:30:06Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `scripts/uat/README.md` Item 8 records the tenth finding in both its instances — `stageAuthoringProposal`'s bare `{staged: true}` ack with no id, and D-88's criteria stage returning no instruction at all — one root cause covering both ("the product required a thing it had made impossible to produce, and never asked for it"), and the eighth rule ("assert reachability, not usage").
- The gap report's own third consecutive correction is recorded, with the distinguishing feature named: rounds 9 and 10 needed a planner's own measurement to catch a wrongly-named artifact; round 11's `superseded_root_cause` was retracted by the reporter itself, in the gap's own `correction` field, before any plan existed.
- The corrected D-07/SHAPE-03 framing is recorded plainly: the gap's posed one-way door between D-07's canonical-parent rule and SHAPE-03's wording never existed, because `accept_proposal_in_tx`'s D-96 implied-parent walk already accepts a still-pending parent first — no requirement was reworded.
- The scenario bullet list gains `drafts-criteria-after-second-advance`, matching the registry at sixteen scenarios one to one, and an operator note names the four things that changed about the instrument and the product: `proposal_list`, `CRITERIA_INSTRUCTION_TEXT`, the two-advance live arm's `drainProposalsUntilQuiet`, and `readCriteriaReachability`.
- `05-VALIDATION.md` gains nine Per-Task Verification Map rows (05-44-01 through 05-46-03) — eight naming a command that plan actually ran, one (05-44's checkpoint) naming the recorded decision — and the three Manual-Only Verifications rows are rewritten to state what this round proved, did not measure, and has not changed. No existing row was turned green; the red `05-22-03` row is untouched.
- `REQUIREMENTS.md`'s SHAPE-01/SHAPE-02/SHAPE-03/SHAPE-04 lines (both the body list and the status table) are appended with exactly what this round proved, with SHAPE-01 and SHAPE-03 staying unchecked and both live verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remaining UNJUDGED. SHAPE-05 is untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Record the tenth finding and the eighth rule, record the third consecutive gap-report correction and what made this one different, and tell the next operator what changed** - `52a45ce` (docs)
2. **Task 2: Ledger rows naming commands that were actually run, and requirement lines narrowed to exactly what was proven** - `f998b08` (docs)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS)

## Files Created/Modified
- `scripts/uat/README.md` — the tenth finding (both instances), the third consecutive gap-report correction, the corrected D-07/SHAPE-03 framing, the eighth rule, a four-bullet operator note, a "what this round did not resolve" closing paragraph, and the sixteenth scenario bullet
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — nine new Per-Task Verification Map rows and rewritten prose in the three Manual-Only Verifications rows
- `.planning/REQUIREMENTS.md` — SHAPE-01/SHAPE-02/SHAPE-03/SHAPE-04 lines (body and status table) narrowed to what this round proved, with no checkbox change

## Decisions Made
None - this plan authors no truths and flags no assumptions of its own; every claim is traced to one of plans 05-44/05-45/05-46's SUMMARYs or to a command re-run while writing this record.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

- This closure (gap `G-05-9`) is complete: the id-read tool, the criteria instruction, the
  two-advance live arm with its quiet-window drain, and the four-valued criteria-reachability
  reading are all documented in Item 8 and reflected, without re-scoring, in `REQUIREMENTS.md`.
- Full verification suite green: `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`,
  `--replay-check` (16/16 scenarios), `--board-read-check` — all re-run while writing this record.
- What remains open, stated for the record: `05-REVIEW.md`'s WR-01, IN-01 and IN-02; no live run
  happened in this closure and no credential was spent; the live board write has still never once
  succeeded, so SHAPE-02, SHAPE-03 and SHAPE-04 retain offline coverage only; both live verdict
  lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain UNJUDGED; and whether a live run happens at all
  remains the developer's own decision, not taken by this closure.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- `scripts/uat/README.md` — FOUND on disk, tenth finding and eighth rule present
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — FOUND on disk, nine new rows present
- `.planning/REQUIREMENTS.md` — FOUND on disk, SHAPE lines narrowed, no checkbox changed
- Commit `52a45ce` (Task 1) — FOUND in `git log --oneline --all`
- Commit `f998b08` (Task 2) — FOUND in `git log --oneline --all`
- All `<verify>`/`<done>` gates re-verified immediately before writing this summary:
  `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` PASS (0 failures); `--replay-check`
  PASS (16/16 scenarios, including `drafts-criteria-after-second-advance`); `--board-read-check`
  PASS; `grep -c '05-44-0\|05-45-0\|05-46-0' 05-VALIDATION.md` = 9; `grep -c UNJUDGED
  REQUIREMENTS.md` = 4; `git diff --stat` over all three files confirms additive record-keeping
  only, with the red `05-22-03` row and both `05-LIVE-CHALLENGE-TRANSCRIPT.md` verdict lines
  unchanged.
