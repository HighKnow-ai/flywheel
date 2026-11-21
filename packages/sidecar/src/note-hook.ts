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
 * notes waiting for it, in two phases (issue #1867). Both requests carry the run's token
 * (`FLYWHEEL_NOTE_TOKEN`, in the env of this session only), because the socket is in `/tmp` and any
 * process of the same user can connect to it: without the token the sidecar gives no note.
 *
 *  1. `{"kind":"note_pull"}`: the sidecar leases the waiting notes to this hook. It keeps them.
 *  2. After the script has written its output, `{"kind":"note_ack"}`: only now does the sidecar tell the
 *     Rust core that the notes are delivered.
 *
 * A hook that dies between the two leaves the notes pending, so the board does not claim a delivery
 * the agent never saw, and the next boundary offers them again once the lease runs out. With no note
 * waiting the script prints nothing.
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
import fs from "node:fs";
import net from "node:net";

import type { PendingNote } from "./mcp-permission-server.js";

/** Longest wait for the sidecar's answer, in milliseconds. A hook that waits longer blocks the agent. */
const ANSWER_WAIT_MS = 3_000;

/**
 * One request to the sidecar's socket, one answer line back, or `null` when there is no answer: a refused
 * socket, a timeout and an unreadable answer all mean "no answer", and the hook then does nothing.
 */
function ask(socketPath: string, request: object): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const finish = (answer: Record<string, unknown> | null): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(null), ANSWER_WAIT_MS);
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(buffer);
        finish(parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null);
      } catch {
        finish(null);
      }
    });
    socket.on("error", () => finish(null));
  });
}

/** Phase one: the notes the sidecar leases to this hook. They stay pending there until {@link ackNotes}. */
async function pullNotes(socketPath: string, token: string): Promise<PendingNote[]> {
  const answer = await ask(socketPath, { kind: "note_pull", token });
  const notes = answer?.notes;
  return Array.isArray(notes)
    ? notes.filter((n): n is PendingNote => typeof n?.id === "string" && typeof n?.text === "string")
    : [];
}

/** Phase two: tell the sidecar that the notes `ids` are printed for the agent, so it reports them delivered. */
async function ackNotes(socketPath: string, token: string, ids: string[]): Promise<void> {
  await ask(socketPath, { kind: "note_ack", token, ids });
}

/** Write `text` to stdout and resolve once the OS has taken it: the hand-over is done only then. */
function writeStdout(text: string): Promise<void> {
  return new Promise((resolve) => process.stdout.write(text, () => resolve()));
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
    // The run's token reaches this hook through the env of the session. Without it the sidecar would
    // answer with no note, so the hook does not ask.
    const token = process.env.FLYWHEEL_NOTE_TOKEN;
    if (!token) return;
    const notes = await pullNotes(socketPath, token);
    const out = hookOutput(event, notes);
    if (out === null) return;
    // Test seam (test/note-delivery.test.mjs): die once, between the pull and the hand-over, as a hook
    // that crashes would. The marker file makes it once, so the next hook run behaves.
    const dieOnce = process.env.FLYWHEEL_NOTE_HOOK_DIE_ONCE_MARKER;
    if (dieOnce && !fs.existsSync(dieOnce)) {
      fs.writeFileSync(dieOnce, "died");
      process.exit(1);
    }
    await writeStdout(out + "\n");
    await ackNotes(socketPath, token, notes.map((n) => n.id));
  } catch {
    // Silent no-op (see the module documentation).
  }
}

// A test imports this file for `hookOutput`; only a hook run reads stdin.
if (process.env.FLYWHEEL_NOTE_HOOK_NO_MAIN !== "1") {
  await main();
  process.exitCode = 0;
}
