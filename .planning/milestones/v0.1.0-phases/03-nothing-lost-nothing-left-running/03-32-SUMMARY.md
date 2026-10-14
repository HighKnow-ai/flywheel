---
phase: 03-nothing-lost-nothing-left-running
plan: 32
subsystem: security
tags: [rust, shell-parsing, destructive-gate, classification, tdd, node-test]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "plan 03-31's WR-02 decision-invariance generator and the round-six finding it surfaced (env -S opaque-reparse defeated by a backslash-split env)"
provides:
  - "raw_text_names_opaque_env_reparse (C5): a presence-anywhere scan for an env token followed by an opaque/unrecognised flag, over both raw and quote-removed text"
  - "a second, quote-removed resolution pass inside classify_raw_command_text's segment loop, closing the backslash-split leading-token half of round six"
  - "docs/destructive-gate-trust-boundary.md's Round seven section and C5 contract clause"
  - "LAUNCHER_CORPUS rows keyed by a stable group marker (1-4) instead of an index-range slice"
  - "KNOWN_OPEN_BOUNDARY_FAILURES emptied and asserted empty — zero carried decision-invariance exceptions"
affects: [03-VERIFICATION.md, AGNT-07, "plan 03-33 (brace expansion, next in this bypass-class sequence)"]

# Actuals (#2632)
actuals:
  tokens: 13037
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presence-anywhere scanning (C5) as the fix shape for a positional/single-pass wrapper-recognition gap — mirrors C1-C4's own union-matching discipline rather than inventing a new mechanism"
    - "Corpus rows keyed by a stable field (group: N) instead of derived from array position — a same-length reorder can no longer mistag a slice"

key-files:
  created:
    - packages/shim/tests/classify_invocation.rs
  modified:
    - docs/destructive-gate-trust-boundary.md
    - packages/shim/src/main.rs
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "Implemented candidate fix direction (1) from 03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md — retry wrapper-token recognition against shell_quote_removed's output, plus a presence-anywhere C5 predicate — rejecting direction (2)'s character-adjacency over-deny heuristic, per the plan's own reasoning"
  - "C5 feeds only the safe verdict's text_can_shadow binding, never invoked_bare_name — preserves C4's rule that only C1's quote removal widens the non-safe branch's bare-name fact"
  - "WR-02: LAUNCHER_CORPUS rows now carry an explicit group field: N instead of a derived index-range slice, closing the reorder-defeats-tagging gap 03-REVIEW.md's WR-02 finding named"

requirements-completed: []  # AGNT-07 intentionally NOT marked complete — hard constraint: phase verification owns that call, not this plan

coverage:
  - id: D1
    description: "The backslash-split env -S form (round six) now classifies identically to its unobfuscated twin"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_seven_backslash_split_env_matches_unobfuscated"
        status: pass
    human_judgment: false
  - id: D2
    description: "The nested, unobfuscated sh -c 'env -S \"...\"' form (round seven) now reports textCanShadowPathResolution true, so the hook's D-61 AND-gate denies it"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_seven_nested_env_reparse_reports_can_shadow"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs — LAUNCHER_CORPUS group 2 rows (env -S \"-P ...\", sh -c 'env -S \"-P ...\"')"
        status: pass
    human_judgment: false
  - id: D3
    description: "C5 never denies a text naming no gated program — sh -c 'env -S \"echo hello\"' still defers"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c5_never_denies_a_text_naming_no_gated_program"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs — ORDINARY_USAGE_CORPUS row sh -c 'env -S \"echo hello\"'"
        status: pass
    human_judgment: false
  - id: D4
    description: "The decision-invariance sweep passes over the whole corpus with KNOWN_OPEN_BOUNDARY_FAILURES asserted empty — zero carried exceptions"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#decision invariance under obfuscation ... (WR-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GROUP_3_COMMANDS survives a same-length reorder of LAUNCHER_CORPUS (WR-02 closed)"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs — group-field assertions inside the invariance test and the main corpus test"
        status: pass
    human_judgment: false
  - id: D6
    description: "The trust-boundary document names round seven, carries a C5 clause with a stated soundness class, and its Named-residuals row reads CLOSED — written before any corpus row was added"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary ... D-62 item 3's structural gate"
        status: pass
    human_judgment: false

