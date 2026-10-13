---
phase: 03-nothing-lost-nothing-left-running
plan: 37
subsystem: security
tags: [destructive-gate, trust-boundary, documentation-correction, c6-friction, quote-removal]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-35's C6 (raw_text_names_path_defeating_wrapper) and the '## Round eight' trust-boundary section; 03-REVIEW.md's WR-A finding this plan closes"
provides:
  - "A '## Round nine' section in docs/destructive-gate-trust-boundary.md naming the falsified friction claim, its root cause in C1's context-free quote removal, the branch decision (accept the over-trigger, correct the claim), and the measured reason branch (a) was rejected"
  - "C6's soundness-class paragraph widened to state adjacency is computed over both text forms, and the friction accounting's third bullet corrected to the class C6 actually charges (env: any dash-prefixed follower; command: a flag run reaching -p)"
  - "One new Named-residuals row (the declined co-location narrowing) with a concrete reopening trigger"
  - "Four new Rust tests against the compiled flywheel-shim binary bounding the corrected class from both sides and pinning the two nested shapes branch (a) would have reopened"
affects: [03-38]

actuals:
  tokens: 6899
  tasks: 3
  commits: 4

commits: 4
plan_head_before: 5504b67b397f3b0de5d394145fe2ed4daf23d485

tech-stack:
  added: []
  patterns:
    - "Documentation-first, test-second ordering ('The rule for round six'): the Round nine section names the falsified claim and the branch decision BEFORE the corpus (plan 03-38) gains any new row of that shape."

key-files:
  created: []
  modified:
    - docs/destructive-gate-trust-boundary.md
    - packages/shim/tests/classify_invocation.rs

key-decisions:
  - "Branch (b) chosen over branch (a): the over-trigger is accepted as a deliberate, priced trade and the document is corrected, rather than narrowing raw_text_names_path_defeating_wrapper's adjacency to a token's original quoted span. Branch (a) would be unsound, not merely costly — the nested sh -c 'env -S \"...\"' shapes rounds seven and eight closed reach C6 through the exact same quote-internal adjacency the prose false positive depends on, so a rule that silences the false positive silences those closed bypasses too. No syntactic property distinguishes a quoted shell payload from a quoted commit message (D-59 forbids enumerating outer programs)."
  - "packages/shim/src/main.rs left byte-identical, verified by a git diff --quiet gate on every task. This round corrects a claim, not a predicate, so no shape closed in rounds five through eight can have regressed."
  - "The co-location narrowing (charge quote-removed-form adjacency only when the gated program name sits in the same quoted region as the wrapper token) is recorded as a Named residual rather than implemented — it survives as a candidate for a future round, gated on measured evidence the friction fires often enough on ordinary traffic to outweigh the bypass risk of a locality rule."
  - "Task 2 (tdd=true) wrote round_nine_env_charges_any_dash_command_charges_only_the_p_run and round_nine_prose_controls_still_defer FIRST and ran them before touching the document, per the plan's own documentation-follows-measurement discipline — but both passed immediately (no RED phase) because the behaviour under test was already correctly implemented by round eight's C6 (plan 03-35) and this round deliberately does not touch main.rs. This is the 'feature already exists — investigate, confirmed, proceed' path in tdd.md's own error-handling section, not a TDD violation. See 'TDD Gate Compliance' below."

requirements-completed: []

