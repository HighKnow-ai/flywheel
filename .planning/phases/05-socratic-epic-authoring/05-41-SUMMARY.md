---
phase: 05-socratic-epic-authoring
plan: 41
subsystem: adapter
tags: [sidecar, adapter, claude-code, ask-user-question, tdd, gap-closure, fixture]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-40)
    provides: no logical dependency — a BUILD-OUTPUT serialization only (shared `packages/sidecar/dist/` compile target and moving test-count baseline), stated explicitly in this plan's own `<dependency_note>`
provides:
  - A typed, ordered `ToolCallEvent.questions?: AskUserQuestionPrompt[]` field carrying an `AskUserQuestion` tool call's questions/options through the adapter seam, additive-only (no `AgentEvent` union change)
  - `parseAskUserQuestionInput` — a pure, total parser bounded by `MAX_ASK_USER_QUESTIONS`/`MAX_ASK_USER_QUESTION_OPTIONS`, returning `undefined` (never an empty array, never a throw) for any non-conforming payload
  - A frozen, byte-identical real capture of live run `01M3DNC0G9CYAWSD8DYEGTRP8C`'s `AskUserQuestion` call at `scripts/uat/fixtures/live-opus5-ask-user-question.json`
  - `buildAuthoringClaudeArgv` now disallows `AskUserQuestion` unconditionally, keeping the challenge stage free conversation (D-88/D-89); `buildClaudeArgv` (task-execution) is untouched
affects: [05-42]

# Actuals (#2632)
actuals:
  tokens: 7965
  tasks: 3
  commits: 3
plan_head_before: 698a55f23a41451b246a560369ca2c4b9c882253
commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A backend payload that is 'a detail of one already-modelled tool_use variant' is carried as an additive optional field on the EXISTING event (ToolCallEvent.questions), never as a new AgentEvent union member — the same add-alongside-not-promote choice 05-40-PLAN.md's <assumption_delta_decision> named as this round's correct move, and the reason a reclassification would break `accumulateTurn`'s tool_call/tool_result pending-count bookkeeping (T-05-41-05)."
    - "Enforcing a conversational-shape rule by absence from the tool set (D-88's own mechanism for the proposal tools) generalizes cleanly to a model-rendered UI primitive: `--disallowedTools AskUserQuestion` removes the form from an authoring session's tool set entirely, rather than instructing the model not to use it."
    - "A model-supplied payload parser is pure, total, and bounded: every property read is guarded by its own typeof/shape check first, so no shape can throw inside the synchronous readline handler that would otherwise crash the sidecar for the whole fleet it supervises (T-05-41-01)."

key-files:
  created:
    - scripts/uat/fixtures/live-opus5-ask-user-question.json
    - packages/sidecar/test/ask-user-question.test.mjs
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/authoring-proposal-wire.test.mjs

