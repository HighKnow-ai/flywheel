---
phase: 05-socratic-epic-authoring
plan: 23
subsystem: testing
tags: [uat, socratic-authoring, instrument-hardening, gap-closure, cr-01, wr-01]

requires:
  - phase: 05-socratic-epic-authoring (plans 05-20, 05-21, 05-22)
    provides: the fixed capture instrument (whole-turn capture, the conversation driver, the three-valued propose-tool reading) that this plan's own code review (05-REVIEW.md) found one critical and several non-blocking defects in
provides:
  - "readNoWorkPlanned(events, window) — a promoted signature: window ({runId, fromIndex, toIndex}) is a required second parameter, so the unscoped read that caused CR-01 is unwritable rather than merely discouraged"
  - "a per-attempt propose/refusal correlation that closes WR-01 (a refused first attempt can no longer launder an unrefused second one into a false 'refused' reading)"
  - "a proposes-work-after-advance --replay-check scenario proving, offline and for zero tokens, that a clean challenge stage followed by a legitimate decompose-stage proposal reports SHAPE-01 as passing, while the OLD unscoped reading over the same run still reports violated"
  - "WR-02, WR-03, IN-01, IN-02 (05-REVIEW.md) all cleared"
affects: [any-future-live-uat-08-run, phase-06-agent-authored-backlog]

actuals:
  tokens: 9400
  tasks: 3
  commits: 4
plan_head_before: c93aa7b

tech-stack:
  added: []
  patterns:
    - "A verification-instrument reading that gates a phase's core criterion carries its own scope as a required parameter, never an implicit 'whole array' default — the unscoped shape is made unwritable (a thrown TypeError) rather than merely discouraged in a comment."
    - "Correlate each individual attempt with its own answer (a positional, per-attempt scan) rather than asking two independent aggregate existence questions ('was anything attempted' / 'was anything refused') — the aggregate form is exactly what let a refused first attempt launder an unrefused second one."

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/lib/sidecar-harness.mjs

key-decisions:
  - "readNoWorkPlanned's window is PROMOTED to a required parameter (the recorded assumption-delta decision), not add-alongside — CR-01 was exactly the implicit whole-array default going unnoticed a second time; promoting makes the unscoped call unwritable rather than merely discouraged."
  - "The live body takes the challenge-window boundary ONCE (challengeWindowEnd, captured right after driveChallengeConversation returns and assertAllHeldRequestsAnswered passes) and reuses that exact binding for the final gating value — it never recomputes a second, unscoped reading after decompose-stage activity has occurred. This is the literal root-cause fix for CR-01."
  - "Per-attempt refusal correlation (WR-01) is POSITIONAL, not by a correlation id — ToolResultEvent (packages/sidecar/src/adapter.ts) declares none. An attempt's answer is the FIRST subsequent tool_result in-window for the same run; a named result only counts as the answer when its name matches the attempt's own tool name, an unnamed result is accepted positionally. 'refused' requires EVERY attempt to be individually refused; any single unrefused attempt is 'violated'."
  - "WR-02 (no run-id scoping) is folded into the promoted window's required runId member rather than bolted on as a separate parameter — one promotion closes both CR-01 and WR-02 in the same move."
  - "WR-03's dead materialisedEpicId guard is removed outright (not left commented) since the reviewer confirmed the condition it was ANDed into always reduced to the rejected-task check alone — no behavioral change, and the branch's honest unproven-this-run narration is unchanged."

requirements-completed: [SHAPE-01, SHAPE-02]

coverage:
  - id: D1
    description: "readNoWorkPlanned's window is a required parameter; the unscoped call CR-01 needed throws a TypeError naming the first missing member, and the live body takes the challenge-window boundary once and reuses it rather than recomputing a second, unscoped reading after decompose-stage activity"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario proposes-work-after-advance"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (5/5 scenarios)"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (52 PASS, 0 FAIL)"
        status: pass
      - kind: other
        ref: "awk-scoped grep: exactly one non-comment call to readNoWorkPlanned in the live body (down from two)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A refused first propose attempt can no longer launder an unrefused second one into a false 'refused' reading (WR-01); the RED evidence that the bypass was real is preserved as its own commit"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test — the WR-01 bypass check and 8 companion edge-case checks (order-independence, both-refused, wrong-tool-name exclusion, positional-unnamed acceptance, toIndex adjacency, empty window, foreign runId, all three missing-member TypeErrors)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Three non-blocking 05-REVIEW.md findings (WR-03 dead guard, IN-01 skip-conflated-with-failure, IN-02 unnamed timing constant) cleared with no behavioral change on any currently-exercised path"
    requirement: "SHAPE-02"
    verification:
      - kind: other
        ref: "grep -c DRAIN_POLL_MS scripts/uat/lib/sidecar-harness.mjs >= 3; grep -c 'process.exitCode === 1' >= 1; materialisedEpicId occurs zero times; authoring_acceptance.rs narration still present"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test / --board-read-check / --replay-check all exit 0"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 23: CR-01 Gating-Window Closure — SHAPE-01 Can Now Report a Genuine Result in Both Directions Summary

