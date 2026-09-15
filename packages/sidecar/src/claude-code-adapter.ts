/**
 * AGNT-02 — the Claude Code adapter: spawns the user's own `claude` binary and normalises its
 * `stream-json` output into {@link AgentEvent}s.
 *
 * AGNT-03: this adapter never requests `--bare` mode on either credential path — bare mode also
 * disables the project's own instructions and skills the agent needs (02-RESEARCH.md "The
 * sidecar-shape decision"). The local-credential path works by NOT setting `--bare` and inheriting
 * the environment the user's own `claude login` session lives in; Flywheel never reads, replays or
 * stores that OAuth token itself.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  type AdapterCapabilities,
  type AgentAdapter,
  type AgentEvent,
  CapabilityUnsupportedError,
  defaultResumeSession,
  type StartSessionOptions,
  UnknownRunError,
} from "./adapter.js";
import {
  MCP_SERVER_NAME,
  PERMISSION_TOOL_NAME,
  startPermissionServer,
  type PermissionNoticePayload,
  type PermissionServerHandle,
} from "./mcp-permission-server.js";

/** The binary name/path this adapter spawns — overridable via `FLYWHEEL_CLAUDE_BIN` so tests can
 * point it at `test/fake-claude.mjs` instead of the real CLI. Never a credential. */
export function resolveClaudeBin(): string {
  return process.env.FLYWHEEL_CLAUDE_BIN ?? "claude";
}

/**
 * Ask whether the backend binary [`resolveClaudeBin`] would spawn is resolvable, and its
 * reported version (D-39, plan 02-09 Task 3). Read-only: spawns `<bin> --version`, never a real
 * session, and never touches a credential. Resolves `{ available: false }` — never rejects — when
 * the binary cannot be found or exits non-zero, so a missing backend degrades the product rather
 * than surfacing as an error (02-RESEARCH.md's Environment Availability fallback note; the
 * adapter's own capability-probe pattern).
 */
export function probeClaudeBinary(): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const bin = resolveClaudeBin();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve({ available: false });
      return;
    }

    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve({ available: false }));
    child.on("close", (code) => {
      if (code === 0) {
        const version = output.trim();
        resolve({ available: true, version: version.length > 0 ? version : undefined });
      } else {
        resolve({ available: false });
      }
    });
  });
}

/** The compiled standalone permission-server script's absolute path — resolved relative to THIS
 * compiled module's own location (`dist/claude-code-adapter.js` -> `dist/mcp-permission-server.js`),
 * never from `process.cwd()` (PROC-02's own "no implicit cwd" discipline, applied here to a
 * sibling-file lookup rather than a git operation). */
export function permissionServerScriptPath(): string {
  return fileURLToPath(new URL("./mcp-permission-server.js", import.meta.url));
}

/** The compiled standalone watchdog wrapper's absolute path (plan 03-02, D-47) — resolved
 * relative to THIS compiled module's own location, identically to
 * [`permissionServerScriptPath`]'s own sibling-file lookup, never from `process.cwd()`. Every
 * session is spawned through this wrapper rather than directly, so it becomes the session's own
 * process-group leader and the backend binary becomes its child inside that same group (see the
 * spawn call in {@link ClaudeCodeAdapter.startSession} and `watchdog.ts`'s own module doc). */
export function watchdogEntryPath(): string {
  return fileURLToPath(new URL("./watchdog.js", import.meta.url));
}

/** The compiled standalone `PreToolUse` hook script's absolute path (plan 03-07, D-55) — resolved
 * relative to THIS compiled module's own location, the same sibling-file idiom
 * [`permissionServerScriptPath`]/[`watchdogEntryPath`] already use. */
export function pretoolUseHookScriptPath(): string {
  return fileURLToPath(new URL("./pretooluse-hook.js", import.meta.url));
}

/** Where a per-run `--settings` JSON injecting the `PreToolUse` hook is written (plan 03-07):
 * `<runtimeDir>/settings/<runId>.json`, alongside `runtime_protocol.rs`'s own per-run file
 * conventions (`runs/<runId>.json`, `shim/<runId>/`). */
function permissionSettingsPath(runtimeDir: string, runId: string): string {
  return path.join(runtimeDir, "settings", `${runId}.json`);
}

