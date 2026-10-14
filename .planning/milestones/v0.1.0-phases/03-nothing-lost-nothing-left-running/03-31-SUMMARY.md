---
phase: 03-nothing-lost-nothing-left-running
plan: 31
subsystem: security
tags: [destructive-gate, shell-parsing, rust, typescript, test-generation, trust-boundary]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-30's C1-C4 implementation and the boundary document's implemented status, this plan's precondition"
provides:
  - "obfuscationVariants(command, word) — a generator asserting decision invariance over every LAUNCHER_CORPUS row under three ordinary shell obfuscations, packages/sidecar/test/destructive-gate.test.mjs"
  - "ORDINARY_USAGE_CORPUS — nine asserted rows pricing C3's friction on ordinary agent commands"
  - "A bounded, per-attempt-secured retry on the live absolute-path measurement, de-flaking it without weakening its assertion"
  - "A NEW open finding (round six): env -S's opaque-reparse wrapper detection is defeated by a backslash-split env, proven live and non-destructively to reach zero human confirmation for a nested PATH-defeating payload (e.g. BSD env's -P altpath)"
affects: [03-round-seven, destructive-gate, security]

# Actuals (#2632)
actuals:
  tokens: 11265
  tasks: 3
  commits: 3
  plan_head_before: 75479fc

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mechanically-generated adversarial test coverage (obfuscationVariants) instead of hand-appended obfuscated corpus rows — a future corpus row gains coverage automatically"
    - "A single, precisely-scoped, falsifiability-checked exception (KNOWN_OPEN_BOUNDARY_FAILURES) for a genuinely open security finding, carried loudly in the test suite rather than silently narrowing the sweep around it"
    - "Bounded per-attempt security assertion (check the actual claim before the exit/timeout check) to de-flake a live-backend test without weakening what it proves"

key-files:
  created:
    - .planning/phases/03-nothing-lost-nothing-left-running/03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md
  modified:
    - packages/sidecar/test/destructive-gate.test.mjs
    - docs/destructive-gate-trust-boundary.md

key-decisions:
  - "KEYED_WORDS holds all 11 words the plan specified (function, alias, hash, eval, source, builtin, command, env, PATH, git, rm), matching the acceptance criterion literally — no word was quietly dropped to avoid the finding it surfaced."
  - "GROUP_3_COMMANDS is derived by array slice (indices 16-23) rather than hand-tagging 29 existing row objects with a group field — lower-risk (no edits to the existing, already-proven corpus rows), guarded by a length assertion inside the invariance test that fails loudly if the corpus's row count ever drifts."
  - "The one genuine decision-invariance break the sweep found (word env, row `env -S 'git push --force'`, backslash-split) is carried as a single, named, falsifiability-checked exception (KNOWN_OPEN_BOUNDARY_FAILURES) rather than silently narrowing KEYED_WORDS or the sweep to avoid it — per D-62/D-63's own safety constraint (report prominently, never quietly patch around a found bypass)."
  - "The underlying gap (resolve_segment_program_index's env-wrapper token-equality check is never retried against shell_quote_removed's output) is NOT fixed in this plan — main.rs is outside this plan's declared scope, the project's own 'rule for round six' requires the boundary document be corrected and a fix planned deliberately before code changes, and the fix approach itself needs a design decision (see 03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md's two candidate directions)."
  - "AGNT-07 was NOT marked complete, despite both declaring plans (03-30, 03-31) now having SUMMARYs and the shared-ID gate technically allowing it — the newly discovered finding makes 'always require explicit confirmation' unsupportable as written. The other seven carried requirements (WORK-03..06, PROC-03..05) WERE marked complete: their implementations are untouched, and the full workspace suite that proves them (cargo test --workspace, npm sidecar/desktop test) passes."

requirements-completed: [WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05]

