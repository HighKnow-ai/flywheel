---
phase: 05-socratic-epic-authoring
plan: 50
subsystem: authoring
tags: [instruction-text, live-uat, gap-closure, G-05-10, D-89, D-96, harness-defect]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-48)
    provides: the propose_*/amend_*/delete_* staging tool result resolving with
      {staged, proposalId} — the id source both stage instructions now name
  - phase: 05-socratic-epic-authoring (plan 05-49)
    provides: createProposalStagedHandler (in-turn apply) and
      assertProposalListNonEmptyInTurn — the harness-side half of the contract this
      plan's live run depends on and reports against
provides:
  - DISTILLATION_INSTRUCTION_TEXT and CRITERIA_INSTRUCTION_TEXT rewritten to name the
    staging call's own tool result (proposalId) as the parent-id source, replacing the
    proposal_list read-back framing that plan 05-48's contract change made wrong.
  - A corrected CRITERIA_INSTRUCTION_TEXT doc comment recording the MEASURED cause of live
    run 01M3ENQMC3E4M2HP7014MA84PX's failure (no staging call returned an id) in place of
    the prior "reasoning itself into waiting" misattribution, plus an explicit statement
    that an instruction rewording does not repair a missing capability.
  - A live run (01M3NXWP72VACQJQNVGDK7AXJ8) proving the fixed contract end to end against
    the real backend: 20 criteria staged, every one parented directly from an earlier
    staging call's own returned id, zero proposal_list calls in the staging turn.
  - A newly-surfaced, NOT-fixed-here harness defect in uat-08's own reject-proposal step
    (stale pre-accept-subtree snapshot index), recorded in the updated
    05-LIVE-CHALLENGE-TRANSCRIPT.md for a future plan.
affects: [any future phase-5 round exercising the criteria stage live, a future harness-fix
  plan for uat-08-socratic-authoring.mjs's reject-proposal step, SHAPE-01/SHAPE-03's
  outstanding UNJUDGED human calls]

# Actuals (#2632)
actuals:
  tokens: 12337
  tasks: 2
  commits: 2
plan_head_before: 1c933efd8e4291e618f5dea4372a588dc12dcd11

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A stage instruction names its id source as the tool result the model already holds
       from its own prior call, never a second read tool — the correction this plan makes
       after three prior rounds (10, 11, 12) each reworded the same instruction against an
       unfixed contract."
    - "A live-gate task that fails is recorded as a failed run with intact evidence, not
       retried with a changed prompt and not narrowed into a false pass — the plan's own
       explicit prohibition, now exercised for real against a genuine (and unrelated)
       harness defect."

key-files:
  created: []
  modified:
    - packages/core/src/domain/authoring_session.rs
    - packages/core/tests/authoring_distillation.rs
    - packages/core/tests/authoring_criterion_reachability.rs
    - .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md

key-decisions:
  - "The DISTILLATION_INSTRUCTION_TEXT doc comment was also corrected (not just
    CRITERIA_INSTRUCTION_TEXT's, which the plan named explicitly) — it too described
    proposal_list as the way a staged proposal's id is read back, which became stale the
    moment the constant's own text changed. Rule 1 (bug: a doc comment describing behavior
    the code no longer has). Scope stayed narrow: only the sentence naming the old
    mechanism changed, not the surrounding rationale."
  - "A second content-pinning assertion was added to authoring_distillation.rs's criteria-
    instruction test (previously it asserted one-call-per-criterion and the
    does-not-need-to-be-accepted-first clause, but nothing about the id source) so
    CRITERIA_INSTRUCTION_TEXT's new wording is pinned the same way DISTILLATION_INSTRUCTION_TEXT's
    already was — the plan's own stated rationale (\"a constant with no assertion on its
    content is how instruction text drifts\") applies equally to both constants."
  - "SHAPE-01 and SHAPE-03 were deliberately NOT marked complete in REQUIREMENTS.md despite
    being named in this plan's requirements frontmatter. The live gate did not exit 0 (a
    harness defect crashed it after the criteria stage, before the plan-level SHAPE
    pass/fail table was computed), and both requirements carry a live human judgement that
    remains explicitly UNJUDGED by this task's own design. Marking them complete off an
    exit-1 run would misrepresent what was actually proven. SHAPE-04 and SHAPE-05 were
    already marked complete before this plan (offline/structural coverage) and are
    unaffected."

requirements-completed: []