key-decisions:
  - "ToolCallEvent.questions is additive only — AgentEvent's union membership is unchanged, per the plan's own explicit instruction and 05-40-PLAN.md's <assumption_delta_decision> reasoning (an AskUserQuestion call is an ordinary tool_use block; only its `input` was previously untyped)."
  - "--disallowedTools AskUserQuestion is pushed unconditionally in buildAuthoringClaudeArgv, alongside the mandatory --output-format/--verbose block, not folded into the permissionPromptToolName/mcpConfig branch — an authoring session's conversational contract does not depend on whether a permission-prompt tool was supplied."
  - "A pre-existing exact-argv-array test in authoring-proposal-wire.test.mjs broke as a direct, in-scope consequence of the Task 3 argv change (Rule 3 — auto-fix blocking issue, not scope creep) and was updated to include the new flag pair; no other buildAuthoringClaudeArgv assertion in the suite used exact-array matching, so no further fallout existed."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "An AskUserQuestion tool-use block's question and option text reaches the normalised event stream as typed, ordered data (ToolCallEvent.questions), not an untyped input blob and not an unrecognised raw line."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#normaliseStreamEvent: the frozen live AskUserQuestion line yields three questions in emitted order with option labels and descriptions intact"
        status: pass
    human_judgment: false
  - id: D2
    description: "Question and option order is carried exactly as emitted, with no reordering, merging or de-duplication — including two questions with identical text."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#parseAskUserQuestionInput: two questions with identical question text yield two entries, never merged"
        status: pass
    human_judgment: false
  - id: D3
    description: "A malformed, empty, absent, or oversized questions payload leaves the typed field absent entirely (never present-but-empty), asserted with a key-presence check rather than truthiness; both truncation bounds are exercised from their own exported constants; an option with no label is skipped while its siblings survive."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#parseAskUserQuestionInput / normaliseStreamEvent: every degenerate AskUserQuestion payload yields NO questions key at all — key-presence check, never a truthiness check"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#parseAskUserQuestionInput: a questions array of MAX_ASK_USER_QUESTIONS + 5 entries yields exactly MAX_ASK_USER_QUESTIONS entries, the first ones in order"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#parseAskUserQuestionInput: a question with MAX_ASK_USER_QUESTION_OPTIONS + 5 options yields exactly MAX_ASK_USER_QUESTION_OPTIONS options, the first ones in order"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#parseAskUserQuestionInput: an option entry with no label is skipped while its siblings survive"
        status: pass
    human_judgment: false
  - id: D4
    description: "A non-object or malformed stream line still cannot throw out of the readline handler (pre-existing WR-03 guard, unmodified by this plan, still exercised by the full suite)."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a stream line that parsed to JSON null normalises to unknown, without throwing (WR-03) (and its scalar-type siblings)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The AskUserQuestion shape is frozen from the real live capture (run 01M3DNC0G9CYAWSD8DYEGTRP8C) and replayed offline, byte-identical to the committed planning capture artifact — never retyped or hand-edited."
    requirement: SHAPE-03
    verification:
      - kind: other
        ref: "node -e byte-identity check: JSON.stringify(fixture.shapes[0].line.message) === JSON.stringify(committed-capture.askUserQuestionAssistantMessage) — re-run at close-out, passed"
        status: pass
    human_judgment: false
  - id: D6
    description: "An authoring session's tool set does not contain AskUserQuestion (the challenge stage stays free conversation, D-88/D-89), and a task-execution session's argv stays byte-identical to before this plan."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/ask-user-question.test.mjs#buildAuthoringClaudeArgv disallows AskUserQuestion (D-88/D-89) while buildClaudeArgv's task-execution argv stays untouched"
        status: pass
    human_judgment: false
  - id: D7
    description: "Whether a real backend, given the --disallowedTools argv this plan proves, actually asks its clarifying questions as prose instead of failing to call the tool at all — a live-run observation this round explicitly does not make."
    human_judgment: true
    rationale: "Flagged in the plan itself: '--disallowedTools AskUserQuestion is verified only as argv.' No live run happens in this round; the argv is proven, the model's response to it is not. This is plan 05-42's territory (harness turn capture), not this plan's, and must not be claimed here."

duration: ~25min (across two sessions — see Issues Encountered)
completed: 2026-09-26
status: complete
---

# Phase 5 Plan 41: AskUserQuestion reaches the evidence sheet as typed data, and the challenge stage stays free conversation

**`AskUserQuestion`'s questions and options now carry through the adapter seam as a typed, ordered `ToolCallEvent.questions` field grounded in a frozen real capture, and an authoring session's argv disallows the tool entirely so the challenge stage cannot degrade into a form.**

## Performance

