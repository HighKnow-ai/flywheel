---
phase: 05-socratic-epic-authoring
plan: 26
subsystem: testing
tags: [uat, socratic-authoring, instrument-hardening, gap-closure, documentation, ledger, requirements-honesty]

requires:
  - phase: 05-socratic-epic-authoring (plans 05-23, 05-24, 05-25)
    provides: the closed CR-01 gating-window defect, the named backend-refusal failure class, the
      single-capture transcript (NF-01 closed), and the WR-04 idle-window closure — the four
      findings this plan documents and ledgers, none of which it re-implements or re-verifies at
      the code level
provides:
  - "scripts/uat/README.md Item 8: a fourth finding naming gap G-05-3 (the CR-01 window read the
    wrong direction, the backend refusal masquerading as agent text, the idle window concluding
    mid-tool-call, and the quieter NF-01 double-capture), and the offline-provability rule
    sharpened with the same-code-path/same-order/same-inputs clause and its practical consequence
    (a fixture that cannot express a condition is itself the gap)"
  - "the --replay-check bullet in Item 8 now names all seven scenarios and what each proves"
  - "05-VALIDATION.md: a ledger row for every one of the nine tasks in this closure (05-23-01
    through 05-26-02), each naming a command that was actually run and observed passing; the two
    SHAPE-01/SHAPE-03 manual-only rows rewritten to say what is fixed and what is still genuinely
    outstanding; the red 05-22-03 row kept red with a forward pointer to where its defect was
    closed"
  - "05-22-SUMMARY.md: a dated, appended correction resolving the 'should be filed' claim honestly
    — the defect was closed in plan 05-24, no todo was ever filed, and none should be"
  - "REQUIREMENTS.md: SHAPE-02/SHAPE-04/SHAPE-05 restored to Complete; SHAPE-01/SHAPE-03
    deliberately left at Gaps Found with an honest annotation, since this plan's own text states
    their live judgement remains outstanding and this repository has already reverted a premature
    Complete mark for this exact requirement set twice"
affects: [phase-06-agent-authored-backlog, any-future-live-uat-08-run]

actuals:
  tokens: 5900
  tasks: 2
  commits: 2
plan_head_before: 98ff314dc71eb3edb018f05efe65fb98197569ac

tech-stack:
  added: []
  patterns:
    - "A documentation/ledger closure that inherits a bundle of requirement IDs from its sibling
      plans must not let a generic ready-ids sweep flip a requirement Complete when the plan's own
      text names that requirement's live-judgement half as still outstanding — the ledger's own
      honesty discipline (no row turns green on a run that did not happen) applies equally to
      REQUIREMENTS.md's checkboxes."

key-files:
  created: []
  modified:
    - scripts/uat/README.md
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
    - .planning/phases/05-socratic-epic-authoring/05-22-SUMMARY.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The offline-provability rule (Item 8) was sharpened, not replaced: an offline arm only proves
    a property if it exercises the SAME code path, in the same order, with the same inputs the live
    arm hits. Three concrete failure shapes are named (a reading asserted before the failure mode
    can exist; an offline arm assembling its own version of an artefact the live arm assembles
    differently; a property no fixture can express at all), plus the practical consequence: when a
    fixture cannot express a condition, the fixture is the gap."
  - "REQUIREMENTS.md: SHAPE-01 and SHAPE-03 were NOT flipped to Complete despite
    `requirements.ready-ids` reporting all five SHAPE requirements ready (no sibling plan blocks
    them). This plan's own <outstanding_after_this_closure> section states their live judgement
    remains OUTSTANDING, and REQUIREMENTS.md has already been bulk-reverted from a premature
    Complete mark for this exact requirement set twice in this phase's history. SHAPE-02/04/05
    carry no such caveat and were restored to Complete."
  - "The literal `<verify>` grep for the 'not executed by an autonomous' sentence
    (`grep -c 'not executed by an autonomous'`) is case-sensitive against text that reads 'Not
    executed...' (capital N, unedited by this or any prior plan — confirmed via `git show HEAD`
    before this plan's own edits). The semantic requirement (sentence present, unedited) is
    satisfied; the literal command's case mismatch predates this plan and was not introduced by it."

