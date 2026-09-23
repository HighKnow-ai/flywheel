/**
 * AGNT-06 — the permission-prompt MCP server: a tool call that does not resolve until a human
 * answers, relayed through the Rust core (02-RESEARCH.md "Permission-prompt MCP server (AGNT-06)").
 *
 * Two roles live in this one file, matching the two OS processes this mechanism spans — the
 * standalone role is a genuinely separate process the backend spawns per its own `--mcp-config`,
 * so the two cannot share in-memory state directly; a Unix domain socket is the relay between
 * them:
 *
 *  - `startPermissionServer` (SIDECAR-SIDE role): called from `claude-code-adapter.ts`'s
 *    `startSession`, BEFORE the backend is spawned ("starting a session starts the permission
 *    server first"). Opens a Unix domain socket the standalone role (below) connects to, and
 *    returns a handle whose `resolvePermission` is what the sidecar's own stdio loop
 *    (`index.ts`'s `permission_answer` op, via `ClaudeCodeAdapter.resolvePermission`) calls when
 *    the Rust core relays a decision. This role never imports the MCP SDK — it is a plain socket
 *    relay with no protocol awareness of MCP at all.
 *
 *    Plan 03-13 (D-53): this SAME socket now carries a SECOND message kind — a fire-and-forget
 *    NOTICE from the PATH shim binary (`packages/shim/src/main.rs`), reporting a git lock retry
 *    in progress or a retry budget's exhaustion. `03-CONTEXT.md` is explicit that the shim route
 *    through the existing permission channel rather than inventing a second answering surface,
 *    and a notice is the same shim talking to the same session. A notice connection is
 *    distinguished by a `kind` field the routine held-request payload never carries, and is
 *    closed IMMEDIATELY once parsed — a notice has no answer, so it is never added to `pending`
 *    (the held-connection map) at all. The held-request path below is otherwise byte-for-byte
 *    unchanged: no timer, no default, no local cache, for either message kind.
 *
 *  - The standalone MCP server (this module's own `main()`, run when the COMPILED file is
 *    invoked directly as `node mcp-permission-server.js <socketPath>`): this is the actual
 *    process the backend (`claude`, or `fake-claude.mjs` in tests) spawns per the `--mcp-config`
 *    `buildClaudeArgv` builds, hosting exactly one tool over the stdio transport
 *    (`StdioServerTransport`, matching the backend's own documented `--permission-prompt-tool`
 *    contract). Its handler connects a fresh socket to `socketPath` per call, forwards the
 *    request, and settles ONLY when the socket answers — no timer, no default, no local cache of
 *    a prior decision, no allowlist (02-RESEARCH.md pitfall 4: every allow-always lookup happens
 *    in the Rust core, never here — the sidecar asks and waits).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** The raw tool name registered on the MCP server. Declared once, alongside the fully-qualified
 * {@link PERMISSION_TOOL_NAME} it composes, so `buildClaudeArgv` and this server's own
 * registration can never disagree about either name. */
export const APPROVE_TOOL_NAME = "approve_action";

/** The MCP server name this module registers under — the `--mcp-config` key naming exactly one
 * server (T-02-02). */
export const MCP_SERVER_NAME = "flywheel-permissions";

/** The exact string `--permission-prompt-tool` is given — `mcp__{server}__{tool}`, the shape
 * Claude Code's own CLI reference documents. Declared exactly once in this sidecar's source. */
export const PERMISSION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${APPROVE_TOOL_NAME}`;

/** Plan 04-03 (D-64): the raw tool name for the agent's own closing-summary report — a SECOND
 * tool on this SAME server, declared here beside {@link APPROVE_TOOL_NAME} so the two names can
 * never be confused with each other. */
export const REPORT_SUMMARY_TOOL_NAME = "report_summary";

/** The fully-qualified string `buildClaudeArgv` pushes onto `--allowedTools` so the agent's own
 * closing `report_summary` call is pre-approved and never routes through `approve_action` waiting
 * on a human (D-46 reserves that friction for money-burning actions, not for writing a summary).
 * Composed exactly the way {@link PERMISSION_TOOL_NAME} already composes, declared exactly once. */
export const SUMMARY_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${REPORT_SUMMARY_TOOL_NAME}`;

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: unknown;
}

