---
phase: 05-socratic-epic-authoring
plan: 38
subsystem: testing
tags: [uat-harness, turn-boundary, wall-clock-deadline, idle-window, node]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-36/05-37)
    provides: the restructured live-arm evidence path (writeChallengeEvidence, TurnDeadlineError) and the reasoning/rate-limit AgentEvent modelling (ThinkingEvent, thinking events on the wire) this plan's accumulateTurn branch and mid-flight window build directly on
provides:
  - LIVE_TOOL_CALL_IDLE_MS (120000ms) — a finite, derived mid-flight idle window replacing plan 05-25's unconditional stand-down while a tool call is outstanding
  - accumulateTurn's thinkingCount progress signal, so a reasoning-only stretch re-arms whichever window applies instead of being invisible to it
  - decideTurnArmedWindow — the pure, exported arming-decision function waitForTurn's own timers now delegate to
  - LIVE_TURN_CEILING_MS (900000ms) replacing TURN_DEADLINE_MS, with its derivation and lower-bound status written beside it, reset on every observed progress signal rather than firing unconditionally from call start
  - The works-continuously-past-old-deadline offline scenario and its frozen negative control (decideTurnArmedWindowSuperseded), proving a turn that works continuously past the old deadline now completes instead of being killed
affects: [05-39]

# Actuals (#2632)
actuals:
  tokens: 12550
  tasks: 3
  commits: 3
plan_head_before: f5914b2f42cf41a82ba919515b1a6dd5681d92cf

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A timer-arming decision extracted as a pure, exported function (decideTurnArmedWindow) so a real async primitive's internal branching can be driven and asserted directly by --self-test with no timers and no waiting, mirroring the existing accumulateTurn/waitForTurn split."
    - "A wall-clock bound reset on every observed progress signal, not armed once from call start — turning what looks like a budget into a silence window with a much larger duration, so a turn that never falls silent for as long as the bound cannot be killed by it no matter how long its total run grows."
    - "A frozen negative control for a NEW mechanism (turn-window arming) declared independently from this file's existing frozen control for a different mechanism (propose-attempt correlation) — one frozen control per mechanism, not a shared slot."

key-files:
  created: []
  modified:
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs

