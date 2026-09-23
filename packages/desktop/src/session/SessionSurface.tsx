/**
 * The live session surface (D-31, plan 02-01 Task 1): a full content-area surface, pushed into
 * from a task and popped back out of via the `← Board` affordance — never a tab inside the 480px
 * item detail panel and never a dockable pane. The board stays the board.
 *
 * Plan 02-02 Task 3 adds the Stop affordance and the run-status word. Plan 02-06 Task 2 mounts
 * the permission-request card's `feed` variant here, at the tail of the event list, and
 * suppresses the feed's follow-the-tail scroll for as long as any request is pending.
 *
 * Plan 02-07 Task 2 replaces the tracer's plain row-per-raw-event render with the real
 * structured feed (D-32): `useSessionFeed` (`board/useBoardQuery.ts`) pages a bounded window in
 * from the TAIL of the persisted log (D-33), older pages fetched as the user scrolls toward the
 * top of what is loaded — never the whole transcript in memory (PROC-07). `FeedRow.tsx` renders
 * one row per normalised event; `buildFeedRows` below is the pairing/filtering step that turns
 * the raw windowed-read entries into that row list — a `tool_call` paired with its own
 * `tool_result` by `toolName` (FIFO — no correlation id exists on either event), `init`/
 * `cost_update`/`permission_request`/`session_closed` suppressed from the row list (each is
 * either metadata the header/status-strip consumes elsewhere, or — for `session_closed` — the
 * terminal row's own data source), and any other kind falling back to a raw, verbatim row rather
 * than silently disappearing (T-02-33). Virtualized with this codebase's own
 * `@tanstack/react-virtual` configuration — a fixed size per row kind, `virtualizer.measure()`
 * (never `measureElement`) invalidating the size cache when a tool-call row's expand state
 * changes, matching Phase 1's explicit rejection of measured virtualization.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as icons from "lucide-react";
import { answerPermissionRequest, discardSession, stopAgentRun, subscribeAgentEvent } from "../adapters/tauri";
import { ProposalTray } from "../authoring/ProposalTray";
import { useSessionFeed, usePendingPermissionRequests } from "../board/useBoardQuery";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { PermissionRequestCard, type PermissionDecision } from "./PermissionRequestCard";
import { FeedRow, feedRowEstimateSize, useExpandedRows, type FeedRowData } from "./FeedRow";
import { RawLogView } from "./RawLogView";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The five values `agent_runs.status` can hold (migration `0003_agent_runtime.sql`). */
export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted"];

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && value in RUN_STATUS_LABELS;
}

/** `agent_runs.status` -> the matching published `agent`-channel mark id (`legend/marks.ts`,
 * plan 02-03) — the run-status badge's own glyph/label source, never a second hand-typed list. */
const RUN_STATUS_MARK_ID: Record<RunStatus, string> = {
  running: "run-running",
  blocked: "run-blocked",
  completed: "run-completed",
  failed: "run-failed",
  interrupted: "run-interrupted",
};

/** 02-UI-SPEC.md's "Run Status" table — running/interrupted reuse existing roles, the other
 * three are the colour roles plan 02-03 published. */
