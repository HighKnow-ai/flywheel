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
 *
 * **Permission-calling mode** (`FLYWHEEL_FAKE_CALL_PERMISSION=1` or `=2`, plan 02-05's AGNT-06
 * tests): plays the REAL backend's own role in the permission-prompt round trip — reads its own
 * `--permission-prompt-tool`/`--mcp-config` argv (exactly as the adapter built it), spawns the
 * named MCP server as ITS OWN child via `@modelcontextprotocol/sdk`'s `StdioClientTransport`
 * (matching how the documented `--mcp-config` mechanism actually works — the BACKEND owns
 * spawning each named server, never the sidecar), and calls the one tool it exposes. `=1` calls
 * it once; `=2` fires two calls concurrently (without awaiting the first) so the concurrency case
 * can prove they resolve independently, in whichever order their answers arrive. Each call's
 * outcome is printed as a `permission_tool_result` line — not part of claude's own real
 * `stream-json` schema, but `normaliseStreamEvent` already tolerates and forwards any
 * unrecognised shape as `type: "unknown"` while preserving its verbatim `raw` text, so the test
 * reads the outcome straight off that field without needing a schema change.
 *
 * **Environment-check mode** (`FLYWHEEL_FAKE_CHECK_ENV_VAR=<name>`, plan 02-09's D-39 credential
 * tests): proves the child process actually observed a value passed through its own environment
 * WITHOUT ever printing that value to stdout — this script compares `process.env[<name>]` against
 * a SEPARATE env var, `FLYWHEEL_FAKE_EXPECT_ENV_VALUE`, delivered through the environment (never
 * through stdout/argv either) and prints only the boolean result as a `env_check_result` line.
 * This is how `credentials.test.mjs` asserts "the child observed the resolved credential" and "no
 * sidecar-written stdout line contains the value" at the same time — the equality check happens
 * entirely inside this process, never crossing back out as anything but a boolean.
 *
 * **Limit-line mode** (plan 09-05, AGNT-05): `FLYWHEEL_FAKE_RATE_LIMIT=<json>` emits one
 * `rate_limit_event` whose `rate_limit_info` is that JSON object, right after the assistant line, so
 * a test can drive any tier through the real stream path. `FLYWHEEL_FAKE_ASSISTANT_ERROR=<code>`
 * emits one assistant message carrying that wire error code (the second place a hard limit may
 * surface). Every shape a test passes here for a hard limit is CONSTRUCTED from the documented
 * shape; no hard limit has ever been observed live in this project.
 *
 * **Plan-submitting mode** (`FLYWHEEL_FAKE_SUBMIT_PLAN=<json>`, plan 09-08): plays a planning run. It
 * prints the `--allowedTools` values it was launched with as an `allowed_tools` line, calls the
 * `submit_plan` tool of the MCP server named in `--mcp-config` with that JSON object as its arguments
 * (the real backend does exactly this), and prints the outcome as a `submit_plan_result` line carrying
 * `isError` and the answer's text. The call is HELD by the server until the Rust core answers, so a
 * session whose `submit_plan` callback is not wired never prints that line.
 *
 * **Commit mode** (`FLYWHEEL_FAKE_COMMIT_FILE=<repo-relative path>`, plan 11-16, D-REV-34): plays an
 * agent that does the work and commits it, but ONLY when its briefing tells it to. It reads its own
 * `-p <prompt>` argv and commits just when the prompt carries the dispatcher's commit instruction
 * (`DISPATCHED_COMMIT_INSTRUCTION`, "Commit your work on this branch ..."); it writes the file in
 * its own working directory (the run's worktree), `git add`s and `git commit`s it, and prints a
 * `fake_commit` line with the new HEAD (or a `fake_commit_skipped` line when the briefing did not
 * say to). Run through the session's `PATH`, so the commit passes the real PATH shim. This is
 * wiring, not obedience: a real model's compliance with the instruction is not what it shows.
 *
 * **Usage block** (G-02-4, plan 02-18): both of this script's `result` lines carry a `usage`
 * object in the real CLI's own field shape (`input_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens`, `output_tokens`) — the same shape measured live against claude
 * 2.1.236 during that plan's planning session. The three input-side values are fixed and DISTINCT
 * so that their sum equals no single one of them, on purpose: a test asserting the summed total
 * cannot pass by accident against any one field alone.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const SESSION_ID = "fake-session-0001";
const STUBBORN = process.env.FLYWHEEL_FAKE_STUBBORN === "1";
const CALL_PERMISSION = Number(process.env.FLYWHEEL_FAKE_CALL_PERMISSION ?? "0");

// G-02-4: three DISTINCT input-side values (2, 30, 400) so their sum (432) equals no single one
// of them — a test asserting the summed total cannot pass by accident against any one field.
// Field names mirror the real CLI's own usage block, measured live during this plan's planning.
const FAKE_USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 30,
  cache_read_input_tokens: 400,
  output_tokens: 7,
};

function printLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let interrupted = false;

/** Read `--flag <value>` from this process's own argv — the exact argv `buildClaudeArgv`
 * constructed for the real `claude` binary, which this script stands in for. */
function readFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Call the permission-prompt tool once, labelled `label` for the caller to tell concurrent
 * calls apart in its printed result. Spawns the MCP server named in `--mcp-config` exactly as
 * the real backend would, per the documented `--permission-prompt-tool` mechanism. */