coverage:
  - id: D1
    description: "obfuscationVariants generates decision-invariance adversaries (empty-double-quote, empty-single-quote, backslash splits, plus midpoint splits for Group 3) from every LAUNCHER_CORPUS row mechanically; the invariance test drives all of them through the real hook against the real shim and asserts the source row's decision"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'decision invariance under obfuscation…' (WR-02)"
        status: pass
      - kind: other
        ref: "temporarily reverted shell_quote_removed's call inside text_names_gated_program, confirmed the invariance test fails (not ok), restored and confirmed it passes again"
        status: pass
    human_judgment: false
  - id: D2
    description: "ORDINARY_USAGE_CORPUS prices C3's friction on nine ordinary agent commands (seven defer, two deny) as asserted rows"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'ORDINARY_USAGE_CORPUS…'"
        status: pass
      - kind: other
        ref: "target/debug/flywheel-shim --classify-invocation spot-checks (plan verify block), including rm -rf ./build measured directly"
        status: pass
    human_judgment: false
  - id: D3
    description: "The live absolute-path measurement is restructured into a bounded three-attempt loop asserting the victim directory survives on every attempt before checking whether the turn exited, de-flaking the test without weakening its security claim"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs — 'the shipped compiled hook blocks a destructive rm invoked by absolute path…'"
        status: pass
    human_judgment: false
  - id: D4
    description: "A genuine, live, non-destructively-proven boundary failure was found while building D1 (env -S's opaque-reparse wrapper detection defeated by a backslash-split env), reported prominently rather than patched silently: boundary document amended, a new findings doc filed, a single falsifiability-checked exception carried in the suite, AGNT-07 kept Gaps Found"
    requirement: AGNT-07
    verification:
      - kind: manual_procedural
        ref: "non-destructive real-shell proof (harmless stub named git ran instead of the shim at a BSD env -P altpath) plus --classify-invocation spot-checks, both recorded in 03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md"
        status: pass
    human_judgment: true
    rationale: "Whether this finding's disposition (carry as a documented exception, defer the fix to a round-seven plan) is the right call for the project is a judgment about acceptable risk exposure, not something a test can auto-pass."
  - id: D5
    description: "The other seven requirements carried on this plan (WORK-03..06, PROC-03..05) are re-proven by the full workspace suite passing (cargo test --workspace, npm --prefix packages/sidecar test, npm --prefix packages/desktop test) with no re-work"
    verification:
      - kind: integration
        ref: "cargo test --workspace; npm --prefix packages/sidecar test (96/96); npm --prefix packages/desktop test (440/440)"
        status: pass
    human_judgment: false

duration: "~2h across one executor session (substantial time on investigating and proving the round-six finding non-destructively before implementing)"
completed: 2026-09-21
status: complete
---

# Phase 03 Plan 31: The corpus manufactures its own adversaries — and immediately finds round six Summary

**A generator (`obfuscationVariants`) replaces hand-written obfuscated corpus rows with mechanically-derived decision-invariance adversaries over all 29 `LAUNCHER_CORPUS` rows × 11 keyed words (141 variants); the sweep found one genuine break — `env -S`'s opaque-reparse wrapper detection defeated by a backslash-split `env` — proven live and non-destructively to be a real, zero-human-confirmation bypass for a nested PATH-defeating payload, reported as a new open finding rather than silently patched.**

## Performance

