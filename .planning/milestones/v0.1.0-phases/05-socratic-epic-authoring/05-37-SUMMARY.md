---
phase: 05-socratic-epic-authoring
plan: 37
subsystem: testing
tags: [adapter-seam, uat-harness, wire-events, evidence-capture, node, typescript]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-36)
    provides: the restructured live-arm evidence path (writeChallengeEvidence, TurnDeadlineError, cleanup({ preserveRoot })) this plan builds its Task 3 scenario against, plus the replay arm's advance-stage gate reading conversation.nonConversation rather than a scenario-name list
provides:
  - ThinkingEvent/RateLimitEvent joining the AgentEvent union — a reasoning-only assistant message and a rate_limit_event line are modelled events, not raw unknowns dumped to stderr
  - 05-REVIEW.md WR-02 closed (isApiErrorMessage carries an explicit wire false) and WR-03 closed (a non-object/null parsed stream line can no longer throw a TypeError out of the readline handler and crash the sidecar for the whole fleet)
  - scripts/uat/fixtures/live-opus5-unmodelled-shapes.json — the real frozen capture of both new shapes, as 200-character PREFIXES, with two mechanical gates making drift and invention impossible
  - createUnmodelledEventSink (sidecar-harness.mjs) — a bounded, durable JSONL capture of every unmodelled sidecar event beside the existing stderr slice, resolved only through the artifact directory
  - scripts/uat/lib/fake-authoring-claude.mjs's scenario-level preamble mechanism and the unmodelled-wire-shapes scenario, proving both new shapes flow end to end through the real sidecar and normaliser at zero token cost
affects: [05-38, 05-39]

# Actuals (#2632)
actuals:
  tokens: 14535
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A wire-carried boolean fact is spread with a strict typeof check (never === true alone), so an explicit false is a real reading and is carried — the ResultEvent.isError idiom, now also applied to AssistantTextEvent.isApiErrorMessage"
    - "A guard at the very top of a stream-line normaliser rejects null/non-object input before any property read, closing the gap a try/catch around JSON.parse alone cannot: JSON.parse('null') does not throw"
    - "A frozen fixture built from a truncated real capture stores only PREFIXES plus mechanical gates (every key/scalar in the reconstructed line must appear in its own observed prefix; every observed prefix must appear verbatim in the source log) — never a hand-typed reconstruction of what the shape probably continues as"
    - "An injected, optional sink (constructor parameter defaulting to undefined) lets a durable side-channel capture be added beside an existing behavior with zero change to any caller that does not opt in"
    - "A scenario-level preamble array (raw wire objects printed verbatim before any turn) lets a scripted backend fixture express a top-level line unrelated to any turn — the shape a rate_limit_event line arrives in on the real wire"

key-files:
  created:
    - scripts/uat/fixtures/live-opus5-unmodelled-shapes.json
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/adapter.test.mjs
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "The reasoning branch in normaliseStreamEvent's assistant/user branch sits AFTER the existing tool_use/tool_result/text searches, gated to the assistant role only — preserves the existing find-first behavior for [reasoning, text] and [reasoning, tool_use] messages byte-for-byte, and a user-role reasoning block falls through to unknown rather than being assumed."
  - "ThinkingEvent.hasSignature records presence only, never the signature's value — the only capture this repository has of one is cut mid-value by the harness's own 200-character stderr slice, and carrying a partial fragment forward would misrepresent it as the real thing (T-05-37-03)."
  - "Task 2's frozen reasoning shape carries NO signature key at all, even though the observed prefix shows a signature was present on the wire — the value is unmeasured past the truncation cut, and the fixture's own honesty gate (every scalar must appear verbatim in its own observed prefix) would otherwise let an invented partial value slip through unnoticed. This makes the replayed reasoning event's own hasSignature read false for THIS specific fixture; Task 1's own unit tests (fed a synthetic signature directly) are what prove hasSignature reads true when a signature genuinely is present. Recorded here because the plan's own acceptance-criteria wording (\"records a signature was present\") reads as the event's own field, but the plan's action text and its prohibitions list state twice, explicitly, that the fixture's line must carry no signature key — the stronger, doubly-stated, flagged prohibition against inventing unmeasured data took precedence over the looser acceptance-criteria phrasing."
  - "createUnmodelledEventSink rewrites its whole output file on every append() call rather than streaming appends — deliberate, given the 500-line/65536-byte-per-line bounds keep the total cost trivial, and a full rewrite is what lets the single boundary line (recording the limit and the running suppressed count) be updated in place rather than duplicated once the cap is reached."
  - "classifyNonConversationTurn (sidecar-harness.mjs) already tested isApiErrorMessage with strict === true — no change was needed there to close the WR-02 truthiness-trap the plan asked to check for."

