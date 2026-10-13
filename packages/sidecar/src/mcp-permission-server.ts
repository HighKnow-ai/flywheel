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
 *
 * Plan 05-02 (D-64's own precedent, applied a second time): this server now carries a THIRD role
 * — Phase 5's epic-authoring write surface (`propose_task`, the first of a `propose_`/`amend_`/
 * `delete_` family plan 05-05 grows). It lives on this SAME server rather than a second one —
 * zero new socket, zero new spawned process, zero new `--mcp-config` entry, exactly like
 * `report_summary` before it. Every write-capable authoring tool is named with a `propose_`/
 * `amend_`/`delete_` prefix ON PURPOSE: plan 05-03's stage gate needs a single `PreToolUse`
 * matcher (`mcp__<server>__(propose|amend|delete)_.*`) to separate these tools from
 * `approve_action`/`report_summary` WITHOUT enumerating names — that prefix convention is
 * load-bearing, not cosmetic.
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

/** Plan 05-02 (D-80/D-81): the raw tool name for the agent's own "stage a proposed task" call —
 * the first of the `propose_`/`amend_`/`delete_` family this module's own header comment
 * describes. Declared beside {@link APPROVE_TOOL_NAME}/{@link REPORT_SUMMARY_TOOL_NAME} so the
 * three names can never be confused with each other. */
export const PROPOSE_TASK_TOOL_NAME = "propose_task";

/** The fully-qualified string composed exactly like {@link PERMISSION_TOOL_NAME}/
 * {@link SUMMARY_TOOL_NAME} — declared exactly once. */
export const AUTHORING_PROPOSE_TASK_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_TASK_TOOL_NAME}`;

/** Plan 05-05 (D-80/D-81): the remaining five roles of the `propose_`/`amend_`/`delete_` write-tool
 * family this module's own header comment promises — each declared in the SAME raw-plus-fully-
 * qualified pair every tool name in this file already uses, so plan 05-03's stage-gate matcher and
 * this server's own registration can never drift apart. Adding a SEVENTH write tool requires no
 * edit to that matcher (it is a name-prefix regex, not an enumeration); adding a READ tool must
 * stay outside this same prefix for the identical reason — see {@link BOARD_SEARCH_TOOL_NAME} and
 * its siblings below, deliberately named outside it. */
export const PROPOSE_EPIC_TOOL_NAME = "propose_epic";
export const AUTHORING_PROPOSE_EPIC_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_EPIC_TOOL_NAME}`;

export const PROPOSE_CRITERION_TOOL_NAME = "propose_criterion";
export const AUTHORING_PROPOSE_CRITERION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_CRITERION_TOOL_NAME}`;

export const PROPOSE_ASSUMPTION_TOOL_NAME = "propose_assumption";
export const AUTHORING_PROPOSE_ASSUMPTION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_ASSUMPTION_TOOL_NAME}`;

export const AMEND_PROPOSAL_TOOL_NAME = "amend_proposal";
export const AUTHORING_AMEND_PROPOSAL_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${AMEND_PROPOSAL_TOOL_NAME}`;

export const DELETE_PROPOSAL_TOOL_NAME = "delete_proposal";
export const AUTHORING_DELETE_PROPOSAL_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${DELETE_PROPOSAL_TOOL_NAME}`;

/** Every write-capable authoring tool's fully-qualified name, in registration order — the ONE list
 * `claude-code-adapter.ts`'s `startAuthoringSession` pre-approves via `--allowedTools` (D-46:
 * staging a proposal burns no money and blocks nothing, so it must never wait on a human permission
 * answer — the stage gate, not the permission gate, refuses a proposal at the wrong time). */
export const AUTHORING_WRITE_TOOL_NAMES = [
  AUTHORING_PROPOSE_EPIC_TOOL_NAME,
  AUTHORING_PROPOSE_TASK_TOOL_NAME,
  AUTHORING_PROPOSE_CRITERION_TOOL_NAME,
  AUTHORING_PROPOSE_ASSUMPTION_TOOL_NAME,
  AUTHORING_AMEND_PROPOSAL_TOOL_NAME,
  AUTHORING_DELETE_PROPOSAL_TOOL_NAME,
] as const;

/** Plan 05-05 (D-87): the three capped read tools — deliberately named OUTSIDE the
 * `propose_`/`amend_`/`delete_` prefix so plan 05-03's stage-gate matcher never catches them; a
 * read is available in every stage (D-88 gates writing a proposal, never looking something up). */
export const BOARD_SEARCH_TOOL_NAME = "board_search";
export const AUTHORING_BOARD_SEARCH_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${BOARD_SEARCH_TOOL_NAME}`;

export const EPIC_GET_TOOL_NAME = "epic_get";
export const AUTHORING_EPIC_GET_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${EPIC_GET_TOOL_NAME}`;

export const TASK_LIST_TOOL_NAME = "task_list";
export const AUTHORING_TASK_LIST_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${TASK_LIST_TOOL_NAME}`;

/** Plan 05-44 (gap G-05-9, D-87's fourth capped read): a proposal staged this session is never
 * handed its own id — `stageAuthoringProposal` resolves EVERY `propose_*` call with the literal
 * `{"staged": true}` and no agent-visible tool could read the id back, so `propose_criterion`'s
 * REQUIRED `parent_proposal_id` was unreachable in a fresh-epic session by construction. This tool
 * reads the run's OWN still-pending proposals back through the SAME `board_read` channel the other
 * three read tools already use — deliberately named OUTSIDE the `propose_`/`amend_`/`delete_`
 * prefix for the identical reason `BOARD_SEARCH_TOOL_NAME` and its siblings are: a read is
 * available in every stage (D-88 gates writing a proposal, never looking something up), and
 * plan 05-03's stage-gate matcher must never catch it. */
export const PROPOSAL_LIST_TOOL_NAME = "proposal_list";
export const AUTHORING_PROPOSAL_LIST_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSAL_LIST_TOOL_NAME}`;

/** The four capped read tools' own fully-qualified names — pre-approved via `--allowedTools` alongside
 * {@link AUTHORING_WRITE_TOOL_NAMES} for the identical D-46 reason: a bounded, scoped-server-side
 * board lookup costs nothing and blocks nothing, so it must never wait on a human permission
 * answer either. */
export const AUTHORING_READ_TOOL_NAMES = [
  AUTHORING_BOARD_SEARCH_TOOL_NAME,
  AUTHORING_EPIC_GET_TOOL_NAME,
  AUTHORING_TASK_LIST_TOOL_NAME,
  AUTHORING_PROPOSAL_LIST_TOOL_NAME,
] as const;

/** The documented ceiling every read tool's `inputSchema` advertises for its own `limit` property
 * — mirrors `query::authoring::MAX_LIMIT` on the Rust side (the value that actually clamps; this
 * is schema documentation only, belt-and-suspenders with the server-side clamp). */
export const MAX_READ_LIMIT = 500;

/** Plan 06-01 (D-98): the raw tool name an ORDINARY task-execution run calls to stage a proposal
 * onto its own project's triage lane — deliberately declared BESIDE the six authoring
 * `propose_`/`amend_`/`delete_` names above, never added to {@link AUTHORING_WRITE_TOOL_NAMES} or
 * {@link AUTHORING_READ_TOOL_NAMES}: this is one new tool an execution run reaches, not a seventh
 * member of the authoring write family. It still shares the `propose_` prefix (D-98's locked
 * choice), which is exactly why `writeHookSettings`'s `includeAuthoringStageGate` parameter
 * (`claude-code-adapter.ts`, `06-RESEARCH.md` Pitfall 1) exists — an execution run's settings file
 * must carry NO `AUTHORING_STAGE_GATE_MATCHER` entry, or this tool's every call would be denied by
 * the authoring stage gate before this server's own handler is ever reached. */
