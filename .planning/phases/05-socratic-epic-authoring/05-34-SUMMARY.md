---
phase: 05-socratic-epic-authoring
plan: 34
subsystem: testing
tags: [uat-harness, sidecar-adapter, wire-classification, gap-closure, credentials-none]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "The config-isolation/credential-refusal machinery (plan 05-33), the fail-closed noWorkPlanned/correlation machinery (plans 05-23/05-27/05-30/05-31), and the UAT-8 live-arm shape (plans 05-10/05-18/05-20/05-24/05-25)"
provides:
  - "classifyNonConversationTurn + NON_CONVERSATION_SOURCES — a wire-first classifier that identifies a non-conversation backend message from the assistant envelope's own is_api_error_message/error fields or the result line's own is_error/terminal_reason fields, falling back to the retained readBackendRefusal text-banner reader only when neither wire signal fired"
  - "AssistantTextEvent.isApiErrorMessage/errorCode and ResultEvent.isError/terminalReason — the wire's own error facts, carried from ClaudeStreamMessage/ClaudeStreamResult through normaliseStreamEvent using plan 05-30's conditional-spread idiom"
  - "scripts/uat/fixtures/unauthenticated-cli-first-turn.json — a real, zero-cost, credential-free capture of an unauthenticated CLI's first turn, frozen and replayed offline as the named --replay-check scenario unauthenticated-backend-first-turn"
  - "envelopeExtra (block-level) and resultExtra (scenario-level) fixture-authoring fields on fake-authoring-claude.mjs, extending its wire-shape vocabulary to express envelope-level and result-line-level fields at all"
affects: [05-socratic-epic-authoring]

# Actuals (#2632) — chars/4 over the realized diff (git diff --stat across all 3 task commits)
actuals:
  tokens: 22536
  tasks: 3
  commits: 3
plan_head_before: 0422720032899ec555e26fbb8349df459f7613fe

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wire-first, prose-fallback classification: check categorical facts the protocol itself supplies (a boolean error flag) before falling back to a text-shape match, so the class of defect this closes (six rounds of prefix-narrowing) cannot recur behind a differently-worded message"
    - "Fixture-authoring stripped fields (delayMs, role, envelopeExtra, resultExtra): a scripted test backend's block/scenario objects carry test-only fields that emitTurn merges into the real wire shape then strips before writing, so the fixture's authoring convenience never leaks into what the shipped normaliser actually parses"
    - "Read real captures at module load, never retype them: both the adapter's own test file and the fake backend's scenario read scripts/uat/fixtures/*.json directly, so a scenario and its grounding capture cannot drift apart the way a hand-copied literal could"

