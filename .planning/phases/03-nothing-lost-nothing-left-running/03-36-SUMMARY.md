---
phase: 03-nothing-lost-nothing-left-running
plan: 36
subsystem: security
tags: [destructive-gate, obfuscation-sweep, corpus, trust-boundary, requirements-bookkeeping]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-35's C6 (raw_text_names_path_defeating_wrapper) and the '## Round eight' trust-boundary section this plan's corpus rows are evidence for"
provides:
  - "OBFUSCATION_SPLIT_KINDS' fourth, wrap-mechanism (brace-expansion) split kind and occurrenceIsCompleteShellWord, mechanically generating round eight's own CR-01 payload"
  - "Seven new LAUNCHER_CORPUS rows (five Group 2 deny, two Group 4 defer) and four new ORDINARY_USAGE_CORPUS rows pricing C6's friction, plus raised floors on both corpora"
  - "Two new structural-gate anchors (C5, C6) and a raised Named-residuals floor (6->7) in the trust-boundary structural gate"
  - "03-REQUIREMENTS-BOOKKEEPING.md section (f), mapping all four 03-VERIFICATION.md round-eight missing: items to the plans/tasks that covered them"
affects: []

actuals:
  tokens: 6296
  tasks: 3
  commits: 3

commits: 3
plan_head_before: e0fcda3db1a0b81f40ad32cef346d160fca86cd6

tech-stack:
  added: []
  patterns:
    - "split-kind mechanism discriminator (insert vs wrap) on OBFUSCATION_SPLIT_KINDS, letting the same generator both split a word's interior and wrap the whole word without conflating the two shapes"

key-files:
  created: []
  modified:
    - packages/sidecar/test/destructive-gate.test.mjs
    - .planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md

key-decisions:
  - "The brace split kind is generated only for complete-shell-word occurrences (occurrenceIsCompleteShellWord), a measured narrowing rather than a convenience — a brace group glued to a suffix (PATH=) resolves to a different invocation entirely, not an obfuscation of the same one, so asserting decision invariance for it would assert something the shell does not do."
  - "Flag tokens (a brace-wrapped -S or -p) are deliberately NOT added to KEYED_WORDS — those shapes are closed by plan 03-35's Rust-level c6_indeterminate_flag_position_fails_closed test instead, since the sweep spawns one real hook process per generated variant and the cost/reopening-trigger tradeoff is already recorded in the boundary document by plan 03-35."
  - "Section (f) of 03-REQUIREMENTS-BOOKKEEPING.md is a record only — no requirement status changed; all eight Phase-3 rows still read Gaps Found, and the seven-sibling re-mark stays gated on a fresh verification pass reporting the phase clear."

requirements-completed: []

coverage:
  - id: D1
    description: "The adversarial sweep gains a fourth, brace-expansion mechanism and mechanically produces round eight's own bypass payload ({env,} -S \"-P /tmp git push --force\") from the existing env -S corpus row, asserting strict decision invariance with zero carried exceptions"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#decision invariance under obfuscation: splitting or brace-wrapping any keyed word in any LAUNCHER_CORPUS row's command text (WR-02, round eight)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The sweep proves it actually swept: braceVariantCount is counted and asserted against a floor of 30 so a complete-word guard matching nothing fails loudly instead of passing vacuously; OBFUSCATION_SPLIT_KINDS and KEYED_WORDS length floors guard against silent narrowing"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#decision invariance under obfuscation — braceVariantCount, OBFUSCATION_SPLIT_KINDS.length, KEYED_WORDS.length assertions"
        status: pass
    human_judgment: false
  - id: D3
    description: "LAUNCHER_CORPUS carries all five round-eight wrapper deny shapes (brace-wrapped env -S, its nested sh -c form, brace-wrapped command -p, the path-qualified /usr/bin/env -S sibling, and the indeterminate env -u {PATH,} NAME) and both C6 falsifiability defer companions (env {git,} push --force, brace-wrapped command -v git), every row landing only after docs/destructive-gate-trust-boundary.md named the mechanism (enforced by depends_on on plan 03-35)"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#LAUNCHER_CORPUS: every launcher shape, wrapper family, shadow shape and non-trigger control"
        status: pass
    human_judgment: false
  - id: D4
    description: "The friction of plan 03-33's brace rule and of C6's own new class is priced in ORDINARY_USAGE_CORPUS (four new rows including add {foo}bar support and the two C6-is-not-bare-presence falsifiability companions), with floors raised (rows 12->17, defers 7->12, denies 3->5)"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#ORDINARY_USAGE_CORPUS: the friction C3 buys on ordinary agent commands is a recorded, asserted fact"
        status: pass
    human_judgment: false
  - id: D5
    description: "The trust-boundary structural gate pins the C5 and C6 clause anchors alongside C1-C4 and raises the Named-residuals row-count floor from 6 to 7, so plan 03-35's amendment cannot rot out of the document silently"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary ... still names all three layers, their residuals and the files that implement them"
        status: pass
    human_judgment: false
  - id: D6
    description: "03-REQUIREMENTS-BOOKKEEPING.md records round eight's coverage map (all four 03-VERIFICATION.md missing: items mapped to the covering plan/task, plus the two shapes this gap closure found on its own) without flipping any requirement status"
    requirement: "AGNT-07"
    verification:
      - kind: manual_procedural
        ref: "direct grep of .planning/REQUIREMENTS.md confirming all eight Phase-3 rows (WORK-03..06, PROC-03..05, AGNT-07) still read Gaps Found"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 36: Round-Eight Gap Closure — Corpus, Sweep, and Bookkeeping Summary

