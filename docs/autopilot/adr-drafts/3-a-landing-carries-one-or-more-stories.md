# A Landing carries one or more Stories, so a Batch is the general case

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then. It amends ADR 0042 and leaves ADR 0009 as it is.

## Context

Landing assumes one Story everywhere:
- `landings.story_id` is the primary key;
- the PR title is the Story's key and title;
- command mode receives `FLYWHEEL_STORY_KEY` and `FLYWHEEL_STORY_BRANCH`;
- `guard_owned` requires a Story worktree;
- `merge_story_with` mixes the guard, the refusals, the route and the Developer's "Merge with failing Check" override in one function of about 100 lines.

Under Autopilot, the Batcher puts several In-review Stories on one branch, opens one PR and lands them behind one Merge gate run. On red, it removes the failing Story, or splits the Batch in half. It must ask "may this Story land?" without landing it.

## Decision

- **Readiness is its own pure check.** `readiness(story)` returns Ready, or Refused and a reason. The Developer's Merge and the Batcher both call it.
- **A Landing has its own id and carries 1 to N Stories.**
  - **PR route:** builds one landing branch with the Stories merged in order, pushes it and opens one PR with auto-merge.
  - **Command route:** runs the project's landing command with the list of Stories and their branches.
  - **Local merge** (ADR 0009) still takes one Story.
- **The Developer's Merge is a Landing of one.**
- **The landing tick watches the request.**
  - When it merges, every Story in it becomes Merged.
  - When the Merge gate goes red, the Autopilot tick decides what happens next.
  - Removing a Story means a new Landing without it.
- **A Batch needs a forge or a landing command.** A project with neither lands one Story at a time by local merge.
- **A wide Story lands alone. A prepare-only Story never joins a Batch.**

## Rejected alternatives

- **A Batch as a fourth route, beside the per-Story landing.** It gives two landing models, and the same bug would have two homes.
- **A Batch as a pseudo-Story.** It has no criteria, review or worktree, and it would break every Story invariant.

## Consequences

- A migration keys `landings` by its own id and adds `landing_stories`.
- Command mode receives the list. A project's batch tool plugs in there.
- A PR for more than one Story is titled "Batch n", and lists each Story's key with `Refs #N` where the project has an Issue mirror.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/landing.rs`: `readiness_refuses_without_merging` `a_landing_of_one_lands_as_merge_did` `a_landing_of_three_merges_all_three_when_its_request_merges` `removing_a_story_makes_a_new_landing_without_it` `a_project_with_no_forge_and_no_command_never_batches`
- Today's `packages/desktop/e2e/flows/` Merge flows, unchanged.