/** Derive `FLYWHEEL_SHIM_BIN` (plan 03-07) — the absolute path `pretooluse-hook.ts` shells out to
 * in `--classify-command` mode — from the FIRST `PATH` segment `flywheel_core::shim::
 * shim_env_for_run` already prefixed onto this spawn's environment (D-51). That directory holds a
 * hard-linked/copied entry named `git`/`git.exe`, which IS the compiled shim binary — invoking it
 * with `--classify-command` never dispatches through the `argv[0]`-stem match at all (checked
 * first in `packages/shim/src/main.rs::main`), so this entry works identically to any other copy
 * of the same binary. Deliberately reads the value back rather than re-resolving a second,
 * independently-computed path to the same binary. Returns `undefined` — never throws — when `PATH`
 * carries no shim prefix or the derived candidate does not exist on disk (a session spawned
 * without the D-51 shim installed, e.g. some unit tests): the hook itself fails closed on a
 * missing `FLYWHEEL_SHIM_BIN`, so an absent value here is a safe degradation, never a silent
 * bypass of the destructive-action gate. */
function shimBinFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH;
  if (!pathValue) return undefined;
  const firstSegment = pathValue.split(path.delimiter)[0];
  if (!firstSegment) return undefined;
  const entryName = process.platform === "win32" ? "git.exe" : "git";
  const candidate = path.join(firstSegment, entryName);
  return fs.existsSync(candidate) ? candidate : undefined;
}

/** Write `<runtimeDir>/settings/<runId>.json` — the exact `PreToolUse`/`matcher: "Bash"` shape
 * RESEARCH.md confirmed working live against the real `claude` binary this session (§ "The hook
 * mechanism verified working this session") — and return its path. A write failure here degrades
 * to "no hook injected for this session" (logged, never thrown): the shim (D-51/D-58) is the
 * load-bearing guarantee: `startSession` must not refuse an entire session over this
 * defense-in-depth layer failing to write one file. */
function writeHookSettings(runtimeDir: string, runId: string): string | undefined {
  try {
    const settingsPath = permissionSettingsPath(runtimeDir, runId);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) {
    console.error(`flywheel sidecar: failed to write PreToolUse hook settings for ${runId}: ${String(err)}`);
    return undefined;
  }
}

/** Best-effort OS-sourced process start time, in epoch milliseconds, for a pid this adapter just
 * spawned (PROC-03 pid-reuse safety, plan 03-06 consumes it). Shells out to `ps -o lstart=`,
 * mirroring `watchdog.ts`'s own identical helper — duplicated rather than imported, since
 * `watchdog.ts` is a standalone entry point (`main()` runs unconditionally on load) and must
 * never be imported as a library into this process. Falls back to the current time if `ps` is
 * unavailable or its output does not parse; a start-time lookup failing must never abort a
 * session that otherwise spawned successfully. */
function readOsProcessStartTimeMs(pid: number): number {
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    const parsed = Date.parse(output);
    if (!Number.isNaN(parsed)) return parsed;
  } catch {
    // Fall through to the timestamp-at-spawn-time fallback below.
  }
  return Date.now();
}

/** Write `<runtime>/runs/<runId>.json` (PROC-03) recording the WATCHDOG wrapper's own pid — the
 * process-group leader `interruptSession`/`killSession` already signal via `-child.pid` — and its
 * OS-reported start time, immediately after {@link ClaudeCodeAdapter.startSession} spawns it.
 * Field names are plain `snake_case`, matching `packages/core/src/runtime_protocol.rs`'s
 * `RunDescriptor` shape byte-for-byte (both sides agree by convention, never a shared
 * serializer). A write failure is logged and swallowed — a descriptor-write failure must not
 * abort a session that is otherwise fine. */
