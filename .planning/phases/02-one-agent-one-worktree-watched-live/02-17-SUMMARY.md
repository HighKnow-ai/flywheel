---
phase: 02-one-agent-one-worktree-watched-live
plan: 17
subsystem: infra
tags: [sidecar, claude-code-cli, node-test, stream-json, gap-closure]

requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: the structured session feed's row-clamping/expand pattern (02-16, G-02-3) that this plan's terminal-row `detail` block reuses, and the sidecar reader loop's stderr/Terminated/Error observation added at the Rust process boundary (02-15) — a different boundary from this plan's Node-side child stderr drain
provides:
  - "an argv the real claude CLI accepts — --output-format stream-json always paired with --verbose under --print — committed behind a constraint-shaped regression guard, not an exact-array snapshot alone"
  - "the child's stderr drained by a readline interface for the whole session lifetime, each line forwarded as a system_notice and a bounded tail retained as SessionClosedEvent.detail so a failed spawn says why"
  - "the session surface's failed terminal row rendering that detail beneath its existing machine-detail line, in a bounded, internally-scrolling block"
  - "the first test in this repository that spawns the REAL claude binary, with a falsifiability companion proving the check can actually fail"
  - "non-init system stream events normalised to system_notice instead of unknown, so the CLI's --verbose lifecycle chatter reads as one short line per event rather than raw JSON walls"
affects: [02-18]

actuals:
  tokens: 8107
  tasks: 4
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A constraint-shaped test asserts its OWN examined-variant count (permission modes x call shapes) so a guard that silently iterated over an empty list cannot report green — applied to the --verbose pairing test, reusable anywhere a loop-based assertion needs to prove it actually ran."
    - "A capped accumulator field on a live-session record (LiveSession.stderrTail, bounded by STDERR_DETAIL_MAX_CHARS) retains just enough of a child's own diagnostic output to explain a failure, without holding the whole stream — the same shape as G-02-3's row-truncation threshold, applied to a process boundary instead of a render boundary."
    - "A real-binary test module resolves its own skip condition once at module scope (spawnSync <bin> --version, bounded) and passes the resulting reason to every test(...) call's { skip } option, so an environment without the real backend skips visibly and printedly rather than passing silently or failing opaquely."

key-files:
  created:
    - packages/sidecar/test/real-claude-argv.test.mjs
  modified:
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/test/adapter.test.mjs
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx

key-decisions:
  - "system_notice's text summary for a non-init system event is the terse `system: <subtype>` — the subtype name alone, never a pretty-printed payload — since the full payload is one click away in the raw view and permanently in the persisted log; keeping the branch subtype-agnostic (no special-casing) is what lets a future CLI subtype flow through without a code change."
  - "STDERR_DETAIL_MAX_CHARS is 2000 characters, matching the order of magnitude of 02-16's FEED_ROW_TRUNCATION_THRESHOLD-adjacent bounding decisions in this same session-surface subsystem — bounds both the memory one session holds and the size of the string crossing the persisted log and the renderer."
  - "SessionSurface.tsx declares its own local TERMINAL_DETAIL_MAX_HEIGHT (240) rather than importing FeedRow.tsx's EXPANDED_SUBBLOCK_MAX_HEIGHT, since FeedRow.tsx does not export that constant and this module already duplicates MONO_STACK the same way — matching the file's existing convention rather than introducing a new cross-module export for one constant."
  - "Added a data-testid=\"terminal-detail\" hook to the new detail block so its absence (the 'closed cleanly, no detail' case) is assertable by testid rather than a fragile empty-text query."

requirements-completed: [PROC-01, AGNT-01, AGNT-02]

