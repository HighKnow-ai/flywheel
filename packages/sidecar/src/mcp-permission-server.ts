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

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: unknown;
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
 */
export function startPermissionServer(
  onRequest: (payload: PermissionRequestPayload) => void,
): PermissionServerHandle {
  const socketPath = path.join(os.tmpdir(), `flywheel-permission-${randomUUID()}.sock`);
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
      let parsed: PermissionRequestPayload;
      try {
        parsed = JSON.parse(line) as PermissionRequestPayload;
      } catch {
        socket.destroy();
        return;
      }
      pending.set(parsed.requestId, socket);
      socket.on("close", () => pending.delete(parsed.requestId));
      onRequest(parsed);
    });
  });
  server.listen(socketPath);

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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== APPROVE_TOOL_NAME) {
      throw new Error(`unknown tool: ${request.params.name}`);
    }
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