coverage:
  - id: D1
    description: "The trust-boundary document's friction accounting states the class C6 actually charges (env: any dash-prefixed follower; command: a flag run reaching -p), with the root cause (C1's context-free quote removal re-tokenizing a quoted argument's internal spaces) stated in the document's own voice, and the verifier's own named representative asserted end-to-end against the compiled binary."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/shim/tests/classify_invocation.rs#round_nine_plain_prose_wrapper_flag_adjacency_denies"
        status: pass
      - kind: integration
        ref: "packages/shim/tests/classify_invocation.rs#round_nine_env_charges_any_dash_command_charges_only_the_p_run"
        status: pass
      - kind: integration
        ref: "packages/shim/tests/classify_invocation.rs#round_nine_prose_controls_still_defer"
        status: pass
    human_judgment: false
  - id: D2
    description: "The branch decision (accept the over-trigger; correct the claim) is recorded with the measured reason the alternative was rejected, and the alternative survives as a Named residual with a concrete reopening trigger."
    requirement: "AGNT-07"
    verification:
      - kind: other
        ref: "grep -c 'Reopening trigger' docs/destructive-gate-trust-boundary.md; Named-residuals table row-count gate"
        status: pass
    human_judgment: false
  - id: D3
    description: "The two nested shapes rounds seven and eight closed (sh -c 'env -S \"...\"' and sh -c '{env,} -S \"...\"') still deny, pinning that branch (a) would reopen them — a future author implementing the co-location or original-quoted-span narrowing must see this test go red first."
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/shim/tests/classify_invocation.rs#round_nine_quote_removed_form_is_load_bearing"
        status: pass
    human_judgment: false
  - id: D4
    description: "packages/shim/src/main.rs is byte-for-byte unchanged by this plan; no requirement status is flipped; the full workspace and sidecar suites still pass."
    requirement: "AGNT-07"
    verification:
      - kind: other
        ref: "git diff --quiet HEAD -- packages/shim/src/main.rs"
        status: pass
      - kind: unit
        ref: "cargo test --workspace"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test (96 passed, 0 failed, 0 skipped)"
        status: pass
    human_judgment: false
---

# Phase 03 Plan 37: Round nine — correcting the C6 friction claim to the class it actually charges Summary

**`docs/destructive-gate-trust-boundary.md` now states C6's friction class at its measured breadth (plain, non-obfuscated prose denies, not just an obfuscated brace/glob token), with the branch decision and its rejected alternative on the record, and four new Rust tests assert the corrected class from both sides against the compiled `flywheel-shim` binary — `packages/shim/src/main.rs` untouched.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-09-22T14:30:14+08:00 (base commit)
- **Completed:** 2026-09-22T14:47:08+08:00
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added a `## Round nine` section to `docs/destructive-gate-trust-boundary.md` naming the falsified friction claim, the root cause in C1's context-free `shell_quote_removed`, the direction (over-trigger, not a bypass), and how round nine differs in kind from rounds five through eight (a false claim in the document, not a bypass in the code).
- Widened C6's soundness-class paragraph to state that adjacency is computed over both the raw and quote-removed text forms, and corrected the friction accounting's third bullet from the falsified `"brace or glob AND a -"` predicate to the measured class: `env` charges on ANY dash-prefixed follower (fail-closed on an unrecognised flag), `command` charges only when its flag run reaches `-p`.
- Recorded the branch decision explicitly: accept the over-trigger (branch (b)), reject narrowing the predicate (branch (a)) because it would reopen the nested `sh -c 'env -S "..."'` shapes rounds seven and eight closed — there is no syntactic discriminator between a quoted shell payload and a quoted commit message.
- Added one Named-residuals row for the declined co-location narrowing, with a concrete reopening trigger, keeping the row count well above the sidecar structural gate's floor of 7 (now 10 data rows).
- Added four Rust tests against the compiled binary: `round_nine_plain_prose_wrapper_flag_adjacency_denies`, `round_nine_env_charges_any_dash_command_charges_only_the_p_run`, `round_nine_prose_controls_still_defer`, `round_nine_quote_removed_form_is_load_bearing` — 24/24 tests pass in `classify_invocation.rs` (20 pre-existing + 4 new).

## Task Commits

Each task was committed atomically (Task 2's `tdd="true"` produced a `test` commit before its `docs` commit, per the plan's own tests-before-document discipline):

1. **Task 1: The document states the class C6 actually charges** - `143a6b0` (docs)
2. **Task 2a: Pin the asymmetry and negative controls (written and run first)** - `3d64239` (test)
2. **Task 2b: Record the asymmetry in the document** - `f4b895c` (docs)
3. **Task 3: The branch decision, the rejected alternative, and the residual** - `48d5380` (docs+test)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

