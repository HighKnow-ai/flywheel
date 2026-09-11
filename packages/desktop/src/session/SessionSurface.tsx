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
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { answerPermissionRequest, stopAgentRun, subscribeAgentEvent } from "../adapters/tauri";
import { useSessionFeed, usePendingPermissionRequests } from "../board/useBoardQuery";
import { PermissionRequestCard, type PermissionDecision } from "./PermissionRequestCard";
import { FeedRow, feedRowEstimateSize, useExpandedRows, type FeedRowData } from "./FeedRow";

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

export interface SessionSurfaceProps {
  agentRunId: string;
  onBack: () => void;
  /** The run's status when this surface first mounts. Defaults to `"running"` — in this phase
   * the surface is only ever pushed into right after Start Work; a later plan that adds a "View"
   * affordance for an already-terminal run should pass its real starting status here instead of
   * relying on this default. */
  initialStatus?: RunStatus;
}

/** Event kinds the feed suppresses from its own row list — each is either consumed elsewhere
 * (`init`/`cost_update` feed the header/status-strip; `permission_request` is the dedicated
 * `PermissionRequestCard` mount below) or is the terminal row's own data source
 * (`session_closed`, resolved by `findTerminalInfo`). Suppressing is not dropping: nothing here
 * is a candidate for the raw-fallback rule below, because each is already rendered somewhere. */
const SUPPRESSED_EVENT_TYPES = new Set(["init", "cost_update", "permission_request", "session_closed"]);

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

    // Anything else — including session_log.rs's own `unknown` entry for a malformed line —
    // never disappears (T-02-33).
    rows.push({ kind: "raw", key, raw: rawTextFor(event) });
  });

  return rows;
}

interface TerminalInfo {
  reason: RunStatus;
  subtype?: string;
}

/** The terminal row's own data source (D-35's "exactly one `session_closed` event, ever") — the
 * LAST such event in the loaded window, since a run only ever closes once. */
export function findTerminalInfo(entries: Record<string, unknown>[]): TerminalInfo | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i];
    if (event.type === "session_closed" && isRunStatus(event.reason)) {
      const result = event.result as { subtype?: string } | undefined;
      return { reason: event.reason, subtype: result?.subtype };
    }
  }
  return undefined;
}

const FAILED_RUN_GLOSS = "This run ended in an error. The worktree was left as-is — nothing was lost.";

function TerminalRow({ info }: { info: TerminalInfo }) {
  if (info.reason === "failed") {
    return (
      <div
        role="listitem"
        style={{
          marginTop: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-md)",
          borderLeft: "4px solid var(--destructive-text-rack)",
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

export function SessionSurface({ agentRunId, onBack, initialStatus = "running" }: SessionSurfaceProps) {
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [stopping, setStopping] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { expanded, toggle } = useExpandedRows();

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
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunId]);

  function handleStop() {
    setStopping(true);
    stopAgentRun(agentRunId).catch(() => {
      setStopping(false);
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
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {RUN_STATUS_LABELS[status]}
        </span>

        {showStop && (
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="type-label"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: stopping ? "default" : "pointer",
            }}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </header>

      <div
        ref={parentRef}
        onScroll={handleScroll}
        data-testid="session-feed-scroll"
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}
      >
        {showStartingPulse && <StartingSessionRow />}

        <div role="list" aria-label="Session events" style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = feedRows[virtualRow.index];
            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <FeedRow row={row} expanded={expanded.has(row.key)} onToggleExpand={() => toggle(row.key)} />
              </div>
            );
          })}
        </div>

        {terminalInfo && <TerminalRow info={terminalInfo} />}

        {pendingRequests.length > 0 && (
          <div style={{ marginTop: "var(--space-md)" }}>
            <PermissionRequestCard variant="feed" requests={pendingRequests} onAnswer={handleAnswer} />
          </div>
        )}

        <div ref={tailRef} />
      </div>
    </div>
  );
}
