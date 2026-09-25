---
phase: 05-socratic-epic-authoring
plan: 31
subsystem: testing
tags: [uat-harness, correlation-id, mutation-testing, gap-closure, tdd]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: ToolCallEvent.toolUseId/ToolResultEvent.toolUseId, correlateProposeAttempts (id lookup), correlateProposeAttemptsPositionally (frozen control), interleaved-read-during-proposal scenario (plan 05-30)
provides:
  - "A six-check self-test battery ([Plan 05-31, Task 1] Checks A-F) asserting all three shapes G-05-5's defect class can take — interleaved (both directions), back-to-back-under-ids (pairing by identity, order-independent), and id-less (fully absent and partial) — each against the frozen positional control over the identical event array"
  - "proposal-without-correlation-ids — the tenth --replay-check scenario, proving the absent-id decision end to end through the real sidecar and the real shipped normaliser: an id-less tool_use/tool_result pair produces events with no correlation key at all, readNoWorkPlanned reads uncorrelatable, and SHAPE-01 does not pass"
  - "scripts/uat/README.md Item 8's sixth finding, a fourth block-quoted rule (fix the seam, not the instrument, when an instrument reconstructs a fact the product already carries), the one-frozen-control rule, a mutation-test-discipline note, and the scenario list updated from eight to ten"
affects: [05-socratic-epic-authoring/05-32]

# Actuals (#2632)
actuals:
  tokens: 7909
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every self-test check asserts the shipped reading AND the frozen positional control's reading over the identical array, never the shipped reading alone — a mutation test must prove the fix is CORRECT on every shape, not merely that it changed something"
    - "Pairing correctness asserted by IDENTITY (the answer event's own correlation field equals the attempt's own toolUseId), not merely by two answerIndex values differing"
    - "Key-presence checks on live event objects (Object.prototype.hasOwnProperty.call) for an adapter's honest absence, never a comparison against undefined"

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/README.md

