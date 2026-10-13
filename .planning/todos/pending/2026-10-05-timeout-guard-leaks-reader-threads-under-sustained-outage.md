---
created: 2026-10-05T16:30:00.000Z
title: Subprocess timeout guard leaks reader threads under a sustained forge outage
area: core
severity: major
files:
  - packages/core/src/proc.rs:108-131
source: phase-07 gap-closure code review (07-REVIEW.md, HI-02)
---

## Problem

`output_with_timeout`'s timeout branch deliberately drops the `stdout_thread` /
`stderr_thread` / `stdin_thread` `JoinHandle`s without joining them. The rationale is sound
for an isolated hang: a surviving grandchild process can hold the pipe's write end open, so
joining would re-introduce the unbounded wait the function exists to eliminate. (This was
discovered the hard way during plan 07-10 — a shell stub that forked a surviving grandchild
defeated the whole ceiling until the join was removed.)

But dropping a `JoinHandle` does not stop the thread, it detaches it. The detached thread
keeps blocking in `read_to_end` until every copy of the pipe's write end closes, which may be
never if the surviving descendant is long-lived — a stuck `ssh` transport, a credential
helper, or a process wedged in `D` state on slow I/O.

The scenario this guard was built to survive is exactly the scenario that triggers the leak
repeatedly and without bound. The scheduler's forge tick runs every 120s
(`FORGE_POLL_SECS`) and the fetch tick every 300s (`FETCH_INTERVAL_SECS`). During a
persistent forge or network outage, every tick that touches an affected worktree times out
and abandons two or three threads that may never exit. Over an outage lasting hours this
leaks a steadily growing number of OS threads and the file descriptors they hold, eventually
risking thread-creation failure — a hard crash.

So under the single most important failure mode phase 07's gap closure targeted, the
behaviour degrades from "the app freezes until you notice" to "the app slowly leaks until it
crashes." The second is worse to debug in production because the symptoms are delayed and
have no obvious connection to the cause.

## Why this is not a phase-07 blocker

It does not break any phase-07 roadmap success criterion: it needs a multi-hour sustained
outage to become visible, and the bounded-ceiling behaviour the criteria assert is correct in
the isolated-hang case. It was filed rather than fixed in the gap-closure round under the
project rule that a phase closes on its roadmap success criteria, with other findings logged.

## Fix

Minimum: cap the number of outstanding abandoned reader threads — a counter or semaphore that
refuses new spawns, or emits a loud warning, once some fixed number of prior timeouts remain
unresolved. A sustained outage then degrades into a visible, bounded error state instead of an
invisible unbounded one.

More complete: put the direct child in its own process group (`setsid`/`setpgid` via
`pre_exec`) and kill the *group* on timeout rather than just the direct pid. Nothing is then
left alive holding the pipe's write end open, so the reader threads can be joined promptly and
the abandon-on-timeout compromise disappears entirely. This also matches the kill-the-whole-tree
guidance in the project's own architecture notes.