const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  running: "var(--accent-text-rack)",
  blocked: "var(--blocked-text-rack)",
  completed: "var(--success-text-rack)",
  failed: "var(--destructive-text-rack)",
  interrupted: "var(--text-muted-rack)",
};

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Resolve a Lucide icon by name — the same by-name pattern `ActivityTrail.tsx`/
 * `PermissionRequestCard.tsx` already use, so no icon component is ever named directly. */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** Whether the OS reports a reduced-motion preference — checked once at mount (no acceptance
 * criterion in this plan requires reacting to the preference changing mid-session). Guarded for
 * an environment with no `matchMedia` at all (this project's own jsdom test environment does not
 * implement it by default; a test asserting the reduced-motion path installs its own mock first). */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The glyph-and-word run-status badge (02-UI-SPEC.md "Run Status", plan 02-07 Task 3) — never
 * colour alone. `run-running`'s `Loader` glyph carries the one continuous-motion exception this
 * product allows (Motion Additions: "signalling a process is alive right now, not decorating a
 * state change"); `.agent-pulse` (styles/motion.css) is omitted entirely under a reduced-motion
 * preference rather than merely zeroed, so the glyph stays static rather than freezing mid-pulse —
 * but it is never removed, the running state must stay legible either way. */
function RunStatusBadge({ status }: { status: RunStatus }) {
  const mark = MARKS_BY_ID[RUN_STATUS_MARK_ID[status]];
  const pulsing = status === "running" && !prefersReducedMotion();
  return (
    <span
      className="type-label"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: RUN_STATUS_COLOR[status] }}
    >
      <span aria-hidden="true" className={pulsing ? "agent-pulse" : undefined} style={{ display: "inline-flex" }}>
        <Icon name={mark?.glyph ?? "Circle"} />
      </span>
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

/** The most recent numeric value found under any of `fields`, scanning newest-to-oldest — the
 * status strip's own opportunistic extraction (02-UI-SPEC.md "Cost/token status strip"). The
 * backend reports token counts and cost as SESSION TOTALS exactly once, on its terminal `result`
 * event — never accumulated per message (G-02-4's "Token accounting decision") — and carries them
 * as TOP-LEVEL fields (`inputTokens`/`outputTokens`/`totalCostUsd`) this scan already looks for, so
 * the counters legitimately read "—" for the duration of a running session and flip to the real
 * figures the moment the backend reports them; that is correct behaviour under this decision, not
 * residue of a defect. A caller with no matching field gets `undefined`, rendered as "—" rather
 * than a fabricated zero. */
function latestNumericField(entries: Record<string, unknown>[], fields: string[]): number | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i];
    for (const field of fields) {
      const value = event[field];
      if (typeof value === "number") return value;
    }
  }
  return undefined;
}

function formatElapsed(startIso: string | undefined, nowMs: number): string {
  if (!startIso) return "0:00";
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return "0:00";
  const deltaSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}

