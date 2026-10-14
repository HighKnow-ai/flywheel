---
phase: 03-nothing-lost-nothing-left-running
plan: 29
subsystem: security
tags: [destructive-gate, trust-boundary, shell-quoting, PATH-resolution, AGNT-07]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running (plans 03-24..03-28)
    provides: the original trust-boundary document (D-62 item 3) and the D-59..D-63 closure it documents, whose Layer 1 claim round five's CR-01 reproduced as false
provides:
  - "The corrected Layer 1 claim in docs/destructive-gate-trust-boundary.md — presence vs. absence, never a blanket PATH-preemption proof"
  - "The round-five counterexample recorded verbatim, with the reasoning for why it is a boundary failure, not the pre-existing source-file-indirection residual"
  - "A named, four-clause C1-C4 contract (quote removal, union matching, indeterminate word formation, bare-name-fact scope) under stable anchors, status 'specified, not yet implemented'"
  - "Two new residual rows (a keyword assembled outside C1/C3, a shadow installed by an earlier tool call) and the renamed, extended '## The rule for round six'"
  - "A structural gate extended to fail if any of the above is deleted or reworded — the spec plan 03-30 must implement against and plan 03-31's corpus rows must exercise"
affects: [03-30, 03-31]

# Actuals (#2632)
actuals:
  tokens: 4640
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Correct the trust-boundary document before touching code or the corpus, per the document's own rule for round five — the discipline this plan itself enacts"
    - "Findable contract anchors (bold `**Cn — short label.**` headers) so both a human reader and a structural test can locate each clause independently of surrounding prose"

key-files:
  created: []
  modified:
    - docs/destructive-gate-trust-boundary.md
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "The round-five section records only the three literal --classify-invocation JSON results verbatim from 03-VERIFICATION.md's Behavioral Spot-Checks table (control, e\"\"val, g\"\"it) plus the shell-resolution confirmation, rather than fabricating a fourth JSON result for the backslash form (e\\val) that no source document actually ran — the backslash form's equivalence is instead cited from source-code inspection of raw_text_contains_word (a literal contiguous-character match, verified by reading packages/shim/src/main.rs:913-932), matching the plan's own D-63 prohibition on inventing evidence."
  - "The C1-C4 contract's closing 'do not prove' paragraph and the friction-cost paragraph are stated as accepted trade-offs (over-triggering on any $/backtick/glob character adjacent to a gated keyword), consistent with D-60/D-61's already-recorded discipline, rather than softened to reduce plan 03-30's future implementation burden."
  - "Each task's edits were staged into two separate commits via git add -p (task 1: the corrected claim, round-five record, and C1-C4 contract; task 2: the two residuals and the rule-for-round-six rename), even though both tasks touch the same two files, to preserve the atomic per-task commit contract — required moving the round-six heading assertion I had initially drafted alongside task 1's assertions into task 2's hunk."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "Layer 1's 'Trusted to prove' claim is corrected (presence vs. absence, conditioned on determinate word formation) and the C1-C4 contract is specified under four stable anchors with an honest not-yet-implemented status line"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary (docs/destructive-gate-trust-boundary.md) still names all three layers, their residuals and the files that implement them — D-62 item 3's structural gate"
        status: pass
      - kind: other
        ref: "grep -c 'C-contract status:** specified, not yet implemented' docs/destructive-gate-trust-boundary.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "Six residuals (four original plus two new) are named with concrete reopening triggers, and the closing discipline is renamed to '## The rule for round six' with round five's own distinct lesson added"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary (docs/destructive-gate-trust-boundary.md) still names all three layers, their residuals and the files that implement them — D-62 item 3's structural gate"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-09-21
status: complete
---

# Phase 03 Plan 29: Correct the destructive-gate trust boundary's Layer 1 claim Summary

