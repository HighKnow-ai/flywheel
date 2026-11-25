# Flows

A flow doc describes one path through Flywheel as a sequence diagram. The diagram is the spec. The end-to-end harness records the steps that really happen and fails when they differ from the diagram.

Write in ASD-STE100 Simplified Technical English. Cover one flow in each doc.

| Flow | Doc | End-to-end test |
|---|---|---|
| A Story goes from Ready to Merged | [review-and-merge.md](review-and-merge.md) | `packages/desktop/e2e/flows/review-and-merge.spec.ts` |
| An Epic is shaped to Ready Stories | [epic-shaping.md](epic-shaping.md) | `packages/desktop/e2e/flows/epic-shaping.spec.ts` |
| The app starts after it died with a session running | [cold-start.md](cold-start.md) | `packages/desktop/e2e/flows/cold-start.spec.ts` |
| A running Story files Proposals | [execution-proposals.md](execution-proposals.md) | `packages/desktop/e2e/flows/execution-proposals.spec.ts` |
| A Milestone is shaped and roadmap Rounds run | [roadmap-round.md](roadmap-round.md) | `packages/desktop/e2e/flows/roadmap-round.spec.ts` |
| The fleet reads runs while they go on and end | [fleet-live-reads.md](fleet-live-reads.md) | `packages/desktop/e2e/flows/fleet-live-reads.spec.ts` |
| The blocked queue is answered | [blocked-queue.md](blocked-queue.md) | `packages/desktop/e2e/flows/blocked-queue.spec.ts` |
| A Story of a monorepo folder runs and merges | [monorepo-layout.md](monorepo-layout.md) | `packages/desktop/e2e/flows/monorepo-layout.spec.ts` |
| A session lives past the watchdog window | [session-supervision.md](session-supervision.md) | `packages/desktop/e2e/flows/session-supervision.spec.ts` |
| A project is renamed from its menu | [project-rename.md](project-rename.md) | `packages/desktop/e2e/flows/project-rename.spec.ts` |
| A project is registered and its first Story is written | [first-project-and-story.md](first-project-and-story.md) | `packages/desktop/e2e/flows/first-project-and-story.spec.ts` |
| A Stopped Story is recovered and dropped | [stopped-story-recovery.md](stopped-story-recovery.md) | `packages/desktop/e2e/flows/stopped-story-recovery.spec.ts` |
| Merge with a failing Check, and Rebase needed | [merge-guards.md](merge-guards.md) | `packages/desktop/e2e/flows/merge-guards.spec.ts` |
| A Story lands by pull request | [story-landing.md](story-landing.md) | `packages/desktop/e2e/flows/story-landing.spec.ts` |
| A new worktree gets the project's untracked files | [worktree-include.md](worktree-include.md) | `packages/desktop/e2e/flows/worktree-include.spec.ts` |
| A note reaches a running agent | [note-to-agent.md](note-to-agent.md) | `packages/desktop/e2e/flows/note-to-agent.spec.ts` |
| A note the agent never took | [note-undelivered.md](note-undelivered.md) | `packages/desktop/e2e/flows/note-undelivered.spec.ts` |
| A Quick Story is written and started | [quick-story.md](quick-story.md) | `packages/desktop/e2e/flows/quick-story.spec.ts` |

## Participants

Use only these ids in a diagram.

| Id | What it is |
|---|---|
| `ui` | The developer, working in the renderer. A step from `ui` is a command that changes the board. |
| `core` | The Rust core: the command handlers, the database and git. |
| `agent` | The agent. A step from `agent` is a board tool call. In the tests the agent is a script. |
| `scheduler` | The git-truth scheduler. A step from `scheduler` is a tick that reported changed git facts. A step from `core` to `core` is a step of the start path that is not a command. |

## Diagram rules

A script reads the diagram, so follow these rules exactly.

- Declare each actor on its own line: `participant <id>` or `participant <id> as <Label>`.
- Write each message on its own line: `<from>->><to>: <step id> <label>`.
- Use only the arrow `->>`.
- A step that the code performs but the core does not trace ends its label with `(not logged)`. The harness does not compare it with the trace. `untraced-steps.json` holds the count for each doc, and the count can only shrink. Do not draw a step that the code does not perform.
- The step id is `S` and a number, for example `S1`. Number the steps in order. Do not repeat an id.
- The label is the name of the command or the board tool. Reads do not appear: a command that only reads is not a step.
- Use only `participant`, message, blank and `%%` comment lines. Do not use notes, loops or `activate`.

## How a flow is checked

1. A test runs the flow in the real renderer, against the headless core and the real sidecar.
2. The core writes each step that changes the board to a trace, in order.
3. The harness compares the trace to the diagram. A different label, order, count or sender fails the test and shows both lists.
4. To accept a new flow, run `npm --prefix packages/desktop run e2e -- --update`. The harness rewrites the diagram messages from the trace. Read the diff before you commit it.

A command that is not in the core's read-only list counts as a step. Two more checks run in `npm --prefix packages/desktop test`, so in CI (`e2e/flow-docs.test.ts`):

- Each doc has a Tests row for an e2e spec in `packages/desktop/e2e/flows/`. The spec passes `doc: "<name>.md"` to `flow(...)`, the call that runs the matcher. The row names every traced step. Each Entry points row names a file that holds the symbol. Each spec is in one doc.
- The number of `(not logged)` steps in a doc is the number in `untraced-steps.json`. More fails. Fewer fails until you lower the number.

The template of a new doc is `docs/templates/flow.md`.

A new command that only reads must be added to that list (`READ_ONLY` in `packages/desktop/src-tauri/src/bin/flywheel-headless.rs`). The test fails until you add it.
