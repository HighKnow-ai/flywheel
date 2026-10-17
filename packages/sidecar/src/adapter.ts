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
  /** G-05-6: the wire calls this `is_api_error_message` on the assistant envelope itself — the
   * backend's own statement that this text is a non-conversation error message, not agent speech.
   * The harness has been reconstructing this fact from prose (matching one observed message's
   * literal prefix), and prose is blind to every message shape nobody captured first. G-05-7
   * (05-REVIEW.md WR-02): a literal `false` is a real reading and is carried, exactly like its
   * sibling {@link ResultEvent.isError} — never dropped as falsy. The field is absent entirely
   * only when the backend's own envelope declared no such flag at all. */
  isApiErrorMessage?: boolean;
  /** G-05-6: the wire calls this `error` on the assistant envelope itself — the backend's own error
   * code for this message (e.g. `authentication_failed`), reported for diagnosis alongside
   * {@link isApiErrorMessage}. Absent entirely — never a present-but-empty string — when the
   * backend's own envelope declared none. */
  errorCode?: string;
  /** Plan 09-05 (AGNT-05): present, and always `"rejected"`, only when {@link errorCode} names a rate
   * limit — the backend's documented error enum carries that value, and a hard limit may arrive on
   * an assistant message rather than as a {@link RateLimitEvent}. The same normalised interpretation
   * {@link RateLimitEvent.tier} carries, so the supervisor reads one field and never the backend's
   * own error text. */
  rateLimitTier?: RateLimitTier;
}

/**
 * The normalised reading of "may this account keep being sent requests" (plan 09-05): `open` (the
 * backend said the request was allowed), `warning` (allowed, but the backend flagged the account as
 * approaching a limit) or `rejected` (the backend refused). Derived at the adapter seam so no
 * supervisor code reads backend wire text.
 */
export type RateLimitTier = "open" | "warning" | "rejected";

/**
 * Task 3, plan 05-12: the backend restating a turn the Rust core has already recorded (Task 2's
 * own `developer_turn` transcript row) — the backend's stream echoes the same text back as a
 * user-role message, in the exact shape the agent's own prose arrives in. This event exists so
 * `claude-code-adapter.ts`'s normaliser can label that restatement for what it is, rather than as
 * the agent's own {@link AssistantTextEvent}; the Rust core's own record is the one that renders
 * (the renderer suppresses this event from its feed, per `SessionSurface.tsx`'s
 * `SUPPRESSED_EVENT_TYPES`) — the same words are already on screen, written by the component that
 * knows who actually said them.
 */
export interface BackendEchoEvent extends AgentEventBase {
  type: "backend_echo";
  text: string;
}

export interface ToolCallEvent extends AgentEventBase {
  type: "tool_call";
  toolName: string;
  input: unknown;
  /** G-05-5: the backend's own correlation id for THIS tool call — the tool_use content block's
   * own id, carried end to end so a consumer can pair THIS call's result with THIS call and no
   * other, exactly the problem PermissionRequestEvent's own requestId field already solves for a
   * held permission request. Absent entirely — never present-but-empty, never fabricated — when
   * the backend's own content block declared none, so a consumer can branch on its presence
   * alone, the same convention destructiveCategory below already states. */
  toolUseId?: string;
  /** G-05-8(a) (plan 05-41): the model-authored questions and options of an `AskUserQuestion`
   * tool call — the only shape this field is ever populated for, and only when the payload
   * parsed (`claude-code-adapter.ts::parseAskUserQuestionInput`). Absent entirely for every other
   * tool call, and absent entirely (never a present-but-empty array) when the payload did not
   * parse — the same present-or-absent convention `toolUseId` above already states, so a consumer
   * can branch on presence alone. Order is the backend's own emitted order, verbatim — never
   * sorted, merged or de-duplicated. Carries only the model-authored question/header/multiSelect
   * flag and option label/description — nothing else from the envelope (T-05-41-02).
   *
   * This is a field on `tool_call` rather than a new {@link AgentEvent} union member because an
   * `AskUserQuestion` call IS a tool call: `accumulateTurn` counts `tool_call` events and
   * decrements on the matching `tool_result` to decide when a turn is mid-flight. Reclassifying it
   * to a different event type would leave the call permanently pending, so every turn containing
   * one would run to the ceiling instead of ending (T-05-41-05). */
  questions?: AskUserQuestionPrompt[];
}

/** G-05-8(a) (plan 05-41): one option offered by an `AskUserQuestion` prompt — the model-authored
 * `label`/`description` pair a human reads on screen, nothing else from the envelope. */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

/** G-05-8(a) (plan 05-41): one question inside an `AskUserQuestion` tool call's `input.questions`
 * array, typed for {@link ToolCallEvent.questions}. `header`/`multiSelect` are independently
 * optional, mirroring every other per-field degrade convention in this file — absent entirely,
 * never fabricated, when the backend's own payload declared none. */
