/**
 * The live session surface (D-31, plan 02-01 Task 1): a full content-area surface, pushed into
 * from a task and popped back out of via the `← Board` affordance — never a tab inside the 480px
 * item detail panel and never a dockable pane. The board stays the board.
 *
 * Deliberately thin here — plan 02-07 builds the structured feed, virtualization, raw view and
 * status strip. This component proves the read path reaches the screen: it reads pages with
 * `useInfiniteQuery` against `agentRunLogWindow` (D-33's bounded window) and invalidates on
 * `subscribeAgentEvent` (D-32's live push) — one plain row per event, oldest first.
 *
 * Plan 02-02 Task 3 adds the Stop affordance and the run-status word. Status is rendered as plain
 * words only — `Running` / `Blocked` / `Completed` / `Failed` / `Interrupted` — with no glyph and
 * no new colour token in this plan; plan 02-03 introduces the `agent` mark channel and the new
 * colour roles, and plan 02-07 binds the glyphs. No keydown listener is registered here either:
 * `⌘.` belongs to `state/keyboard.ts`'s single key→action map, owned by plan 02-03 this wave.
 *
 * Plan 02-06 Task 2 mounts the permission-request card's `feed` variant here, at the tail of the
 * event list — this feed is still the plain, unstructured row-per-raw-event render plan 02-07
 * replaces, so "at its position in the transcript" resolves concretely to "after every event
 * currently loaded," which is where a genuinely pending request always sits (nothing else can
 * happen on this run until it's answered). The feed's follow-the-tail behaviour (a tail sentinel,
 * scrolled into view on new events) is suppressed for as long as ANY request is pending, and
 * resumes the instant none is (02-UI-SPEC.md Performance Contract: "the feed must not auto-scroll
 * away from" a pending card).
 */
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { agentRunLogWindow, answerPermissionRequest, stopAgentRun, subscribeAgentEvent } from "../adapters/tauri";
import { usePendingPermissionRequests } from "../board/useBoardQuery";
import { PermissionRequestCard, type PermissionDecision } from "./PermissionRequestCard";

const PAGE_SIZE = 50;

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

function sessionLogQueryKey(agentRunId: string) {
  return ["agent-run-log", agentRunId] as const;
}

/** One plain row for an event — deliberately unstructured (plan 02-07 replaces this render with
 * the real structured feed). Falls back gracefully when a field this phase's normalised events
 * don't always carry (e.g. `text`) is absent. */
function EventRow({ event, index }: { event: Record<string, unknown>; index: number }) {
  const type = typeof event.type === "string" ? event.type : "unknown";
  const summary =
    (typeof event.text === "string" && event.text) ||
    (typeof event.toolName === "string" && event.toolName) ||
    (typeof event.sessionId === "string" && event.sessionId) ||
    "";

  return (
    <div
      role="listitem"
      style={{
        display: "flex",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) 0",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)", flexShrink: 0 }}>
        {String(index).padStart(4, "0")}
      </span>
      <span className="type-label" style={{ color: "var(--accent-text-rack)", flexShrink: 0 }}>
        {type}
      </span>
      <span className="type-body" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {summary}
      </span>
    </div>
  );
}

export function SessionSurface({ agentRunId, onBack, initialStatus = "running" }: SessionSurfaceProps) {
  const queryClient = useQueryClient();
  const queryKey = sessionLogQueryKey(agentRunId);
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [stopping, setStopping] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);

  const logQuery = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) =>
      (await agentRunLogWindow(agentRunId, pageParam, PAGE_SIZE)) ?? [],
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      (lastPage?.length ?? 0) === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });

  // The permission-request card's `feed` mount (AGNT-06, plan 02-06 Task 2) — this run's pending
  // set, read from the ONE shared query the item detail panel's compact mount also reads for the
  // same `agentRunId`, so answering in either place clears both (Discretion #6).
  const pendingQuery = usePendingPermissionRequests(agentRunId);
  const pendingRequests = pendingQuery.data ?? [];

  async function handleAnswer(requestId: string, decision: PermissionDecision) {
    await answerPermissionRequest(requestId, decision);
  }

  // A live `agent:event` push invalidates the windowed read (D-32/D-04) — the stream itself is
  // never treated as the source of truth, only the persisted log read back through the command.
  // The terminal status word ALSO arrives through this same pushed delta (a `session_closed`
  // event's `reason`, plan 02-02 D-35) — never from `stopAgentRun`'s own resolved promise, which
  // is why the Stop control below never assumes its own write landed.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeAgentEvent((event) => {
      queryClient.invalidateQueries({ queryKey });
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
      // The terminal status still arrives through the pushed delta if the stop actually landed
      // server-side — a failed invoke here just re-enables the control so the user can retry.
      setStopping(false);
    });
  }

  const showStop = !TERMINAL_STATUSES.includes(status);
  const events = logQuery.data?.pages.flat() ?? [];

  // Follow-the-tail (02-UI-SPEC.md Performance Contract) — suppressed for as long as ANY
  // permission request is pending, and resumes the instant none is (this effect re-runs on
  // `pendingRequests.length` transitioning back to zero, which is exactly "resume once answered").
  useEffect(() => {
    if (pendingRequests.length > 0) return;
    // Optional call, not just optional chaining on the ref: jsdom (this project's test
    // environment) implements no `Element.prototype.scrollIntoView` at all — a real browser always
    // has it, but a test asserting this behaviour installs its own spy first.
    tailRef.current?.scrollIntoView?.({ block: "end" });
  }, [events.length, pendingRequests.length]);

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

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}>
        {logQuery.isPending && (
          <p className="type-body" style={{ color: "var(--text-muted-rack)" }}>
            Loading session…
          </p>
        )}

        <div role="list" aria-label="Session events" style={{ display: "flex", flexDirection: "column" }}>
          {events.map((event, index) => (
            <EventRow key={index} event={event} index={index} />
          ))}
        </div>

        {logQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => logQuery.fetchNextPage()}
            disabled={logQuery.isFetchingNextPage}
            className="type-label"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent-text-rack)",
              cursor: "pointer",
              padding: "var(--space-sm) 0",
            }}
          >
            {logQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}

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