duration: 36min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 32: Round Seven — Opaque `env` Re-Parse, Closed by Presence Summary

**Closed both halves of round six's `env -S` opaque-reparse bypass — the backslash-split leading-token form and a newly-measured, zero-obfuscation nested form (`sh -c 'env -S "..."'`) — with a presence-anywhere C5 predicate and a quote-removed retry of the wrapper-token resolution, plus a corpus refactor (WR-02) that ties `LAUNCHER_CORPUS` rows to a stable `group` marker instead of an index-range slice.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-09-22T08:37:30+08:00 (first commit)
- **Completed:** 2026-09-22T09:13:18+08:00 (last commit)
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Amended `docs/destructive-gate-trust-boundary.md` FIRST, per its own "rule for round six": a new "Round seven" section records the measured facts (`env -S "-P ..."` → `uncategorized`; the backslash-split form → `safe`/`false`; the nested, unobfuscated `sh -c 'env -S "..."'` form → ALSO `safe`/`false`, with no obfuscation at all), a C5 contract clause states exactly what the new field's `false` is sound for, and the Named-residuals row for the `env` opaque re-parse flips from `OPEN` to `CLOSED (round seven, plan 03-32)`
- TDD'd `raw_text_names_opaque_env_reparse` (C5) in `packages/shim/src/main.rs`: a presence-anywhere scan over both the raw and quote-removed command text for a token equal to `env` followed by `-S`/`--split-string`/any unrecognised flag, folded into the safe verdict's own `text_can_shadow` disjunct — closes the nested-payload half of round six, the shape this plan newly measured
- Added a second, quote-removed resolution pass inside `classify_raw_command_text`'s segment loop, reaching the same fail-closed `ProgramResolution::Unresolvable` arm the raw pass already takes — closes the backslash-split leading-token half (round six proper)
- New integration test suite (`packages/shim/tests/classify_invocation.rs`, 6 tests) drives the compiled binary via `--classify-invocation` only (D-63), including the two AGNT-07 edge rows this plan owns: idempotency and concurrency
- Refactored `LAUNCHER_CORPUS` (WR-02, `03-REVIEW.md`'s finding) so every row carries a `group: N` field read directly off the four group comment banners, replacing the `GROUP_3_START_INDEX`/`GROUP_3_END_INDEX` slice a same-length reorder could silently mistag
- Added two round-seven `deny` rows to `LAUNCHER_CORPUS` (`env -S "-P /tmp git push --force"`, `sh -c 'env -S "-P /tmp git push --force"'`) and one `defer` falsifiability companion to `ORDINARY_USAGE_CORPUS` (`sh -c 'env -S "echo hello"'`)
- Emptied `KNOWN_OPEN_BOUNDARY_FAILURES` to `[]` and asserted it stays empty — the round-six exception plan 03-31 carried is now closed, not narrowed around

## Task Commits

Each task was committed atomically:

1. **Task 1: The boundary document names round seven before any code or corpus change** - `27eda82` (docs)
2. **Task 2: The shim sees an opaque `env` re-parse wherever it sits, obfuscated or not** - `94bf2aa` (test — RED), `d34c865` (feat — GREEN)
3. **Task 3: The corpus derives its groups from a marker, carries the env shapes, and carries no exception** - `de54bd3` (test)

_Task 2 was TDD (RED → GREEN); no REFACTOR commit was needed — the implementation required no cleanup pass after GREEN._

## Files Created/Modified
- `docs/destructive-gate-trust-boundary.md` - New "Round seven" narrative section, C5 contract clause, updated C1-C5 closing scope sentence, Named-residuals row flipped to CLOSED, layer-to-corpus map gains a round-seven row
- `packages/shim/src/main.rs` - `raw_text_names_opaque_env_reparse` (C5), a new disjunct in `text_can_shadow`, a quote-removed retry inside `classify_raw_command_text`'s segment loop, extended `ProgramResolution::Unresolvable` doc comment
- `packages/shim/tests/classify_invocation.rs` - New integration test file (6 tests) driving the compiled binary via `--classify-invocation`
- `packages/sidecar/test/destructive-gate.test.mjs` - `group` field on every `LAUNCHER_CORPUS` row, `GROUP_3_COMMANDS` derived by filter not slice, two new round-seven corpus rows, one new `ORDINARY_USAGE_CORPUS` row, `KNOWN_OPEN_BOUNDARY_FAILURES` emptied and asserted empty

## Decisions Made
- Implemented candidate fix direction (1) — retry wrapper-token recognition against `shell_quote_removed`'s output, plus a new presence-anywhere C5 predicate — over direction (2)'s character-adjacency over-deny heuristic, exactly as the plan's `<behavior>` block reasoned
- C5 feeds only `text_can_shadow` (the safe verdict's own field), never `invoked_bare_name` — preserves C4's rule that only C1's quote removal widens the non-safe branch's bare-name fact
- WR-02: corpus rows keyed by an explicit `group` field rather than a derived index-range slice, closing 03-REVIEW.md's same-length-reorder finding

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan text bug] Fixed the "unchanged" expected value for `source .venv/bin/activate && pytest`**
- **Found during:** Task 2 (writing the RED test)
- **Issue:** The plan's own `<behavior>`/`<acceptance_criteria>` state this command must report `"textCanShadowPathResolution":false"` (unchanged). Live measurement showed it is, and always was, `true` — the pre-existing `source` keyword trigger (`raw_text_can_shadow_path_resolution`'s `KEYWORD_TRIGGERS`), unrelated to `env`/C5, already fires on this exact command; `LAUNCHER_CORPUS`'s own Group 4 row for this command documents "a shadow construct (source) is present" for the same reason. Asserting `false` would have made the test assert something false about pre-existing, unrelated, correct behavior.
- **Fix:** Test asserts the correct, actually-unchanged pair: `namesGatedProgram:false` AND `textCanShadowPathResolution:true`, with an inline comment explaining the discrepancy and confirming C5 does not ADDITIONALLY misread `.venv` as an `env` token (it structurally cannot — `.venv/bin/activate` is one whitespace-delimited token, never equal to the literal token `env`).
- **Files modified:** `packages/shim/tests/classify_invocation.rs`
- **Verification:** `cargo test -p flywheel-shim --test classify_invocation` — `c5_leaves_ordinary_commands_determinate` passes
- **Committed in:** `d34c865` (test content committed as part of the RED commit `94bf2aa`, corrected before the GREEN commit)

