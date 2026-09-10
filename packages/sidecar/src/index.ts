/**
 * The sidecar's stdio request/event loop. One long-lived process, supervised by the Rust core
 * (`packages/desktop/src-tauri/src/sidecar.rs`) via `tauri-plugin-shell`. Reads newline-delimited
 * JSON requests on stdin, writes newline-delimited JSON events/acknowledgements on stdout.
 *
 * Holds no decision authority of its own (RESEARCH.md Pitfall 4, applied at the process-topology
 * level): it drives whichever `AgentAdapter` a request names and forwards normalised events
 * upstream — it never decides anything about permissions, credentials, or which run should exist.
 */
import { createInterface } from "node:readline";

import type { AgentEvent } from "./adapter.js";
import { ClaudeCodeAdapter } from "./claude-code-adapter.js";

interface SpawnRequest {
  id: string;
  op: "spawn";
  runId: string;
  worktreePath: string;
  prompt: string;
  permissionMode: string;
  env?: Record<string, string>;
}

interface InterruptRequest {
  id: string;
  op: "interrupt";
  runId: string;
}

interface KillRequest {
  id: string;
  op: "kill";
  runId: string;
}

type SidecarRequest = SpawnRequest | InterruptRequest | KillRequest;

/** One `claude_code` adapter instance drives every run this sidecar process hosts — PROC-01's
 * one-OS-process-per-session holds because each `startSession` spawns its own child, while the
 * Rust core supervises exactly one sidecar process. */
const adapter = new ClaudeCodeAdapter();

/** Live in-flight sessions this sidecar is driving, keyed by `runId` — the `Map<runId, session>`
 * the sidecar-shape research names. */
const sessions = new Map<string, Promise<void>>();

function writeLine(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function emitEvent(event: AgentEvent): void {
  writeLine({ kind: "event", event });
}

function emitAck(id: string, ok: boolean, error?: string): void {
  writeLine({ kind: "ack", id, ok, error });
}

async function handleRequest(request: SidecarRequest): Promise<void> {
  switch (request.op) {
    case "spawn": {
      const sessionPromise = adapter
        .startSession({
          runId: request.runId,
          worktreePath: request.worktreePath,
          prompt: request.prompt,
          permissionMode: request.permissionMode,
          env: request.env,
          onEvent: emitEvent,
        })
        .catch((err: unknown) => {
          emitEvent({
            runId: request.runId,
            seq: -1,
            at: new Date().toISOString(),
            raw: String(err),
            type: "system_notice",
            text: `session failed to start: ${String(err)}`,
          });
        })
        .finally(() => {
          sessions.delete(request.runId);
        });
      sessions.set(request.runId, sessionPromise);
      emitAck(request.id, true);
      return;
    }
    case "interrupt": {
      await adapter.interruptSession(request.runId);
      emitAck(request.id, true);
      return;
    }
    case "kill": {
      await adapter.killSession(request.runId);
      emitAck(request.id, true);
      return;
    }
    default: {
      const unknownRequest = request as { id?: string };
      emitAck(unknownRequest.id ?? "unknown", false, "unrecognised op");
    }
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line: string) => {
    if (line.trim().length === 0) return;
    let request: SidecarRequest;
    try {
      request = JSON.parse(line) as SidecarRequest;
    } catch {
      emitAck("unknown", false, "malformed JSON request");
      return;
    }
    void handleRequest(request);
  });
}

main();