export const PROPOSE_ITEM_TOOL_NAME = "propose_item";

/** The fully-qualified string `claude-code-adapter.ts`'s execution-run `startSession` pushes onto
 * `--allowedTools` — composed exactly like every other fully-qualified tool name in this file. */
export const EXECUTION_PROPOSE_ITEM_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_ITEM_TOOL_NAME}`;

/** Plan 09-08 (PLAN-01, D-147): the raw tool name the PRE-DISPATCH PLANNING run calls, once, to hand
 * Flywheel a file-set and a wave for each task of an epic. Deliberately NOT prefixed `propose_`: it
 * stages nothing for triage, it declares, and the authoring stage gate's `propose|amend|delete`
 * matcher must never catch it. The server lists it to EVERY run (one fixed tool array), so its
 * visibility is not a control: the Rust core refuses a call from anything that is not a running
 * planning run. */
export const SUBMIT_PLAN_RAW_TOOL_NAME = "submit_plan";

/** The fully-qualified string a planning launch pushes onto `--allowedTools` — and the ONLY tool it
 * pre-approves. Composed exactly like every other fully-qualified tool name in this file. */
export const SUBMIT_PLAN_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${SUBMIT_PLAN_RAW_TOOL_NAME}`;

/** Plan 06-01 (D-97): the three target types an execution-run's `propose_item` call may stage —
 * mirrors `domain::authoring_proposal::ProposalTargetType`'s vocabulary, restricted to the three
 * an execution run (rather than an epic-authoring session) ever proposes. */
export const PROPOSE_ITEM_TARGET_TYPES = ["task", "issue", "epic"] as const;

/** Plan 06-01 (D-98): the four issue kinds `propose_item`'s `kind` property accepts when
 * `target_type` is `issue` — mirrors `domain::authoring_proposal::ISSUE_KINDS` exactly, so the two
 * can never drift apart. */
export const PROPOSE_ITEM_ISSUE_KINDS = ["bug", "idea", "question", "risk"] as const;

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

/** Plan 05-02 (D-80/D-81/D-83): the wire shape `propose_task`'s standalone-server handler writes
 * over the per-run socket, and {@link startPermissionServer}'s `onProposal` callback receives —
 * mirrors {@link SummaryReportPayload}'s own precedent exactly. `kind: "authoring_proposal"` is
 * the EXACT string {@link isAuthoringProposalPayload} checks, mirroring {@link isSummaryPayload}'s
 * own discipline. Carries NO `runId`/`projectId`/`epicId` field — identity is derived from the
 * socket the call arrives on, never accepted as a caller-supplied argument (T-05-02-01), exactly
 * like {@link SummaryReportPayload}'s own header comment states of itself. */
export interface AuthoringProposalPayload {
  kind: "authoring_proposal";
  /** Plan 05-48 (D-80/D-81/D-92): the held-call correlation id — minted by `randomUUID()` inside
   * {@link stageAuthoringProposal}, never by the model's own tool-call arguments. Names a call
   * still WAITING for an answer, the same way {@link BoardReadRequestPayload.requestId} does; the
   * connection is HELD in `pending` (keyed by this value) until {@link
   * PermissionServerHandle.answerProposalStaged} settles it. */
  requestId: string;
  verb: "create" | "amend" | "delete";
  /** Widened by plan 06-01 (D-97) to add `"issue"` — the one target type an execution-run's
   * `propose_item` call can stage that an authoring session never proposes. */
  targetType: "epic" | "task" | "criterion" | "assumption" | "issue";
  targetId?: string;
  parentProposalId?: string;
  /** Plan 05-05 (`delete_proposal`): the agent's own stated reason for proposing a deletion.
   * Present only on a `delete` verb. Carried on the outer wire shape rather than folded into
   * `payload` (which must stay a valid target-typed `ProposalPayload` shape the Rust core can
   * deserialise) — an extra field the core's inbound applier does not yet read is harmless,
   * never a shape it must reject. */
  reason?: string;
  /** Plan 06-01 (PROP-07, D-99): an execution-run `propose_item` call's own stated reason for
   * this proposal — REQUIRED at that tool's own schema layer, always present on a `propose_item`
   * call, always absent on every authoring `propose_*`/`amend_*`/`delete_*` call (none of those
   * tool schemas declare this property). Rides the OUTER wire shape, like {@link reason} above,
   * rather than being folded into `payload` — `payload` stays a shape the Rust core can
   * deserialise directly into `ProposalPayload`, and the core reads this field from the event's
   * TOP LEVEL, never out of `payload` (T-06-02). */
  rationale?: string;
  payload: Record<string, unknown>;
}

/** Plan 05-05 (D-87): the wire shape a `board_search`/`epic_get`/`task_list` tool call sends over
 * the per-run socket — reusing the permission gate's own request-AND-ANSWER shape (a HELD
 * connection, distinguished from {@link SummaryReportPayload}/{@link AuthoringProposalPayload}'s
 * fire-and-forget notice shape because a read needs an actual answer back, not just a receipt).
 * `kind: "board_read"` is the EXACT string {@link isBoardReadPayload} checks, mirroring
 * {@link isSummaryPayload}'s own discipline. Carries NO project id anywhere — identity is derived
 * server-side from the run, exactly like every other authoring payload in this file. */
export interface BoardReadRequestPayload {
  kind: "board_read";
  requestId: string;
  readKind: "search" | "get_epic" | "list_tasks" | "list_proposals";
  term?: string;
  epicId?: string;
  limit?: number;
}

/** Plan 09-08: the wire shape `submit_plan` writes over the per-run socket — a HELD call, like
 * {@link BoardReadRequestPayload}: the agent's call blocks until the Rust core answers with the plan
 * id or with the reason it was refused. `kind: "submit_plan"` is the EXACT string
 * {@link isSubmitPlanPayload} checks. Carries no run, project, epic or plan id: identity is derived
 * from the socket the call arrives on, never from an argument. */
export interface SubmitPlanPayload {
  kind: "submit_plan";
  requestId: string;
  tasks: Array<{ key: string; files: string[]; wave: number; rationale: string }>;
  excluded: Array<{ key: string; reason: string }>;
}

/** Plan 03-13 (D-53): the shim's fire-and-forget notice shape — `kind` is what distinguishes this
 * from {@link PermissionRequestPayload} on the wire (the routine payload never carries a `kind`
 * field at all). `runId` is the shim's own `FLYWHEEL_RUN_ID`; every other field is notice-specific
 * (`attempt`/`max`/`repository`/`command` for a retry, `repository`/`command`/`attempts` for an
 * exhaustion, `path`/`tool`/`toolUseId`/`outsideWorktree` for a `scope_denied` sent by
 * `scope-hook.ts`) — carried through verbatim rather than typed per-kind here, since this module has no
 * opinion on what a notice's payload means, only on routing it to `onNotice` unanswered. */
