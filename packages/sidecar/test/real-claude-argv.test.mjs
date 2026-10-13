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
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { buildClaudeArgv, permissionServerScriptPath } from "../dist/claude-code-adapter.js";
import {
  MCP_SERVER_NAME,
  PERMISSION_TOOL_NAME,
  SUBMIT_PLAN_TOOL_NAME,
  startPermissionServer,
} from "../dist/mcp-permission-server.js";

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
function runWithArgv(argv, { cwd, env, deadlineMs = SPAWN_DEADLINE_MS }) {
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
    }, deadlineMs);

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

test("buildClaudeArgv pre-approves the summary tool via --allowedTools when supplied, and omits the flag when it isn't", () => {
  const permissionPromptToolName = "mcp__flywheel-permissions__approve_action";
  const mcpConfig = JSON.stringify({ mcpServers: { "flywheel-permissions": { command: "node", args: ["x.js"] } } });
  const summaryToolName = "mcp__flywheel-permissions__report_summary";

  const withSummary = buildClaudeArgv({
    prompt: "say hi",
    permissionMode: "acceptEdits",
    permissionPromptToolName,
    mcpConfig,
    summaryToolName,
  });
  const allowedToolsIndex = withSummary.indexOf("--allowedTools");
  assert.ok(allowedToolsIndex !== -1, "expected --allowedTools to be present when a summary tool name is supplied");
  assert.equal(withSummary[allowedToolsIndex + 1], summaryToolName);

  const withoutSummary = buildClaudeArgv({
    prompt: "say hi",
    permissionMode: "acceptEdits",
    permissionPromptToolName,
    mcpConfig,
  });
  assert.ok(
    !withoutSummary.includes("--allowedTools"),
    "expected --allowedTools to be absent when no summary tool name is supplied",
  );
});

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

// --- D-REV-35 (plan 11-16): the real binary under the exact planning-launch argv, default mode --------
//
// The question: does the installed CLI, in `default` permission mode, run its own read tools (Read, Grep,
// Glob) WITHOUT a permission request, when launched with the argv a planning run produces? A planning run
// pre-approves `submit_plan` and nothing else (09-08), so a read tool that prompted would block the run as
// `blocked` and hold its slot until a human answered.
//
// HOW IT IS ASKED WITHOUT A MODEL. No tool call happens unless a model asks for one, and the two tests above
// deliberately keep the CLI off the network. So the model is replaced and everything else is real: the
// binary is the installed one, the argv is `buildClaudeArgv`'s, the permission-prompt tool is the REAL MCP
// permission server reached over a REAL `startPermissionServer` socket, and `ANTHROPIC_BASE_URL` points at a
// loopback server below that plays the model's side of the Messages API: one assistant turn asking for the
// scripted tool calls, then a closing text turn. No credential is used and no token is spent: the key in the
// child's environment is an obviously fake value, and `CLAUDE_CONFIG_DIR` is a scratch directory so none of
// the developer's own settings, hooks or permission rules can change the answer.
//
// WHAT THIS DOES NOT PROVE. That a real model follows the planning prompt's two entry forms or leaves the
// worktree clean (a model-behaviour claim, plan 11-21); and the hook `--settings` file a live launch also
// passes (its PreToolUse matchers cover Bash and the authoring tools, not these read tools).

/** Bound on one scripted run end to end. Spawn, MCP handshake, two mock API turns and exit. */
const PLANNING_RUN_DEADLINE_MS = 45_000;

const SENTINEL = "planning-read-sentinel-7f3a";

/** Write the three-block SSE stream for one assistant turn. `blocks` are `{type:"text",text}` or
 * `{type:"tool_use",name,input}`. */
