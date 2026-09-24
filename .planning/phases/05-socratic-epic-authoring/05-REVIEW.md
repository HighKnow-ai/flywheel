---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-24T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - scripts/uat/README.md
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This is an incremental review against the prior `05-REVIEW.md` (commit `0fe24ae`). All six prior
findings — CR-01 (`finalNoWorkPlannedReading` computed over the wrong window), WR-01 (no
per-attempt correlation), WR-02 (no `runId` filter), WR-03 (dead `materialisedEpicId` guard), WR-04
(idle window resets on any event), IN-01 (`SkipError` conflated with failure) and IN-02 (magic
`5_000` drain literal) — were traced against the current code and confirmed genuinely closed:

- `finalNoWorkPlannedReading` (line 3358) now reuses the pre-advance, window-bounded reading
  verbatim rather than recomputing over the whole event history.
- `readNoWorkPlanned` (lines 2179–2236) now requires an explicit `{ runId, fromIndex, toIndex }`
  window (throwing a `TypeError` naming the missing member otherwise), scopes every scan to that
  run and range, and correlates each individual `propose_*` attempt with its own answer rather than
  an aggregate "any attempt / any refusal" pair.
- `materialisedEpicId` no longer exists anywhere in the file.
- `waitForTurn`'s idle timer (`lib/sidecar-harness.mjs:785-817`) now resets only on this watcher's
  own progress tuple (`chunkCount`, `toolCalls.length`, `pendingToolCallCount`), stands down
  entirely while a tool call is outstanding, and is proven, by a dedicated self-test, not to be
  armed or extended by a foreign run's traffic.
- `--replay-check`'s multi-scenario loop now checks `process.exitCode === 1` specifically.
- The drain's per-iteration wait is now the named, exported `DRAIN_POLL_MS`.

Tracing the *new* code these three plans (05-23/05-24/05-25) introduced turned up one new Critical
defect in exactly the property this whole gap-closure sequence exists to make trustworthy: the
per-attempt `tool_result` correlation `readNoWorkPlanned` uses to close WR-01 can still let a single
`tool_result` be claimed as the answer to two different `propose_*` attempts, producing a false
`"refused"` reading — a vacuous SHAPE-01 pass — when a genuine, unrefused, successfully-named
proposal exists later in the same window and is never examined. This is demonstrated below with a
concrete, executed reproduction, not a hypothetical. No self-test in the file constructs the shape
that triggers it (every existing multi-attempt fixture either has exactly one `tool_result` total,
or interleaves a `tool_call`/`tool_result` pair before the next `tool_call` begins), so nothing in
the offline arms catches it.

A second, lower-severity observation concerns `readBackendRefusal`'s own doc comment, which
overclaims a "zero" false-positive rate for a heuristic that in fact still has a narrow, acknowledged
opening.

## Critical Issues