function formatCostUsd(value: number | undefined): string {
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

/** Re-renders once a second while `enabled` — the status strip's own elapsed-time ticker. Its
 * own isolated re-render boundary (`StatusStrip` below, not the header/feed) is what keeps this
 * tick from re-rendering the rest of the surface (02-UI-SPEC.md Performance Contract Additions:
 * "an isolated re-render boundary... matching the board's... 'one row moves, the rack does not
 * re-render' thesis"). */
function useNowTick(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

/** The right-aligned cost/token status strip (02-UI-SPEC.md "Cost/token status strip") — its own
 * component so the elapsed-time tick's re-render never reaches the header chrome or the feed. */
function StatusStrip({
  entries,
  running,
}: {
  entries: Record<string, unknown>[];
  running: boolean;
}) {
  const now = useNowTick(running);
  const startedAt = typeof entries[0]?.at === "string" ? (entries[0].at as string) : undefined;
  const tokensIn = latestNumericField(entries, ["tokensIn", "inputTokens", "tokens_in"]);
  const tokensOut = latestNumericField(entries, ["tokensOut", "outputTokens", "tokens_out"]);
  const costUsd = latestNumericField(entries, ["totalCostUsd", "cost_usd"]);

  return (
    <div
      style={{
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        color: "var(--text-muted-rack)",
      }}
    >
      <span className="type-label tabular-nums" aria-label="Elapsed time">
        {formatElapsed(startedAt, now)}
      </span>
      <span className="type-label tabular-nums" aria-label="Tokens in">
        {formatCount(tokensIn)} in
      </span>
      <span className="type-label tabular-nums" aria-label="Tokens out">
        {formatCount(tokensOut)} out
      </span>
      <span className="type-label tabular-nums" aria-label="Cost">
        {formatCostUsd(costUsd)}
      </span>
    </div>
  );
}

export interface SessionSurfaceProps {
  agentRunId: string;
  onBack: () => void;
  /** The task this run belongs to (D-66/D-67, plan 04-13) — `null` only for a caller that has not
   * been updated to thread it through yet (defensive; every current caller supplies it). Needed
   * so `handleDiscard` can hand off to the launch sheet for the SAME task on resolution — the
   * surface has no other source for this id (it is never itself queried from the backend). */
  taskId?: string | null;
  /** The run's status when this surface first mounts. Defaults to `"running"` — in this phase
   * the surface is only ever pushed into right after Start Work; a later plan that adds a "View"
   * affordance for an already-terminal run should pass its real starting status here instead of
   * relying on this default. */
  initialStatus?: RunStatus;
  /** D-88/D-84 (plan 05-02): the run's `agent_runs.authoring_stage`, or `null`/`undefined` for an
   * ordinary task-execution run. `ProposalTray` mounts beside the feed ONLY when this is present —
   * an authoring run's own distinguishing fact, carried from `App.tsx`'s `activeAgentRunAuthoringStage`
   * (`state/uiStore.ts`), since this surface never itself queries which kind of run it is showing. */
  authoringStage?: string | null;
}

/** Event kinds the feed suppresses from its own row list — each is either consumed elsewhere
 * (`init`/`cost_update`/`result` feed the header/status-strip; `permission_request` is the
 * dedicated `PermissionRequestCard` mount below) or is the terminal row's own data source
 * (`session_closed`, resolved by `findTerminalInfo`) — a standalone `result` normally arrives
 * immediately before `session_closed` and would otherwise render as a redundant raw line right
 * before the real terminal row appears. Suppressing is not dropping: nothing here is a candidate
 * for the raw-fallback rule below, because each is already rendered somewhere. */
const SUPPRESSED_EVENT_TYPES = new Set([
  "init",
  "cost_update",
  "result",
  "permission_request",
  "session_closed",
  // D-53/plan 03-13: the exhaustion notice's own row is a hard no — see `buildFeedRows` below,
  // which never even lets one of these reach `FeedRow.tsx`'s own (defense-in-depth) no-render
  // case. Suppressed here for the same reason `session_closed` is: it is rendered elsewhere (the
  // Activity Trail), never as a feed row at all.
  "git_lock_exhausted",
]);

/** A stable React/expand-tracking key for one raw log entry — `seq` (every normalised
 * `AgentEvent` carries one, AGNT-01) is preferred because it never shifts when the tail page's
 * own OFFSET changes as the log crosses a page boundary; a malformed line (session_log.rs's own
 * synthesized `unknown` entry) falls back to its `line` number, and the flattened array position
 * is the last resort for a genuinely shapeless entry. */
function keyForEvent(event: Record<string, unknown>, index: number): string {
  if (typeof event.seq === "number") return `seq-${event.seq}`;
  if (typeof event.line === "number") return `line-${event.line}`;
  return `idx-${index}`;
}

function rawTextFor(event: Record<string, unknown>): string {
  if (typeof event.raw === "string") return event.raw;
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

/**
 * Turn the flattened, ascending-chronological windowed-read entries into the feed's own row
 * list (D-32). A `tool_call` is paired with the next same-`toolName` `tool_result` (FIFO per
 * tool name — the sidecar's own `AgentEvent` union carries no call-correlation id, so exact
 * pairing under concurrent same-named calls is a known, accepted simplification; every event
 * still renders SOMETHING regardless, per T-02-33). An unpaired `tool_result` (no matching
 * pending call, or no `toolName` at all) falls back to a raw row rather than disappearing.
 */
export function buildFeedRows(entries: Record<string, unknown>[]): FeedRowData[] {
  const rows: FeedRowData[] = [];
  const pendingByTool = new Map<string, number[]>();

  entries.forEach((event, index) => {
    const type = typeof event.type === "string" ? event.type : "unknown";
    const key = keyForEvent(event, index);

    if (type === "tool_result") {
      const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
      const queue = toolName ? pendingByTool.get(toolName) : undefined;
      if (queue && queue.length > 0) {
        const targetIndex = queue.shift() as number;
        const target = rows[targetIndex];
        if (target && target.kind === "tool_call") {
          rows[targetIndex] = { ...target, output: event.output };
        }
        return;
      }
      rows.push({ kind: "raw", key, raw: rawTextFor(event) });
      return;
    }

    if (SUPPRESSED_EVENT_TYPES.has(type)) return;

    if (type === "assistant_text") {
      rows.push({ kind: "assistant_text", key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    if (type === "tool_call") {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      rows.push({ kind: "tool_call", key, toolName, input: event.input });
      const queue = pendingByTool.get(toolName) ?? [];
      queue.push(rows.length - 1);
      pendingByTool.set(toolName, queue);
      return;
    }

    if (type === "system_notice") {
      rows.push({ kind: "system_notice", key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    // D-53/plan 03-13: the shim's retry notice — routed to FeedRow.tsx's own "git_retry" case,
    // which reuses the system/transient row kind's exact treatment. `git_lock_exhausted` is
    // suppressed above (SUPPRESSED_EVENT_TYPES) and never reaches this point at all.
    if (type === "git_retry") {
      rows.push({
        kind: "git_retry",
        key,
        attempt: typeof event.attempt === "number" ? event.attempt : 0,
        max: typeof event.max === "number" ? event.max : 0,
      });
      return;
    }

    // Anything else — including session_log.rs's own `unknown` entry for a malformed line —
    // never disappears (T-02-33).
    rows.push({ kind: "raw", key, raw: rawTextFor(event) });
  });

  return rows;
}

interface TerminalInfo {
  reason: RunStatus;
  subtype?: string;
  /** The backend's own explanation of why the session ended (G-02-2) — the sidecar's retained
   * stderr tail, or a spawn error's message, carried on the terminal event's `detail` field.
   * Absent, not empty, when there is nothing to show. */
  detail?: string;
}

/** The terminal row's own data source (D-35's "exactly one `session_closed` event, ever") — the
 * LAST such event in the loaded window, since a run only ever closes once. */
export function findTerminalInfo(entries: Record<string, unknown>[]): TerminalInfo | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i];
    if (event.type === "session_closed" && isRunStatus(event.reason)) {
      const result = event.result as { subtype?: string } | undefined;
      const detail = typeof event.detail === "string" ? event.detail : undefined;
      return { reason: event.reason, subtype: result?.subtype, detail };
    }
  }
  return undefined;
}

/** The shared "expanded" sub-block's fixed max height (px) — matches
 * `FeedRow.tsx`'s own `EXPANDED_SUBBLOCK_MAX_HEIGHT` (G-02-3's containment pattern for a long,
 * internally-scrolling block), duplicated here rather than imported since `FeedRow.tsx` does not
 * export it and this module already duplicates `MONO_STACK` the same way. */
const TERMINAL_DETAIL_MAX_HEIGHT = 240;

const FAILED_RUN_GLOSS = "This run ended in an error. The worktree was left as-is — nothing was lost.";

function TerminalRow({ info }: { info: TerminalInfo }) {
  if (info.reason === "failed") {
    return (
      <div
        role="listitem"
        style={{
          marginTop: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-md)",
          background: "var(--surface-secondary)",
          borderRadius: "var(--radius-chrome)",
        }}
      >
        <p className="type-body" style={{ margin: 0, color: "var(--text-primary-rack)" }}>
          {FAILED_RUN_GLOSS}
        </p>
        {info.subtype && (
          <p
            className="type-label"
            style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--destructive-text-rack)" }}
          >
            {info.subtype}
          </p>
        )}
        {info.detail && (
          <div
            data-testid="terminal-detail"
            className="type-label"
            style={{
              marginTop: "var(--space-xs)",
              maxHeight: TERMINAL_DETAIL_MAX_HEIGHT,
              overflowY: "auto",
              fontFamily: MONO_STACK,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--text-muted-rack)",
            }}
          >
            {info.detail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className="type-label"
      style={{ marginTop: "var(--space-sm)", padding: "var(--space-sm) var(--space-md)", color: "var(--text-muted-rack)" }}
    >
      {RUN_STATUS_LABELS[info.reason]}
    </div>
  );
}

const STOP_WARNING_GLOSS = "Flywheel could not confirm the agent process actually stopped.";

/** The "stop was recorded but the sidecar could not confirm it" notice (plan 02-11, CR-04) —
 * `02-UI-SPEC.md` specifies no presentation for this case, so this reuses E2's terminal-row
 * pattern (a one-line human gloss above the machine detail, in the Mono role) at the
 * **interrupted** weight: `--text-muted-rack` and the CircleSlash mark, never the failed run's
 * `--destructive-text-rack` stripe or CircleX glyph, because the run DID reach `interrupted`. */
function StopWarningNotice({ warning }: { warning: string }) {
  const mark = MARKS_BY_ID["run-interrupted"];
  return (
    <div
      role="listitem"
      style={{
        marginTop: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        borderRadius: "var(--radius-chrome)",
      }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--text-primary-rack)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name={mark?.glyph ?? "CircleSlash"} />
        </span>
        {STOP_WARNING_GLOSS}
      </p>
      <p
        className="type-label"
        style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--text-muted-rack)" }}
      >
        {warning}
      </p>
    </div>
  );
}

/** The "this run's persisted transcript may be incomplete" banner (plan 02-12, CR-03/PROC-07) —
 * `02-UI-SPEC.md` specifies no presentation for this case either, so it reuses the exact same
 * muted notice treatment `StopWarningNotice` above established: `--text-muted-rack`, a single
 * one-line human sentence, no destructive styling. Rendered ABOVE the feed and OUTSIDE the
 * virtualizer's row list — it is surface state, not a feed row, so it survives paging and never
 * competes with the bounded-window property `buildFeedRows`/`useSessionFeed` maintain. */
function PersistenceFailureBanner({ text }: { text: string }) {
  return (
    <div
      role="listitem"
      style={{
        marginBottom: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        borderRadius: "var(--radius-chrome)",
      }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--text-primary-rack)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name="TriangleAlert" />
        </span>
        {text}
      </p>
    </div>
  );
}

/** The user must never see an empty scroll area while the process starts (02-UI-SPEC.md State
 * Inventory: "empty"/"loading" both resolve to this same pulse row) — replaced the moment the
 * first real event arrives, never accumulating above it (it renders only while `feedRows` is
 * empty). */
function StartingSessionRow() {
  return (
    <div role="listitem" className="type-body" style={{ padding: "var(--space-xs) 0", color: "var(--text-muted-rack)" }}>
      Starting session…
    </div>
  );
}

const SCROLL_TOP_FETCH_THRESHOLD_PX = 40;

export function SessionSurface({
  agentRunId,
  onBack,
  taskId = null,
  initialStatus = "running",
  authoringStage = null,
}: SessionSurfaceProps) {
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [stopping, setStopping] = useState(false);
  // `stopping` alone is not a sufficient guard against two activations in one synchronous tick —
  // React has not necessarily flushed the re-render that disables the Stop button before a
  // second `.click()` fires — and a ref reads and writes synchronously with no such window
  // (mirrors `item-detail/RunsSection.tsx`'s `ackActingRef` / `recovery/OrphanRecoveryModal.tsx`'s
  // `killingRef`, 03-17-PLAN.md Task 1). `stopping` stays the source of truth for what renders;
  // this ref only guards dispatch.
  const stoppingRef = useRef(false);
  // Discard's own pair of the same guard (D-66/D-67, plan 04-13) — copies `stopping`/`stoppingRef`
  // structure exactly, for the same reason: the discard's own bounded wait can run up to eight
  // seconds, so the window for a second synchronous activation before React flushes the disabled
  // attribute is, if anything, more likely to matter here, not less.
  const [discarding, setDiscarding] = useState(false);
  const discardingRef = useRef(false);
  const [stopWarning, setStopWarning] = useState<string | null>(null);
  const setLaunchSheetTaskId = useUiStore((state) => state.setLaunchSheetTaskId);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [persistenceFailureText, setPersistenceFailureText] = useState<string | null>(null);
  const [rawViewOpen, setRawViewOpen] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { expanded, toggle } = useExpandedRows();

  // The "View raw" toggle (02-UI-SPEC.md "View raw" affordance, plan 02-07 Task 3) — subscribes
  // to the `toggle-raw-view` action id rather than owning a key of its own; the window-level
  // listener lives inside `useRegionBindings` (state/keyboard.ts), not here.
  useRegionBindings("session-surface", "session-surface", {
    "toggle-raw-view": () => setRawViewOpen((prev) => !prev),
  });

  const feedQuery = useSessionFeed(agentRunId);

  // The permission-request card's `feed` mount (AGNT-06, plan 02-06 Task 2) — this run's pending
  // set, read from the ONE shared query the item detail panel's compact mount also reads for the
  // same `agentRunId`, so answering in either place clears both (Discretion #6).
  const pendingQuery = usePendingPermissionRequests(agentRunId);
  const pendingRequests = pendingQuery.data ?? [];

  async function handleAnswer(requestId: string, decision: PermissionDecision) {
    await answerPermissionRequest(requestId, decision);
  }

  // The terminal status word arrives through the same pushed delta a live `agent:event` push
  // drives (a `session_closed` event's `reason`, plan 02-02 D-35) — never from `stopAgentRun`'s
  // own resolved promise, which is why the Stop control below never assumes its own write landed.
  // `useSessionFeed` itself owns invalidating the windowed read on this same subscription.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeAgentEvent((event) => {
      if (event.type === "session_closed" && isRunStatus(event.reason)) {
        setStatus(event.reason);
      }
      // The incomplete-transcript banner (plan 02-12, CR-03/PROC-07): the Rust-side reader loop
      // emits this SAME `agent:event` channel's synthetic `system_notice` the first time this
      // run's session-log persist fails. Scoped to THIS surface's own run — a notice for a
      // different run must never show here (one run's I/O fault stays scoped to that run).
      if (event.flywheelPersistenceFailure === true && event.runId === agentRunId) {
        setPersistenceFailed(true);
        setPersistenceFailureText(typeof event.text === "string" ? event.text : null);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunId]);

  // The command's own resolution now carries the status Flywheel RECORDED (plan 02-11, CR-04) —
  // the terminal write is never gated on the sidecar's acknowledgement, so this promise always
  // resolves once the command succeeds. A real `session_closed` push (the effect above) remains
  // the source for what the agent process actually did and still wins if it arrives; this is an
  // ADDITIONAL source, guarded by `isRunStatus` so an unexpected string can never widen the
  // status union. `.catch` stays the genuine-failure path — the terminal write itself failed.
  function handleStop() {
    // A second activation while the ref is set invokes nothing — the synchronous-tick guard.
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    stopAgentRun(agentRunId)
      .then((result) => {
        // Never cleared here: a successful stop drives `status` to a terminal value, `showStop`
        // goes false and the button unmounts — there is nothing left to guard.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
      })
      .catch(() => {
        // Clear the ref before re-enabling — a genuine failure must leave the control usable,
        // which matters more here than on any other surface: the alternative is an agent that
        // keeps spending.
        stoppingRef.current = false;
        setStopping(false);
      });
  }

  // D-66/D-67, CTX-08 (plan 04-13): the phase's flagship action. One activation ends the session
  // — giving the agent's own closing summary a bounded window to land first — and lands the
  // developer on the launch sheet, pre-filled for the SAME task, with no intermediate step.
  // Copies `handleStop`'s own structure line for line, including the ref-based double-activation
  // guard: React has not necessarily flushed the disabling re-render before a second activation in
  // the same synchronous tick.
  function handleDiscard() {
    if (discardingRef.current) return;
    discardingRef.current = true;
    setDiscarding(true);
    discardSession(agentRunId)
      .then((result) => {
        // Mirrors `handleStop`'s own resolution handling exactly — a real `session_closed` push
        // (the effect above) remains the source for what the agent process actually did and still
        // wins if it arrives; this is an ADDITIONAL source.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
        // One action in, one Enter out (D-67): land on the launch sheet, pre-filled for this
        // run's own task, the instant the discard resolves — no intermediate confirmation.
        if (taskId) {
          setLaunchSheetTaskId(taskId);
        }
      })
      .catch(() => {
        // On rejection, reuse the SAME muted `StopWarningNotice` treatment `handleStop` never
        // needed a rejection path for — the plan's own instruction: no second notice component.
        // Clear the ref before re-enabling, matching `handleStop`'s own "a genuine failure must
        // leave the control usable" reasoning — a surfaced contradiction must never stand between
        // the developer and a fresh session.
        discardingRef.current = false;
        setDiscarding(false);
        setStopWarning(
          "Flywheel could not confirm this discard completed. The session may still be live — try again.",
        );
      });
  }

  const showStop = !TERMINAL_STATUSES.includes(status);

  const entries = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.entries) ?? [],
    [feedQuery.data],
  );
  const feedRows = useMemo(() => buildFeedRows(entries), [entries]);
  const terminalInfo = useMemo(() => findTerminalInfo(entries), [entries]);
  const showStartingPulse = feedRows.length === 0 && !terminalInfo;

  const rowVirtualizer = useVirtualizer({
    count: feedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => feedRowEstimateSize(feedRows[index], expanded.has(feedRows[index].key)),
    overscan: 10,
  });

  // A tool-call row's expand/collapse toggle changes its OWN fixed size (never a measured one —
  // `feedRowEstimateSize` still returns one of exactly two constants); `measure()` invalidates
  // the virtualizer's cached sizes so the new `estimateSize` output takes effect. This is not
  // `measureElement` (DOM-based, per-row measurement) — it is a deterministic recomputation from
  // the same fixed-size function.
  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (
      event.currentTarget.scrollTop <= SCROLL_TOP_FETCH_THRESHOLD_PX &&
      feedQuery.hasPreviousPage &&
      !feedQuery.isFetchingPreviousPage
    ) {
      feedQuery.fetchPreviousPage();
    }
  }

  // Follow-the-tail (02-UI-SPEC.md Performance Contract) — suppressed for as long as ANY
  // permission request is pending, and resumes the instant none is (this effect re-runs on
  // `pendingRequests.length` transitioning back to zero, which is exactly "resume once answered").
  useEffect(() => {
    if (pendingRequests.length > 0) return;
    // Optional call, not just optional chaining on the ref: jsdom (this project's test
    // environment) implements no `Element.prototype.scrollIntoView` at all — a real browser always
    // has it, but a test asserting this behaviour installs its own spy first.
    tailRef.current?.scrollIntoView?.({ block: "end" });
  }, [feedRows.length, pendingRequests.length, terminalInfo]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: "var(--text-primary-rack)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-md)",
          padding: "var(--space-md)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="type-label"
          style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
        >
          ← Board
        </button>
        <span className="type-heading">Session</span>
        <RunStatusBadge status={status} />

        <StatusStrip entries={entries} running={status === "running" || status === "blocked"} />

        <button
          type="button"
          onClick={() => setRawViewOpen((prev) => !prev)}
          className="type-label"
          style={{
            background: "transparent",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: "pointer",
          }}
        >
          {rawViewOpen ? "View structured" : "View raw"}
        </button>

        {showStop && (
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping || discarding}
            className="type-label"
            style={{
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: stopping || discarding ? "default" : "pointer",
            }}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}

        {showStop && (
          // D-67: the flagship verb, beside Stop — never a modifier folded into it. Styled with
          // the same filled-accent treatment the launch sheet's own primary action
          // (`LaunchSheet.tsx`'s "Start Work" button) uses, so the control this hands off TO and
          // the control that starts this hand-off read as one visual family.
          <button
            type="button"
            onClick={handleDiscard}
            disabled={stopping || discarding}
            className="type-label"
            style={{
              background: "var(--accent-nontext)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: stopping || discarding ? "default" : "pointer",
            }}
          >
            {discarding ? "Discarding…" : "Discard"}
          </button>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      {rawViewOpen ? (
        <RawLogView agentRunId={agentRunId} />
      ) : (
        <div
          ref={parentRef}
          onScroll={handleScroll}
          data-testid="session-feed-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}
        >
          {persistenceFailed && (
            <PersistenceFailureBanner
              text={persistenceFailureText ?? "Flywheel could not write this session's log — the transcript below may be incomplete."}
            />
          )}

          {showStartingPulse && <StartingSessionRow />}

          <div role="list" aria-label="Session events" style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = feedRows[virtualRow.index];
              return (
                <div
                  key={row.key}
                  data-testid="feed-row-slot"
                  // G-02-3: this wrapper occupies EXACTLY the height the virtualizer reserved
                  // for this row (`virtualRow.size`, produced by `feedRowEstimateSize`'s fixed
                  // per-row-kind constant — never corrected by measurement) and clips anything
                  // that exceeds it. `feedRowEstimateSize` decided where the NEXT row starts, so
                  // a row free to paint past its own reservation paints over every row
                  // positioned after it — which is exactly what gap G-02-3 reported.
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    overflow: "hidden",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <FeedRow row={row} expanded={expanded.has(row.key)} onToggleExpand={() => toggle(row.key)} />
                </div>
              );
            })}
          </div>

          {terminalInfo && <TerminalRow info={terminalInfo} />}

          {stopWarning && <StopWarningNotice warning={stopWarning} />}

          {pendingRequests.length > 0 && (
            <div style={{ marginTop: "var(--space-md)" }}>
              <PermissionRequestCard variant="feed" requests={pendingRequests} onAnswer={handleAnswer} />
            </div>
          )}

          <div ref={tailRef} />
        </div>
      )}
      {authoringStage && (
        // D-88: the proposal tray mounts ONLY when this run carries an authoring stage — a
        // sibling panel beside the feed, never woven into FeedRow.tsx's per-event rendering
        // (ProposalTray.tsx's own doc comment).
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid var(--divider)",
            padding: "var(--space-md)",
            overflowY: "auto",
          }}
        >
          <ProposalTray agentRunId={agentRunId} />
        </div>
      )}
      </div>
    </div>
  );
}