coverage:
  - id: D1
    description: "Neither DISTILLATION_INSTRUCTION_TEXT nor CRITERIA_INSTRUCTION_TEXT
      directs the agent to proposal_list for a parent id; both name parent_proposal_id and
      the staging call's own tool result (proposalId) as its source. Four test-file
      occurrences of the old wording (2 per file) were updated, not deleted, plus two new
      content-pinning assertions added so drift is caught."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "cargo test -p core --test authoring_distillation"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test authoring_criterion_reachability"
        status: pass
      - kind: unit
        ref: "cargo test -p core --test authoring_stage"
        status: pass
      - kind: unit
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false
  - id: D2
    description: "The CRITERIA_INSTRUCTION_TEXT doc comment names the measured cause of live
      run 01M3ENQMC3E4M2HP7014MA84PX's failure (no staging call returned an id; the agent
      correctly declined to fabricate one) instead of the prior \"reasoning itself into
      waiting\" attribution, and states plainly that an instruction rewording does not fix a
      missing capability."
    verification:
      - kind: other
        ref: "grep-verified: authoring_session.rs's CRITERIA_INSTRUCTION_TEXT doc comment
          names 01M3ENQMC3E4M2HP7014MA84PX, states the measured cause, and states an
          instruction rewording is not an acceptable fix"
        status: pass
    human_judgment: false
  - id: D3
    description: "A live run against the real backend proves the fixed contract works
      end to end: 20 criteria drafted, every one parented directly from an earlier staging
      call's own returned id inside the same session, with zero proposal_list calls in the
      staging turn (assertProposalListNonEmptyInTurn: not-applicable, a passing verdict).
      The prior recorded failure's specific behaviour (declining to fabricate a parent id)
      is absent from this run."
    requirement: SHAPE-03
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs (run 01M3NXWP72VACQJQNVGDK7AXJ8),
          quoted in 05-LIVE-CHALLENGE-TRANSCRIPT.md's 'Live gate outcome' section"
        status: pass
    human_judgment: true
    rationale: "The specific id-reachability property this plan targets is proven (see
      verification above). But the run's OVERALL exit code was 1 (a downstream, unrelated
      harness defect crashed it before the plan-level SHAPE pass/fail table was computed),
      and SHAPE-01/SHAPE-03 both carry a live human judgement (challenge quality,
      draft-usefulness) this task's own design keeps UNJUDGED. A human must read
      05-LIVE-CHALLENGE-TRANSCRIPT.md to confirm the distinction between 'the contract fix
      is proven' and 'the live gate is fully green' before either requirement is marked
      complete."
  - id: D4
    description: "The live run crashed on a pre-existing harness defect (uat-08's
      reject-proposal step targets a stale pre-accept-subtree snapshot index that
      accept-subtree's own D-96 implied-parent walk had already partially decided),
      structurally unrelated to the G-05-10 contract fix. Recorded with root cause and
      evidence in 05-LIVE-CHALLENGE-TRANSCRIPT.md; no harness file was modified by this
      plan, per its own explicit instruction not to fix harness defects inside the task
      that runs the gate."
    verification:
      - kind: other
        ref: "05-LIVE-CHALLENGE-TRANSCRIPT.md 'Live gate outcome' section, 'Why this run is
          still reported as FAILED' subsection"
        status: pass
    human_judgment: false

# Metrics
duration: ~35min
completed: 2026-09-29
status: complete
---

# Phase 5 Plan 50: Stage instructions now name the staging result as the id source, and a live run proves it — while surfacing a new, unrelated harness defect

**Both D-88 stage instructions and the misattributing doc comment above them now describe the real 05-48 contract, and a live run against the real backend (01M3NXWP72VACQJQNVGDK7AXJ8) proves the agent stages 20 criteria by naming ids returned from its own earlier staging calls — never calling `proposal_list` — though the run itself still exits 1 on a newly-exposed, unrelated harness bug.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-29T06:15:00Z (approx.)
- **Completed:** 2026-09-29T06:45:09Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- `DISTILLATION_INSTRUCTION_TEXT` and `CRITERIA_INSTRUCTION_TEXT`
  (`packages/core/src/domain/authoring_session.rs`) no longer direct the agent to
  `proposal_list` for a parent id — both now state that every staging call returns the new
  proposal's own id (`proposalId`) in its tool result, and that this is what
  `parent_proposal_id` takes. Every other clause in both constants (D-89's
  one-call-per-assumption rule, D-96's "parent does NOT need to be accepted first" clause,
  the draft framing, the closing "Go ahead now.") is byte-identical to before.
