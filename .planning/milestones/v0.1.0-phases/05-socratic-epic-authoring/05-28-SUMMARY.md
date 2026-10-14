---
phase: 05-socratic-epic-authoring
plan: 28
subsystem: testing
tags: [uat, socratic-authoring, shape-01, shape-03, gap-closure, documentation]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: correlateProposeAttempts, readNoWorkPlannedWithoutClaiming, the back-to-back-proposals scenario, and the role fixture-authoring field (plan 05-27)
provides:
  - a corrected readBackendRefusal doc comment that claims exactly what the position anchor earns (a meaningful, not total, false-positive reduction) and names the residual shape
  - README.md Item 8's fifth finding (G-05-4), the fixture-avoidance rule, and documentation of all eight --replay-check scenarios
affects: [05-29-PLAN.md, any future live script added to scripts/uat/]

# Actuals (#2632)
actuals:
  tokens: 1902
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/README.md

key-decisions:
  - "readBackendRefusal's doc comment moved, its implementation did not — the review's own analysis rejected tightening the match (it would trade back toward the false-negative direction), so this plan is documentation-accuracy only, verified by re-running the self-test and the refusal replay scenario unchanged."
  - "The plan's own literal-case verify gate for the pre-existing 'not executed by an autonomous' sentence (`grep -c 'not executed by an autonomous'`) fails against the file's actual, correctly-capitalized sentence-initial text ('Not executed by an autonomous'). This mismatch pre-dates this plan (the sentence's capitalization was never touched here) and the prohibition explicitly requires that sentence survive unedited — so it was left exactly as written rather than re-cased to satisfy a case-sensitive grep. Case-insensitive re-run of the identical gate confirms the sentence is present and intact."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "readBackendRefusal's doc comment states what the position anchor actually guarantees (meaningfully reduces, not eliminates, false positives) and names the residual shape (a turn whose own first words echo the banner), with the implementation and both relevant checks unchanged"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario backend-refuses-mid-conversation"
        status: pass
    human_judgment: false
  - id: D2
    description: "README.md Item 8 records the fifth finding against gap G-05-4, the wire fact that claude-code-adapter.ts never names a tool_result, and the fixture-avoidance rule grounded in 05-23-SUMMARY.md's own Issues Encountered section, with all four earlier findings, both existing rules and the token-cost warning intact"
    requirement: SHAPE-03
    verification:
      - kind: other
        ref: "grep -c 'G-05-4' scripts/uat/README.md; grep -c 'G-05-1' scripts/uat/README.md; grep -c 'G-05-2' scripts/uat/README.md; grep -c 'G-05-3' scripts/uat/README.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "Item 8 documents all eight replay scenarios (adds back-to-back-proposals) and the stale seven-scenario phrase is gone"
    requirement: SHAPE-03
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (all 8 scenarios)"
        status: pass
    human_judgment: false

# Metrics
duration: ~15min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 28: Refusal-anchor doc accuracy and the fixture-avoidance rule Summary

**Corrected `readBackendRefusal`'s doc comment to state what its position anchor actually earns (not zero false positives), and recorded README Item 8's fifth finding (G-05-4) plus the rule that would have caught it — a fixture-shaped-around-an-ambiguity is the finding, not a fixture detail to route around.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Task 1:** Rewrote the "Anchored on `{@link BACKEND_REFUSAL_PREFIX}`" paragraph in `scripts/uat/lib/sidecar-harness.mjs` so it no longer claims the position anchor drives the false-positive rate to zero. It now says the anchor meaningfully reduces — but does not eliminate — the false-positive risk, names the residual shape concretely (a genuine model turn whose own first words happen to echo the banner text verbatim, e.g. a reply that opens by quoting a log line the agent just read through a tool), states why the heuristic is left alone (tightening it would trade back toward the worse false-negative failure), and cites `05-REVIEW.md`'s WR-01 and gap `G-05-4`. The implementation (`trimmed.startsWith(BACKEND_REFUSAL_PREFIX)`) and the sentence about the asymmetric cost of a false positive are unchanged. `--self-test` (0 FAIL) and `--replay-check --scenario backend-refuses-mid-conversation` (`✅ PASS`) both re-run clean.
- **Task 2:** Added README Item 8's fifth finding, naming gap `G-05-4` and plan `05-27`: the per-attempt correlation the previous closure shipped could reuse a single `tool_result` as the answer to two different back-to-back `propose_*` attempts, laundering a genuinely-unrefused second attempt into `refused` — a vacuous SHAPE-01 pass, the fifth consecutive round this defect class shipped in the same narrow region of code. Recorded the wire fact that makes it structural rather than an unlucky shape: `claude-code-adapter.ts` normalises every `tool_result` with no tool name at all, so the tool-name exclusion the correlation leaned on can never fire on a real run. Added a third rule beside the offline-provability rule and its `G-05-3` sharpening: when a fixture has to be shaped around an ambiguity in the algorithm under test, the ambiguity is the finding — fix the algorithm and add the fixture that was being avoided — grounded in `05-23-SUMMARY.md`'s own "Issues Encountered" section, which documents the executor meeting this exact ambiguity and routing it into the fixture instead of the correlation. Documented the eighth `--replay-check` scenario (`back-to-back-proposals`) and updated the stale "Seven scenarios" phrase to "Eight scenarios". All four earlier findings, both existing rules, the token-cost warning, and the "not executed by an autonomous CI/executor run" sentence remain present, unedited.

## Task Commits

