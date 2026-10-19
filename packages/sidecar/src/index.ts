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
import { ClaudeCodeAdapter, probeClaudeBinary } from "./claude-code-adapter.js";

interface SpawnRequest {
  id: string;
  op: "spawn";
  runId: string;
  worktreePath: string;
  prompt: string;
  permissionMode: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionPrompt?: boolean;
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

interface PermissionAnswerRequest {
  id: string;
  op: "permission_answer";
  runId: string;
  requestId: string;
  decision: "allow" | "deny";
}

/** Issues #52, #53: the Rust core's answer to one held board tool call — its result
 * call (`result`), or the reason the core refused it (`error`). */
interface BoardToolAnswerRequest {
  id: string;
  op: "board_tool_answer";
  runId: string;
  requestId: string;
  result?: unknown;
  error?: string;
}

/** D-39, plan 02-09 Task 3: ask whether the backend binary this adapter would spawn is
 * resolvable, and its reported version. Read-only — never spawns a session, never touches a
 * credential; carries no `runId` because it names no run. */
interface CapabilityProbeRequest {
  id: string;
  op: "capability_probe";
}

/** CR-02, plan 02-14: tear down every live session this sidecar is driving. Carries no `runId` —
 * mirroring {@link CapabilityProbeRequest}'s shape, and for the same reason: it names no single
 * run. The ack's `data` carries `{ killed: <count> }`. */
interface ShutdownRequest {
  id: string;
  op: "shutdown";
}

/** G-02-1, plan 02-15: the startup readiness handshake's counterpart. `spawn_sidecar`
 * (`packages/desktop/src-tauri/src/sidecar.rs`) writes this to the freshly-spawned child's stdin
 * and waits, bounded, for ANY ack carrying this same `id` before returning — the cheapest
 * possible question this process can answer ("are you alive and reading your own stdin/writing
 * your own stdout protocol at all?"), with no side effect and no dependency on anything else.
 *
 * This is deliberately NOT {@link CapabilityProbeRequest}: `capability_probe` spawns the backend
 * `claude` binary to ask a question about the USER's install, which is unrelated to and far more
 * expensive than whether this sidecar process itself is alive — gating application startup on a
 * user-environment probe like that would fail closed for reasons that have nothing to do with the
 * sidecar's own health. `ping` asks nothing about `claude`, spawns nothing, and touches no
 * credential. */
interface PingRequest {
  id: string;
  op: "ping";
}

type SidecarRequest =
  | SpawnRequest
  | InterruptRequest
  | KillRequest
  | PermissionAnswerRequest
  | BoardToolAnswerRequest
  | CapabilityProbeRequest
  | ShutdownRequest
  | PingRequest;

/** One `claude_code` adapter instance drives every run this sidecar process hosts — PROC-01's
 * one-OS-process-per-session holds because each `startSession` spawns its own child, while the
 * Rust core supervises exactly one sidecar process. */
const adapter = new ClaudeCodeAdapter();

/** Live in-flight sessions this sidecar is driving, keyed by `runId` — the `Map<runId, session>`
 * the sidecar-shape research names. */
const sessions = new Map<string, Promise<void>>();

/**
 * How long {@link shutdownAllSessions} waits for each session's teardown before moving on, in
 * milliseconds (CR-02, plan 02-14). The Rust supervisor is blocked on this call's ack during
 * application exit, so a session that refuses to die must not make the product unquittable —
 * this value is deliberately BELOW the Rust side's own `SHUTDOWN_ACK_TIMEOUT`
 * (`packages/desktop/src-tauri/src/sidecar.rs`) so the ack normally arrives before the supervisor
 * gives up on it.
 */
const SHUTDOWN_SESSION_GRACE_MS = 2000;

/**
 * Tear down every live session this sidecar is driving (CR-02, PROC-01) — the handler for an
 * explicit `shutdown` request, and the body of both fallback nets in {@link main}. Snapshots the
 * live run ids BEFORE iterating so a session that finishes and removes itself from `sessions`
 * mid-call cannot change what this invocation reports. `killSession` sends its process-group
 * signal SYNCHRONOUSLY, before its own first `await` — so racing every call against the grace
 * timer together via `Promise.all` signals every session before any single one of them is done
 * waiting, never "signal one, wait, signal next". A rejection from an unknown or already-closed
 * run id is swallowed per-run so it can never abort the remaining sessions' teardown. Resolves
 * successfully with `0` and never waits when there are no live sessions.
 */
async function shutdownAllSessions(): Promise<number> {
  const runIds = [...sessions.keys()];
  await Promise.all(
    runIds.map((runId) =>
      Promise.race([
        adapter.killSession(runId).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_SESSION_GRACE_MS)),
      ]),
    ),
  );
  return runIds.length;
}