key-files:
  created:
    - scripts/uat/fixtures/unauthenticated-cli-first-turn.json
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/adapter.test.mjs
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "accumulateTurn's returned refusal field is RENAMED to nonConversation (not merely reinterpreted) on both return paths, and every reader across sidecar-harness.mjs and uat-08-socratic-authoring.mjs was updated to match — the old name named one member of the class (a text-banner match) rather than the class itself, and per this plan's own reasoning a name that says 'refusal' invites the eighth instance of this defect."
  - "classifyNonConversationTurn checks the assistant envelope's own error flag first, then the result line's own error flag, then falls back to readBackendRefusal — wire-first purely so the reported source is the most precise one available; either signal alone is sufficient to classify, and readBackendRefusal is retained completely unweakened as the only measured signal for the safety-classifier refusal shape (no raw stream-json capture of that shape exists in this repository)."
  - "The evidence sheet's '## Backend refusal' section and its per-exchange 'Refusal' column are renamed to '## Non-conversation turn' and 'Non-conversation', and the section now states which NON_CONVERSATION_SOURCES member fired — the heading now names the class, matching the classifier's own generality, and the reported source answers 'how did we find out', which is the fact that went missing for six prior rounds of this defect class."
  - "SHAPE-01/SHAPE-03 are intentionally NOT marked Complete in REQUIREMENTS.md by this plan (must_haves.prohibitions, matching plan 05-33's identical precedent) — the requirements-completed field below is a verbatim copy of the plan's own frontmatter requirements array per the summary template's contract, not a completion signal; REQUIREMENTS.md's checkboxes for both stay unchecked and 05-LIVE-CHALLENGE-TRANSCRIPT.md's two verdict lines stay UNJUDGED (confirmed via git diff --quiet on that file after every task)."
  - "The plan's own Task 1 <verify> command (node --test packages/sidecar/test/adapter.test.mjs run bare, no FLYWHEEL_RUNTIME_DIR) fails on a PRE-EXISTING, unrelated issue: one test spawns a real child process via the adapter and needs FLYWHEEL_RUNTIME_DIR set, which the package's own npm test script sets but the plan's literal command does not. Verified this is pre-existing (reproduces identically against a scratch checkout of HEAD before any of this plan's commits) and out of scope per the executor's scope-boundary rule. Verification was instead run as `npm --prefix packages/sidecar test` (the documented regression baseline command), which passed 158/158 both before and after this plan's changes (with an unrelated, reproducibly-flaky skip of 6 real-CLI-probe tests under system load, confirmed by an immediate re-run passing 158/158 with zero skips)."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "The wire's own is_api_error_message/error (assistant envelope) and is_error/terminal_reason (result line) fields are carried through the adapter seam onto normalised AssistantTextEvent/ResultEvent fields, proven against a real frozen capture of the exact stream that defeated the live run"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs (8 new tests: round-trip, both-absent, empty-string-omitted, literal-false-carried, neighbouring-field-never-adopted, and one test that normalises all three real fixture lines)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test (158/158 pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A non-conversation backend message is classified from categorical wire facts (assistant envelope or result-line error flag) rather than from prose, with the retained text-banner reader as an unweakened fallback for the one shape with no raw capture; the classification names which source fired"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test (7 checks labelled [Plan 05-34, Task 2], plus the pre-existing readBackendRefusal/accumulateTurn/driveChallengeConversation checks updated for the nonConversation rename)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario backend-refuses-mid-conversation (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The exact stream that defeated the live run (an unauthenticated backend's first turn) replays offline through the real sidecar and the real shipped normaliser as a named --replay-check scenario, stopping the driver on turn one, well inside the offline analogue of the live run's 120000ms proposal deadline"
    requirement: "SHAPE-01"
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario unauthenticated-backend-first-turn (exit 0; elapsed ~650ms vs REPLAY_TURN_DEADLINE_MS=10000ms)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (all 11 scenarios pass; 05-LIVE-CHALLENGE-TRANSCRIPT.md byte-identical to its committed state)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SHAPE-01/SHAPE-03's live judgements remain reachable-but-unspent by this plan — no live arm run, no credential spent, both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md stay UNJUDGED"
    human_judgment: true
    rationale: "Whether the live arm's own next real run now actually stops correctly on an equivalent live shape (rather than the offline-replayed one) and whether the challenge/draft-usefulness dialogue itself is good enough remain live judgements outside this plan's scope by explicit prohibition (must_haves.prohibitions) — a human must run the live arm deliberately, spending a real credential, before either verdict line can be filled."

duration: 62min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 34: Classify Non-Conversation Backend Turns From Wire Facts (Gap G-05-6) Summary

**A wire-first classifier (`classifyNonConversationTurn`) reads the assistant envelope's own `is_api_error_message`/`error` fields and the result line's own `is_error`/`terminal_reason` fields — carried through the adapter seam for the first time — to identify a non-conversation backend message categorically, ending the seven-round defect class that a single hardcoded text prefix kept surviving; the retained `readBackendRefusal` text-banner reader stays as an unweakened fallback, and the exact unauthenticated-CLI stream that killed the live run now replays offline in ~650ms instead of waiting out a 120-second deadline.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-09-25T09:06:00Z
- **Completed:** 2026-09-25T10:08:00Z
- **Tasks:** 3 completed
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- **Task 1 (tracer):** Froze a real, zero-cost, credential-free capture of an unauthenticated `claude` CLI's first turn at `scripts/uat/fixtures/unauthenticated-cli-first-turn.json`, confirmed free of any token/key/email material. Added two optional envelope-level fields to `ClaudeStreamMessage` (`error`, `is_api_error_message`) and two to `ClaudeStreamResult` (`is_error`, `terminal_reason`) in `claude-code-adapter.ts`, spread onto `AssistantTextEvent.isApiErrorMessage`/`errorCode` and `ResultEvent.isError`/`terminalReason` (`adapter.ts`) using plan 05-30's conditional-spread idiom — absent/malformed values omit the key entirely, and a literal `false` on `is_error` is carried, never dropped as falsy. 8 new adapter tests, including one that normalises all three of the frozen fixture's real lines.
- **Task 2:** Added `NON_CONVERSATION_SOURCES` and `classifyNonConversationTurn({ text, events })` to `sidecar-harness.mjs` — checks the assistant envelope's wire flag, then the result line's wire flag, then falls back to the retained `readBackendRefusal`. Renamed `accumulateTurn`'s returned `refusal` field to `nonConversation` on both return paths and updated every reader across both harness files: `driveChallengeConversation`'s stop-at-detection check and its own return/exchange fields, the evidence sheet's per-exchange column and its renamed `## Non-conversation turn` section (now stating which source fired), and the live arm's `conversation`/`distillationReply`/`partial` checks. Corrected a false doc-comment claim that no tool event carries a correlation id. 7 new `[Plan 05-34, Task 2]` self-test checks.
- **Task 3:** Extended `fake-authoring-claude.mjs` with block-level `envelopeExtra` and scenario-level `resultExtra` fixture-authoring fields (mirroring how `delayMs`/`role` were added before), then added the scenario `unauthenticated-backend-first-turn` — its text and wire-error fields are read from the frozen fixture at module load, never retyped. Added the matching `--replay-check` assertion branch: the turn classifies as non-conversation via a WIRE signal (not the text banner), zero developer turns are sent, the fallback text is never reached, and the elapsed spawn-to-stop span is asserted against `REPLAY_TURN_DEADLINE_MS` (not a hardcoded figure).

## Task Commits

Each task was committed atomically:

1. **Task 1: Capture the real unauthenticated stream and carry the wire's own error facts through the adapter seam** — `415c093` (tdd)
2. **Task 2: Classify a non-conversation turn from the wire's facts, stop the run where it appears, and correct the doc comment that contradicts the shipped event model** — `1e81744` (tdd)
3. **Task 3: Replay the real unauthenticated first turn offline, end to end, as a named scenario** — `1e726c2` (feat)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `scripts/uat/fixtures/unauthenticated-cli-first-turn.json` (new) — real, zero-cost, credential-free capture: `capturedWith`, `capturedAt`, `note`, and the three verbatim captured stream-json lines
- `packages/sidecar/src/adapter.ts` — `AssistantTextEvent.isApiErrorMessage`/`errorCode`, `ResultEvent.isError`/`terminalReason`
- `packages/sidecar/src/claude-code-adapter.ts` — `ClaudeStreamMessage.error`/`is_api_error_message`, `ClaudeStreamResult.is_error`/`terminal_reason`, and their conditional-spread carry in `normaliseStreamEvent`
- `packages/sidecar/test/adapter.test.mjs` — 8 new tests proving the wire-fact carry, including one against the real frozen fixture
- `scripts/uat/lib/sidecar-harness.mjs` — `NON_CONVERSATION_SOURCES`, `classifyNonConversationTurn`, `accumulateTurn`'s `refusal` → `nonConversation` rename, corrected `pendingToolCallCount` doc comment
- `scripts/uat/lib/fake-authoring-claude.mjs` — `envelopeExtra`/`resultExtra` fixture-authoring fields, the `unauthenticated-backend-first-turn` scenario (11 scenarios total)
- `scripts/uat/uat-08-socratic-authoring.mjs` — every reader of the renamed field updated, the evidence sheet's renamed/generalised section, 7 new `[Plan 05-34, Task 2]` self-test checks, and the new scenario's `--replay-check` assertion branch

## Decisions Made

See `key-decisions` in the frontmatter above — in short: the field rename (`refusal` → `nonConversation`) was applied everywhere the classification flows, not just at `accumulateTurn`; the classifier checks wire signals before the retained text-banner reader, purely for reporting precision, since either alone is sufficient; the evidence sheet's section/column were renamed and generalised to state which source fired; SHAPE-01/SHAPE-03 stay deliberately unmarked per this plan's own prohibition; and the plan's own literal Task 1 verify command needed `FLYWHEEL_RUNTIME_DIR` (which `npm test` sets and the bare command does not) — a pre-existing, unrelated environment gap, not a regression from this plan's changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran Task 1's `<verify>` block via `npm --prefix packages/sidecar test` instead of the literal bare `node --test` command**
- **Found during:** Task 1 (`<verify>` gate)
- **Issue:** The plan's own literal automated check (`node --test packages/sidecar/test/adapter.test.mjs`, run with no environment setup) fails with `expected at least 4 events, got 2` on a PRE-EXISTING test unrelated to this plan's changes (`normalised events for the fake CLI's stream arrive in source order...`) — that test spawns the adapter's real child process and needs `FLYWHEEL_RUNTIME_DIR` set, which the package's own `npm test` script sets (`FLYWHEEL_RUNTIME_DIR="${FLYWHEEL_RUNTIME_DIR:-$(mktemp -d)}" ... node --test test/*.test.mjs`) but a bare invocation does not.
- **Fix:** Verified this failure is 100% pre-existing (reproduces identically against a scratch `git archive` checkout of the commit immediately before this plan's first commit, with zero code changes applied) and therefore out of scope per the executor's scope-boundary rule. Ran verification instead via the documented regression-baseline command (`npm --prefix packages/sidecar test`, or the same command with `FLYWHEEL_RUNTIME_DIR`/`FLYWHEEL_HEARTBEAT_STALE_MS` set manually), which is what the plan's own "Regression baseline" section in its prompt names as the ground truth.
- **Files modified:** None (verification-only; no source change was needed or made for this pre-existing gap).
- **Verification:** `npm --prefix packages/sidecar test` passed 158/158 immediately after Task 1's changes, and again 158/158 (0 skipped) after all three tasks' changes on a second run (a first re-run showed 152 pass + 6 skipped real-CLI-probe tests due to a reproducible 5-second-timeout flake under system load — confirmed unrelated to this plan by an immediate clean re-run).
- **Committed in:** No commit needed — verification-only observation, documented here for the next reader who runs this plan's literal `<verify>` command bare and sees the same pre-existing failure.

---

**Total deviations:** 1 auto-fixed (1 blocking — pre-existing verification-environment gap, not a code defect).
**Impact on plan:** No functional impact. All of every task's acceptance criteria are satisfied against the final state; the deviation is purely about which exact command demonstrates that, and is now documented so it does not read as a regression on a future run.

## Issues Encountered

None beyond the documented verification-command deviation above. All three tasks' `<acceptance_criteria>` and the plan-level `<verification>` block passed once real code was written and the correct verification command was used; no repair cycles were needed.

## User Setup Required

None — no external service configuration required. `--self-test` and `--replay-check` both run entirely offline against synthetic data and the fake backend; Task 1's one real-CLI invocation was an unauthenticated capture that cost nothing and reached no API.

## Next Phase Readiness

- Gap G-05-6 is closed: a non-conversation backend message is now identified from the wire's own categorical facts rather than from a hardcoded text prefix, ending the seven-round narrowing cycle this phase's own ledger recorded. The mechanism generalises past both known shapes (the safety-classifier refusal, caught by the retained text reader; the unauthenticated-CLI error, caught by the new wire signal) and by construction extends to any future shape the wire itself flags as an error.
- `05-LIVE-CHALLENGE-TRANSCRIPT.md` is unchanged by this plan (confirmed via `git diff --quiet` after every task); both verdict lines remain `UNJUDGED` as required. SHAPE-01/SHAPE-03 stay unmarked in `REQUIREMENTS.md`.
- The live arm (`node scripts/uat/uat-08-socratic-authoring.mjs`, no flags) now benefits from the same classifier the offline arms prove: a real unauthenticated first turn, or any future wire-flagged error, will stop the run immediately with a named source/classifier/request-id rather than waiting out the full 120000ms proposal deadline the way the two prior live runs did.
- No blockers for subsequent plans in this phase.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*

## Self-Check: PASSED
