/**
 * The first test in this repository that runs the REAL `claude` binary (G-02-2). It closes the
 * gap's third `missing` item: `test/fake-claude.mjs` validates no arguments at all, so an argv
 * the real CLI always rejects — the exact one that shipped — passed the entire suite. This file
 * proves an argv the CLI rejects can no longer do that, and proves the proof itself works with a
 * falsifiability companion: a negative case built by removing the one flag the positive case
 * depends on.
 *
 * Credential and network discipline (D-39, AGNT-03): every spawn below overrides both
 * `ANTHROPIC_API_KEY` (an obviously-fake value) and `ANTHROPIC_BASE_URL` (a loopback address and
 * a port nothing listens on) in the child's environment. These two overrides are what guarantee
 * this file spends nothing and never touches the developer's real credentials — the assertions
 * deliberately concern argument VALIDATION, which the real CLI performs before any network call,
 * so a loopback base URL that nothing answers never gets reached at all for either case.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { buildClaudeArgv } from "../dist/claude-code-adapter.js";

/** The binary this file probes and spawns — `FLYWHEEL_REAL_CLAUDE_BIN` if set, else the plain
 * name resolved from PATH. Deliberately a SEPARATE env var from `FLYWHEEL_CLAUDE_BIN`
 * (`claude-code-adapter.ts`'s own override): that one points the ADAPTER at a fake CLI for every
 * other test in this suite; this one points THIS file at a real one. */
const REAL_CLAUDE_BIN = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude";

/** Bounded wait for the one-shot availability probe below. */
const AVAILABILITY_PROBE_TIMEOUT_MS = 5_000;

/** Bounded wait for each spawned real-binary run in the two tests below. Argument validation is
 * synchronous and immediate, so either case settles in well under a second in practice — this
 * ceiling only guards against a CLI that hangs instead of exiting. */
const SPAWN_DEADLINE_MS = 10_000;

/**
 * Resolve once, before any test runs, whether the real binary is available at all: spawn it with
 * a version flag and a short bounded wait (mirrors `probeClaudeBinary`'s own "resolve false,
 * never throw" shape in `claude-code-adapter.ts`, applied here synchronously so every `test(...)`
 * call below can read the result before registering). A zero exit is available; anything else —
 * not found, non-zero exit, timeout — is not.
 */
function probeRealBinaryAvailable(bin) {
  const result = spawnSync(bin, ["--version"], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: AVAILABILITY_PROBE_TIMEOUT_MS,
  });
  return result.error === undefined && result.status === 0;
}

const AVAILABLE = probeRealBinaryAvailable(REAL_CLAUDE_BIN);

/** `undefined` when the real binary is available; otherwise a sentence naming what was looked for
 * and the environment variable that would point at one. Passed as `{ skip: SKIP_REASON }` to
 * every `test(...)` below so a missing binary skips visibly rather than passing silently — and
 * printed once here so a skipped run is visible in the console output too, not just in the test
 * report. */
const SKIP_REASON = AVAILABLE
  ? undefined
  : `the real claude binary ("${REAL_CLAUDE_BIN}") could not be found on PATH or did not answer --version within ${AVAILABILITY_PROBE_TIMEOUT_MS}ms — set FLYWHEEL_REAL_CLAUDE_BIN to point at one, or install the claude CLI, to run these tests`;

if (SKIP_REASON) {
  console.log(`[real-claude-argv.test.mjs] SKIPPED: ${SKIP_REASON}`);
}

/** Every real-binary process this file has spawned, by pid — signalled by process GROUP in the
 * `after()` hook below whatever the outcome, following `stop.test.mjs`/`shutdown.test.mjs`'s own
 * precedent (never a single-PID signal, RESEARCH.md Pitfall 3). */
const trackedPids = [];

after(() => {
  for (const pid of trackedPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already exited (the common case — argument validation is fast) — nothing to clean up.
    }
  }
});

/**
 * Spawn the real binary detached with `argv`, in `cwd`, with `env`, and resolve once the process
 * exits or `SPAWN_DEADLINE_MS` elapses, whichever comes first. Never rejects. `exited: false`
 * means the deadline was hit while the process was still running (the "still running" outcome the
 * positive case's own assertion treats as success — argument validation is synchronous, so a
 * process still alive at the deadline did not exhibit the shipped rejection shape).
 */
