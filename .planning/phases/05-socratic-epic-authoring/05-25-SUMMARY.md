---
phase: 05-socratic-epic-authoring
plan: 25
subsystem: testing
tags: [uat, socratic-authoring, instrument-hardening, gap-closure, wr-04, idle-window, tdd]

requires:
  - phase: 05-socratic-epic-authoring (plans 05-20, 05-23, 05-24)
    provides: the fixed capture instrument (whole-turn capture via accumulateTurn/waitForTurn,
      the bounded-window readNoWorkPlanned reading, backend-refusal detection) and 05-REVIEW.md's
      own WR-04 finding — the one item explicitly flagged as "worth tracking before the next live
      attempt" and deliberately deferred out of plans 05-23/05-24 because no fixture in this
      repository could express a mid-turn pause at all
provides:
  - "delayMs — an optional field on a fake-authoring-claude.mjs content block, awaited (via a real
    timer) before that block's own stdout line is written — the ONLY way this repository can
    express a genuine mid-turn pause; emitTurn is now async and incoming turns are serialised
    behind a promise queue so two overlapping turns cannot interleave their stdout lines"
  - "slow-tool-mid-turn — a new SCENARIOS fixture (short text, a Bash tool_use, a 1500ms-paused
    text block, one more text block) reproducing WR-04: a real Bash-shaped tool call that takes
    longer than the idle window, with nothing else on the wire in the meantime"
  - "accumulateTurn's pendingToolCallCount — a running FIFO count of this run's own outstanding
    tool_call events (incremented on tool_call, decremented on the run's own subsequent
    tool_result, floored at zero), returned on both of accumulateTurn's return paths"
  - "waitForTurn's onEvent now resets its idle timer ONLY on this watcher's own progress tuple
    (chunkCount, toolCalls.length, pendingToolCallCount) — a foreign run's event or a non-turn
    event advances none of them and neither arms nor extends the running timer"
  - "waitForTurn's idle window is stood down entirely while pendingToolCallCount > 0 — the outer
    timeoutMs deadline is the only backstop for a turn with an outstanding tool call, and the
    deadline rejection now names the outstanding tool call count and tool names"
  - "LIVE_TURN_IDLE_MS (sidecar-harness.mjs, 30s) — the live arm's own explicit idle window,
    passed at both of its remaining waitForTurn/driveChallengeConversation call sites instead of
    inheriting TURN_IDLE_MS (5s), the short default tuned for tests"
affects: [any-future-live-uat-08-run, phase-06-agent-authored-backlog]

actuals:
  tokens: 8664
  tasks: 2
  commits: 3
plan_head_before: 21aee12a9602573c9290ec4c0809efc161ecae7d

tech-stack:
  added: []
  patterns:
    - "A regression scenario for a real-time defect must be observed RED against the UNFIXED code
      before the fix lands — this phase's third time paying for that discipline (after 05-23's
      WR-01 bypass check and 05-24's NF-01 duplication proof). The verbatim pre-fix failure is
      recorded in this SUMMARY, not just asserted to have happened."
    - "An idle/liveness timer that tracks 'has this turn made progress' must track a TUPLE of
      run-scoped signals (chunk count, tool-call count, pending-tool-call count) rather than a raw
      scan-position index — a raw index (events.length on the fall-through path) grows on ANY
      event appended to a shared buffer, including one from a completely unrelated run, and using
      it as a progress signal silently reintroduces exactly the cross-run coupling a fix is trying
      to remove."
    - "A backend-fixture module intended to express real timing behaviour (a pause) must convert
      its own emission path to async and explicitly SERIALISE overlapping units of work (turns)
      behind a promise queue — synchronous emission that used to be safe becomes a genuine
      interleaving hazard the moment a real await is introduced anywhere in the emit path."

