#!/usr/bin/env node
/**
 * Phase 5, Plan 01, Task 2 — measures A2 and A3 (05-RESEARCH.md Assumptions Log, Architecture
 * Pattern 1) against the REAL installed `claude` binary:
 *
 *   A2 — does a `PreToolUse` matcher shaped `mcp__<server>__.*` actually intercept a tool call on
 *        a SECOND MCP server (not the shipped permission server the shim's own matcher already
 *        covers)?
 *   A3 — does a hook `deny` on an MCP tool call surface to the model as a recoverable refusal it
 *        can carry on past, or does it end the stream?
 *
 * A throwaway second MCP server (`flywheel-authoring-spike`, one no-op write-shaped tool
 * `propose_task_spike`, one negative-control read-shaped tool `read_epic_spike`) is stood up for
 * the duration of one real session, gated by a second `PreToolUse` entry ADDED to the existing
 * `matcher: "Bash"` entry — never replacing it, mirroring `writeHookSettings`'s own two-entry
 * shape (05-RESEARCH.md Pattern 1, Code Example 3).
 *
 * --self-test never spawns a child: it asserts the settings JSON shape only.
 * The real run spawns one live `claude` session and appends its findings to
 * 05-SPIKE-FINDINGS.md.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FINDINGS_PATH = path.join(
  REPO_ROOT,
  ".planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md",
);
const SIDECAR_ADAPTER_DIST = path.join(REPO_ROOT, "packages/sidecar/dist/claude-code-adapter.js");
const SIDECAR_HOOK_DIST = path.join(REPO_ROOT, "packages/sidecar/dist/pretooluse-hook.js");

const CLAUDE_BIN = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude";
const SPAWN_DEADLINE_MS = 90_000;

const SPIKE_SERVER_NAME = "flywheel-authoring-spike";
const PROPOSE_TOOL = "propose_task_spike";
const READ_TOOL = "read_epic_spike";
const STAGE_GATE_MATCHER = `mcp__${SPIKE_SERVER_NAME}__propose_.*`;
const DENY_REASON = "still in the challenge stage — no proposals yet";

/** Absolute paths into the SDK already vendored under `packages/sidecar/node_modules` — imported
 * by ABSOLUTE `file://` URL from the throwaway MCP server script this file writes into a scratch
 * dir, which deliberately sidesteps Node's ancestor-directory `node_modules` walk (the scratch
 * dir is not a descendant of `packages/sidecar/`, so a bare `import "@modelcontextprotocol/sdk"`
 * from inside it would not resolve) without vendoring a second copy of the SDK or checking in a
 * permanent second server file this plan's own `artifacts_produced` list does not name. */
const SDK_ROOT = path.join(REPO_ROOT, "packages/sidecar/node_modules/@modelcontextprotocol/sdk/dist/esm");

// ---------------------------------------------------------------------------------------------
// settings construction — pure, no I/O, so --self-test can assert it without touching disk
// ---------------------------------------------------------------------------------------------

/** The EXISTING `Bash` entry, byte-identical to `writeHookSettings`'s own shape
 * (`claude-code-adapter.ts:142-150`) — reproduced here as a pure function of `hookScriptPath` so
 * both --self-test (which imports the real compiled path function) and the real run (same) can
 * assert/construct this identically. */
function bashHookEntry(hookScriptPath) {
  return {
    matcher: "Bash",
    hooks: [{ type: "command", command: `${process.execPath} ${hookScriptPath}` }],
  };
}

