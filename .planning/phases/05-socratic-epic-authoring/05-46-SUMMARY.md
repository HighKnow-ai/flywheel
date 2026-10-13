---
phase: 05-socratic-epic-authoring
plan: 46
subsystem: authoring
tags: [uat-instrumentation, proposal-drain, stage-machine, reachability-reading, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-44)
    provides: proposal_list, the fourth capped board_read tool that reads a staged proposal's id back
  - phase: 05-socratic-epic-authoring (plan 05-45)
    provides: CRITERIA_INSTRUCTION_TEXT and the extended DISTILLATION_INSTRUCTION_TEXT, both
      returned by advance_stage as a StageInstruction
provides:
  - drainProposalsUntilQuiet — a watermark-driven, quiet-window proposal drain in
    uat-08-socratic-authoring.mjs, replacing the single-pass loop the file's own comment had always
    promised but never implemented (gap G-05-9's superseded_root_cause).
  - A live arm that walks D-88's whole three-stage machine (challenge -> decompose -> criteria),
    captures the reply to both stage instructions, and drains proposals after each stage window.
  - readCriteriaReachability — the four-valued reading (drafted | blocked | declined |
    not-attempted) the gap asked for by name, reusing correlateProposeAttempts verbatim, rendered
    into the evidence sheet beside the drafted-criteria count.
  - A sixteenth --replay-check scenario, drafts-criteria-after-second-advance, driving the
    two-advance shape through the REAL sidecar and REAL shipped normaliser offline, with an
    explicit statement of what it does NOT prove (no row reaches the board in this arm).
affects: [phase 05 plan 47 (README scenario-count record), any future plan touching the criteria
  stage's own live evidence or the proposal-drain mechanism]

# Actuals (#2632)
actuals:
  tokens: 16744
  tasks: 3
  commits: 3
plan_head_before: 8484a8d67d3426e62ec196154d1b10a20e3091dd

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A re-drain over a growing event array is watermark-driven (a plain integer cursor advanced
       past every index a scan pass examines), never built out of repeated waitForEvent calls —
       waitForEvent scans already-received events first, so a second call after the first match
       resolves instantly on the SAME already-applied event and never actually re-arms."
    - "A four-valued reachability reading distinguishes 'chose not to' from 'could not' by checking,
       in order, the caller's own materialised-row count first, then a refused attempt (via the
       EXISTING correlateProposeAttempts, never a second correlation mechanism), then a companion
       tool call (proposal_list) that proves the agent looked, before falling back to 'not
       attempted' — never inferred from a bare zero."
    - "An offline replay arm that cannot open a real MCP round trip computes its own 'drafted'
       reading from the wire's own tool_call/tool_result correlation, never from a board row (no
       apply-proposal-created, no list-pending) — stated explicitly in both the scenario's own doc
       comment and the replay body's per-scenario narration, so a reader cannot infer coverage the
       arm does not have."

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs

