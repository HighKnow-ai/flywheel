# Shape a Milestone and run roadmap Rounds

## Purpose

A developer shapes the exit test of a Milestone with an agent. Later the developer confirms an Epic Done. Each confirmation runs a roadmap Round. The Round proposes a change, or it says that the Roadmap still holds.

## Sequence

```mermaid
sequenceDiagram
  participant ui as Developer UI
  participant core as Rust core
  participant agent as Scripted agent
  ui->>core: S1 milestone_shape
  agent->>core: S2 round_post
  ui->>core: S3 round_accept_all
  agent->>core: S4 propose_exit_test
  ui->>core: S5 proposal_accept
  ui->>core: S6 stage_close
  ui->>core: S7 epic_confirm_done
  agent->>core: S8 propose_roadmap_change
  agent->>core: S9 round_wait
  ui->>core: S10 proposal_accept
  ui->>core: S11 epic_confirm_done
  agent->>core: S12 roadmap_holds
```

The agent is a script (`packages/desktop/e2e/agents/roadmap-agent.ts`). It reads the packet it starts from and answers that packet. The test works in the real UI. Each step of the developer is a control on the screen. The test reads the board from the core with read-only commands, which are not steps.

1. S1-S3: The developer selects Shape on the Milestone "Shaping" in its header on the board. The Milestone view opens. The agent posts one Round, and the Round is Waiting on you. The core holds the call. The developer selects Accept all recommended in the Round, and the call ends.
2. S4-S6: The agent proposes a sharper exit test. It shows under the Exit test field as a Proposed Exit test. The developer selects Accept on it, and the field has the new text. The developer selects Close Stage and confirms with Close and make it Ready. The Milestone is Ready with the new exit test.
3. S7-S10: The developer selects Back to return to the board. The developer selects Confirm exit test on the Epic "Rounds" and confirms with Confirm Done. Roadmap Round 1 opens with a short scope. The agent proposes a New Epic and waits. The change shows on the Roadmap strip as a Proposed row. The developer selects Accept on it, and this answers the held call. Round 1 closes and the strip says that Round 1 is decided. The New Epic is on the board in Shaping.
4. S11-S12: The developer selects Confirm exit test on the Epic "Roadmap strip" and confirms with Confirm Done. Roadmap Round 2 opens. The agent says that the Roadmap still holds. Round 2 closes with no Proposal, and the strip says "Roadmap still holds".

The core allows one live roadmap session. The test waits for the session of Round 1 to end before S11. The list of live sessions on the screen is empty at that time.

The seed Drops the one Story of each Epic, so each Epic can be confirmed Done. The core accepts a Dropped Story in the same way as a Merged Story. The merge itself is the subject of [review-and-merge.md](review-and-merge.md).

## Entry points

| Step | Path | Symbol |
|---|---|---|
| S1 | `packages/desktop/src/board/MilestoneShapingControl.tsx` | `MilestoneShapingControl` |
| S1 | `packages/desktop/src-tauri/src/commands/shaping.rs` | `milestone_shape` |
| S2, S4 | `packages/desktop/src-tauri/src/commands/shaping.rs` | `handle_shaping_tool_request` |
| S3 | `packages/desktop/src/shaping/RoundDock.tsx` | `RoundDock` |
| S3 | `packages/desktop/src-tauri/src/commands/shaping.rs` | `round_accept_all` |
| S5 | `packages/desktop/src/shaping/GhostCard.tsx` | `GhostCard` |
| S5, S10 | `packages/desktop/src-tauri/src/commands/proposal.rs` | `proposal_accept` |
| S6 | `packages/desktop/src/shaping/StageBar.tsx` | `StageBar` |
| S6 | `packages/desktop/src-tauri/src/commands/shaping.rs` | `stage_close` |
| S7, S11 | `packages/desktop/src/board/ConfirmExitTest.tsx` | `ConfirmExitTest` |
| S7, S11 | `packages/desktop/src-tauri/src/commands/roadmap_round.rs` | `epic_confirm_done` |
| S8-S9, S12 | `packages/desktop/src-tauri/src/commands/shaping.rs` | `handle_shaping_tool_request` |
| S10 | `packages/desktop/src/board/RoadmapRound.tsx` | `GhostRow` |

## Tests

| What it proves | Test path | Covers steps |
|---|---|---|
| A Milestone's exit test is shaped, and two confirmations run two roadmap Rounds, against the real core and sidecar. The developer shapes, accepts, closes and confirms in the real UI, with the mouse. | `packages/desktop/e2e/flows/roadmap-round.spec.ts` | S1-S12 |
| The same walk through the core and the sidecar with a Node driver (UAT 17). | `scripts/uat/uat-17-roadmap-round.mjs` | S1-S12 |

## Design

See `ARCHITECTURE.md` section 5 (the IPC seam) and `docs/mvp-spec.md`.

## Last verified

`cbdac17ce`
