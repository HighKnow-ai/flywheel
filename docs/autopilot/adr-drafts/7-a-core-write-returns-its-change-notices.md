# A core write returns its change notices, and the host emits them after the commit

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then.

## Context

Every command handler writes through the core, then calls `emit_board_changed` itself. The scheduler's ticks emit a different event. A write and its notice are two steps that every caller must pair.

Autopilot writes the board in the background, often. A background write that forgets to emit leaves the board on screen out of date. That breaks Principle 1, because the board on screen then disagrees with the board.

## Decision

- **A core write returns the change notices it caused:** the project, the entity and its id.
- **The host emits them after the commit, from one place,** for commands and ticks alike.
- **Handlers no longer call `emit_board_changed`.**
- The headless harness receives the notices the same way.

## Rejected alternatives

- **Emitting from the core.** The core has no Tauri dependency, and must keep none (portability).
- **A database trigger and a poll.** It adds latency and a second way to learn of a change.

## Consequences

- An Autopilot write cannot go unseen.
- The handlers shrink.
- The move changes no behaviour, so today's e2e flows prove it.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/change_notices.rs`: `every_board_write_returns_a_notice_for_what_it_changed`
- A check that refuses a call to `emit_board_changed` outside the host's emit loop.
- Today's `packages/desktop/e2e/flows/`, unchanged.
