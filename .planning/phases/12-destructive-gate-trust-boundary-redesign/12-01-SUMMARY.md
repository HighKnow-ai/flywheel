---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 01
subsystem: security
tags: [destructive-gate, trust-boundary, rust, structural-gate, docs]

requires:
  - phase: 03-destructive-action-gate
    provides: the Layer 0/1/2 shim+hook trust-boundary document this plan amends, and the raw-text classifier this plan fences off
provides:
  - "docs/destructive-gate-trust-boundary.md amended: promoted 'interception layer' noun, new Layer 3 (git pre-push hook) section, corrected P1 status, four new Named Residuals rows, extended layer-to-corpus map"
  - "packages/core/tests/destructive_gate_no_new_launcher_tokens.rs: a cargo test pinning packages/shim/src/main.rs's string-literal set to a committed baseline, failing by name on any new literal"
affects: [12-02, 12-03, 12-04, 12-05]

actuals:
  tokens: 7217
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Whole-set string-literal baseline pin (vs. forbidden-token list) as a structural scope fence against classifier widening"

key-files:
  created:
    - packages/core/tests/destructive_gate_no_new_launcher_tokens.rs
    - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt
  modified:
    - docs/destructive-gate-trust-boundary.md

key-decisions:
  - "Promoted 'an interception layer' to the primary noun in the trust-boundary document's opening frame, demoting the PATH shim to one variant of it — the variant whose P1 premise is unachievable."
  - "P1 corrected: no longer load-bearing for force-push/branch-deletion/history-rewrite (Layer 3 covers them without PATH dependence); still the only premise for hard-reset/force-clean/recursive-delete/default-branch-push."
  - "ACCEPT the core.hooksPath override/rewrite as a named residual rather than adding a companion raw-text check to packages/shim/src/main.rs — fenced off structurally by the new baseline-pin test, not merely by convention."
  - "Generated the string-literal baseline by running the extraction against the real file (via a temporary dev-only dump test, removed before commit), never hand-listed, per the plan's own anti-vacuity requirement."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "docs/destructive-gate-trust-boundary.md names a git-native interception layer that does not depend on PATH precedence, states P1 as unachievable, and records the phase-12 fork resolution (settings-env refuted, CLAUDE_ENV_FILE cited-not-verified)"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -c 'Layer 3 — git.s own pre-push hook' docs/destructive-gate-trust-boundary.md"
        status: pass
      - kind: other
        ref: "grep for core.hooksPath / default-branch-push remains / SessionStart / is REFUSED in docs/destructive-gate-trust-boundary.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Named Residuals table carries four new rows: core.hooksPath override, default-branch-push Layer-2-only, unregistered SessionStart hook, refused install"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -c 'phase 12, plan 12-01' docs/destructive-gate-trust-boundary.md (returns 4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An automated test fails the moment packages/shim/src/main.rs gains a string literal it does not carry today — including a new launcher or wrapper token"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_gate_no_new_launcher_tokens.rs#shim_main_string_literals_match_baseline"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_gate_no_new_launcher_tokens.rs#literal_extraction_is_not_vacuous"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 1: Trust-Boundary Amendment and Classifier Scope Fence Summary

**Amended docs/destructive-gate-trust-boundary.md with a new Layer 3 (git pre-push hook), corrected P1 status, and four Named Residuals rows; added a cargo test pinning packages/shim/src/main.rs's string-literal set to a committed baseline.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-10-01T07:38:22Z
- **Completed:** 2026-10-01T07:54:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- Amended `docs/destructive-gate-trust-boundary.md` BEFORE any implementation code lands, per the document's own "rule for round six": promoted "interception layer" as the primary noun, added `## Layer 3 — git's own pre-push hook`, corrected P1's status (unachievable, no longer load-bearing for three of four remote-reaching categories), named the branch-1 (`--settings` env block) refutation and `CLAUDE_ENV_FILE`'s `[CITED]`-not-`[VERIFIED]` status with both caveats, added four new Named Residuals rows (including the explicit ACCEPT ruling on `core.hooksPath` bypass), and extended the layer-to-corpus map.
- Added `packages/core/tests/destructive_gate_no_new_launcher_tokens.rs`, a `cargo test` structural gate that extracts every double-quoted string literal from `packages/shim/src/main.rs` and asserts set equality (both directions, named in the failure message) against a committed, machine-generated baseline — the scope fence that turns "we did not widen the raw-text classifier" into a checked fact rather than a promise.

## Task Commits

Each task was committed atomically:

1. **Task 1: Amend the trust boundary** — `63dcdb0` (docs)
2. **Task 2: Pin main.rs's string-literal set to a committed baseline** — `7c9509d` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `docs/destructive-gate-trust-boundary.md` - new Layer 3 section, corrected P1 status, promoted generalized-noun opening frame, four new Named Residuals rows, extended layer-to-corpus map
- `packages/core/tests/destructive_gate_no_new_launcher_tokens.rs` - structural gate: `shim_main_string_literals_match_baseline`, `literal_extraction_is_not_vacuous`, with self-contained extraction helpers (comment-stripping aware of double-quoted strings, char-literal-aware so `'"'` is never mistaken for a string start)
- `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt` - committed baseline, 78 literals, generated from the real file

## Decisions Made
- Promoted "an interception layer" to the primary noun in the trust-boundary document, per the plan's `assumption_delta_decision` (`promote`), so coverage reads as a question about a SET of layers rather than one chain.
- P1 corrected rather than declared solved: Layer 3 removes the PATH dependency for `force-push`/`branch-deletion`/`history-rewrite`, but `default-branch-push` and the non-push categories (`hard-reset`/`force-clean`/`recursive-delete`) still depend on it — stated explicitly rather than implied by Layer 3's existence.
- ACCEPT ruling on the `core.hooksPath` bypass as a named residual, explicitly declining a companion raw-text check in `packages/shim/src/main.rs` — the precedent being the existing `sudo`/`PATH=` rows, and the reason being this phase's own hardest constraint (no classifier widening). This plan's own Task 2 test is what makes that refusal structural rather than a promise.
- Generated the baseline fixture by running the extraction logic against the real `main.rs` (via a temporary dev-only `#[test]` guarded by an env var, removed before the final commit) rather than hand-transcribing a literal list — verified by diffing against a manual enumeration of every non-comment `"`-containing line in the file.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>`, `<verify>`, and `<acceptance_criteria>` were followed as specified; no Rule 1-4 deviation was needed.

## Issues Encountered

None. One verification wrinkle, not a deviation: the plan's own `<verify>` grep string `default-branch-push remains` required the literal substring to appear uninterrupted in the document. My first draft of the Named Residuals row wrapped only the hyphenated term in backticks (`` `default-branch-push` remains ``), which inserted a backtick between "push" and "remains" and broke the substring match. Fixed by wrapping the whole phrase in one code span (`` `default-branch-push remains Layer-2-only` ``) so the plan's verify command passes exactly as written.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The trust-boundary document now describes the full layer set (0 through 3) this phase ships, with P1's corrected status and all four new residuals recorded — plan 12-02 (the `git_hooks.rs` implementation and the `destructive_gate_layer_coverage.rs` total-coverage test) can proceed against a settled spec rather than an implicit one.
- The classifier scope fence (`destructive_gate_no_new_launcher_tokens.rs`) is live and green against `packages/shim/src/main.rs` unchanged — any later plan in this phase that touches that file must update the baseline deliberately, in the same commit, with a justification, or the gate fails.
- `packages/shim/src/main.rs` is byte-identical to its pre-plan state, confirmed by `git diff --stat` and `cmp` — this plan wrote documentation and a source-scanning gate only, as its own objective states ("carries no tracer... no runtime path to wire").
- `cargo build --workspace` succeeds with the new test file compiled in.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*
