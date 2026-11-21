/**
 * A note to the agent (docs/mvp-spec.md §4.7, docs/adr/0044): the sidecar holds a note the developer
 * sent and hands it to the agent at the agent's next turn boundary, through the note hook, never during a
 * tool call.
 *
 * Runs against the REAL spawned `fake-claude.mjs` in hook mode, which runs the session's own `--settings`
 * hooks the way the backend does: after a tool call has finished, and when the agent ends its turn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { ClaudeCodeAdapter, noteHookScriptPath, writeHookSettings } from "../dist/claude-code-adapter.js";
import { hookOutput, notesText } from "../dist/note-hook.js";
import { recordStubbornChildren } from "./stubborn-children.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FLYWHEEL_CLAUDE_BIN = path.join(__dirname, "fake-claude.mjs");

const stubborn = recordStubbornChildren(import.meta.url);
after(() => {
  stubborn.reap();
});

async function waitFor(predicate, { timeoutMs = 30_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timed out");
}

/** A fake session in hook mode; `events` fills as it runs and `done` settles when it ends. */
function start(runId, env) {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const done = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "work",
    permissionMode: "acceptEdits",
    env: { FLYWHEEL_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-note-")), ...env },
    onEvent: (e) => events.push(e),
  });
  return { adapter, events, done };
}

/** The fake backend's own printed lines of `type`, parsed from `unknown` events. */
function printed(events, type) {
  return events
    .filter((e) => e.type === "unknown" || e.type === "tool_result")
    .map((e) => {
      try {
        return JSON.parse(e.raw);
      } catch {
        return undefined;
      }
    })
    .filter((line) => line?.type === type);
}

test("a note sent during a tool call reaches the agent after that call, and is reported delivered", async () => {
  const { adapter, events, done } = start("note-run-boundary", {
    FLYWHEEL_FAKE_TOOL_TURNS: "3",
    FLYWHEEL_FAKE_TOOL_MS: "600",
  });
  await waitFor(() => events.some((e) => e.type === "tool_call"));
  // The first tool call is running now: the note waits for it.
  adapter.queueNote("note-run-boundary", "note-1", "Use the 2024 fixture.");
  await done;

  const context = printed(events, "fake_hook_context");
  assert.equal(context.length, 1, "the note is handed over once");
  assert.equal(context[0].afterTool, 1, "it arrives after the tool call that was running, not during it");
  assert.match(context[0].text, /Use the 2024 fixture\./);

  const delivered = events.filter((e) => e.type === "note_delivered");
  assert.deepEqual(delivered.map((e) => e.noteId), ["note-1"]);
  const firstResult = events.findIndex((e) => e.type === "tool_result");
  const deliveredAt = events.findIndex((e) => e.type === "note_delivered");
  assert.ok(firstResult !== -1 && deliveredAt > firstResult, "the delivery follows the finished tool call");
});

test("a note that arrives as the agent ends its turn keeps it working on the note", async () => {
  const { adapter, events, done } = start("note-run-stop", {
    FLYWHEEL_FAKE_TOOL_TURNS: "0",
    FLYWHEEL_FAKE_THINK_MS: "600",
  });
  await waitFor(() => events.some((e) => e.type === "assistant_text" || e.type === "init"));
  adapter.queueNote("note-run-stop", "note-2", "Also answer in French.");
  await done;

  const blocked = printed(events, "fake_stop_blocked");
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /Also answer in French\./);
  assert.deepEqual(events.filter((e) => e.type === "note_delivered").map((e) => e.noteId), ["note-2"]);
  assert.equal(events.at(-1).type, "session_closed");
  assert.equal(events.at(-1).reason, "completed");
});

test("a session with no note gets no hook text and reports no delivery", async () => {
  const { events, done } = start("note-run-none", { FLYWHEEL_FAKE_TOOL_TURNS: "2", FLYWHEEL_FAKE_TOOL_MS: "20" });
  await done;
  assert.equal(printed(events, "fake_hook_context").length, 0);
  assert.equal(printed(events, "fake_stop_blocked").length, 0);
  assert.equal(events.filter((e) => e.type === "note_delivered").length, 0);
});

test("a note for a session that has ended is refused, and for an unknown run is a typed error", async () => {
  const { adapter, done } = start("note-run-ended", { FLYWHEEL_FAKE_TOOL_TURNS: "0" });
  await done;
  assert.throws(() => adapter.queueNote("note-run-ended", "late", "too late"), /has ended/);
  assert.throws(() => adapter.queueNote("note-run-never-spawned", "x", "y"), /note-run-never-spawned/);
});

test("a note nobody asked for before the session ends is never reported delivered", async () => {
  // No hook mode: the agent never reaches a boundary that runs the note hook, and it ends on a stop.
  const { adapter, events, done } = start("note-run-undelivered", { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" });
  await waitFor(() => events.some((e) => e.type === "init"));
  adapter.queueNote("note-run-undelivered", "note-3", "Too late for this one.");
  await adapter.interruptSession("note-run-undelivered");
  await done;
  assert.equal(events.filter((e) => e.type === "note_delivered").length, 0);
  assert.equal(events.at(-1).type, "session_closed");
});

test("the settings file runs the note hook after a tool call and at the end of a turn", () => {
  const settings = JSON.parse(fs.readFileSync(writeHookSettings(fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-note-")), "r"), "utf8"));
  for (const event of ["PostToolUse", "Stop"]) {
    const commands = settings.hooks[event].flatMap((entry) => entry.hooks.map((h) => h.command));
    assert.equal(commands.length, 1, `${event} runs one hook`);
    assert.ok(commands[0].includes(noteHookScriptPath()), `${event} runs the note hook`);
  }
});

test("the hook prints context after a tool call, a block at a stop, and nothing without a note", () => {
  const notes = [{ id: "a", text: "First." }, { id: "b", text: "Second." }];
  assert.equal(hookOutput("PostToolUse", []), null);
  assert.equal(hookOutput("Stop", []), null);
  const post = JSON.parse(hookOutput("PostToolUse", notes));
  assert.equal(post.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(post.hookSpecificOutput.additionalContext, notesText(notes));
  const stop = JSON.parse(hookOutput("Stop", notes));
  assert.equal(stop.decision, "block");
  assert.match(stop.reason, /- First\.\n- Second\./);
});
