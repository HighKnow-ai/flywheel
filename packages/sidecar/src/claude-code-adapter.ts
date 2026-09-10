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
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  type AdapterCapabilities,
  type AgentAdapter,
  type AgentEvent,
  CapabilityUnsupportedError,
  defaultResumeSession,
  type StartSessionOptions,
  UnknownRunError,
} from "./adapter.js";

/** The binary name/path this adapter spawns — overridable via `FLYWHEEL_CLAUDE_BIN` so tests can
 * point it at `test/fake-claude.mjs` instead of the real CLI. Never a credential. */
export function resolveClaudeBin(): string {
  return process.env.FLYWHEEL_CLAUDE_BIN ?? "claude";
}

/**
 * Build the exact argv `claude` is invoked with. Pure function — no spawning, no environment
 * access — so it is unit-testable without a child process. Never places a credential in the
 * array: credentials only ever reach the child through its `env` (T-02-01).
 */
export function buildClaudeArgv(options: { prompt: string; permissionMode: string }): string[] {
  return [
    "-p",
    options.prompt,
    "--output-format",
    "stream-json",
    "--permission-mode",
    options.permissionMode,
  ];
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

interface ClaudeStreamResult {
  type: "result";
  subtype: string;
  total_cost_usd?: number;
  session_id?: string;
}

type ClaudeStreamEvent = ClaudeStreamInit | ClaudeStreamMessage | ClaudeStreamResult | Record<string, unknown>;

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
    return {
      ...base,
      type: "result",
      subtype: result.subtype,
      totalCostUsd: result.total_cost_usd,
      sessionId: result.session_id,
    };
  }

  return { ...base, type: "unknown" };
}

const CAPABILITIES: AdapterCapabilities = {
  supportsResume: false,
  supportsPermissionPrompt: false,
  supportsCostReporting: true,
};

/**
 * The grace window between SIGINT and the process-group SIGTERM (D-35, RESEARCH.md Pitfall 3).
 * One value, one place — not a per-run parameter and not read from configuration — referenced by
 * {@link ClaudeCodeAdapter.interruptSession} only; `killSession` is the force step on its own and
 * has no grace window of its own to wait out.
 */
export const STOP_GRACE_MS = 5_000;

/** One session's live process-tracking state, keyed by `runId` in {@link liveSessions} — enough
 * for `interruptSession`/`killSession` to find the right child, know whether it already closed
 * (idempotency, D-35), and classify why it closed once it does. */
interface LiveSession {
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
   * closed — carried on the terminal `session_closed` event when present. */
  lastResult: { subtype: string; totalCostUsd?: number; sessionId?: string } | undefined;
  onEvent: (event: AgentEvent) => void;
  nextSeq: number;
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
    const argv = buildClaudeArgv({ prompt: options.prompt, permissionMode: options.permissionMode });
    const bin = resolveClaudeBin();

    const child = spawn(bin, argv, {
      cwd: options.worktreePath,
      env: { ...process.env, ...options.env },
      // Own process group, so D-35's "force" step can signal the whole group, never just this
      // one PID (RESEARCH.md Pitfall 3).
      detached: true,
    });

    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const session: LiveSession = {
      child,
      closed,
      closedEventEmitted: false,
      interruptionRequested: false,
      lastResult: undefined,
      onEvent: options.onEvent,
      nextSeq: 0,
    };
    liveSessions.set(options.runId, session);

    const rl = createInterface({ input: child.stdout });

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
        const normalised = normaliseStreamEvent(parsed, line, options.runId, seq, at);
        if (normalised.type === "result") {
          session.lastResult = {
            subtype: normalised.subtype,
            totalCostUsd: normalised.totalCostUsd,
            sessionId: normalised.sessionId,
          };
        }
        options.onEvent(normalised);
      });

      child.on("error", (err) => {
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
    process.kill(-pid, "SIGINT");

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
