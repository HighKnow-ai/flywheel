---
created: 2026-10-16T09:50:00.000Z
title: startSession leaves the lane's stdin open, so the agent never takes its turn
area: sidecar
severity: critical
files:
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/watchdog.ts
  - scripts/uat/uat-15-account-limit.mjs
---

## Problem

Every session spawned through `startSession` inherits a stdin pipe that nothing writes to and
nothing closes. `claude` waits on stdin even when the prompt is passed as a positional `-p`
argument, warns after three seconds, and then **never produces its turn**. The run looks healthy
from every angle the product can see.

Found 2026-10-16 while running plan 15-04 Task 3's live account-limit burn. Four lanes initialised
and streamed zero assistant tokens for twenty-five minutes. The only visible symptom was this line
in the lane's own event text:

    Warning: no stdin data received in 3s, proceeding without it

## Mechanism

- `claude-code-adapter.ts:1556` (`startSession`) spawns the watchdog with **default stdio**, so the
  child gets a stdin *pipe*. That code path contains no stdin handling at all.
- `watchdog.ts:176` spawns the backend `stdio: ["inherit", "pipe", "pipe"]` — deliberately, so the
  backend inherits the wrapper's stdin, which is that pipe.
- Nobody writes to it; nobody calls `end()` on it. The backend blocks forever.

The `"inherit"` is correct and load-bearing: the **authoring** path
(`claude-code-adapter.ts:1896`) passes no positional prompt and writes its opening turn to the
child's own stdin, holding it open on purpose. That path works and must not change.

## Why this is critical, not cosmetic

`startSession` is the path every ordinary dispatched Flywheel task uses. The burn lane is only the
first caller whose silence was loud enough to notice, because it was being watched by an
instrument. A dispatched task that never takes its turn — while its watchdog logs a healthy
`backend_spawned`, the gate records no state change, and no `session_closed` ever fires so nothing
retries — is a worse failure than the unexercised `Rejected` tier this was meant to measure.

It also blocks ROADMAP Phase 15 criterion 6: `uat-15-account-limit.mjs --live` cannot drain a
window using lanes that never run. Three live attempts have now spent real subscription capacity
and observed no tier.

## Fix

End the child's stdin immediately after the `startSession` spawn, leaving the authoring path
untouched:

```ts
const child = spawn(process.execPath, [watchdogEntryPath(), bin, ...argv], { ... });
child.stdin?.end();   // positional-prompt path: nothing will ever be written here
```

One line, in the one place every non-authoring caller routes through.

## Acceptance

- A session spawned through `startSession` with a positional prompt produces assistant output and
  emits `session_closed`, asserted by test — not by a live run.
- The authoring path still writes its opening turn to an open stdin and still accepts follow-up
  turns (`appendAuthoringTurn`), unchanged.
- `scripts/uat/uat-15-account-limit.mjs --live` lanes stream; a lane whose session ends is
  respawned, so `spawns` climbs past `1/1/1/1`.

## Evidence

- `scripts/uat/README.md` § "Item 8b — the account limit", which records all three attempts, the
  five causes ruled out by direct test, and the refuted backpressure hypothesis.
- Falsifiability check that found it: a one-word reply driven through the same lane path stalls
  identically, so output volume is not the variable.
