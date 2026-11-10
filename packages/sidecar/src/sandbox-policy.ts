/**
 * A project's sandbox policy, and the check that it is in force before a session's first turn
 * (ADR 0040).
 *
 * The policy is the `sandbox` block of the project's own `.claude/settings.json`: a project needs
 * nothing Flywheel-specific to declare one, and one with none starts its sessions exactly as before.
 *
 * The check runs the REAL backend binary, with the session's own `--settings` file and working
 * directory, against a stub Messages API on a loopback port. The stub answers the first request with
 * one Bash call and the second with the end of the turn, so no model is involved, nothing is spent, and
 * the command is the command rather than something a model was asked to run. It writes one file inside
 * the working directory and one outside it. Sandbox on means the first exists and the second does not.
 *
 * BOTH FILES ARE THE ANSWER. Under a narrow allow rule (`Bash(touch *)`) with no sandbox at all, Claude
 * Code's permission layer refused the outside path and nothing was written (measured on 2.1.311), which
 * a check of the outside file alone reads as a sandbox that holds. So the check allows every Bash
 * command, and a run that wrote neither file proves nothing, and refuses.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

/** What a project's `.claude/settings.json` says about a sandbox. `broken` is a policy the backend
 * would drop without a word, which is the one case a session must not start from. */
export type SandboxPolicyRead =
  | { kind: "none" }
  | { kind: "declared"; sandbox: Record<string, unknown> }
  | { kind: "broken"; reason: string };

/** The result of {@link probeSandbox}: `ok`, or why the session must not start. */
export type SandboxProbeResult = { ok: true } | { ok: false; reason: string };

const POLICY_FILE = path.join(".claude", "settings.json");

/** The whole check, the backend's start included. It takes under a second; a hang refuses. */
const PROBE_DEADLINE_MS = 60_000;

/** The prompt the probe's backend is started with. The stub answers whatever it says. */
const PROBE_PROMPT = "the sandbox probe";

/** Environment that would send the probe's request somewhere other than the stub, or a credential to
 * it. The rest of the session's environment stays, so that the backend starts as it would. */
const PROBE_ENV_REMOVED = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the policy of the project at `worktreePath`. A settings file that does not parse has a policy
 * only if it mentions one: a broken file that never meant a sandbox is no reason to refuse a session,
 * and a broken one that did is the failure this exists for. `sandbox.enabled` absent or `false` is a
 * project that has not turned it on.
 */