export interface PermissionNoticePayload {
  kind: "git_retry" | "git_lock_exhausted" | "scope_denied";
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

/** Plan 05-02 (D-80/D-81): checks the EXACT `kind: "authoring_proposal"` string — mirrors
 * {@link isSummaryPayload}'s own discipline. Checked BEFORE {@link isNoticePayload}'s broader
 * "carries some string `kind`" check in the connection handler below, for the identical reason a
 * summary payload is: `isNoticePayload` would otherwise also match this shape. */
function isAuthoringProposalPayload(parsed: unknown): parsed is AuthoringProposalPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "authoring_proposal" &&
    typeof (parsed as { requestId?: unknown }).requestId === "string"
  );
}

/** Plan 05-05 (D-87): checks the EXACT `kind: "board_read"` string — mirrors
 * {@link isAuthoringProposalPayload}'s own discipline. Checked BEFORE {@link isNoticePayload}'s
 * broader "carries some string `kind`" check, for the identical reason a proposal payload is. */
function isBoardReadPayload(parsed: unknown): parsed is BoardReadRequestPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "board_read"
  );
}

/** Plan 09-08: checks the EXACT `kind: "submit_plan"` string, ahead of {@link isNoticePayload}'s
 * broader "carries some string `kind`" check, for the identical reason the other guards are. */
function isSubmitPlanPayload(parsed: unknown): parsed is SubmitPlanPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "submit_plan" &&
    typeof (parsed as { requestId?: unknown }).requestId === "string"
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
  /** Plan 05-05 (D-87): answer a held `board_read` call with its result (or an error string) — the
   * read-path sibling of {@link resolvePermission}, sharing the SAME `pending` map and the SAME
   * "a requestId matching no held call is ignored with a logged notice" contract; a distinct
   * method only because the settled payload shape differs (`{result}`/`{error}` vs `{decision}`). */
  answerBoardRead(requestId: string, result: unknown, error?: string): void;
  /** Plan 05-48 (D-80/D-81/D-92): answer a held proposal-staging call with its core-minted result
   * (or an error string) — the staging-path sibling of {@link answerBoardRead}, sharing the SAME
   * `pending` map and the SAME "a requestId matching no held call is ignored with a logged
   * notice" contract; a distinct method only because the settled payload shape differs
   * (`{result: {proposalId}}`/`{error}` — deliberately identical wire shape to `answerBoardRead`,
   * just documented under its own name for this call's own purpose). Plan 09-08: a held
   * `submit_plan` call is answered through this same method (`{result: {planId}}` or `{error}`),
   * so the Rust core needs no second answering op. */
  answerProposalStaged(requestId: string, result: unknown, error?: string): void;
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
 *
 * `onProposal` (plan 05-02, D-80/D-81; widened plan 05-48, D-80/D-81/D-92) is invoked once per
 * incoming connection whose parsed line carries `kind: "authoring_proposal"` — a THIRD message
 * kind on this SAME socket, mirroring `onSummary`'s own precedent for the message-kind split, but
 * UNLIKE `onSummary` this connection IS held in `pending` (like the routine permission-request
 * and `board_read` paths), because the caller needs the core-minted `proposalId` back, not just a
 * receipt. Checked BEFORE the `onNotice` branch (see {@link isAuthoringProposalPayload}), settled
 * later by {@link PermissionServerHandle.answerProposalStaged}. Optional, defaulting to a no-op,
 * so every existing call site (production and test) that predates plan 05-02 keeps compiling
 * unchanged.
 *
 * `onBoardRead` (plan 05-05, D-87) is invoked once per incoming connection whose parsed line
 * carries `kind: "board_read"` — a FOURTH message kind on this SAME socket, but unlike `onNotice`/
 * `onSummary`/`onProposal` it IS held in `pending` (like the routine permission-request path),
 * because a read needs an actual answer back, not just a receipt acknowledgement. Optional,
 * defaulting to a no-op, for the same additive-capability-growth reason `onProposal` is.
 *
 * `onPlanSubmitted` (plan 09-08) is invoked once per incoming connection whose parsed line carries
 * `kind: "submit_plan"` — a FIFTH message kind on this SAME socket, HELD in `pending` and answered
 * through {@link PermissionServerHandle.answerProposalStaged}. Optional, defaulting to a no-op.
 */
