/**
 * The agents of the note flows (docs/adr/0044). Both do nothing on the board. What differs is their
 * turn boundaries, which the environment of the run sets (`fake-claude.mjs`, hook mode).
 *
 * `NOTE_AGENT` works in short tool calls, one after another, for a long time. After each call the fake
 * backend runs the `PostToolUse` hooks of the session's own settings file, as the real backend does, and
 * prints what a hook adds to the agent's context as a `fake_hook_context` line. A note the developer sends
 * reaches it after the call it is making.
 *
 * `SILENT_AGENT` stays alive and reaches no boundary: it makes no tool call and waits to be stopped. A note
 * sent to it is never taken, so the flow can show the not-delivered state.
 */
import type { AgentScript } from "../core";

export const NOTE_AGENT: AgentScript = [];

export const NOTE_ENV = {
  FLYWHEEL_FAKE_TOOL_TURNS: "60",
  FLYWHEEL_FAKE_TOOL_MS: "1500",
};

export const SILENT_AGENT: AgentScript = [];

export const SILENT_ENV = { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" };
