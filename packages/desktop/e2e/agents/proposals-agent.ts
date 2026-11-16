/**
 * The scripted Story agent of UAT 18 (`scripts/uat/uat-18-execution-proposals.mjs`), as
 * `packages/sidecar/test/fake-claude.mjs` reads it: three Proposals, a fourth that the core
 * refuses, a withdrawal that frees a slot, and the fourth again.
 */
import type { AgentScript } from "../core";

const WHY = "Found while working the Parser";
export const EVIDENCE = "src/parser.rs:42 panics on an empty line";
/** A New Story carries its criteria: one proven by a Check, one judged at review. */
const CRITERIA = [
  { statement: "An empty line yields no token", check: "cargo test lexer" },
  { statement: "The error names the line" },
];

export const NEW_STORY_TITLE = "Empty-line recovery";
export const AMEND_SCOPE_TEXT = "The parser, and recovering from bad lines";
export const REFILED_TITLE = "Line numbers in errors";

export const PROPOSALS_AGENT: AgentScript = [
  {
    name: "propose",
    arguments: {
      kind: "new_story",
      title: NEW_STORY_TITLE,
      description: "Recover from an empty line",
      criteria: CRITERIA,
      why: WHY,
      evidence: EVIDENCE,
    },
  },
  {
    name: "propose",
    arguments: { kind: "amend_epic_spec", field: "scope", text: AMEND_SCOPE_TEXT, why: WHY, evidence: EVIDENCE },
  },
  {
    name: "propose",
    arguments: {
      kind: "new_epic",
      title: "Error recovery",
      problem: "One bad line stops the parse",
      why: WHY,
      evidence: EVIDENCE,
    },
  },
  // The fourth is refused: three are open.
  {
    name: "propose",
    arguments: { kind: "new_story", title: REFILED_TITLE, criteria: CRITERIA, why: WHY, evidence: EVIDENCE },
  },
  { name: "proposal_withdraw", arguments: { proposal_id: "{{result:propose:proposal_id}}" } },
  {
    name: "propose",
    arguments: { kind: "new_story", title: REFILED_TITLE, criteria: CRITERIA, why: WHY, evidence: EVIDENCE },
  },
];