key-decisions:
  - "The outer wall-clock ceiling (LIVE_TURN_CEILING_MS, formerly TURN_DEADLINE_MS) is now reset on every notification that advances a turn's own progress tuple, exactly like the ordinary idle window and the new mid-flight window — not a one-shot absolute timer armed once at call start. This was not spelled out verbatim in Task 1's or Task 2's own action text, but it is the only design that satisfies the plan's own first truth (\"never bounded by a total wall-clock budget\") and the letter of Task 3's own verify block, which requires a turn whose TOTAL elapsed time exceeds the ceiling it was given to still complete rather than be killed, as long as no single gap does. Without this change, Task 3's own works-continuously-past-old-deadline scenario could not pass by construction — a ceiling armed once at call start would fire regardless of activity, which is precisely the live run's own failure mode the whole plan exists to close."
  - "waitForTurn gained a toolCallIdleMs option (default LIVE_TOOL_CALL_IDLE_MS) and driveChallengeConversation gained a matching pass-through parameter, mirroring exactly how idleMs is already threaded — so a caller (the new replay-check scenario) can pass an explicit mid-flight window without retuning the live arm's own default."
  - "Task 1's and Task 3's --self-test checks are registered in uat-08-socratic-authoring.mjs (the sole --self-test host in this repository) even though Task 1's own <files> frontmatter names only sidecar-harness.mjs. This mirrors every prior plan in this phase (05-36, 05-37) — a self-test check cannot exist anywhere else and still run under `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`."
  - "REPLAY_CONTINUOUS_WORK_CEILING_MS/REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS (the new scenario's own offline bounds) are declared immediately before the --self-test trigger, not grouped with their sibling REPLAY_* constants further down the file — selfTest() reads REPLAY_CONTINUOUS_WORK_CEILING_MS directly in its own SCENARIOS-shape check, and --self-test invokes selfTest() before module evaluation reaches the --replay-check section's own constant declarations further down; declaring it there raised a real 'Cannot access before initialization' TDZ error, caught and fixed during this plan's own execution."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A live turn is now bounded by silence in every state it can be in — the ordinary idle window when nothing is outstanding, a new derived LIVE_TOOL_CALL_IDLE_MS (120000ms) window when a tool call is outstanding, and reasoning counted as a fourth progress signal (thinkingCount) so a reasoning-only stretch cannot be cut short by a stale timer. Replaces plan 05-25's unconditional idle stand-down, the exact mechanism live run 01M3C48C3PV1NSGHERBZ587YB1 died to."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test, 8 checks labelled [Plan 05-38, Task 1]"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario slow-tool-mid-turn"
        status: pass
    human_judgment: false
  - id: D2
    description: "TURN_DEADLINE_MS is renamed to LIVE_TURN_CEILING_MS (900000ms), with its derivation, its lower-bound status and the condition under which its own firing is reportable news all written beside it; PROPOSAL_DEADLINE_MS is left deliberately unchanged with a comment recording why. The ceiling now resets on every observed progress signal rather than being an absolute budget from call start."
    requirement: SHAPE-01
    verification:
      - kind: other
        ref: "grep -cE '(^|[^A-Z_])TURN_DEADLINE_MS' scripts/uat/uat-08-socratic-authoring.mjs (reports 0); grep -c LIVE_TURN_CEILING_MS non-comment lines (reports 4); grep -c 01M3C48C3PV1NSGHERBZ587YB1 (reports 6)"
        status: pass
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
    human_judgment: false
  - id: D3
    description: "New offline scenario works-continuously-past-old-deadline reproduces live run 01M3C48C3PV1NSGHERBZ587YB1's turn-1 shape in miniature (repeated reasoning/tool-use/tool-result blocks, every gap small, the TOTAL comfortably exceeding a short offline ceiling) and, driven through the real driveChallengeConversation, completes normally rather than being killed — proving the redesigned bounds survive the exact failure mode. The frozen superseded arming rule is asserted to differ from the shipped rule over the same accumulated state, and a second assertion in the same scenario proves a genuinely silent mid-flight turn still concludes in bounded time, naming the outstanding tool."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario works-continuously-past-old-deadline (reported: turn completed normally after ~4475-5245ms, past REPLAY_CONTINUOUS_WORK_CEILING_MS=2000ms, ended by result, 2 chunks captured; silent mid-flight check concluded on its own 200ms window naming [\"Bash\"])"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test, 3 checks labelled [Plan 05-38, Task 3]"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (full 14-scenario sweep, all pass — was 13)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Zero credentials spent by this plan's own work; the live arm was never executed; both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md remain unfilled and the transcript file is byte-unchanged; no file under packages/ was touched."
    verification:
      - kind: other
        ref: "git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md"
        status: pass
      - kind: other
        ref: "git diff --quiet -- packages/"
        status: pass
    human_judgment: false

duration: ~25min (active edit/verify time; see Deviations for the interruption this excludes)
completed: 2026-09-26
status: complete
---

# Phase 5 Plan 38: Idle-primary turn bounds close gap G-05-7's second finding — the live arm no longer kills a healthy turn

**A live turn is now bounded by silence in every state — a new finite mid-flight window when a tool call is outstanding, reasoning counted as turn progress, and a renamed, self-resetting wall-clock ceiling that states it is a lower bound — proven offline against a scenario that works continuously past the old 120000ms deadline and still completes.**

## Performance

- **Duration:** ~25 min of active edit/verification work, across a session interrupted by a 600s stream-watchdog stall between implementation and the final verification sweeps (see Deviations)
- **Started:** 2026-09-25 (session start, base commit `f5914b2`)
- **Completed:** 2026-09-26T08:13:02+08:00 (final task commit)
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `scripts/uat/lib/sidecar-harness.mjs`: `accumulateTurn` gained `thinkingCount`, returned on both return paths, never contributing to `chunks`/`chunkCount`/`charCount` (reasoning is not agent speech). `LIVE_TOOL_CALL_IDLE_MS` (120000ms, derived: all ~130 events of live run `01M3C48C3PV1NSGHERBZ587YB1`'s turn 1 fit inside 120000ms, so no single gap in that turn reached this value) replaces plan 05-25's unconditional idle stand-down while a tool call is outstanding. `waitForTurn`'s timer logic now delegates to the new pure, exported `decideTurnArmedWindow(partial, { idleMs, toolCallIdleMs })`, and the mid-flight conclusion reports `midFlight: true` and `outstandingTools` naming the unanswered tool(s).
- `scripts/uat/uat-08-socratic-authoring.mjs`: `TURN_DEADLINE_MS` renamed to `LIVE_TURN_CEILING_MS` (900000ms), with its four-part derivation written beside it; `PROPOSAL_DEADLINE_MS` left deliberately unchanged with a comment recording why. `REPLAY_TURN_DEADLINE_MS`/`REPLAY_THROWN_DEADLINE_MS` (the substring collision the plan named explicitly) are untouched. The outer ceiling now resets on every observed progress signal — the design decision that makes a continuously-active turn immune to it regardless of total elapsed time (see Decisions Made). 11 new `--self-test` checks (8 labelled `[Plan 05-38, Task 1]`, 3 labelled `[Plan 05-38, Task 3]`).
- `scripts/uat/lib/fake-authoring-claude.mjs`: new scenario `works-continuously-past-old-deadline`, built by `buildContinuousWorkTurn(5)` — five repetitions of (reasoning block, tool-use block with its own id, its own matching tool-result block), each delayed block carrying a small, fixed pause, finished by a text block carrying a question so the driver behaves as it does on a real challenge turn.
- Driven through the real `driveChallengeConversation` with an explicit short ceiling and mid-flight window, the scenario completes normally — measured elapsed time (~4475-5245ms across runs) exceeds the passed ceiling (2000ms) while every individual gap (400ms) stays comfortably below both bounds — proving the redesigned arrangement survives exactly the shape that killed the live run. A second assertion in the same scenario drives a further, deliberately unanswered tool call through a short mid-flight window and confirms it still concludes in bounded time, naming the outstanding tool.

## Task Commits

Each task was committed atomically:

1. **Task 1: Give the mid-flight state a finite idle bound of its own, and count reasoning as turn progress** - `d5212d2` (feat)
2. **Task 2: Replace the wall-clock turn deadline with a ceiling that states what it is, what it is derived from, and what it is not** - `1dba286` (fix)
3. **Task 3: Prove the new bounds offline against the mechanism that actually killed the live run** - `7365177` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE.md/ROADMAP.md, committed immediately after this file).

## Files Created/Modified

- `scripts/uat/lib/sidecar-harness.mjs` — `accumulateTurn`'s `thinkingCount`/`thinking` branch; `LIVE_TOOL_CALL_IDLE_MS`; `decideTurnArmedWindow` (exported pure arming decision); `outstandingToolNames` (shared helper); `waitForTurn`'s reworked `armWindow`/`armCeiling` closures and rewritten TRADEOFF doc comment.
- `scripts/uat/uat-08-socratic-authoring.mjs` — `LIVE_TURN_CEILING_MS` replacing `TURN_DEADLINE_MS`; `PROPOSAL_DEADLINE_MS`'s new non-change comment; `driveChallengeConversation`'s `toolCallIdleMs` pass-through; `decideTurnArmedWindowSuperseded` (frozen negative control); `REPLAY_CONTINUOUS_WORK_CEILING_MS`/`REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS`; the `works-continuously-past-old-deadline` replay-check branch; 11 new self-test checks.
- `scripts/uat/lib/fake-authoring-claude.mjs` — `CONTINUOUS_WORK_GAP_MS`, `buildContinuousWorkTurn`, and the `works-continuously-past-old-deadline` scenario entry.

## Decisions Made

See `key-decisions` in the frontmatter above. The one worth restating in prose: the outer wall-clock ceiling's semantics changed from "an absolute budget armed once at call start" to "a silence window reset on every observed progress signal, just with a much larger duration than the two more specific windows." This is a genuine design decision beyond a literal reading of Task 1's and Task 2's own action text (which describe the mid-flight window and the ceiling's rename/value/derivation separately, without stating the ceiling's own re-arming semantics change). It was necessary because the plan's first truth ("never bounded by a total wall-clock budget") and Task 3's own verify block (a turn whose TOTAL elapsed time exceeds the passed ceiling must still complete, provided no single gap does) are jointly unsatisfiable under the old, call-start-absolute semantics — an unconditional timer fires at its declared value regardless of activity, which is the exact live-run failure mode this plan exists to close. Confirmed correct by re-running the pre-existing `turn-deadline-exceeded` (plan 05-36) and `slow-tool-mid-turn` (plan 05-25) scenarios, both of which still pass unchanged: `turn-deadline-exceeded`'s two events (text, tool_call) both arrive well inside its own 1500ms ceiling and reset it twice before the scenario's own 4000ms silent gap, so the ceiling still fires at effectively the same wall-clock point and the message still reports "1500ms" verbatim.

## Deviations from Plan

### Process deviation (not a Rule 1-4 item)

**1. Execution was interrupted by a stream-watchdog stall (no progress for 600s) after implementation and initial verification were complete, but before this executor had re-run the full verification sweeps itself in the final, reconstructed working-tree state.**
- **What happened:** all three tasks' code was implemented and verified incrementally during the first pass (self-test and `--replay-check` — including the full 14-scenario sweep and the targeted `works-continuously-past-old-deadline`/`slow-tool-mid-turn` scenarios — all passing) before the stall. The orchestrator resumed this executor with the working tree intact and reported that it had independently run both sweeps against the exact same uncommitted content: `--self-test` exit 0 (every `[Plan 05-38, Task 1]`/`[Plan 05-38, Task 3]` check PASS) and `--replay-check` exit 0, 14/14 scenarios PASS (up from 13), with `works-continuously-past-old-deadline` reporting a turn completed after 4475ms, past the 2000ms ceiling, ended by `result`, 2 chunks captured, and the silent-mid-flight check concluding on its own 200ms window naming `["Bash"]`.
- **What this executor did on resume:** split the single-shot final diff into three task-scoped commits by reconstructing exact intermediate file states (via anchor-based text extraction from the already-verified final content, never retyped), and re-ran `node --check` plus `--self-test` at each of the three intermediate checkpoints (Task 1 alone, Task 1+2, Task 1+2+3) to confirm each stage was independently syntactically and behaviourally sound before committing it. The full `--replay-check` sweep was **not** re-run after this resume, per the orchestrator's explicit instruction not to re-verify — the restored final file is confirmed byte-identical (`diff -q`) to the exact content the orchestrator's own sweep already covered.
- **Impact:** none on correctness — the shipped code is byte-identical to what both this executor (before the stall) and the orchestrator (during the stall) independently verified passing. Documented here for the record, per the instruction to cite the orchestrator's numbers rather than claim a self-run that did not happen in this exact session state.

---

**Total deviations:** 1 process deviation (interruption/resume, no code impact). **Impact:** none — all specified `<verify>` commands and acceptance criteria pass, confirmed across two independent verification passes (this executor's first pass, and the orchestrator's sweep during the stall) plus this executor's own `--self-test` re-checks at each of the three post-resume commit checkpoints.

## Issues Encountered

- A `ReferenceError: Cannot access 'REPLAY_CONTINUOUS_WORK_CEILING_MS' before initialization` surfaced the first time `--self-test` ran with the Task 3 SCENARIOS-shape check in place, because that constant was originally declared near its sibling `REPLAY_*` constants further down the file — textually AFTER the `--self-test` trigger block that calls `selfTest()`, so the module's top-level evaluation had not yet reached that `const` declaration when `selfTest()` referenced it (a temporal-dead-zone violation, not a logic bug). Fixed by moving `REPLAY_CONTINUOUS_WORK_CEILING_MS`/`REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS` to just before the `--self-test` trigger, with a comment explaining why they live there rather than beside their siblings.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap `G-05-7`'s second finding is closed: the live arm's turn-boundary instrument no longer kills a healthy, continuously-working turn, and the one surviving wall-clock number states plainly that it is a lower bound and a runaway backstop, not a completion claim.
- Plan 05-39 (the three flagged assumptions this closure round carries) can proceed against a turn-boundary primitive whose bounds are now silence-based in every state a caller can distinguish.
- The live arm itself was never executed by this plan (by design) — the next live run remains the actual judgeable measurement of SHAPE-01/SHAPE-03, and this plan's own retuning is what makes that next run survivable if the model does genuine, prolonged exploratory work on its first turn.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- FOUND: scripts/uat/lib/sidecar-harness.mjs
- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND: scripts/uat/lib/fake-authoring-claude.mjs
- FOUND commit: d5212d2
- FOUND commit: 1dba286
- FOUND commit: 7365177
- `node --check` on all three files: exit 0 (verified at each of the three post-resume commit checkpoints)
- Re-ran `--self-test` at the Task 1 checkpoint: exit 0, all Task 1 checks PASS (Task 3 checks correctly absent — not yet added)
- Re-ran `--self-test` at the Task 1+2 checkpoint: exit 0; `grep -cE '(^|[^A-Z_])TURN_DEADLINE_MS'` reports 0
- Re-ran `--self-test` at the final (Task 1+2+3) checkpoint: exit 0, all `[Plan 05-38, Task 1]` and `[Plan 05-38, Task 3]` checks PASS
- Orchestrator-run `--replay-check` (full sweep, on the identical pre-split content): exit 0, 14/14 scenarios PASS
- `grep -c 01M3C48C3PV1NSGHERBZ587YB1` — sidecar-harness.mjs: 5, uat-08-socratic-authoring.mjs: 6 (both ≥ 1)
- `git diff --quiet -- packages/`: exit 0 (no product files touched)
- `git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md`: exit 0 (transcript untouched, both verdict lines still unfilled)