Each task was committed atomically:

1. **Task 1: The refusal anchor's doc comment claims what it earns, and nothing more** - `fcb4798` (docs)
2. **Task 2: The fifth finding, the eighth scenario, and the rule that would have caught this round at the moment it was first met** - `ec82bbc` (docs)

## Files Created/Modified

- `scripts/uat/lib/sidecar-harness.mjs` — `readBackendRefusal`'s doc comment corrected; implementation untouched.
- `scripts/uat/README.md` — Item 8: fifth finding (`G-05-4`), third rule (fixture-avoidance), eighth scenario bullet (`back-to-back-proposals`), scenario-count phrase updated to eight.

## Decisions Made

- Doc-comment-only fix for `readBackendRefusal`, matching the review's own conclusion that tightening the match would trade back toward the false-negative direction the function exists to close.
- The plan's own case-sensitive `grep -c 'not executed by an autonomous'` gate does not match the file's pre-existing, correctly-capitalized sentence-initial text ("Not executed by an autonomous..."). Left the sentence exactly as it was (the prohibition requires it survive unedited) rather than re-casing it to satisfy the gate; confirmed present via a case-insensitive re-run of the identical check. See "Deviations from Plan" below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, plan-gate bug] One `<verify>` command in Task 2 is case-sensitive against a sentence whose grammatically-correct sentence-initial capitalization pre-dates this plan**
- **Found during:** Task 2 acceptance-criteria gate loop
- **Issue:** `test "$(grep -c 'not executed by an autonomous' scripts/uat/README.md)" -ge "1"` returns 0 because the actual, unedited sentence reads "Not executed by an autonomous CI/executor run..." (capital N, since it starts a new sentence following a period) — a phrasing that already existed in the file before this plan touched anything, and which Task 2's own prohibitions and acceptance criteria explicitly require survive "unedited."
- **Fix:** No content change. Confirmed the semantic intent (the sentence is present and intact) via a case-insensitive re-run of the identical check (`grep -ci`), which returns 1. The preserved sentence was left exactly as written rather than re-cased to satisfy a literal-case grep, since editing it — even only its casing — would itself violate the "unedited" requirement the gate exists to enforce.
- **Files modified:** None (no fix applied to source; this entry documents why one literal `<verify>` command reads FAIL while the underlying acceptance criterion is met).
- **Verification:** `grep -ci 'not executed by an autonomous' scripts/uat/README.md` returns 1; `grep -n -i "not executed by an autonomous" scripts/uat/README.md` shows the sentence unchanged at its pre-existing location.
- **Committed in:** `ec82bbc` (no separate fix commit — nothing to fix)

---

**Total deviations:** 1 auto-triaged (1 plan-gate case-sensitivity bug, not a code or content defect)
**Impact on plan:** None on scope or correctness. The one literal `<verify>` command that reads FAIL under exact string matching is checking a sentence this plan was explicitly forbidden from editing; the semantic requirement (sentence preserved, unedited) is met and independently confirmed.

## Issues Encountered

None beyond the documented deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `readBackendRefusal`'s doc comment now states exactly what the position anchor guarantees; a future reader deciding whether to trust or tighten the heuristic reads an accurate claim, not an overclaim. Closing the residual false-positive case would require a tighter match that trades back toward the false-negative direction — the review's own analysis rejects that trade, and this plan honours it. Nothing further to do here.
- README Item 8 now documents all eight `--replay-check` scenarios and the fifth finding against `G-05-4`, with the fixture-avoidance rule stated as its own rule beside the offline-provability rule and its `G-05-3` sharpening — the next author of a live script in this directory (or the next executor who meets an ambiguity mid-test) inherits a rule with teeth, grounded in the record.
- **Still outstanding (unchanged by this plan, as declared in `05-28-PLAN.md`'s own `<outstanding_after_this_closure>`):** SHAPE-01's live dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain `UNJUDGED` in `05-LIVE-CHALLENGE-TRANSCRIPT.md` — byte-identical (sha256 `80d008eb...`, matching commit `b16b3c5`), untouched by this plan. No live arm was run and no credential was spent. Sibling gap-closure plan `05-29-PLAN.md` proceeds independently.

## Self-Check: PASSED

- `scripts/uat/lib/sidecar-harness.mjs` — FOUND (modified, tracked)
- `scripts/uat/README.md` — FOUND (modified, tracked)
- Commit `fcb4798` — FOUND in `git log --oneline --all`
- Commit `ec82bbc` — FOUND in `git log --oneline --all`
- `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` — exit 0, 0 `[self-test] FAIL` lines
- `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` — exit 0, 8/8 `✅ PASS`, 0 `❌ FAIL`
- `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario backend-refuses-mid-conversation` — exit 0, `✅ PASS`
- Doc-comment region (`sed`-scoped) — 18 lines (>=8 required), 0 occurrences of "rate at zero", 1+ occurrence of "own first words"
- `trimmed.startsWith(BACKEND_REFUSAL_PREFIX)` — present, unchanged
- `git diff --quiet -- packages/` — clean
- `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` — sha256 `80d008ebaa64485032f6ac90b8d37be5c3ae0dc01040b2acf255df6eddaf103f`, byte-identical, untouched
- README Item 8 — exactly one `### Item 8` heading; `G-05-4` present; all eight scenario names present; no stale "Seven scenarios" phrase within Item 8; `G-05-1`/`G-05-2`/`G-05-3` all still present; token-cost warning present; "Issues Encountered" citation present

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*
