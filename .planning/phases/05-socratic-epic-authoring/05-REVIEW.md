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
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the four UAT-instrument files changed by plans 05-20/05-21/05-22: the turn-boundary
primitive (`eventCursor`/`waitForTurn`/`accumulateTurn`), the scripted zero-token authoring
backend, the responsive conversation driver (`driveChallengeConversation`), and the three-valued
`readNoWorkPlanned` reading.

The turn-boundary primitive itself (`accumulateTurn`, `SidecarClient.waitForTurn`) is carefully
built and its cursor/ordering/exclusion invariants are genuinely pinned by the offline self-tests —
tracing the code against those tests did not turn up a defect in the capture mechanism itself.

The `noWorkPlannedReading` gating value used in the **live arm**, however, is computed over the
wrong window of events, and — separately — never correlates a `propose_*` attempt with its own
refusal. Both defects sit in exactly the property this closure (plans 05-20/05-21, gap `G-05-2`)
was built to make genuinely falsifiable, and neither is exercised by any of the offline arms
(`--self-test`, `--replay-check`), so nothing catches them short of a live run. There is also a
dead/misleading conditional left over from an earlier version of the SHAPE-05 logic, and the
turn-boundary's idle-detection window has a latent robustness gap for real (non-scripted) backends
that the offline arms cannot exercise either, since the fake backend never simulates a slow
mid-turn tool execution.

## Critical Issues

### CR-01: `finalNoWorkPlannedReading` is computed over the wrong window of events — it will read "violated" for essentially every live run that successfully produces a proposal

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:2181` (contrast with the correctly-scoped read at `:2015`, and `readNoWorkPlanned` itself at `:1375-1387`)

**Issue:** `readNoWorkPlanned(events)` (lines 1375-1387) decides SHAPE-01's "no work planned" half
by scanning for ANY `tool_call` event whose `toolName` contains `propose_`, and returns
`"violated"` unless a matching `"challenge stage"` refusal is also present:

```js
function readNoWorkPlanned(events) {
  const proposeAttempted = events.some(
    (event) => event.type === "tool_call" && typeof event[TOOL_NAME_FIELD] === "string" &&
      event[TOOL_NAME_FIELD].includes("propose_"),
  );
  if (!proposeAttempted) return "unproven";
  const refused = events.some(
    (event) => event.type === "tool_result" && typeof event.raw === "string" && /challenge stage/i.test(event.raw),
  );
  return refused ? "refused" : "violated";
}
```

The **first** call site (line 2015, `const noWorkPlannedReading = readNoWorkPlanned(sidecar.events);`)
runs immediately after `driveChallengeConversation` returns and *before* `advance-stage` is called —
at that point every event in `sidecar.events` genuinely belongs to the challenge stage, so this read
is correctly scoped.

The **second**, *gating* call site (line 2181) is different:

```js
// Re-read: the decompose phase (proposal calls, above) happens strictly AFTER the earlier
// reading, so this is the fresh, final reading — not the pre-decompose "unproven" snapshot.
const finalNoWorkPlannedReading = readNoWorkPlanned(sidecar.events);
```

By line 2181, the script has already advanced the stage (line ~2050), waited for
`proposal_created` events, applied them via the bridge, and accepted/rejected/amended proposals
(lines ~2089-2155) — i.e. the agent has already legitimately called `propose_task`/`propose_criterion`
during the **decompose** stage, which is exactly what SHAPE-02/SHAPE-03/SHAPE-04 require to have
happened. `readNoWorkPlanned(sidecar.events)` does not distinguish "propose attempted during
challenge" from "propose attempted during decompose (after the developer's own gate opened it)" —
it scans the *entire* event history. Once any legitimate decompose-stage proposal exists,
`proposeAttempted` is `true`, and since a legitimate decompose-stage propose call is never
"refused" with challenge-stage wording, `refused` is `false`, so the function returns
`"violated"`.

Net effect: on any live run where SHAPE-02 passes (a proposal was actually created and accepted —
the expected, successful outcome), `finalNoWorkPlannedReading` will read `"violated"`, and per
`buildCriteriaResults`:

```js
criterion1Challenged && noWorkPlannedReading !== "violated",
```

SHAPE-01's second half will therefore **fail** on essentially every successful run — the two
gating criteria SHAPE-01 and SHAPE-02 become mutually exclusive in practice, which contradicts the
intent of both. This is precisely the defect class this closure exists to eliminate: a criterion
that cannot report a genuine pass is exactly as untrustworthy as one that can never fail.

This exact contaminated-window pattern is not exercised by any offline arm: the
`--replay-check --scenario stages-work-during-challenge` case (the one scenario built to prove
`"violated"` is reachable) calls `readNoWorkPlanned(sidecar.events)` *before* `advance-stage` is
ever invoked in that scenario, so it never observes a legitimate post-advance propose call
contaminating the same array.

**Fix:** Reuse the already-correctly-scoped pre-decompose reading instead of recomputing after
decompose activity has occurred (nothing that determines "was work proposed during the challenge
stage" can be learned from the decompose stage's own legitimate propose calls):

```js
// The challenge-stage reading was already correct the moment driveChallengeConversation
// returned — decompose-stage propose calls are legitimate and must never re-taint it.
const finalNoWorkPlannedReading = noWorkPlannedReading;
```

or, if something in the distillation turn (which happens after `advance-stage` but before the
proposal wait) needs to be included, snapshot the event count immediately before `advance-stage`
and pass a bounded slice to `readNoWorkPlanned`:

```js
const preAdvanceEventCount = sidecar.events.length;
// ... advance-stage, distillation turn ...
const finalNoWorkPlannedReading = readNoWorkPlanned(sidecar.events.slice(0, preAdvanceEventCount));
```

## Warnings

### WR-01: `readNoWorkPlanned` never correlates a specific `propose_*` attempt with its own refusal

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:1375-1387`

