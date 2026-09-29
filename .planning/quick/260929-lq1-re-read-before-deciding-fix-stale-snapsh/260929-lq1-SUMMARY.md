---
phase: quick
plan: 260929-lq1
subsystem: testing
tags: [uat-harness, socratic-authoring, proposal-lifecycle, sqlite-core]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: the live UAT harness (uat-08-socratic-authoring.mjs), the uat_authoring_ops bridge binary, and the round-12/round-11 stale-snapshot defect history this closure generalizes
provides:
  - pickPendingProposal — the one sanctioned way a live decision target (accept-subtree/reject-proposal/amend-criterion) is chosen, always via a fresh list-pending read taken after the last mutation
  - a source-scanning self-test gate that fails any future live-body decision call site not immediately preceded by its own pick
  - a real-core regression slice (in --board-read-check) reproducing the round-12 collision and pinning both reject-proposal and amend-criterion's refusal of a cascade-decided id
  - a corrected criterion3Decided (true only when both a reject and an amend actually ran)
  - the Eleventh finding / Ninth rule in scripts/uat/README.md's Item 8 ledger, stating the general property so a fourth call site does not recur
affects: [phase-05-live-gate-rerun]

# Actuals (#2632)
actuals:
  tokens: 5933
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fresh-read-and-pick as one indivisible function (pickPendingProposal) rather than a call-site assertion, so a caller can never hold a snapshot array across a mutation"
    - "Source-scanning self-test structural gate (sibling of the existing advance-stage call-site check) enforcing a pick-immediately-precedes-decision invariant"

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/README.md

key-decisions:
  - "pickPendingProposal is a helper, not a call-site assertion — the fresh read and the pick are one operation, so correct sequencing is the path of least resistance rather than something the author must remember to check"
  - "The reject and amend picks in the live arm run unconditionally (not nested inside the task-accept `if` block) — each decision is immediately preceded by its own fresh pick regardless of whether a task proposal existed this run, keeping the invariant uniform rather than conditional on a sibling branch"
  - "draftedCriteriaCount (renamed source array to draftedCriterionProposals) stays on the pre-cascade snapshot, exempted by name from the helper, per the plan's stated boundary between decision targets and measurements"
  - "criterion3Decided corrected to require BOTH rejectExercised and amendExercised — previously true on either alone, contradicting buildCriteriaResults' own printed claim"

requirements-completed: [SHAPE-03, SHAPE-04]