key-files:
  created: []
  modified:
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "The idle-reset progress tuple tracks (chunkCount, toolCalls.length, pendingToolCallCount),
    NOT the plan text's own literal suggestion of an 'end index' — accumulateTurn's fall-through
    endIndex is events.length, a raw scan-position over the WHOLE shared event buffer that grows
    on any event from any run. Using it as a progress signal would make a foreign run's event
    always read as 'advanced', reintroducing the exact WR-04 cross-run coupling this task closes.
    pendingToolCallCount is the one signal chunkCount/toolCalls.length cannot express alone: a
    tool_result answering a pending call changes neither of those two numbers, yet is real
    progress that must be allowed to re-arm the window (behavior #5 in the plan's own list)."
  - "pendingToolCallCount is a simple FIFO counter (increment on tool_call, decrement on the same
    run's next tool_result, floored at zero) rather than a per-tool-name correlation — mirrors
    accumulateTurn's own existing pure-scan style and matches the plan's own wording ('the number
    of tool_call events... with no subsequent tool_result event'). ToolResultEvent
    (packages/sidecar/src/adapter.ts) carries no correlation id, so there is nothing finer-grained
    to correlate against; a tool_result for this run answers whichever of this run's own tool
    calls has been outstanding longest."
  - "The deadline message's new outstanding-tool-call clause names the LAST pendingToolCallCount
    entries of toolCalls (a slice under the same FIFO-answering assumption the counter itself
    uses), not a separately-tracked list — keeps the fail() path a pure derivation from
    accumulateTurn's own return rather than adding a second piece of state to the promise closure."
  - "slow-tool-mid-turn's fixture delay (1500ms) and the matching --replay-check branch's explicit
    idleMs (300ms, SLOW_TOOL_IDLE_MS) sit ~5x apart, and REPLAY_TURN_DEADLINE_MS (10000ms) sits
    ~6.7x above the delay — comfortable margins in both directions, keeping the scenario decisive
    (would certainly have tripped the pre-fix policy) without making the offline arm slow."
  - "The RED/GREEN split for Task 1 lands as two commits (test then feat) even though the plan's
    own frontmatter does not literally mandate a two-commit split the way plan 05-23's Task 2 did
    — the task IS marked tdd=\"true\" and its own action text explicitly instructs 'run this
    scenario against the UNFIXED idle policy first and record its failure verbatim', which is
    exactly tdd.md's RED-then-GREEN contract. Task 2 (LIVE_TURN_IDLE_MS) carries no such
    instruction and is a single auto-type commit."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A turn paused mid-flight on an outstanding tool call is now captured WHOLE,
      ending on the backend's own result marker rather than the idle marker — closing WR-04, the
      last review finding flagged as blocking the next live attempt. The fixture can express a
      real mid-turn pause for the first time in this repository's history, and the reproduction
      was observed genuinely RED against the pre-fix policy before the fix landed."
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario slow-tool-mid-turn"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (7/7 scenarios, ~3.9s)"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (75 PASS, 0 FAIL — up from 68)"
        status: pass
      - kind: other
        ref: "node -e checks confirming LIVE_TURN_IDLE_MS > TURN_IDLE_MS and the 7-scenario SCENARIOS set including slow-tool-mid-turn"
        status: pass
    human_judgment: false
  - id: D2
    description: "The live arm states its own permitted mid-turn pause (LIVE_TURN_IDLE_MS, 30s) at
      each of its two remaining capture sites, rather than silently inheriting TURN_IDLE_MS (5s),
      the short default tuned for tests — closing the second half of WR-04's own finding."
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "test \"$(grep -vE '^[[:space:]]*(//|\\*|/\\*)' scripts/uat/uat-08-socratic-authoring.mjs | grep -c 'LIVE_TURN_IDLE_MS')\" -ge \"3\" (actual: 4)"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test — the new source-scanning check counting LIVE_TURN_IDLE_MS references scoped to the live body (>= 2)"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false

duration: ~24 min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 25: WR-04 Closure — A Mid-Turn Tool Pause No Longer Truncates the Capture Summary

**Gave the offline fixture the ability to pause mid-turn for the first time in this repository, reproduced WR-04 as a genuine RED failure against the unfixed idle policy, then scoped `waitForTurn`'s idle-reset to this turn's own progress and stood the window down entirely while a tool call is outstanding — closing the last review finding flagged as blocking the next live `uat-08` run.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-09-24 (context load + implementation)
- **Completed:** 2026-09-24T11:49:10Z
- **Tasks:** 2 (Task 1: tracer/tdd; Task 2: auto)
- **Files modified:** 3 (`scripts/uat/lib/fake-authoring-claude.mjs`, `scripts/uat/lib/sidecar-harness.mjs`, `scripts/uat/uat-08-socratic-authoring.mjs`)

## Accomplishments

- **The fixture can pause mid-turn for the first time.** `fake-authoring-claude.mjs`'s `emitTurn` is now async: a content block may carry an optional `delayMs`, awaited via a real timer before that block's own stdout line is written. Blocks without `delayMs` still emit immediately, so every pre-existing scenario's timing is unchanged. Because `emitTurn` may now genuinely pause, incoming turns are serialised behind a promise queue so two overlapping turns can never interleave their stdout lines — a fixture whose lines interleaved would prove the wrong thing.
- **The reproduction (`slow-tool-mid-turn`) was observed genuinely RED before the fix landed.** A new scenario — short text, a Bash `tool_use`, a text block pausing 1500ms, then one more text block — was run against the pre-fix `waitForTurn` (which reset its idle timer on ANY event and never suppressed the window for an outstanding tool call). It failed exactly as WR-04 predicts: `captured: chunks=1 chars=39 endedBy=idle` — the turn was truncated at the idle marker after only the first block, with the tool call, the paused block and the trailing block all lost. Verbatim failure recorded below.
- **`accumulateTurn` gained `pendingToolCallCount`.** A running FIFO count over a run's own `tool_call`/`tool_result` events (incremented on `tool_call`, decremented on the run's own subsequent `tool_result`, floored at zero — never keyed to a specific tool name, since neither event carries a correlation id), returned on both of `accumulateTurn`'s return paths.
- **`waitForTurn`'s idle-reset is now scoped to this watcher's own progress.** `onEvent` tracks the tuple `(chunkCount, toolCalls.length, pendingToolCallCount)` and only clears/re-arms the idle timer when at least one member has advanced since the previous notification — a foreign run's event, or a non-turn event, advances none of them and now leaves the running timer exactly as it was.
- **The idle window is stood down entirely while a tool call is outstanding.** With `pendingToolCallCount > 0`, no idle timer is armed at all; the outer `timeoutMs` deadline is the only backstop. Suppression lifts the moment the call is answered (a `tool_result` arrives) rather than latching for the rest of the turn. The `result` branch is completely unchanged — the backend's own end-of-turn line remains the primary signal and always wins immediately, including while a tool call is pending.
- **The deadline message now names the outstanding tool call.** When `pendingToolCallCount > 0`, `waitForTurn`'s rejection gains an `OUTSTANDING TOOL CALL(S)` clause naming the count and the tool names, beside the existing captured-chunk/character clause and the unanswered-held-request clause — a hang while waiting on a tool is now diagnosable from the error alone, distinct from a hang with nothing in flight.
- **The live arm states its own permitted pause at each capture site.** New exported `LIVE_TURN_IDLE_MS` (30s, `sidecar-harness.mjs`) is passed explicitly as `idleMs` at the live body's `driveChallengeConversation` call and its distillation `waitForTurn` call — neither inherits `TURN_IDLE_MS` (5s), the short default tuned for tests. `TURN_IDLE_MS` itself is unchanged. A new source-scanning self-test check asserts the live body names `LIVE_TURN_IDLE_MS` at least twice, so a future third live capture that forgets it is told by a failing check rather than silently inheriting the wrong default.
- **Final state:** `--self-test` reports 75 PASS / 0 FAIL (up from 68); `--replay-check` reports `✅ PASS` for all seven scenarios (six pre-existing plus `slow-tool-mid-turn`) in ~3.9 seconds — well under the 90-second ceiling; `--board-read-check` exits 0; `git diff --quiet -- packages/` clean throughout — no product file touched.

### Verbatim pre-fix RED failure (Task 1)

Recorded before any change to `waitForTurn`'s idle policy — the fixture and the new scenario/assertion existed, `accumulateTurn`/`onEvent` did not yet:

```
   · capturing the single scripted turn with an explicit short idleMs=300 — short enough that the PRE-FIX idle policy would certainly have truncated this capture at the fixture's own mid-turn pause
   · captured: chunks=1 chars=39 endedBy=idle

❌ FAIL — UAT 8 — offline turn-boundary replay check (scenario=slow-tool-mid-turn, real sidecar + fake backend, zero tokens)

AssertionError [ERR_ASSERTION]: expected the captured turn to carry every one of the fixture's 3 text block(s), got 1 — a turn paused on a slow tool call must never be truncated before it finishes

1 !== 3

    at file:///Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/scripts/uat/uat-08-socratic-authoring.mjs:2364:16
    at async runScript (file:///Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/scripts/uat/lib/sidecar-harness.mjs:894:5)
    at async runReplayCheckScenario (file:///Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/scripts/uat/uat-08-socratic-authoring.mjs:2199:3)
    at async file:///Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/scripts/uat/uat-08-socratic-authoring.mjs:2734:5
```

Confirmed GREEN after the fix: `captured: chunks=3 chars=156 endedBy=result` — every block present, ending on the backend's own result marker.

## Task Commits

1. **Task 1, RED: reproduce WR-04 — the fixture's own pause capability, the `slow-tool-mid-turn` scenario, and the `--replay-check` branch/assertion, confirmed failing against the pre-fix idle policy** — `eeac4f2` (test)
2. **Task 1, GREEN: scope the idle window to this turn's own progress and stand it down while a tool call is outstanding** — `c875253` (feat)
3. **Task 2: the live arm states its own permitted mid-turn pause at each capture site** — `1526443` (feat)

**Plan metadata:** this SUMMARY's own commit (pending)

_Note: Task 1 carried `type="tracer" tdd="true"` and produced two commits (RED then GREEN) per the plan's own explicit instruction to run the scenario against the unfixed policy first and record its failure verbatim — genuine TDD, not a hypothetical description of the defect. Task 2 (`type="auto"`, no `tdd` attribute) produced one commit. No REFACTOR commit was needed for either task — no further cleanup was required after GREEN._

## Files Created/Modified

- `scripts/uat/lib/fake-authoring-claude.mjs` — `delayMs` on a content block, async `emitTurn`, a serialising turn queue, the new `slow-tool-mid-turn` `SCENARIOS` fixture (7 keys total)
- `scripts/uat/lib/sidecar-harness.mjs` — `accumulateTurn`'s new `pendingToolCallCount` on both return paths; `waitForTurn`'s scoped-progress idle-reset, the idle-suppression-while-pending branch, and the deadline message's new outstanding-tool-call clause; new exported `LIVE_TURN_IDLE_MS`
- `scripts/uat/uat-08-socratic-authoring.mjs` — `SLOW_TOOL_IDLE_MS`, the new `slow-tool-mid-turn` `--replay-check` branch, 6 new self-test checks for the WR-04 behaviours (pendingToolCallCount arithmetic, both return paths, the deadline message's new clause, suppression holding through the idle window while pending, suppression lifting once answered, a foreign run's event during the pause not resetting the timer), the `LIVE_TURN_IDLE_MS` import and its two live-body call sites, a new source-scanning self-test check for the live body's reference count, and a widened window (2000 -> 2500 chars) on the pre-existing distillation-capture self-test scan (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter. Summarizing the load-bearing one: the idle-reset progress tuple tracks `(chunkCount, toolCalls.length, pendingToolCallCount)`, not a raw scan-position "end index" as the plan's own action text loosely suggested — `accumulateTurn`'s fall-through `endIndex` is `events.length`, which grows on ANY event appended to the shared buffer including a foreign run's, so using it as a progress signal would have silently reintroduced the exact cross-run coupling this task exists to remove. `pendingToolCallCount` is the one signal the other two cannot express alone (a `tool_result` answering a pending call), and using it as the third tuple member satisfies every behaviour in the plan's own list without violating the "foreign event neither arms nor extends" truth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened a pre-existing self-test's fixed-window source scan (2000 -> 2500 chars)**
- **Found during:** Task 2 (adding the `idleMs: LIVE_TURN_IDLE_MS` line to the live body's distillation `waitForTurn` call)
- **Issue:** An existing self-test check ("a timeout capturing the distillation reply does not abort the run...") slices `thisFile` from an anchor point for a fixed 2000 characters looking for `catch (err)` and `accumulateTurn(`. Adding the new `idleMs` line (plus its explanatory comment) pushed `accumulateTurn(` to offset 2211 from the anchor — past the fixed window — causing this pre-existing, unrelated-looking check to fail.
- **Fix:** Widened the slice to 2500 characters with a comment explaining why, leaving the check's semantic intent (scan the region right after the distillation narration for the catch/accumulateTurn pattern) unchanged.
- **Files modified:** `scripts/uat/uat-08-socratic-authoring.mjs`
- **Verification:** `--self-test` returned to 75 PASS / 0 FAIL after the widen; re-ran the full suite (`--replay-check`, `--board-read-check`) to confirm no other regression.
- **Committed in:** `1526443` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The fix is narrowly scoped to an unrelated pre-existing check's own magic-number window; no behavioral change to any product or harness logic. No scope creep.

## Issues Encountered

None beyond the deviation documented above, which is fully resolved with no residual effect.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- WR-04 — the last `05-REVIEW.md` finding explicitly flagged as blocking the next live attempt — is closed at the mechanism (the idle policy's own scoping and suppression), not by moving a number. This repository can now express a real mid-turn pause in a fixture at all, closing the specific gap that let WR-04 go uncaught by every offline arm before this plan.
- The degrade path plan 05-20 built is preserved and re-verified: a genuinely quiet turn (no tool call outstanding) still ends on the idle window and still reports the idle marker — the pre-existing self-test check asserting this passes unmodified, byte-identical to its pre-plan source.
- Not one credential was spent — every verification in this plan ran through `--self-test`, `--board-read-check` and `--replay-check`, all offline against the scripted `fake-authoring-claude.mjs` backend. `git diff --quiet -- packages/` was asserted clean after both tasks.
- SHAPE-01's live dialogue-quality verdict and SHAPE-03's draft-usefulness verdict in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain, by design, `UNJUDGED` — this plan spent nothing and filled no verdict line. With WR-04 now closed alongside the backend-refusal detection (plan 05-24) and the CR-01/WR-01/WR-02 gating-window closure (plan 05-23), the next authorised live `uat-08` run is the first one this phase can say has no known way to misreport a turn boundary, misread a refusal, or misread a stage-gate violation. Whether and when to spend that live run remains a decision for a future plan.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `scripts/uat/lib/fake-authoring-claude.mjs`
- FOUND: `scripts/uat/lib/sidecar-harness.mjs`
- FOUND: `scripts/uat/uat-08-socratic-authoring.mjs`
- FOUND: commit `eeac4f2` (Task 1 RED)
- FOUND: commit `c875253` (Task 1 GREEN)
- FOUND: commit `1526443` (Task 2)
- Plan-level `<verification>` re-run: `--replay-check` 7/7 PASS (~3.9s, under the 90s ceiling), `--self-test` 75 PASS / 0 FAIL, `--board-read-check` exit 0, `git diff --quiet -- packages/` clean — all pass.
