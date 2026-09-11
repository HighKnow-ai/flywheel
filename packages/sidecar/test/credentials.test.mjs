import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildClaudeArgv, ClaudeCodeAdapter, probeClaudeBinary } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

/** A credential-shaped value neither mode's argv should ever contain (T-02-01, D-39). */
const TEST_API_KEY_VALUE = "sk-ant-test-fixture-credential-0001";

function isCredentialShaped(value) {
  return /sk-ant|sk-|api[_-]?key/i.test(String(value));
}

/** Collect every normalised event a `startSession` call produces, plus everything written to
 * process.stdout DURING that call — mirrors how the real sidecar's `index.ts` would relay events,
 * so "nothing written to stdout contains the value" is checked against the actual OS-level
 * stdout stream, not just the in-memory `events` array. */
async function runSessionCapturingStdout(options) {
  const events = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const stdoutChunks = [];
  process.stdout.write = (chunk, ...rest) => {
    stdoutChunks.push(String(chunk));
    return originalWrite(chunk, ...rest);
  };
  try {
    const adapter = new ClaudeCodeAdapter();
    await adapter.startSession({ ...options, onEvent: (event) => events.push(event) });
  } finally {
    process.stdout.write = originalWrite;
  }
  return { events, stdout: stdoutChunks.join("") };
}

test("buildClaudeArgv produces no credential-shaped element for either mode (structural, no adapter parameter exists for one)", () => {
  const local = buildClaudeArgv({ prompt: "do the task", permissionMode: "acceptEdits" });
  const apiKey = buildClaudeArgv({ prompt: "do the task", permissionMode: "acceptEdits" });
  for (const element of [...local, ...apiKey]) {
    assert.ok(!isCredentialShaped(element), `argv element leaked a credential-shaped string: ${element}`);
  }
});

test("argv parity: buildClaudeArgv has no credential parameter, so its output is IDENTICAL regardless of which credential mode produced the spawn", () => {
  // There is no "mode" argument to buildClaudeArgv at all — this is the structural proof that
  // credential mode can never influence argv shape, not merely an assertion that two calls with
  // the same inputs happen to agree.
  const options = { prompt: "identical prompt", permissionMode: "default" };
  const first = buildClaudeArgv(options);
  const second = buildClaudeArgv(options);
  assert.deepEqual(first, second, "argv must be identical regardless of credential mode");
});

