/**
 * ADR 0040: a project's sandbox policy reaches every session Flywheel starts in it, and a session it
 * did not reach is refused before its first turn.
 *
 * The first half runs the adapter against `fake-claude.mjs`, which plays the backend's half of the
 * check. The second half runs the REAL `claude` binary against the check's own stub API on a loopback
 * port, as `real-claude-argv.test.mjs` does: no model, nothing spent, and a `security` first on `PATH`
 * that refuses, so that no keychain is asked. It skips visibly where no binary is installed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildClaudeArgv, ClaudeCodeAdapter, writeHookSettings } from "../dist/claude-code-adapter.js";
import { buildProbeArgv, probeSandbox, readSandboxPolicy, sessionSandboxBlock, startStubApi } from "../dist/sandbox-policy.js";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");
const POLICY = {
  enabled: true,
  failIfUnavailable: true,
  allowUnsandboxedCommands: false,
  network: { allowedDomains: ["github.com"] },
};

let worktree;
let runtimeDir;
let argvFile;

function scratch(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writePolicy(text) {
  fs.mkdirSync(path.join(worktree, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(worktree, ".claude", "settings.json"), text);
}

function probeLeftovers() {
  const inHome = fs.readdirSync(os.homedir()).filter((name) => name.startsWith(".flywheel-sandbox-probe-"));
  const inWorktree = fs.readdirSync(worktree).filter((name) => name.startsWith(".flywheel-sandbox-probe-"));
  return [...inHome, ...inWorktree];
}

function recorded() {
  return fs
    .readFileSync(argvFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/** Start one session of `world` in the scratch worktree: its events, and whether `startSession` threw. */
async function startSession(world, extraEnv = {}) {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE;
  const events = [];
  let thrown;
  const adapter = new ClaudeCodeAdapter();
  await adapter
    .startSession({
      runId: `run-${path.basename(worktree)}`,
      worktreePath: worktree,
      prompt: "say hi",
      permissionMode: "default",
      allowedTools: ["Bash", "Read"],
      env: {
        FLYWHEEL_RUNTIME_DIR: runtimeDir,
        FLYWHEEL_FAKE_ARGV_FILE: argvFile,
        FLYWHEEL_FAKE_SANDBOX: world,
        ...extraEnv,
      },
      onEvent: (event) => events.push(event),
    })
    .catch((err) => {
      thrown = err;
    });
  return { events, thrown, closed: events.find((event) => event.type === "session_closed") };
}

function valueOf(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

beforeEach(() => {
  worktree = scratch("flywheel-sandbox-worktree-");
  runtimeDir = scratch("flywheel-sandbox-runtime-");
  argvFile = path.join(runtimeDir, "argv.jsonl");
});

afterEach(() => {
  delete process.env.FLYWHEEL_SANDBOX_PROBE_MS;
  fs.rmSync(worktree, { recursive: true, force: true });
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

test("readSandboxPolicy: what counts as a policy, and what counts as a broken one", () => {
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "none" }, "no settings file");
  writePolicy("{}");
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "none" }, "no sandbox key");
  writePolicy('{"sandbox":{"enabled":false}}');
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "none" }, "turned off on purpose");
  writePolicy('{"sandbox":{"failIfUnavailable":true}}');
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "none" }, "never turned on");
  writePolicy("{ not json, and no word about it");
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "none" }, "broken, but it never meant a policy");

  writePolicy(JSON.stringify({ sandbox: POLICY }));
  assert.deepEqual(readSandboxPolicy(worktree), { kind: "declared", sandbox: POLICY });

  for (const [what, text] of [
    ["a trailing comma", '{"sandbox":{"enabled":true,},}'],
    ["a mistyped enabled", '{"sandbox":{"enabled":"yes"}}'],
    ["a sandbox that is not an object", '{"sandbox":true}'],
  ]) {
    writePolicy(text);
    assert.equal(readSandboxPolicy(worktree).kind, "broken", what);
  }
});

test("sessionSandboxBlock makes the allow-list strict and keeps everything else", () => {
  assert.deepEqual(sessionSandboxBlock(POLICY), {
    ...POLICY,
    network: { allowedDomains: ["github.com"], strictAllowlist: true },
  });
  assert.deepEqual(sessionSandboxBlock({ enabled: true }).network, { strictAllowlist: true });
});

