---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 03
subsystem: security
tags: [destructive-gate, trust-boundary, session-start-hook, claude-env-file, node, sidecar]

requires:
  - phase: 12-destructive-gate-trust-boundary-redesign
    provides: "12-01's amended docs/destructive-gate-trust-boundary.md (the SessionStart named residual row this plan's own hook satisfies) and 12-02's Layer 3 git-native pre-push gate"
provides:
  - "packages/sidecar/src/sessionstart-hook.ts: a SessionStart hook that writes the shim's shadow directory onto PATH via CLAUDE_ENV_FILE, degrading silently (never throwing) when it cannot"
  - "writeHookSettings' SessionStart entry, registered alongside the untouched PreToolUse array"
  - "packages/sidecar/test/sessionstart-hook.test.mjs: offline coverage for both the write arm and every degrade arm, plus the writeHookSettings settings-shape arm"
affects: [12-05]

actuals:
  tokens: 5572
  tasks: 2
  commits: 5
plan_head_before: cec03f712ec235512919ea9db4a7610c44c1a4e9

tech-stack:
  added: []
  patterns:
    - "A SessionStart hook writes a best-effort environment restoration via CLAUDE_ENV_FILE, with a deliberately silent-no-op failure mode distinct from pretooluse-hook.ts's fail-closed deny — the first hook in this codebase with no permission decision to make"

key-files:
  created:
    - packages/sidecar/src/sessionstart-hook.ts
    - packages/sidecar/test/sessionstart-hook.test.mjs
  modified:
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "The hook's whole body sits inside one try/catch whose catch leaves exit code 0, writes nothing to stdout/stderr, and creates no file — a design decision, not an accident: this hook makes no permission decision, so a throw here would risk aborting session startup over a best-effort PATH restoration."
  - "Shim directory derivation is read back from dirname(FLYWHEEL_SHIM_BIN), the SAME derivation pretooluse-hook.ts's shimWillIntercept already uses — never a second, independently-computed path."
  - "The RED/GREEN split for Task 1 (tdd=\"true\") used a compiling-but-inert stub (process.exitCode = 0, writes nothing) rather than an absent file — this produced a genuine assertion-level RED (ENOENT reading the never-written CLAUDE_ENV_FILE) instead of an import/load crash, satisfying gsd-tools check tdd-red-evidence's RED_EVIDENCE_OK verdict rather than an INVALID_RED fixture-crash classification."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "A SessionStart hook writes exactly one export PATH= line prepending the shim directory ahead of an unexpanded $PATH reference into CLAUDE_ENV_FILE when both CLAUDE_ENV_FILE and FLYWHEEL_SHIM_BIN are set, preserving any pre-existing file content"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#positive arm: writes a PATH-prepending line into CLAUDE_ENV_FILE"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#append arm: a pre-seeded marker line survives byte-for-byte"
        status: pass
    human_judgment: false
  - id: D2
    description: "The hook degrades silently (exit 0, no file, no stdout/stderr) when CLAUDE_ENV_FILE is unset, when FLYWHEEL_SHIM_BIN is unset, when CLAUDE_ENV_FILE names a path inside a non-existent directory, or when the shim directory contains a space (in which case the emitted line is quoted and parses under sh -n)"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#degrade arm: CLAUDE_ENV_FILE unset exits 0 and writes nothing"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#degrade arm: FLYWHEEL_SHIM_BIN unset exits 0 and creates no file"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#degrade arm: CLAUDE_ENV_FILE inside a non-existent directory exits 0 without throwing"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#degrade arm: a shim directory containing a space is quoted in the emitted line"
        status: pass
    human_judgment: false
  - id: D3
    description: "writeHookSettings registers a SessionStart entry (no matcher field) alongside the PreToolUse array, which is byte-identical before and after this plan, including with the authoring-stage-gate flag set"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#settings-shape arm: writeHookSettings carries a SessionStart entry alongside an untouched PreToolUse entry"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/sessionstart-hook.test.mjs#settings-shape arm: the authoring-stage-gate PreToolUse array length is unchanged by the SessionStart addition"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/execution-hook-settings.test.mjs (15 tests, unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No gate decision path changed: the full sidecar suite, including every LAUNCHER_CORPUS and ordinary-usage row, stays green — no benign command became a permission request"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test (223 tests, 217 pass, 0 fail, 6 skip — the real-binary-only tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CLAUDE_ENV_FILE ordering holds against the real shell snapshot on the installed claude binary in headless mode"
    requirement: AGNT-07
    verification: []
    human_judgment: true
    rationale: "Authored as a backstop truth, not claimed green by this plan — no offline harness can observe the snapshot-vs-env-file application order. Measured live by plan 12-05's scripts/uat/uat-11-env-file-ordering.mjs."