function writeRunDescriptor(runtimeDir: string, runId: string, wrapperPid: number): void {
  try {
    const descriptorPath = path.join(runtimeDir, "runs", `${runId}.json`);
    fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
    fs.writeFileSync(
      descriptorPath,
      JSON.stringify({
        run_id: runId,
        pid: wrapperPid,
        start_time: readOsProcessStartTimeMs(wrapperPid),
        started_at: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error(`flywheel sidecar: failed to write run descriptor for ${runId}: ${String(err)}`);
  }
}

/**
 * Build the exact argv `claude` is invoked with. Pure function — no spawning, no environment
 * access — so it is unit-testable without a child process. Never places a credential in the
 * array: credentials only ever reach the child through its `env` (T-02-01).
 *
 * `permissionPromptToolName`/`mcpConfig` are appended together, or not at all — AGNT-06's
 * blocking permission gate (`--permission-prompt-tool` + `--mcp-config` naming exactly one
 * server, supplied explicitly on the command line rather than discovered from the worktree's own
 * configuration, T-02-02). Both are optional purely so this function's own unit tests (and any
 * future adapter that does not yet wire the gate) can call it with the bare two fields.
 *
 * `settingsPath` (plan 03-07, D-55) is independently optional — it injects the `PreToolUse` hook
 * settings file `writeHookSettings` wrote, via the CLI's own `--settings <file>` flag (RESEARCH.md
 * "The hook mechanism verified working this session"). Appended on its own, never paired with
 * anything else, so a caller that has a permission-prompt-tool pair but no settings file (or vice
 * versa) still gets a valid argv.
 */
export function buildClaudeArgv(options: {
  prompt: string;
  permissionMode: string;
  permissionPromptToolName?: string;
  mcpConfig?: string;
  settingsPath?: string;
}): string[] {
  const argv = [
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    // MANDATORY alongside `-p --output-format stream-json` — not a debugging nicety (G-02-2).
    // Claude Code rejects the combination at argument validation with "When using --print,
    // --output-format=stream-json requires --verbose", exits 1 before emitting a single line,
    // and writes that reason to stderr, which this adapter does not read. The result was a
    // session that closed instantly with a bare `session_closed: failed` and no diagnosis.
    // Verified against claude 2.1.236: identical argv fails exit 1 without this flag and
    // streams stream-json with it.
    "--verbose",
    "--permission-mode",
    options.permissionMode,
  ];
  if (options.permissionPromptToolName && options.mcpConfig) {
    argv.push("--permission-prompt-tool", options.permissionPromptToolName, "--mcp-config", options.mcpConfig);
  }
  if (options.settingsPath) {
    argv.push("--settings", options.settingsPath);
  }
  return argv;
}

interface ClaudeStreamInit {
  type: "system";
  subtype: "init";
  session_id: string;
  model?: string;
}

interface ClaudeStreamMessage {
  type: "assistant" | "user";
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
}

/** The real CLI's usage block, measured live against claude 2.1.236 during G-02-4's planning
 * (`## Ground truth captured during planning`): a single trivial turn reported `input_tokens` 2,
 * `cache_creation_input_tokens` 17080, `cache_read_input_tokens` 16016, `output_tokens` 4. Each
 * field is optional and independently absent-or-present — a malformed or partial usage block must
 * degrade to "no count" for the fields it lacks, never to a fabricated zero. */
interface ClaudeStreamUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface ClaudeStreamResult {
  type: "result";
  subtype: string;
  total_cost_usd?: number;
  session_id?: string;
  usage?: ClaudeStreamUsage;
}

type ClaudeStreamEvent = ClaudeStreamInit | ClaudeStreamMessage | ClaudeStreamResult | Record<string, unknown>;

/** Read one optional numeric field out of a usage-shaped object, returning `undefined` for a
 * missing or non-numeric value rather than coercing it to zero — used four times over
 * {@link ClaudeStreamUsage}'s fields so a malformed usage block degrades to "no count" per field,
 * never to a fabricated zero (G-02-4). */
function optionalUsageNumber(usage: ClaudeStreamUsage | undefined, field: keyof ClaudeStreamUsage): number | undefined {
  const value = usage?.[field];
  return typeof value === "number" ? value : undefined;
}

/** Sum the three input-side usage fields into the one figure `agent_runs.tokens_in` records
 * (G-02-4's "Token accounting decision"). MEASURED, not assumed: the plain `input_tokens` field
 * alone read 2 for a turn that actually consumed roughly 33,000 input tokens, because the bulk
 * arrived as cache creation and cache reads — recording it alone would store a number that is
 * right about the uncached prefix and wrong about the session. Returns `undefined`, never 0, when
 * none of the three fields is present. */
function summedInputTokens(usage: ClaudeStreamUsage | undefined): number | undefined {
  const fields: Array<keyof ClaudeStreamUsage> = [
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ];
  const values = fields.map((field) => optionalUsageNumber(usage, field)).filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * D-53/plan 03-13: map one parsed shim NOTICE payload to exactly one {@link AgentEvent} —
 * `git_retry` or `git_lock_exhausted` — or `undefined` for a `kind` this function does not
 * recognise (dropped, never forwarded as `unknown`: this is reached ONLY from the shim's own
 * notice wire shape, never the backend's stream-json, so there is no raw line worth preserving
 * for an unrecognised notice kind). `raw` is always the serialised notice JSON itself — never
 * empty — the same solution G-02-4's synthesised `session_closed` event already used rather than
 * special-casing an exception into every consumer of the never-empty-`raw` invariant. Exported,
 * mirroring {@link normaliseStreamEvent} below, so this mapping is unit-testable without a live
 * session.
 */
export function noticeToAgentEvent(
  payload: PermissionNoticePayload,
  runId: string,
  seq: number,
  at: string,
): AgentEvent | undefined {
  const raw = JSON.stringify(payload);
  const base = { runId, seq, at, raw };
  if (payload.kind === "git_retry") {
    return {
      ...base,
      type: "git_retry",
      attempt: typeof payload.attempt === "number" ? payload.attempt : 0,
      max: typeof payload.max === "number" ? payload.max : 0,
      repository: typeof payload.repository === "string" ? payload.repository : "",
      command: typeof payload.command === "string" ? payload.command : "",
    };
  }
  if (payload.kind === "git_lock_exhausted") {
    return {
      ...base,
      type: "git_lock_exhausted",
      repository: typeof payload.repository === "string" ? payload.repository : "",
      command: typeof payload.command === "string" ? payload.command : "",
      attempts: typeof payload.attempts === "number" ? payload.attempts : 0,
    };
  }
  return undefined;
}

/**
 * Map one parsed `stream-json` object to exactly one {@link AgentEvent}. A shape this function
 * does not recognise becomes `unknown` — still carrying the verbatim `raw` text, never dropped
 * (AGNT-02's flagged assumption).
 */
export function normaliseStreamEvent(
  parsed: ClaudeStreamEvent,
  raw: string,
  runId: string,
  seq: number,
  at: string,
): AgentEvent {
  const base = { runId, seq, at, raw };

  if (parsed.type === "system" && (parsed as ClaudeStreamInit).subtype === "init") {
    const init = parsed as ClaudeStreamInit;
    return { ...base, type: "init", sessionId: init.session_id, model: init.model };
  }

  // G-02-3's observation: the --verbose flag Task 1 requires makes the CLI emit
  // session-lifecycle `system` events beyond `init` (e.g. SessionStart's `hook_started`/
  // `hook_response` subtypes) — a trivial probe prompt produced nine of them ahead of any
  // assistant text. Before this branch, every one of those fell through to the final `unknown`
  // case below and rendered as its full verbatim JSON line at the head of every feed. This is a
  // RENDERING classification only: no event is dropped, merged or reordered by it — the
  // fallthrough is narrowed, never deleted, and stays the destination for a `system` event with
  // no usable subtype and for every genuinely unrecognised shape. Deliberately no per-subtype
  // special-casing: any subtype the backend introduces in the future flows through this branch
  // without a code change, which is what keeps it from becoming a maintenance burden as the CLI
  // evolves.
  if (parsed.type === "system") {
    const subtype = (parsed as Record<string, unknown>).subtype;
    if (typeof subtype === "string" && subtype.length > 0) {
      return { ...base, type: "system_notice", text: `system: ${subtype}` };
    }
    return { ...base, type: "unknown" };
  }

  if (parsed.type === "assistant" || parsed.type === "user") {
    const message = (parsed as ClaudeStreamMessage).message;
    const content = message?.content ?? [];
    const toolCall = content.find((block) => block.type === "tool_use");
    if (toolCall) {
      return {
        ...base,
        type: "tool_call",
        toolName: toolCall.name ?? "unknown_tool",
        input: toolCall.input,
      };
    }
    const toolResult = content.find((block) => block.type === "tool_result");
    if (toolResult) {
      return { ...base, type: "tool_result", output: toolResult.text };
    }
    const textBlock = content.find((block) => block.type === "text");
    if (textBlock) {
      return { ...base, type: "assistant_text", text: textBlock.text ?? "" };
    }
    return { ...base, type: "unknown" };
  }

  if (parsed.type === "result") {
    const result = parsed as ClaudeStreamResult;
    // G-02-4: inputTokens is a SUM over three usage fields, not the plain field alone — see
    // summedInputTokens's own doc comment for the measured reason it must be a sum.
    const inputTokens = summedInputTokens(result.usage);
    const outputTokens = optionalUsageNumber(result.usage, "output_tokens");
    return {
      ...base,
      type: "result",
      subtype: result.subtype,
      totalCostUsd: result.total_cost_usd,
      sessionId: result.session_id,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
    };
  }

  return { ...base, type: "unknown" };
}

const CAPABILITIES: AdapterCapabilities = {
  supportsResume: false,
  supportsPermissionPrompt: true,
  supportsCostReporting: true,
};

/**
 * The grace window between SIGINT and the process-group SIGTERM (D-35, RESEARCH.md Pitfall 3).
 * One value, one place — not a per-run parameter and not read from configuration — referenced by
 * {@link ClaudeCodeAdapter.interruptSession} only; `killSession` is the force step on its own and
 * has no grace window of its own to wait out.
 */
export const STOP_GRACE_MS = 5_000;

/** The cap, in characters, on how much of a child's stderr is retained on {@link LiveSession.stderrTail}
 * for the terminal event's `detail` (G-02-2). Bounds both the memory one long-running session can
 * hold and the size of the string that crosses into the persisted log and the renderer — a chatty
 * child cannot grow this without bound just because it never closes. */
export const STDERR_DETAIL_MAX_CHARS = 2000;

/** One session's live process-tracking state, keyed by `runId` in {@link liveSessions} — enough
 * for `interruptSession`/`killSession` to find the right child, know whether it already closed
 * (idempotency, D-35), and classify why it closed once it does. */
interface LiveSession {
  /** The session's own watchdog wrapper process (plan 03-02) — NOT the backend `claude` binary
   * directly. The wrapper is the one spawned with its own process group here, and it spawns the
   * backend as ITS OWN child inside that same group; `interruptSession`/`killSession`'s existing
   * `-child.pid` signalling reaches both, unchanged, because the group — not any single process
   * in it — was always the real referent (PROC-03's promoted noun). */
  child: ReturnType<typeof spawn>;
  /** Resolves once the terminal `session_closed` event has actually been emitted for this run —
   * not merely once the OS process has exited, so a caller awaiting this can trust the event is
   * already visible to `onEvent` by the time the await returns. */
  closed: Promise<void>;
  /** Set the moment `session_closed` has been emitted — guards every path against emitting a
   * second terminal event for the same run (D-35 idempotency). */
  closedEventEmitted: boolean;
  /** Set by `interruptSession`/`killSession` before signalling, so the eventual close is
   * classified as `"interrupted"` rather than `"completed"`/`"failed"` even when the child's own
   * exit code looks like a normal exit (D-35: a stopped run is a normal outcome, not an error). */
  interruptionRequested: boolean;
  /** The last `result` stream-json line's normalised fields, if any arrived before the process
   * closed — carried on the terminal `session_closed` event when present. `inputTokens`/
   * `outputTokens` are the session-total figures `normaliseStreamEvent`'s result branch already
   * computed (G-02-4) — carried through unchanged, never re-derived here. */
  lastResult:
    | { subtype: string; totalCostUsd?: number; sessionId?: string; inputTokens?: number; outputTokens?: number }
    | undefined;
  /** At most {@link STDERR_DETAIL_MAX_CHARS} characters of the child's own stderr, accumulated as
   * it is read (G-02-2) — exists so a failed session can say why it failed. Also set directly (to
   * the spawn error's message) when the child could never be spawned at all. */
  stderrTail: string;
  onEvent: (event: AgentEvent) => void;
  nextSeq: number;
  /** This run's own permission-prompt MCP server handle (AGNT-06) — started BEFORE `child` is
   * spawned. `resolvePermission` (below) looks a run up here to relay a decision; `close()` is
   * called exactly once, from {@link emitSessionClosed}, so the socket never outlives its run. */
  permissionServer: PermissionServerHandle;
}

/** Tracks every session this sidecar has ever started, for the lifetime of this process —
 * `interruptSession`/`killSession` look a run up here, and an entry's `closedEventEmitted` flag
 * is what lets a call against an already-finished run resolve as a safe no-op instead of throwing
 * (D-35), as distinct from a `runId` this sidecar never spawned at all ({@link UnknownRunError}). */
const liveSessions = new Map<string, LiveSession>();

/** Emit the terminal `session_closed` event for `runId` exactly once — a second call for a
 * session whose event has already been emitted is a silent no-op (D-35 idempotency). */
function emitSessionClosed(
  runId: string,
  session: LiveSession,
  reason: "interrupted" | "completed" | "failed",
): void {
  if (session.closedEventEmitted) return;
  session.closedEventEmitted = true;
  session.permissionServer.close();
  // G-02-2: a retained stderr tail (or a spawn error's message, set directly onto the same field)
  // becomes the terminal event's `detail` — the backend's own explanation of why the session
  // ended, previously discarded entirely. Omitted, not an empty string, when there is nothing to
  // show — a session that closed cleanly having written nothing to stderr must not carry a
  // meaningless `detail: ""`.
  const trimmedDetail = session.stderrTail.trim();
  session.onEvent({
    runId,
    seq: session.nextSeq++,
    at: new Date().toISOString(),
    // Synthesized, not derived from a source line (AgentEventBase's own documented allowance) —
    // never empty, so "every event carries a non-empty raw field" stays a class invariant callers
    // can rely on for every AgentEvent, not just the ones parsed from the backend's own output.
    raw: `session_closed: ${reason}`,
    type: "session_closed",
    reason,
    result: session.lastResult,
    ...(trimmedDetail.length > 0 ? { detail: trimmedDetail } : {}),
  });
}

/** Resolve `true` once `session.closed` settles, or `false` if `timeoutMs` elapses first —
 * `interruptSession`'s own way of deciding whether the grace window ran out. */
function raceClosed(session: LiveSession, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);
    session.closed.then(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly capabilities = CAPABILITIES;

  async startSession(options: StartSessionOptions): Promise<void> {
    // AGNT-06: the permission server starts BEFORE the backend is spawned, so its socket is
    // already listening by the time the backend's first gated tool call could possibly arrive.
    let session!: LiveSession;
    const permissionServer = startPermissionServer((payload) => {
      // D-56 (plan 03-07): the shim's own request carries its classified category nested inside
      // `input.destructiveCategory` (its own wire shape, mirroring the MCP tool call's own
      // `{tool_name, input}` payload). Lifted to a TOP-LEVEL field on the outgoing AgentEvent —
      // one new optional field on an existing event, never a second event type — so the Rust
      // core's inbound handler can branch on its presence without reaching into `input`'s
      // otherwise-opaque `unknown` shape.
      const destructiveCategory =
        payload.input !== null && typeof payload.input === "object" && "destructiveCategory" in payload.input
          ? (payload.input as { destructiveCategory?: unknown }).destructiveCategory
          : undefined;
      session.onEvent({
        runId: options.runId,
        seq: session.nextSeq++,
        at: new Date().toISOString(),
        raw: JSON.stringify({ type: "permission_request", ...payload }),
        type: "permission_request",
        requestId: payload.requestId,
        toolName: payload.toolName,
        input: payload.input,
        ...(typeof destructiveCategory === "string" ? { destructiveCategory } : {}),
      });
    }, (payload) => {
      // D-53 (plan 03-13): the shim's fire-and-forget notice, mapped by the pure
      // `noticeToAgentEvent` above and relayed onto this SAME session's event stream as its own
      // event type. An unrecognised `kind` maps to `undefined` and is dropped here — this
      // callback is reached ONLY from the shim's own notice wire shape (never the backend's
      // stream-json), so a future notice kind not yet handled degrades to "no event," not a raw
      // dump.
      const event = noticeToAgentEvent(payload, options.runId, session.nextSeq, new Date().toISOString());
      if (event) {
        session.nextSeq += 1;
        session.onEvent(event);
      }
    });

    const bin = resolveClaudeBin();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
      FLYWHEEL_RUN_ID: options.runId,
      // D-55 (plan 03-07): the socket path `startPermissionServer` already opened, ABOVE, before
      // this spawn — the same channel the MCP permission-prompt tool call uses. The PATH-shim
      // binary (`packages/shim/src/main.rs`) connects a fresh socket here per destructive
      // invocation; it never opens its own second answering surface.
      FLYWHEEL_PERMISSION_SOCKET: permissionServer.socketPath,
    };

    // plan 03-07 (D-55): FLYWHEEL_SHIM_BIN is how `pretooluse-hook.ts` finds a binary it can shell
    // out to in `--classify-command` mode — reached from the SAME per-run shim directory
    // `flywheel_core::shim::shim_env_for_run` already prefixed onto `PATH` (D-51), never a second,
    // independently-resolved path to the compiled shim binary.
    const shimBin = shimBinFromEnv(env);
    if (shimBin) {
      env.FLYWHEEL_SHIM_BIN = shimBin;
    }

    // plan 03-07 (D-55): write this run's `--settings` file BEFORE building argv, so the hook can
    // be wired into the very first invocation — a write failure degrades to "no hook injected for
    // this session" (writeHookSettings's own doc comment), never a refused spawn.
    const settingsPath = env.FLYWHEEL_RUNTIME_DIR
      ? writeHookSettings(env.FLYWHEEL_RUNTIME_DIR, options.runId)
      : undefined;

    const mcpConfig = JSON.stringify({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: process.execPath,
          args: [permissionServerScriptPath(), permissionServer.socketPath],
        },
      },
    });
    const argv = buildClaudeArgv({
      prompt: options.prompt,
      permissionMode: options.permissionMode,
      permissionPromptToolName: PERMISSION_TOOL_NAME,
      mcpConfig,
      settingsPath,
    });

    // plan 03-02 (D-47/PROC-03): spawn the watchdog wrapper, never the backend directly — the
    // wrapper becomes this session's own process-group leader (kept `detached: true` right here,
    // exactly where it always was) and spawns `bin`/`argv` as ITS OWN child inside that same
    // group. D-35's "force" step (`interruptSession`/`killSession`, unchanged below) still
    // signals the whole group via `-child.pid`, never just one PID (RESEARCH.md Pitfall 3) — it
    // now reaches the wrapper AND the backend it spawned, through one process group.
    const child = spawn(process.execPath, [watchdogEntryPath(), bin, ...argv], {
      cwd: options.worktreePath,
      env,
      detached: true,
    });

    if (typeof child.pid === "number" && env.FLYWHEEL_RUNTIME_DIR) {
      writeRunDescriptor(env.FLYWHEEL_RUNTIME_DIR, options.runId, child.pid);
    }

    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    session = {
      child,
      closed,
      closedEventEmitted: false,
      interruptionRequested: false,
      lastResult: undefined,
      stderrTail: "",
      onEvent: options.onEvent,
      nextSeq: 0,
      permissionServer,
    };
    liveSessions.set(options.runId, session);

    const rl = createInterface({ input: child.stdout });

    // G-02-2: drain the child's own stderr for the entire lifetime of the session, from the
    // moment it is spawned, for two reasons. First, the child's own explanation of a refusal was
    // previously discarded entirely — `spawn()`'s default stdio left stderr an undrained pipe,
    // which is what turned a one-word CLI argument-validation error into a blind debugging
    // session. Second, an undrained pipe is a latent blocking hazard in its own right: a child
    // that ever writes more than the OS pipe buffer holds would stall on its own stderr write.
    // Each line becomes a `system_notice` on the SAME `onEvent` channel as every stdout-derived
    // event (D-32's rendering treats it as a muted line, never styled as an error), and is also
    // retained (capped at `STDERR_DETAIL_MAX_CHARS`) on `session.stderrTail`, which
    // `emitSessionClosed` carries onto the terminal event as `detail` so a failed spawn can
    // finally say why. Guarded: a child whose `stderr` is not a readable stream (never true for a
    // `spawn()` call with default stdio, but not a stream this code otherwise controls) is a
    // no-op here rather than a throw.
    if (child.stderr) {
      const stderrRl = createInterface({ input: child.stderr });
      stderrRl.on("line", (line: string) => {
        const at = new Date().toISOString();
        const seq = session.nextSeq++;
        options.onEvent({ runId: options.runId, seq, at, raw: line, type: "system_notice", text: line });
        if (session.stderrTail.length < STDERR_DETAIL_MAX_CHARS) {
          // Append THEN truncate (T-02G-17-03). A check-before-append alone does not bound the
          // field: one arbitrarily long line arriving while the tail sits at CAP-1 yields
          // CAP-1 + line.length, and this tail crosses into both the persisted JSONL and the
          // renderer. The Rust reader loop's own stderr arm (sidecar.rs) already does it this
          // way; the two sides now agree.
          session.stderrTail += `${line}\n`;
          session.stderrTail = session.stderrTail.slice(0, STDERR_DETAIL_MAX_CHARS);
        }
      });
    }

    await new Promise<void>((resolve, reject) => {
      rl.on("line", (line: string) => {
        const at = new Date().toISOString();
        const seq = session.nextSeq++;
        let parsed: ClaudeStreamEvent | undefined;
        try {
          parsed = JSON.parse(line) as ClaudeStreamEvent;
        } catch {
          // A line that does not parse as JSON becomes a system_notice carrying the raw text —
          // nothing is silently dropped (AGNT-02's flagged assumption).
          options.onEvent({ runId: options.runId, seq, at, raw: line, type: "system_notice", text: line });
          return;
        }

        // plan 03-02: this adapter's own `child` is the watchdog wrapper now, not the backend —
        // a backend spawn failure (e.g. a missing `FLYWHEEL_CLAUDE_BIN`) is something only the
        // WRAPPER observes, reported as this one sentinel-shaped line on its stdout (see
        // `watchdog.ts`'s own `child.on("error", ...)`). Handled here, before this line is ever
        // treated as real stream-json, so `startSession` still rejects naming the missing binary
        // exactly as it did before the wrapper existed.
        const maybeSpawnError = parsed as unknown as {
          __flywheelWatchdogSpawnError?: boolean;
          message?: string;
        };
        if (maybeSpawnError.__flywheelWatchdogSpawnError === true) {
          const message = maybeSpawnError.message ?? "the backend failed to spawn";
          session.stderrTail = message;
          emitSessionClosed(options.runId, session, "failed");
          resolveClosed();
          reject(new Error(message));
          return;
        }
        const normalised = normaliseStreamEvent(parsed, line, options.runId, seq, at);
        if (normalised.type === "result") {
          session.lastResult = {
            subtype: normalised.subtype,
            totalCostUsd: normalised.totalCostUsd,
            sessionId: normalised.sessionId,
            inputTokens: normalised.inputTokens,
            outputTokens: normalised.outputTokens,
          };
        }
        options.onEvent(normalised);
      });

      child.on("error", (err) => {
        // The child never produced a process at all, so there is no stderr to have drained — the
        // spawn error's own message is the closest thing to a stderr tail this session ever gets
        // (G-02-2), and it still explains itself on the terminal event's `detail`.
        session.stderrTail = err.message;
        emitSessionClosed(options.runId, session, "failed");
        resolveClosed();
        reject(err);
      });

      child.on("close", (code) => {
        const reason = session.interruptionRequested ? "interrupted" : code === 0 ? "completed" : "failed";
        emitSessionClosed(options.runId, session, reason);
        resolveClosed();
        resolve();
      });
    });
  }

  async interruptSession(runId: string): Promise<void> {
    const session = liveSessions.get(runId);
    if (!session) throw new UnknownRunError(runId);
    if (session.closedEventEmitted || session.child.pid === undefined) return; // already exited — safe no-op (D-35)

    session.interruptionRequested = true;
    const pid = session.child.pid;
    // Negative pid: signal the whole process group, never just this one PID (RESEARCH.md Pitfall 3).
    // Guarded exactly like the SIGTERM escalation below (WR-01): the child can exit in the gap
    // between the closedEventEmitted check above and this call, which throws ESRCH synchronously
    // and would otherwise surface to the Rust side as a spurious interrupt FAILURE for a run that
    // in fact completed successfully on its own. `interruptionRequested` is already set above, so
    // the close handler still reports "interrupted" rather than "completed" when the signal did
    // land in time.
    try {
      process.kill(-pid, "SIGINT");
    } catch {
      // Exited in the gap between the liveness check and this signal — nothing to do.
    }

    const exitedInTime = await raceClosed(session, STOP_GRACE_MS);
    if (exitedInTime) return;

    if (!session.closedEventEmitted && session.child.pid !== undefined) {
      try {
        process.kill(-session.child.pid, "SIGTERM");
      } catch {
        // Exited in the gap between the grace window elapsing and this signal — nothing to do.
      }
    }
    await session.closed;
  }

  /** Relay a decision to `runId`'s held permission-prompt tool call (AGNT-06) — the ONLY thing
   * that ever settles one. Rejects with {@link UnknownRunError} for a `runId` this sidecar never
   * spawned (mirrors `interruptSession`/`killSession`'s own guard); a `requestId` matching no
   * currently-held call for a known run is a logged no-op inside
   * `PermissionServerHandle.resolvePermission` itself, never an error here. */
  resolvePermission(runId: string, requestId: string, decision: "allow" | "deny"): void {
    const session = liveSessions.get(runId);
    if (!session) throw new UnknownRunError(runId);
    session.permissionServer.resolvePermission(requestId, decision);
  }

  async killSession(runId: string): Promise<void> {
    const session = liveSessions.get(runId);
    if (!session) throw new UnknownRunError(runId);
    if (session.closedEventEmitted || session.child.pid === undefined) return; // already exited — safe no-op (D-35)

    session.interruptionRequested = true;
    try {
      // Force step on its own, no grace window — negative pid signals the whole group
      // (RESEARCH.md Pitfall 3), never just this one PID.
      process.kill(-session.child.pid, "SIGTERM");
    } catch {
      // Exited in the gap between the lookup above and this signal — nothing to do.
    }
    await session.closed;
  }

  async resumeSession(): Promise<void> {
    return defaultResumeSession();
  }
}

export { CapabilityUnsupportedError };
