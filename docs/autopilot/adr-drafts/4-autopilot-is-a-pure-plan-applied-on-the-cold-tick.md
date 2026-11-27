# Autopilot is a pure plan, applied on the cold tick like the landing tick

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then.

## Context

The scheduler has three fixed-interval tiers: hot, cold and fetch. Only the cold tier's `landing_tick` writes the board, and it follows ADR 0024: it reads under the board mutex, runs the forge CLI with no connection, then applies on a side connection.

The Dispatcher, the Batcher and the correction loop have no home. Written into command handlers, they could be tested only through IPC, and their rules would spread across files.

## Decision

- **The core has one Autopilot module.** Its interface is `plan(snapshot, now, limits) → [Action]`. It is pure: no I/O, no clock of its own.
- **The actions are:**
  - Start a Story;
  - Form a Batch, and close it at N Stories (default 4) or after T minutes from its first Story (default 10);
  - Remove a Story from a red Batch, with its Correction record;
  - Split a Batch whose failure cannot be traced to one Story;
  - Park a Story, with the reason;
  - Escalate a Story after its third correction;
  - Skip a Story, with the reason (written to the Run ledger);
  - Back off the session cap.
- **The limits are** the session cap (default 4, lowered from the stored rate-limit facts), Pause, and the live grants.
- **A thin apply step runs each action** through Authority, Launch and Landing. It writes the Run ledger, and returns the change notices.
- **The tick runs on the cold tier, following ADR 0024,** with one pass at start-up.
- In the headless harness, the tick is a traced step only in a flow that turns Autopilot on.

## Rejected alternatives

- **The rules in command handlers.** They could be tested only through IPC, and spread across files.
- **A separate daemon.** It would add a second process that writes the board, with its own copy of the board mutex rules.
- **A model deciding what to start or land.** Every Autopilot decision is deterministic, and a model never decides one.

## Consequences

- This is Flywheel's first scheduled automation. The spec's §12 and the exit test change with it.
- Pause and Withdraw are plan inputs, so each one is a table test.
- Depends on the Authority, Launch, Landing, Run ledger, session policy and change-notice drafts.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/autopilot_plan.rs`: `plan_starts_ready_stories_up_to_the_cap_in_epic_order` `plan_skips_a_story_with_an_open_blocker_and_says_why` `plan_closes_a_batch_at_four_stories_or_after_ten_minutes` `plan_removes_the_story_a_red_check_traces_to_and_splits_when_none_does` `plan_escalates_after_the_third_correction` `paused_or_withdrawn_starts_nothing`
- `packages/desktop/e2e/flows/`: `an accepted Epic's Stories run, batch and land with no click`
