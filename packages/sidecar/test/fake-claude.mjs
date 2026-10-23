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
 * `FLYWHEEL_FAKE_PERMISSION_CALL=<json {tool_name, input}>` replaces the default Bash call (issue
 * #100 sends an `AskUserQuestion` this way), and the line carries the whole `response` too.
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
 * **Commits** are a step of the scripted board-call mode below (`{ commit: { path, content } }`, issue
 * #169), interleaved with board calls as an agent works. The old `FLYWHEEL_FAKE_COMMIT_FILE` mode, which
 * matched the fan-out dispatcher's commit instruction, went with that instruction and is retired.
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
      arguments: process.env.FLYWHEEL_FAKE_PERMISSION_CALL
        ? JSON.parse(process.env.FLYWHEEL_FAKE_PERMISSION_CALL)
        : { tool_name: "Bash", input: { command: `echo ${label}` } },
    });
    const text = result.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    printLine({ type: "permission_tool_result", label, behavior: parsed.behavior, response: parsed });
  } finally {
    await client.close();
  }
}

/** Task-tool mode (`FLYWHEEL_FAKE_CALL_TASK_TOOL=<json {name, arguments}>`, issue #52): connect to
 * the session's MCP server the same way, print the tool names it lists as a `task_tools_listed`
 * line, call the named Task tool once, and print its outcome as a `task_tool_result` line. */
async function callTaskToolOnce(toolCall) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  // The session's one server, whether or not it is also wired as the permission prompt: a shaping
  // session (issue #122) gets `--mcp-config` alone.
  const mcpConfig = JSON.parse(readFlag("--mcp-config"));
  const [serverName] = Object.keys(mcpConfig.mcpServers);
  const serverConfig = mcpConfig.mcpServers[serverName];

  const transport = new StdioClientTransport({ command: serverConfig.command, args: serverConfig.args });
  const client = new Client({ name: "fake-claude", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    printLine({ type: "task_tools_listed", names: listed.tools.map((t) => t.name) });
    const result = await client.callTool({ name: toolCall.name, arguments: toolCall.arguments });
    printLine({ type: "task_tool_result", isError: result.isError === true, text: result.content?.[0]?.text ?? "" });
  } finally {
    await client.close();
  }
}

/**
 * A board script's `commit` step (`{ commit: { path, content } }`, issue #169): write `content` at `path`
 * in this process's working directory (the session's worktree), then `git add` and `git commit` it. Run
 * through the session's `PATH`, so both commands pass the real PATH shim. Prints a `fake_commit` line with
 * the new HEAD, or `fake_commit_failed` with git's stderr.
 */
function commitFile({ path: file, content }) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content);
  // Identity through the environment, not `git -c ...`: the PATH shim classifies a git command line
  // that opens with global options as uncategorised and raises a permission request for it, so the
  // plain `git add` / `git commit` below is also what a real agent runs.
  const identity = { GIT_AUTHOR_NAME: "Fake Agent", GIT_AUTHOR_EMAIL: "fake@flywheel.test", GIT_COMMITTER_NAME: "Fake Agent", GIT_COMMITTER_EMAIL: "fake@flywheel.test" };
  const git = (...args) => spawnSync("git", args, { encoding: "utf8", env: { ...process.env, ...identity } });
  const steps = [git("add", "--", file), git("commit", "-m", `agent work: ${file}`)];
  const failed = steps.find((r) => r.status !== 0);
  if (failed) {
    printLine({ type: "fake_commit_failed", path: file, stderr: failed.stderr.trim() });
  } else {
    printLine({ type: "fake_commit", path: file, head: git("log", "-1", "--format=%H").stdout.trim() });
  }
}