export interface AskUserQuestionPrompt {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
}

export interface ToolResultEvent extends AgentEventBase {
  type: "tool_result";
  toolName?: string;
  output: unknown;
  /** G-05-5: the backend's own correlation id THIS result answers — the tool_result content
   * block's own tool_use_id, the SAME value as the answered call's own ToolCallEvent toolUseId
   * field, which is the whole point: a consumer can pair THIS result with THIS call and no other
   * via an exact lookup rather than an inference from position. Absent entirely — never
   * present-but-empty, never fabricated — when the backend's own content block declared none. */
  toolUseId?: string;
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
  /** D-56 (plan 03-07): the PATH-shim binary's own `destructive::classify` category name, when
   * this request originated from the shim (`FLYWHEEL_PERMISSION_SOCKET`) rather than the routine
   * MCP permission-prompt tool call. Absent entirely for the routine variant — never present-but-
   * empty — so a consumer can branch on its presence alone. */
  destructiveCategory?: string;
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
  /** Session TOTALS reported once by the backend on its terminal result line — never accumulated
   * per message (G-02-4's "Token accounting decision"). `inputTokens` is the SUM of the backend's
   * plain, cache-creation and cache-read input token fields; a run whose backend produced no usage
   * figure carries neither field, never a zero. Placed at the TOP LEVEL (not nested) because
   * `SessionSurface.tsx`'s `StatusStrip` scans top-level numeric fields on each loaded log entry
   * for a field named `inputTokens` — a nested placement would never be found, and this placement
   * needs no renderer change at all to make the header read the real figures. */
  inputTokens?: number;
  outputTokens?: number;
  /** G-05-6: the wire calls this `is_error` on the result line itself — the backend's own statement
   * that this run terminated in error. WARNING: this run's own `subtype` reads `"success"` on a
   * captured error termination (measured in `scripts/uat/fixtures/unauthenticated-cli-first-turn.json`)
   * — `subtype` is NOT a usable signal for this purpose; classify on this boolean flag instead. A
   * literal `false` is a real reading and is carried, never dropped as falsy; the field is absent
   * entirely only when the backend's own result line declared no such flag. */
  isError?: boolean;
  /** G-05-6: the wire calls this `terminal_reason` on the result line itself. Reported for
   * diagnosis only — never classified on its value, since no capture of a healthy run's value
   * exists in this repository. Absent entirely — never a present-but-empty string — when the
   * backend's own result line declared none. */
  terminalReason?: string;
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
   * before exiting — absent for a forced stop that never got to emit its own result. `inputTokens`/
   * `outputTokens` are the same once-reported session TOTALS as {@link ResultEvent}'s own fields
   * (G-02-4's "Token accounting decision") — never accumulated per message, never a zero when
   * absent from the backend's own usage block. */
  result?: {
    subtype: string;
    totalCostUsd?: number;
    sessionId?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  /** The backend's own explanation of why the session ended (G-02-2) — the child's retained
   * stderr tail, or a spawn error's message. Present only when there is one to show; a session
   * that closed cleanly having written nothing to stderr carries no `detail` at all (the field is
   * absent, never an empty string). NEVER a place a resolved credential or environment value may
   * appear — the child's own stderr is text produced by a process the user's agent controls, not
   * a channel this adapter writes secrets onto. */
  detail?: string;
  /** Plan 03-20 (close provenance): which of three mechanisms ended the session, derived by
   * `claude-code-adapter.ts`'s exported `resolveCloseOrigin`. Always present on a real
   * `session_closed` event — optional here only because other adapters' terminal events do not
   * yet populate it. */
  closeOrigin?: "supervisor-signal" | "watchdog-heartbeat-stale" | "backend-exit" | "unattributed";
  /** The wrapper process's own reported exit code (plan 03-20) — `number` when it exited with a
   * code, `null` when it was killed by signal instead. Absent for an adapter that has not wired
   * this field yet. */
  exitCode?: number | null;
  /** The wrapper process's own reported exit signal (plan 03-20) — a signal name string when it
   * was killed by signal, `null` when it exited with a code instead. Absent for an adapter that
   * has not wired this field yet. */
  exitSignal?: string | null;
}

/** D-53/plan 03-13: the PATH shim's "still retrying" report, relayed over the SAME permission
 * socket a destructive-action request uses (`FLYWHEEL_PERMISSION_SOCKET`) but as a fire-and-forget
 * notice, never a held request. Sent once per backoff sleep — never for a call that succeeds on
 * its first attempt, and never for the final, exhausting attempt (see {@link GitLockExhaustedEvent}
 * for that case instead). `attempt` is the UPCOMING attempt number the shim is about to retry,
 * `max` is the fixed retry budget (`git_retry::RETRY_MAX_ATTEMPTS`). */
export interface GitRetryEvent extends AgentEventBase {
  type: "git_retry";
  attempt: number;
  max: number;
  repository: string;
  command: string;
}

/** D-53/plan 03-13: the PATH shim's "I gave up" report — sent exactly once, after the final
 * failed attempt exhausts the retry budget. `attempts` is the TOTAL attempt count (not the
 * upcoming one, unlike {@link GitRetryEvent}'s `attempt`). This is the ONLY git-lock-contention
 * artifact ever written to the board (D-53) — a resolved retry sequence never produces this
 * event, only the transient {@link GitRetryEvent} notices along the way. */
export interface GitLockExhaustedEvent extends AgentEventBase {
  type: "git_lock_exhausted";
  repository: string;
  command: string;
  attempts: number;
}

/** PLAN-05 (phase 09 plan 09-02): the scope hook's "I refused a write" report, relayed over the
 * SAME permission socket as a fire-and-forget notice. `path` is repository-relative (or absolute when
 * `outsideWorktree` is true — the Rust side keeps only its file name). `runId` comes from the session
 * closure, never from the notice body (T-09-02-01). Best effort by construction: the close-time
 * backstop in `packages/core/src/drift.rs` is what makes a lost notice still surface. */
export interface ScopeDeniedEvent extends AgentEventBase {
  type: "scope_denied";
  path: string;
  tool: string;
  toolUseId: string;
  outsideWorktree: boolean;
}

/**
 * G-05-7 (plan 05-37): a reasoning-only assistant message — the backend's own `thinking` content
 * block, found with no `tool_use`/`tool_result`/`text` block ahead of it in the same message.
 * `claude-opus-5` emitted roughly ELEVEN of these on turn 1 of live run
 * `01M3C48C3PV1NSGHERBZ587YB1`; every one of them fell through to {@link UnknownEvent} and was
 * dumped to stderr as raw JSON truncated at 200 characters — the gap this event closes. Grounded in
 * `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json`.
 */
export interface ThinkingEvent extends AgentEventBase {
  type: "thinking";
  /** The reasoning block's own `thinking` string. The empty string when the backend redacts the
   * reasoning and carries it in the signature instead — exactly what the live capture shows; never
   * inferred or reconstructed when the wire itself carried nothing here. */
  text: string;
  /** Whether the block ALSO carried a `signature` — recorded WITHOUT ever carrying its value onto
   * this event, the lifecycle record or any artifact (T-05-37-03). The signature is opaque
   * cryptographic material with no consumer in this product, is potentially very large, and the
   * only capture this repository has of one is cut off mid-value by the harness's own 200-character
   * stderr slice — carrying even a partial value forward would misrepresent an incomplete fragment
   * as the real thing. */
  hasSignature: boolean;
}

/**
 * G-05-7 (plan 05-37): the backend's own `rate_limit_event` top-level line — real operational
 * information about how close this session is to its own rate limit, previously discarded entirely
 * (normalised to {@link UnknownEvent}). Every field is independently optional, following
 * `ClaudeStreamUsage`'s own established per-field degrade discipline (`claude-code-adapter.ts`): a
 * malformed or partial notice degrades to "no reading" for the fields it lacks, never a fabricated
 * zero — `isUsingOverage: false` is a real reading and is carried, never dropped as falsy. Measured
 * live in run `01M3C48C3PV1NSGHERBZ587YB1` (`scripts/uat/fixtures/live-opus5-unmodelled-shapes.json`):
 * `status: "allowed_warning"`, `rateLimitType: "seven_day"`, `utilization: 0.81`,
 * `surpassedThreshold: 0.75`, `resetsAt: 1790596800`, `isUsingOverage: false`.
 */
export interface RateLimitEvent extends AgentEventBase {
  type: "rate_limit";
  status?: string;
  rateLimitType?: string;
  utilization?: number;
  surpassedThreshold?: number;
  resetsAt?: number;
  isUsingOverage?: boolean;
  /** Plan 09-05: the normalised interpretation of {@link status}, computed by `rateLimitTier` from the
   * top-level status field and nothing else. Absent when the wire carried no status, or one this
   * adapter does not recognise — an unrecognised status is never concluded to mean either "go" or
   * "stop". */
  tier?: RateLimitTier;
}

/**
 * The normalised event union every adapter emits, in exactly the order the backend process
 * produced them (AGNT-01 ordering) — no reordering, no batching, no coalescing.
 */
export type AgentEvent =
  | InitEvent
  | AssistantTextEvent
  | BackendEchoEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | CostUpdateEvent
  | SystemNoticeEvent
  | ResultEvent
  | UnknownEvent
  | SessionClosedEvent
  | GitRetryEvent
  | GitLockExhaustedEvent
  | ScopeDeniedEvent
  | ThinkingEvent
  | RateLimitEvent;

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
  /** Phase 09 review CR-01: the Rust core wrote an ARMED scope marker for this run. The adapter
   * must then refuse to start unless it can wire the scope gate in (fail closed); an unarmed run
   * (no declared file-set, D-150) is unaffected. Absent means unarmed. */
  scopeArmed?: boolean;
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