key-decisions:
  - "The advance-call-site and waitForTurn-call-site self-tests (both pre-existing, both scoped to
     the live body) needed their asserted counts raised from one to two, with updated rationale —
     the live body legitimately holds two of each now (one per D-88 stage transition). Both were
     updated in Task 2's own commit rather than left to drift red."
  - "The replay body's single advance-stage call site was kept literally singular in source by
     looping it over a per-scenario stageTargets array (default ['decompose'], unchanged for every
     pre-existing scenario) rather than adding a second, duplicated call site for the criteria
     advance."
  - "The new replay scenario's own 'drafted' reading is computed from a WIRE-ONLY signal (a
     correlatable, unrefused propose_criterion attempt) rather than from list-pending's row count —
     apply-proposal-created and list-pending are never called in that scenario's own criteria
     window, matching the plan's own Task 3(c) honesty bound that no row reaches the board in an
     offline arm with no real MCP round trip."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "The proposal drain implements the re-scanning quiet window its own comment always
      promised: two bursts of proposal_created events separated in time are both collected, each
      applied exactly once, and the drain reports whether it stopped quiet or on its deadline."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (drainProposalsUntilQuiet: two-burst, never-quiet-deadline, one-burst-no-duplicate)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The live body now advances D-88's stage machine TWICE (challenge -> decompose ->
      criteria), captures and records the reply to each instruction with the same
      LIVE_TURN_CEILING_MS/LIVE_TURN_IDLE_MS discipline, drains proposals after each window, and
      asserts no held request is starved after the second window either."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (advance-call-site count=2, both after the driver returns; waitForTurn call-site count=2)"
        status: pass
    human_judgment: true
    rationale: "This deliverable is a live-arm code path (challenge/decompose/criteria against a
      REAL backend). The self-test proves the source shape (call-site counts, ordering) offline;
      the plan's own prohibitions explicitly forbid running the live arm in this plan, so the
      actual live behaviour (does a real agent turn reply sensibly to the criteria instruction) is
      unproven this round and remains for a future live-verification round, exactly as 05-44 and
      05-45 both recorded for their own live-arm-adjacent changes."
  - id: D3
    description: "readCriteriaReachability distinguishes a criteria count of zero the agent CHOSE
      (declined, having read proposal_list) from one it structurally COULD NOT reach (blocked, a
      refused propose_criterion attempt) from one never attempted at all — reusing
      correlateProposeAttempts verbatim, never a second correlation mechanism. Rendered into the
      evidence sheet immediately beside the drafted-criteria count, with the criteria-stage drain's
      own stoppedBy value alongside it."
    requirement: "SHAPE-03"
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (readCriteriaReachability: drafted, blocked, declined, not-attempted, foreign-run isolation — five checks)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A sixteenth --replay-check scenario (drafts-criteria-after-second-advance) drives
      the two-advance shape through the REAL sidecar and REAL shipped normaliser offline: both
      instruction replies captured, the criteria-reachability reading reads 'drafted', the
      criteria-stage drain reports stoppedBy 'quiet', and the propose_criterion call names the SAME
      id proposal_list read back. The scenario's own doc comment and the replay narration both
      state plainly that no row reaches the board in this arm."
    requirement: "SHAPE-02"
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (16/16 scenarios pass, including drafts-criteria-after-second-advance)"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false

duration: ~70min
completed: 2026-09-26
status: complete
---

# Phase 05 Plan 46: Make The Instrument Able To Observe What 05-44/05-45 Made Possible Summary

**A watermark-driven proposal drain that actually implements its own long-promised comment, a live arm that now walks all three of D-88's stages, and a four-valued reachability reading that tells the developer WHY a criteria count reads zero — all proven offline, zero tokens spent.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `drainProposalsUntilQuiet` (new): a watermark-scanned, quiet-window re-drain over `sidecar.events`
  that applies every `proposal_created` event exactly once, across as many scan passes as it takes,
  replacing the single pass over `eventsOfType("proposal_created")` the file's own comment always
  described but the code never built. Reports `{ applied, passes, stoppedBy, nextIndex }` — `"quiet"`
  vs. `"deadline"` are narrated as two different facts about a run, never collapsed into one boolean.
- The live body now advances the stage a SECOND time (`decompose -> criteria`), relays the criteria
  instruction plan 05-45 shipped, captures its reply with the same discipline as the distillation
  capture, drains a second proposal window, and asserts no held request starved in the criteria
  stage — reaching the stage D-88 named for what plan 05-45 gave it, for the first time in this
  instrument's live arm.
- `readCriteriaReachability` (new): the four-valued signal gap G-05-9 asked for by name — `drafted`,
  `blocked`, `declined`, `not-attempted` — reusing `correlateProposeAttempts` verbatim (no second
  correlation mechanism, per the plan's own prohibition and the phase's six-round history of that
  exact mistake). Rendered into the evidence sheet immediately beside the drafted-criteria count,
  with the criteria-stage drain's own `stoppedBy` value alongside it.