export function startPermissionServer(
  onRequest: (payload: PermissionRequestPayload) => void,
  onNotice: (payload: PermissionNoticePayload) => void,
  onSummary: (payload: SummaryReportPayload) => void,
  onProposal: (payload: AuthoringProposalPayload) => void = () => {},
  onBoardRead: (payload: BoardReadRequestPayload) => void = () => {},
  onPlanSubmitted: (payload: SubmitPlanPayload) => void = () => {},
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

      // Plan 05-48 (D-80/D-81/D-92): an authoring proposal carries `kind: "authoring_proposal"`
      // EXACTLY — checked BEFORE the broader isNoticePayload check below, mirroring the summary
      // branch immediately above. UNLIKE a summary, this connection IS held in `pending` (keyed by
      // the caller's own `requestId`, mirroring the `board_read` branch immediately below) — a
      // staging call needs the core-minted `proposalId` back, not just a receipt, so
      // `answerProposalStaged` resolves it later exactly as `answerBoardRead` resolves its own
      // held call.
      if (isAuthoringProposalPayload(parsed)) {
        pending.set(parsed.requestId, socket);
        socket.on("close", () => pending.delete(parsed.requestId));
        onProposal(parsed);
        return;
      }

      // Plan 05-05 (D-87): a board read carries `kind: "board_read"` EXACTLY — checked BEFORE the
      // broader isNoticePayload check below, mirroring the summary/proposal branches above. UNLIKE
      // those two, this connection IS held in `pending` (keyed by the caller's own `requestId`,
      // never the routine `PermissionRequestPayload`'s implicit shape) — a read needs an actual
      // answer, not just a receipt, so `answerBoardRead` resolves it later exactly as
      // `resolvePermission` resolves a routine held call.
      if (isBoardReadPayload(parsed)) {
        pending.set(parsed.requestId, socket);
        socket.on("close", () => pending.delete(parsed.requestId));
        onBoardRead(parsed);
        return;
      }

      // Plan 09-08: a plan submission carries `kind: "submit_plan"` EXACTLY. HELD in `pending` like a
      // board read: the planning agent needs the Rust core's verdict back, in the same call, so a
      // refusal can be corrected. `onPlanSubmitted` defaults to a no-op, like `onProposal`, so the
      // callers that predate this plan compile unchanged — and a caller that does not wire it leaves
      // the agent waiting forever, which `submit-plan-wire.test.mjs` exists to catch.
      if (isSubmitPlanPayload(parsed)) {
        pending.set(parsed.requestId, socket);
        socket.on("close", () => pending.delete(parsed.requestId));
        onPlanSubmitted(parsed);
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
    answerBoardRead(requestId, result, error) {
      const socket = pending.get(requestId);
      if (!socket) {
        console.error(`[flywheel-permissions] no held board_read call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify(error !== undefined ? { error } : { result }) + "\n");
    },
    answerProposalStaged(requestId, result, error) {
      const socket = pending.get(requestId);
      if (!socket) {
        console.error(`[flywheel-permissions] no held proposal staging call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify(error !== undefined ? { error } : { result }) + "\n");
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
    "Record this session's closing summary on the Flywheel board. Resolves once the supervisor " +
    "has received it. For a coding session, describe what changed. For a shaping (epic-authoring) " +
    "session, describe what the epic is now understood to be, what is still unsettled, and what " +
    "the next session on this epic must know — `changed_files` does not apply and may be omitted.",
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
    // Plan 05-09: `changed_files` is no longer required — a shaping (epic-authoring) session has
    // no diff to describe, and asking the model to supply an empty array on every closing call
    // for a run that structurally can never have one is friction with no benefit. `decisions`
    // stays required: every session, coding or shaping, should be able to say what it settled.
    required: ["decisions"],
  },
} as const;

/** Plan 06-01 (D-98): the `propose_item` tool's own registration object — an ORDINARY
 * task-execution run's one write surface onto its own project's triage lane, mirroring
 * {@link proposeTaskToolDefinition}'s "no run/task/project/epic id property anywhere" discipline
 * (T-06-01) exactly. `kind` here is the ISSUE's own bug/idea/question/risk discriminant
 * (meaningful only when `target_type` is `issue`) — a different thing from this schema's own
 * "which target type" selector (`target_type`), never confused because they are two separate
 * properties. The description states plainly that this STAGES a proposal for a human to
 * triage — it does not create a board item. */
export const proposeItemToolDefinition = {
  name: PROPOSE_ITEM_TOOL_NAME,
  description:
    "Stage a proposed task, issue or epic on the Flywheel board, from an ordinary task-execution " +
    "run. This does NOT create a board item — it stages a proposal for a human to triage.",
  inputSchema: {
    type: "object",
    properties: {
      target_type: { type: "string", enum: PROPOSE_ITEM_TARGET_TYPES },
      title: { type: "string", minLength: 1, maxLength: 500 },
      body: { type: "string" },
      kind: {
        type: "string",
        enum: PROPOSE_ITEM_ISSUE_KINDS,
        description: "Meaningful only when target_type is issue.",
      },
      rationale: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["target_type", "title", "rationale"],
  },
} as const;

/** Plan 05-02 (D-80/D-81): the `propose_task` tool's own registration object — exported so the
 * test suite reads the SAME object this server registers, mirroring {@link summaryToolDefinition}'s
 * own precedent exactly. `title`/`description` only — no `run`/`task`/`project`/`epic` id
 * property anywhere in this schema (T-05-02-01): identity is resolved from the socket the call
 * arrives on. The description tells the model plainly that this STAGES a proposal for a human to
 * accept — it does not create a task — so the tool's own text is never untrue about what calling
 * it does. `title`'s max length matches `commands/epic.rs::MAX_TITLE_LEN` (500). */
export const proposeTaskToolDefinition = {
  name: PROPOSE_TASK_TOOL_NAME,
  description:
    "Stage a proposed task for this epic on the Flywheel board. This does NOT create a task — it " +
    "drafts one for a human to review, edit and accept.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 500 },
      description: { type: "string" },
      parent_proposal_id: { type: "string" },
    },
    required: ["title"],
  },
} as const;

/** Plan 05-05 (D-80/D-81): `propose_epic`'s own registration object, mirroring
 * {@link proposeTaskToolDefinition}'s exact shape — no `run`/`task`/`project`/`epic` id property
 * anywhere (T-05-05-01), and the description is plain about staging rather than creating. */
export const proposeEpicToolDefinition = {
  name: PROPOSE_EPIC_TOOL_NAME,
  description:
    "Stage a proposed epic on the Flywheel board. This does NOT create an epic — it drafts one " +
    "for a human to review, edit and accept.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 500 },
      // WR-01 (plan 05-09 code review): matches core's own MAX_PROPOSAL_TEXT_LEN (1000), now
      // actually enforced by `create_proposal_in_tx`'s call to `validate_payload` — the schema
      // documents the bound that will now really run, not a stale aspiration.
      description: { type: "string", maxLength: 1000 },
    },
    required: ["title"],
  },
} as const;

/** Plan 05-05 (D-07/D-81): `propose_criterion`'s own registration object. `parent_proposal_id` is
 * REQUIRED — D-07 puts criteria on tasks and epics and nowhere else, and a drafted criterion has
 * no canonical parent until its own parent proposal is accepted, so this is the schema-layer
 * rejection point for a criterion with nowhere to hang. Plan 05-48 (D-80/D-81/D-92, gap G-05-10):
 * the description now names the `proposalId` a staging call itself resolves with as the source of
 * that id — `proposal_list` (plan 05-44's own fix) is no longer the only way to obtain it, now
 * that every staging call answers synchronously within the same tool call.
 * `required`/`minLength` are otherwise UNCHANGED, D-07's schema-layer rejection point stays
 * exactly as it was, it now simply has a reachable way to be satisfied. */
export const proposeCriterionToolDefinition = {
  name: PROPOSE_CRITERION_TOOL_NAME,
  description:
    "Stage a proposed acceptance criterion on the Flywheel board, for a task or epic you already " +
    "proposed earlier in this session (required: parent_proposal_id — this is the proposalId " +
    "value the earlier propose_epic/propose_task call itself resolved with). This does NOT " +
    "create a criterion — it drafts one for a human to review, edit and accept.",
  inputSchema: {
    type: "object",
    properties: {
      // WR-01: maxLength 1000 matches core's MAX_PROPOSAL_TEXT_LEN, now actually enforced via
      // `validate_payload` on the create path (previously only `amend_proposal` enforced it).
      statement: { type: "string", minLength: 1, maxLength: 1000 },
      parent_proposal_id: { type: "string", minLength: 1 },
      verification_hint: { type: "string", maxLength: 1000 },
    },
    required: ["statement", "parent_proposal_id"],
  },
} as const;

/** Plan 05-05 (D-89): `propose_assumption`'s own registration object — the tool D-89's distillation
 * turn asks the agent to call once per assumption it challenged, never once with a list (Pitfall 3:
 * a distilled assumption is a first-class structured row, never prose folded into another row's
 * field). `answer` is optional at the SCHEMA layer (an assumption may be surfaced before it is
 * answered); the wire payload still always carries a string `answer` field (defaulting to empty),
 * matching the Rust core's own `ProposalPayload::Assumption` shape. */
export const proposeAssumptionToolDefinition = {
  name: PROPOSE_ASSUMPTION_TOOL_NAME,
  description:
    "Stage ONE distilled assumption-and-answer row on the Flywheel board — call this once per " +
    "assumption, never once with a list of several. This does NOT write to the board directly — " +
    "it drafts a row for a human to review, edit and accept.",
  inputSchema: {
    type: "object",
    properties: {
      // WR-01: maxLength 1000 matches core's MAX_PROPOSAL_TEXT_LEN, now actually enforced via
      // `validate_payload` on the create path.
      assumption: { type: "string", minLength: 1, maxLength: 1000 },
      answer: { type: "string", maxLength: 1000 },
    },
    required: ["assumption"],
  },
} as const;

/** The `target_type` vocabulary `amend_proposal`/`delete_proposal` accept — a real, canonical
 * board row only (never `assumption`, which is never itself a canonical row). */
const AMEND_DELETE_TARGET_TYPES = ["epic", "task", "criterion"] as const;
type AmendDeleteTargetType = (typeof AMEND_DELETE_TARGET_TYPES)[number];

/** Plan 05-05 (D-81): `amend_proposal`'s own registration object. `target_id` names a CANONICAL
 * board row (a real epic, task or criterion already accepted) — never a staged proposal of this
 * session's own, which is the developer's own edit path (D-94), not the agent's; the description
 * says so plainly so the model does not try to rewrite its own pending proposals. */