**Promoted `readNoWorkPlanned`'s window to a required parameter and correlated each propose attempt with its own answer, so a legitimate decompose-stage proposal can never be misread as a challenge-stage violation while the old unscoped reading is proven, in the same run, to still be wrong.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-24T (Task 1 commit `00e2810`)
- **Completed:** 2026-09-24T (Task 3 commit `8af39c9`)
- **Tasks:** 3 (Task 1: tracer, Task 2: auto/tdd, Task 3: auto)
- **Files modified:** 3 (`scripts/uat/uat-08-socratic-authoring.mjs`, `scripts/uat/lib/fake-authoring-claude.mjs`, `scripts/uat/lib/sidecar-harness.mjs`)

## Accomplishments

- **CR-01 closed at the root.** `readNoWorkPlanned(events)` is now `readNoWorkPlanned(events, window)`, where `window = { runId, fromIndex, toIndex }` is REQUIRED — omitting any member throws a `TypeError` naming it, so the old one-argument, implicit-whole-array call shape is unwritable. The live body captures the challenge-window boundary (`challengeWindowEnd`) exactly once, immediately after `driveChallengeConversation` returns and `assertAllHeldRequestsAnswered` passes, and reuses that SAME binding as the final gating value instead of re-reading the whole unscoped event array after decompose-stage `propose_*` calls have legitimately happened.
- **The regression that would have caught CR-01 now exists and has teeth.** A new `proposes-work-after-advance` scenario in `SCENARIOS` (and a matching branch in `runReplayCheckScenario`) drives a clean challenge stage (three questions, all answered from the fixed answer bank, no propose call), settles, advances the stage, sends one post-advance developer turn (the real distillation instruction, mirroring the live body), and asserts — in order — that the bounded reading is `unproven`, that a propose call provably lands at or after the boundary, that the UNBOUNDED reading over the same run is STILL `violated` (the CR-01 reading, proven to still be wrong), that the bounded reading is not `violated`, and that `buildCriteriaResults` reports SHAPE-01 as passing on this successful path.
- **WR-01 closed with RED evidence preserved.** `readNoWorkPlanned` no longer asks two independent existence questions ("was any attempt made" / "was anything refused anywhere in the window"); it now correlates each individual propose attempt with its own positionally-found `tool_result` answer (`ToolResultEvent` carries no correlation id) and returns `"refused"` only when EVERY attempt is individually refused. A dedicated self-test check proving the bypass was real (a refused first attempt laundering an unrefused second into a false `"refused"` reading) was written and confirmed FAILING against the pre-rewrite body (1 FAIL / 43 PASS, exit 1) before the fix landed, exactly as the TDD gate requires.
- **WR-02 folded into the same promotion.** The window's required `runId` member closes the missing run-scoping WR-02 named, rather than being bolted on as a fourth parameter.
- **Three non-blocking findings cleared (WR-03, IN-01, IN-02).** The dead `materialisedEpicId` guard is removed from the SHAPE-05 reporting branch (the condition always reduced to the rejected-task check alone); the multi-scenario `--replay-check` aggregation loop no longer conflates a skipped scenario (exit code 3) with a failed one (exit code 1); the bare `5_000` poll literal inside `drainInboundCoreRequests` is now the named, exported, doc-commented `DRAIN_POLL_MS`.
- Final state: `--self-test` reports 52 PASS / 0 FAIL (up from the pre-round 42); `--replay-check` reports `✅ PASS` for all five scenarios (four pre-existing plus the new one); `--board-read-check` exits 0; `git diff --quiet -- packages/` is clean throughout — no product file was touched.

## Task Commits

1. **Task 1: A clean challenge followed by a legitimate decompose proposal reports SHAPE-01 as PASSING — end to end, offline, and it would have caught CR-01** — `00e2810` (test)
2. **Task 2, RED: add failing self-test proving the WR-01 bypass is real** — `c5dff99` (test)
3. **Task 2, GREEN: correlate each propose attempt with its own answer** — `36e9163` (feat)
4. **Task 3: clear WR-03, IN-01, IN-02** — `8af39c9` (refactor)

**Plan metadata:** this SUMMARY's own commit (pending)

_Note: Task 2 carried `tdd="true"` and produced two commits (RED then GREEN) per the plan's own instruction to write and confirm-fail the bypass check before the rewrite landed; no REFACTOR commit was needed — the GREEN implementation required no further cleanup._

## Files Created/Modified