/** Plan 04-03 (D-64/D-65): the wire shape `report_summary`'s standalone-server handler writes
 * over the per-run socket, and {@link startPermissionServer}'s `onSummary` callback receives.
 * `kind: "session_summary"` is the EXACT string {@link isSummaryPayload} checks — distinguished
 * from {@link PermissionNoticePayload}'s broader "carries some string `kind`" check, which would
 * otherwise also match this shape; the summary branch in the connection handler below runs FIRST,
 * before the notice check ever sees the line. `version: 1` is what keeps a future shape change an
 * additive `version: 2` branch rather than a breaking one. The six content fields mirror
 * `SummaryReportedEvent` minus `runId` — identity is derived from the socket the call arrives on,
 * never accepted as a caller-supplied argument (T-04-01). */
export interface SummaryReportPayload {
  kind: "session_summary";
  version: 1;
  changedFiles: string[];
  changedProse?: string;
  remains?: string;
  nextSessionMustKnow?: string;
  decisions: Array<{ id: string; statement: string }>;
  acknowledgedDecisions: string[];
}

/** Plan 03-13 (D-53): the shim's fire-and-forget notice shape — `kind` is what distinguishes this
 * from {@link PermissionRequestPayload} on the wire (the routine payload never carries a `kind`
 * field at all). `runId` is the shim's own `FLYWHEEL_RUN_ID`; every other field is notice-specific
 * (`attempt`/`max`/`repository`/`command` for a retry, `repository`/`command`/`attempts` for an
 * exhaustion) — carried through verbatim rather than typed per-kind here, since this module has no
 * opinion on what a notice's payload means, only on routing it to `onNotice` unanswered. */
export interface PermissionNoticePayload {
  kind: "git_retry" | "git_lock_exhausted";
  runId: string;
  [field: string]: unknown;
}

/**
 * Resolve the directory the permission socket file is created under. Deliberately NOT
 * `os.tmpdir()` unconditionally: on macOS, `os.tmpdir()`/`$TMPDIR` resolves to a long, per-session
 * sandboxed path (`/var/folders/.../T/`) that, joined with this file's own
 * `flywheel-permission-<uuid>.sock` name, routinely exceeds `sockaddr_un`'s ~104-byte `SUN_LEN`
 * limit — `UnixStream::connect` in `packages/shim/src/main.rs::request_permission` then fails with
 * "path must be shorter than SUN_LEN", which the shim (correctly) treats as
 * `PermissionOutcome::Error` and refuses the command, but the socket the destructive gate is
 * supposed to raise a question on was never reachable at all. `packages/core/tests/
 * destructive_classifier.rs::scratch_socket_path` already avoids this exact failure mode in the
 * Rust test suite by preferring `/tmp`; this mirrors that choice for the real production socket
 * plan 03-19 (G-03-3) is what finally exercises this code path against a live session for the
 * first time — no prior wiring ever let a destructive command reach this socket at all. `/tmp` is
 * short and present on every POSIX system this product ships on; fall back to `os.tmpdir()` only
 * if `/tmp` itself is not writable (never silently — the fallback still fails loud downstream if
 * its own path is also too long, rather than masking the condition here).
 */
function socketBaseDir(): string {
  try {
    fs.accessSync("/tmp", fs.constants.W_OK);
    return "/tmp";
  } catch {
    return os.tmpdir();
  }
}

function isNoticePayload(parsed: unknown): parsed is PermissionNoticePayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    typeof (parsed as { kind?: unknown }).kind === "string"
  );
}

/** Plan 04-03 (D-64): checks the EXACT `kind: "session_summary"` string — never merely "carries a
 * `kind` field," which is {@link isNoticePayload}'s broader check and would otherwise also match
 * this shape. A summary can never be mistaken for a git notice, or vice versa, because the
 * connection handler checks this guard FIRST. */
function isSummaryPayload(parsed: unknown): parsed is SummaryReportPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "session_summary"
  );
}

export interface PermissionServerHandle {
  /** The Unix domain socket path the standalone server (spawned by the backend) connects to —
   * embedded verbatim into the `--mcp-config` JSON `buildClaudeArgv` builds. */
  socketPath: string;
  /** Settle a held call. A `requestId` matching no held call is ignored with a logged notice and
   * resolves nothing else — never an error, and never treated as "resolve some other call
   * instead." */
  resolvePermission(requestId: string, decision: "allow" | "deny"): void;
  /** Stop listening and remove the socket file. Safe to call more than once. */
  close(): void;
}