export const amendProposalToolDefinition = {
  name: AMEND_PROPOSAL_TOOL_NAME,
  description:
    "Propose amending an EXISTING board item (a real epic, task or criterion already accepted onto " +
    "the board) — never one of your own still-pending proposals, which the human amends directly. " +
    "This does NOT edit the item — it drafts a change for a human to review, edit and accept.",
  inputSchema: {
    type: "object",
    properties: {
      target_id: { type: "string", minLength: 26, maxLength: 26 },
      target_type: { type: "string", enum: [...AMEND_DELETE_TARGET_TYPES] },
      title: { type: "string" },
      description: { type: "string" },
      statement: { type: "string" },
      verification_hint: { type: "string" },
    },
    required: ["target_id", "target_type"],
  },
} as const;

/** Plan 05-05 (D-81): `delete_proposal`'s own registration object — mirrors
 * {@link amendProposalToolDefinition}'s "canonical row only" discipline exactly. `reason` is
 * REQUIRED: a delete proposal is staged regardless (D-81: safety comes from the human accept gate,
 * not from refusing the verb), but the reason is what lets the tray and a later distillation turn
 * say why. */
export const deleteProposalToolDefinition = {
  name: DELETE_PROPOSAL_TOOL_NAME,
  description:
    "Propose deleting an EXISTING board item (a real epic, task or criterion already accepted onto " +
    "the board). This does NOT delete anything — it drafts the deletion for a human to review and " +
    "accept.",
  inputSchema: {
    type: "object",
    properties: {
      target_id: { type: "string", minLength: 26, maxLength: 26 },
      target_type: { type: "string", enum: [...AMEND_DELETE_TARGET_TYPES] },
      reason: { type: "string", minLength: 1 },
      title: { type: "string" },
      description: { type: "string" },
      statement: { type: "string" },
      verification_hint: { type: "string" },
    },
    required: ["target_id", "target_type", "reason"],
  },
} as const;

/** Plan 05-05: the three capped read tools' own registration objects — deliberately named outside
 * the `propose_`/`amend_`/`delete_` prefix (this module's own header comment), available in every
 * stage. Every `limit` property is optional and documents {@link MAX_READ_LIMIT} as its ceiling;
 * the actual clamp is enforced server-side by `query::authoring`'s own `resolve_limit`. */
export const boardSearchToolDefinition = {
  name: BOARD_SEARCH_TOOL_NAME,
  description:
    "Search the board (epics, tasks and issues) for a term. Bounded to a page — check the " +
    "`truncated` field in the result before assuming you have seen everything.",
  inputSchema: {
    type: "object",
    properties: {
      term: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: MAX_READ_LIMIT },
    },
    required: ["term"],
  },
} as const;

export const epicGetToolDefinition = {
  name: EPIC_GET_TOOL_NAME,
  description:
    "Look up one epic by id, scoped to this session's own project. Returns not-found for an epic " +
    "id outside this project, or one that does not exist at all — the two cases look identical on " +
    "purpose.",
  inputSchema: {
    type: "object",
    properties: {
      epic_id: { type: "string", minLength: 1 },
    },
    required: ["epic_id"],
  },
} as const;

export const taskListToolDefinition = {
  name: TASK_LIST_TOOL_NAME,
  description:
    "List the tasks under one epic, with each task's current acceptance criteria. Bounded to a " +
    "page — check the `truncated` field in the result before assuming you have seen everything.",
  inputSchema: {
    type: "object",
    properties: {
      epic_id: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: MAX_READ_LIMIT },
    },
    required: ["epic_id"],
  },
} as const;

/** Plan 05-44 (gap G-05-9), reframed plan 05-48 (D-80/D-81/D-92, gap G-05-10): `proposal_list`'s
 * own registration object. Lists the proposals THIS session has staged and not yet decided on —
 * no `run_id`/`project_id`/`epic_id`/`task_id` property of any kind, because the run is resolved
 * server-side from the socket this call arrives on, exactly like every write tool in this file
 * (T-05-02-01). A review aid only, NOT where `propose_criterion`'s REQUIRED `parent_proposal_id`
 * comes from any more — every staging call now returns its own `proposalId` synchronously, within
 * the same tool call, so this tool is never the only source. Bounded to a page — check the
 * `truncated` field before assuming you have seen everything. */
export const proposalListToolDefinition = {
  name: PROPOSAL_LIST_TOOL_NAME,
  description:
    "List the proposals THIS session has staged and is not yet decided on, for review — each " +
    "propose_/amend_/delete_ call already returns its own proposalId directly, so this is not " +
    "where a parent id for propose_criterion comes from. Bounded to a page — check the " +
    "`truncated` field in the result before assuming you have seen everything.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: MAX_READ_LIMIT },
    },
    required: [],
  },
} as const;

/** Plan 06-01 (PROP-01/PROP-02/PROP-07, T-06-01): build the `authoring_proposal` wire payload for
 * one `propose_item` tool call from an ORDINARY task-execution run, or throw for malformed input
 * BEFORE anything reaches the socket — mirrors {@link buildProposeTaskPayload}'s own validation
 * posture exactly. Rejects a missing/unrecognised `target_type`, an empty/whitespace-only `title`,
 * an empty/whitespace-only `rationale`, or an `issue` target whose `kind` is absent or outside
 * {@link PROPOSE_ITEM_ISSUE_KINDS}. No `run`/`project`/`epic` id field anywhere in the returned
 * payload — identity is derived from the socket the call arrives on, never accepted as an
 * argument. `rationale` rides the OUTER wire shape (this function's own return type), never
 * folded into `payload` — matching {@link AuthoringProposalPayload.rationale}'s own doc comment. */
