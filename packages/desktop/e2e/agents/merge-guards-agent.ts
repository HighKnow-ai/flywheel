/**
 * The scripted Story agent of the merge-guards flow. One script serves both Stories, and each step runs only in
 * the packet of its own Story (`# Context packet: FLY-2 Alpha`, `# Context packet: FLY-3 Bravo`), as
 * `packages/sidecar/test/fake-claude.mjs` reads `when`. Each session writes one Task, commits one file and hands
 * off. A hand-off runs every Check and moves the Story to In review whatever the results.
 *
 * Alpha commits `notes-alpha.txt` and not `alpha.txt`, so its Check fails. Bravo commits `shared.txt`, so its
 * Check passes, and the flow later writes another `shared.txt` on `main`, so Bravo's branch conflicts with it.
 */
import type { AgentScript } from "../core";

export const ALPHA_FILE = "notes-alpha.txt";
export const SHARED_FILE = "shared.txt";

function session(packet: string, title: string, commit: { path: string; content: string }, note: string) {
  const when = `# Context packet: ${packet} `;
  return [
    { when, name: "task_add", arguments: { titles: [title] } },
    {
      when,
      name: "task_update",
      arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "doing" },
    },
    { when, commit },
    {
      when,
      name: "task_update",
      arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "done" },
    },
    { when, name: "handoff", arguments: { next_session_must_know: note, decisions: "" } },
  ];
}

export const MERGE_GUARDS_AGENT: AgentScript = [
  ...session(
    "FLY-2",
    "Leave a note",
    { path: ALPHA_FILE, content: "Alpha was here.\n" },
    "Alpha left a note and not alpha.txt.",
  ),
  ...session("FLY-3", "Read the shared file", { path: SHARED_FILE, content: "bravo\n" }, "Bravo wrote shared.txt."),
];