function writeLine(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function emitEvent(event: AgentEvent): void {
  writeLine({ kind: "event", event });
}

function emitAck(id: string, ok: boolean, error?: string, data?: unknown): void {
  writeLine({ kind: "ack", id, ok, error, data });
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
          allowedTools: request.allowedTools,
          disallowedTools: request.disallowedTools,
          permissionPrompt: request.permissionPrompt,
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
      try {
        await adapter.interruptSession(request.runId);
        emitAck(request.id, true);
      } catch (err: unknown) {
        // An unknown runId (or any other interrupt failure) is a typed rejection, not a crash —
        // acknowledge it as a failure so the Rust core's waiting caller gets a clear answer
        // instead of the sidecar process going down (D-35, T-02-11).
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "kill": {
      try {
        await adapter.killSession(request.runId);
        emitAck(request.id, true);
      } catch (err: unknown) {
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "permission_answer": {
      // AGNT-06: the ONLY caller of resolvePermission — a decision relayed here is the ONLY
      // thing that ever settles a held permission-prompt tool call (RESEARCH.md pitfall 4: the
      // sidecar itself decides nothing).
      try {
        adapter.resolvePermission(request.runId, request.requestId, request.decision);
        emitAck(request.id, true);
      } catch (err: unknown) {
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "board_tool_answer": {
      // Issue #52: the ONLY caller of resolveBoardTool — the core's answer settles a held board tool
      // call; the sidecar never writes or reads the board itself.
      try {
        adapter.resolveBoardTool(request.runId, request.requestId, request.result, request.error);
        emitAck(request.id, true);
      } catch (err: unknown) {
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "capability_probe": {
      // D-39, plan 02-09 Task 3: read-only — never spawns a session, never touches a credential.
      try {
        const result = await probeClaudeBinary();
        emitAck(request.id, true, undefined, result);
      } catch (err: unknown) {
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "shutdown": {
      // CR-02, plan 02-14: the Rust core sends this BEFORE it kills the sidecar's own process,
      // so every live session's process group is signalled while something can still reach them.
      try {
        const killed = await shutdownAllSessions();
        emitAck(request.id, true, undefined, { killed });
      } catch (err: unknown) {
        emitAck(request.id, false, String(err));
      }
      return;
    }
    case "ping": {
      // G-02-1, plan 02-15: the startup readiness handshake's counterpart. Does nothing else —
      // no adapter call, no session lookup, no backend-binary probe — so the ack it produces
      // proves only that this process is alive and speaking its own stdio protocol, which is the
      // one thing `spawn_sidecar` needs to know before it is allowed to return.
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

  // Fallback net 1 (CR-02): a polite SIGTERM still tears down every live session's process group
  // before this sidecar itself exits. This can never help against a SIGKILL — which is what
  // tauri-plugin-shell's CommandChild::kill() sends on Unix — so it is a belt on top of the
  // explicit `shutdown` request above, which the Rust core sends BEFORE that kill, never a
  // replacement for it.
  process.on("SIGTERM", () => {
    void shutdownAllSessions().then(() => process.exit(0));
  });

  // Fallback net 2 (CR-02): the Rust side's stdin pipe closing is this sidecar's only other
  // signal that its supervisor is gone. Same caveat as the SIGTERM net above — a SIGKILL bypasses
  // this entirely too.
  rl.on("close", () => {
    void shutdownAllSessions();
  });
}

main();