test("writeHookSettings merges the sandbox block beside the hooks, and writes none without one", () => {
  const withPolicy = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-a", sessionSandboxBlock(POLICY)), "utf8"));
  assert.equal(withPolicy.sandbox.network.strictAllowlist, true);
  assert.ok(withPolicy.hooks.SessionStart.length > 0, "the hooks are still there");
  const without = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-b"), "utf8"));
  assert.equal("sandbox" in without, false);
});

test("buildClaudeArgv adds --strict-mcp-config only when asked", () => {
  const base = { prompt: "x", permissionMode: "default" };
  assert.equal(buildClaudeArgv(base).includes("--strict-mcp-config"), false);
  assert.equal(buildClaudeArgv({ ...base, strictMcpConfig: true }).includes("--strict-mcp-config"), true);
});

test("a project with a policy: the session's argv carries it, the strict MCP flag and the allow rules", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  const { closed, thrown } = await startSession("on");
  assert.equal(thrown, undefined);
  assert.equal(closed.reason, "completed");

  const [probe, session] = recorded();
  assert.equal(probe.argv[1], "the sandbox probe", "the check comes first");
  assert.equal(session.argv[1], "say hi", "and then the session");
  assert.equal(recorded().length, 2);

  const settings = JSON.parse(fs.readFileSync(valueOf(session.argv, "--settings"), "utf8"));
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.network.strictAllowlist, true);
  assert.deepEqual(settings.sandbox.network.allowedDomains, ["github.com"]);
  assert.ok(session.argv.includes("--strict-mcp-config"));
  assert.equal(valueOf(session.argv, "--allowedTools"), "Bash,Read");
  assert.equal(session.argv.includes("--bare"), false, "AGNT-03: a session is never bare");

  assert.deepEqual(probe.argv, buildProbeArgv(valueOf(session.argv, "--settings")), "the check loads the session's own file");
  assert.deepEqual(probeLeftovers(), []);
});

test("a project with no policy starts exactly as before: no check, no flag, no block", async () => {
  const { closed } = await startSession("off");
  assert.equal(closed.reason, "completed");
  const runs = recorded();
  assert.equal(runs.length, 1, "no check ran");
  assert.equal(runs[0].argv.includes("--strict-mcp-config"), false);
  const settings = JSON.parse(fs.readFileSync(valueOf(runs[0].argv, "--settings"), "utf8"));
  assert.equal("sandbox" in settings, false);
});

test("a sandbox that is not on is refused before the first turn", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  const { closed, thrown, events } = await startSession("off");
  assert.equal(closed.reason, "failed");
  assert.match(closed.detail, /refused before its first turn: the sandbox is not on/);
  assert.match(String(thrown), /the sandbox is not on/);
  assert.deepEqual(events.map((event) => event.type), ["session_closed"], "nothing else happened");
  assert.equal(recorded().length, 1, "only the check ever started");
  assert.deepEqual(probeLeftovers(), []);
});

test("a policy file made invalid is refused with no backend started at all", async () => {
  writePolicy('{"sandbox":{"enabled":true,},}');
  const { closed } = await startSession("on");
  assert.equal(closed.reason, "failed");
  assert.match(closed.detail, /the sandbox is not on: .*not valid JSON/);
  assert.equal(fs.existsSync(argvFile), false, "no backend ran");
});

test("a command that never ran proves nothing, and refuses, saying what the backend said", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  const { closed } = await startSession("never-ran");
  assert.equal(closed.reason, "failed");
  assert.match(closed.detail, /could not tell whether the sandbox is on/);
  assert.match(closed.detail, /broke before its first request/);
  assert.deepEqual(probeLeftovers(), []);
});

test("a check that hangs refuses at its deadline", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  process.env.FLYWHEEL_SANDBOX_PROBE_MS = "300";
  const { closed } = await startSession("hang");
  assert.equal(closed.reason, "failed");
  assert.match(closed.detail, /still running after 300 ms/);
  assert.deepEqual(probeLeftovers(), []);
});

test("a settings file that cannot be written refuses a session with a policy", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  const blocked = path.join(runtimeDir, "blocked");
  fs.writeFileSync(blocked, "a file where the runtime directory should be");
  const { closed } = await startSession("on", { FLYWHEEL_RUNTIME_DIR: blocked });
  assert.equal(closed.reason, "failed");
  assert.match(closed.detail, /could not be written/);
  assert.equal(fs.existsSync(argvFile), false, "no backend ran");
});