- A new `--replay-check` scenario, `drafts-criteria-after-second-advance` (16th scenario), drives
  the whole two-advance shape offline: a clean challenge stage, a decompose-stage reply staging
  `propose_epic`/`propose_assumption` with real correlation ids, and a criteria-stage reply that
  reads a proposal id back via `proposal_list` before staging a `propose_criterion` call naming that
  same id — proving ordering, capture and correlation end to end through the REAL sidecar and REAL
  shipped normaliser, with an explicit, honest statement (in the scenario's own doc comment and the
  replay narration) that no row reaches the board in this arm.

## Task Commits

1. **Task 1: Make the proposal drain implement the window its own comment already promises** - `9487068` (feat)
2. **Task 2: Walk the whole stage machine in the live arm, and make a criteria count of zero say which kind of zero it is** - `98c64df` (feat)
3. **Task 3: A replay scenario that drives the two-advance shape offline, and an honest statement of what it cannot prove** - `b882f16` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `scripts/uat/uat-08-socratic-authoring.mjs` — `drainProposalsUntilQuiet`, `readCriteriaReachability`, the live body's second stage window, evidence-sheet fields (`criteriaReachabilityReading`/`criteriaDrainStoppedBy`), the replay body's `stageTargets`-driven advance loop, and the updated self-tests
- `scripts/uat/lib/fake-authoring-claude.mjs` — the new `drafts-criteria-after-second-advance` scenario and its own 26-character `readBackProposalId` fixture constant

## Decisions Made

See frontmatter `key-decisions` for the two stale-self-test updates and the replay scenario's own honesty-bound design (wire-derived "drafted" reading, never a board row).

## Deviations from Plan

None - plan executed exactly as written. The two self-test updates (advance-call-site count, waitForTurn call-site count) were anticipated by Task 2's own action text ("Update the advance-call-site check... Leave the pattern construction, the live-body scoping idiom and the driveChallengeConversation scan exactly as they are") rather than an unplanned discovery, so they are not logged as Rule 1/2/3 deviations.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

- The instrument can now observe everything plans 05-44 and 05-45 made possible: a live run that
  reaches the criteria stage, and a reading that names why a zero-criteria outcome happened.
- Full verification suite green: `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`
  (all checks including the new drain and reachability fixtures), `--replay-check` (16/16
  scenarios), `--board-read-check`, `cargo test --workspace` (unchanged, re-verified),
  `npm --prefix packages/sidecar test` (192/192).
- Per this plan's own prohibitions, the live arm was NOT run — SHAPE-03's live verdict line in
  `05-LIVE-CHALLENGE-TRANSCRIPT.md` remains for a future live-verification round.
- Plan 05-47 (which depends on this plan) can proceed with the exact numbers it needs without
  re-deriving them: the drain function is named `drainProposalsUntilQuiet`, the reachability
  reading function is named `readCriteriaReachability`, and `--replay-check` now runs **16**
  scenarios (was 15) — the README's own scenario count and Item 8 record are 05-47's to update,
  not touched here.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- `scripts/uat/uat-08-socratic-authoring.mjs` — FOUND on disk
- `scripts/uat/lib/fake-authoring-claude.mjs` — FOUND on disk
- Commit `9487068` (Task 1) — FOUND in `git log --oneline --all`
- Commit `98c64df` (Task 2) — FOUND in `git log --oneline --all`
- Commit `b882f16` (Task 3) — FOUND in `git log --oneline --all`
- All `<acceptance_criteria>`/`<done>`/`<verify>` gates re-verified immediately before writing this
  summary: `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` PASS (0 failures);
  `--replay-check` PASS (16/16 scenarios, including `drafts-criteria-after-second-advance`);
  `--board-read-check` PASS; `cargo test --workspace` PASS (exit code 0); `npm --prefix
  packages/sidecar test` PASS (192/192).