coverage:
  - id: D1
    description: "The argv the adapter builds is one the real Claude Code CLI accepts — stream-json is always paired with the flag the CLI requires alongside it under print mode, asserted as a relationship rather than a frozen snapshot"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "adapter.test.mjs#buildClaudeArgv always pairs --output-format stream-json with --verbose (G-02-2)"
        status: pass
      - kind: integration
        ref: "real-claude-argv.test.mjs#the real cli accepts the argv the adapter builds"
        status: pass
    human_judgment: false
  - id: D2
    description: "When a spawned session fails, the backend's own explanation reaches the session feed and the terminal row instead of being discarded into an undrained pipe"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "session-surface.test.tsx#renders the terminal event's detail beneath the machine-detail line for a failed run (G-02-2)"
        status: pass
      - kind: unit
        ref: "session-surface.test.tsx#renders no detail block for a failed run whose terminal event carries none"
        status: pass
    human_judgment: false
  - id: D3
    description: "The child's stderr is drained for the lifetime of the session so a backend writing more than a pipe buffer can never block on its own output"
    requirement: "PROC-01"
    verification:
      - kind: other
        ref: "grep gate: non-comment `child.stderr` read present in claude-code-adapter.ts; full sidecar suite (38/38) exercises startSession's stdout/stderr wiring on every existing real-child-process test without a hang"
        status: pass
    human_judgment: true
    rationale: "The DoS mitigation this closes (an unbounded pipe buffer blocking a real child that writes megabytes of stderr) is not exercised by any test in this plan's or the prior suite's fixtures — proving it needs a child that actually fills a pipe buffer, which no fixture in this repository does yet. The readline attachment and its lifetime (from spawn to close) are structurally verified; the extreme-volume case is not."
  - id: D4
    description: "An argv the real CLI rejects can no longer pass the suite, and a companion case proves that claim rather than asserting it"
    requirement: "AGNT-02"
    verification:
      - kind: integration
        ref: "real-claude-argv.test.mjs#an argv missing the required flag is rejected by the real cli"
        status: pass
    human_judgment: false
  - id: D5
    description: "A failed spawn is distinguishable from another failed spawn — a bad argv, a missing binary and an auth failure no longer present identically"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "session-surface.test.tsx#renders the terminal event's detail beneath the machine-detail line for a failed run (G-02-2) — proves the channel exists end-to-end from event to render"
        status: pass
    human_judgment: true
    rationale: "The unit/UI tests prove the `detail` channel is wired end-to-end for a fabricated stderr string; distinguishing three REAL failure classes (bad argv, missing binary, real auth rejection) side-by-side in the running app is a human-observable comparison no fixture in this plan reproduces for all three simultaneously."
  - id: D6
    description: "The backend's own lifecycle chatter reads as one short notice line per event instead of a wall of raw JSON, while the verbatim line stays in the persisted log and reachable through the raw view"
    requirement: "PROC-01"
    verification:
      - kind: unit
        ref: "adapter.test.mjs#normaliseStreamEvent maps every non-init system subtype to system_notice (G-02-3)"
        status: pass
      - kind: unit
        ref: "adapter.test.mjs#normaliseStreamEvent boundary: the init subtype still normalises to init, unchanged"
        status: pass
      - kind: unit
        ref: "adapter.test.mjs#normaliseStreamEvent boundary: a top-level type this function does not recognise still normalises to unknown"
        status: pass
      - kind: unit
        ref: "adapter.test.mjs#normaliseStreamEvent: a system event with a missing or empty subtype is unrecognised, not a notice with an empty summary"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 17: Verified argv, drained stderr with a failure detail, real-binary test, notice classification (G-02-2) Summary

**Closed gap G-02-2: `buildClaudeArgv` now pairs `--output-format stream-json` with the `--verbose` the real CLI requires (committed behind a constraint-shaped guard, not a frozen exact-array snapshot), the sidecar drains the child's stderr for the whole session and carries a failure explanation onto the terminal event as `detail`, a new test spawns the real `claude` binary to prove an argv it rejects can no longer pass the suite, and non-init `system` stream events now normalise to a one-line `system_notice` instead of raw-JSON `unknown` rows.**

## Performance

