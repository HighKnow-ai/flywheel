---
phase: 03-nothing-lost-nothing-left-running
plan: 26
subsystem: infra
tags: [destructive-gate, security-hardening, adversarial-corpus, node, test]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-24's safe-branch environment proof (shimShadowDirectoryProven) and D-61 text-shadow rule; 03-DESTRUCTIVE-GATE-BYPASS-CLASS.md's eight launcher shapes and four-round table; 03-VERIFICATION.md's grep finding that no launcher token existed anywhere in destructive-gate.test.mjs"
provides:
  - "LAUNCHER_CORPUS: 29 checked-in rows ({command, expect, why}) covering the eight launcher shapes from the finding, the four wrapper families from rounds 1-4, six shadow shapes (function()/function-keyword/alias/hash/eval/source, plus the rm() counterpart), and six D-61 non-trigger/harmless controls -- every row asserted through runHook (the real compiled hook) against a real compiled makeShimDir shim, never destructive::classify in isolation"
  - "The unprovable matrix: every LAUNCHER_CORPUS row plus four harmless controls, driven through three separately-broken environments (FLYWHEEL_SHIM_BIN unset; shim directory present but not first on PATH; shim directory leading PATH but missing its git witness entry), each constructed to defeat exactly one condition of shimShadowDirectoryProven's proof"
  - "The never-no-opinion invariant: one assertion over every decision the unprovable matrix produced, requiring none is an empty-object/exit-0 no-opinion decision -- the regression detector for a future unproven short-circuit on any branch"
  - "The falsifiability companion: the same corpus re-run in a freshly-proven environment must still produce at least one no-opinion decision, so a silently-broken harness cannot pass the matrix vacuously"
  - "The two AGNT-07 edge-probe tests: idempotency (two runs of an identical payload/env produce byte-identical stdout and exit status) and concurrency (two parallel invocations against different shim directories each receive their own verdict, proving D-57's no-local-cache-by-construction structurally)"
affects: [03-27, 03-28, agnt-07-closure, security-review]

# Actuals (#2632)
actuals:
  tokens: 5655
  tasks: 2
  commits: 2
  plan_head_before: 0a0aebb3f02c5143a6f6f763210e36dddc467f38

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LAUNCHER_CORPUS: a checked-in {command, expect, why} table, grouped by provenance (finding / rounds 1-4 / D-61 shadow shapes / D-61 non-triggers), iterated through the SAME runHook/makeShimDir helpers the file's earlier CR-01 table established -- extension, not a parallel mechanism"
    - "runHookRaw / runHookAsync: two narrow siblings of the existing runHook, added only because the idempotency test needs raw byte-for-byte stdout comparison and the concurrency test needs a genuinely overlapping (spawn, not spawnSync) pair of invocations -- both still call the SAME shipped hook script"
    - "Broken-environment construction as a defeat-exactly-one-condition matrix: each of the three environments is built to fail ONE named stat/comparison inside shimWillIntercept, documented in-line, so a future regression names which condition stopped being checked"

key-files:
  created: []
  modified:
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "The rm-witness-missing environment (condition 3) is built as makeShimDir([\"rm\"]) with FLYWHEEL_SHIM_BIN pointing at that SAME directory's rm entry -- a real, functioning copy of the compiled shim binary that can still classify (since --classify-invocation is checked before the argv[0]-stem dispatch), satisfying the plan's 'a separate real copy of the shim binary so classification still works' requirement while leaving the git witness entry genuinely absent for shimWillIntercept('git') to fail on."
  - "The idempotency test's three representative rows are npm test (defers), the exact sh -c 'function git { ... }; git push --force' text already used as B3/B7 elsewhere in this file (denied by D-61's text rule), and git status run under an unset-FLYWHEEL_SHIM_BIN environment (denied by D-60's environment rule) -- one row per rule this closure introduced, not an arbitrary sample."
  - "Group 2's eight rows deliberately duplicate existing hook-level assertions elsewhere in this file (the CR-01 measured table, the env-flag-audit test) rather than being deduplicated -- per 03-26-PLAN.md's own instruction, one readable table is worth the duplication and a future reader must not delete either copy as redundant."

requirements-completed: []

