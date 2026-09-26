---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-26T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/adapter.test.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
  - scripts/uat/fixtures/live-opus5-unmodelled-shapes.json
  - scripts/uat/README.md
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 5: Code Review Report — Gap-Closure Round 9 (G-05-7)

**Reviewed:** 2026-09-26T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found (no Critical findings; one Warning, two Info)

## Scope

This review is **incremental from commit `7a05a1c`** (the round-8 review commit) — it covers only
what round 9 (plans 05-36/05-37/05-38/05-39) changed, diffed as `git diff 7a05a1c HEAD -- <path>`
against the eight files listed above. Findings below are scoped to lines this round actually touched.
I did not re-litigate pre-existing code the diff left untouched (e.g. `SessionSurface.tsx`,
`FeedRow.tsx`, `artifactDir()`), though I did trace into a few of them read-only to check for
cross-file breakage from this round's `AgentEvent` union changes (see "Cross-file checks" below).

## Verdict on the three G-05-7 findings

1. **BLOCKER — a failed live run destroyed its own evidence.** **CLOSED**, verified by direct trace
   of the control flow (not just by reading the SUMMARY's claims). `writeChallengeEvidence` (line
   4005) is the single `fs.writeFileSync` call site for the evidence path, wraps itself in its own
   try/catch so it can never throw, and the live arm's body (line 5816–6152) is now one
   `try { ... } catch (err) { fold exchanges, set failure, rethrow } finally { writeChallengeEvidence(evidenceState) }`.
   I traced every exit — normal completion, the `conversation.nonConversation` early throw, the
   distillation-turn `nonConversation` throw, `assert.ok(allPassed, ...)` failing, and an arbitrary
   thrown exception from anywhere in between — and all of them reach the unconditional `finally`
   write. See Warning WR-01 below for a caveat on how this specific integration is verified.

2. **MAJOR — the wall-clock deadline killed a healthy turn.** **CLOSED**, verified by direct trace.
   `decideTurnArmedWindow` (sidecar-harness.mjs) correctly arms `toolCallIdleMs`
   (`LIVE_TOOL_CALL_IDLE_MS`, 120000ms) while a tool call is outstanding instead of standing the
   window down entirely (plan 05-25's superseded behavior), and `waitForTurn`'s outer
   `deadlineTimer` (the `LIVE_TURN_CEILING_MS` backstop) is now reset via `armCeiling()` on every
   call to `onEvent()` that advances the progress tuple `(chunkCount, toolCalls.length,
   pendingToolCallCount, thinkingCount)` — confirmed by reading the actual `armWindow`/`armCeiling`
   closures, not only the doc comment describing them. This is proven by a genuine, non-mechanical
   test: `works-continuously-past-old-deadline`'s replay-check branch (uat-08-socratic-authoring.mjs
   ~4832–4906) measures real wall-clock elapsed time with `Date.now()` and asserts it exceeds the
   passed ceiling while the turn still ends by `result`, not by a thrown deadline — this is a
   timing-based integration test that can actually fail, not a grep gate.

3. **MAJOR — reasoning blocks and `rate_limit_event` were unmodelled and truncated to 200 chars.**
   **CLOSED**, verified by direct trace. `ThinkingEvent`/`RateLimitEvent` are correctly added to the
   `AgentEvent` union and the `normaliseStreamEvent` branches (claude-code-adapter.ts) place the
   reasoning branch strictly after the existing tool_use/tool_result/text searches (preserving
   find-first ordering for `[reasoning, text]`/`[reasoning, tool_use]` messages), and every optional
   field on both new events is spread via a strict `typeof` check so a literal `false` survives. The
   frozen fixture's two `observedPrefix` values are verbatim substrings of the committed
   `05-LIVE-RUN-01M3C48C-FAILED.log` (confirmed directly with `grep`), each exactly 200 characters,
   and the reasoning shape's `line` genuinely carries no `signature` key, matching its own stated
   honesty rule. `createUnmodelledEventSink` genuinely persists the full raw line beside the
   200-character stderr slice (see Info IN-02 for one caveat).