async function callPermissionToolOnce(label) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const mcpConfig = JSON.parse(readFlag("--mcp-config"));
  const permissionPromptTool = readFlag("--permission-prompt-tool");
  const [, serverName, rawToolName] = permissionPromptTool.match(/^mcp__(.+)__(.+)$/);
  const serverConfig = mcpConfig.mcpServers[serverName];

  const transport = new StdioClientTransport({ command: serverConfig.command, args: serverConfig.args });
  const client = new Client({ name: "fake-claude", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: rawToolName,
      arguments: { tool_name: "Bash", input: { command: `echo ${label}` } },
    });
    const text = result.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    printLine({ type: "permission_tool_result", label, behavior: parsed.behavior });
  } finally {
    await client.close();
  }
}

/** Every value given to any `--allowedTools` flag, in order. */
function allowedToolsFromArgv() {
  const out = [];
  process.argv.forEach((arg, index) => {
    if (arg !== "--allowedTools") return;
    for (let i = index + 1; i < process.argv.length && !process.argv[i].startsWith("--"); i += 1) {
      out.push(process.argv[i]);
    }
  });
  return out;
}

/** Call `rawToolName` on the first MCP server named in `--mcp-config`, as the real backend would. */
async function callMcpToolOnce(rawToolName, args) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const mcpConfig = JSON.parse(readFlag("--mcp-config"));
  const serverConfig = Object.values(mcpConfig.mcpServers)[0];
  const transport = new StdioClientTransport({ command: serverConfig.command, args: serverConfig.args });
  const client = new Client({ name: "fake-claude", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await client.callTool({ name: rawToolName, arguments: args });
  } finally {
    await client.close();
  }
}

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

if (process.env.FLYWHEEL_FAKE_RATE_LIMIT) {
  printLine({ type: "rate_limit_event", rate_limit_info: JSON.parse(process.env.FLYWHEEL_FAKE_RATE_LIMIT) });
}
if (process.env.FLYWHEEL_FAKE_ASSISTANT_ERROR) {
  printLine({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "limit reached" }] },
    is_api_error_message: true,
    error: process.env.FLYWHEEL_FAKE_ASSISTANT_ERROR,
  });
}

if (CALL_PERMISSION === 1) {
  await callPermissionToolOnce("first");
} else if (CALL_PERMISSION === 2) {
  // Concurrency case: fire both calls WITHOUT awaiting the first — they must resolve
  // independently, in whichever order their answers arrive, not the order they were raised.
  await Promise.all([callPermissionToolOnce("first"), callPermissionToolOnce("second")]);
}

if (process.env.FLYWHEEL_FAKE_SUBMIT_PLAN) {
  printLine({ type: "allowed_tools", tools: allowedToolsFromArgv() });
  const result = await callMcpToolOnce("submit_plan", JSON.parse(process.env.FLYWHEEL_FAKE_SUBMIT_PLAN));
  printLine({ type: "submit_plan_result", isError: result.isError === true, text: result.content?.[0]?.text ?? "" });
}

const COMMIT_FILE = process.env.FLYWHEEL_FAKE_COMMIT_FILE;
if (COMMIT_FILE) {
  // Matches the first words of `DISPATCHED_COMMIT_INSTRUCTION` in packages/core/src/context_packet.rs.
  if (!(readFlag("-p") ?? "").includes("Commit your work on this branch")) {
    printLine({ type: "fake_commit_skipped", reason: "the briefing did not tell the agent to commit" });
  } else {
    fs.mkdirSync(path.dirname(path.resolve(COMMIT_FILE)), { recursive: true });
    fs.writeFileSync(COMMIT_FILE, `written by the fake agent in ${path.basename(process.cwd())}\n`);
    // Identity through the environment, not `git -c ...`: the PATH shim classifies a git command line
    // that opens with global options as uncategorised and raises a permission request for it, so the
    // plain `git add` / `git commit` below is also what a real agent's briefing leads to.
    const identity = { GIT_AUTHOR_NAME: "Fake Agent", GIT_AUTHOR_EMAIL: "fake@flywheel.test", GIT_COMMITTER_NAME: "Fake Agent", GIT_COMMITTER_EMAIL: "fake@flywheel.test" };
    const git = (...args) => spawnSync("git", args, { encoding: "utf8", env: { ...process.env, ...identity } });
    const steps = [git("add", "--", COMMIT_FILE), git("commit", "-m", `agent work: ${COMMIT_FILE}`)];
    const failed = steps.find((r) => r.status !== 0);
    if (failed) {
      printLine({ type: "fake_commit_failed", stderr: failed.stderr.trim() });
    } else {
      printLine({ type: "fake_commit", head: git("log", "-1", "--format=%H").stdout.trim() });
    }
  }
}

const CHECK_ENV_VAR = process.env.FLYWHEEL_FAKE_CHECK_ENV_VAR;
if (CHECK_ENV_VAR) {
  // Never print process.env[CHECK_ENV_VAR] itself — only the boolean equality result. Both
  // values arrive through the environment (never argv, never stdout), so this comparison proves
  // env pass-through without ever putting the secret on this process's own stdout.
  const actual = process.env[CHECK_ENV_VAR];
  const expected = process.env.FLYWHEEL_FAKE_EXPECT_ENV_VALUE;
  printLine({ type: "env_check_result", varName: CHECK_ENV_VAR, matches: actual === expected, present: actual !== undefined });
}

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
      usage: FAKE_USAGE,
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
      usage: FAKE_USAGE,
    });
    process.exit(0);
  }, 50);
}