coverage:
  - id: D1
    description: "Live-arm decision targets (accept-subtree, reject-proposal, amend-criterion) route through pickPendingProposal — a fresh list-pending read taken after the last mutation, never a stale snapshot — closing the round-12 crash and its latent amend-criterion twin"
    requirement: "SHAPE-04"
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check (decision-ordering regression: stages a two-task/two-criterion fixture, accept-subtree's the first, proves reject-proposal and amend-criterion both refuse the cascade-decided id, proves pickPendingProposal returns the surviving sibling, proves the exhaustion path reports null)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A source-scanning self-test gate fails any future live-body decision call site not immediately preceded by its own pickPendingProposal pick with no mutating op in between"
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (check: '[Plan 260929-lq1] every proposal-decision call site in the live body is immediately preceded by its own pickPendingProposal( pick...')"
        status: pass
    human_judgment: false
  - id: D3
    description: "criterion3Decided now true only when a reject AND an amend both actually ran, matching buildCriteriaResults' own printed claim"
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check (exercises the live arm's decision block structure indirectly via the same pick/decide sequence)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The general rule (Eleventh finding, Ninth rule) is recorded in scripts/uat/README.md's Item 8 ledger, in sequence with the ten findings and eight rules before it"
    verification:
      - kind: other
        ref: "grep -q 'Eleventh finding' scripts/uat/README.md && grep -q 'A ninth rule' scripts/uat/README.md"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-09-29
status: complete
---

# Quick Task 260929-lq1 Summary

**Closed the general property behind two stale-snapshot proposal-decision crashes (round 12's `reject-proposal` and a latent third instance at `amend-criterion`) with a fresh-read-and-pick helper, a structural self-test gate, and a real-core regression — never running the live gate.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 completed
- **Files modified:** 2

## Accomplishments
- Added `pickPendingProposal(opsBin, appDataDir, runId, { targetType, excludeIds })` immediately after `runOps` — the one sanctioned way a live decision target is chosen, performing the `list-pending` read and the pick as one indivisible operation so a caller can never separate a fresh read from the decision by holding a stale array across a mutation.
- Rewrote the live arm's decision block: `taskProposalId` is now picked fresh right before `accept-subtree`; a second, genuinely post-cascade pick supplies the `reject-proposal` target (reporting honestly via `step()` when the cascade left nothing pending, instead of silently skipping); a third pick, excluding the just-rejected id, supplies `amend-criterion`'s target. `draftedCriteriaCount` (source array renamed `draftedCriterionProposals`) deliberately stays on the pre-cascade snapshot.
- Corrected `criterion3Decided` to require both a reject and an amend to have actually run — it previously went true on either alone, contradicting the printed detail string's own claim.
- Added a source-scanning self-test check (sibling of the existing advance-stage call-site check) that fails if any live-body decision call site is not immediately preceded by its own `pickPendingProposal(` pick with no mutating op between them.
- Appended a real-core regression slice to the `--board-read-check` arm: stages two task proposals with one criterion child each, takes a stale snapshot, accept-subtree's the first, then proves both `reject-proposal` and `amend-criterion` throw naming the core's own pending guard on the cascade-decided id, proves `pickPendingProposal` returns the untouched sibling instead, and proves a further pick reports `null`/`0` once every criterion is decided.
- Recorded the Eleventh finding and a ninth rule in `scripts/uat/README.md`'s Item 8 ledger, stating the general property (derive every decision target from a post-mutation read, as one operation) so a fourth call site does not recur.

## Task Commits

Each task was committed atomically:

1. **Task 1: The helper, and every live decision target routed through it** - `cc812cf` (feat)
2. **Task 2: Make the rule structural, and pin it with an offline regression against the real core** - `9b222f1` (test)
3. **Task 3: Record the rule in the ledger the next author will actually read** - `4f88bc8` (docs)

**Plan metadata:** commit pending (orchestrator handles the docs commit)

## Files Created/Modified
- `scripts/uat/uat-08-socratic-authoring.mjs` - Added `pickPendingProposal`; rewrote the live arm's task-accept/criterion-reject/criterion-amend decision block to pick fresh targets after each mutation; corrected `criterion3Decided`; added the structural self-test gate; appended the real-core decision-ordering regression slice to `--board-read-check`
- `scripts/uat/README.md` - Appended the Eleventh finding and a ninth rule to Item 8's own findings-and-rules ledger

## Decisions Made
- `pickPendingProposal` is a helper, not a call-site assertion — argued in the plan itself and implemented as specified: the fresh read and the pick are one operation, so a stale snapshot is not a shape the function can produce.
- The reject and amend picks in the live arm run unconditionally after the task-accept branch, rather than nested inside its `if`, so each decision's own pick-immediately-precedes-decision property holds uniformly regardless of whether a task proposal existed this run.
- `draftedCriteriaCount`'s source array renamed `draftedCriterionProposals` to make its surviving purpose (a count, never a decision-target pool) legible from its name, per the plan's own instruction.

## Deviations from Plan

None — plan executed as specified. Verification ran exactly the offline arms named in the constraints (`--self-test`, `--board-read-check` with the `cargo build -p core --bin uat_authoring_ops` precondition); the live gate was never run.

## Known Stubs

None.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The property this closure states is now enforced structurally (self-test gate) and pinned against the real core (regression slice), so the defect class that recurred at rounds 11 and 12 cannot reappear at a fourth call site without the self-test failing first.
- Re-running the live gate to produce a completed SHAPE-01/02/03/04 table remains a deliberate, credential-spending developer decision — explicitly out of scope here, per the plan's own Follow-ups.
- The credential seam (`composeIsolatedClaudeConfigDir`) still has no committed test against a real `~/.claude` — unchanged by this task, as noted in the plan.

---
*Phase: quick*
*Completed: 2026-09-29*

## Self-Check: PASSED

- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND: scripts/uat/README.md
- FOUND: commit cc812cf
- FOUND: commit 9b222f1
- FOUND: commit 4f88bc8