requirements-completed: [SHAPE-02, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "Item 8 documents the fourth finding (gap G-05-3) in the existing style, sharpens the offline-provability rule with the same-code-path clause, and names all seven --replay-check scenarios with what each proves — while every earlier finding, the token-cost warning, and the synthetic-transcript-cannot-hold-a-verdict sentence survive unedited"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "test \"$(grep -c '^### Item 8' scripts/uat/README.md)\" = \"1\""
        status: pass
      - kind: other
        ref: "test \"$(grep -c 'G-05-3' scripts/uat/README.md)\" -ge \"1\""
        status: pass
      - kind: other
        ref: "for s in truncation-repro settles-after-answers never-settles stages-work-during-challenge proposes-work-after-advance backend-refuses-mid-conversation slow-tool-mid-turn; do grep -q \"$s\" scripts/uat/README.md || exit 1; done"
        status: pass
      - kind: other
        ref: "git diff --quiet -- scripts/uat/lib scripts/uat/uat-08-socratic-authoring.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "05-VALIDATION.md carries a row for every task in this closure, each naming a command that was run and observed; the manual-only rows say what is fixed and what is not; the 05-22-03 row stays red with a forward pointer; 05-22-SUMMARY.md's appended correction names where the safety-classifier defect was actually closed and states no todo was filed and why, without rewriting the original prose"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "for id in 05-23-01 05-23-02 05-23-03 05-24-01 05-24-02 05-25-01 05-25-02 05-26-01 05-26-02; do grep -q \"$id\" .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md || exit 1; done"
        status: pass
      - kind: other
        ref: "test \"$(ls -1 .planning/todos/pending/ | wc -l | tr -d ' ')\" = \"1\""
        status: pass
      - kind: other
        ref: "git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md"
        status: pass
      - kind: other
        ref: "test \"$(grep -c '05-24' .planning/phases/05-socratic-epic-authoring/05-22-SUMMARY.md)\" -ge \"1\""
        status: pass
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (7/7 scenarios)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false
  - id: D3
    description: "REQUIREMENTS.md reflects the true state honestly: SHAPE-02/04/05 restored to Complete (never in question), SHAPE-01/SHAPE-03 deliberately left Gaps Found with the live-judgement caveat this plan's own text names"
    requirement: "SHAPE-01"
    verification: []
    human_judgment: true
    rationale: "Whether SHAPE-01/SHAPE-03 should stay Gaps Found rather than Complete is itself a judgment call this executor made by reading the plan's own <outstanding_after_this_closure> section against the repository's prior bulk-revert history — not something an exit code proves. A developer reviewing REQUIREMENTS.md should confirm this reading is the one they want before the eventual live run closes SHAPE-01/SHAPE-03 for real."

duration: 35min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 26: G-05-3 — The Fourth Finding, the Sharpened Rule, and an Honest Ledger Summary

**Documented gap G-05-3's fourth finding and sharpened Item 8's offline-provability rule with a same-code-path clause, ledgered all nine tasks across plans 05-23 through 05-26 with commands actually run and observed, resolved 05-22-SUMMARY.md's stale "should be filed" claim with a dated correction naming where the defect was really closed, and kept REQUIREMENTS.md honest by leaving SHAPE-01/SHAPE-03 at Gaps Found rather than letting a generic ready-ids sweep flip them Complete on the strength of instrument work that explicitly does not resolve their live judgement.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-24T (Task 1 commit `9c4e2f9`)
- **Completed:** 2026-09-24T12:05:54Z
- **Tasks:** 2 (Task 1: auto — docs; Task 2: auto — ledger + correction)
- **Files modified:** 4 (`scripts/uat/README.md`, `05-VALIDATION.md`, `05-22-SUMMARY.md`, `REQUIREMENTS.md`)

## Accomplishments

- **The fourth finding is recorded against gap `G-05-3`.** Item 8 now names, in the same style as the three earlier findings: the CR-01 gating window reading `violated` on essentially every successful run (the previous closure's fix for the opposite defect over-corrected); the backend-level safety-classifier refusal masquerading as ordinary agent text; the idle window concluding a turn while a tool call was still outstanding; and the quieter NF-01 double-capture of the live arm's own first turn.
- **The offline-provability rule is sharpened, not replaced.** Extended in place with the clause this closure paid for — an offline arm only proves a property if it exercises the SAME code path, in the same order, with the same inputs the live arm hits — plus the three concrete failure shapes this closure found (a reading asserted before the failure mode can exist; an offline arm assembling its own version of an artefact the live arm assembles differently; a property no fixture could express at all) and the practical consequence (a fixture that cannot express a condition is itself the gap, to be extended rather than accepted as live-only).
- **All seven `--replay-check` scenarios are named with what each proves.** `truncation-repro`, `settles-after-answers`, `never-settles`, `stages-work-during-challenge`, `proposes-work-after-advance`, `backend-refuses-mid-conversation`, `slow-tool-mid-turn` — a reader can now tell from the README alone which properties the offline arms already cover.
- **Every earlier finding, the token-cost warning, and the synthetic-transcript sentence survive unedited.** Confirmed by direct diff inspection: the three prior findings (`G-05-1` x2, `G-05-2`), the "Not executed by an autonomous CI/executor run" sentence, and "structurally cannot hold a verdict line" are all present, byte-identical to before.
- **The ledger carries a row for all nine tasks in this closure.** `05-23-01` through `05-26-02`, each naming a command actually run this session and observed passing — every command named was executed from the repository root immediately before its row was written, none forecast.
- **The manual-only rows say what's fixed and what's not.** Both SHAPE-01/SHAPE-03 rows now name the four structural fixes (bounded gating window, named backend-refusal class, single-capture transcript, no idle truncation) and state plainly what has NOT changed: no completed post-fix live run exists, this closure spent no credentials by design, and both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain unfilled.
- **The red `05-22-03` row stays red.** Gained one forward-pointer sentence naming plan `05-24` as where its defect was closed and the `backend-refuses-mid-conversation` scenario that proves it offline — the status marker itself did not move, preserving the only record of the fourth failure class being found the expensive way.
- **The stale "should be filed" claim in `05-22-SUMMARY.md` is resolved honestly.** A dated, appended correction block states the safety-classifier defect was closed in plan `05-24`, not filed — no todo was ever created, and none should be now, since a pending todo for an already-closed defect is noise a future reader would have to disprove. The original prose above the correction is untouched. The one file genuinely in `.planning/todos/pending/` (the pre-existing, unrelated adapter-drops-text finding) is named so it isn't mistaken for this one.
- **REQUIREMENTS.md reflects the true state, not a generic sweep's optimistic default.** `requirements.ready-ids` reported all five SHAPE requirements ready to mark (no sibling plan blocks any of them) — but this plan's own `<outstanding_after_this_closure>` section states SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain genuinely OUTSTANDING, and this exact requirement bundle has already been reverted from a premature Complete mark twice in this phase's git history (`f1f6882`, `670cff9`). SHAPE-02/SHAPE-04/SHAPE-05 carry no such caveat and were restored to Complete; SHAPE-01/SHAPE-03 were deliberately left at Gaps Found with an honest annotation naming what's fixed and what remains UNJUDGED.
- **Nothing in this closure touched the live arm.** No `claude` CLI invocation of any kind — not even an ad-hoc sanity check — and `05-LIVE-CHALLENGE-TRANSCRIPT.md` is confirmed byte-identical to its committed state throughout (`git diff --quiet` on the file, checked after both tasks).

## Task Commits

1. **Task 1: The fourth finding and the sharpened rule, recorded where the next author of a live script will read them** — `9c4e2f9` (docs)
2. **Task 2: The ledger carries a row per task in this closure, and the record stops claiming a filing that never happened** — `424df16` (docs)

**Plan metadata:** this SUMMARY's own commit (pending)

_Note: both tasks were `type="auto"`, no `tdd="true"` — this is a documentation/ledger closure plan; the TDD RED/GREEN/REFACTOR procedure does not apply, per this plan's own execution context._

## Files Created/Modified

- `scripts/uat/README.md` — Item 8's fourth finding (`G-05-3`), the sharpened offline-provability rule, and the seven-scenario `--replay-check` bullet (Task 1)
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — nine new ledger rows, the two rewritten manual-only rows, the `05-22-03` forward pointer (Task 2)
- `.planning/phases/05-socratic-epic-authoring/05-22-SUMMARY.md` — the dated, appended correction resolving the stale "should be filed" claim (Task 2)
- `.planning/REQUIREMENTS.md` — SHAPE-02/04/05 restored to Complete; SHAPE-01/SHAPE-03 deliberately left at Gaps Found with an honest annotation (standard executor `update_requirements` step, informed by this plan's own outstanding-work section)

## Decisions Made

See `key-decisions` in the frontmatter. Summarizing the load-bearing one: `requirements.ready-ids` reported all five SHAPE requirements ready to mark Complete (no sibling plan in this phase blocks any of them), but this plan's own text is explicit that SHAPE-01/SHAPE-03's live judgement remains outstanding — so the standard mark-complete sweep was overridden for those two specifically, restoring only SHAPE-02/04/05. This mirrors, at the requirements-ledger level, the exact discipline this whole plan documents at the UAT-instrument-ledger level: no row turns green on the strength of a run that did not happen.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] REQUIREMENTS.md's SHAPE-01/SHAPE-03 rows corrected after the standard mark-complete step overshot**

- **Found during:** the standard post-task `update_requirements` executor step (not one of this plan's own two tasks)
- **Issue:** Running the standard `requirements.mark-complete` sweep (as `requirements.ready-ids` reported all five SHAPE requirements ready, since no sibling plan in this phase blocks any of them) flipped SHAPE-01 through SHAPE-05 all to Complete. This directly contradicts this plan's own `<outstanding_after_this_closure>` section, which states SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain genuinely OUTSTANDING and that "nothing here pre-empts" the developer's own credential-spend decision. It would also have repeated a mistake this repository's own git history shows was already made and reverted twice for this exact requirement bundle (commits `f1f6882`, `670cff9`, both titled "revert premature Complete requirements after gaps found").
- **Fix:** Reverted SHAPE-01 and SHAPE-03 specifically back to unchecked/`Gaps Found`, with an inline annotation naming what is now fixed (the instrument) and what remains outstanding (the live judgement, tracked in `05-LIVE-CHALLENGE-TRANSCRIPT.md`). Left SHAPE-02/SHAPE-04/SHAPE-05 at Complete, since this plan's text names no caveat for them and their underlying evidence (accept_subtree, tray, reopen-epic tests) was never in question.
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** `git diff` reviewed line-by-line before and after the fix; confirmed the checkbox list and the traceability table both now read consistently (SHAPE-01/03 `Gaps Found` with annotation, SHAPE-02/04/05 `Complete`).
- **Committed in:** the final metadata commit (this plan carries no separate code commit for a REQUIREMENTS.md-only correction — it is closing-metadata bookkeeping, not a task deliverable).

---

**Total deviations:** 1 auto-fixed (1 missing-critical — a false-positive requirements completion that would have contradicted this plan's own explicit text and repeated a documented prior mistake).
**Impact on plan:** Necessary to keep REQUIREMENTS.md honest and consistent with this plan's own stated scope. No scope creep — the fix is confined to the requirements ledger and does not touch any of this plan's two declared task files.

## Issues Encountered

**One literal `<verify>` command in this plan's own Task 1 has a pre-existing case-sensitivity mismatch.** `test "$(grep -c 'not executed by an autonomous' scripts/uat/README.md)" -ge "1"` is case-sensitive against a sentence that reads "**N**ot executed by an autonomous CI/executor run" (capital N, since it opens a new clause). Confirmed via `git show HEAD:scripts/uat/README.md` that this capitalization predates this plan's own edits — it is not something Task 1's edit introduced, and the sentence was left genuinely unedited as the task's own acceptance criteria require. The semantic requirement (the sentence survives, unedited) is fully satisfied; a case-insensitive re-run of the same grep (`grep -ic`) confirms it. This is a latent typo in the plan text's own literal command, not a defect in the implementation, and is recorded here rather than silently worked around.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **G-05-3 is closed at the documentation/ledger level**, joining `G-05-1` and `G-05-2` as fully recorded and offline-provable. The instrument (`scripts/uat/uat-08-socratic-authoring.mjs` and its `lib/` support) has no known way left to misread a gating window, misattribute a backend refusal, duplicate a turn, or truncate a capture on a slow tool.
- **SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain genuinely OUTSTANDING**, exactly as this plan's own `<outstanding_after_this_closure>` section states, and REQUIREMENTS.md now says so honestly rather than optimistically. Both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` stay `UNJUDGED`. No offline arm can close them — only a real model's pushback on a real premise, read by the developer, can.
- **This closure spent nothing.** No live arm was run, no `claude` CLI was invoked for any reason (including ad-hoc checks), and the live transcript file is confirmed byte-identical to its committed state throughout. The credential-spend decision for the next live run remains the developer's own, exactly as plan `05-22` Task 2 established — not a precondition for anything in this closure, and nothing here pre-empts it.
- The next live `uat-08` run, whenever authorised, is the first one this whole gap-closure lineage (`G-05-1` through `G-05-3`) can say has no known instrument-side reason left to fail before producing a genuinely judgeable transcript.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `scripts/uat/README.md`
- FOUND: `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md`
- FOUND: `.planning/phases/05-socratic-epic-authoring/05-22-SUMMARY.md`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: commit `9c4e2f9` (Task 1)
- FOUND: commit `424df16` (Task 2)
- Plan-level `<verification>` re-run: Item 8 has exactly one `### Item 8` heading, names `G-05-3` and all seven replay scenarios, and the sharpened rule; `05-VALIDATION.md` carries all nine ledger rows for this closure; `05-LIVE-CHALLENGE-TRANSCRIPT.md` unchanged with both verdict lines still `UNJUDGED`; `.planning/todos/pending/` holds exactly one (pre-existing, unrelated) file; `--self-test` exit 0, `--replay-check` 7/7 PASS, `--board-read-check` exit 0, `git diff --quiet -- packages/` clean — all pass.