function runWithArgv(argv, { cwd, env }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(REAL_CLAUDE_BIN, argv, {
      cwd,
      env,
      // Own process group, so the after() hook's cleanup signal reaches every descendant, not
      // just this one pid (RESEARCH.md Pitfall 3, mirrored from claude-code-adapter.ts itself).
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (typeof child.pid === "number") trackedPids.push(child.pid);

    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      settle({ exited: false, code: undefined, stdout, stderr });
    }, SPAWN_DEADLINE_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      settle({ exited: true, code: null, stdout, stderr: stderr.length > 0 ? stderr : String(err) });
    });
    child.on("close", (code) => {
      settle({ exited: true, code, stdout, stderr });
    });
  });
}

/**
 * The shipped G-02-2 failure shape, asserted as a named predicate so both tests below assert the
 * SAME property rather than two independently-worded checks: the process exited, its exit code
 * was non-zero, and it wrote zero bytes to stdout. This is exactly what the real CLI does when it
 * rejects `-p --output-format stream-json` for lacking `--verbose` — exits 1 at argument
 * validation, having emitted nothing.
 */
function exhibitsShippedFailureShape(outcome) {
  return outcome.exited && outcome.code !== 0 && outcome.stdout.length === 0;
}

/** A fresh scratch working directory and a credential/network-isolated environment for one spawn
 * — see the module doc comment for why these two env overrides are what make this file safe to
 * run: they guarantee no token is spent and no real credential is touched, because the assertions
 * concern argument validation, which happens before any network call either override could
 * otherwise affect. */
function scratchEnv() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-real-claude-argv-"));
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: "sk-ant-fake-test-key-not-real-0000000000000000000000",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
  };
  return { cwd, env };
}

test("the real cli accepts the argv the adapter builds", { skip: SKIP_REASON }, async () => {
  // Built by calling the function under test, never written out by hand — a hand-written array
  // here would reintroduce exactly the exact-literal problem this file exists to close.
  const argv = buildClaudeArgv({ prompt: "say hi", permissionMode: "acceptEdits" });
  const { cwd, env } = scratchEnv();

  const outcome = await runWithArgv(argv, { cwd, env });

  assert.ok(
    !exhibitsShippedFailureShape(outcome),
    `the adapter's own argv must not exhibit the shipped G-02-2 failure shape (immediate non-zero exit with zero stdout bytes). ` +
      `argv=${JSON.stringify(argv)} exited=${outcome.exited} code=${outcome.code} ` +
      `stdout=${JSON.stringify(outcome.stdout)} stderr=${JSON.stringify(outcome.stderr)}`,
  );
});

test("an argv missing the required flag is rejected by the real cli", { skip: SKIP_REASON }, async () => {
  const positiveArgv = buildClaudeArgv({ prompt: "say hi", permissionMode: "acceptEdits" });
  const verboseIndex = positiveArgv.indexOf("--verbose");
  assert.ok(
    verboseIndex !== -1,
    `the positive argv must contain --verbose to construct a meaningful negative case: ${JSON.stringify(positiveArgv)}`,
  );
  // The negative argv differs from the positive one by exactly one removed element — the
  // falsifiability companion for the positive test above.
  const negativeArgv = [...positiveArgv.slice(0, verboseIndex), ...positiveArgv.slice(verboseIndex + 1)];
  assert.equal(negativeArgv.length, positiveArgv.length - 1);

  const { cwd, env } = scratchEnv();
  const outcome = await runWithArgv(negativeArgv, { cwd, env });

  assert.ok(
    exhibitsShippedFailureShape(outcome),
    `an argv missing --verbose must exhibit the shipped G-02-2 failure shape (immediate non-zero exit with zero stdout bytes). ` +
      `argv=${JSON.stringify(negativeArgv)} exited=${outcome.exited} code=${outcome.code} ` +
      `stdout=${JSON.stringify(outcome.stdout)} stderr=${JSON.stringify(outcome.stderr)}`,
  );
  assert.ok(
    outcome.stderr.length > 0,
    `expected the rejected argv to write a non-empty explanation to stderr, got: ${JSON.stringify(outcome.stderr)}`,
  );
  // Version canary: reported, never asserted on wording — the exit shape above is the durable
  // property; a future CLI release may reword this message, and that reworded text should surface
  // to whoever reads this test's output rather than silently drift unnoticed.
  console.log(`[real-claude-argv.test.mjs] negative-case stderr (version canary): ${outcome.stderr.trim()}`);
});
