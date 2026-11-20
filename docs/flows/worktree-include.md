# A new worktree gets the project's untracked files

## Purpose

A project lists untracked files in `.flywheel/worktree-include`, for example a `.env` to copy and a `node_modules` folder to link. A developer starts a Story. The core puts those files in the new worktree before the agent and the Checks run, and a Check that fails for lack of an install says so on the review card.

## Sequence

```mermaid
sequenceDiagram
  participant ui as Developer UI
  participant core as Rust core
  participant agent as Scripted agent
  ui->>core: S1 story_start
  agent->>core: S2 task_add
  agent->>core: S3 task_update
  agent->>core: S4 task_update
  agent->>core: S5 checks_run
  agent->>core: S6 handoff
```

The agent is a script (`packages/desktop/e2e/agents/monorepo-agent.ts`). The project has three Checks. The first needs `.env`. The second needs `node_modules/dep/index.js`. The third runs a tool that nobody installed.

1. S1: The developer starts a Ready Story. The core makes the worktree, then copies `.env` and links `node_modules` from the project's folder, as the list says. It adds both paths to `info/exclude`, so the worktree reads clean.
2. S2-S6: The agent writes a Task, commits `src/parser.rs`, runs the Checks and hands off. The first two Checks pass in the worktree. The third fails, and the review card shows "Dependencies missing in this worktree?" above its output.

## Entry points

| Step | Path | Symbol |
|---|---|---|
| S1 | `packages/desktop/src-tauri/src/commands/session.rs` | `story_start` |
| S2-S6 | `packages/desktop/src-tauri/src/commands/task.rs` | `handle_inbound_board_tool_request` |

## Tests

| What it proves | Test path | Covers steps |
|---|---|---|
| A worktree holds the listed untracked files, the Checks that need them pass, and a missing install is named. | `packages/desktop/e2e/flows/worktree-include.spec.ts` | S1-S6 |

## Design

See ADR 0043 (`docs/adr/0043-a-new-story-worktree-gets-the-untracked-files-the-project-lists.md`) and `packages/core/src/worktree_include.rs`.

## Last verified

`000f5b540`