coverage:
  - id: D1
    description: "LAUNCHER_CORPUS (29 rows) asserted through the real hook against the real shim in a proven environment: the eight launcher shapes from the finding, the four wrapper families from rounds 1-4, six shadow shapes (function/function-keyword/alias/hash/eval/source + rm counterpart), and six D-61 non-trigger/harmless controls"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#LAUNCHER_CORPUS: every launcher shape, wrapper family, shadow shape and non-trigger control, asserted through the real hook against the real shim in a proven environment"
        status: pass
    human_judgment: false
  - id: D2
    description: "The unprovable matrix: LAUNCHER_CORPUS plus four harmless controls deny under three separately-broken environments; the never-no-opinion invariant over the whole matrix; the falsifiability companion proving the proven environment still no-opinions at least once"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the unprovable matrix: every LAUNCHER_CORPUS row plus the harmless controls denies under three separately-broken environments, no decision anywhere in that matrix is a no-opinion decision, and the same corpus in the proven environment still produces at least one"
        status: pass
    human_judgment: false
  - id: D3
    description: "The idempotency edge (two runs of the same payload/env are byte-identical) and the concurrency edge (two parallel invocations against different shim directories each get their own verdict), the two AGNT-07 edge-probes this closure resolves as tests rather than prose"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#idempotency: running the hook twice on an identical payload under an identical environment produces byte-identical stdout and the same exit status (AGNT-07's idempotency edge)"
        status: pass
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#concurrency: two hook invocations running in parallel against two different shim directories — one proven, one missing the witness entry — each receive their own verdict (AGNT-07's concurrency edge, D-57's no-local-cache-by-construction)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AGNT-07's full closure (D-62: adversarial corpus + one live claude run + a recorded trust boundary) is NOT claimed complete by this plan alone -- this plan supplies D-62 item 1 only; item 2 (the live run) is plan 03-27's and item 3 (the written trust boundary) is plan 03-28's"
    verification: []
    human_judgment: true
    rationale: "requirements-completed is deliberately left empty in this plan's own frontmatter (unlike 03-24, which named AGNT-07 under the shared-ID gate). D-62 requires three artifacts before AGNT-07 can leave Gaps Found; only the first exists at the end of this plan. REQUIREMENTS.md is not touched by this plan."

# Metrics
duration: 27min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 26: The Checked-In Adversarial Corpus (D-62 Item 1) Summary

**`packages/sidecar/test/destructive-gate.test.mjs` now carries a 29-row `LAUNCHER_CORPUS` covering every shape that has ever bypassed the destructive gate, asserted through the real compiled hook against a real compiled shim in both a proven environment and three separately-broken ones, plus the two AGNT-07 idempotency/concurrency edge-probes — closing the "classifier-only coverage" gap D-62 named as the reason every one of the first four rounds shipped unmeasured.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-09-21T01:01:00Z (approx.)
- **Completed:** 2026-09-21T01:28:18Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- `LAUNCHER_CORPUS` — 29 rows (`{command, expect, why}`), grouped by provenance: Group 1 (8 rows) the eight launcher shapes from the finding (`sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`), all deferring because the launcher itself is the `Safe` program token and nothing in the text can pre-empt PATH resolution; Group 2 (8 rows) the four wrapper families from rounds 1-4 (`env`, `command`, `builtin`, `PATH=`); Group 3 (7 rows) the shadow shapes — function-call, `function`-keyword, `alias`, `hash`, `eval`, `source`, and the `rm()` counterpart — each wrapped in `sh -c` so the verdict lands on the SAFE branch and only D-61's raw-text scan catches it; Group 4 (6 rows) the D-61-protected non-triggers (`source .venv/bin/activate && pytest`, `eval "$(direnv hook bash)"`) plus harmless controls (`npm test`, `cargo build`, `git status`, `command -v git`).
- Every row driven through `runHook` (the shipped, compiled `pretooluse-hook.ts`) against a single `makeShimDir(["git", "rm"])` directory — the real compiled `flywheel-shim` binary under both shadowed names — never `destructive::classify` in isolation, per D-62's own binding level.
- The unprovable matrix: the SAME 29 rows plus four harmless controls (`npm test`, `cargo build`, `ls -la`, `git status`) driven through three environments, each built to defeat exactly ONE condition of `shimShadowDirectoryProven`'s proof — `FLYWHEEL_SHIM_BIN` unset; the shim directory present but not PATH's first entry; the shim directory leading PATH but missing its `git` witness entry (satisfied by a separate real shim copy installed under `rm` in the same directory, so classification itself still works and only the witness stat fails). All ~33×3 = 99 decisions deny.
- The never-no-opinion invariant: one assertion collects every decision the matrix above produced and requires none is an empty-object/exit-0 no-opinion decision — the regression detector D-60 exists for.
- The falsifiability companion: the same corpus re-run in a freshly-built proven environment still produces at least one no-opinion decision, so a silently-broken harness could not have passed the matrix above vacuously.
- The idempotency test: `npm test` (defers), the exact `sh -c 'function git { ... }; git push --force'` text already used elsewhere in the file as B3/B7 (denied by D-61's text rule), and `git status` under an unset `FLYWHEEL_SHIM_BIN` (denied by D-60's environment rule) each run twice; byte-identical stdout and exit status asserted both times.
- The concurrency test: two hook invocations launched together via `Promise.all` against two different shim directories (one proven, one missing the `git` witness) on the identical command text; each receives its own verdict, proving D-57's no-local-cache-by-construction structurally rather than as a comment.