export function buildProposeItemPayload(args: {
  target_type?: unknown;
  title?: unknown;
  body?: unknown;
  kind?: unknown;
  rationale?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  const targetType = typeof args.target_type === "string" ? args.target_type : "";
  if (!(PROPOSE_ITEM_TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new Error(
      `propose_item requires target_type to be one of ${PROPOSE_ITEM_TARGET_TYPES.join(", ")}`,
    );
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title.length === 0) {
    throw new Error("propose_item requires a non-empty title");
  }
  const rationale = typeof args.rationale === "string" ? args.rationale.trim() : "";
  if (rationale.length === 0) {
    throw new Error("propose_item requires a non-empty rationale");
  }
  const body = typeof args.body === "string" ? args.body : undefined;

  let payload: Record<string, unknown>;
  if (targetType === "issue") {
    const issueKind = typeof args.kind === "string" ? args.kind : "";
    if (!(PROPOSE_ITEM_ISSUE_KINDS as readonly string[]).includes(issueKind)) {
      throw new Error(`propose_item requires kind to be one of ${PROPOSE_ITEM_ISSUE_KINDS.join(", ")} for an issue`);
    }
    // `issue_kind`, not `kind` — `ProposalPayload`'s own `#[serde(tag = "kind")]` already claims
    // `kind` as its variant discriminant, so a variant field also named `kind` fails to compile
    // on the Rust side (verified this session: "variant field name `kind` conflicts with internal
    // tag"). This tool's own user/model-facing schema property STAYS named `kind` — this is the
    // one translation point that renames it for the wire shape the Rust core actually deserialises.
    payload = { kind: "issue", title, ...(body !== undefined ? { body } : {}), issue_kind: issueKind };
  } else if (targetType === "task") {
    payload = { kind: "task", title, ...(body !== undefined ? { description: body } : {}) };
  } else {
    payload = { kind: "epic", title, ...(body !== undefined ? { description: body } : {}) };
  }

  return {
    kind: "authoring_proposal",
    verb: "create",
    targetType: targetType as "task" | "issue" | "epic",
    rationale,
    payload,
  };
}

/** Plan 05-02 (D-80/D-81, T-05-02-01): build the `authoring_proposal` wire payload for one
 * `propose_task` tool call, or throw for malformed input — extracted as a pure function so this
 * validation is unit-testable without a live MCP transport, mirroring {@link buildClaudeArgv}'s
 * own "pure function, no spawning" precedent in `claude-code-adapter.ts`. Rejects an
 * empty/whitespace-only title BEFORE anything reaches the socket, matching every other tool in
 * this module's own validation posture. No `run`/`project`/`epic` id field anywhere in the
 * returned payload — identity is derived from the socket the call arrives on, never accepted as
 * an argument. `parent_proposal_id` (plan 05-05) is carried through only when supplied and
 * non-empty. */
export function buildProposeTaskPayload(args: {
  title?: unknown;
  description?: unknown;
  parent_proposal_id?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title.length === 0) {
    throw new Error("propose_task requires a non-empty title");
  }
  const parentProposalId =
    typeof args.parent_proposal_id === "string" && args.parent_proposal_id.length > 0
      ? args.parent_proposal_id
      : undefined;
  return {
    kind: "authoring_proposal",
    verb: "create",
    targetType: "task",
    ...(parentProposalId !== undefined ? { parentProposalId } : {}),
    payload: {
      kind: "task",
      title,
      ...(typeof args.description === "string" ? { description: args.description } : {}),
    },
  };
}

/** Plan 05-05 (D-80/D-81): build the `authoring_proposal` wire payload for one `propose_epic` call
 * — mirrors {@link buildProposeTaskPayload}'s own validation posture exactly. */
export function buildProposeEpicPayload(args: { title?: unknown; description?: unknown }): Omit<AuthoringProposalPayload, "requestId"> {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title.length === 0) {
    throw new Error("propose_epic requires a non-empty title");
  }
  return {
    kind: "authoring_proposal",
    verb: "create",
    targetType: "epic",
    payload: {
      kind: "epic",
      title,
      ...(typeof args.description === "string" ? { description: args.description } : {}),
    },
  };
}

/** Plan 05-05 (D-07/D-81): build the `authoring_proposal` wire payload for one `propose_criterion`
 * call. Rejects an empty statement OR a missing/empty `parent_proposal_id` BEFORE anything reaches
 * the socket — D-07's own reason a drafted criterion cannot exist without a parent proposal. */
export function buildProposeCriterionPayload(args: {
  statement?: unknown;
  parent_proposal_id?: unknown;
  verification_hint?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  const statement = typeof args.statement === "string" ? args.statement.trim() : "";
  if (statement.length === 0) {
    throw new Error("propose_criterion requires a non-empty statement");
  }
  const parentProposalId =
    typeof args.parent_proposal_id === "string" ? args.parent_proposal_id.trim() : "";
  if (parentProposalId.length === 0) {
    throw new Error("propose_criterion requires a non-empty parent_proposal_id");
  }
  return {
    kind: "authoring_proposal",
    verb: "create",
    targetType: "criterion",
    parentProposalId,
    payload: {
      kind: "criterion",
      statement,
      ...(typeof args.verification_hint === "string" ? { verification_hint: args.verification_hint } : {}),
    },
  };
}

/** Plan 05-05 (D-89): build the `authoring_proposal` wire payload for one `propose_assumption`
 * call. `answer` defaults to an empty string (never omitted) when the caller supplies none — the
 * Rust core's `ProposalPayload::Assumption` variant requires the field present, even though this
 * tool's OWN schema marks it optional (an assumption may be surfaced before an answer exists). */
export function buildProposeAssumptionPayload(args: {
  assumption?: unknown;
  answer?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  const assumption = typeof args.assumption === "string" ? args.assumption.trim() : "";
  if (assumption.length === 0) {
    throw new Error("propose_assumption requires a non-empty assumption");
  }
  const answer = typeof args.answer === "string" ? args.answer : "";
  return {
    kind: "authoring_proposal",
    verb: "create",
    targetType: "assumption",
    payload: { kind: "assumption", assumption, answer },
  };
}

function isValidUlidLength(value: unknown): value is string {
  return typeof value === "string" && value.length === 26;
}

function isAmendDeleteTargetType(value: unknown): value is AmendDeleteTargetType {
  return typeof value === "string" && (AMEND_DELETE_TARGET_TYPES as readonly string[]).includes(value);
}

/** Build the target-typed `payload` object `amend_proposal`/`delete_proposal` both need — the
 * Rust core's `ProposalPayload` deserialises strictly by `target_type`'s own `kind` discriminant,
 * so this payload must carry that variant's own required field regardless of verb. `toolName` is
 * only for the thrown error's own message. */
function buildTargetTypedPayload(
  targetType: AmendDeleteTargetType,
  args: { title?: unknown; description?: unknown; statement?: unknown; verification_hint?: unknown },
  toolName: string,
  requireContent: boolean,
): Record<string, unknown> {
  if (targetType === "criterion") {
    const statement = typeof args.statement === "string" ? args.statement.trim() : "";
    if (requireContent && statement.length === 0) {
      throw new Error(`${toolName} requires a non-empty statement for target_type criterion`);
    }
    return {
      kind: "criterion",
      statement,
      ...(typeof args.verification_hint === "string" ? { verification_hint: args.verification_hint } : {}),
    };
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (requireContent && title.length === 0) {
    throw new Error(`${toolName} requires a non-empty title for target_type ${targetType}`);
  }
  return {
    kind: targetType,
    title,
    ...(typeof args.description === "string" ? { description: args.description } : {}),
  };
}

/** Plan 05-05 (D-81): build the `authoring_proposal` wire payload for one `amend_proposal` call.
 * Rejects a `target_id` that is not exactly 26 characters, an unrecognised `target_type`, or a
 * missing content field for that type — all BEFORE anything reaches the socket. The amendment is
 * itself the drafted content (what the item should become), so its content field IS required. */
export function buildAmendProposalPayload(args: {
  target_id?: unknown;
  target_type?: unknown;
  title?: unknown;
  description?: unknown;
  statement?: unknown;
  verification_hint?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  if (!isValidUlidLength(args.target_id)) {
    throw new Error("amend_proposal requires a target_id that is exactly 26 characters");
  }
  if (!isAmendDeleteTargetType(args.target_type)) {
    throw new Error("amend_proposal requires target_type to be one of epic, task or criterion");
  }
  const payload = buildTargetTypedPayload(args.target_type, args, "amend_proposal", true);
  return {
    kind: "authoring_proposal",
    verb: "amend",
    targetType: args.target_type,
    targetId: args.target_id,
    payload,
  };
}

/** Plan 05-05 (D-81): build the `authoring_proposal` wire payload for one `delete_proposal` call.
 * Rejects a `target_id` that is not exactly 26 characters, an unrecognised `target_type`, or an
 * empty `reason` — all BEFORE anything reaches the socket. The target-typed content fields are
 * NOT required here (`requireContent: false`): the accept path resolves the canonical row's own
 * current content directly, so a deletion does not ask the model to restate text verbatim. */
export function buildDeleteProposalPayload(args: {
  target_id?: unknown;
  target_type?: unknown;
  reason?: unknown;
  title?: unknown;
  description?: unknown;
  statement?: unknown;
  verification_hint?: unknown;
}): Omit<AuthoringProposalPayload, "requestId"> {
  if (!isValidUlidLength(args.target_id)) {
    throw new Error("delete_proposal requires a target_id that is exactly 26 characters");
  }
  if (!isAmendDeleteTargetType(args.target_type)) {
    throw new Error("delete_proposal requires target_type to be one of epic, task or criterion");
  }
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length === 0) {
    throw new Error("delete_proposal requires a non-empty reason");
  }
  const payload = buildTargetTypedPayload(args.target_type, args, "delete_proposal", false);
  return {
    kind: "authoring_proposal",
    verb: "delete",
    targetType: args.target_type,
    targetId: args.target_id,
    reason,
    payload,
  };
}

/** Plan 06-05 (D-108): the well-formed shape of the `duplicateCandidate` object a staging answer
 * MAY carry alongside `proposalId` — `kind`/`title`/`score` required, `key` optional (a proposal
 * candidate has no key until it is accepted). Anything else (a non-object, a wrong-typed field, a
 * `key` that is neither absent nor a string) is NOT well-formed and degrades to "no candidate in
 * the answer" — never turns a successfully staged proposal into a rejected tool call. */
function isWellFormedDuplicateCandidate(
  value: unknown,
): value is { kind: string; key?: string; title: string; score: number } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || typeof v.title !== "string" || typeof v.score !== "number") {
    return false;
  }
  if (v.key !== undefined && v.key !== null && typeof v.key !== "string") return false;
  return true;
}

/** Stage one {@link AuthoringProposalPayload} over the per-run socket and resolve with the
 * CORE-MINTED `proposalId` the held call answers with — the ONE connect/write/hold/wait shape
 * every `propose_`/`amend_`/`delete_` tool call shares, factored out so six near-identical
 * `Promise` bodies never drift from each other. Plan 05-48 (D-80/D-81/D-92, gap G-05-10): this
 * used to resolve the instant the socket sent a bare `{received: true}` receipt; it now mints its
 * own `requestId`, writes it onto the wire payload, and HOLDS the socket exactly like
 * {@link requestBoardRead} does — the caller needs the row id the Rust core actually wrote, not
 * an acknowledgement that a write was attempted. Deliberately no `setTimeout`/`setInterval` — the
 * promise settles ONLY when the socket answers, matching every other held call in this module.
 * Exported so the regression suite can drive it directly against a real socket.
 *
 * Plan 06-05 (D-108): the resolved text block ALSO carries `duplicateCandidate` when the
 * answer's `result` carries one ({@link isWellFormedDuplicateCandidate}) — omitted entirely
 * (never sent as `null`) when absent or malformed, so an authoring `propose_*` call's answer
 * shape stays byte-identical to what it is today. One staging function serves BOTH run kinds —
 * the only difference is whether the core had a candidate to report, never a second execution-
 * run-specific staging path. A refusal (an `error` string, e.g. PROP-05's proposal-limit message)
 * needs no special handling here — it already rejects below, exactly as before. */
export function stageAuthoringProposal(
  socketPath: string,
  payload: Omit<AuthoringProposalPayload, "requestId">,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify({ ...payload, requestId }) + "\n");
    });
    socket.on("error", (err) => reject(err));
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: {
        result?: { proposalId?: unknown; duplicateCandidate?: unknown };
        error?: string;
      };
      try {
        parsed = JSON.parse(line) as {
          result?: { proposalId?: unknown; duplicateCandidate?: unknown };
          error?: string;
        };
      } catch (err) {
        reject(err);
        return;
      }
      if (parsed.error !== undefined) {
        reject(new Error(parsed.error));
        return;
      }
      const proposalId = parsed.result?.proposalId;
      if (typeof proposalId !== "string") {
        reject(new Error(`staging answer carried no proposalId: ${line}`));
        return;
      }
      const responseBody: { staged: true; proposalId: string; duplicateCandidate?: unknown } = {
        staged: true,
        proposalId,
      };
      const candidate = parsed.result?.duplicateCandidate;
      if (isWellFormedDuplicateCandidate(candidate)) {
        responseBody.duplicateCandidate = candidate;
      }
      resolve({ content: [{ type: "text", text: JSON.stringify(responseBody) }] });
    });
  });
}

