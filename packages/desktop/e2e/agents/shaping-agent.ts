/**
 * The scripted shaping agent of UAT 16 (`scripts/uat/uat-16-epic-shaping.mjs`), as
 * `packages/sidecar/test/fake-claude.mjs` reads it: each step runs only in the session whose packet
 * matches its `when`, so one script serves all four Stages and the resumed session.
 */
import type { AgentScript } from "../core";

export const ADR_PATH = "docs/adr/0001-live-verbs-come-from-the-tool-name.md";
const ADR_TEXT =
  "# Live verbs come from the tool name\n\nA feed row's live verb is derived from the tool being called, never from the model's prose.\n";
const PROBLEM = "A feed row says what a tool did, never what the agent is doing now.";
export const EXIT_TEST = "A running tool call reads as its live verb in the feed.";
export const OWN_ANSWER = "Only the developer watching the fleet";
export const STORIES = [
  { title: "Live verbs for board tools", description: "Each board tool reads as a live verb; tested in tool-verbs." },
  {
    title: "The feed row shows the live verb",
    description: "The row swaps to the live verb while the call runs; tested in feed-row.",
  },
];

const CHALLENGE_FIRST = String.raw`Then post the first Round of the Challenge the spec Stage with \x60round_post\x60`;
const CHALLENGE_OPEN = String.raw`Round 1 of the Challenge the spec Stage is still open`;
const SLICE = String.raw`This session works the second Stage, Slice into Stories`;
const CRITERIA = String.raw`This session works the third Stage, Write the Acceptance criteria`;

export const SHAPING_AGENT: AgentScript = [
  {
    when: CHALLENGE_FIRST,
    name: "round_post",
    arguments: {
      note: "This Round settles who reads the live verb and where the verb comes from.",
      questions: [
        {
          title: "Where the verb shows",
          question: "Should the live verb replace the row's past-tense summary while the call runs?",
          grounding: "Read the Epic's one line",
          recommended_answer: "Yes, only while the call runs",
          because: "The finished row keeps saying what the tool did",
        },
        {
          title: "Who reads it",
          question: "Is the reader every viewer of the feed?",
          grounding: "Read the Epic's one line",
          recommended_answer: "Yes, every viewer",
          because: "The feed has one audience",
        },
        {
          title: "Record where verbs come from",
          question: 'Record "live verbs come from the tool name" as ADR 0001?',
          grounding: "No ADR in docs/adr/ says where a feed row's words come from",
          recommended_answer: "Yes",
          because: "Every later tool's row follows it",
          kind: "adr",
          adr: {
            path: ADR_PATH,
            text: ADR_TEXT,
            hard_to_reverse: "Every tool's row reads its verb from this rule",
            surprising: "A reader expects the model to describe its own action",
            losing_alternative: "Asking the model for a verb on each call",
          },
        },
      ],
    },
  },
  // The resumed session waits on the open Round, then proposes the spec it settled.
  { when: CHALLENGE_OPEN, name: "round_wait", arguments: {} },
  {
    when: CHALLENGE_OPEN,
    name: "propose_spec_change",
    arguments: { field: "problem", text: PROBLEM, why: "Round 1 settled the reader" },
  },
  {
    when: CHALLENGE_OPEN,
    name: "propose_spec_change",
    arguments: { field: "exit_test", text: EXIT_TEST, why: "Round 1 settled when it shows" },
  },
  // Slicing: the second Story runs after the first, named by the first one's proposal_id.
  { when: SLICE, name: "propose_story", arguments: STORIES[0] },
  {
    when: SLICE,
    name: "propose_story",
    arguments: {
      ...STORIES[1],
      runs_after: "{{result:propose_story:proposal_id}}",
      runs_after_reason: "reads its verbs",
    },
  },
  // Criteria: one with a Check per Story, the Story named by the key its packet shows.
  {
    when: CRITERIA,
    name: "propose_criterion",
    arguments: {
      story: String.raw`{{prompt:\n- ([A-Z]+-\d+) Live verbs for board tools}}`,
      statement: "Every board tool has a live verb",
      check: "npm test -- tool-verbs",
    },
  },
  {
    when: CRITERIA,
    name: "propose_criterion",
    arguments: {
      story: String.raw`{{prompt:\n- ([A-Z]+-\d+) The feed row shows}}`,
      statement: "A running call's row reads its live verb",
      check: "npm test -- feed-row",
    },
  },
];