- `CRITERIA_INSTRUCTION_TEXT`'s doc comment now records the MEASURED cause of live run
  `01M3ENQMC3E4M2HP7014MA84PX`'s failure — no staging call returned an id, so the agent
  correctly declined to fabricate one — replacing the prior "reasoning itself into waiting"
  misattribution, and states plainly that an instruction rewording does not repair a
  missing capability, naming rounds 10 through 12 as the pattern to not repeat.
- Four stale `proposal_list` references across `authoring_distillation.rs` and
  `authoring_criterion_reachability.rs` were updated to describe or assert the new
  contract, none deleted without replacement; a second content-pinning assertion was added
  to `authoring_distillation.rs`'s criteria-instruction test so `CRITERIA_INSTRUCTION_TEXT`
  is pinned the same way `DISTILLATION_INSTRUCTION_TEXT` already was.
- `cargo test --workspace` is green (every crate, 0 failed).
- A live run against the real backend (`node scripts/uat/uat-08-socratic-authoring.mjs`,
  run `01M3NXWP72VACQJQNVGDK7AXJ8`) proves the fixed contract works end to end: the agent
  staged 1 epic, 5 tasks and 20 criteria, naming a concrete `parent_proposal_id` for every
  criterion directly from an earlier staging call's own returned id, with
  `assertProposalListNonEmptyInTurn` reading `not-applicable` (a passing verdict — no
  `proposal_list` call at all in the staging turn) and `criteriaReachabilityReading` reading
  `drafted`. The prior recorded failure's specific behaviour — declining to fabricate a
  parent id because none was reachable — is confirmed absent from this run, quoted directly
  against the earlier recorded failure in `05-LIVE-CHALLENGE-TRANSCRIPT.md`.
