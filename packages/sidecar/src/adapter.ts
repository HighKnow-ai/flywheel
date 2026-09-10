/**
 * AGNT-01 — the single agent-backend interface the sidecar drives every adapter through.
 *
 * No module outside this crate branches on a backend name (AGNT-01 adjacency): the supervisor
 * (`index.ts`) only ever calls `AgentAdapter` methods, never `ClaudeCodeAdapter`-specific ones.
 * `resumeSession` is declared here and capability-gated as unimplemented (D-30) — every adapter
 * gets the same default rejection unless it overrides both the method and its own
 * `capabilities.supportsResume`.
 */

/**
 * The fields every normalised event carries, regardless of its `type` (AGNT-01 ordering): a
 * monotonically increasing `seq` within one run, an ISO-8601 timestamp, and the verbatim source
 * line this event was derived from — nothing is ever dropped, even a line that matches no known
 * shape (it becomes `unknown`, still carrying `raw`).
 */
interface AgentEventBase {
  runId: string;
  seq: number;
  at: string;
  /** The verbatim source line (or synthesized text, for a non-JSON line) this event came from. */
  raw: string;
}

export interface InitEvent extends AgentEventBase {
  type: "init";
  sessionId: string;
  model?: string;
}

export interface AssistantTextEvent extends AgentEventBase {
  type: "assistant_text";
  text: string;
}

export interface ToolCallEvent extends AgentEventBase {
  type: "tool_call";
  toolName: string;
  input: unknown;
}

export interface ToolResultEvent extends AgentEventBase {
  type: "tool_result";
  toolName?: string;
  output: unknown;
}

export interface PermissionRequestEvent extends AgentEventBase {
  type: "permission_request";
  /** The permission-prompt MCP server's own correlation id for this held call (AGNT-06) —
   * carried end-to-end so a later `resolvePermission(runId, requestId, decision)` call settles
   * THIS specific held tool call and no other. Distinct from `permission_requests.id` (the
   * database row's own ULID, minted separately once the Rust core decides to create a pending
   * row) — the two are correlated by the Rust core itself, not by sharing one identifier. */
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface CostUpdateEvent extends AgentEventBase {
  type: "cost_update";
  totalCostUsd: number;
}

export interface SystemNoticeEvent extends AgentEventBase {
  type: "system_notice";
  text: string;
}

export interface ResultEvent extends AgentEventBase {
  type: "result";
  subtype: string;
  totalCostUsd?: number;
  sessionId?: string;
}

/** A line that parsed as JSON but matched no known shape — still carries `raw`, never dropped. */
export interface UnknownEvent extends AgentEventBase {
  type: "unknown";
}

/**
 * D-35: the terminal event every session ends with, exactly once, regardless of why it ended —
 * a natural completion, an interrupt, or the force step. `reason` is what the session surface
 * (plan 02-02 Task 3) reads to flip its own status word without ever re-querying the database.
 */
export interface SessionClosedEvent extends AgentEventBase {
  type: "session_closed";
  reason: "interrupted" | "completed" | "failed";
  /** The final `result` stream-json line's normalised fields, when the backend produced one
   * before exiting — absent for a forced stop that never got to emit its own result. */
  result?: { subtype: string; totalCostUsd?: number; sessionId?: string };
}

/**
 * The normalised event union every adapter emits, in exactly the order the backend process
 * produced them (AGNT-01 ordering) — no reordering, no batching, no coalescing.
 */
export type AgentEvent =
  | InitEvent
  | AssistantTextEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | CostUpdateEvent
  | SystemNoticeEvent
  | ResultEvent
  | UnknownEvent
  | SessionClosedEvent;

/** What an adapter declares it can do — gates which `AgentAdapter` methods are safe to call. */
export interface AdapterCapabilities {
  supportsResume: boolean;
  supportsPermissionPrompt: boolean;
  supportsCostReporting: boolean;
}

/**
 * Thrown by a capability-gated method an adapter has NOT implemented (D-30: `resumeSession`'s
 * default) — a typed, discoverable rejection rather than an unhandled exception (AGNT-01 empty).
 */
export class CapabilityUnsupportedError extends Error {
  constructor(public readonly capability: keyof AdapterCapabilities) {
    super(`capability not supported: ${capability}`);
    this.name = "CapabilityUnsupportedError";
  }
}

/**
 * Thrown by `interruptSession`/`killSession` when `runId` names no session this sidecar spawned
 * (D-35) — rejects BEFORE any signal is sent, so a renderer-supplied id can never be turned into
 * an arbitrary process-group signal (T-02-11).
 */
export class UnknownRunError extends Error {
  constructor(public readonly runId: string) {
    super(`unknown runId: ${runId}`);
    this.name = "UnknownRunError";
  }
}

export interface StartSessionOptions {
  runId: string;
  worktreePath: string;
  prompt: string;
  permissionMode: string;
  /** Additional environment variables to merge over `process.env` for the spawned child —
   * resolved credentials arrive here from the Rust core and are never read from disk by the
   * sidecar itself. */
  env?: Record<string, string>;
  onEvent: (event: AgentEvent) => void;
}

/**
 * The one interface every agent backend implements. `AGNT-01 adjacency`: adding a second adapter
 * changes only the sidecar's own adapter registry — no code in `packages/desktop/src-tauri`
 * compares against an adapter or backend name.
 */
export interface AgentAdapter {
  readonly capabilities: AdapterCapabilities;

  /** Start a fresh session (D-30: always fresh, never a resume) and stream normalised events to
   * `options.onEvent` as they arrive, in source order. Resolves once the child process exits. */
  startSession(options: StartSessionOptions): Promise<void>;

  /** D-35 "interrupt, then force": SIGINT the session's process group; if it has not exited by
   * the end of the grace window, escalate to SIGTERM on that same group (RESEARCH.md Pitfall 3 —
   * never signal only the direct child PID). Resolves once the session has actually closed.
   * Idempotent and safe on an already-exited session (resolves, does not throw, emits no second
   * terminal event). Rejects with {@link UnknownRunError} for a `runId` this sidecar never
   * spawned — before any signal is sent. */
  interruptSession(runId: string): Promise<void>;

  /** D-35 "force" on its own, for the app-exit path: SIGTERM to the process group immediately,
   * no grace window (RESEARCH.md Pitfall 3 — never signal only the direct child PID). Same
   * idempotency and unknown-`runId` contract as {@link interruptSession}. */
  killSession(runId: string): Promise<void>;

  /** D-30: deliberately unimplemented on every adapter that does not override it — rejects with
   * {@link CapabilityUnsupportedError}, gated by `capabilities.supportsResume === false`. */
  resumeSession(runId: string, externalSessionId: string): Promise<void>;
}

/** Every capability-gated method an adapter does not implement rejects with this error rather
 * than throwing an unhandled exception (AGNT-01 empty) — the shared default for `resumeSession`. */
export async function defaultResumeSession(): Promise<never> {
  throw new CapabilityUnsupportedError("supportsResume");
}
