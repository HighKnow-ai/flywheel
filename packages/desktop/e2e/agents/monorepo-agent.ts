/**
 * The scripted Story agent for the monorepo layout (issue #1600): one Task, one commit of
 * `src/parser.rs` (a path relative to the session's working directory, which must be the project's
 * folder inside the worktree), the Checks, and the hand-off.
 */
import type { AgentScript } from "../core";

export const MONOREPO_AGENT: AgentScript = [
  { name: "task_add", arguments: { titles: ["Write the parser"] } },
  { name: "task_update", arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "doing" } },
  { commit: { path: "src/parser.rs", content: "// Parses a file into a tree.\npub fn parse(_src: &str) {}\n" } },
  {
    name: "task_update",
    arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "done", note: "src/parser.rs" },
  },
  { name: "checks_run", arguments: {} },
  { name: "handoff", arguments: { next_session_must_know: "The parser is in.", decisions: "", adrs: [] } },
];
