/**
 * The note hook: how a note the developer typed reaches a running agent.
 *
 * Claude Code runs this script at two boundaries, both configured by `writeHookSettings`:
 *
 *  - `PostToolUse`: a tool call has finished and the agent is about to think again. The script prints
 *    the notes as `hookSpecificOutput.additionalContext`, which Claude Code adds to the agent's
 *    context. A tool call in progress is never touched.
 *  - `Stop`: the agent is about to end its turn. A note that arrived during the last stretch makes the
 *    script answer `{"decision":"block","reason":<notes>}`, so the agent reads the note and carries on
 *    instead of ending without it.
 *
 * The script asks the sidecar, over the session's own socket (`FLYWHEEL_PERMISSION_SOCKET`), for the
 * notes waiting for it (`{"kind":"note_pull"}`); the sidecar answers once and forgets them, and tells the
 * Rust core they were delivered. With no note waiting it prints nothing.
 *
 * `[CITED]`, not `[VERIFIED]`: the two output shapes are Claude Code's documented hook protocol
 * (`code.claude.com/docs/en/hooks`). No test in this repository runs them against a real `claude`; the
 * fake agent (`test/fake-claude.mjs`, `FLYWHEEL_FAKE_HOOKS`) plays the same protocol. A live check is
 * owed before the first outside user (docs/adr/0044).
 *
 * Failure is silent, like `sessionstart-hook.ts`: this hook decides nothing, and a throw would abort the
 * agent's work for a convenience. A refused or missing socket means no note this time, and the note
 * stays in the sidecar's queue for the next boundary.
 */
import net from "node:net";

import type { PendingNote } from "./mcp-permission-server.js";

/** Longest wait for the sidecar's answer, in milliseconds. A hook that waits longer blocks the agent. */
const ANSWER_WAIT_MS = 3_000;

function pullNotes(socketPath: string): Promise<PendingNote[]> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const finish = (notes: PendingNote[]): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(notes);
    };
    const timer = setTimeout(() => finish([]), ANSWER_WAIT_MS);
    socket.on("connect", () => socket.write(JSON.stringify({ kind: "note_pull" }) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => {
      try {
        const parsed = JSON.parse(buffer) as { notes?: unknown };
        finish(
          Array.isArray(parsed.notes)
            ? parsed.notes.filter(
                (n): n is PendingNote => typeof n?.id === "string" && typeof n?.text === "string",
              )
            : [],
        );
      } catch {
        finish([]);
      }
    });
    socket.on("error", () => finish([]));
  });
}

/** The words the agent reads: each note on its own, introduced as the developer's own. */
export function notesText(notes: PendingNote[]): string {
  const lines = notes.map((n) => `- ${n.text}`);
  return `Note from the developer, sent while you were working. Read it before your next step:\n${lines.join("\n")}`;
}

/** The hook's stdout for `event`, or `null` when there is nothing to say. */
export function hookOutput(event: string, notes: PendingNote[]): string | null {
  if (notes.length === 0) return null;
  const text = notesText(notes);
  if (event === "Stop") return JSON.stringify({ decision: "block", reason: text });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += String(chunk);
  return raw;
}

async function main(): Promise<void> {
  try {
    const socketPath = process.env.FLYWHEEL_PERMISSION_SOCKET;
    if (!socketPath) return;
    const input = JSON.parse((await readStdin()) || "{}") as { hook_event_name?: unknown; agent_id?: unknown };
    // A subagent's tool call fires this hook too. The note is for the session's own agent, so a subagent
    // must not take it: it would read it once and the main agent would never see it.
    if (input.agent_id !== undefined && input.agent_id !== null) return;
    const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
    const out = hookOutput(event, await pullNotes(socketPath));
    if (out !== null) process.stdout.write(out + "\n");
  } catch {
    // Silent no-op (see the module documentation).
  }
}

// A test imports this file for `hookOutput`; only a hook run reads stdin.
if (process.env.FLYWHEEL_NOTE_HOOK_NO_MAIN !== "1") {
  await main();
  process.exitCode = 0;
}