/**
 * Scripted board-call mode (`FLYWHEEL_FAKE_BOARD_CALLS=<json [{name, arguments, when?, unless?}]>`,
 * issue #134's offline UAT): a scripted agent that reads its own `-p` packet and makes board calls in
 * order over ONE connection to the session's MCP server, each awaited, so a held call (`round_wait`)
 * holds the script until the core answers it. A step runs only when its `when` regex matches the
 * packet and its `unless` regex does not, so one script can answer differently to different packets.
 * In any string argument, `{{prompt:<regex>}}` is replaced by that regex's first capture group in the
 * packet (a step whose placeholder does not match fails loudly as `board_call_unresolved`), and
 * `{{result:<tool>:<field>}}` by that field of the JSON the latest successful call to `<tool>` in this
 * session answered with (issue #130: the second `propose_story` names the first one's `proposal_id` in
 * `runs_after`, as an agent reads it off the first call's answer); a dotted `<field>` reads into the answer
 * (`{{result:task_add:tasks.0.task_id}}`). Each call prints a `board_call_result` line
 * `{name, isError, text}`; a skipped step prints `board_call_skipped`. A `{ commit: { path, content } }`
 * step, under the same `when`/`unless`, commits a file between two calls (`commitFile`, issue #169).
 */
async function runBoardScript(steps) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const prompt = readFlag("-p") ?? "";
  const mcpConfig = JSON.parse(readFlag("--mcp-config"));
  const [serverName] = Object.keys(mcpConfig.mcpServers);
  const serverConfig = mcpConfig.mcpServers[serverName];
  const transport = new StdioClientTransport({ command: serverConfig.command, args: serverConfig.args });
  const client = new Client({ name: "fake-claude", version: "0.1.0" });
  await client.connect(transport);
  /** The latest successful answer of each tool, parsed. */
  const answers = new Map();
  const resolve = (value) => {
    if (typeof value === "string") {
      return value
        .replace(/\{\{prompt:(.+?)\}\}/g, (_, source) => {
          const match = prompt.match(new RegExp(source));
          if (!match) throw new Error(`no match for ${source}`);
          return match[1];
        })
        .replace(/\{\{result:([a-z_]+):([a-z0-9_.]+)\}\}/g, (_, tool, field) => {
          // A dotted path reads into the answer: `tasks.0.task_id` is the first Task's id.
          const found = field.split(".").reduce((at, key) => at?.[key], answers.get(tool));
          if (typeof found !== "string") throw new Error(`no ${field} in an answer to ${tool}`);
          return found;
        });
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    return value;
  };
  try {
    for (const step of steps) {
      if ((step.when && !new RegExp(step.when).test(prompt)) || (step.unless && new RegExp(step.unless).test(prompt))) {
        printLine({ type: "board_call_skipped", name: step.name ?? "commit" });
        continue;
      }
      if (step.commit) {
        commitFile(step.commit);
        continue;
      }
      let args;
      try {
        args = resolve(step.arguments ?? {});
      } catch (err) {
        printLine({ type: "board_call_unresolved", name: step.name, error: String(err) });
        continue;
      }
      // A held call waits on the developer: no client-side deadline cuts it short.
      const result = await client.callTool({ name: step.name, arguments: args }, undefined, { timeout: 600_000 });
      const text = result.content?.[0]?.text ?? "";
      if (result.isError !== true) {
        try {
          answers.set(step.name, JSON.parse(text));
        } catch {
          // A plain-text answer names nothing a later step can read.
        }
      }
      printLine({ type: "board_call_result", name: step.name, isError: result.isError === true, text });
    }
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

// Argv-echo mode (`FLYWHEEL_FAKE_ECHO_ARGV=1`, issue #122): print the flags the adapter built, so a
// test can assert what a session of each kind is wired to.
if (process.env.FLYWHEEL_FAKE_ECHO_ARGV === "1") {
  printLine({ type: "argv_seen", argv: process.argv.slice(2) });
}

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

if (process.env.FLYWHEEL_FAKE_CALL_TASK_TOOL) {
  await callTaskToolOnce(JSON.parse(process.env.FLYWHEEL_FAKE_CALL_TASK_TOOL));
}

if (process.env.FLYWHEEL_FAKE_BOARD_CALLS) {
  await runBoardScript(JSON.parse(process.env.FLYWHEEL_FAKE_BOARD_CALLS));
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