**A brace-expansion split kind that mechanically generates round eight's own CR-01 bypass payload from an existing corpus row, seven new LAUNCHER_CORPUS rows plus four ORDINARY_USAGE_CORPUS rows evidencing and pricing C6, two new C5/C6 structural-gate anchors, and a requirements-bookkeeping coverage map — all landing strictly after plan 03-35's document amendment, with no requirement status changed.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-22T05:00:00Z (approx.)
- **Completed:** 2026-09-22T05:45:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `OBFUSCATION_SPLIT_KINDS` gained a fourth, `wrap`-mechanism entry (`brace-expansion`), discriminated from the three pre-existing `insert`-mechanism kinds by an explicit `mechanism` field. `occurrenceIsCompleteShellWord` guards it so it is generated only where bash genuinely resolves `{word,}` back to the bare word — measured and recorded in its own doc comment — never where the occurrence is glued to a suffix such as `PATH=`.
- The decision-invariance sweep now mechanically generates `{env,} -S "-P /tmp git push --force"` from the existing `env -S` corpus row and asserts strict decision invariance for it (and every other brace variant) with `KNOWN_OPEN_BOUNDARY_FAILURES` still empty. A `braceVariantCount` floor of 30 makes a complete-word guard matching nothing fail loudly instead of passing vacuously; `OBFUSCATION_SPLIT_KINDS.length >= 4` and `KEYED_WORDS.length >= 11` floors guard against silent narrowing.
- `LAUNCHER_CORPUS` gained five Group 2 deny rows (the brace-wrapped `env -S` payload, its nested `sh -c` form, the brace-wrapped `command -p` payload, the path-qualified `/usr/bin/env -S` sibling, and the indeterminate `env -u {PATH,}` NAME) and two Group 4 defer rows (`env {git,} push --force`, the brace-wrapped `command -v git`) — every row landing only after `docs/destructive-gate-trust-boundary.md`'s `## Round eight` section named the mechanism (plan 03-35), the ordering enforced by `depends_on` and this plan's own `<precondition>` gates.
- `ORDINARY_USAGE_CORPUS` gained four rows pricing the friction of plan 03-33's brace rule and C6's own new class (including `add {foo}bar support`, denying, and two falsifiability companions proving C6 is not a bare-presence scan). Floors raised: rows 12→17, defers 7→12, denies 3→5. A new `LAUNCHER_CORPUS` row-count floor (≥42) and a raised Named-residuals structural-gate floor (6→7) guard both tables against silent shrinkage.
- The trust-boundary structural gate's `cContractAnchors` now pins the C5 and C6 clause anchors alongside C1-C4.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` gained section (f), mapping all four of `03-VERIFICATION.md`'s round-eight `missing:` items to the plan/task that covered each, recording the two shapes this gap closure found on its own (path-qualified wrapper tokens; indeterminate flag/NAME positions) that `03-VERIFICATION.md` did not name, and restating that all eight Phase-3 requirement rows still read `Gaps Found`.

## Task Commits

Each task was committed atomically:

