---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 05
subsystem: security
tags: [destructive-gate, trust-boundary, uat, claude-env-file, session-start-hook, path-ordering, live-measurement]

requires:
  - phase: 12-destructive-gate-trust-boundary-redesign
    provides: "12-03's SessionStart hook writing CLAUDE_ENV_FILE (the mechanism this plan measures) and 12-04's --gate-push ask branch (the discriminator probe 3 measures)"
provides:
  - "scripts/uat/uat-11-env-file-ordering.mjs: a live UAT item with a --selftest non-credential arm, measuring P1 restoration, git --version's ordinariness, and FLYWHEEL_PERMISSION_SOCKET's survival into the command shell, in one real headless session"
  - "docs/destructive-gate-trust-boundary.md: the CLAUDE_ENV_FILE ordering claim promoted from [CITED] to [VERIFIED], dated and version-pinned; the SessionStart residual row narrowed to its two remaining open caveats"
affects: []

actuals:
  tokens: 7500
  tasks: 2
  commits: 2
plan_head_before: 8d09aa9abba704ef4a13070ed1b2ea0421548c3e

tech-stack:
  added: []
  patterns:
    - "A live UAT item factors its verdict logic into small pure functions shared by a --selftest arm (hand-constructed evidence, zero credentials) and the live arm (real session output), so a green self-test proves the harness's own assertions are exercised rather than merely present"

key-files:
  created:
    - scripts/uat/uat-11-env-file-ordering.mjs
  modified:
    - scripts/uat/run-all.sh
    - docs/destructive-gate-trust-boundary.md

key-decisions:
  - "Measured the real product wiring directly (the agent's own command shell's first PATH segment vs. the run's shim directory) instead of 12-RESEARCH.md's stub-git sketch — same question (is P1 restored), no fake git, no second settings file, strictly cheaper. Recorded as a deliberate deviation in the plan's own objective, not discovered during execution."
  - "Probe 2 (git --version stays ordinary) is coded as a hard assert, never a recordable negative outcome — a failure there means revert the responsible change, not document a regression, per round ten's own precedent."
  - "The live credentials were spent by the human (Task 2's precondition), not re-spent by this continuation — the artifact and its three verdicts were read back from disk rather than re-measured."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "scripts/uat/uat-11-env-file-ordering.mjs exists, registers in run-all.sh, asserts on files its probes write (never the transcript), skips rather than passes without a backend, and carries a --selftest arm that exercises the same verdict functions with three negative cases"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "node scripts/uat/uat-11-env-file-ordering.mjs --selftest"
        status: pass
      - kind: other
        ref: "bash -n scripts/uat/run-all.sh"
        status: pass
      - kind: other
        ref: "grep -c 'uat-11-env-file-ordering.mjs' scripts/uat/run-all.sh (>=1)"
        status: pass
      - kind: other
        ref: "git diff --numstat -- scripts/uat/run-all.sh (0 deleted lines)"
        status: pass
    human_judgment: false
  - id: D2
    description: "In a real headless bypassPermissions session, the first PATH segment of the agent's own command shell is Flywheel's shim directory for that run — P1 restored by CLAUDE_ENV_FILE (AGNT-07 backstop truth)"
    requirement: AGNT-07
    verification:
      - kind: manual_procedural
        ref: "scripts/uat/uat-11-env-file-ordering.mjs live run, artifact /var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-artifacts/uat-11-env-file-ordering-2026-10-01T10-04-00-983Z-probes.json, probe1.verdict=\"restored\""
        status: pass
    human_judgment: true
    rationale: "Authored as a backstop truth per 12-05-PLAN.md's must_haves — the verifier must route this to human_needed rather than auto-pass it, even though the artifact already shows a pass. One macOS measurement against claude 2.1.285 in bypassPermissions mode; does not generalise to Windows, other versions, or other permission modes."
  - id: D3
    description: "In that same session, git --version returns a tool result and never becomes a permission request (AGNT-07 backstop truth)"
    requirement: AGNT-07
    verification:
      - kind: manual_procedural
        ref: "scripts/uat/uat-11-env-file-ordering.mjs live run, same artifact, probe2.verdict=\"success\""
        status: pass
    human_judgment: true
    rationale: "Authored as a backstop truth per 12-05-PLAN.md's must_haves. The harness itself hard-asserts this (a failure throws, it is never recorded as a documented negative), but the verifier still routes the live guarantee to human_needed rather than auto-passing it."
  - id: D4
    description: "In that same session, FLYWHEEL_PERMISSION_SOCKET is present in the agent's own Bash command shell environment — the discriminator the pre-push layer's ask branch depends on (AGNT-07 backstop truth)"
    requirement: AGNT-07
    verification:
      - kind: manual_procedural
        ref: "scripts/uat/uat-11-env-file-ordering.mjs live run, same artifact, probe3.verdict=\"present\""
        status: pass
    human_judgment: true
    rationale: "Authored as a backstop truth per 12-05-PLAN.md's must_haves — the verifier must route this to human_needed rather than silently passing it."
  - id: D5
    description: "docs/destructive-gate-trust-boundary.md's P1 material and SessionStart residual row reflect the ACTUAL measured verdicts, not a hoped-for result"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "grep -c CLAUDE_ENV_FILE docs/destructive-gate-trust-boundary.md (>=1); git diff --numstat -- docs/destructive-gate-trust-boundary.md (0 deleted sections, both edits additive/narrowing)"
        status: pass
    human_judgment: false

