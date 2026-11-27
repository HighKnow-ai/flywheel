# A Story launches from the core, attended or unattended, through one interface

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then.

## Context

Start lives in the desktop crate, in `commands/session.rs` (4,211 lines). `start_ready_story` and `launch_run_for_story` (Resume) are two near copies of the same live-session check, launch preparation and spawn. `prepare_launch` counts live sessions with inline SQL, per Story only. `SessionKind::launch_policy` fixes the permission mode by kind, with no mode input.

The Dispatcher must start Stories with the same rules as the Developer's Start, plus three more: blockers, a not-before date and a project-wide session cap. Copied into the Dispatcher, that would be a third launch path, testable only through IPC.

## Decision

- **The core has one Launch module:** `launch(story, mode)`. It returns Launched, or Refused and a reason.
- **It checks, in order:**
  - the Story is Ready;
  - every blocker has merged or closed;
  - the not-before date has passed;
  - the project's live Story sessions are under the cap.

  The cap counts every live Story session in the project. The Developer's Start counts toward the cap, but the cap never refuses it.
- **The mode is attended or unattended.**
  - Attended is the Developer's Start and Resume. The agent may raise permission requests.
  - Unattended is Autopilot. The agent has no permission prompt tool, and a request parks the Story (the session policy draft).
- **The spawn goes through a port.** Its two adapters are the desktop's sidecar and the headless harness.
- **The Start and Resume commands become thin callers of Launch.** The Dispatcher calls the same interface.

## Rejected alternatives

- **Keeping launch in the desktop crate and adding a third copy for the Dispatcher.** Three paths drift apart, and the Dispatcher can be tested only through IPC.
- **Letting the sidecar decide whether a Story may start.** The sidecar does not read the board.

## Consequences

- `commands/session.rs` loses the launch code. The duplicate launch path is deleted.
- `launch_policy` takes the mode.
- The move changes no behaviour, so today's e2e flows prove it.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/launch.rs`: `launch_refuses_a_story_that_is_not_ready_or_has_an_open_blocker_or_a_future_not_before_date` `an_unattended_launch_refuses_at_the_cap_and_an_attended_one_counts_toward_it` `start_and_resume_reach_the_same_launch`
- Today's `packages/desktop/e2e/flows/` Start and Resume flows, unchanged.