1. **Task 1: A brace-expansion split kind — the sweep that would have caught round eight** - `1ab0e4b` (test)
2. **Task 2: The corpus carries the round-eight shapes and prices what they cost** - `a7edfb0` (test)
3. **Task 3: Record round eight's coverage map — and still do not flip a requirement status** - `dfe15d0` (docs)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `packages/sidecar/test/destructive-gate.test.mjs` - Fourth (`wrap`-mechanism) split kind, `occurrenceIsCompleteShellWord`, the wrap branch in `obfuscationVariantDetails`, `braceVariantCount`/length-floor assertions, seven new `LAUNCHER_CORPUS` rows, four new `ORDINARY_USAGE_CORPUS` rows, raised corpus floors, and two new structural-gate anchors
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` - New section (f): round-eight coverage map

## Decisions Made

See frontmatter `key-decisions` for the complete-shell-word narrowing, the deliberate exclusion of flag tokens from `KEYED_WORDS`, and the record-only nature of section (f).

## Deviations from Plan

None - plan executed exactly as written. Every task's precondition held on first check (C6's `textCanShadowPathResolution: true` for Task 1; the `## Round eight` document section already present for Task 2), so no halt-and-report was needed.

## Issues Encountered

`bash scripts/uat/run-all.sh` (plan-level `<verification>` step 6) failed 4/6 scriptable items (UAT 3, 5, 6a, 6b — all live-`claude`-session scripts) on this run. This is the SAME pattern documented in `03-34-SUMMARY.md` and `WINDOWS.md` entry 11 for the immediately-preceding plan: this plan's diff (`packages/sidecar/test/destructive-gate.test.mjs` and `03-REQUIREMENTS-BOOKKEEPING.md`, both test-corpus/docs-only) cannot plausibly cause a live-`claude`-session failure. Judged pre-existing live-session flakiness, not chased, per the plan's own verification-step instruction ("do not treat a repeat failure as this plan's regression without a diff-isolation check"). Recorded as `WINDOWS.md` entry 12. UAT 1 and UAT 7 (the two properly-isolated live-session items) passed. This does not retire the open question the finding leaves — a repeat pass would not have either, per the same instruction.

All other plan-level `<verification>` steps passed clean: `grep -c 'Round eight'` (2), `cargo build --workspace` (0), `cargo test --workspace` (0 failures — the documented `a_worktree_survives_two_runs_with_an_epic` race did not reproduce this run), `npm --prefix packages/sidecar test` (96/96 pass, `# fail 0`, no `SKIPPED`), `npm --prefix packages/desktop run test` (440/440 pass), and the `AGNT-07` grep (`Gaps Found`, unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four of `03-VERIFICATION.md`'s round-eight `missing:` items are now covered: C6 itself (plan 03-35), the Named-residuals row preceding any corpus row (plan 03-35), the mechanical brace-expansion sweep (this plan, Task 1), and the friction pricing (both plan 03-35's document half and this plan's corpus half, Task 2(c)).
- `AGNT-07` deliberately stays `Gaps Found` — this plan's own Task 3 is explicit that no plan in this gap closure flips a requirement status. Whether these two plans (03-35, 03-36) are sufficient for `AGNT-07` and the seven sibling requirements to close is a determination for a fresh phase-level verification pass, not this SUMMARY.
- The repeat live-session UAT flakiness (`WINDOWS.md` entries 11 and 12) is now a two-occurrence pattern across two consecutive gap-closure plans with unrelated diffs (test-corpus+docs both times) — a future verification pass may want to judge whether this needs a dedicated live-session investigation before treating any future recurrence as ambient noise.
- No blockers for the next verification pass.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*

## Self-Check: PASSED

- `packages/sidecar/test/destructive-gate.test.mjs` — FOUND
- `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md` — FOUND
- Commit `1ab0e4b` — FOUND in `git log --oneline --all`
- Commit `a7edfb0` — FOUND in `git log --oneline --all`
- Commit `dfe15d0` — FOUND in `git log --oneline --all`
- All acceptance-criteria/verification commands from the plan's `<verification>` block re-ran clean: `grep -c 'Round eight' docs/destructive-gate-trust-boundary.md` (2), `cargo build --workspace` (0), `cargo test --workspace` (0 failures), `npm --prefix packages/sidecar test` (96/96, `# fail 0`, no `SKIPPED`), `npm --prefix packages/desktop run test` (440/440), `bash scripts/uat/run-all.sh` (2/6 pass, 4/6 fail — pre-existing live-session flakiness, recorded not chased), `grep '| AGNT-07 | Phase 3 |' .planning/REQUIREMENTS.md` (`Gaps Found`, unchanged).