- **Duration:** ~2h (see `duration` field) — most of it spent proving the round-six finding is real and non-destructive before writing it up
- **Started:** not separately timestamped at session start (continuation of an already-running executor context)
- **Completed:** 2026-09-21T12:45:07Z
- **Tasks:** 3 of 3 completed
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- **Task 1 (WR-02):** `obfuscationVariants(command, word)` generates decision-invariance adversaries — empty-double-quote, empty-single-quote, and backslash splits at offset-1 always, plus midpoint splits for the seven Group 3 rows — from every `LAUNCHER_CORPUS` row mechanically, asserted through the real compiled hook against the real compiled shim in a proven environment. `KEYED_WORDS` holds exactly the eleven words the gate's decision keys on, each traced to its exact location in `packages/shim/src/main.rs`. Confirmed the test actually exercises the C1-C4 contract by temporarily reverting `text_names_gated_program`'s `shell_quote_removed` call, observing a real failure, and restoring it. **Measured wall-clock: ~6.6-6.9 seconds for the full 141-variant sweep — well under the 30-second budget in Task 1(d); no coverage was dropped.**
- **Task 1 discovery (round six):** the 141-variant sweep found exactly one genuine decision-invariance break — word `env`, row `env -S 'git push --force'`, backslash-split. Root-caused to `resolve_segment_program_index`'s `env`-wrapper token-equality check (`tokenize_shell_words`, no backslash-escape resolution) never being retried against `shell_quote_removed`'s output, a mechanism C1-C4 was never designed to reach (C1-C4 protect only the safe-verdict's own two D-61 facts). Proven live and non-destructively (D-63): a harmless stub named `git` placed at a BSD `env -P` altpath ran INSTEAD of the shim, with the shim's shadow directory genuinely first on `PATH` and a bare `git status` control confirmed to reach the shim correctly — a real, zero-human-confirmation bypass for `env -S "-P <path> git ..."` once `env` is backslash-split. Per D-62/D-63's own safety constraint, this is reported prominently: `docs/destructive-gate-trust-boundary.md`'s Named residuals table and a new "Round six" section were amended, `03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` was filed, and the exact exception is carried in `KNOWN_OPEN_BOUNDARY_FAILURES` with its own falsifiability check (fails loudly if a future fix closes the gap without updating the list, or if a corpus/word-list change stops exercising it).
- **Task 2:** `ORDINARY_USAGE_CORPUS` prices C3's friction on ordinary agent commands as nine asserted rows (seven defer, two deny), each `why` naming the specific construct or its determinacy. `rm -rf ./build`'s defer expectation was measured directly against the shipped shim rather than assumed.
- **Task 3:** the live absolute-path measurement (`"the shipped compiled hook blocks a destructive rm invoked by absolute path…"`) now runs a bounded three-attempt loop, each with its own fresh scratch/victim/canary directory. The victim-directory assertion — the actual security claim — runs on every attempt before the exit check, so a timed-out turn with the victim gone still fails immediately; only a turn that never exited with the victim intact earns a retry. `SPAWN_DEADLINE_MS` unchanged; no other test gained a retry.

## Task Commits

Each task was committed atomically:

1. **Task 1: The corpus manufactures its own adversaries** — `9daf04b` (test) — includes the boundary-document amendment and the new findings doc, since the safety-constraint-mandated reporting is inseparable from the generator work that found it
2. **Task 2: The friction is a recorded fact, not an assumption** — `9f637e5` (test)
3. **Task 3: Bound the live absolute-path measurement** — `928fb99` (test)

**Plan metadata:** this commit (docs).

## Files Created/Modified

- `packages/sidecar/test/destructive-gate.test.mjs` — `obfuscationVariants`/`obfuscationVariantDetails` generator, `KEYED_WORDS`, `GROUP_3_COMMANDS`, `KNOWN_OPEN_BOUNDARY_FAILURES`, the decision-invariance test (Task 1); `ORDINARY_USAGE_CORPUS` and its driving test (Task 2); the bounded-retry absolute-path test (Task 3)
- `docs/destructive-gate-trust-boundary.md` — new Named residuals row plus a "Round six" narrative section documenting the `env -S` finding; C-contract status line unchanged (C1-C4 themselves are not regressed)
- `.planning/phases/03-nothing-lost-nothing-left-running/03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` — new findings doc (created), mirroring `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`'s structure

## Decisions Made

See `key-decisions` in frontmatter. In prose: the plan's own literal 11-word `KEYED_WORDS` list was implemented in full rather than narrowed to avoid the finding it surfaced; the one genuine break found is carried as a single, precisely-scoped, self-falsifying exception instead of being silently excluded from the sweep; the underlying fix (extending `resolve_segment_program_index`'s wrapper-token recognition, or over-denying deliberately) is deferred to a round-seven plan per the project's own "rule for round six" (boundary document first, code second, never folded into the plan that found the gap); AGNT-07 stays `Gaps Found` while the seven carried siblings (re-proven by the passing full suite, untouched implementations) were marked `Complete`.

## Deviations from Plan

### Auto-fixed / Escalated Issues

