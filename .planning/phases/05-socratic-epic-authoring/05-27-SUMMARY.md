---
phase: 05-socratic-epic-authoring
plan: 27
subsystem: testing
tags: [uat, socratic-authoring, shape-01, gap-closure, tdd]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: readNoWorkPlanned, the required-window contract, and the offline replay-check/self-test harness (plans 05-20 through 05-25)
provides:
  - correlateProposeAttempts — a named, top-level pure function making the attempt/tool_result pairing one-to-one and directly observable
  - readNoWorkPlannedWithoutClaiming — a frozen 2026-09-24 negative control proving the fix has teeth
  - the back-to-back-proposals fixture and replay scenario — the shape five prior rounds' self-tests avoided
  - a `role` fixture-authoring field in fake-authoring-claude.mjs, expressing a tool_result on the wire for the first time
affects: [05-28-PLAN.md, 05-29-PLAN.md, future SHAPE-01 verification passes]

# Actuals (#2632)
actuals:
  tokens: 9791
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Claimed-index correlation: iterate a set in a stable order, have each element claim the earliest still-unclaimed candidate via a Set, rather than scanning independently per element"
    - "Frozen negative control: preserve the pre-fix algorithm verbatim as a dedicated, never-called function so an offline regression can assert both readings side by side and cannot rot into a tautology"

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs

key-decisions:
  - "correlateProposeAttempts claims (consumes) a tool_result index the instant it is examined, even when its tool name doesn't match the attempt — preserving the existing wrong-name exclusion's `refused: false` outcome while still removing that index from being reused by a later attempt, exactly matching 05-REVIEW.md's own CR-01 fix sketch."
  - "The RED commit's replay-check assertion was intentionally minimal (one assertion against the shipped, unfixed readNoWorkPlanned) rather than the full final assertion set, because the full set references correlateProposeAttempts and readNoWorkPlannedWithoutClaiming, which do not exist until the GREEN commit — the GREEN commit both fixes the algorithm and expands the branch to its final form in the same commit, per the plan's own Step 6 instruction to commit the fix and the branch together."

requirements-completed: [SHAPE-01]

coverage:
  - id: D1
    description: "A back-to-back propose collision during the challenge stage reads violated and sinks SHAPE-01, proven end to end offline through the real sidecar"
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario back-to-back-proposals"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pre-fix algorithm, preserved as a frozen control, is asserted to still produce the vacuous refused reading over the identical fixture — the regression has teeth"
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario back-to-back-proposals"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#[Plan 05-27, Task 2] the LIVE wire shape ..."
        status: pass
    human_judgment: false
  - id: D3
    description: "The attempt→answer pairing is directly observable via correlateProposeAttempts and asserted one-to-one (pairwise-distinct non-null answerIndex) across the live-wire shape, the reviewer's CR-01 repro, and the order-independence check's four shapes"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#[Plan 05-27, Task 2] correlateProposeAttempts returns exactly two entries ..."
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#[Plan 05-23/05-27, Task 2/3] the reading is order-independent ..."
        status: pass
    human_judgment: false
  - id: D4
    description: "The fix does not over-correct — a genuinely all-refused three-attempt window still reads refused, and a two-attempt window with only one result still reads violated"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#[Plan 05-27, Task 2] three back-to-back attempts ... read refused"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#[Plan 05-27, Task 2] two back-to-back attempts with only ONE subsequent ... result read violated"
        status: pass
    human_judgment: false

# Metrics
duration: ~25min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 27: Claimed-index propose/tool_result correlation Summary