/** Ask the Rust core for one bounded board read over the per-run socket, and resolve with its
 * `result` (or reject with its `error`) — the standalone server's own read-tool counterpart to
 * {@link stageAuthoringProposal}. Connects a FRESH socket per call and HOLDS it open, mirroring
 * `approve_action`'s own request-and-wait shape (never the fire-and-forget notice shape): a read
 * needs an actual answer, so this promise settles only when {@link PermissionServerHandle.answerBoardRead}
 * resolves it from the other end of the same connection. */
function requestBoardRead(
  socketPath: string,
  request: Omit<BoardReadRequestPayload, "kind" | "requestId">,
): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify({ kind: "board_read", requestId, ...request }) + "\n");
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
      if (parsed.error !== undefined) {
        reject(new Error(parsed.error));
        return;
      }
      resolve(parsed.result);
    });
  });
}

/** Plan 09-08 (PLAN-01, D-147, D-149): the `submit_plan` tool's registration object. No run, project,
 * epic or plan id property anywhere — the run is resolved from the socket. The description is plain
 * about what the call does and does not do: it DECLARES file-sets and waves for a human to review; it
 * approves nothing and starts nothing. */
export const submitPlanToolDefinition = {
  name: SUBMIT_PLAN_RAW_TOOL_NAME,
  description:
    "Hand Flywheel the file-set and wave for each task of the epic you were asked to plan, once. " +
    "This does NOT start any agent and does NOT approve anything: it stores a draft the developer " +
    "reviews and can edit first. If the call returns an error, correct what it names and call again.",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", minLength: 1 },
            files: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 1024 },
              description:
                "Repo-relative exact file paths (src/a.rs) or directory prefixes ending in / (src/api/). No globs.",
            },
            wave: { type: "integer", minimum: 1 },
            rationale: { type: "string" },
          },
          required: ["key", "files", "wave", "rationale"],
        },
      },
      excluded: {
        type: "array",
        items: {
          type: "object",
          properties: { key: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1 } },
          required: ["key", "reason"],
        },
      },
    },
    required: ["tasks"],
  },
} as const;

/** Plan 09-08: build the `submit_plan` wire payload from a tool call's arguments, or throw for a
 * malformed shape BEFORE anything reaches the socket. Only the SHAPE is checked here (what is a
 * valid entry, an empty list, a key of this epic are all decided once, in the Rust core, and
 * answered back to the agent in the same call). */
export function buildSubmitPlanPayload(args: {
  tasks?: unknown;
  excluded?: unknown;
}): Omit<SubmitPlanPayload, "requestId"> {
  if (!Array.isArray(args.tasks)) {
    throw new Error("submit_plan requires a tasks array");
  }
  const tasks = args.tasks.map((raw: unknown, index: number) => {
    const t = (raw ?? {}) as { key?: unknown; files?: unknown; wave?: unknown; rationale?: unknown };
    if (typeof t.key !== "string" || t.key.trim().length === 0) {
      throw new Error(`submit_plan task ${index} requires a non-empty key`);
    }
    const key = t.key.trim();
    if (!Array.isArray(t.files) || !t.files.every((f: unknown) => typeof f === "string")) {
      throw new Error(`submit_plan task ${key} requires files to be an array of strings`);
    }
    if (typeof t.wave !== "number" || !Number.isInteger(t.wave)) {
      throw new Error(`submit_plan task ${key} requires wave to be an integer`);
    }
    return { key, files: t.files as string[], wave: t.wave, rationale: typeof t.rationale === "string" ? t.rationale : "" };
  });
  const rawExcluded = args.excluded === undefined ? [] : args.excluded;
  if (!Array.isArray(rawExcluded)) {
    throw new Error("submit_plan requires excluded to be an array");
  }
  const excluded = rawExcluded.map((raw: unknown, index: number) => {
    const e = (raw ?? {}) as { key?: unknown; reason?: unknown };
    if (typeof e.key !== "string" || e.key.trim().length === 0 || typeof e.reason !== "string") {
      throw new Error(`submit_plan excluded entry ${index} requires a key and a reason`);
    }
    return { key: e.key.trim(), reason: e.reason };
  });
  return { kind: "submit_plan", tasks, excluded };
}

