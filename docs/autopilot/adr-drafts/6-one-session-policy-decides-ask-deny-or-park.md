# One session policy in the core decides ask, deny or park

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then.

## Context

Whether a request waits for the Developer is decided in five places:
- the shim's deny-list (`destructive.rs`, `shim.rs`);
- `domain/permission_request.rs`;
- the sidecar's `mcp-permission-server.ts`;
- the permission handlers in the desktop's `commands/session.rs`;
- `session_ending.rs`, at session close.

Waiting on you is derived in `needs_you`. The sidecar parses `rate_limit_event`, but the core keeps only one bit of it: whether the request was rejected.

Under Autopilot, a session has no human to ask. A request or a Gated action parks the Story. The session cap must back off from real rate-limit facts.

## Decision

- **The core owns one session policy,** keyed by the session's kind and mode. For each request a session reports, it answers:
  - **Ask:** attended only. A permission request card, and the session is Waiting on you.
  - **Deny.**
  - **Park:** unattended only. The session ends, and the Story becomes Parked, with the request as its reason.
- **The shim and the sidecar report requests and obey the answer.** They hold no rule of their own. The shim keeps its deny-list as a second line of defence, and the list comes from the core.
- **Parked is stored on the Story.** It is not derived.
- **The rate-limit facts of each `rate_limit_event` are stored per project:** status, utilization and reset time. The Autopilot tick lowers the cap from them.

## Rejected alternatives

- **A mode flag in the sidecar.** The rule would then live in a second process.
- **The sidecar ending a session to park it.** The board would learn of it only after the fact.

## Consequences

- Parked becomes a Needs you kind.
- `mcp-permission-server.ts` shrinks to reporting and obeying.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/session_policy.rs`: `an_attended_request_asks_and_an_unattended_one_parks` `a_gated_action_parks_an_unattended_story_with_the_command_as_its_reason` `rate_limit_facts_are_stored_and_lower_the_cap`
- `packages/sidecar/test/`: `the sidecar reports a request and obeys the core's answer`