test("no credential in the session's environment reaches the check", async () => {
  writePolicy(JSON.stringify({ sandbox: POLICY }));
  await startSession("on", {
    ANTHROPIC_AUTH_TOKEN: "x",
    CLAUDE_CODE_OAUTH_TOKEN: "x",
    CLAUDE_CODE_USE_BEDROCK: "1",
  });
  const [probe, session] = recorded();
  assert.deepEqual(probe.env.sort(), ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]);
  assert.ok(session.env.includes("CLAUDE_CODE_OAUTH_TOKEN"), "the session itself keeps what it was given");
  assert.equal(session.env.includes("ANTHROPIC_BASE_URL"), false, "and none of the check's settings");
});

// ---------------------------------------------------------------------------------------------------
// The real binary. Run on 2.1.311 on 2026-11-07, and the facts ADR 0040 states are these.
// ---------------------------------------------------------------------------------------------------

const REAL_BIN = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude";
const realAvailable = spawnSync(REAL_BIN, ["--version"], { stdio: "ignore", timeout: 5_000 }).status === 0;
const SKIP = realAvailable && process.platform === "darwin" ? undefined : "no real claude binary here, or not macOS";
if (SKIP) console.log(`[sandbox-policy.test.mjs] real-binary cases SKIPPED: ${SKIP}`);

/** The environment of a real start: a `security` that refuses comes first, and nothing of an enclosing
 * Claude Code session goes along. */
function realEnv() {
  const bin = path.join(runtimeDir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "security"), "#!/bin/sh\nexit 44\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env.CLAUDECODE;
  return env;
}

async function realProbe(sandbox) {
  const settingsPath = writeHookSettings(runtimeDir, `run-real-${Date.now()}`, sandbox);
  return probeSandbox({ bin: REAL_BIN, worktreePath: worktree, settingsPath, env: realEnv() });
}

test("real binary: a sandbox block in --settings is in force", { skip: SKIP, timeout: 90_000 }, async () => {
  assert.deepEqual(await realProbe(sessionSandboxBlock({ enabled: true, allowUnsandboxedCommands: false })), { ok: true });
  assert.deepEqual(probeLeftovers(), []);
});

test("real binary: no sandbox, a write outside lands, and the check says so", { skip: SKIP, timeout: 90_000 }, async () => {
  const probed = await realProbe(undefined);
  assert.equal(probed.ok, false);
  assert.match(probed.reason, /the sandbox is not on/);
});

test("real binary: a --settings file that fails validation is dropped, and the check says so", { skip: SKIP, timeout: 90_000 }, async () => {
  const probed = await realProbe({ enabled: "yes" });
  assert.equal(probed.ok, false);
  assert.match(probed.reason, /the sandbox is not on/);
});

test(
  "real binary: a session Flywheel starts cannot reach a host off the allow-list, and a repository's .mcp.json does not connect",
  { skip: SKIP, timeout: 90_000 },
  async () => {
    // Every Bash command is allowed, so the permission handler would let this through: only the sandbox
    // can refuse it. The refusal is local, so this needs no network.
    const answer = path.join(worktree, "curl-answer");
    const stub = await startStubApi(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://example.com >'${answer}' 2>&1`,
    );
    const connected = path.join(worktree, "mcp-connected");
    fs.writeFileSync(
      path.join(worktree, ".mcp.json"),
      JSON.stringify({ mcpServers: { planted: { command: "/usr/bin/touch", args: [connected] } } }),
    );
    writePolicy(JSON.stringify({ sandbox: POLICY }));

    process.env.FLYWHEEL_CLAUDE_BIN = REAL_BIN;
    const events = [];
    try {
      await new ClaudeCodeAdapter().startSession({
        runId: `run-real-session-${Date.now()}`,
        worktreePath: worktree,
        prompt: "the session",
        permissionMode: "default",
        allowedTools: ["Bash"],
        env: {
          ...realEnv(),
          FLYWHEEL_RUNTIME_DIR: runtimeDir,
          ANTHROPIC_API_KEY: "flywheel-test-not-a-key",
          ANTHROPIC_BASE_URL: stub.baseUrl,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        onEvent: (event) => events.push(event),
      });
    } finally {
      stub.server.closeAllConnections();
      stub.server.close();
      process.env.FLYWHEEL_CLAUDE_BIN = FAKE;
    }

    const closed = events.find((event) => event.type === "session_closed");
    assert.equal(closed?.reason, "completed", JSON.stringify(closed));
    assert.equal(fs.readFileSync(answer, "utf8"), "000", "curl reached nothing");
    assert.equal(fs.existsSync(connected), false, "the repository's MCP server was not spawned");
  },
);