function stageGateHookEntry(stageGateHookScriptPath) {
  return {
    matcher: STAGE_GATE_MATCHER,
    hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath}` }],
  };
}

/** Build the FULL two-entry `--settings` JSON object this spike installs — the existing `Bash`
 * entry UNCHANGED, plus the new authoring-server-scoped matcher (05-RESEARCH.md Pattern 1). */
export function buildSpikeSettings(bashHookScriptPath, stageGateHookScriptPath) {
  return {
    hooks: {
      PreToolUse: [bashHookEntry(bashHookScriptPath), stageGateHookEntry(stageGateHookScriptPath)],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// self-test — no child process, ever
// ---------------------------------------------------------------------------------------------

async function selfTest() {
  let failures = 0;
  const check = (label, fn) => {
    try {
      fn();
      console.log(`[self-test] PASS — ${label}`);
    } catch (err) {
      failures += 1;
      console.error(`[self-test] FAIL — ${label}: ${err?.message ?? err}`);
    }
  };

  const settings = buildSpikeSettings("/fake/pretooluse-hook.js", "/fake/stage-gate-hook.mjs");

  check("settings JSON has exactly two PreToolUse entries", () => {
    assert.equal(settings.hooks.PreToolUse.length, 2);
  });

  if (fs.existsSync(SIDECAR_ADAPTER_DIST)) {
    let expectedBashPath;
    try {
      const adapter = await import(pathToFileURL(SIDECAR_ADAPTER_DIST).href);
      expectedBashPath = adapter.pretoolUseHookScriptPath();
    } catch (err) {
      console.log(`[self-test] SKIP — could not import compiled adapter: ${err?.message ?? err}`);
    }
    if (expectedBashPath) {
      check("the first entry is byte-identical to writeHookSettings's own Bash entry", () => {
        const realShape = bashHookEntry(expectedBashPath);
        const spikeShape = buildSpikeSettings(expectedBashPath, "/fake/stage-gate-hook.mjs").hooks.PreToolUse[0];
        assert.deepEqual(spikeShape, realShape);
      });
    }
  } else {
    console.log(
      "[self-test] SKIP — first-entry byte-identity check: packages/sidecar/dist/claude-code-adapter.js " +
        "not built (run `npm --prefix packages/sidecar run build`)",
    );
  }

  check("the second entry's matcher compiles as a regular expression", () => {
    // Throws SyntaxError on an invalid pattern — the assertion itself IS the compile attempt.
    new RegExp(settings.hooks.PreToolUse[1].matcher);
  });

  check("the second entry's matcher matches the spike server's write-shaped tool name", () => {
    const re = new RegExp(settings.hooks.PreToolUse[1].matcher);
    assert.ok(re.test(`mcp__${SPIKE_SERVER_NAME}__${PROPOSE_TOOL}`));
  });

  check("the second entry's matcher does NOT match the spike server's read-shaped (negative control) tool name", () => {
    const re = new RegExp(settings.hooks.PreToolUse[1].matcher);
    assert.equal(re.test(`mcp__${SPIKE_SERVER_NAME}__${READ_TOOL}`), false);
  });

  check("positive match and negative-control non-match both hold together", () => {
    const re = new RegExp(settings.hooks.PreToolUse[1].matcher);
    assert.ok(re.test(`mcp__${SPIKE_SERVER_NAME}__${PROPOSE_TOOL}`) && !re.test(`mcp__${SPIKE_SERVER_NAME}__${READ_TOOL}`));
  });

  if (failures > 0) {
    console.error(`[self-test] ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("[self-test] all assertions passed — no child process was spawned");
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// real-binary measurement — throwaway MCP server + throwaway deny-always hook
// ---------------------------------------------------------------------------------------------

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-stage-gate-spike-"));
}

function fileUrl(p) {
  return pathToFileURL(p).href;
}

/**
 * Write the throwaway spike MCP server script (standalone stdio process the backend spawns per
 * `--mcp-config`) into `dir`. It has NO write-shaped tool that does anything real — `propose_task_
 * spike` is a no-op that records its own invocation to `invocationsPath` and returns a trivial
 * success; `read_epic_spike` (the negative control, T-05-01-05: this server "holds no database
 * handle and opens no socket to the Rust core") does the same, distinguishable only by which tool
 * name was recorded.
 */