export function readSandboxPolicy(worktreePath: string): SandboxPolicyRead {
  let text: string;
  try {
    text = fs.readFileSync(path.join(worktreePath, POLICY_FILE), "utf8");
  } catch {
    return { kind: "none" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return /sandbox/i.test(text)
      ? { kind: "broken", reason: `${POLICY_FILE} is not valid JSON (${String(err)})` }
      : { kind: "none" };
  }
  if (!isRecord(parsed) || !("sandbox" in parsed)) return { kind: "none" };
  const { sandbox } = parsed;
  if (!isRecord(sandbox)) return { kind: "broken", reason: `\`sandbox\` in ${POLICY_FILE} is not an object` };
  const { enabled } = sandbox;
  if (enabled === undefined || enabled === false) return { kind: "none" };
  if (enabled !== true) return { kind: "broken", reason: `\`sandbox.enabled\` in ${POLICY_FILE} is not a boolean` };
  return { kind: "declared", sandbox };
}

/** The block a session's `--settings` file carries: the project's own, with the allow-list strict.
 * `strictAllowlist` is honoured only outside a project file, so it can only come from here (ADR 0040). */
export function sessionSandboxBlock(sandbox: Record<string, unknown>): Record<string, unknown> {
  const network = isRecord(sandbox.network) ? sandbox.network : {};
  return { ...sandbox, network: { ...network, strictAllowlist: true } };
}

/** The argv of the probe's backend. `--bare` skips hooks and only reads ANTHROPIC_API_KEY as a login,
 * and measured against valid, mistyped and absent policies a bare session has the same sandbox as a
 * plain one. `--strict-mcp-config` keeps a repository's MCP servers from starting for it. */
export function buildProbeArgv(settingsPath: string): string[] {
  return [
    "-p",
    PROBE_PROMPT,
    "--bare",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--max-turns",
    "3",
    "--allowedTools",
    "Bash",
    "--settings",
    settingsPath,
  ];
}

/** One streamed Messages API turn: a single content block, then its stop reason. */
function streamedTurn(start: unknown, delta: unknown, stopReason: string): string {
  const message = {
    id: "msg_probe",
    type: "message",
    role: "assistant",
    model: "probe",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const events = [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: start },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/** The stub's answer to one request body: the Bash call, or, once a tool result has come back or for a
 * request that offers no Bash tool, the end of the turn. */
function stubAnswer(body: string, command: string): string {
  let tools: unknown;
  try {
    tools = (JSON.parse(body) as { tools?: unknown }).tools;
  } catch {
    tools = undefined;
  }
  const offersBash =
    Array.isArray(tools) && tools.some((tool) => isRecord(tool) && tool.name === "Bash");
  if (body.includes("tool_result") || !offersBash) {
    return streamedTurn({ type: "text", text: "" }, { type: "text_delta", text: "done" }, "end_turn");
  }
  return streamedTurn(
    { type: "tool_use", id: "toolu_probe", name: "Bash", input: {} },
    {
      type: "input_json_delta",
      partial_json: JSON.stringify({ command, description: PROBE_PROMPT }),
    },
    "tool_use",
  );
}

/** Start the stub on a free loopback port. Exported for the real-binary test of a whole session. */
export function startStubApi(command: string): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.method !== "POST") {
          response.writeHead(200, { "content-type": "application/json", connection: "close" });
          response.end("{}");
          return;
        }
        const answer = stubAnswer(Buffer.concat(chunks).toString("utf8"), command);
        response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
        response.end(answer);
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the stub API has no port"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** A path as one word of a POSIX shell command. */
function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Run `bin` to its end or the deadline, in its own process group so that a kill reaches everything it
 * started. Resolves with its stderr tail; never rejects. */
function runProbeBackend(
  bin: string,
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
): Promise<{ timedOut: boolean; tail: string }> {
  return new Promise((resolve) => {
    let tail = "";
    let timedOut = false;
    const child = spawn(bin, argv, { cwd, env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }, deadlineMs);
    child.stderr.on("data", (chunk: Buffer) => {
      tail = `${tail}${chunk.toString()}`.slice(-400);
    });
    const settle = (message?: string) => {
      clearTimeout(timer);
      resolve({ timedOut, tail: message ?? tail.trim() });
    };
    child.on("error", (err) => settle(String(err)));
    child.on("close", () => settle());
  });
}

/**
 * Whether a session started with `settingsPath` in `worktreePath` has its Bash tool sandboxed. See the
 * module doc. Nothing it creates outlives it, and no credential in `env` reaches the probe.
 */
export async function probeSandbox(options: {
  bin: string;
  worktreePath: string;
  settingsPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<SandboxProbeResult> {
  const deadlineMs = Number(process.env.FLYWHEEL_SANDBOX_PROBE_MS ?? PROBE_DEADLINE_MS);
  let inside: string | undefined;
  let outside: string | undefined;
  let server: Server | undefined;
  try {
    inside = fs.mkdtempSync(path.join(options.worktreePath, ".flywheel-sandbox-probe-"));
    // The home directory: a sandbox opens the working directory and the temporary directory for writes,
    // so a file there would land with the sandbox on.
    outside = fs.mkdtempSync(path.join(os.homedir(), ".flywheel-sandbox-probe-"));
    const ran = path.join(inside, "ran");
    const escaped = path.join(outside, "escaped");

    const stub = await startStubApi(`touch ${shellWord(ran)} ${shellWord(escaped)}`);
    server = stub.server;

    const env: NodeJS.ProcessEnv = {
      ...options.env,
      ANTHROPIC_API_KEY: "flywheel-probe-not-a-key",
      ANTHROPIC_BASE_URL: stub.baseUrl,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
    for (const name of PROBE_ENV_REMOVED) delete env[name];

    const { timedOut, tail } = await runProbeBackend(
      options.bin,
      buildProbeArgv(options.settingsPath),
      options.worktreePath,
      env,
      deadlineMs,
    );

    if (fs.existsSync(escaped)) {
      return {
        ok: false,
        reason:
          "the sandbox is not on: a Bash command wrote outside the working directory. The backend drops a settings file that fails validation and says nothing, so check the project's sandbox policy.",
      };
    }
    if (!fs.existsSync(ran)) {
      const said = timedOut ? `it was still running after ${deadlineMs} ms` : tail;
      return {
        ok: false,
        reason: `could not tell whether the sandbox is on: the check's Bash command never ran${said ? ` (${said})` : ""}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `could not check whether the sandbox is on: ${String(err)}` };
  } finally {
    server?.closeAllConnections();
    server?.close();
    for (const dir of [inside, outside]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
