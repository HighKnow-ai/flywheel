/**
 * The live session surface (D-31, plan 02-01 Task 1): a full content-area surface, pushed into
 * from a task and popped back out of via the `← Board` affordance — never a tab inside the 480px
 * item detail panel and never a dockable pane. The board stays the board.
 *
 * Deliberately thin here — plan 02-07 builds the structured feed, virtualization, raw view and
 * status strip. This component proves the read path reaches the screen: it reads pages with
 * `useInfiniteQuery` against `agentRunLogWindow` (D-33's bounded window) and invalidates on
 * `subscribeAgentEvent` (D-32's live push) — one plain row per event, oldest first.
 */
import { useEffect } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { agentRunLogWindow, subscribeAgentEvent } from "../adapters/tauri";

const PAGE_SIZE = 50;

export interface SessionSurfaceProps {
  agentRunId: string;
  onBack: () => void;
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

export function SessionSurface({ agentRunId, onBack }: SessionSurfaceProps) {
  const queryClient = useQueryClient();
  const queryKey = sessionLogQueryKey(agentRunId);

  const logQuery = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) =>
      (await agentRunLogWindow(agentRunId, pageParam, PAGE_SIZE)) ?? [],
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      (lastPage?.length ?? 0) === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });

  // A live `agent:event` push invalidates the windowed read (D-32/D-04) — the stream itself is
  // never treated as the source of truth, only the persisted log read back through the command.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeAgentEvent(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunId]);

  const events = logQuery.data?.pages.flat() ?? [];

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
      </div>
    </div>
  );
}