**Rewrote `docs/destructive-gate-trust-boundary.md`'s false "Trusted to prove" claim into a presence/absence distinction, added the round-five counterexample and a four-clause C1-C4 contract under stable anchors, and gated all of it with an extended structural test — zero corpus rows added, zero lines of `main.rs`/`pretooluse-hook.ts` touched.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-21T04:49:00Z (approx.)
- **Completed:** 2026-09-21T05:24:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Corrected Layer 1's "Trusted to prove" and "Explicitly cannot see" sections in `docs/destructive-gate-trust-boundary.md` so they no longer promise the raw-text scan proves whether arbitrary command text can pre-empt `PATH` resolution — it proves presence of a shadow construct, and absence only for text whose word formation the text itself determines.
- Added `## Round five — the counterexample that made Layer 1's claim false`, recording the four reproduced results verbatim from `03-VERIFICATION.md` and reasoning why this is a boundary failure, not the pre-existing source-file-indirection residual.
- Added `## What Layer 1's raw-text scan is trusted to prove after round five`, specifying the C1 (quote removal), C2 (union matching), C3 (indeterminate word formation), C4 (bare-name-fact scope) contract under four stable bold anchors, naming the four `main.rs` functions it binds, and an honest `**C-contract status:** specified, not yet implemented` line for plan 03-30 to flip.
- Added two new `## Named residuals` rows (a keyword assembled outside C1/C3, a shadow installed by an earlier `Bash` tool call) and renamed `## The rule for round five` to `## The rule for round six`, keeping its existing paragraph and adding round five's own lesson about claim-vs-measurement fields.
- Extended the structural gate in `packages/sidecar/test/destructive-gate.test.mjs` to assert both new headings, all four C-anchors, the status line, the raised residual-row floor (4→6), and the round-six heading — so none of the correction can rot back into the claim it replaced.

## Task Commits

Each task was committed atomically:

1. **Task 1: Correct Layer 1's claim end to end — the paragraph, the contract, and the gate that keeps both honest** — `6fd5705` (docs)
2. **Task 2: Name what survives the correction — two new residuals and the rule for round six** — `980e2e4` (docs)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified
- `docs/destructive-gate-trust-boundary.md` — Layer 1's claim corrected; round-five record, C1-C4 contract, two new residuals, and the renamed `## The rule for round six` added
- `packages/sidecar/test/destructive-gate.test.mjs` — the existing D-62 item 3 structural gate extended with assertions for the new headings, the four C-anchors, the status line, the raised residual floor, and the round-six heading (no new test function created)

## Decisions Made
- Recorded only the three literal `--classify-invocation` JSON results verbatim from `03-VERIFICATION.md` (plus the shell-resolution confirmation) rather than fabricating an unmeasured fourth JSON result for the backslash form; its equivalence is instead cited from direct inspection of `raw_text_contains_word`'s literal contiguous-match algorithm — honoring D-63's discipline against inventing evidence.
- Stated the C1-C4 contract's friction cost (over-triggering on `$`/backtick/glob characters adjacent to a gated keyword) explicitly and without softening, consistent with D-60/D-61's already-accepted trade-off.
- Split what was drafted as one test-file edit into two commits along task boundaries (moving the round-six heading assertion from task 1's hunk into task 2's) to preserve the atomic per-task commit contract, since both tasks touch the same two files.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' prohibitions were honored: no `LAUNCHER_CORPUS` row was added, and no line of `packages/shim/src/main.rs` or `packages/sidecar/src/pretooluse-hook.ts` was changed (confirmed by `git diff --stat` across both commits, which touches only the two files this plan's `files_modified` declares).

## Issues Encountered
- The first full `npm --prefix packages/sidecar test` run (before this plan's edits were finalized) showed a transient failure in "the shipped compiled hook blocks a destructive rm invoked by absolute path" (a pre-existing test spawning a real `claude` CLI session with a 90s timeout, at `destructive-gate.test.mjs:1451`, well outside this plan's edited region). A clean re-run passed 91/91 with no failures, confirming it was environment flakiness in the live-`claude`-session test, not caused by this plan's document/test changes.
- My own first draft of the structural-gate test edit bundled task 2's "round six" heading assertion into task 1's insertion block. Caught before committing (via `git diff -U0` hunk inspection) and split with `git add -p` so each commit's scope matches its task exactly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `docs/destructive-gate-trust-boundary.md` now carries the C1-C4 contract plan 03-30 implements against (`raw_text_contains_word`, `text_names_gated_program`, `raw_text_can_shadow_path_resolution`, `text_can_shadow_path_resolution` in `packages/shim/src/main.rs`) and the `**C-contract status:**` line plan 03-30 must flip from "specified, not yet implemented" once it lands.
- Plan 03-31's adversarial corpus additions (the `e""val`/`e\val`/`g""it`/`g\it` rows WR-02 named) should be written against the corrected residuals table and the C1-C4 anchors this plan just specified — not against the false claim they replace.
- AGNT-07 remains `Gaps Found`: this plan only corrects the specification. The requirement stays open until plan 03-30's code satisfies C1-C4 and plan 03-31's corpus exercises it end to end.

## Self-Check: PASSED

- FOUND: `docs/destructive-gate-trust-boundary.md`
- FOUND: `packages/sidecar/test/destructive-gate.test.mjs`
- FOUND commit `6fd5705` (Task 1)
- FOUND commit `980e2e4` (Task 2)
- `npm --prefix packages/sidecar test`: 91/91 pass, 0 fail (re-run after final edit)
- All three plan-level `<verification>` commands re-run and pass

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*
