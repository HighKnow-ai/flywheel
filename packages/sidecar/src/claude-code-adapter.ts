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

/** Tracks the live child process per run id, so `interruptSession`/`killSession` can find it. */
const liveProcesses = new Map<string, ReturnType<typeof spawn>>();

/** The grace window between SIGINT and the process-group SIGTERM (D-35, RESEARCH.md Pitfall 3). */
const FORCE_GRACE_WINDOW_MS = 5_000;

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
    liveProcesses.set(options.runId, child);

    let seq = 0;
    const rl = createInterface({ input: child.stdout });

    await new Promise<void>((resolve, reject) => {
      rl.on("line", (line: string) => {
        const at = new Date().toISOString();
        let parsed: ClaudeStreamEvent | undefined;
        try {
          parsed = JSON.parse(line) as ClaudeStreamEvent;
        } catch {
          // A line that does not parse as JSON becomes a system_notice carrying the raw text —
          // nothing is silently dropped (AGNT-02's flagged assumption).
          options.onEvent({
            runId: options.runId,
            seq: seq++,
            at,
            raw: line,
            type: "system_notice",
            text: line,
          });
          return;
        }
        options.onEvent(normaliseStreamEvent(parsed, line, options.runId, seq++, at));
      });

      child.on("error", (err) => {
        liveProcesses.delete(options.runId);
        reject(err);
      });

      child.on("close", () => {
        liveProcesses.delete(options.runId);
        resolve();
      });
    });
  }

  async interruptSession(runId: string): Promise<void> {
    const child = liveProcesses.get(runId);
    if (!child || child.pid === undefined) return;
    child.kill("SIGINT");
  }

  async killSession(runId: string): Promise<void> {
    const child = liveProcesses.get(runId);
    if (!child || child.pid === undefined) return;
    // D-35 "force": interrupt first, then signal the whole process group (negative pid) after a
    // grace window — never just the direct child PID (RESEARCH.md Pitfall 3).
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, FORCE_GRACE_WINDOW_MS));
    if (liveProcesses.has(runId) && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Process already exited between the grace window and this signal — nothing to do.
      }
    }
  }

  async resumeSession(): Promise<void> {
    return defaultResumeSession();
  }
}

export { CapabilityUnsupportedError };
