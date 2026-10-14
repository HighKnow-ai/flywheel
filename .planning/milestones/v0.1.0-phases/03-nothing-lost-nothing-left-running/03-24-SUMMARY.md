---
phase: 03-nothing-lost-nothing-left-running
plan: 24
subsystem: infra
tags: [destructive-gate, security-hardening, path-shadow, rust, node, tdd]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-19's shimWillIntercept environment proof and G-03-3 defer-to-shim wiring, 03-20/CR-01's text_can_shadow_path_resolution scan, and 03-DESTRUCTIVE-GATE-BYPASS-CLASS.md's recorded finding + D-59..D-63 decisions"
provides:
  - "The shim's safe verdict now reports two new text facts (textCanShadowPathResolution, namesGatedProgram) instead of a bare {\"category\":\"safe\"}"
  - "The hook's safe branch establishes the same environment proof (shimShadowDirectoryProven) its non-safe branch already required, denying every command — safe ones included — in an unprovable shim environment (D-60)"
  - "The hook denies a safe verdict whose text can shadow PATH resolution AND names a gated program (D-61), closing the quoted sh -c function-shadow bypass while leaving source/eval that name neither program untouched"
affects: [03-25, 03-26, 03-27, 03-28, security-review, agnt-07-closure]

# Actuals (#2632)
actuals:
  tokens: 8465
  tasks: 2
  commits: 3
  plan_head_before: a24c6927d9c093d7b9822da7a3591778a135fc90

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "raw_text_contains_word: an identifier-boundary raw-text scan (non-identifier char or string boundary on both sides) shared by text_names_gated_program and raw_text_can_shadow_path_resolution — deliberately over-triggering, never enumeration"
    - "A safe-verdict-only field pair (text_can_shadow, names_gated_program) computed ONCE per classify_raw_command_text call and threaded through every return path including both fail-closed early returns, mirroring the destructive arm's own fail-closed discipline"
    - "shimShadowDirectoryProven as a thin named wrapper over the pre-existing shimWillIntercept — one proof, two call sites (safe and non-safe branches), no new mechanism"

key-files:
  created: []
  modified:
    - packages/shim/src/main.rs
    - packages/sidecar/src/pretooluse-hook.ts
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "The safe branch's environment proof reuses shimWillIntercept with git/git.exe as the witness entry (never rm), so the proof holds independent of which program the safe command's text happens to name — install_for_run always installs the git shadow entry."
  - "text_can_shadow (the OR of the pre-existing token-level scan and the new raw-text scan) deliberately does NOT feed invoked_bare_name, which keeps its pre-existing, narrower, destructive-arm-only meaning — the destructive verdict's JSON stays byte-for-byte unchanged so every shipped assertion about it keeps its present meaning; only the safe verdict gets the blunter, over-triggering raw scan."
  - "The six pre-existing safe-verdict test assertions (bare {category:'safe'} shape) had to be updated within Task 1's own commit, not deferred entirely to Task 2 as the plan's task split implies — Task 1's own <verify> requires the whole test file to report 'fail 0', and node:assert/strict's deepEqual is deepStrictEqual (exact key-set match), so the production change breaks all six the instant it ships. Task 2 still owns its full scope (invariance assertions, the stale test-title rename, both module doc-comment rewrites) — its action (a) was already satisfied by the necessity above, verified rather than re-done."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "The shim's --classify-invocation safe verdict reports textCanShadowPathResolution and namesGatedProgram (B1-B4): an ordinary bare git command, a command naming neither gated program, the quoted sh -c function-shadow payload the token-level scan cannot see inside, and a shadowing construct that names neither gated program"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the shim's --classify-invocation mode reports textCanShadowPathResolution and namesGatedProgram on every safe verdict"
        status: pass
    human_judgment: false
  - id: D2
    description: "The hook defers a safe verdict only when the shim shadow directory is proven AND the text cannot both shadow PATH resolution and name a gated program (B5-B7): an ordinary command and a sh -c-wrapped bare destructive command still defer in a proven environment; the quoted function-shadow payload is denied even there"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook defers a safe verdict only when the shim shadow directory is proven AND the text cannot both shadow PATH resolution and name a gated program"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unprovable shim environment denies every command, safe ones included (B8-B9): the shadow directory present but not first on PATH, and FLYWHEEL_SHIM_BIN unset"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook denies every command, safe ones included, when the shim environment cannot be proven"
        status: pass
    human_judgment: false
  - id: D4
    description: "The destructive verdict's JSON, --classify-command's one-word output, and the missing-argument fail-closed line are all provably unchanged (three new invariance assertions)"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the destructive --classify-invocation verdict's key set is unchanged by this plan"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#--classify-command's one-word output is unchanged by this plan, for both a destructive and a safe input"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#--classify-invocation with no argument still fails closed to the two-key uncategorized line"
        status: pass
    human_judgment: false
  - id: D5
    description: "AGNT-07's full closure (D-62: adversarial corpus + live claude run + a recorded trust boundary) is NOT claimed by this plan — this is the tracer slice plans 03-25 through 03-28 expand from"
    verification: []
    human_judgment: true
    rationale: "D-62 explicitly requires a checked-in adversarial corpus, one live claude run, and a written trust boundary before AGNT-07 can leave Gaps Found; none of those three exist yet at the end of this plan. requirements-completed above declares AGNT-07 per this plan's own frontmatter (copied verbatim), but the shared-ID gate across 03-24..03-28 (all five plans declare AGNT-07) withholds marking it Complete in REQUIREMENTS.md until 03-28's summary also lands."