key-decisions:
  - "Check A duplicates 05-30's own side-by-side positional-control check (same fixture, same shipped/positional readings), tagged under this round's own [Plan 05-31, Task 1] battery — deliberate: the round-7 battery must be self-contained and grep-discoverable as covering all three shapes without depending on scattered pre-existing checks (the plan's own must_haves.truths #1)."
  - "Checks C/D assert the shipped and positional readings are EQUAL (both 'violated' on a clean back-to-back-under-ids shape), not merely a differ-or-not relationship — the claiming-based positional control correctly handles this particular shape too; the identity assertion (answerIndex's event carries the attempt's own toolUseId), not disagreement with the control, is what proves this shape's pairing correctness."
  - "requirements.ready-ids confirmed 0/2 (SHAPE-01, SHAPE-03) ready to mark complete before this plan even started — sibling plans in this phase still declare the same IDs without a SUMMARY — so the update_requirements step was skipped entirely rather than invoked and trusted to no-op, honoring this plan's own explicit prohibition redundantly with the shared-ID gate."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A six-check self-test battery proving all three shapes G-05-5's defect class can take (interleaved in both directions, back-to-back-under-ids with identity-asserted pairing, and id-less both fully and partially), each check asserting the shipped reading side by side with the frozen positional control"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (Checks A-F, tagged [Plan 05-31, Task 1])"
        status: pass
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test | grep -c 'Plan 05-31, Task 1' -> 6"
        status: pass
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test | grep -c '^\\[self-test\\] PASS' -> 86 (> 81 at commit 47c10a0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A backend supplying no correlation ids at all makes the run degrade honestly to uncorrelatable end to end, through the real sidecar and the real shipped normaliser — not merely asserted in a unit fixture"
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario proposal-without-correlation-ids"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (10/10 scenarios)"
        status: pass
      - kind: unit
        ref: "node -e checks SCENARIOS has exactly 10 keys including proposal-without-correlation-ids"
        status: pass
    human_judgment: false
  - id: D3
    description: "README Item 8 records the sixth finding (interleaved-read mechanism, both error directions, the review/verification severity disagreement, the six-round recurrence, the dropped wire fields, PermissionRequestEvent named as the pattern already in the codebase), a fourth rule, the one-frozen-control rule, a mutation-test-discipline note, and a ten-scenario list matching SCENARIOS' own keys"
    verification:
      - kind: other
        ref: "test \"$(grep -c '^### Item 8' scripts/uat/README.md)\" = \"1\""
        status: pass
      - kind: other
        ref: "node --input-type=module checking every SCENARIOS key appears in README.md"
        status: pass
      - kind: other
        ref: "git show --stat --name-only HEAD (Task 3's own commit touches scripts/uat/README.md alone)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No product code touched, no credential spent, no live claude run, the live transcript and 05-VALIDATION.md untouched"
    requirement: SHAPE-01
    verification:
      - kind: other
        ref: "git diff --quiet 47c10a0..HEAD -- packages/core packages/desktop"
        status: pass
      - kind: other
        ref: "git diff --quiet 47c10a0..HEAD -- .../05-LIVE-CHALLENGE-TRANSCRIPT.md"
        status: pass
    human_judgment: false

# Metrics
duration: 45min
completed: 2026-09-25
status: complete
---

# Phase 05 Plan 31: The whole defect class proven closed — three shapes, one frozen control, one recorded recurrence Summary

**A six-check self-test battery proving every shape G-05-5's correlation defect can take (interleaved both directions, back-to-back-under-ids by identity, and id-less both fully and partially) against the frozen positional control, a tenth `--replay-check` scenario proving the absent-id decision end to end, and README Item 8's sixth finding recording six consecutive rounds of the same defect class and the seam-not-instrument rule that ended it.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-25T07:10:00Z (approx)
- **Completed:** 2026-09-25T07:55:00Z
- **Tasks:** 3/3
- **Files modified:** 3 (uat-08-socratic-authoring.mjs, fake-authoring-claude.mjs, README.md)

## Accomplishments
- Six named checks ([Plan 05-31, Task 1] Checks A-F) each assert the shipped, id-based reading AND the frozen positional control's reading over the identical event array — proving the fix is CORRECT across every shape the wire can produce, not merely that it changed something (the property round 6's own mutation test was missing)
- Check A/B cover the interleaved-read shape in both directions (a genuine violation certified as a pass, and a genuine refusal masked); Check C/D re-prove the back-to-back-under-ids shape with pairing asserted by IDENTITY (the answer event's own correlation field equals the attempt's own `toolUseId`), not merely by two `answerIndex` values differing, and prove the reading is unchanged under mirrored wire arrival order
- Check E/F cover a fully id-less stream and a partial (one-id, one-absent) stream: every correlated entry reads `correlatable: false`/`answerIndex: null`, `readNoWorkPlanned` reads `uncorrelatable`, SHAPE-01 does not pass, and the frozen positional control still pairs the same events anyway — the old mechanism answers exactly where the new one abstains
- The self-test grows from 81 to 86 PASS lines; `--replay-check` stays 9/9 throughout Task 1
- A tenth `--replay-check` scenario, `proposal-without-correlation-ids`, drives a backend whose `tool_use`/`tool_result` blocks declare neither `id` nor `tool_use_id` through the real sidecar and the real shipped normaliser; the replay branch asserts, on live event objects, that the correlation key is absent by key-PRESENCE check (never a comparison against `undefined`), that the reading is `uncorrelatable`, that SHAPE-01's entry is `false` with `criterion1Challenged` held `true`, and that the frozen positional control reads something other than `uncorrelatable` over the same window — `--replay-check` now passes 10/10
- `scripts/uat/README.md` Item 8 carries the sixth finding (the interleaved-read mechanism, the read tools' pre-approval in every authoring stage, both error directions, the review's WR-02 severity call and the verification's disagreement with it, the six-consecutive-round recurrence, the dropped wire fields, and `PermissionRequestEvent` named as the pattern the codebase already had correct), a fourth block-quoted rule (fix the seam, not the instrument, when the instrument is reconstructing a fact the product already carries), the one-frozen-control rule, a mutation-test-discipline note, and the scenario list updated from eight to ten

## Task Commits

Each task was committed atomically:

1. **Task 1: The three-shape battery — interleaved, back-to-back and id-less, each against the frozen positional control** - `6eba790` (test)
2. **Task 2: Honest degradation proven end to end** - `c35c22c` (test)
3. **Task 3: The sixth finding — six rounds, one function, and the fence that was keeping them there** - `529ecce` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified
- `scripts/uat/uat-08-socratic-authoring.mjs` - six-check `[Plan 05-31, Task 1]` battery in the self-test region; a `proposal-without-correlation-ids` dispatch branch in `runReplayCheckScenario`
- `scripts/uat/lib/fake-authoring-claude.mjs` - `proposal-without-correlation-ids`, the tenth scenario: a `tool_use` block with no `id` and a `tool_result` block with no `tool_use_id`, one turn, settles immediately
- `scripts/uat/README.md` - Item 8's sixth finding, fourth rule, one-frozen-control rule, mutation-test-discipline note, ten-scenario list

## Decisions Made
- Check A deliberately duplicates 05-30's own side-by-side positional-control check (identical fixture and readings) under this round's own `[Plan 05-31, Task 1]` tag, so the round-7 battery is self-contained and grep-discoverable as covering all three shapes without a reader having to trust scattered pre-existing checks were still there.
- Checks C and D assert the shipped and positional readings are EQUAL (both correctly read `violated` on a clean back-to-back-under-ids shape) rather than forcing a "must differ" assertion that would not hold on this shape — the claiming-based positional control genuinely handles back-to-back-under-ids correctly; the identity assertion is what proves the pairing, not disagreement with the control.
- `requirements.ready-ids` was checked before touching `REQUIREMENTS.md` at all and returned `0/2` ready (SHAPE-01, SHAPE-03) — sibling plans in this phase still declare the same IDs without a SUMMARY — so the `update_requirements` step was skipped entirely, honoring this plan's own explicit prohibition redundantly with the shared-ID gate rather than trusting the gate alone to no-op it.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria and `<verify>` commands passed on first execution; no auto-fixes, no architectural questions, no auth gates.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 05-32 (the validation ledger). SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain UNJUDGED per this plan's explicit prohibition — no live run happened, both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` are untouched, `05-VALIDATION.md`'s existing rows (including the red `05-22-03` row) are untouched, and `.planning/REQUIREMENTS.md`'s SHAPE-01/SHAPE-03 checkboxes remain unchecked (confirmed both by this plan's own prohibition and independently by `requirements.ready-ids` returning 0/2 ready, since sibling plans in this phase still declare the same IDs). The defect class this six-round saga tracked is now closed at the seam (plan 05-30) and proven exhaustively across every shape the wire can produce (this plan) — a seventh instance of the SAME mechanism has nowhere left to hide, though the live dialogue-quality judgement itself is a separate, still-open question this plan does not address.

## Self-Check: PASSED

- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND: scripts/uat/lib/fake-authoring-claude.mjs
- FOUND: scripts/uat/README.md
- FOUND commit 6eba790 (Task 1)
- FOUND commit c35c22c (Task 2)
- FOUND commit 529ecce (Task 3)
- Plan-level `<verification>` re-run: `--self-test` (86 PASS, 0 FAIL, exit 0), `--replay-check` (10/10 PASS, exit 0), `--replay-check --scenario proposal-without-correlation-ids` (PASS, reads `uncorrelatable`, exit 0), Item 8 scenario list checked programmatically against `SCENARIOS`' own keys (all 10 documented), `git diff --quiet 47c10a0..HEAD -- packages/core packages/desktop` (clean), `git diff --quiet 47c10a0..HEAD -- .../05-LIVE-CHALLENGE-TRANSCRIPT.md` (clean), `git diff --stat 47c10a0..HEAD -- .../05-VALIDATION.md` (empty — untouched)

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*