duration: ~12 min (Task 1 commit span) + a human-paced credential-spending gap before this continuation's ~6 min documentation pass
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 5: Live `CLAUDE_ENV_FILE` Ordering Measurement Summary

**One real headless `bypassPermissions` session measured all three of this phase's open live guarantees at once — P1 restored, `git --version` ordinary, `FLYWHEEL_PERMISSION_SOCKET` present — promoting the `CLAUDE_ENV_FILE` ordering claim from `[CITED]` to `[VERIFIED]` against `claude 2.1.285`.**

## Performance

- **Duration:** ~12 min (Task 1's commit span); this continuation's documentation pass (Task 2) ran after the human spent the live credentials separately
- **Started:** 2026-10-01T09:49Z (Task 1)
- **Completed:** 2026-10-01T10:10:28Z (Task 2, this continuation)
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `scripts/uat/uat-11-env-file-ordering.mjs`: a live UAT item spawning exactly ONE real session through the harness's normal `startSidecar()`/`op: "spawn"` path (exercising the product's own `writeHookSettings`, never a composed settings file), asking the agent's own Bash shell three questions and asserting on the files each command writes — never on the transcript's narration. Probe 1 compares the shell's first `PATH` segment against the run's shim directory (`restored`/`snapshot-won`); probe 2 bounds its wait for `git --version`'s `tool_result` against round ten's 120s precedent and hard-fails (never records a negative) on anything but success; probe 3 writes whether `FLYWHEEL_PERMISSION_SOCKET` reached the shell (`present`/`absent`). A `--selftest` flag exercises the same three pure verdict functions offline, with three negative cases, so a green live run can never be vacuous the way UAT 6a's was.
- Registered in `scripts/uat/run-all.sh` as one new line in numeric sequence after uat-10, with zero existing lines deleted.
- The live run was spent once (by the human, per Task 2's `<precondition>`) against `claude 2.1.285 (Claude Code)`. All three verdicts: **probe1 = `restored`**, **probe2 = `success`**, **probe3 = `present`** — artifact at `/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-artifacts/uat-11-env-file-ordering-2026-10-01T10-04-00-983Z-probes.json`.
- `docs/destructive-gate-trust-boundary.md` amended: the `CLAUDE_ENV_FILE` claim promoted from `[CITED: code.claude.com/docs/en/hooks]` to `[VERIFIED: measured 2026-10-01 against claude 2.1.285, scripts/uat/uat-11-env-file-ordering.mjs]`, stating P1 is restorable by construction through the `SessionStart` hook — scoped explicitly to one macOS machine, one `claude` version, `bypassPermissions` mode. The `SessionStart` named-residual row is narrowed from "OPEN — never fires" to "MEASURED-AND-NARROWED", carrying only the two caveats this run does not resolve: the Windows sourcing bug (`anthropics/claude-code#27987`) and the docs self-contradiction (`anthropics/claude-code#19357`). No existing round section was deleted or reworded.

## Task Commits

1. **Task 1: The harness — three live probes, a non-credential self-test, and registration** — `4331b51` (feat) — executed in a prior session
2. **Task 2: Spend the run, record what it measured** — `0b69293` (docs) — this continuation; the credential spend itself happened between the two commits, outside this agent's own execution

**Plan metadata:** (this commit)

## Files Created/Modified
- `scripts/uat/uat-11-env-file-ordering.mjs` - the live harness, three probes + `--selftest`
- `scripts/uat/run-all.sh` - one new registration line
- `docs/destructive-gate-trust-boundary.md` - P1 material promoted to `[VERIFIED]`; `SessionStart` residual row narrowed to its two open caveats

## Decisions Made
- Measured the real product wiring (the agent's own command shell's first `PATH` segment vs. the run's shim directory) instead of `12-RESEARCH.md`'s stub-`git` sketch, per the plan's own recorded deviation — cheaper, no fake binary, exercises `writeHookSettings` directly.
- Probe 2 is a hard assertion, not a recordable outcome: a `git --version` that becomes a permission request calls for a revert, never a documentation edit claiming a pass — this harness cannot silently normalize round ten repeating.
- This continuation did not re-run the live harness — the credentials were already spent by the human per the checkpoint's resume instructions; the artifact on disk is the record, read back rather than regenerated.

## Deviations from Plan

None - plan executed exactly as written. Task 1's live-wiring deviation was already recorded in the plan's own `<objective>` before execution began, not discovered during it.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **P1 is now verified restorable** (for this one macOS/claude-2.1.285/bypassPermissions measurement) via the `CLAUDE_ENV_FILE` `SessionStart` hook — the phase's one open live guarantee has a measured, dated, version-pinned answer instead of a citation.
- The two carried caveats (Windows sourcing bug, docs self-contradiction) remain genuinely open — this run does not close them, and the document says so explicitly rather than implying a broader guarantee than one run supports.
- The pre-push layer's ask-branch discriminator (`FLYWHEEL_PERMISSION_SOCKET`) is now a measured fact, not an assumption — plan 12-04's `--gate-push` ask branch can rely on it reaching the command shell on this configuration.
- This was the phase's only scheduled credential-spending step; AGNT-07's remaining backstop truths (D2-D4 above) are intentionally routed to `human_needed` by `/gsd-verify-work` per the plan's own `verification: backstop` markers, even though the artifact already shows all three passing.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*

## Self-Check: PASSED

- `scripts/uat/uat-11-env-file-ordering.mjs` exists: confirmed (`file` reports it, 330 lines added per diff).
- `scripts/uat/run-all.sh` registration: `grep -c 'uat-11-env-file-ordering.mjs' scripts/uat/run-all.sh` = 1.
- `docs/destructive-gate-trust-boundary.md` edits present: `grep -c CLAUDE_ENV_FILE` = 4; `tr -dc '\000' | wc -c` = 0 (no NUL corruption); `file` reports UTF-8 text.
- Commits `4331b51` and `0b69293` both found in `git log --oneline --all`.
- `node scripts/uat/uat-11-env-file-ordering.mjs --selftest` re-run: exit 0, all four verdict checks print, no "SKIP".
- `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test` re-run: 223 tests, 217 pass, 0 fail, 6 skip — matches the pre-plan baseline exactly, confirming the docs edit did not break the structural heading-search gate.
- uat-11 artifact confirmed on disk carrying `verdict` fields for all three probes plus `claudeVersion: "2.1.285 (Claude Code)"`.
