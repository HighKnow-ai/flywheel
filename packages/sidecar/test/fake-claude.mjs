#!/usr/bin/env node
/**
 * A deterministic stand-in for the `claude` CLI (AGNT-02's own flagged assumption: this is what
 * makes the whole phase testable without a network call or a real subscription). Emits a fixed
 * three-line stream-json sequence, honours SIGINT by printing a final `result` line before exiting
 * 0, and ignores nothing else this test suite cares about.
 *
 * `packages/sidecar/test/adapter.test.mjs` points `ClaudeCodeAdapter` at this script via
 * `FLYWHEEL_CLAUDE_BIN`.
 *
 * **Stubborn mode** (`FLYWHEEL_FAKE_STUBBORN=1`, plan 02-02's D-35 stop-path tests): deliberately
 * ignores SIGINT, forks a long-lived grandchild process and prints its pid as its own JSON line,
 * and only exits on SIGTERM. This is what makes the "the force step reaches the whole process
 * GROUP, not just the direct child" claim falsifiable — `killSession`'s negative-pid SIGTERM
 * reaches the grandchild through POSIX process-group inheritance (the grandchild is spawned here
 * WITHOUT its own `detached` flag, so it stays in this process's group), not through any signal
 * forwarding this script writes itself. See `packages/sidecar/test/stop.test.mjs`.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const SESSION_ID = "fake-session-0001";
const STUBBORN = process.env.FLYWHEEL_FAKE_STUBBORN === "1";

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let interrupted = false;

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

if (STUBBORN) {
  // A plain (non-detached) spawn from here inherits THIS process's process group — exactly the
  // group the adapter's negative-pid signal targets, so the grandchild dies from the OS group
  // delivery itself, never from a signal this script relays. The grandchild ALSO ignores SIGINT
  // (its default disposition would otherwise terminate it on the interrupt step alone, which
  // would starve this parent's event loop of the one thing keeping it alive and collapse the
  // interrupt-vs-force distinction this fixture exists to prove) — it has no SIGTERM handler, so
  // the force step's default disposition still ends it.
  //
  // The grandchild is a SEPARATE OS process with its own Node.js startup cost — spawning it does
  // NOT mean its own `process.on('SIGINT', ...)` line has run yet. Printing `grandchild_pid`
  // before that registration actually completes would let a caller signal the group while the
  // grandchild is still vulnerable to SIGINT's default (terminate) disposition, felling it (and,
  // by starving this parent's only event-loop reference, this process too) on the interrupt step
  // alone — silently collapsing the very interrupt-vs-force distinction this fixture exists to
  // prove. So this script waits for the grandchild's own "ready" line — written only AFTER its
  // SIGINT handler is registered — before ever reporting the pid upstream.
  const grandchild = spawn(
    process.execPath,
    ["-e", "process.on('SIGINT', () => {}); console.log('ready'); setInterval(() => {}, 1000);"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  createInterface({ input: grandchild.stdout }).once("line", () => {
    printLine({ type: "grandchild_pid", pid: grandchild.pid });
  });

  // Deliberately ignored — the adapter's interrupt step alone must not be enough to end this
  // session; only the group SIGTERM (the force step) does.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {
    process.exit(0);
  });
} else {
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
}