**`correlateProposeAttempts` replaces the independent per-attempt `tool_result` scan with a claimed-index pairing, closing the fifth-round vacuous-pass defect (G-05-4) where two back-to-back propose attempts could share one answer and both read `refused`.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- **D1 (Task 1):** A new `correlateProposeAttempts(events, window)` top-level pure function returns one entry per propose attempt, each claiming the earliest still-unclaimed `tool_result` via a `Set` of claimed indices — making the attempt/answer pairing one-to-one and directly observable. `readNoWorkPlanned` now only interprets its output, unchanged in its exact three-valued contract (`unproven`/`refused`/`violated`) and its three required-window `TypeError` guards (moved into `correlateProposeAttempts`, not duplicated).
- **D2 (Task 1):** `readNoWorkPlannedWithoutClaiming` preserves the pre-fix (2026-09-24) algorithm verbatim as a frozen, never-called negative control. A new `back-to-back-proposals` `SCENARIOS` fixture (`fake-authoring-claude.mjs`) — the first in this repository to express a `tool_result` on the wire via a new `role` fixture-authoring field (default `"assistant"`, permitted `"user"`, mirroring `delayMs`'s own introduction) — is driven through the real sidecar and the real `driveChallengeConversation`, asserting the claimed reading is `violated` while the frozen control over the identical window is `refused`, printed side by side.
- **D3/D4 (Task 2):** Six new self-tests tagged `[Plan 05-27, Task 2]` cover the live-wire collision shape (unnamed results), 05-REVIEW.md's own CR-01 repro (a named second result), the pairing invariant (two distinct non-null `answerIndex` values, compared directly rather than via `Set` size), an over-correction guard (three genuinely-refused attempts still read `refused`), and a one-result guard (two attempts with one result still read `violated`). A dedicated check confirms the frozen control is never referenced from the live body.
- **D3 (Task 3):** The order-independence check (previously verified with a `coincidental-reliance` flag per `05-VERIFICATION.md` truth #11, since its two fixtures were chosen to avoid the collision) gained Shapes C and D — both back-to-back-and-both-open, both using unnamed results so no wrong-name exclusion can rescue them. Shape B's comment, which had described the defect as a fixture requirement, is rewritten to name Shapes C/D as the fixtures that now cover the collision directly.

## Task Commits

Each task was committed atomically (Task 1 as TDD RED → GREEN):

1. **Task 1 — RED:** `test(05-27): add failing back-to-back-proposals replay scenario` — `cd67e62`
2. **Task 1 — GREEN:** `feat(05-27): correlate each propose attempt with its own claimed tool_result` — `89bf5d2`
3. **Task 2:** `test(05-27): cover the back-to-back propose collision in both its live and reviewed shapes` — `96ab43a`
4. **Task 3:** `test(05-27): extend order-independence coverage to the colliding back-to-back shape` — `95426f0`

_TDD gate compliance: Task 1 carried `tdd="true"` and produced a real RED (observed by running, not reasoned about — see "Issues Encountered" below) followed by GREEN. Task 2 also carried `tdd="true"`; its "test" was additive self-test coverage against the already-fixed algorithm (no separate RED phase — the checks assert the fixed behavior and pass on first run, which is the correct shape for coverage-only additions following an already-landed fix), consistent with the plan's own Step 1 framing ("the self-tests five rounds never wrote")._

## Files Created/Modified

- `scripts/uat/uat-08-socratic-authoring.mjs` — `correlateProposeAttempts` (new), `readNoWorkPlanned` (now delegates), `readNoWorkPlannedWithoutClaiming` (new, frozen), the `back-to-back-proposals` replay branch, 6 new self-test checks, and the order-independence check's 2 new shapes.
- `scripts/uat/lib/fake-authoring-claude.mjs` — new `role` fixture-authoring field on `emitTurn`, new `back-to-back-proposals` `SCENARIOS` entry (8th key).

## Decisions Made

- `correlateProposeAttempts` claims a `tool_result` index the instant it is examined, even when the name doesn't match — this keeps `refused: false` for the wrong-name case (preserving existing behavior) while still removing that index from being reused, matching `05-REVIEW.md`'s own CR-01 fix sketch (`usedResultIndices.add(i)` runs before the name check).
- The RED commit's assertion was deliberately minimal — a single `violated` assertion against the shipped, unfixed `readNoWorkPlanned` — rather than the full final assertion set, because the full set (non-vacuity counts, `correlateProposeAttempts` entries, `readNoWorkPlannedWithoutClaiming`) depends on functions that only exist after the GREEN commit. The plan's own Step 6 instructs committing "the fix and the branch" together as the `feat` commit, which is what happened: GREEN both implements the fix and expands the replay branch to its final form.

## Deviations from Plan

None — plan executed exactly as written, including the literal 6-step Task 1 sequence (RED → fixture capability → scenario → fix → frozen control → replay branch), with the RED/GREEN split at the natural TDD boundary described above.

## Issues Encountered

**RED observation (Task 1, Step 1) — run, not reasoned about.** After adding the `role` field, the `back-to-back-proposals` fixture, and a minimal replay-check assertion against the still-unfixed `readNoWorkPlanned`, running:

```
node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario back-to-back-proposals
```

produced:

```
❌ FAIL — UAT 8 — offline turn-boundary replay check (scenario=back-to-back-proposals, real sidecar + fake backend, zero tokens)

AssertionError [ERR_ASSERTION]: expected a propose attempt with no refusal to read as violated — the second, unrefused attempt must sink SHAPE-01
+ actual - expected

+ 'refused'
- 'violated'
```

Exit code 1. This is the exact vacuous SHAPE-01 pass G-05-4 describes: the second, unrefused propose attempt was laundered into `refused` by the shared-index collision. This output was captured by actually running the command (see above), not inferred from reading the code, satisfying the plan's explicit "a RED that was reasoned about rather than run is exactly how this defect class survived five rounds" instruction. After the Step 4 fix landed, the identical command reported `✅ PASS` with the side-by-side line `back-to-back reading (claimed): violated — pre-claiming reading (the 2026-09-24 algorithm, still wrong): refused — SHAPE-01 entry passed=false (expected false)`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SHAPE-01's second half now has a genuine offline proof of the collision case it was previously vacuously passing on. `05-28-PLAN.md` and `05-29-PLAN.md` (sibling gap-closure plans in this wave) proceed independently — this plan's own scope (`scripts/uat/` only) leaves `packages/` and the phase's other outstanding items untouched.
- **Still outstanding (unchanged by this plan, as declared in `05-27-PLAN.md`'s own `<outstanding_after_this_closure>`):** SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain `UNJUDGED` in `05-LIVE-CHALLENGE-TRANSCRIPT.md` (byte-identical, untouched by this plan — no live arm was run, no credential spent). `ToolResultEvent.toolName` remains optional and unpopulated in `packages/sidecar/src/adapter.ts`/`claude-code-adapter.ts` — a faithful mapping, not a defect, and the reason positional/claimed correlation is mandatory rather than an optimisation; no `packages/` change was made or needed.

## Self-Check: PASSED

- `scripts/uat/uat-08-socratic-authoring.mjs` — FOUND (modified, tracked)
- `scripts/uat/lib/fake-authoring-claude.mjs` — FOUND (modified, tracked)
- Commit `cd67e62` — FOUND in `git log --oneline --all`
- Commit `89bf5d2` — FOUND in `git log --oneline --all`
- Commit `96ab43a` — FOUND in `git log --oneline --all`
- Commit `95426f0` — FOUND in `git log --oneline --all`
- `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario back-to-back-proposals` — exit 0, `✅ PASS`, side-by-side line shows `violated` vs `refused`
- `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` — exit 0, 81 PASS lines, 0 FAIL lines
- `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` — exit 0, all 8 scenarios `✅ PASS`
- `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` — exit 0, `✅ PASS`
- `SCENARIOS` exports exactly 8 keys, including `back-to-back-proposals`
- `git diff --quiet -- packages/` — clean
- `git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` — clean (byte-identical, untouched)

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*