**1. [Rule 4 — architectural/security finding, resolved by documented carve-out rather than in-scope fix] Discovered a genuine round-six destructive-gate bypass while building the WR-02 generator**
- **Found during:** Task 1, sweeping all 141 generated variants against the real compiled shim
- **Issue:** `env -S 'git push --force'`'s backslash-split-`env` variant defers where the source row denies. Root cause and generalization (traced to `resolve_segment_program_index`'s `env`-wrapper token-equality never being retried against `shell_quote_removed`'s output) is a genuine, live, non-destructively-proven, zero-human-confirmation bypass for `env -S "-P <path> git ..."` — outside this plan's declared scope (`packages/shim/src/main.rs` is not in `files_modified`) and requiring a deliberate fix-approach decision per the project's own "rule for round six."
- **Fix:** NOT fixed in code this plan, by design — per D-62/D-63's own safety constraint ("report it prominently… do not quietly add a row and move on"). Instead: amended `docs/destructive-gate-trust-boundary.md` (new residual row + "Round six" section), filed `03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` with full reproduction (classification-only spot-checks plus a non-destructive live shell proof), and carried the exact exception in `KNOWN_OPEN_BOUNDARY_FAILURES` in the test file with a falsifiability check so it cannot silently go stale. AGNT-07 kept `Gaps Found`.
- **Files modified:** `docs/destructive-gate-trust-boundary.md`, `.planning/phases/03-nothing-lost-nothing-left-running/03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` (both outside the plan's declared `files_modified: [packages/sidecar/test/destructive-gate.test.mjs]`, added because the project's own boundary-correction-first process requires it)
- **Verification:** the exception's falsifiability check (`seenKnownFailures.has(entry)` assertion) passes today; a future fix to `main.rs` without updating `KNOWN_OPEN_BOUNDARY_FAILURES` will make the invariance test fail again at that exact combination, and a corpus change that stops exercising the exception fails the coverage assertion loudly
- **Committed in:** `9daf04b` (part of Task 1's commit)

---

**Total deviations:** 1 (Rule 4-class security finding, resolved by documented, falsifiability-checked carve-out rather than an in-scope code fix — no code outside the declared file was changed; only documentation).
**Impact on plan:** The plan's own objective — "make the enumeration catch itself, so round six is found by the test suite rather than by a person reading the source" — was achieved literally: round six WAS found by the generator, during this plan's own construction, before it ever shipped undetected. The plan's closure claim narrows accordingly: WR-02's generator is real, working infrastructure; AGNT-07 is not yet closable.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three tasks' deliverables are real, committed, and passing: the generator infrastructure, the friction table, and the de-flaked live test.
- `cargo test --workspace`, `npm --prefix packages/sidecar test` (96/96), and `npm --prefix packages/desktop test` (440/440) all pass.
- **AGNT-07 requirements status: NOT marked complete.** A genuine, newly discovered, non-destructively-proven bypass (round six — `env -S`'s opaque-reparse detection defeated by a backslash-split `env`) means "destructive actions always require explicit confirmation" is not yet supportable as written. See `03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` for the full finding and two candidate fix directions for a round-seven plan.
- WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05 marked `Complete` — re-proven by the passing full workspace suite, no re-work performed, matching this plan's own carriage framing.
- A round-seven plan is needed to close AGNT-07: either extend `resolve_segment_program_index`'s wrapper-token recognition to retry against `shell_quote_removed`'s output, or deliberately widen the trigger (deny on any quote/backslash adjacent to `env`/`command`/`builtin`), per the two candidate directions in the findings doc — this is a design decision, not folded into this plan.

## Self-Check: PASSED

- All 3 key files confirmed present on disk (`[ -f ]`): `packages/sidecar/test/destructive-gate.test.mjs`, `docs/destructive-gate-trust-boundary.md`, `03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md`.
- All 3 task commits (`9daf04b`, `9f637e5`, `928fb99`) confirmed present via `git log --oneline --all`.
- Plan-level `<verification>` re-run in full: `cargo build --workspace`, `cargo test --workspace` (all passing), `npm --prefix packages/sidecar test` (96/96), `npm --prefix packages/desktop test` (440/440).
- Acceptance criteria re-checked against source: `KEYED_WORDS` holds exactly 11 words; `obfuscationVariants` returns an empty array when the word does not occur and the documented variant counts otherwise; the invariance test drives every generated variant of every `LAUNCHER_CORPUS` row through `runHook`; `ORDINARY_USAGE_CORPUS` holds 9 rows (7 defer, 2 deny) each with a non-empty `why`; the absolute-path test's attempt loop is bounded at 3, asserts the victim directory on every attempt before the exit check, and `SPAWN_DEADLINE_MS` is unchanged.
- REQUIREMENTS.md verified by explicit `grep`: AGNT-07 remains unchecked/`Gaps Found`; WORK-03/04/05/06 and PROC-03/04/05 all read `[x]`/`Complete`.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*