## Files Created/Modified

- `docs/destructive-gate-trust-boundary.md` - Adds `## Round nine`, widens C6's soundness-class paragraph, corrects the third friction bullet, adds one Named-residuals row
- `packages/shim/tests/classify_invocation.rs` - Adds four round-nine tests (24 total, up from 20)

## Decisions Made

See `key-decisions` in frontmatter above. In short: branch (b) chosen over branch (a) because branch (a) is unsound (would reopen rounds seven/eight's closed nested shapes), not merely more expensive; `packages/shim/src/main.rs` stays byte-identical; the co-location narrowing is recorded as a Named residual rather than implemented.

## Deviations from Plan

None — plan executed exactly as written. The one point worth flagging explicitly is documented under "TDD Gate Compliance" below (not a deviation from the plan's own instructions, which anticipated this).

## TDD Gate Compliance (Task 2, `tdd="true"`)

Task 2's own action text instructs: "Write the tests FIRST, from the `<behavior>` block, and run them before touching the document." This was followed literally — `round_nine_env_charges_any_dash_command_charges_only_the_p_run` and `round_nine_prose_controls_still_defer` were written and run (`cargo test -p flywheel-shim --test classify_invocation round_nine_env_charges` / `round_nine_prose_controls`) before the corresponding document paragraph was written, and both commits are ordered `test(03-37)` before `docs(03-37)`.

This is **not** a classic RED-GREEN-REFACTOR cycle, because the plan explicitly forbids touching `packages/shim/src/main.rs` (branch (b) is a documentation correction, not an implementation change) — the behaviour under test (the `env`/`command` friction asymmetry) was already correctly implemented by round eight's C6 (plan 03-35). Both tests passed on first run, with zero implementation changes. Per `tdd.md`'s own error-handling section ("Test doesn't fail in RED phase: Feature may already exist - investigate"), this was investigated and confirmed: the feature does already exist, deliberately, and the tests function as characterization/pinning tests rather than drivers of new code. `workflow.tdd_mode` is not set in `.planning/config.json`, so the formal RED-evidence gate (`gsd_run check tdd-red-evidence`) was not invoked; this matches the project's own established precedent (STATE.md: "`gsd_run check tdd-red-evidence` is TAP-specific and cannot parse cargo test output, so Task 2 and 3's RED phases were verified manually against the same INVALID_RED criteria" — an earlier phase-3 plan's same situation).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Self-Check: PASSED

- `docs/destructive-gate-trust-boundary.md` exists and contains `## Round nine`, `C6's own class, corrected in round nine`, zero occurrences of `brace or glob AND a`, the unreworded `C-contract status:** implemented by plan 03-30 in packages/shim/src/main.rs` sentence, and 10 Named-residuals data rows (was 9 before this plan).
- `packages/shim/tests/classify_invocation.rs` exists and contains all four new tests; `cargo test -p flywheel-shim --test classify_invocation` reports `test result: ok. 24 passed; 0 failed`.
- All four commit hashes (`143a6b0`, `3d64239`, `f4b895c`, `48d5380`) found in `git log --oneline --all`.
- `git diff --quiet HEAD -- packages/shim/src/main.rs` exits 0 — scanner untouched.
- `cargo test --workspace` exits 0 on first run (no re-run needed). `npm --prefix packages/sidecar test` reports `# fail 0`, no `SKIPPED (shim-binary tests)` line.
- `.planning/REQUIREMENTS.md` still reads `| AGNT-07 | Phase 3 | Gaps Found |` — no requirement status flipped.

## Next Phase Readiness

The trust-boundary document now matches the compiled binary's measured behaviour for C6's friction class, with the branch decision and its rejected alternative on the record. Plan 03-38 (this plan's `affects`) can now write `ORDINARY_USAGE_CORPUS` rows pricing the corrected class against the claim this plan just pinned — the document-before-corpus ordering "The rule for round six" requires. No blockers.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*