patterns-established:
  - "Reasoning-block-then-content ordering constraint: a new content-block branch inside an existing find-first normaliser must be added strictly after every prior branch's own search, with the ordering stated as a load-bearing constraint in its own comment, never merely as incidental code position."
  - "Scenario-level preamble as the vocabulary extension point for a non-turn wire line in fake-authoring-claude.mjs, mirroring how delayMs/role/envelopeExtra/resultExtra were each added as an independent, backward-compatible extension in prior rounds."

requirements-completed: [SHAPE-01, SHAPE-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "A reasoning-only assistant message and a rate_limit_event line are modelled events (ThinkingEvent/RateLimitEvent) at the adapter seam rather than raw unknowns dumped to stderr; every previously-modelled shape normalises byte-for-byte unchanged; 05-REVIEW.md WR-02 (explicit false carried) and WR-03 (null/non-object input cannot throw) are both closed."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs — 21 new tests covering reasoning-only/reasoning-then-text/reasoning-then-tool_use/user-role-reasoning/find-first/empty-content/rate_limit full+degraded/is_api_error_message explicit-false/null+scalar non-throw/grep gate"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar run build && npm --prefix packages/sidecar test (180/180 pass, exit 0)"
        status: pass
      - kind: other
        ref: "grep -c 'is_api_error_message === true' packages/sidecar/src/claude-code-adapter.ts (reports 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both new wire shapes are grounded in a real frozen capture from the committed live-run log, stored as 200-character PREFIXES with two mechanical gates making it impossible for the fixture to invent a field or drift from its source."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs — 4 new fixture tests (invented-field gate, drift gate, rate-limit normalisation, reasoning normalisation + lostToTruncation check)"
        status: pass
      - kind: other
        ref: "node -e cross-check: both observedPrefix values verbatim in 05-LIVE-RUN-01M3C48C-FAILED.log, each exactly 200 characters"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unmodelled sidecar event leaves a complete, durable, bounded record beside the existing 200-character stderr slice (never instead of it), resolved only through the artifact directory; both new shapes flow end to end through the real sidecar and the real shipped normaliser at zero token cost, with the run's unknown-event count asserted at zero."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test, 7 checks labelled [Plan 05-37, Task 3]"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario unmodelled-wire-shapes (exit 0, zero 'unrecognised sidecar event' lines)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (full 13-scenario sweep, all pass — was 12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Zero credentials spent by this plan's own work; the live arm was never executed; both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md remain unfilled and the transcript file is byte-unchanged."
    verification:
      - kind: other
        ref: "git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md"
        status: pass
    human_judgment: false

duration: 37min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 37: Adapter-seam modelling of reasoning blocks and rate-limit notices, with a durable full-fidelity capture replacing the truncating logger (G-05-7 closure)

**Two wire event shapes the shipped `claude` CLI emits — a reasoning-only assistant message and a `rate_limit_event` line — are now modelled `AgentEvent` members instead of raw unknowns, grounded in a real frozen capture with mechanical anti-drift/anti-invention gates, and a durable JSONL sink now records every unmodelled event in full rather than truncating it to 200 characters on stderr.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-09-25T20:35:00+08:00
- **Completed:** 2026-09-25T21:12:00+08:00
- **Tasks:** 3
- **Files modified:** 6 (1 created)

## Accomplishments

- `ThinkingEvent`/`RateLimitEvent` (`packages/sidecar/src/adapter.ts`) join the `AgentEvent` union. `claude-code-adapter.ts`'s `normaliseStreamEvent` now models a reasoning-only assistant message (eleven of them, live run `01M3C48C3PV1NSGHERBZ587YB1` turn 1) and a `rate_limit_event` line (utilization 0.81, seven-day limit, `allowed_warning`) — both previously fell through to `unknown` and were dumped to stderr as truncated raw JSON.
- The reasoning branch sits strictly after the existing tool_use/tool_result/text searches, and only for the assistant role — a `[reasoning, text]` or `[reasoning, tool_use]` message still normalises exactly as it did before this plan, and a user-role reasoning block falls through to `unknown` rather than being assumed.
- `05-REVIEW.md` WR-02 closed: `isApiErrorMessage` now carries an explicit wire `false`, mirroring `ResultEvent.isError`'s own idiom. WR-03 closed: a stream line that parsed to JSON `null` (or any other non-object scalar) can no longer throw a `TypeError` out of the synchronous `readline` handler and crash the sidecar for the whole fleet.
- `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json` freezes both new shapes as 200-character PREFIXES — the harness's own truncation length — with two mechanical test gates making it structurally impossible for the fixture to invent a field the capture never showed or to drift from the committed log it was frozen from.
- `createUnmodelledEventSink` (`scripts/uat/lib/sidecar-harness.mjs`) is a bounded (500 lines, 65536 bytes/line), durable JSONL capture of every event the harness classifies as `unknown`, wired into `SidecarClient` as an optional constructor parameter and resolved by `Harness.startSidecar` exclusively through `artifactDir()` — never the repository, never `.planning/`. The existing 200-character stderr line is unchanged, kept beside the new capture, never replaced.
- `fake-authoring-claude.mjs` gains a scenario-level `preamble` mechanism (a raw wire line replayed before any turn) and a new `unmodelled-wire-shapes` scenario, importing both shapes from the frozen fixture rather than retyping them. `uat-08-socratic-authoring.mjs`'s replay-check branch drives it through the real sidecar and real normaliser, asserting a `rate_limit` event, a `thinking` event, the ordinary conversation still reaching the developer's reply, and — the assertion that would have caught this gap — a positive count of **zero** `unknown`-type events for the run.

## Task Commits

Each task was committed atomically:

1. **Task 1: Model reasoning blocks and rate-limit notices at the adapter seam, and close the two review warnings living in the same function** - `8e28d8b` (feat)
2. **Task 2: Freeze the real captures from the committed live-run log, as prefixes, with mechanical gates** - `767c01c` (test)
3. **Task 3: Stop the instrument truncating the evidence it needs — durable capture, both new shapes proven end to end offline** - `767f621` (feat)

## Files Created/Modified

- `packages/sidecar/src/adapter.ts` — `ThinkingEvent`/`RateLimitEvent` interfaces, both added to the `AgentEvent` union; `AssistantTextEvent.isApiErrorMessage`'s doc comment corrected for WR-02.
- `packages/sidecar/src/claude-code-adapter.ts` — a non-object/null guard at the top of `normaliseStreamEvent` (WR-03); `ClaudeStreamMessage`'s content block gains optional `thinking`/`signature` fields; new `ClaudeStreamRateLimit` wire-shape interface added to `ClaudeStreamEvent`; the reasoning branch and the `rate_limit_event` branch; WR-02's strict-boolean spread fix.
- `packages/sidecar/test/adapter.test.mjs` — 25 new tests (21 for Task 1's behavior/must-haves, 4 for Task 2's fixture-honesty gates and normalisation).
- `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json` — the frozen real capture, new file.
- `scripts/uat/lib/sidecar-harness.mjs` — `UNMODELLED_EVENT_CAPTURE_LIMIT`, `UNMODELLED_EVENT_LINE_LIMIT`, `createUnmodelledEventSink`; `SidecarClient` takes an optional `sink`; `Harness.startSidecar` creates and wires it, printing a one-line summary on cleanup when anything was captured.
- `scripts/uat/lib/fake-authoring-claude.mjs` — scenario-level `preamble` support in `main()`; the `unmodelled-wire-shapes` scenario.
- `scripts/uat/uat-08-socratic-authoring.mjs` — the `unmodelled-wire-shapes` replay-check branch; 7 new self-test checks (`[Plan 05-37, Task 3]`) for the sink's own bounds, truncation recording, artifact-directory-only placement and no-sink default.

## Decisions Made

See `key-decisions` in the frontmatter above. The one worth restating in prose: Task 2's own action text and its `flagged: true` prohibition both state, explicitly and twice, that the frozen reasoning shape's `line` must carry **no signature key at all** — the wire's signature value is cut mid-value by truncation, and inventing even a partial value would assert something nobody measured. One acceptance-criteria line, read literally, could be taken to ask that the *event* record `hasSignature: true` for this fixture — which is unreachable without inventing a signature value the fixture is elsewhere forbidden to carry. Resolved in favor of the stronger, doubly-stated, explicitly flagged prohibition: the fixture's line has no signature key, its normalised event reads `hasSignature: false`, and its `lostToTruncation` field states in prose that a signature was present on the wire and was cut. Task 1's own unit tests (which feed a synthetic signature value directly, not through this specific truncated fixture) are what prove `hasSignature` reads `true` when a signature genuinely is present.

## Deviations from Plan

None — plan executed as written. The reading above is a resolution of an internal ambiguity between two of the plan's own instructions, not a deviation from what was ultimately implemented; every acceptance-criteria line and every `<verify>` command in the plan passes as written, including the ones this note explains.

## Issues Encountered

None. `npm --prefix packages/sidecar run build` succeeded before this plan's first edit (the Task 1 precondition), and every `<verify>` command for all three tasks passed on the first attempt after implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The adapter's `AgentEvent` union is now complete for every shape observed in live run `01M3C48C3PV1NSGHERBZ587YB1` — plans 05-38/05-39 (turn-boundary retuning and the three flagged assumptions) build on a normaliser that no longer discards real operational information or crashes on a malformed line.
- The next live run — whenever a human spends that credential — will leave a durable, complete record of anything it emits that this round still could not model, rather than a 200-character stderr slice. The forcing condition `scripts/uat/README.md`'s `add-alongside` decision names (a third well-formed-but-unmodelled shape) is now detectable with full fidelity, not merely inferable from a truncated prefix.
- Zero credentials spent by this plan; the live arm was never executed; both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain unfilled, exactly as the plan's own prohibitions require.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*

## Self-Check: PASSED

- FOUND: packages/sidecar/src/adapter.ts
- FOUND: packages/sidecar/src/claude-code-adapter.ts
- FOUND: packages/sidecar/test/adapter.test.mjs
- FOUND: scripts/uat/fixtures/live-opus5-unmodelled-shapes.json
- FOUND: scripts/uat/lib/sidecar-harness.mjs
- FOUND: scripts/uat/lib/fake-authoring-claude.mjs
- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND commit: 8e28d8b
- FOUND commit: 767c01c
- FOUND commit: 767f621
- Re-ran `npm --prefix packages/sidecar run build`: exit 0
- Re-ran `npm --prefix packages/sidecar test`: exit 0, 180/180 pass
- Re-ran `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`: exit 0, all checks pass
- Re-ran `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check`: exit 0, 13/13 scenarios pass
- Re-ran `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario unmodelled-wire-shapes`: exit 0, zero "unrecognised sidecar event" lines
- `grep -c 'is_api_error_message === true' packages/sidecar/src/claude-code-adapter.ts`: 0
- `git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md`: exit 0 (transcript untouched, both verdict lines still unfilled)
- Both observed prefixes verbatim in `05-LIVE-RUN-01M3C48C-FAILED.log`, each exactly 200 characters