## Narrative Findings (AI reviewer)

### WR-01: The exact code path that fixes the BLOCKER (the live arm's own try/catch/finally) is never executed by anything automated

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:5665-6152` (the live arm's inline callback
passed to `runScript(...)` at line 5662)
**Issue:** The live arm's body — the literal `try { ... } catch (err) { ... } finally {
writeChallengeEvidence(evidenceState); }` structure that is *the* fix for G-05-7 finding 1 — is an
inline async callback that only runs when `probeClaudeAvailable()` (line 5666) succeeds, i.e. only
during a real, credentialed live run. `--self-test` never calls it. `--replay-check`
(`runReplayCheckScenario`, a *separate* function starting at line 4531, invoked from a *separate*
top-level branch at line 5638) does not call this callback either — it re-implements the same
*pattern* by hand: the `turn-deadline-exceeded` branch (line 4737) calls `driveChallengeConversation`
and `writeChallengeEvidence` directly with hand-assembled arguments, and the
`works-continuously-past-old-deadline` branch (line 4832) does the same. Both prove the *pieces*
(the driver throws `ConversationAbortedError` with recovered exchanges; `writeChallengeEvidence`
renders a failure section) work correctly in isolation, and I confirmed by direct reading that the
live arm's own integration of those pieces is correct — but no automated command in this repository
actually executes the specific 337-line block that constitutes the fix. The single evidence this
integration is wired correctly is: (a) my own manual trace, and (b) whatever happens on the next real
live run. This matches this phase's own documented failure pattern (`scripts/uat/README.md` Item 8):
a claim of "proven end to end" resting on tests that exercise adjacent code, not the code itself. The
`05-36-SUMMARY.md` coverage table's own D1 verification list (self-test checks + a `replay-check`
scenario + a one-off `node -e` grep count) is honest about being self-test/replay-based, but neither
of those reaches the actual `try/finally` at 5816-6152.
**Fix:** Extract the live arm's try/catch/finally body (or at least the evidence-state
management around it) into an exported, injectable function — e.g. `runChallengeAndWriteEvidence({
sidecar, runId, ..., evidencePath })` — that `runScript`'s callback calls, and that a
`--replay-check` scenario can also call directly against the scripted sidecar, so the *actual*
control-flow object under test is the same code path the live arm runs, not a hand-reconstructed
parallel of it.

### IN-01: `ThinkingEvent.hasSignature` reads `false` for a present-but-empty-string signature

**File:** `packages/sidecar/src/claude-code-adapter.ts:~735` (the reasoning branch inside
`normaliseStreamEvent`) and `packages/sidecar/src/adapter.ts:297-311` (`ThinkingEvent`'s doc comment)
**Issue:** `hasSignature: typeof reasoningBlock.signature === "string" && reasoningBlock.signature.length > 0`
records "whether the block ALSO carried a signature" (per `ThinkingEvent`'s own doc comment) but
actually records "carried a *non-empty* signature." A wire line with `signature: ""` (syntactically a
string, present on the envelope) would read `hasSignature: false`, which is a presence claim, not a
truthiness claim, misreporting what was on the wire. This is very unlikely in practice — the one real
capture this repository has shows a long non-empty signature — so I'm flagging this as low-confidence
speculative rather than a proven live defect; no fixture or observed live event demonstrates an empty
string in practice.
**Fix:** If presence, not "non-empty-ness," is truly the intended contract, drop the
`.length > 0` clause: `typeof reasoningBlock.signature === "string"`. If an empty signature should in
fact be treated as absent (e.g. because the backend is not known to ever emit one), state that
explicitly in the doc comment as an intentional simplification rather than leaving it implicit in the
implementation.

### IN-02: `createUnmodelledEventSink`'s line truncation can split a multi-byte UTF-8 character, corrupting the tail of a captured line

**File:** `scripts/uat/lib/sidecar-harness.mjs` (inside `createUnmodelledEventSink`'s `append`
closure, the `Buffer.from(text, "utf8").subarray(0, UNMODELLED_EVENT_LINE_LIMIT).toString("utf8")`
line)
**Issue:** `UNMODELLED_EVENT_LINE_LIMIT` (65536) is a byte bound applied via `Buffer.subarray`, which
cuts at a raw byte offset with no regard for UTF-8 character boundaries. If an oversized captured
line's 65536th byte lands mid-way through a multi-byte character (plausible for any raw JSON
containing non-ASCII text — tool output, file contents, non-English prompt text), `Buffer.toString
("utf8")` silently replaces the truncated sequence with one or more U+FFFD replacement characters
rather than throwing. This doesn't crash anything (the doc comment's stated goal — "so a pathological
stream cannot fill a developer's disk" — is still met), but the captured line's `truncated: true`
tail will occasionally read as corrupted mojibake rather than a clean cut, undermining this task's
own stated purpose ("a recorded truncation is a fact, a silent [corruption] is the defect this task
exists to stop repeating") for the specific case of a truncation landing inside a multi-byte
character. This is a real, traceable code property, not speculative — but its practical impact is
low (diagnostic-only capture, and the 500-line/65536-byte bounds are "deliberately far above anything
observed" per the same doc comment, so hitting this exact boundary in practice is rare).
**Fix:** Use a UTF-8-safe truncation, e.g. iterate down from `UNMODELLED_EVENT_LINE_LIMIT` to the
nearest byte boundary that doesn't split a code point (Node's `Buffer` has no built-in helper for
this; a simple approach is to decode with `TextDecoder(..., { fatal: false })` and detect/strip a
trailing U+FFFD, or truncate on the string (`text.slice`) by an approximate character count first and
only bound the byte length as a backstop).

## Cross-file checks (informational, no findings)

- Searched every consumer of `AgentEvent` in `packages/desktop/src` (`SessionSurface.tsx`,
  `FeedRow.tsx`, `RawLogView.tsx`) for exhaustive switches that could break on the two new union
  members (`thinking`, `rate_limit`). None of them switch exhaustively on `event.type` with a
  compile-time `never` check — `SessionSurface.tsx`'s event-to-row mapping (~line 586-649) is an
  if/else chain with an unconditional `rows.push({ kind: "raw", ... })` fallthrough, so both new
  event types render as raw JSON rather than crashing or being silently dropped. `npm --prefix
  packages/desktop test` (552 tests, per the orchestrator's pre-verification) passed, consistent with
  this. None of these files are in this round's diff, so no finding is raised against them — noted
  here only because the review brief asked me to check for exactly this breakage class.
- Confirmed `Harness.artifactDir()` (sidecar-harness.mjs:692-696, unchanged this round) genuinely
  resolves outside `this.root` (an `os.tmpdir()` sibling, never registered for teardown) — this is
  the fact `scripts/uat/README.md`'s gap-report correction (Item 8) rests on, and it checks out by
  direct reading of the unchanged code it cites.
- Confirmed the `LIVE_TURN_CEILING_MS`/`decideTurnArmedWindow` reset semantics doc comment matches
  the shipped `armWindow`/`armCeiling` implementation exactly (see Verdict #2 above) — no other
  caller of `waitForTurn` in this repository assumes the old one-shot-from-call-start deadline
  semantics; every call site either passes its own explicit `timeoutMs` or is a self-test stub that
  does not depend on the ceiling's re-arming behavior.
- Confirmed the two mechanical fixture gates in `adapter.test.mjs` (the "invented field is
  impossible" and "drift from the source is impossible" tests) walk the fixture's own recursive
  key/scalar structure rather than a hardcoded field list, so they are not "cannot fail" gates in the
  sense this phase has previously shipped (e.g. the `REPLAY_TURN_DEADLINE_MS`/
  `TURN_DEADLINE_MS` substring-collision gate from an earlier round) — they would genuinely fail if
  the fixture's `line` gained a field the `observedPrefix` doesn't contain, or if `observedPrefix`
  diverged from the committed log.

---

_Reviewed: 2026-09-26T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
