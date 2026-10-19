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
 *    `buildClaudeArgv` builds, hosting the permission tool over the stdio transport
 *    (`StdioServerTransport`, matching the backend's own documented `--permission-prompt-tool`
 *    contract), plus the Story agent's board tools (Tasks, issue #52; the hand-off and Check run, issue #53), which ride the same
 *    socket as held `kind: "board_tool"` calls the Rust core answers. Its handler connects a fresh socket to `socketPath` per call, forwards the
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
export const MCP_SERVER_NAME = "flywheel-board";

/** The exact string `--permission-prompt-tool` is given — `mcp__{server}__{tool}`, the shape
 * Claude Code's own CLI reference documents. Declared exactly once in this sidecar's source. */
export const PERMISSION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${APPROVE_TOOL_NAME}`;

/** Issue #52 (docs/mvp-spec.md §4.3): the Story agent's Task board tools, hosted on this SAME
 * server (no second process, no second `--mcp-config` entry). Mirrors `TASK_TOOL_NAMES` in
 * `packages/core/src/domain/task_tool.rs`, which is what parses and runs each call. */
export const TASK_TOOL_NAMES = ["task_list", "task_add", "task_update"] as const;

/** Issue #53 (docs/mvp-spec.md §4.4): the hand-off tool and the feedback-only Check tool, hosted on
 * the same server and relayed the same way. Mirrors `HANDOFF_TOOL_NAMES` in
 * `packages/core/src/domain/handoff.rs`, which is what parses and runs each call. */
export const HANDOFF_TOOL_NAMES = ["checks_run", "handoff"] as const;

/** Every board tool the Story agent has: held calls the Rust core answers. */
export const BOARD_TOOL_NAMES = [...TASK_TOOL_NAMES, ...HANDOFF_TOOL_NAMES] as const;

export type BoardToolName = (typeof BOARD_TOOL_NAMES)[number];

const qualified = (name: string) => `mcp__${MCP_SERVER_NAME}__${name}`;

/** The Task tools' fully-qualified names. */
export const TASK_TOOL_QUALIFIED_NAMES = TASK_TOOL_NAMES.map(qualified);

/** The fully-qualified names `buildClaudeArgv` pre-approves with `--allowedTools`: writing the
 * checklist, running the Checks and handing off cost nothing and must never wait on a permission
 * card. */
export const BOARD_TOOL_QUALIFIED_NAMES = BOARD_TOOL_NAMES.map(qualified);

/** What each board tool tells the agent, and the arguments it takes. */
const BOARD_TOOL_DEFINITIONS = [
  {
    name: "task_list",
    description:
      "Read your Story's Task checklist, in order: each Task's task_id, title, state (open, doing, done, dropped) and drop reason.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "task_add",
    description:
      "Append open Tasks to the end of your Story's checklist. Write your plan this way at the start of your first session. Each change is saved at once. Answers with the whole checklist.",
    inputSchema: {
      type: "object",
      properties: { titles: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["titles"],
    },
  },
  {
    name: "task_update",
    description:
      "Move one Task to open, doing, done or dropped. At most one Task is doing: finish or reopen it first. A dropped Task needs a one-line reason. Answers with the whole checklist.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        state: { type: "string", enum: ["open", "doing", "done", "dropped"] },
        reason: { type: "string", description: "One line, required when state is dropped and only then." },
      },
      required: ["task_id", "state"],
    },
  },
  {
    name: "checks_run",
    description:
      "Run your Story's Checks now, for feedback only: each runs from the worktree root, one at a time, and nothing is recorded. Answers with each Check's command, result (passed, failed, timed_out) and output tail. Checks can take minutes. You cannot edit or delete a Check: only the developer can.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "handoff",
    description:
      "Hand your Story off for review once its work is committed. Bring your Task checklist up to date first, with no Task left doing: the hand-off is refused otherwise. Flywheel then runs every Check, records each result against your branch's commit, and moves the Story to In review whatever the results. Leave a summary for the next session: what it must know, and what was decided (including any Check you think is wrong, and why). End your turn once it answers.",
    inputSchema: {
      type: "object",
      properties: {
        next_session_must_know: { type: "string", minLength: 1 },
        decisions: { type: "string" },
      },
      required: ["next_session_must_know", "decisions"],
    },
  },
] as const;

/** Issue #52: the wire shape a Task tool call sends over the per-run socket. A HELD call, like the
 * permission request: the agent waits for the Rust core's answer (the checklist, or the reason it
 * refused). Carries no run, session or Story id: identity comes from the socket the call arrives
 * on, never from an argument. */
export interface BoardToolRequestPayload {
  kind: "board_tool";
  requestId: string;
  tool: BoardToolName;
  args: unknown;
}

function isBoardToolPayload(parsed: unknown): parsed is BoardToolRequestPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "board_tool" &&
    typeof (parsed as { requestId?: unknown }).requestId === "string"
  );
}

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: unknown;
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

export interface PermissionServerHandle {
  /** The Unix domain socket path the standalone server (spawned by the backend) connects to —
   * embedded verbatim into the `--mcp-config` JSON `buildClaudeArgv` builds. */
  socketPath: string;
  /** Settle a held call. A `requestId` matching no held call is ignored with a logged notice and
   * resolves nothing else — never an error, and never treated as "resolve some other call
   * instead." */
  resolvePermission(requestId: string, decision: "allow" | "deny"): void;
  /** Issue #52: settle a held Task tool call with the core's checklist, or with the reason it
   * refused. Shares `pending` and the "an unknown requestId is ignored with a logged notice"
   * contract with {@link resolvePermission}. */
  answerBoardTool(requestId: string, result: unknown, error?: string): void;
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
 */
export function startPermissionServer(
  onRequest: (payload: PermissionRequestPayload) => void,
  onNotice: (payload: PermissionNoticePayload) => void,
  onBoardTool?: (payload: BoardToolRequestPayload) => void,
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

      // Issue #52: a Task tool call carries `kind: "board_tool"` exactly, checked BEFORE the broader
      // notice check below (which matches any string `kind`). It is HELD like a permission request,
      // because the agent needs the core's answer back. With no handler there is nobody to answer,
      // so the call is refused at once rather than left hanging.
      if (isBoardToolPayload(parsed)) {
        if (!onBoardTool) {
          socket.end(JSON.stringify({ error: "this session has no Task board tool" }) + "\n");
          return;
        }
        pending.set(parsed.requestId, socket);
        socket.on("close", () => pending.delete(parsed.requestId));
        onBoardTool(parsed);
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
        console.error(`[flywheel-board] no held call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify({ decision }) + "\n");
    },
    answerBoardTool(requestId, result, error) {
      const socket = pending.get(requestId);
      if (!socket) {
        console.error(`[flywheel-board] no held board tool call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify(error !== undefined ? { error } : { result: result ?? null }) + "\n");
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
 * Issue #52: forward one Task tool call over a fresh socket and settle ONLY when the Rust core's
 * answer comes back through the sidecar. The arguments are passed through untouched: the core
 * parses and refuses them, this process validates nothing. A refusal reaches the agent as a tool
 * error carrying the core's own reason, so it can correct the call.
 */
function relayBoardToolCall(
  socketPath: string,
  tool: BoardToolName,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      const payload: BoardToolRequestPayload = { kind: "board_tool", requestId, tool, args };
      socket.write(JSON.stringify(payload) + "\n");
    });
    socket.on("error", (err) => reject(err));
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: { result?: unknown; error?: string };
      try {
        parsed = JSON.parse(line) as { result?: unknown; error?: string };
      } catch (err) {
        reject(err);
        return;
      }
      if (typeof parsed.error === "string") {
        resolve({ content: [{ type: "text", text: parsed.error }], isError: true });
      } else {
        resolve({ content: [{ type: "text", text: JSON.stringify(parsed.result ?? null) }] });
      }
    });
  });
}

/**
 * The standalone MCP server role. Connects a FRESH socket per tool call to `socketPath`,
 * forwards the call, and resolves ONLY when the socket answers — never locally. The response
 * shape (`{behavior: "allow"|"deny", ...}`) matches Claude Code's own documented
 * `--permission-prompt-tool` contract. It hosts `approve_action` and the board tools ({@link BOARD_TOOL_NAMES}).
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
      ...BOARD_TOOL_DEFINITIONS,
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

    if ((BOARD_TOOL_NAMES as readonly string[]).includes(request.params.name)) {
      return relayBoardToolCall(socketPath, request.params.name as BoardToolName, request.params.arguments ?? {});
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