- **Duration:** ~25 min of active work (the session was interrupted by a harness API error immediately after the final task commit and resumed for close-out only — see Issues Encountered)
- **Started:** 2026-09-26T11:31:38+08:00 (first task commit)
- **Completed:** 2026-09-26T11:50:42+08:00 (final task commit); close-out completed in a resumed session
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `packages/sidecar/src/adapter.ts`: new `AskUserQuestionOption`/`AskUserQuestionPrompt` interfaces and an additive `ToolCallEvent.questions?: AskUserQuestionPrompt[]` field — `AgentEvent`'s union membership is unchanged.
- `packages/sidecar/src/claude-code-adapter.ts`: `ASK_USER_QUESTION_TOOL_NAME` constant, `MAX_ASK_USER_QUESTIONS`/`MAX_ASK_USER_QUESTION_OPTIONS` bounds, and the pure, total `parseAskUserQuestionInput` parser wired into `normaliseStreamEvent`'s existing `tool_use` branch; `buildAuthoringClaudeArgv` now pushes `--disallowedTools AskUserQuestion` unconditionally, with a doc comment citing D-88, D-89 and the live run's cost, stating the argv-only residual honestly. `buildClaudeArgv` (task-execution) is untouched.
- `scripts/uat/fixtures/live-opus5-ask-user-question.json` (new): the real live-run `01M3DNC0G9CYAWSD8DYEGTRP8C` capture, frozen byte-identical to the committed planning capture artifact.
- `packages/sidecar/test/ask-user-question.test.mjs` (new): 10 tests — the frozen line's happy path, every degenerate/malformed payload shape (absence via `Object.hasOwn`, never truthiness), the tool-name gate, duplicate-question adjacency, both truncation bounds built from their own exported constants, skip-not-repair for a labelless option, the envelope-leakage prohibition, a fixture-wide no-`unknown`-block invariant, and the authoring-argv disallow assertion.
- `packages/sidecar/test/authoring-proposal-wire.test.mjs`: its two pre-existing exact-argv-array assertions updated to include the new `--disallowedTools`/`AskUserQuestion` pair — a direct, in-scope consequence of Task 3's change (Rule 3), not scope creep.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer — freeze the real AskUserQuestion capture and carry its question/option payload through the adapter seam as typed data** - `b6e9b33` (feat)
2. **Task 2: Pin the seam's edge behaviour — empty, malformed, oversized, duplicate and non-AskUserQuestion payloads, plus a fixture-wide no-unknown-block invariant** - `c6aecc7` (test)
3. **Task 3: Keep the challenge stage free conversation — remove AskUserQuestion from the authoring tool set by absence** - `5257627` (feat)

**Plan metadata:** this SUMMARY + STATE.md/ROADMAP.md, committed immediately after this file.

_Task 1 carries the fixture freeze and the seam implementation in a single commit — no separate persisted test file exists for Task 1 itself (its own `<verify>` block is inline `node -e` checks, not a committed test); Task 2's own persisted test file is what the RED/GREEN discipline for this plan's `tdd="true"` tasks actually produces, mirroring the precedent set by plan 05-37's own Task 1 (`feat`) / Task 2 (`test`) split for the same reason._

## Files Created/Modified

- `packages/sidecar/src/adapter.ts` — `AskUserQuestionOption`/`AskUserQuestionPrompt` interfaces; additive `ToolCallEvent.questions` field.
- `packages/sidecar/src/claude-code-adapter.ts` — `ASK_USER_QUESTION_TOOL_NAME`, `MAX_ASK_USER_QUESTIONS`, `MAX_ASK_USER_QUESTION_OPTIONS`, `parseAskUserQuestionInput`; `normaliseStreamEvent`'s `tool_use` branch spreads `questions` when applicable; `buildAuthoringClaudeArgv` disallows the tool.
- `scripts/uat/fixtures/live-opus5-ask-user-question.json` — new frozen fixture, byte-identical to the committed planning capture.
- `packages/sidecar/test/ask-user-question.test.mjs` — new test file, 10 tests.
- `packages/sidecar/test/authoring-proposal-wire.test.mjs` — two exact-argv snapshots extended with the new flag pair.

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated a pre-existing exact-argv-array test broken by Task 3's own change**
- **Found during:** Task 3, full-suite verification (`npm --prefix packages/sidecar test` reported 190 passing / 1 failing immediately after the argv change)
- **Issue:** `packages/sidecar/test/authoring-proposal-wire.test.mjs`'s own pre-existing test ("buildAuthoringClaudeArgv for an authoring spawn pushes the proposal tool onto --allowedTools") asserted a full exact-array snapshot of `buildAuthoringClaudeArgv`'s output for both the with-permission-prompt-tool case and the bare case. Adding `--disallowedTools AskUserQuestion` unconditionally broke both snapshots.
- **Fix:** Extended both snapshot arrays to include the new `--disallowedTools`/`AskUserQuestion` pair at its correct position, with a comment citing G-05-8(a)/D-88/D-89. Searched the rest of the suite for other `buildAuthoringClaudeArgv` exact-array assertions (`authoring-tools.test.mjs`) and confirmed its own assertion uses index/`includes`-based checks, not `deepEqual` on the whole array, so no further fallout existed.
- **Files modified:** `packages/sidecar/test/authoring-proposal-wire.test.mjs`
- **Verification:** `npm --prefix packages/sidecar test` returned to 191 passing / 0 failing.
- **Commit:** `5257627` (part of Task 3's own commit — the fix and the change that caused it landed together, since leaving the suite red between commits would violate the plan's own `<verification>` gate)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary to keep the test suite green as the plan's own `<verification>` requires ("at least 191 passing, 0 failing"); no scope creep — the fix only updates assertions of a function this same task modified.

