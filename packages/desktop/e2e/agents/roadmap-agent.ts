/**
 * The scripted agent of UAT 17 (`scripts/uat/uat-17-roadmap-round.mjs`), as
 * `packages/sidecar/test/fake-claude.mjs` reads it: one script for every session. It reads its packet
 * and answers it. A Milestone's shaping packet gets a Round and a sharper exit test. A roadmap packet
 * whose trigger is Epic "Rounds" Done gets a proposed change and a wait. Any other roadmap packet
 * gets "Roadmap still holds".
 */
import type { AgentScript } from "../core";

export const SHARPER_EXIT_TEST =
  "Cyril takes a one-line idea to Ready Stories in Flywheel, and a roadmap Round answers each Epic he confirms Done.";

const MILESTONE_PACKET = String.raw`^# Shaping packet: Milestone `;
const ROADMAP_PACKET = String.raw`^# Roadmap packet: `;
const ROUNDS_DONE = String.raw`confirmed Epic FLY-1 "Rounds" Done`;

export const ROADMAP_AGENT: AgentScript = [
  // A Milestone's exit test: challenge it in a Round, then propose the sharper text.
  {
    when: MILESTONE_PACKET,
    name: "round_post",
    arguments: {
      note: "This Round settles what the exit test observes.",
      questions: [
        {
          title: "Observable",
          question: "Should the exit test name the roadmap Round an Epic's Done starts?",
          grounding: "Read the Milestone's exit test in the packet",
          recommended_answer: "Yes",
          because: "Epic #60 makes the Round part of what the Milestone delivers",
        },
      ],
    },
  },
  {
    when: MILESTONE_PACKET,
    name: "propose_exit_test",
    arguments: { text: SHARPER_EXIT_TEST, why: "Round 1 settled it" },
  },
  // A roadmap Round: an Epic missing after Rounds is Done, else the Roadmap holds.
  {
    when: ROUNDS_DONE,
    name: "propose_roadmap_change",
    arguments: {
      change: "add_epic",
      milestone_id: String.raw`{{prompt:Milestone "Shaping" \([^)]*\) \[milestone_id: ([0-9A-Z]+)\]}}`,
      title: "Round history",
      problem: "Answered Rounds cannot be read back once the Epic is Done.",
      why: "Rounds is Done, and its exit test left the history of answered Rounds out of every Epic.",
    },
  },
  { when: ROUNDS_DONE, name: "round_wait", arguments: {} },
  {
    when: ROADMAP_PACKET,
    unless: ROUNDS_DONE,
    name: "roadmap_holds",
    arguments: { why: "The Milestone's exit test is still reachable and no Epic is missing." },
  },
];