- **Duration:** 20 min (approx.)
- **Started:** 2026-09-11T09:12:00Z (approx.)
- **Completed:** 2026-09-11T09:30:00Z
- **Tasks:** 4
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Committed the pre-existing, UAT-verified `--verbose` argv patch to `claude-code-adapter.ts` and `adapter.test.mjs` exactly as patched, then strengthened its regression test: the constraint-shaped pairing guard now asserts its own examined-variant count (permission modes × call shapes, never silently zero), asserts the converse for the two-field call shape (a non-empty argv naming print mode and a permission mode, so dropping `--output-format` can't satisfy the pairing vacuously), and reads its permission-mode list from one declared array. The exact-array test's comment now names why an exact-array assertion alone was the tertiary cause of this gap.
- Gave a failed spawn a voice: `claude-code-adapter.ts` attaches a readline interface to the child's stderr from the moment it is spawned, for the whole session lifetime. Each line is forwarded as a `system_notice` on the same `onEvent` channel as every stdout-derived event, and retained (capped at the new `STDERR_DETAIL_MAX_CHARS`, 2000 chars) on `LiveSession.stderrTail`. `emitSessionClosed` now carries the trimmed tail as `SessionClosedEvent.detail` (new optional field on `adapter.ts`) when non-empty, omitting it entirely otherwise. A spawn `error` handler populates the tail from the error's own message when the child never produced a process at all. `SessionSurface.tsx`'s failed terminal row renders `detail` beneath its existing subtype line, in the Mono utility, inside a bounded internally-scrolling block matching 02-16's containment pattern — no new colour token, no raw hex, and the `spawn()` call's own options are byte-for-byte unchanged.
- Wrote `packages/sidecar/test/real-claude-argv.test.mjs` — the first test in this repository that spawns the REAL `claude` binary. A module-scope availability probe (`spawnSync claude --version`, bounded) resolves once; every test skips with a printed reason when the binary is absent. The positive case spawns `buildClaudeArgv`'s own output (never a hand-written array) with a fake API key and an unreachable loopback base URL, asserting the process does not exhibit the shipped failure shape (immediate non-zero exit, zero stdout bytes) within a 10s bound. The negative case spawns the same argv with `--verbose` removed (differs by exactly one element), asserting it DOES exhibit that shape with non-empty stderr — the falsifiability companion — and prints the stderr as an unasserted version canary. Verified on this machine (claude 2.1.236 present): both tests pass, not skipped.
- Added one branch to `normaliseStreamEvent`, after the existing `init` check and before the final fallthrough: a `system` event with a non-empty, non-init subtype becomes a `system_notice` whose text names the subtype and whose `raw` is the unchanged source line. A missing/empty subtype, and any genuinely unrecognised top-level type, still fall through to `unknown` — narrowed, never deleted. No subtype is special-cased. `SessionSurface.tsx`/`FeedRow.tsx` needed no change, confirming the classification (not the rendering) was the defect.

## Task Commits

Each task was committed atomically:

1. **Task 1: Commit the argv fix, and make the pairing impossible to lose again** - `5900af2` (fix)
2. **Task 2: Drain the child's stderr, and make a failed spawn say why** - `9315f8e` (feat)
3. **Task 3: Run the real binary with the built argv — and prove the test can fail** - `d175f60` (test)
4. **Task 4: Normalise the backend's lifecycle chatter to a notice instead of a raw-JSON wall** - `f4b07c8` (feat)

_This plan's Tasks 2-4 carried `tdd="true"` in the plan frontmatter, but `workflow.tdd_mode` is not enabled in `.planning/config.json` for this project — matching this same phase's 02-15/02-16 precedent — so each task landed as a single commit following this repository's standard one-commit-per-task convention rather than a strict RED/GREEN/REFACTOR gate sequence._

Task 1 carried `type="tracer"`: its own `<verify>` block was re-run in full after the commit (all four automated checks passing) before Task 2 began, per the tracer feedback gate — logged `⚡ Tracer verified end-to-end — expanding`, no checkpoint synthesized (`human_verify_mode: end-of-phase`, the task's `<verify>` is automated-only).

## Files Created/Modified

- `packages/sidecar/src/claude-code-adapter.ts` - the committed `--verbose` argv fix; `STDERR_DETAIL_MAX_CHARS`; `LiveSession.stderrTail`; the stderr readline attachment; `emitSessionClosed`'s new `detail` field; the `normaliseStreamEvent` `system_notice` branch
- `packages/sidecar/src/adapter.ts` - `SessionClosedEvent.detail?: string`
- `packages/sidecar/test/adapter.test.mjs` - strengthened `--verbose` pairing guard (Task 1); `normaliseStreamEvent` class-shaped subtype table plus three boundary cases (Task 4)
- `packages/sidecar/test/real-claude-argv.test.mjs` - new; the real-binary argv test and its falsifiability companion
- `packages/desktop/src/session/SessionSurface.tsx` - `TerminalInfo.detail`; `findTerminalInfo` reads it; `TerminalRow`'s failed branch renders it in a bounded scrolling block
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` - two new tests for the `detail` render/omit behavior

## Decisions Made

See `key-decisions` in the frontmatter above.

**Correction to record (per this plan's own objective):** `02-RESEARCH.md` § "Agent Adapter Interface" states `--verbose` need only be added "if token-level deltas are wanted — not required for D-32's row-per-event feed". That is empirically wrong for the print-mode `stream-json` combination: the real CLI rejects `-p --output-format stream-json` outright without `--verbose`, exiting 1 before emitting a single line. `02-RESEARCH.md` is left as a dated record of what was believed at the time and is not rewritten.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added test coverage for Task 2's `detail` rendering behavior beyond the task's own declared file list**
- **Found during:** Task 2, after implementing the stderr-drain/detail-carrying change
- **Issue:** Task 2's own `<files>` tag (and the plan frontmatter's `files_modified`) named only `adapter.ts`, `claude-code-adapter.ts`, and `SessionSurface.tsx` — no test file — and the task's `<acceptance_criteria>` are fully satisfiable via the existing full-suite pass plus grep-based structural gates. Leaving the new `detail` render/omit behavior with zero dedicated test coverage (only structural grep proof that the code exists) would be a materially weaker guarantee than every other new behavior this plan or its immediate predecessor (02-16) added, all of which carry direct assertions.
- **Fix:** Added two tests to `session-surface.test.tsx` (the existing sibling test file for `SessionSurface.tsx`, already covering the same `TerminalRow` failed branch): one asserting `detail` renders beneath the subtype line when the terminal event carries one, one asserting no detail block renders when it does not (via a new `data-testid="terminal-detail"` hook on the block itself, added specifically to make the absence case assertable).
- **Files modified:** `packages/desktop/src/session/__tests__/session-surface.test.tsx`, and `packages/desktop/src/session/SessionSurface.tsx` (the `data-testid` addition)
- **Verification:** `npm --prefix packages/desktop run test` — 312/312 passing (2 new)
- **Committed in:** `9315f8e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical test coverage addition, scoped to the same component the task already declared). **Impact on plan:** No behavioral scope creep — the production code change is exactly what Task 2 specified; the addition is test coverage for that same change, in the file that already tests the exact component it touches.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-02-2 is closed: all three of its `missing:` items exist — the required flag is committed alongside the stream-json output format behind a constraint-shaped guard; the child's stderr is drained, routed to `system_notice` events, and carried on the terminal event as `detail` that the session surface renders; and `real-claude-argv.test.mjs` runs the real binary with the built argv, with a companion case proving the test can detect a rejected argv (both verified passing, not skipped, on this machine at claude 2.1.236).
- The `unknown`-row cosmetic issue observed alongside G-02-2 (nine raw-JSON lifecycle rows ahead of any assistant text) is also closed, ahead of its own gap filing, per the user's explicit request recorded in this plan's "Adjacent Open Items" section.
- `02-18` (G-02-4, carrying token usage onto the terminal event) is the next plan in this wave — it extends the same `SessionClosedEvent` interface this plan already touched (`detail`); no conflict expected since that plan adds separate usage fields.
- D3 and D5's coverage entries above are marked `human_judgment: true` — the extreme-stderr-volume DoS case and a live three-way failure-class comparison (bad argv / missing binary / real auth rejection) are not reproduced by any fixture in this repository yet; recommend folding into `/gsd-verify-work 2`'s resumed test 1 (the same UAT session that originally reported this gap) if a real streaming session is exercised again.
- `.planning/config.json` remains modified-but-uncommitted in the working tree, as required — that belongs to the orchestrator, not this plan's ledger.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files confirmed present on disk (`claude-code-adapter.ts`, `adapter.ts`, `adapter.test.mjs`, `real-claude-argv.test.mjs`, `SessionSurface.tsx`, `session-surface.test.tsx`, this SUMMARY). All four task commits (`5900af2`, `9315f8e`, `d175f60`, `f4b07c8`) confirmed present in `git log`. All acceptance criteria and the plan-level `<verification>` block re-run and passing: `npm --prefix packages/sidecar test` reports 38/38 passing (0 failures, was 29 before this plan); `npm --prefix packages/desktop run test` reports 312/312 passing (0 failures); `npm --prefix packages/desktop run build` exits 0 with no `error TS` diagnostics; `git status --porcelain` for the two files Task 1 took ownership of is empty; a non-comment line of `claude-code-adapter.ts` reads `child.stderr` (2 occurrences) and `STDERR_DETAIL_MAX_CHARS` is both declared and enforced outside comments (4 occurrences); the event-emitting region of `startSession` contains zero `options.env`/`process.env` reads; `node --test packages/sidecar/test/real-claude-argv.test.mjs` reports 2 passing (not skipped — real `claude` 2.1.236 present on this machine); the repo-wide raw-hex gate returns `0`.