- The run's own exit code is 1: a pre-existing, unrelated harness defect (uat-08's
  `reject-proposal` step reads a `criterionProposals` array snapshotted BEFORE
  `accept-subtree` runs, and `accept-subtree`'s own D-96 implied-parent walk had already
  moved two of those entries to `accepted` — the harness then tried to reject an
  already-decided proposal and the core's own guard correctly refused). Per this plan's own
  instruction, the harness was not modified; the defect, its root cause and the preserved
  evidence are recorded in `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s "Live gate outcome" section
  for a future plan.

## Task Commits

1. **Task 1: Retire the read-back framing from both stage instructions** - `81b1c66` (feat)
2. **Task 2: Run the live gate and record its evidence** - `a67719e` (docs)

**Plan metadata:** committed alongside this summary.

## Files Created/Modified

- `packages/core/src/domain/authoring_session.rs` - both instruction constants' id-source
  sentence, and both constants' doc comments (`CRITERIA_INSTRUCTION_TEXT`'s per the plan;
  `DISTILLATION_INSTRUCTION_TEXT`'s as a Rule 1 fix — see Deviations).
- `packages/core/tests/authoring_distillation.rs` - the existing assertion inverted (asserts
  absence of `proposal_list` and presence of `proposalId`/`parent_proposal_id`), plus a new
  matching pair of assertions added to the criteria-instruction test.
- `packages/core/tests/authoring_criterion_reachability.rs` - two narrative comments updated
  to describe the id now being reachable directly from the staging result, with
  `list_proposals` reframed as a second, still-valid path rather than the only one.
- `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` - replaced
  with the new live run's transcript, plus a "Live gate outcome" section recording the exit
  code, the named readings, the comparison against the prior recorded failure, and the
  newly-surfaced harness defect's root cause.

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected `DISTILLATION_INSTRUCTION_TEXT`'s doc comment, not just `CRITERIA_INSTRUCTION_TEXT`'s**
- **Found during:** Task 1
- **Issue:** The plan's action text explicitly names only `CRITERIA_INSTRUCTION_TEXT`'s doc
  comment for correction. But `DISTILLATION_INSTRUCTION_TEXT`'s own doc comment also stated
  "the closing sentence... names `proposal_list` as the way a staged proposal's id is read
  back" — a claim about the constant's own content that Task 1's edit makes false the
  moment the sentence changes.
- **Fix:** Updated `DISTILLATION_INSTRUCTION_TEXT`'s doc comment to describe the corrected
  sentence, keeping the surrounding D-89 framing unchanged.
- **Files modified:** `packages/core/src/domain/authoring_session.rs`
- **Verification:** `cargo test -p core --test authoring_distillation` green; grep confirms
  no remaining `proposal_list` reference in either doc comment.
- **Committed in:** `81b1c66` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added a content-pinning assertion for `CRITERIA_INSTRUCTION_TEXT`'s new wording**
- **Found during:** Task 1
- **Issue:** Before this plan, `authoring_distillation.rs`'s criteria-instruction test
  asserted the one-call-per-criterion rule and the "does not need to be accepted first"
  clause, but nothing about the id source — so `CRITERIA_INSTRUCTION_TEXT`'s new wording
  (or a future regression back to the old wording) would go unpinned, exactly the "a
  constant with no assertion on its content is how instruction text drifts" failure mode
  the plan itself names for the other constant.
- **Fix:** Added two assertions mirroring the ones already added to the
  distillation-instruction test: one confirming the new wording (`parent_proposal_id` +
  "staging call"), one confirming the absence of `proposal_list`.
- **Files modified:** `packages/core/tests/authoring_distillation.rs`
- **Verification:** `cargo test -p core --test authoring_distillation` green (10 tests).
- **Committed in:** `81b1c66` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical).
**Impact on plan:** Both fixes keep documentation and test coverage honest about the exact
change this plan makes. No scope creep — neither touches `advance_stage`'s behavior, and
both stay inside the two files the plan already names.

## Known Stubs

None.

## Issues Encountered

The live gate (Task 2) exited 1. This is a designed, correct outcome for this task, not an
issue requiring a fix-attempt loop: the task's own action text explicitly instructs "If the
run does NOT exit 0, do not reword any instruction and do not retry with a changed prompt
... report it as a failed live gate. A failed gate with preserved evidence is a correct
outcome for this task." The failure's root cause (a stale pre-`accept-subtree` snapshot
index in `uat-08-socratic-authoring.mjs`'s own `reject-proposal` step) is unrelated to the
G-05-10 contract this plan closes, and is recorded — not fixed — in
`05-LIVE-CHALLENGE-TRANSCRIPT.md` for a future plan. See that document's "Live gate outcome"
section for the full analysis, including the specific evidence that the G-05-10 property
itself (id reachability without `proposal_list`) worked correctly before the unrelated
crash.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The structural id-reachability contract G-05-10 names (plans 05-48, 05-49, 05-50 across
  the write contract, the harness's in-turn apply, and the instruction wording
  respectively) is now proven working end to end against a real live run. The specific
  failure mode recorded in `01M3NNPEWEDMM0XXG5EVKGDQBD` — the agent declining to fabricate a
  parent id — did not recur.
- A NEW, unrelated harness defect needs its own plan: `uat-08-socratic-authoring.mjs`'s
  `reject-proposal` step (around the `if (criterionProposals.length > 1)` block) computes
  its reject target from a `list-pending` snapshot taken BEFORE `accept-subtree` runs, and
  does not account for `accept-subtree`'s own D-96 implied-parent walk having already
  decided some of those same entries. This was only reachable once a live run produced
  enough tasks and criteria (this run's own 5 tasks / 20 criteria) for the ordering
  collision to occur — every prior live run died earlier and never exercised this code
  path. Full root cause is in `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s "Live gate outcome"
  section.
- SHAPE-01 and SHAPE-03 remain open in `REQUIREMENTS.md`. Both need: (a) the harness defect
  above fixed so a live run can exit 0 and produce the full SHAPE pass/fail table, and (b) a
  human reading `05-LIVE-CHALLENGE-TRANSCRIPT.md` to render the two UNJUDGED verdicts
  (challenge quality, draft usefulness) the live arm has carried unresolved since round 8.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-29*

## Self-Check: PASSED

All 4 key files verified present on disk (`[ -f ]`); both commits (`81b1c66`, `a67719e`)
verified present in `git log --oneline --all`. Task 1's acceptance criteria were re-run
immediately before its commit (`cargo test -p core --test authoring_distillation`: 10/10;
`cargo test -p core --test authoring_criterion_reachability`: 3/3; `cargo test -p core
--test authoring_stage`: 9/9; `cargo test --workspace`: 0 failed across every crate). Task
2's acceptance criteria were verified against the actual run output: run id, exit code (1),
`draftedCriteriaCount` (20), `criteriaReachabilityReading` (`drafted`) and the
`assertProposalListNonEmptyInTurn` verdict (`not-applicable`) are all named verbatim in
`05-LIVE-CHALLENGE-TRANSCRIPT.md`; SHAPE-01/SHAPE-03 verdicts remain in their UNJUDGED form
(unchanged by this task); `git status --porcelain -- packages scripts` is empty, confirming
no harness or product file was modified by Task 2.
