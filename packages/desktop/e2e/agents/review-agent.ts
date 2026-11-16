/**
 * The scripted Story agent of UAT 19 (`scripts/uat/uat-19-board-and-review.mjs`), as
 * `packages/sidecar/test/fake-claude.mjs` reads it: its first session works and hands off; after a
 * request for changes, its second session adds a Task for the review point, commits the fix,
 * re-runs the Checks and hands off again. Each step runs only in the session whose packet matches
 * `when` / `unless`, and `{{result:..}}` and `{{prompt:..}}` read earlier answers and the packet.
 */
import type { AgentScript } from "../core";

/** Section 7 of a packet after a request for changes. */
export const CHANGES_REQUESTED = "The developer requested changes at review";
export const COMMENTS = "Name the column in a parse error, not only the line.";
export const ADR_PATH = "docs/adr/0001-parse-into-a-tree.md";
const ADR_TEXT = [
  "# Parse into a tree, not a token stream",
  "",
  "Status: accepted",
  "",
  "The parser returns a tree whose nodes keep their line, so an error can name where it is.",
  "",
].join("\n");
const ADR_BAR_LINES = {
  path: ADR_PATH,
  hard_to_reverse: "Every caller walks the tree",
  surprising: "A line-oriented format parsed into a tree",
  losing_alternative: "A flat token stream",
  relates_to: "none",
};
const EVIDENCE = "src/parser.rs:3 returns on the first bad line";

export const REVIEW_AGENT: AgentScript = [
  // First session.
  {
    unless: CHANGES_REQUESTED,
    name: "task_add",
    arguments: { titles: ["Write the parser", "Record the tree decision as an ADR"] },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "doing" },
  },
  {
    unless: CHANGES_REQUESTED,
    commit: { path: "src/parser.rs", content: "// Parses a file into a tree.\npub fn parse(_src: &str) {}\n" },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "done", note: "src/parser.rs" },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "propose",
    arguments: {
      kind: "new_story",
      title: "Recover from a bad line",
      criteria: [{ statement: "A bad line is skipped and the parse goes on", check: "cargo test recover" }],
      why: "Found while writing the parser",
      evidence: EVIDENCE,
    },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "propose",
    arguments: {
      kind: "amend_criterion",
      criterion_id: String.raw`{{prompt:2\. A parse error names the line \[criterion_id: ([^\]]+)\]}}`,
      statement: "A parse error names its line",
      why: "The line is what the reader looks for",
      evidence: EVIDENCE,
    },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.1.task_id}}", state: "doing" },
  },
  { unless: CHANGES_REQUESTED, commit: { path: ADR_PATH, content: ADR_TEXT } },
  {
    unless: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.1.task_id}}", state: "done" },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "handoff",
    arguments: {
      next_session_must_know: "The parser is in; errors name the line.",
      decisions: "Parse into a tree (ADR 0001).",
      adrs: [ADR_BAR_LINES],
    },
  },
  // Second session, after the request for changes.
  { when: CHANGES_REQUESTED, name: "task_add", arguments: { titles: ["Name the column in a parse error"] } },
  {
    when: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.2.task_id}}", state: "doing" },
  },
  {
    when: CHANGES_REQUESTED,
    commit: {
      path: "src/parser.rs",
      content: "// Parses a file into a tree; an error names its line and column.\npub fn parse(_src: &str) {}\n",
    },
  },
  {
    when: CHANGES_REQUESTED,
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.2.task_id}}", state: "done" },
  },
  { when: CHANGES_REQUESTED, name: "checks_run", arguments: {} },
  {
    when: CHANGES_REQUESTED,
    name: "handoff",
    arguments: { next_session_must_know: "Errors name the line and the column.", decisions: "", adrs: [ADR_BAR_LINES] },
  },
];