### CR-01: `readNoWorkPlanned`'s per-attempt `tool_result` correlation can reuse a single result as the answer to two different propose attempts, producing a false `"refused"` reading

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:2218-2233` (the `isAttemptRefused` closure inside `readNoWorkPlanned`, lines 2179-2236)

**Issue:** `isAttemptRefused(attempt)` scans forward from `attempt.index + 1` for the *first*
subsequent `tool_result` in the window and treats it as that attempt's own answer:

```js
const isAttemptRefused = (attempt) => {
  for (let i = attempt.index + 1; i < toIndex; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (event.type !== "tool_result") continue;
    if (typeof event[TOOL_NAME_FIELD] === "string" && event[TOOL_NAME_FIELD] !== attempt.toolName) {
      return false;
    }
    return typeof event.raw === "string" && CHALLENGE_REFUSAL_PATTERN.test(event.raw);
  }
  return false;
};
```

This scan is run **independently for every attempt**, with no tracking of which `tool_result`
indices an earlier attempt has already claimed. When two `propose_*` tool calls are issued
back-to-back — a single content-block turn carrying two `tool_use` blocks before either is
answered, which is an entirely ordinary shape for the Anthropic API and for a Claude Code turn — the
*second* attempt's scan starts at `attempt2.index + 1`, which lands on the exact same `tool_result`
event already consumed by `isAttemptRefused(attempt1)`. If that shared result happens to be an
unnamed refusal, both attempts read `"refused"`, and `attempt2`'s own real, distinctly-named,
non-refusing answer — sitting further down in the array — is never even reached by the scan.

Confirmed by direct execution (not merely reasoned through) against the shipped algorithm, with the
following event sequence:

```js
const events = [
  { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task" },       // idx0 attempt1
  { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption" }, // idx1 attempt2
  { type: "tool_result", runId, raw: "still in the challenge stage — no proposals yet." }, // idx2 — unnamed, answers attempt1
  { type: "tool_result", runId, toolName: "mcp__flywheel-permissions__propose_assumption",
    raw: "proposal created successfully" },                                                // idx3 — real, unrefused answer to attempt2
];
readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
// => "refused"   (expected: "violated" — attempt2 genuinely succeeded, unrefused)
```

`isAttemptRefused(attempt1)` correctly claims the unnamed result at idx2 (a refusal — correct).
`isAttemptRefused(attempt2)` starts scanning at `attempt2.index + 1 = idx2` — the *same* event
already claimed for attempt1 — finds it unnamed, accepts it positionally, and reads it as a refusal
too, even though idx2 was never meant to answer attempt2 at all. The genuinely-named, unrefused
success at idx3 is never inspected. `attempts.every(isAttemptRefused)` is therefore `true`, and the
function returns `"refused"` — the exact vacuous-pass shape this whole gap-closure sequence (plans
05-20 through 05-25) exists to eliminate. Per `buildCriteriaResults`, this reading makes SHAPE-01
report a pass on a run where the model actually got an unrefused proposal staged mid-challenge — the
one outcome SHAPE-01 must never certify.

This is a distinct failure mode from the WR-01 bypass the prior review closed (a refused first
attempt laundering an *unanswered* second attempt) — it requires *two* `tool_result` events to be
present, not zero, and none of the file's existing self-tests (`readNoWorkPlanned distinguishes...`,
the WR-01 bypass test, the order-independence test, the "wrong name" test, the "unnamed result
accepted positionally" test) construct two back-to-back `tool_call`s answered by two subsequent
`tool_result`s. The "order-independence" test in particular avoids this exact shape by deliberately
interleaving a wrong-named result between the two attempts (so the second attempt's real answer
never gets consumed by the first) — it does not cover the case where both attempts are answered
after a shared ambiguous first result.

**Fix:** Track which `tool_result` indices have already been claimed by an earlier attempt, and skip
them when scanning for a later attempt's answer — mirroring the FIFO-answering assumption the file
already documents and uses elsewhere (`pendingToolCallCount`'s own doc comment in
`lib/sidecar-harness.mjs`):

```js
const usedResultIndices = new Set();
const isAttemptRefused = (attempt) => {
  for (let i = attempt.index + 1; i < toIndex; i += 1) {
    if (usedResultIndices.has(i)) continue;
    const event = events[i];
    if (event.runId !== runId) continue;
    if (event.type !== "tool_result") continue;
    usedResultIndices.add(i);
    if (typeof event[TOOL_NAME_FIELD] === "string" && event[TOOL_NAME_FIELD] !== attempt.toolName) {
      return false;
    }
    return typeof event.raw === "string" && CHALLENGE_REFUSAL_PATTERN.test(event.raw);
  }
  return false;
};
return attempts.every(isAttemptRefused) ? "refused" : "violated";
```

`attempts.every` iterates in ascending index order (the same order `attempts` was collected in), so
each attempt claims the earliest still-unclaimed result after its own index — re-running the
repro above against this fix yields `"violated"`, the correct reading. Add a self-test exercising
exactly this shape (two consecutive propose attempts, both eventually answered by two distinct
`tool_result`s, the first refusing and the second not) so this exact defect cannot regress silently.

## Warnings

### WR-01: `readBackendRefusal`'s own doc comment overclaims a "zero" false-positive rate

**File:** `scripts/uat/lib/sidecar-harness.mjs:384-391` (doc comment), `393-405` (implementation)

**Issue:** The doc comment states the position anchor "is what keeps the false-positive rate at
zero." The anchor (matching `BACKEND_REFUSAL_PREFIX` = `"API Error:"` only at the very start of the
accumulated turn text) does meaningfully *reduce* false-positive risk relative to a substring match
— the existing tests correctly confirm ordinary mid-sentence mentions of "API Error:" are not
misclassified — but it does not reduce it to zero. A genuine model turn whose very first words
happen to literally read "API Error:" (e.g. the agent opening a turn by quoting a log line it just
read via a tool, such as `"API Error: 500 responses in your logs from the last deploy suggest..."`)
would still be misclassified as a backend refusal by this exact anchor, since nothing distinguishes
that shape from the real banner at the string level. The function's own doc comment acknowledges
the asymmetric cost of a false positive here (it "aborts a genuine, in-progress run and costs the
credentials it was spending"), which makes the overclaim worth correcting rather than leaving as
an invitation for a future reader to trust the anchor more than it actually earns.

**Fix:** Soften the doc comment to state that the anchor "meaningfully reduces, but does not fully
eliminate," the false-positive risk, and name the residual case explicitly (a turn whose own first
words happen to echo the literal banner text) so a future reader is not misled into treating this
heuristic as provably complete. No behavior change is required — this is a documentation-accuracy
fix, not a functional one, since tightening the heuristic further (e.g. requiring the "Learn more:"
or "Request ID:" markers too) would trade back toward the false-negative direction the function's
own comment says is the worse failure to reintroduce.

---

_Reviewed: 2026-09-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