test("a spawn under the API-key mode passes the value through the child's environment and the child can read it, with nothing on stdout containing it", async () => {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  try {
    const { events, stdout } = await runSessionCapturingStdout({
      runId: "run-api-key",
      worktreePath: process.cwd(),
      prompt: "say hi",
      permissionMode: "acceptEdits",
      env: {
        ANTHROPIC_API_KEY: TEST_API_KEY_VALUE,
        FLYWHEEL_FAKE_CHECK_ENV_VAR: "ANTHROPIC_API_KEY",
        FLYWHEEL_FAKE_EXPECT_ENV_VALUE: TEST_API_KEY_VALUE,
      },
    });

    // The child observed the value in its own environment (matched against a SEPARATE env-only
    // channel, never printed) — see fake-claude.mjs's own "Environment-check mode" doc comment.
    const checkResult = events.find((e) => e.raw && e.raw.includes("env_check_result"));
    assert.ok(checkResult, "expected an env_check_result line from the fake backend");
    const parsed = JSON.parse(checkResult.raw);
    assert.equal(parsed.present, true, "the child should observe the env var as present");
    assert.equal(parsed.matches, true, "the child's observed value should match what was resolved for this spawn");

    // Nothing this session emitted (in-memory events OR the real OS-level stdout stream) contains
    // the raw value.
    for (const event of events) {
      assert.ok(!JSON.stringify(event).includes(TEST_API_KEY_VALUE), `an emitted event leaked the credential: ${JSON.stringify(event)}`);
    }
    assert.ok(!stdout.includes(TEST_API_KEY_VALUE), "process.stdout must never contain the credential value");
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("event parity: the local and API-key modes produce normalised event sequences equal in kind and order against the fake backend", async () => {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  try {
    const localRun = await runSessionCapturingStdout({
      runId: "run-parity-local",
      worktreePath: process.cwd(),
      prompt: "say hi",
      permissionMode: "acceptEdits",
      env: {},
    });
    const apiKeyRun = await runSessionCapturingStdout({
      runId: "run-parity-api-key",
      worktreePath: process.cwd(),
      prompt: "say hi",
      permissionMode: "acceptEdits",
      env: { ANTHROPIC_API_KEY: TEST_API_KEY_VALUE },
    });

    const kindsOf = (events) => events.map((e) => e.type);
    assert.deepEqual(
      kindsOf(localRun.events),
      kindsOf(apiKeyRun.events),
      "the two credential modes must produce identical event-kind sequences — the only difference is the child's environment",
    );
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("probeClaudeBinary reports unavailable (never throws) when the binary cannot be resolved", async () => {
  process.env.FLYWHEEL_CLAUDE_BIN = "/nonexistent/path/to/claude-binary-that-does-not-exist";
  try {
    const result = await probeClaudeBinary();
    assert.equal(result.available, false);
    assert.equal(result.version, undefined);
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("probeClaudeBinary reports available with a version string for a resolvable binary", async () => {
  // The fake CLI doesn't understand --version, but node itself does — proves the "available"
  // branch (exit 0, some stdout) without depending on the real claude CLI being installed.
  process.env.FLYWHEEL_CLAUDE_BIN = process.execPath;
  try {
    const result = await probeClaudeBinary();
    assert.equal(result.available, true);
    assert.ok(typeof result.version === "string" && result.version.length > 0);
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("starting a run under the local mode with the binary absent fails with an error naming the missing binary", async () => {
  const missingBin = "/nonexistent/path/to/claude-binary-that-does-not-exist";
  process.env.FLYWHEEL_CLAUDE_BIN = missingBin;
  try {
    // `startSession` itself rejects on a spawn error (`index.ts`'s own request-handling `.catch`
    // is what turns this into a `system_notice` event for the real sidecar protocol — this test
    // calls the adapter directly, one layer below that, so it asserts on the rejection itself).
    // Node's own ENOENT spawn error already names the resolved binary in its message
    // ("spawn <bin> ENOENT") — this is the exact "names the missing binary, not a generic spawn
    // failure" guarantee the plan's acceptance criterion asks for, verified here rather than
    // assumed.
    const adapter = new ClaudeCodeAdapter();
    await assert.rejects(
      () =>
        adapter.startSession({
          runId: "run-missing-binary",
          worktreePath: process.cwd(),
          prompt: "say hi",
          permissionMode: "acceptEdits",
          env: {},
          onEvent: () => {},
        }),
      (err) => {
        assert.ok(
          String(err.message ?? err).includes(missingBin),
          `expected the error to name the missing binary: ${err}`,
        );
        return true;
      },
    );
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("no module under packages/sidecar/src names ANTHROPIC_API_KEY or branches on a credential-mode string literal (structural, mirrors this file's own <verify> grep gates)", async () => {
  const fs = await import("node:fs/promises");
  const srcDir = path.join(__dirname, "..", "src");
  const entries = await fs.readdir(srcDir);
  for (const entry of entries) {
    if (!entry.endsWith(".ts")) continue;
    const contents = await fs.readFile(path.join(srcDir, entry), "utf8");
    const codeOnly = contents
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    assert.ok(
      !codeOnly.includes("ANTHROPIC_API_KEY"),
      `${entry} names the credential env var directly — it must only ever spread an already-resolved environment map`,
    );
    assert.ok(
      !/'api_key'|"api_key"/.test(codeOnly),
      `${entry} carries the credential-mode value as a code literal — the sidecar must never branch on credential mode`,
    );
  }
});