## Issues Encountered

- **Harness interruption:** the executing agent was terminated by a harness API error ("computer went to sleep") immediately after Task 3's commit (`5257627`) landed, before this SUMMARY was written. No work was lost — all three task commits were already on the branch and the working tree had no uncommitted plan-related changes. A resumed session re-ran the plan's own `<verification>` block in full (build, full test suite, fixture byte-identity, `adapter.ts` additions-only diff) to confirm nothing regressed across the interruption before writing this SUMMARY. All checks passed on re-run: `npm --prefix packages/sidecar run build` exit 0; `npm --prefix packages/sidecar test` reported 191 passing, 0 failing; the frozen fixture is still byte-identical to the committed capture; `packages/sidecar/src/adapter.ts`'s diff since before this plan shows additions only.
- No auth gates encountered; no package installs; no credentials spent (no `<verify>` command in this plan spawns `claude` — confirmed, none of the `node -e` checks or `npm test` invocations touch the real backend).

## User Setup Required

None — no external service configuration required.

## Threat Flags

None. All five threats in this plan's own `<threat_model>` are addressed by the plan as written and verified above: T-05-41-01 (`parseAskUserQuestionInput` is pure/total/bounded, pinned by Task 2's degenerate-input tests), T-05-41-02 (envelope-leakage test asserts `signature`/`caller`/`cache_read_input_tokens` appear nowhere on the typed `questions` field), T-05-41-03 (`--disallowedTools`'s value is the exported constant, referenced exactly once in non-comment source), T-05-41-04 (the fixture's byte-identity to the committed capture is an automated gate, re-verified at close-out), T-05-41-05 (`AskUserQuestion` stays a `tool_call`; `AgentEvent`'s union membership is unchanged, confirmed by the additions-only diff on `adapter.ts`). T-05-41-SC (package-manager installs): no install task exists in this plan; `packages/sidecar/package.json` is unchanged — confirmed by the commit diffs, which touch only `src/`, `test/`, and the new fixture.

## Next Phase Readiness

- Gap `G-05-8(a)` (the product half) is closed: the questions and options a real backend emits through `AskUserQuestion` now reach the normalised event stream as typed, ordered data grounded in a frozen full-fidelity capture, and an authoring session is spawned without the tool at all, so the challenge stage cannot degrade into a form the model itself renders.
- **Residual, stated honestly (carried forward from this plan's own `<flagged_assumptions>`):** `--disallowedTools AskUserQuestion` is proven as argv only — this repository's own `buildAuthoringClaudeArgv` builds the exact flag the installed `claude` CLI documents. Whether a real backend, given that argv, then asks its clarifying questions as prose instead is a live-run observation this round explicitly does not make and must not claim. That is plan 05-42's territory (the harness turn-capture side of this gap), not this plan's.
- `05-42` depends on this plan's typed `ToolCallEvent.questions` field to render a captured turn's clarifying questions in the harness transcript — the seam it needs now exists and is proven end-to-end offline against the frozen capture.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- FOUND: packages/sidecar/src/adapter.ts
- FOUND: packages/sidecar/src/claude-code-adapter.ts
- FOUND: packages/sidecar/test/ask-user-question.test.mjs
- FOUND: scripts/uat/fixtures/live-opus5-ask-user-question.json
- FOUND: packages/sidecar/test/authoring-proposal-wire.test.mjs
- FOUND commit: b6e9b33
- FOUND commit: c6aecc7
- FOUND commit: 5257627
- `npm --prefix packages/sidecar run build`: exit 0 (re-verified at close-out)
- `npm --prefix packages/sidecar test`: 191 passed, 0 failed (re-verified at close-out, foreground run)
- Fixture byte-identity check: PASS (re-verified at close-out)
- `git diff -- packages/sidecar/src/adapter.ts` since before this plan: additions only, no removed lines
- `plan_head_before` (`698a55f`) → `HEAD`: 3 commits (matches 3 tasks)