function writeAssistantTurn(res, model, blocks) {
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  send("message_start", {
    type: "message_start",
    message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
  });
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_mock_${index}`, name: block.name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { type: "content_block_stop", index });
  });
  const toolTurn = blocks.some((b) => b.type === "tool_use");
  send("message_delta", { type: "message_delta", delta: { stop_reason: toolTurn ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

/** A loopback stand-in for the model. The first conversation turn that offers tools gets `toolCalls`;
 * every later one (and every request that offers no tools, such as a side query) gets a closing text.
 * `requests` records each parsed request body so a test can read the tool results the CLI sent back. */
function startMockModel(toolCalls) {
  const requests = [];
  /** The tool names the CLI offered on its first conversation turn: what it can actually do in this version. */
  const offered = [];
  let toolTurnIssued = false;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages") || parsed === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "mock model: not found" } }));
        return;
      }
      requests.push(parsed);
      const model = parsed.model ?? "mock-model";
      const offersTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
      const hasToolResult = (parsed.messages ?? []).some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
      const wantsToolTurn = offersTools && !hasToolResult && !toolTurnIssued;
      if (wantsToolTurn) {
        toolTurnIssued = true;
        offered.push(...parsed.tools.map((t) => t.name));
      }
      const blocks = wantsToolTurn ? toolCalls(offered).map((c) => ({ type: "tool_use", ...c })) : [{ type: "text", text: "done" }];
      if (parsed.stream !== true) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model, content: blocks.map((b) => (b.type === "text" ? b : { type: "tool_use", id: "toolu_mock_0", name: b.name, input: b.input })), stop_reason: wantsToolTurn ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
        return;
      }
      writeAssistantTurn(res, model, blocks);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, offered, close: () => server.close() });
    });
  });
}

/** Run the real binary under the planning-launch argv against the mock model. Returns what a test needs to
 * judge it: how the process ended, every permission request the real permission server received, the mock's
 * recorded requests, and the tool results the CLI sent back on its second turn. `answer` decides held calls. */
async function runPlanningLaunch({ toolCalls, prompt, answer = "deny" }) {
  const { cwd, env: baseEnv } = scratchEnv();
  fs.writeFileSync(path.join(cwd, "NOTES.md"), `# Notes\n${SENTINEL}\n`);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-real-claude-config-"));
  const mock = await startMockModel((offered) => toolCalls(cwd, offered));
  const permissionRequests = [];
  const permissionServer = startPermissionServer(
    (payload) => {
      permissionRequests.push(payload);
      permissionServer.resolvePermission(payload.requestId, answer);
    },
    () => {},
    () => {},
  );
  try {
    const mcpConfig = JSON.stringify({
      mcpServers: { [MCP_SERVER_NAME]: { command: process.execPath, args: [permissionServerScriptPath(), permissionServer.socketPath] } },
    });
    // The planning launch's own call in `claude-code-adapter.ts` (`planning: true`), minus the hook settings file.
    const argv = buildClaudeArgv({
      prompt,
      permissionMode: "default",
      permissionPromptToolName: PERMISSION_TOOL_NAME,
      mcpConfig,
      submitPlanToolName: SUBMIT_PLAN_TOOL_NAME,
    });
    const outcome = await runWithArgv(argv, {
      cwd,
      env: { ...baseEnv, ANTHROPIC_BASE_URL: mock.url, CLAUDE_CONFIG_DIR: configDir },
      deadlineMs: PLANNING_RUN_DEADLINE_MS,
    });
    const toolResults = mock.requests
      .flatMap((r) => r.messages ?? [])
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === "tool_result");
    return { argv, outcome, permissionRequests, toolResults, offeredTools: [...mock.offered], cwd };
  } finally {
    permissionServer.close();
    mock.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

const resultText = (block) =>
  typeof block.content === "string" ? block.content : (block.content ?? []).map((c) => c.text ?? "").join("");

test(
  "argv: the real cli runs its own read tools without a permission_request under the planning launch argv in default mode",
  { skip: SKIP_REASON },
  async () => {
    // This CLI version may not offer Grep and Glob at all (native builds search through Bash instead),
    // so the search and listing calls are built from what was actually offered, and the form used is reported.
    const run = await runPlanningLaunch({
      prompt: "Read NOTES.md, search for the sentinel and list the files, then stop.",
      toolCalls: (cwd, offered) => [
        { name: "Read", input: { file_path: path.join(cwd, "NOTES.md") } },
        offered.includes("Grep")
          ? { name: "Grep", input: { pattern: SENTINEL, path: cwd, output_mode: "content" } }
          : { name: "Bash", input: { command: `grep -rn ${SENTINEL} .`, description: "search" } },
        offered.includes("Glob")
          ? { name: "Glob", input: { pattern: "*.md", path: cwd } }
          : { name: "Bash", input: { command: "find . -name '*.md'", description: "list" } },
      ],
    });
    console.log(
      `[real-claude-argv.test.mjs] planning-launch read tools offered by this cli: ${JSON.stringify(run.offeredTools)} ` +
        `(Grep offered: ${run.offeredTools.includes("Grep")}, Glob offered: ${run.offeredTools.includes("Glob")})`,
    );
    assert.ok(run.offeredTools.includes("Read"), `the cli must offer Read: ${JSON.stringify(run.offeredTools)}`);
    const context = `argv=${JSON.stringify(run.argv)} exited=${run.outcome.exited} code=${run.outcome.code} stderr=${JSON.stringify(run.outcome.stderr.slice(0, 500))}`;

    // The instrument worked: the CLI took the scripted turn and ran all three tools to completion.
    assert.equal(run.toolResults.length, 3, `expected three tool results sent back to the model, got ${run.toolResults.length}. ${context}`);
    assert.ok(
      run.toolResults.every((r) => r.is_error !== true),
      `a read tool came back as an error (a refusal is not a pre-approval): ${JSON.stringify(run.toolResults)}`,
    );
    assert.ok(
      run.toolResults.some((r) => resultText(r).includes(SENTINEL)),
      `the Read result must carry the file's contents, proving the tool really ran: ${JSON.stringify(run.toolResults)}`,
    );

    // The claim: no permission request reached the permission-prompt tool for any of them.
    assert.deepEqual(
      run.permissionRequests.map((p) => p.toolName),
      [],
      `a read tool raised a permission_request in default mode, which would block a planning run and hold its slot. ${context}`,
    );

    // And the session did not stall: it exited, zero, inside the stated bound.
    assert.ok(run.outcome.exited, `the planning launch was still running after ${PLANNING_RUN_DEADLINE_MS}ms. ${context}`);
    assert.equal(run.outcome.code, 0, `the planning launch exited non-zero. ${context}`);
  },
);

test(
  "argv: control - the same launch raises a permission_request for a tool that is not pre-approved, so an absence above means something",
  { skip: SKIP_REASON },
  async () => {
    const run = await runPlanningLaunch({
      prompt: "Run a shell command, then stop.",
      // `echo` is on the cli's own read-only allow-list and would not prompt; creating a file does.
      toolCalls: () => [{ name: "Bash", input: { command: "touch control.txt", description: "control" } }],
    });
    assert.ok(
      run.permissionRequests.some((p) => p.toolName === "Bash"),
      `Bash is not pre-approved under the planning argv, so the real cli must raise a permission_request for it; ` +
        `none arrived, which would make the no-request assertion above vacuous. ` +
        `requests=${JSON.stringify(run.permissionRequests)} exited=${run.outcome.exited} code=${run.outcome.code} stderr=${JSON.stringify(run.outcome.stderr.slice(0, 500))}`,
    );
  },
);