**2. [Rule 1 - Bug in own edit] Fixed a self-inflicted break in the D-62 item 3 structural gate test**
- **Found during:** Task 3 (running the full `destructive-gate.test.mjs` suite)
- **Issue:** Task 1's own C5-clause edit appended `; C5 is implemented by plan 03-32...` onto the END of the pre-existing C-contract status sentence, changing its final character from `.` to `;` and breaking the exact-substring match `packages/sidecar/test/destructive-gate.test.mjs`'s structural gate test asserts (`...classify_raw_command_text's shadowable binding.` must appear verbatim).
- **Fix:** Split into two sentences — the original C1-C4 sentence preserved byte-for-byte (ending `binding.`), followed by a new sentence for C5.
- **Files modified:** `docs/destructive-gate-trust-boundary.md`
- **Verification:** `node --test --test-name-pattern="D-62 item 3" test/destructive-gate.test.mjs` — passes; full suite re-run confirmed 34/34 and 96/96
- **Committed in:** `de54bd3` (Task 3 commit)

**3. [Rule 1 - Bug in own edit] Rewrote the nested-env corpus row as a template literal**
- **Found during:** Task 3 (verifying the acceptance criterion "the file contains the literal `sh -c 'env -S "-P /tmp git push --force"'` as a corpus row command")
- **Issue:** The row was initially written as a double-quoted JS string with escaped inner double quotes (`"sh -c 'env -S \"-P /tmp git push --force\"'"`), which evaluates to the correct command value but does not contain the UNESCAPED literal substring in the raw source file — the acceptance criterion's "literal" grep could not match it.
- **Fix:** Rewrote the row using a template literal (backtick delimiter), which needs no escaping for either quote character and makes the raw source text byte-identical to the literal target.
- **Files modified:** `packages/sidecar/test/destructive-gate.test.mjs`
- **Verification:** Python substring check confirms the unescaped literal is present; `node --check` confirms valid syntax; full suite re-run confirmed 34/34
- **Committed in:** `de54bd3` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 plan-text bug, 2 self-inflicted edit bugs — all Rule 1)
**Impact on plan:** All three were required for correctness of the delivered tests and documentation; none changed the plan's scope or the shape of the fix. No scope creep.