**Issue:** Even once scoped to the correct window (see CR-01), the function checks "was *any*
propose attempt observed" and, independently, "was *any* challenge-stage refusal observed" —
never pairing a given attempt with the tool_result that actually answered it. If the challenge
stage ever contains two propose attempts where the first is refused and a second one is not (e.g.
a bypass class analogous to the destructive-gate launcher-shape bypasses documented elsewhere in
this directory's README), this function reports `"refused"` — masking the very violation the
three-valued reading exists to surface.

**Fix:** Pair each `propose_*` tool_call with the tool_result that immediately follows it (by
array position, or by a correlating id if the adapter exposes one), and require every observed
attempt to be individually refused for the reading to be `"refused"`; any unrefused attempt alone
should force `"violated"`, e.g.:

```js
function readNoWorkPlanned(events) {
  const attempts = events.filter(
    (e) => e.type === "tool_call" && typeof e[TOOL_NAME_FIELD] === "string" && e[TOOL_NAME_FIELD].includes("propose_"),
  );
  if (attempts.length === 0) return "unproven";
  const allRefused = attempts.every((attempt) => {
    const idx = events.indexOf(attempt);
    const result = events.slice(idx + 1).find((e) => e.type === "tool_result");
    return result !== undefined && typeof result.raw === "string" && /challenge stage/i.test(result.raw);
  });
  return allRefused ? "refused" : "violated";
}
```

### WR-02: `readNoWorkPlanned` never filters by `runId`, unlike every other event-scanning helper in this codebase

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:1375-1387` (called at `:2015`, `:2181`)

**Issue:** `accumulateTurn` (`lib/sidecar-harness.mjs:366-398`) is scrupulous about excluding
events whose `runId` doesn't match — its own doc comment explains why ("one sidecar drives many
runs"). `readNoWorkPlanned` takes a raw `events` array with no `runId` parameter at all, and both
call sites pass the whole, unfiltered `sidecar.events`. Currently harmless because each script
spawns exactly one run per sidecar, but it's an inconsistent invariant relative to the rest of the
file, and any future reuse of a sidecar across multiple runs (which the codebase's own comments
treat as a normal, expected shape) would silently attribute a different run's propose attempts (or
refusals) to this one.

**Fix:** Accept and filter by `runId`, mirroring `accumulateTurn`:

```js
function readNoWorkPlanned(events, runId) {
  const scoped = events.filter((e) => e.runId === runId);
  // ...
}
```

### WR-03: `materialisedEpicId === null` guard is dead/misleading — the variable is never assigned anything else

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:2091, 2132, 2163`

**Issue:**

```js
2091:    let materialisedEpicId = null;
...
2132:      materialisedEpicId = null; // this session had no epic — a task proposal here has no epic id
...
2163:    if (rejectedTaskId && materialisedEpicId === null) {
```

`materialisedEpicId` is declared `null` and later reassigned `null` again — there is no code path
anywhere in the file that ever sets it to anything else. The guard at line 2163 therefore always
reduces to `if (rejectedTaskId)`; reading it as written suggests the branch depends on whether an
epic was materialised, which it never does. This is misleading for a future maintainer trying to
understand the SHAPE-05 reporting logic (which, per the surrounding comment, is otherwise
correctly and honestly reported as unproven).

**Fix:** Either remove the dead variable and simplify the condition to `if (rejectedTaskId)`, or, if
the intent was genuinely to gate on epic materialisation, wire `materialisedEpicId` up to the real
value returned by the epic-proposal acceptance path so the condition means what it says.

### WR-04: `TURN_IDLE_MS` (5s) is used unmodified by the live arm and resets on *any* sidecar event, not just events belonging to the awaited turn — risking premature truncation of a genuinely in-progress turn

**File:** `scripts/uat/lib/sidecar-harness.mjs:405, 580-642` (especially the `onEvent` handler at `:625-636`); used unmodified by `scripts/uat/uat-08-socratic-authoring.mjs` at `:1967-1970` and via `driveChallengeConversation`'s default (no `idleMs` passed at `:1980-1987`)

**Issue:** `waitForTurn` treats the backend's own `result` line as the primary end-of-turn signal
and only falls back to an idle window "so a backend that never emits one degrades into a reported
observation... rather than a hang" (own doc comment, lines 400-405). In practice, though, the idle
window is the *only* thing standing between "the model paused mid-turn" (e.g. a live Bash tool
call that takes longer than 5 seconds — npm installs, longer git operations, etc.) and "the turn
capture concludes early with `endedBy: 'idle'`" while the model is still generating. Because
`onEvent` (the idle-timer-resetting callback) fires on *every* sidecar event regardless of type or
`runId`:

```js
const onEvent = () => {
  if (settled) return;
  const partial = accumulateTurn(this.events, runId, cursor);
  if (partial.endedBy === "result") { finish(partial); return; }
  clearTimeout(idleTimer);
  if (partial.chunkCount > 0) { idleTimer = setTimeout(finishIdle, idleMs); }
};
```

the 5-second clock is only kept alive by *some* sidecar event arriving within that window — not
specifically an event that is part of this turn. A real tool execution that legitimately takes
more than 5 seconds with no other sidecar traffic in flight would let the idle timer fire,
`driveChallengeConversation` would then treat the partial capture as the complete agent turn,
extract whatever questions happen to be in the partial text (possibly none, causing the driver to
report `settled: true` prematurely), and send the next developer turn while the agent is still
mid-generation — interleaving developer input with an unfinished agent turn on the wire. None of
the offline arms can catch this: `fake-authoring-claude.mjs` always replies instantly, so the idle
path is never exercised by any tool-execution delay.

**Fix:** Either raise `idleMs` for the live arm to a value that comfortably exceeds a realistic
tool-execution pause (and pass it explicitly rather than relying on the 5s default), or scope the
idle-timer reset to events that are actually part of the awaited `runId`'s turn rather than any
sidecar event:

```js
// in #handleLine, before notifying turnWatchers:
if (this.turnWatchers.length > 0 && message.event?.runId === /* the watcher's own runId */) { ... }
```
(the latter requires threading the target `runId` into the watcher registration, since watchers
are currently untyped closures).

## Info

### IN-01: `--replay-check`'s multi-scenario exit-code aggregation conflates a `SkipError` (exit 3) with a genuine failure

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:1871-1878`

**Issue:** `anyFailed = true` is set whenever `(process.exitCode ?? 0) !== 0`, which is also true
for `runScript`'s own skip exit code (3). No scenario body in `runReplayCheckScenario` currently
calls `skip()`, so this is unreachable today, but it's a latent trap if a future scenario ever adds
a precondition check via `skip()`.

**Fix:** `if (process.exitCode === 1) anyFailed = true;` (or explicitly exclude 3), so a legitimate
skip doesn't get reported as a failure of the whole multi-scenario run.

### IN-02: The per-iteration drain timeout (`5_000`) is a repeated magic number with no shared name

**File:** `scripts/uat/lib/sidecar-harness.mjs:727` (inside `drainInboundCoreRequests`)

**Issue:** The `5_000` ms wait passed to `sidecar.waitForEvent` inside the drain loop is a bare
literal, unlike `HEARTBEAT_TICK_MS` and `TURN_IDLE_MS`, which are both named exports specifically
so callers and self-tests can reason about the same value. Minor — doesn't affect correctness.

**Fix:** Extract it to a named, exported constant (e.g. `DRAIN_POLL_MS`) for consistency with the
rest of the file's convention of naming every timing constant that matters to a caller.

---

_Reviewed: 2026-09-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