/**
 * SIDECAR-SIDE role. Opens a fresh Unix domain socket and returns a handle. `onRequest` is
 * invoked once per incoming connection with the parsed `{requestId, toolName, input}` — the
 * caller (`ClaudeCodeAdapter.startSession`) uses this to emit the `permission_request`
 * `AgentEvent` upstream. Nothing here decides an outcome: every connection stays open,
 * unresolved, until {@link PermissionServerHandle.resolvePermission} is called for its
 * `requestId` — there is no timer, no default and no allowlist anywhere in this function.
 *
 * `onNotice` (plan 03-13, D-53) is invoked once per incoming connection whose parsed line carries
 * a `kind` field — a fire-and-forget message from the shim, never a held request. That
 * connection is closed IMMEDIATELY after `onNotice` runs and is never added to `pending`.
 *
 * `onSummary` (plan 04-03, D-64) is invoked once per incoming connection whose parsed line carries
 * `kind: "session_summary"` — the agent's own closing-summary report, relayed as a SECOND message
 * kind on this SAME socket. Checked BEFORE the `onNotice` branch (see {@link isSummaryPayload}),
 * answered with a receipt acknowledgement, and closed IMMEDIATELY — also never added to `pending`,
 * for the identical reason a notice is not: a summary is not a held call either.
 */