## Issues Encountered
- **Pre-existing test flake, not caused by this plan's changes:** one run of `npm --prefix packages/sidecar test` (the full package suite, not just `destructive-gate.test.mjs` alone) showed `not ok 62 - falsifiability companion: with no PreToolUse hook opinion, the harmless command actually executes` — a real-`claude`-binary spawn test at `destructive-gate.test.mjs:2113`, unrelated to `LAUNCHER_CORPUS`/`ORDINARY_USAGE_CORPUS`/`KNOWN_OPEN_BOUNDARY_FAILURES`. Its own stdout dump shows a `SessionStart` hook injecting this environment's `superpowers:using-superpowers` skill content, consistent with timing/hook-contention noise from the full-suite run rather than a regression. Confirmed non-deterministic: standalone runs of `destructive-gate.test.mjs` alone (34/34 pass, twice) and two subsequent full-package re-runs (96/96 pass, twice) all passed cleanly. Out of scope per the executor's scope-boundary rule (not directly caused by this task's changes); not fixed.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None.

## Threat Flags
None — every change stays within this plan's own `<threat_model>` (T-03-32-01 through T-03-32-07, T-03-32-SC); no new endpoint, auth path, file-access pattern, or schema change was introduced.

## Self-Check: PASSED

- `packages/shim/tests/classify_invocation.rs` — FOUND
- `docs/destructive-gate-trust-boundary.md` — FOUND (modified, contains "Round seven", "C5 —", "CLOSED (round seven, plan 03-32)")
- `packages/sidecar/test/destructive-gate.test.mjs` — FOUND (modified, contains `group` field on every row, `GROUP_3_COMMANDS` derived by filter, `KNOWN_OPEN_BOUNDARY_FAILURES` emptied and asserted empty)
- `packages/shim/src/main.rs` — FOUND (modified, contains `raw_text_names_opaque_env_reparse`)
- Commit `27eda82` — FOUND in `git log --oneline --all`
- Commit `94bf2aa` — FOUND in `git log --oneline --all`
- Commit `d34c865` — FOUND in `git log --oneline --all`
- Commit `de54bd3` — FOUND in `git log --oneline --all`
- `cargo build --workspace` — exits 0
- `cargo test -p flywheel-shim --test classify_invocation` — exits 0, 6 passed, no "running 0 tests"
- `cargo test --workspace` — exits 0
- `npm --prefix packages/sidecar test` — exits 0, `# fail 0`, no `SKIPPED (shim-binary tests)` (re-confirmed twice after the deviations above)
- `npm --prefix packages/desktop run test` — exits 0 (regression check, no desktop file touched)
- All 4 round-seven classification probes from Task 2's acceptance criteria — manually re-verified, match exactly
- Decision-invariance sweep — 153 generated variants (≥141 required), 0 carried exceptions

## Next Phase Readiness
- Round seven (the nested/positional half of round six) is closed. The must_haves.truths this plan owns (decision invariance with `KNOWN_OPEN_BOUNDARY_FAILURES.length === 0`, idempotency, concurrency, non-inert new corpus row) all hold.
- `AGNT-07` is intentionally left `requirements-completed: []` in this SUMMARY's frontmatter and no `requirements.mark-complete` call was made — the plan's own hard constraint reserves that decision for `03-VERIFICATION.md`.
- Per the objective, the next bypass-class shape (brace expansion) is scoped for plan 03-33, not started here.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*