## Task Commits

Each task was committed atomically:

1. **Task 1: The corpus, asserted through the real hook against the real shim in a proven environment** - `60e8f4a` (test)
2. **Task 2: The same corpus in three broken environments, and the invariant that no row escapes** - `36d3ce4` (test)

**Plan metadata:** committed separately (see below).

## Files Created/Modified

- `packages/sidecar/test/destructive-gate.test.mjs` — `LAUNCHER_CORPUS` (29 rows), the proven-environment corpus test, the unprovable-matrix test (three broken environments + the never-no-opinion invariant + the falsifiability companion), the idempotency test, and the concurrency test. `runHookRaw`/`runHookAsync` added as narrow siblings of the pre-existing `runHook` helper. No production file touched.

## Decisions Made

See `key-decisions` in frontmatter. Summary: the rm-witness-missing environment reuses a real, functioning shim copy installed under the `rm` name in the same directory so classification still works while the `git` witness genuinely stays absent; the idempotency test's three rows are one-per-rule (defers, D-61 text denial, D-60 environment denial), not an arbitrary sample; Group 2's eight rows deliberately duplicate existing hook-level assertions elsewhere in the file, per the plan's own instruction that one readable table is worth the duplication.

## Deviations from Plan

None — plan executed exactly as written. No source file was touched, no existing assertion was weakened or removed, and every corpus row was asserted purely through `runHook`/`makeShimDir` scratch directories — no corpus row was ever run in a real shell, no remote was contacted, and no branch or worktree was created or deleted (D-63).

## Issues Encountered

**One pre-existing, environment-constrained test failure, unrelated to this plan's diff.** The single required end-of-plan `npm --prefix packages/sidecar test` run (90 tests) showed 89 passed / 1 failed. The sole failure — `"the shipped compiled hook blocks a destructive rm invoked by absolute path — the class the shim cannot see"` — is a real-`claude`-session test that predates this plan (this plan did not write or modify it) and timed out at its own 90000ms deadline while running inside the full 90-test suite; the identical test passed cleanly (27s) when `destructive-gate.test.mjs` was run in isolation both before and after this plan's changes, and `03-24-SUMMARY.md` records an identical single-run flake that self-resolved on immediate retry. `deferred-items.md` already names `destructive-gate.test.mjs` among the files affected by this execution environment's "grandchild-process spawning" constraint (its third entry). Recorded here, not chased, per this plan's own `<verification>` instruction to run the full suite once and record rather than chase environment-constrained failures. `deferred-items.md` itself was not edited — out of this plan's one-file scope boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-62 item 1 (the checked-in adversarial corpus, asserted through the real hook against the real shim, in both a proven and three broken environments) is satisfied by this plan. `AGNT-07` stays `Gaps Found`, as designed by 03-24/03-25/03-26/03-27/03-28's shared-ID gate — `requirements-completed` is deliberately left empty in this plan's own frontmatter.
- Plan 03-27 needs D-62 item 2: one live `claude` run measuring one of this corpus's rows end to end (the tracer measurement the eight-launcher-shapes group's `why` fields point at).
- Plan 03-28 needs D-62 item 3: the written trust boundary — `sudo`'s `secure_path` residual is named in this corpus's own `why` field (the `sudo git push --force` row) but the corpus does not and cannot close it; that write-up is 03-28's deliverable.
- `sudo git push --force` remains the one explicitly-named residual this corpus records but does not close, consistent with 03-24's own `planner_assumptions` #2 and D-59's rejection of enumerating `sudo` further.
- No destructive git command was executed and no remote was contacted at any point while working this plan (D-63 honored throughout — every verification was pure classification via `--classify-invocation`, or hook decisions run through `runHook`/`runHookRaw`/`runHookAsync`/`makeShimDir` scratch directories, never a real `git push`/`rm`).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*

## Self-Check: PASSED

- FOUND: `packages/sidecar/test/destructive-gate.test.mjs`
- FOUND commit: `60e8f4a` (test — Task 1)
- FOUND commit: `36d3ce4` (test — Task 2)
- Re-ran plan-level `<verification>`: `cargo build --workspace` succeeds; `npm --prefix packages/sidecar run build && node --test packages/sidecar/test/destructive-gate.test.mjs` reports 28/28 pass, `# fail 0`, no `SKIPPED (shim-binary tests)` line; `npm --prefix packages/sidecar test` reports 89/90 pass (the one failure is the pre-existing, environment-constrained flake documented above, not caused by this plan); `git diff --stat 0a0aebb3f02c5143a6f6f763210e36dddc467f38..HEAD` names exactly one file, `packages/sidecar/test/destructive-gate.test.mjs`.