export function startPermissionServer(
  onRequest: (payload: PermissionRequestPayload) => void,
  onNotice: (payload: PermissionNoticePayload) => void,
  onSummary: (payload: SummaryReportPayload) => void,
): PermissionServerHandle {
  const socketPath = path.join(socketBaseDir(), `flywheel-permission-${randomUUID()}.sock`);
  // A stale socket file from a previous run that was killed without cleanup would make `listen`
  // fail with EADDRINUSE — never plausible for a UUID-derived path, but removing defensively
  // costs nothing and avoids a hypothetical collision.
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Did not exist — the expected, common case.
  }

  let closed = false;
  const pending = new Map<string, net.Socket>();

  const server = net.createServer((socket) => {
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }

      // Plan 04-03 (D-64): a summary report carries `kind: "session_summary"` EXACTLY — checked
      // BEFORE the broader isNoticePayload check below, which would otherwise also match on the
      // mere presence of a string `kind` field. Answered with a receipt acknowledgement and closed
      // IMMEDIATELY, never added to `pending` — a summary is not a held call, and this branch must
      // never share a code path with the held-request logic below (T-04-10: a flood of summary
      // calls cannot exhaust the pending-connection map the permission gate depends on).
      if (isSummaryPayload(parsed)) {
        onSummary(parsed);
        socket.end(JSON.stringify({ received: true }) + "\n");
        return;
      }

      // Plan 03-13 (D-53): a notice carries `kind`, the routine held-request payload never does.
      // Closed IMMEDIATELY — never added to `pending` — because a notice has no answer; the
      // held-connection path below is otherwise entirely unaffected by this branch's existence.
      if (isNoticePayload(parsed)) {
        onNotice(parsed);
        socket.end();
        return;
      }

      const request = parsed as PermissionRequestPayload;
      pending.set(request.requestId, socket);
      socket.on("close", () => pending.delete(request.requestId));
      onRequest(request);
    });
  });
  // WR-01 (03-REVIEW.md): `socketBaseDir` moved from the per-user, mode-0700 OS temp directory to
  // the shared, world-listable `/tmp` to fit `sockaddr_un`'s SUN_LEN limit — the unguessable
  // `randomUUID()` filename component no longer restricts who can find the path, since `/tmp` is
  // listable by every local account. Set an explicit owner-only mode as soon as the socket exists
  // so the reachable audience does not depend on the process umask. Wrapped in a `try`/`catch`
  // whose catch body is deliberately empty apart from this comment: `listen` has already
  // succeeded by this point, so a failed hardening call must degrade to "the socket is reachable
  // but at the default mode" rather than throwing out of a function whose caller
  // (`ClaudeCodeAdapter.startSession`) cannot recover from a throw here without refusing an
  // entire session — a worse outcome than the warning this closes.
  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // See comment above — a failed chmod degrades to the previous (umask-derived) mode.
    }
  });

  return {
    socketPath,
    resolvePermission(requestId, decision) {
      const socket = pending.get(requestId);
      if (!socket) {
        // An answer whose request id matches no held call — ignored, resolves nothing else.
        console.error(`[flywheel-permissions] no held call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify({ decision }) + "\n");
    },
    close() {
      if (closed) return;
      closed = true;
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * The standalone MCP server role. Connects a FRESH socket per tool call to `socketPath`,
 * forwards the call, and resolves ONLY when the socket answers — never locally. The response
 * shape (`{behavior: "allow"|"deny", ...}`) matches Claude Code's own documented
 * `--permission-prompt-tool` contract.
 */
/** Plan 04-03 (D-64): the `report_summary` tool's own registration object, exported so the test
 * suite's structural "no board-entity id" assertion reads the SAME object this server registers,
 * never a duplicated literal copy that could drift from what is actually served. No property name
 * contains `run`, `task`, `project` or `worktree` — identity is derived from the socket the call
 * arrives on, never accepted as an argument (T-04-01, 04-RESEARCH.md Pattern 4). The description's
 * wording is deliberately true to what the acknowledgement means: a receipt, not a database
 * commit (the tool's own text must never tell the model something untrue). */
export const summaryToolDefinition = {
  name: REPORT_SUMMARY_TOOL_NAME,
  description:
    "Record this session's closing summary on the Flywheel board. Resolves once the supervisor has received it.",
  inputSchema: {
    type: "object",
    properties: {
      changed_files: { type: "array", items: { type: "string" } },
      changed_prose: { type: "string" },
      remains: { type: "string" },
      next_session_must_know: { type: "string" },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
          },
          required: ["id", "statement"],
        },
      },
      acknowledged_decisions: { type: "array", items: { type: "string" } },
    },
    required: ["changed_files", "decisions"],
  },
} as const;

async function runStandaloneServer(socketPath: string): Promise<void> {
  const server = new Server({ name: MCP_SERVER_NAME, version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: APPROVE_TOOL_NAME,
        description: "Ask a human on the Flywheel board to allow or deny a gated tool call.",
        inputSchema: {
          type: "object",
          properties: {
            tool_name: { type: "string" },
            input: {},
          },
          required: ["tool_name"],
        },
      },
      summaryToolDefinition,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === APPROVE_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as { tool_name?: string; input?: unknown };
      const requestId = randomUUID();

      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.write(
            JSON.stringify({
              requestId,
              toolName: args.tool_name ?? "unknown_tool",
              input: args.input ?? null,
            }) + "\n",
          );
        });
        socket.on("error", (err) => reject(err));
        const rl = createInterface({ input: socket });
        rl.once("line", (line) => {
          let parsed: { decision: "allow" | "deny" };
          try {
            parsed = JSON.parse(line) as { decision: "allow" | "deny" };
          } catch (err) {
            reject(err);
            return;
          }
          if (parsed.decision === "allow") {
            resolve({
              content: [{ type: "text", text: JSON.stringify({ behavior: "allow", updatedInput: args.input ?? {} }) }],
            });
          } else {
            resolve({
              content: [{ type: "text", text: JSON.stringify({ behavior: "deny", message: "Denied by user" }) }],
            });
          }
        });
        // Deliberately no setTimeout/setInterval anywhere in this function — the promise settles
        // ONLY when the socket answers (AGNT-06's central falsifiability requirement).
      });
    }

    if (request.params.name === REPORT_SUMMARY_TOOL_NAME) {
      // Plan 04-03 (D-64): snake_case tool arguments mapped to the camelCase SummaryReportPayload
      // fields. No argument here names a run, task, project or worktree (T-04-01) — identity is
      // whichever socket this connection reaches, exactly like the approve branch above.
      const args = (request.params.arguments ?? {}) as {
        changed_files?: string[];
        changed_prose?: string;
        remains?: string;
        next_session_must_know?: string;
        decisions?: Array<{ id: string; statement: string }>;
        acknowledged_decisions?: string[];
      };
      const payload: SummaryReportPayload = {
        kind: "session_summary",
        version: 1,
        changedFiles: args.changed_files ?? [],
        changedProse: args.changed_prose,
        remains: args.remains,
        nextSessionMustKnow: args.next_session_must_know,
        decisions: args.decisions ?? [],
        acknowledgedDecisions: args.acknowledged_decisions ?? [],
      };

      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.write(JSON.stringify(payload) + "\n");
        });
        socket.on("error", (err) => reject(err));
        const rl = createInterface({ input: socket });
        rl.once("line", (line) => {
          let parsed: { received?: boolean };
          try {
            parsed = JSON.parse(line) as { received?: boolean };
          } catch (err) {
            reject(err);
            return;
          }
          if (parsed.received === true) {
            resolve({ content: [{ type: "text", text: JSON.stringify({ recorded: true }) }] });
          } else {
            reject(new Error(`unexpected summary acknowledgement shape: ${line}`));
          }
        });
        // Deliberately no setTimeout/setInterval anywhere in this function — matches the approve
        // branch above: the promise settles ONLY when the socket answers.
      });
    }

    throw new Error(`unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const socketPath = process.argv[2];
  if (!socketPath) {
    console.error("usage: mcp-permission-server.js <socketPath>");
    process.exit(1);
  }
  runStandaloneServer(socketPath).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
