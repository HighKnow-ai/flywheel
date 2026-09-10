#!/usr/bin/env node
/**
 * A deterministic stand-in for the `claude` CLI (AGNT-02's own flagged assumption: this is what
 * makes the whole phase testable without a network call or a real subscription). Emits a fixed
 * three-line stream-json sequence, honours SIGINT by printing a final `result` line before exiting
 * 0, and ignores nothing else this test suite cares about.
 *
 * `packages/sidecar/test/adapter.test.mjs` points `ClaudeCodeAdapter` at this script via
 * `FLYWHEEL_CLAUDE_BIN`.
 */

const SESSION_ID = "fake-session-0001";

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let interrupted = false;

process.on("SIGINT", () => {
  interrupted = true;
  printLine({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.0021,
    session_id: SESSION_ID,
  });
  process.exit(0);
});

printLine({
  type: "system",
  subtype: "init",
  session_id: SESSION_ID,
  model: "fake-model",
});

printLine({
  type: "assistant",
  message: {
    content: [{ type: "text", text: "Hello from the fake CLI." }],
  },
});

// Give SIGINT a moment to land in interrupt-focused tests before the process would otherwise
// finish on its own.
setTimeout(() => {
  if (interrupted) return;
  printLine({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.0021,
    session_id: SESSION_ID,
  });
  process.exit(0);
}, 50);