- `scripts/uat/uat-08-socratic-authoring.mjs` — promoted `readNoWorkPlanned` signature, new `PROPOSE_TOOL_NAME_FRAGMENT`/`CHALLENGE_REFUSAL_PATTERN` constants, `challengeWindowEnd` boundary capture and reuse in the live body, the `proposes-work-after-advance` replay-check branch, per-attempt refusal correlation, 11 new self-test checks, the WR-03/IN-01 fixes
- `scripts/uat/lib/fake-authoring-claude.mjs` — the new `proposes-work-after-advance` `SCENARIOS` fixture (5 keys total)
- `scripts/uat/lib/sidecar-harness.mjs` — the new exported `DRAIN_POLL_MS` constant (IN-02)

## Decisions Made

See `key-decisions` in the frontmatter. Summarizing the load-bearing one: the window was PROMOTED to a required parameter (not add-alongside) precisely because add-alongside is what already shipped and is the defect itself — a second call site (the live body's `finalNoWorkPlannedReading`) that happened not to pass the correctly-scoped window. Promotion makes that shape a compile-time-adjacent (throw-on-first-line) impossibility rather than a discipline someone has to remember.

## Deviations from Plan

None — plan executed exactly as written, including its four flagged prohibitions:

- **Did not widen what counts as a refusal.** `CHALLENGE_REFUSAL_PATTERN` is unchanged (`/challenge stage/i`, matched only against the correlated answer's own `raw` text) — the per-attempt correlation narrows WHICH `tool_result` counts as an attempt's answer, it does not loosen the wording match itself.
- **Did not narrow the window until it is always empty.** The window is exactly `[turn1Cursor, challengeWindowEnd)` in the live body and an equivalent, non-degenerate span in every replay scenario — the `proposes-work-after-advance` scenario's own assertion #2 (a propose call for this run provably exists at or after `challengeWindowEnd`) is the structural proof this window is not vacuous.
- **Did not touch `packages/`.** `git diff --quiet -- packages/` was asserted clean after every one of the three tasks; all edits landed in `scripts/uat/` only.
- **Did not spend a credential or run the live arm.** Every verification in this plan ran through `--self-test`, `--board-read-check` and `--replay-check` — all offline, all against the scripted `fake-authoring-claude.mjs` backend, zero tokens spent.

## Issues Encountered

None. The one subtlety worth recording for a future reader: the per-attempt refusal correlation (Task 2) is deliberately a SINGLE-CANDIDATE positional scan — an attempt's answer is the FIRST subsequent `tool_result` in-window, full stop; if that candidate's declared name mismatches, the attempt has NO answer at all (it is not given a second chance to find a later, matching `tool_result`). An earlier draft of the "order-independent" self-test check assumed a bare "unanswered" attempt shape would keep two attempts' answers distinct, which turned out to let both attempts converge on the same later `tool_result` — the fixture was corrected to use the wrong-tool-name exclusion (already covered by its own dedicated check) to keep the two attempts' answers genuinely distinct, matching how a real two-attempt conversation would actually be shaped on the wire.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `05-VERIFICATION.md`'s FAILED truth #19 (CR-01) is closed: the live arm's gating reading is now bounded at or before `advance-stage`, proven both to pass on the successful path and to still fail under the old unscoped reading — reproducible without spending a credential.
- WR-01 and WR-02 (the two Warning-level findings closest in kind to CR-01) are also closed. WR-03/IN-01/IN-02 are closed. WR-04 remains explicitly deferred to plan `05-25` per this plan's own `deferred_findings` — it lives in `waitForTurn`'s timing behavior in a different file region and needs its own fake-backend capability (a mid-turn delay) no fixture has today.
- The still-genuinely-outstanding item from `05-VERIFICATION.md` is unchanged by this plan by design: SHAPE-01's live dialogue-quality judgment and SHAPE-03's draft-usefulness judgment remain unproven — no offline arm can close them, and this plan explicitly ran no live arm. The next live `uat-08` run (once the separately-tracked safety-classifier-refusal capture gap from `05-22-SUMMARY.md` is also fixed) will, for the first time, have a trustworthy SHAPE-01 "no work planned" verdict to report either way.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `scripts/uat/uat-08-socratic-authoring.mjs`
- FOUND: `scripts/uat/lib/fake-authoring-claude.mjs`
- FOUND: `scripts/uat/lib/sidecar-harness.mjs`
- FOUND: commit `00e2810` (Task 1)
- FOUND: commit `c5dff99` (Task 2 RED)
- FOUND: commit `36e9163` (Task 2 GREEN)
- FOUND: commit `8af39c9` (Task 3)
- Plan-level `<verification>` re-run: `--replay-check` 5/5 PASS, `--self-test` 52 PASS / 0 FAIL, `--board-read-check` exit 0, no call to `readNoWorkPlanned` anywhere in the live body region passes fewer than two arguments (awk-scoped count = 1, down from 2), `git diff --quiet -- packages/` clean — all pass.