# Metrics
duration: 40min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 24: Destructive-Gate Bypass-Class Closure (Tracer) Summary

**The hook's safe branch now proves the same shadow-directory installation and PATH-shadow-plus-gated-program-name facts its non-safe branch already demanded, closing the eight-launcher-shape bypass class at the hook layer without adding a single token to the classifier's launcher list.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-09-21T00:16:35Z (approx., first RED commit)
- **Completed:** 2026-09-21T00:41:37Z
- **Tasks:** 2 (tracer + honesty pass)
- **Files modified:** 3

## Accomplishments

- `packages/shim/src/main.rs`'s `--classify-invocation` safe verdict now reports `textCanShadowPathResolution` (the OR of the pre-existing token-level scan and a new raw-text scan that can see inside a single-quoted `sh -c '…'` payload) and `namesGatedProgram` (a raw-text, identifier-boundary scan for the closed `git`/`rm` pair `install_for_run` shadows) — the destructive arm, `--classify-command`, and the missing-argument fail-closed line are all byte-for-byte unchanged.
- `packages/sidecar/src/pretooluse-hook.ts`'s safe branch establishes the SAME environment proof (`shimShadowDirectoryProven`, a thin wrapper over the pre-existing `shimWillIntercept`) its non-safe branch has required since plan 03-19: an environment the hook cannot prove denies EVERY command — `npm test` and `cargo build` included — not only destructive ones (D-60).
- The safe branch denies a verdict whose text can pre-empt PATH resolution AND names a gated program (D-61): `sh -c 'function git { /usr/bin/git "$@"; }; git push --force'` is now refused even in a perfectly-proven shim environment, while `source .venv/bin/activate && pytest` (shadows, names neither gated program) still defers.
- Nine new end-to-end rows (B1-B9), run through the REAL compiled shim and the REAL compiled hook (never the classifier in isolation) — plus three invariance assertions proving the destructive arm, `--classify-command`, and the missing-argument line never moved.
- Both module doc comments rewritten to describe the four-row branch table and the safe verdict's new fields, naming D-59, D-60 and D-61.

## Task Commits

Each task was committed atomically (Task 1 is TDD, so it carries a RED test commit and a GREEN feat commit):