function writeSpikeMcpServer(dir, invocationsPath) {
  const serverPath = path.join(dir, "spike-mcp-server.mjs");
  const code = `
import fs from "node:fs";
import { Server } from ${JSON.stringify(fileUrl(path.join(SDK_ROOT, "server/index.js")))};
import { StdioServerTransport } from ${JSON.stringify(fileUrl(path.join(SDK_ROOT, "server/stdio.js")))};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(fileUrl(path.join(SDK_ROOT, "types.js")))};

const INVOCATIONS_PATH = ${JSON.stringify(invocationsPath)};

function recordInvocation(tool) {
  fs.appendFileSync(INVOCATIONS_PATH, JSON.stringify({ tool, at: new Date().toISOString() }) + "\\n");
}

const server = new Server({ name: ${JSON.stringify(SPIKE_SERVER_NAME)}, version: "0.0.0-spike" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: ${JSON.stringify(PROPOSE_TOOL)},
      description: "SPIKE FIXTURE — no-op. Records that it was called and returns a trivial success.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: ${JSON.stringify(READ_TOOL)},
      description: "SPIKE FIXTURE — negative control. No-op read; records that it was called.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === ${JSON.stringify(PROPOSE_TOOL)}) {
    recordInvocation(${JSON.stringify(PROPOSE_TOOL)});
    return { content: [{ type: "text", text: "spike: propose_task_spike recorded (this should not happen while the stage gate denies it)" }] };
  }
  if (request.params.name === ${JSON.stringify(READ_TOOL)}) {
    recordInvocation(${JSON.stringify(READ_TOOL)});
    return { content: [{ type: "text", text: "spike: read_epic_spike executed normally (negative control)" }] };
  }
  throw new Error("unknown spike tool: " + request.params.name);
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;
  fs.writeFileSync(serverPath, code);
  return serverPath;
}

/**
 * Write the throwaway stage-gate hook script: unconditionally denies with {@link DENY_REASON},
 * and — BEFORE deciding — appends a marker line to `markerPath` naming which tool it was invoked
 * for, so A2 can distinguish "the hook ran for propose_task_spike" from "the hook ran for
 * read_epic_spike" (it must never run for the latter — that IS the negative control).
 */
function writeStageGateHook(dir, markerPath) {
  const hookPath = path.join(dir, "stage-gate-hook.mjs");
  const code = `
import fs from "node:fs";
const MARKER_PATH = ${JSON.stringify(markerPath)};

let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  let toolName = "unknown";
  try {
    const payload = JSON.parse(data);
    toolName = payload?.tool_name ?? payload?.toolName ?? "unknown";
  } catch {
    // best-effort only — the marker write below still proves the hook ran
  }
  fs.appendFileSync(MARKER_PATH, JSON.stringify({ tool: toolName, at: new Date().toISOString() }) + "\\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ${JSON.stringify(DENY_REASON)},
    },
  }));
  process.exit(2);
});
`;
  fs.writeFileSync(hookPath, code);
  return hookPath;
}

async function resolveBashHookScriptPath() {
  if (!fs.existsSync(SIDECAR_ADAPTER_DIST)) {
    throw new Error(
      "packages/sidecar/dist/claude-code-adapter.js is not built — run `npm --prefix packages/sidecar run build` first",
    );
  }
  const adapter = await import(pathToFileURL(SIDECAR_ADAPTER_DIST).href);
  return adapter.pretoolUseHookScriptPath();
}

function runClaudeTurn(argv, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const rl = createInterface({ input: child.stdout });
    const lines = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve({ exited: false, lines, resultEvent: undefined });
    }, SPAWN_DEADLINE_MS);
    rl.on("line", (line) => {
      lines.push(line);
    });
    let resultEvent;
    rl.on("line", (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "result") resultEvent = parsed;
      } catch {
        // non-JSON line — ignored
      }
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exited: true, lines, resultEvent });
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exited: true, lines, resultEvent: undefined });
    });
  });
}

/** The last assistant `text` block across every captured line — the "quoted model response" the
 * plan asks the findings document to carry verbatim. */
function lastAssistantText(lines) {
  let last;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "assistant" || parsed.type === "user") {
        const content = parsed.message?.content ?? [];
        const text = content.find((b) => b.type === "text")?.text;
        if (typeof text === "string" && text.length > 0) last = text;
      }
    } catch {
      // non-JSON line — ignored
    }
  }
  return last;
}

function readInvocationCount(invocationsPath, toolName) {
  if (!fs.existsSync(invocationsPath)) return 0;
  const contents = fs.readFileSync(invocationsPath, "utf8");
  return contents
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.tool === toolName).length;
}

function readHookFiredFor(markerPath, toolName) {
  if (!fs.existsSync(markerPath)) return false;
  const contents = fs.readFileSync(markerPath, "utf8");
  return contents
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .some((l) => {
      try {
        return JSON.parse(l).tool === toolName;
      } catch {
        return false;
      }
    });
}

async function runRealMeasurement() {
  const dir = scratchDir();
  const invocationsPath = path.join(dir, "handler-invocations.jsonl");
  const hookMarkerPath = path.join(dir, "hook-fired.jsonl");

  const serverPath = writeSpikeMcpServer(dir, invocationsPath);
  const hookPath = writeStageGateHook(dir, hookMarkerPath);
  const bashHookScriptPath = await resolveBashHookScriptPath();

  const settings = buildSpikeSettings(bashHookScriptPath, hookPath);
  const settingsPath = path.join(dir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(settings));

  const mcpConfigPath = path.join(dir, "mcp-config.json");
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        [SPIKE_SERVER_NAME]: { command: process.execPath, args: [serverPath] },
      },
    }),
  );

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^CLAUDE/i.test(key) || /^ANTHROPIC/i.test(key)) delete env[key];
  }

  const prompt =
    `You have two MCP tools available on the "${SPIKE_SERVER_NAME}" server: "${READ_TOOL}" and ` +
    `"${PROPOSE_TOOL}". Call ${READ_TOOL} first with no arguments. Then call ${PROPOSE_TOOL} with ` +
    `no arguments. After both calls (whether they succeeded or were denied), reply with one short ` +
    `sentence describing what happened with each call.`;

  const argv = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--mcp-config",
    mcpConfigPath,
    "--settings",
    settingsPath,
  ];

  console.log("spawning one real claude session for the stage-gate measurement...");
  const outcome = await runClaudeTurn(argv, { cwd: dir, env });

  // MEASURED: the hook's own stdin payload carries the FULLY QUALIFIED tool name
  // (`mcp__<server>__<tool>`), not the bare tool id — confirmed live against the real 2.1.267
  // binary (a first version of this script compared against the bare id and silently
  // misclassified a genuine interception as "does-not-intercept", because the marker it wrote
  // never matched what this function was looking for). The tool HANDLER'S OWN invocation record
  // (written by the spike MCP server itself, in `writeSpikeMcpServer` above) uses the bare id,
  // since that is the name the server's own `CallToolRequestSchema` handler receives — the two
  // marker files are intentionally keyed differently, matching what each side actually observes.
  const hookFiredForPropose = readHookFiredFor(hookMarkerPath, `mcp__${SPIKE_SERVER_NAME}__${PROPOSE_TOOL}`);
  const hookFiredForRead = readHookFiredFor(hookMarkerPath, `mcp__${SPIKE_SERVER_NAME}__${READ_TOOL}`);
  const proposeHandlerRan = readInvocationCount(invocationsPath, PROPOSE_TOOL) > 0;
  const readHandlerRan = readInvocationCount(invocationsPath, READ_TOOL) > 0;

  // A2: the gate holds ONLY if the hook ran for the matched tool AND the tool handler itself was
  // never reached — either fact alone is not proof (the hook could fire and the CLI still call
  // the tool anyway on some other code path; the handler could simply never have been asked).
  const stageGateMatcher = hookFiredForPropose && !proposeHandlerRan ? "intercepts" : "does-not-intercept";

  // A3: the session is "recoverable" if it reached a terminal `result` event after the denial —
  // i.e. the CLI's own turn completed rather than the process erroring out mid-flight.
  const denialOutcome = outcome.exited && outcome.resultEvent !== undefined ? "recoverable" : "ends-session";

  const modelResponse = lastAssistantText(outcome.lines) ?? "(no assistant text captured)";

  if (process.env.FLYWHEEL_SPIKE_DEBUG === "1") {
    console.error("[debug] hookMarkerPath contents:", fs.existsSync(hookMarkerPath) ? fs.readFileSync(hookMarkerPath, "utf8") : "(absent)");
    console.error("[debug] invocationsPath contents:", fs.existsSync(invocationsPath) ? fs.readFileSync(invocationsPath, "utf8") : "(absent)");
  }

  if (process.env.FLYWHEEL_SPIKE_KEEP_SCRATCH === "1") {
    console.error(`[debug] keeping scratch dir: ${dir}`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return {
    stageGateMatcher,
    denialOutcome,
    modelResponse,
    hookFiredForPropose,
    hookFiredForRead,
    proposeHandlerRan,
    readHandlerRan,
    negativeControlHeld: readHandlerRan && !hookFiredForRead,
    exited: outcome.exited,
  };
}

// ---------------------------------------------------------------------------------------------
// findings document
// ---------------------------------------------------------------------------------------------

function upsertLine(content, keyRegex, newLine) {
  if (keyRegex.test(content)) return content.replace(keyRegex, newLine);
  const trimmed = content.replace(/\n+$/, "");
  return `${trimmed}\n${newLine}\n`;
}

function upsertSection(content, startMarker, endMarker, body) {
  const block = `${startMarker}\n${body}\n${endMarker}`;
  const pattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`);
  if (pattern.test(content)) return content.replace(pattern, block);
  const trimmed = content.replace(/\n+$/, "");
  return `${trimmed}\n\n${block}\n`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeFindings(result) {
  let content = fs.existsSync(FINDINGS_PATH)
    ? fs.readFileSync(FINDINGS_PATH, "utf8")
    : "# Phase 5 Plan 01: Spike Findings\n";

  content = upsertLine(content, /^stage_gate_matcher: .*$/m, `stage_gate_matcher: ${result.stageGateMatcher}`);
  content = upsertLine(content, /^denial_outcome: .*$/m, `denial_outcome: ${result.denialOutcome}`);

  content = upsertSection(
    content,
    "<!-- stage-gate-measurement:start -->",
    "<!-- stage-gate-measurement:end -->",
    [
      "## Stage Gate Measurement (A2/A3)",
      "",
      `- **A2 (matcher interception):** \`${result.stageGateMatcher}\` — hook fired for ${PROPOSE_TOOL}: ${result.hookFiredForPropose}; ${PROPOSE_TOOL} handler itself ran: ${result.proposeHandlerRan}.`,
      `- **A3 (denial recoverability):** \`${result.denialOutcome}\` — session ${result.exited ? "exited normally with a terminal result event" : "did NOT exit normally / no terminal result event was observed"}.`,
      `- **Negative control (${READ_TOOL}, does not match the stage-gate matcher):** ${result.negativeControlHeld ? "HELD — executed normally, hook never fired for it" : "DID NOT HOLD — see raw facts below"} (hook fired for ${READ_TOOL}: ${result.hookFiredForRead}; ${READ_TOOL} handler ran: ${result.readHandlerRan}).`,
      "- **Quoted model response (verbatim):**",
      "",
      "  > " + result.modelResponse.replace(/\n/g, "\n  > "),
      "",
      result.stageGateMatcher === "does-not-intercept"
        ? "**D-88 has no enforcement point at the hook layer for this matcher shape.** Plan 05-03 must fall back to gating inside the tool handler itself — the mechanism `05-CONTEXT.md` D-88 explicitly rejected as a *substitute* for absence, which becomes the only remaining option here."
        : "The hook mechanism is a real enforcement point for a second MCP server's tool names — plan 05-03 can build D-88's stage gate on it directly.",
    ].join("\n"),
  );

  fs.writeFileSync(FINDINGS_PATH, content);
  console.log(`wrote measurement to ${FINDINGS_PATH}`);
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await selfTest();
    return;
  }

  const probe = spawnSync(CLAUDE_BIN, ["--version"], { stdio: ["ignore", "ignore", "ignore"], timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    console.error(`the real claude binary ("${CLAUDE_BIN}") is not available — cannot run a real-binary measurement`);
    process.exit(1);
  }

  const result = await runRealMeasurement();
  writeFindings(result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