duration: ~7min (commit span; reading/context time not included)
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 3: SessionStart Hook for CLAUDE_ENV_FILE Summary

**A SessionStart hook writes the shim's shadow directory onto PATH via CLAUDE_ENV_FILE, registered in writeHookSettings alongside an untouched PreToolUse array, with a deliberately silent-no-op failure mode and the ordering guarantee honestly carried as unproven.**

## Performance

- **Duration:** ~7 min (commit span)
- **Started:** 2026-10-01T17:07:05+08:00
- **Completed:** 2026-10-01T17:13:35+08:00
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified) — plus one structural-gate test-file fix (deviation, see below)

## Accomplishments
- `packages/sidecar/src/sessionstart-hook.ts`: reads `CLAUDE_ENV_FILE`/`FLYWHEEL_SHIM_BIN`, derives the shim directory via the SAME `dirname(FLYWHEEL_SHIM_BIN)` derivation `pretooluse-hook.ts`'s `shimWillIntercept` already uses, and appends one quoted `export PATH="<shimDir>:$PATH"` line — the shim directory before an unexpanded `$PATH` reference, never a wholesale replacement. Whole body in one try/catch that degrades to a silent no-op (exit 0, nothing written, nothing printed) — a deliberate, documented difference from `pretooluse-hook.ts`'s fail-closed deny, since this hook makes no permission decision.
- Module doc comment names both research caveats by issue number (`anthropics/claude-code#27987`, `anthropics/claude-code#19357`), the `SessionStart`/`Setup`/`CwdChanged`/`FileChanged` scoping, and `scripts/uat/uat-11-env-file-ordering.mjs` (plan 12-05) as the live measurement this plan does not itself claim.
- `claude-code-adapter.ts`: `writeHookSettings` gains a `SessionStart` entry (no `matcher` field) alongside the existing `PreToolUse` array, which stays byte-identical — proven both by `git diff` on the construction block and by `execution-hook-settings.test.mjs`'s own 15 pre-existing tests passing unchanged.
- `packages/sidecar/test/sessionstart-hook.test.mjs`: 8 offline tests — the positive arm (with order and no-leaked-process-PATH assertions), the append arm, four degrade arms, and two settings-shape arms. Zero credential spend.
- The mandatory suite-wide benign arm: `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test` passes 217/217 (6 real-binary-only skips) — every `LAUNCHER_CORPUS` and ordinary-usage row in `destructive-gate.test.mjs` stayed green, proving the new `SessionStart` registration never turned a benign command into a permission request (12-RESEARCH.md Pitfall 3, round ten's own lesson).
- `pretooluse-hook.ts` and `packages/shim/src/main.rs` are byte-identical to their pre-plan state — this plan changes no gate decision path.

## Task Commits

Each task was committed atomically, with Task 1's TDD gate as two separate commits:

1. **Task 1 RED: failing test for the SessionStart hook** — `e69900c` (test) — a compiling-but-inert stub (`process.exitCode = 0`, writes nothing) produced a genuine assertion-level RED (ENOENT on the never-written `CLAUDE_ENV_FILE`), verified `RED_EVIDENCE_OK` by `gsd-tools check tdd-red-evidence` (record persisted at `.planning/phases/12-destructive-gate-trust-boundary-redesign/tdd-evidence/12-03-task1-red.json`)
2. **Task 1 GREEN: implement the SessionStart hook** — `14267b6` (feat)
3. **Task 2: both arms offline, plus the settings-shape arm** — `c194fc9` (test)
4. **Deviation fix: trust-boundary structural gate's heading search** — `3c524f4` (fix)
5. **Deviation fix: stray NUL bytes in the test file** — `54111a7` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/sidecar/src/sessionstart-hook.ts` - the SessionStart hook: reads env, derives shim dir, appends the PATH-prepending line, silent no-op on any failure
- `packages/sidecar/src/claude-code-adapter.ts` - `sessionStartHookScriptPath()` export; `writeHookSettings`'s new `SessionStart` entry; generalized write-failure log text
- `packages/sidecar/test/sessionstart-hook.test.mjs` - 8 offline tests covering both arms plus the settings-shape arm
- `packages/sidecar/test/destructive-gate.test.mjs` - one-line fix to an unrelated structural-gate test's heading search (see Deviations)

## Decisions Made
- The hook's silent-no-op failure mode is a deliberate, named difference from `pretooluse-hook.ts`'s fail-closed deny, documented in the module doc comment so a future reader does not "fix" it into fail-closed by analogy with its sibling.
- Shim directory derivation reuses `dirname(FLYWHEEL_SHIM_BIN)` exactly — no second, independently-computed path.
- Task 1's RED phase used an inert-but-compiling stub rather than withholding the file entirely, so the TDD gate's `check tdd-red-evidence` classified the run as a genuine assertion failure (`RED_EVIDENCE_OK`) rather than a load/fixture crash (`INVALID_RED`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Trust-boundary structural gate's heading search latched onto an inline quote, not the real heading**
- **Found during:** Task 2's own plan-level `<verify>` — the mandatory suite-wide benign-command run (`FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test`)
- **Issue:** `destructive-gate.test.mjs`'s "the recorded trust boundary ... D-62 item 3's structural gate" test used `content.indexOf("## Named residuals")` to locate the Named Residuals table's heading. `docs/destructive-gate-trust-boundary.md`'s own Layer 3 prose (landed in plan 12-01, unmodified by this plan) quotes that heading inline (`(see "## Named residuals" and "## The layer-to-corpus map" below)`) earlier in the file than the real heading — the bare substring search latched onto the quote, sliced a few lines of unrelated prose as "the section", and asserted it found 0 table rows. A false failure with no connection to the table's actual, unchanged content (still ≥ 8 rows).
- **Fix:** Anchored the search to `"\n## Named residuals"` (a heading at the start of a line), matching the newline-anchored pattern the same function already uses for `nextHeadingIndex` (`"\n## "`).
- **Files modified:** `packages/sidecar/test/destructive-gate.test.mjs` (test file only)
- **Verification:** The single test passes in isolation; the full suite-wide run passes 217/217 with 0 failures
- **Committed in:** `3c524f4` (fix)

**2. [Rule 1 - Bug] Stray NUL bytes written into a test file by my own editing tool call**
- **Found during:** staging the Task 2 commit — `git diff --stat` reported the file as binary (`Bin X -> Y bytes`, `0 insertions(+), 0 deletions(-)`)
- **Issue:** An `Edit` tool call containing the literal six-character JS escape sequence `\u0000` (intended as source text, to be interpreted by Node at runtime as a no-match sentinel) was instead written to disk as two literal NUL bytes, corrupting the file into binary.
- **Fix:** Replaced the sentinel-default trick with a plain guard needing no embedded sentinel at all (`!process.env.PATH || !lines[0].includes(process.env.PATH)`).
- **Files modified:** `packages/sidecar/test/sessionstart-hook.test.mjs`
- **Verification:** `file` reports clean UTF-8 text; a byte-level scan confirms zero NUL bytes in the committed blob; all 8 tests in the file still pass after rebuild
- **Committed in:** `54111a7` (fix)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes are test-infrastructure-only — neither touches `pretooluse-hook.ts`, `claude-code-adapter.ts`'s production code, or `packages/shim/src/main.rs` (all confirmed byte-identical to pre-plan state via `git diff --stat`). No scope creep into the gate's own decision logic.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Branch 1 of the ROADMAP's fork is implemented through the mechanism Claude Code documents for it (`CLAUDE_ENV_FILE`), with both known caveats written into the code, and the ordering uncertainty authored as a `backstop` truth rather than a pass.
- `writeHookSettings` now writes both `PreToolUse` and `SessionStart` entries; plan 12-04 (`--gate-push`) and plan 12-05 (the live `uat-11-env-file-ordering.mjs` falsification run) can both build on this without further sidecar-side wiring.
- `packages/sidecar/dist/sessionstart-hook.js` is produced by the standard build; `sessionStartHookScriptPath()` is the path a future caller (or plan 12-05's harness) should use rather than re-deriving it.
- `packages/shim/src/main.rs`'s string-literal baseline (`destructive_gate_no_new_launcher_tokens.rs`, plan 12-01) remains green — this plan touched no Rust source at all.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*

## Self-Check: PASSED

All created/modified files confirmed present on disk: `packages/sidecar/src/sessionstart-hook.ts`,
`packages/sidecar/src/claude-code-adapter.ts`, `packages/sidecar/test/sessionstart-hook.test.mjs`,
`packages/sidecar/test/destructive-gate.test.mjs`,
`.planning/phases/12-destructive-gate-trust-boundary-redesign/tdd-evidence/12-03-task1-red.json`.
All five task/deviation commits confirmed in `git log`: `e69900c`, `14267b6`, `c194fc9`, `3c524f4`,
`54111a7`. Plan-level `<verification>` re-run: `npm --prefix packages/sidecar run build` succeeds
and produces `dist/sessionstart-hook.js`; `node --test packages/sidecar/test/sessionstart-hook.test.mjs`
passes 8/8; `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test` passes
217/217 (6 real-binary skips, 0 failures); `git diff --stat packages/sidecar/src/pretooluse-hook.ts`
and `packages/shim/src/main.rs` are both empty.