1. **Task 1 RED — failing coverage for the safe-branch proof** - `7d7eb48` (test) — `RED_EVIDENCE_OK` per `gsd-tools check tdd-red-evidence` (18/21 pass, 3 fail: the three new tests, for the right reason)
2. **Task 1 GREEN — the safe branch proves, D-59/D-60/D-61** - `ed6a452` (feat) — 21/21 pass; also fixed the six pre-existing safe-verdict assertions (a build necessity for this commit's own `fail 0` requirement)
3. **Task 2 — invariance assertions, stale title rename, doc-comment rewrites** - `d6e5f33` (test) — 24/24 pass

**Plan metadata:** committed separately (see below).

_No REFACTOR commit — the GREEN implementation needed no cleanup pass._

## Files Created/Modified

- `packages/shim/src/main.rs` — `text_names_gated_program`, `raw_text_can_shadow_path_resolution`, their shared `raw_text_contains_word` primitive, two new `ClassifiedInvocation` fields, and the `Verdict::Safe` arm of `run_classify_invocation`
- `packages/sidecar/src/pretooluse-hook.ts` — `SHADOW_WITNESS_ENTRY_NAME`, `shimShadowDirectoryProven`, and the rewritten `category === "safe"` branch (three ordered steps: prove environment, apply D-61, defer)
- `packages/sidecar/test/destructive-gate.test.mjs` — nine new end-to-end rows, three invariance assertions, six updated pre-existing safe-verdict assertions, one renamed test title, two rewritten module doc comments (implicit via source file changes, not test file — see above)

## Decisions Made

See `key-decisions` in frontmatter. Summary: the shadow witness stays `git` (not `rm`) since `install_for_run` always installs it; `text_can_shadow` deliberately does not feed `invoked_bare_name`, preserving the destructive arm's exact pre-existing meaning; the six pre-existing safe-verdict test assertions were fixed inside Task 1's own commit (not deferred whole to Task 2) because Task 1's own `<verify>` requires the full file to report `fail 0` and `node:assert/strict`'s `deepEqual` is `deepStrictEqual` (exact key-set match) — Task 2 still owns and delivers its full documented scope (invariance assertions, stale-title rename, both doc-comment rewrites).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Six pre-existing safe-verdict test assertions fixed inside Task 1's own commit**
- **Found during:** Task 1 GREEN phase, first full-file test run after the production change
- **Issue:** The plan assigns "update the six stale safe-verdict assertions" to Task 2's action (a), but Task 1's own `<verify>` requires `node --test packages/sidecar/test/destructive-gate.test.mjs` to report `# fail 0` across the WHOLE file. Since `node:assert/strict`'s `deepEqual` is an alias for `deepStrictEqual` (exact own-enumerable-key-set match, not a subset check), the moment the safe verdict's JSON shape grows two keys, all six pre-existing `assert.deepEqual(result, { category: "safe" })` rows fail with extra-key mismatches — a hard blocker to Task 1's own commit being green.
- **Fix:** Updated all six assertions within Task 1's GREEN commit to the correct three-key shape (values computed and verified against the real binary first, not guessed).
- **Files modified:** `packages/sidecar/test/destructive-gate.test.mjs` (lines inside the pre-existing bare-name/absolute-path test, the CR-01 shadow test, and the `command`/`builtin` unwrap test)
- **Verification:** `node --test` reports `# fail 0` immediately after Task 1's commit; Task 2's own acceptance criteria for these same six rows (exact `textCanShadowPathResolution: false, namesGatedProgram: true` shape, still `deepEqual`, still `category: "safe"`) are satisfied by the same edit, so Task 2 needed no further change to these lines — its remaining, genuinely new work (invariance assertions, title rename, doc comments) is unaffected.
- **Committed in:** `ed6a452` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — an ordering necessity forced by the RED/GREEN gate's own "fail 0" requirement, not a defect in the plan's substance).
**Impact on plan:** None on scope or correctness. Task 2's documented acceptance criteria for the six assertions are still met; its commit's diff for them is a no-op confirmation rather than a first fix, and its own new deliverables (invariance assertions, stale-title rename, doc-comment rewrites) are unaffected and fully delivered.

## Issues Encountered

None. One flaky, pre-existing, environment-constrained test failure was observed on a single `npm --prefix packages/sidecar test` run (documented in `deferred-items.md` for this phase as a known grandchild-process-spawning sandbox constraint, unrelated to any file this plan touches) and self-resolved on immediate re-run (86/86 pass) — not chased further, per the plan's own `<verification>` instruction to record rather than chase environment-constrained failures.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The destructive-gate bypass class is closed at the hook layer for the eight recorded launcher shapes and the quoted function-shadow case — a real agent session with a correctly-proven shim environment can no longer receive strictly less scrutiny for `sh -c "git push --force"` than for the bare form, and a misconfigured shim environment now refuses everything instead of silently deferring.
- **AGNT-07 stays `Gaps Found`, as designed.** D-62 requires a checked-in adversarial corpus asserted through the real hook against the real shim (plan 03-25 or 03-26), one live `claude` run (plan 03-26/03-27 territory), and a written trust boundary (plan 03-28) before the requirement can close. This plan is the tracer slice those plans expand from — its own `<verify>` was re-run end-to-end (tracer feedback gate) and passed before Task 2 began, per `workflow.human_verify_mode: end-of-phase` with no `<human-check>` in Task 1's `<verify>`.
- `sudo git push --force` remains an explicitly-recorded residual (planner_assumptions #4 in `03-24-PLAN.md`) — `sudo`'s `secure_path` can replace `PATH` before the inner `git` resolves, and closing it would require enumerating `sudo`, which D-59 rejected. Plan 03-28 records it as a named, unseen case in the trust boundary.
- No destructive git command was executed and no remote was contacted at any point while working this plan (D-63 honored throughout — every verification was pure classification via `--classify-invocation`/`--classify-command`, or hook decisions run through `runHook`/`makeShimDir` scratch directories, never a real `git push`/`rm`).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*

## Self-Check: PASSED

- FOUND: `packages/shim/src/main.rs`
- FOUND: `packages/sidecar/src/pretooluse-hook.ts`
- FOUND: `packages/sidecar/test/destructive-gate.test.mjs`
- FOUND commit: `7d7eb48` (test — RED)
- FOUND commit: `ed6a452` (feat — GREEN)
- FOUND commit: `d6e5f33` (test — Task 2)
- Re-ran plan-level `<verification>`: `cargo build --workspace` succeeds; `npm --prefix packages/sidecar run build && node --test packages/sidecar/test/destructive-gate.test.mjs` reports 24/24 pass, `# fail 0`, no `SKIPPED (shim-binary tests)` line; `npm --prefix packages/sidecar test` reports 86/86 pass; `cargo test --workspace` shows no `test result: FAILED` line; `git diff --stat a24c6927..HEAD` names exactly the three `files_modified` files.