/** Plan 09-08: send one {@link SubmitPlanPayload} over the per-run socket and HOLD until the Rust
 * core answers. The planning agent's call blocks here — no timer, no default. A refusal comes back
 * as an error RESULT (`isError`) rather than a protocol failure, so the agent reads the named cause
 * and corrects it in the same conversation. Exported so the wire test can drive it directly. */
export function submitPlan(
  socketPath: string,
  payload: Omit<SubmitPlanPayload, "requestId">,
): Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify({ ...payload, requestId }) + "\n");
    });
    socket.on("error", (err) => reject(err));
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: { result?: { planId?: unknown }; error?: string };
      try {
        parsed = JSON.parse(line) as { result?: { planId?: unknown }; error?: string };
      } catch (err) {
        reject(err);
        return;
      }
      if (parsed.error !== undefined) {
        resolve({ isError: true, content: [{ type: "text", text: parsed.error }] });
        return;
      }
      resolve({
        content: [{ type: "text", text: JSON.stringify({ submitted: true, planId: parsed.result?.planId ?? null }) }],
      });
    });
  });
}

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
      proposeItemToolDefinition,
      submitPlanToolDefinition,
      proposeTaskToolDefinition,
      proposeEpicToolDefinition,
      proposeCriterionToolDefinition,
      proposeAssumptionToolDefinition,
      amendProposalToolDefinition,
      deleteProposalToolDefinition,
      boardSearchToolDefinition,
      epicGetToolDefinition,
      taskListToolDefinition,
      proposalListToolDefinition,
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

    if (request.params.name === PROPOSE_ITEM_TOOL_NAME) {
      // Plan 06-01 (D-98, T-06-01): no argument here names a run, project or epic — identity is
      // whichever socket this connection reaches, exactly like the approve/summary/authoring
      // branches above. buildProposeItemPayload throws (rejecting BEFORE any socket write) for
      // malformed input.
      const args = (request.params.arguments ?? {}) as {
        target_type?: unknown;
        title?: unknown;
        body?: unknown;
        kind?: unknown;
        rationale?: unknown;
      };
      return stageAuthoringProposal(socketPath, buildProposeItemPayload(args));
    }

    if (request.params.name === SUBMIT_PLAN_RAW_TOOL_NAME) {
      // Plan 09-08: no argument names a run, project, epic or plan — identity is whichever socket
      // this connection reaches. buildSubmitPlanPayload throws (rejecting BEFORE any socket write)
      // for a malformed shape; everything else is decided and answered by the Rust core.
      const args = (request.params.arguments ?? {}) as { tasks?: unknown; excluded?: unknown };
      return submitPlan(socketPath, buildSubmitPlanPayload(args));
    }

    if (request.params.name === PROPOSE_TASK_TOOL_NAME) {
      // Plan 05-02 (D-80/D-81, T-05-02-01): no argument here names a run, project or epic —
      // identity is whichever socket this connection reaches, exactly like the approve/summary
      // branches above. buildProposeTaskPayload throws (rejecting BEFORE any socket write) for
      // malformed input, matching the existing tools' own validation posture.
      const args = (request.params.arguments ?? {}) as {
        title?: unknown;
        description?: unknown;
        parent_proposal_id?: unknown;
      };
      return stageAuthoringProposal(socketPath, buildProposeTaskPayload(args));
    }

    if (request.params.name === PROPOSE_EPIC_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as { title?: unknown; description?: unknown };
      return stageAuthoringProposal(socketPath, buildProposeEpicPayload(args));
    }

    if (request.params.name === PROPOSE_CRITERION_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as {
        statement?: unknown;
        parent_proposal_id?: unknown;
        verification_hint?: unknown;
      };
      return stageAuthoringProposal(socketPath, buildProposeCriterionPayload(args));
    }

    if (request.params.name === PROPOSE_ASSUMPTION_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as { assumption?: unknown; answer?: unknown };
      return stageAuthoringProposal(socketPath, buildProposeAssumptionPayload(args));
    }

    if (request.params.name === AMEND_PROPOSAL_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as {
        target_id?: unknown;
        target_type?: unknown;
        title?: unknown;
        description?: unknown;
        statement?: unknown;
        verification_hint?: unknown;
      };
      return stageAuthoringProposal(socketPath, buildAmendProposalPayload(args));
    }

    if (request.params.name === DELETE_PROPOSAL_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as {
        target_id?: unknown;
        target_type?: unknown;
        reason?: unknown;
        title?: unknown;
        description?: unknown;
        statement?: unknown;
        verification_hint?: unknown;
      };
      return stageAuthoringProposal(socketPath, buildDeleteProposalPayload(args));
    }

    if (request.params.name === BOARD_SEARCH_TOOL_NAME) {
      // Plan 05-05 (D-87): a read tool — no run/project/epic id argument here either, and no
      // `--allowedTools`-style pre-approval concern at THIS layer (that's the adapter's own argv
      // composition); this handler only ever asks the core through the held board_read round trip.
      const args = (request.params.arguments ?? {}) as { term?: unknown; limit?: unknown };
      const term = typeof args.term === "string" ? args.term.trim() : "";
      if (term.length === 0) {
        throw new Error("board_search requires a non-empty term");
      }
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const result = await requestBoardRead(socketPath, { readKind: "search", term, ...(limit !== undefined ? { limit } : {}) });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (request.params.name === EPIC_GET_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as { epic_id?: unknown };
      const epicId = typeof args.epic_id === "string" ? args.epic_id.trim() : "";
      if (epicId.length === 0) {
        throw new Error("epic_get requires a non-empty epic_id");
      }
      const result = await requestBoardRead(socketPath, { readKind: "get_epic", epicId });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (request.params.name === TASK_LIST_TOOL_NAME) {
      const args = (request.params.arguments ?? {}) as { epic_id?: unknown; limit?: unknown };
      const epicId = typeof args.epic_id === "string" ? args.epic_id.trim() : "";
      if (epicId.length === 0) {
        throw new Error("task_list requires a non-empty epic_id");
      }
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const result = await requestBoardRead(socketPath, { readKind: "list_tasks", epicId, ...(limit !== undefined ? { limit } : {}) });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (request.params.name === PROPOSAL_LIST_TOOL_NAME) {
      // Plan 05-44 (gap G-05-9): a read tool — carries NO id of any kind, because the run this
      // session's proposals belong to is resolved from the socket, exactly like every other
      // authoring tool call in this file.
      const args = (request.params.arguments ?? {}) as { limit?: unknown };
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const result = await requestBoardRead(socketPath, { readKind: "list_proposals", ...(limit !== undefined ? { limit } : {}) });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
