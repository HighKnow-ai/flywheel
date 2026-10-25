/**
 * The raw view (D-32's escape hatch, 02-UI-SPEC.md "View raw" affordance, plan 02-07 Task 3): the
 * verbatim persisted log, monospace, line-numbered, read-only, paged through `sessionRawWindow`
 * with the same bounded, tail-first window `useSessionFeed` uses (D-33) — never the whole file at
 * once. This is what lets a user check a structured feed row's ground truth without leaving the
 * app: the file must be written regardless (D-34), so this view is cheap.
 *
 * Renders at the Label size (11px), not Body (13px), so a long payload fits without wrapping
 * every line (02-UI-SPEC.md "Typography Additions"). Self-contained: this file owns its own
 * paging query rather than sharing `useSessionFeed`'s hook (both page through `logPaging.ts`), since the raw view's page shape
 * (verbatim lines, not parsed events) is a different read entirely.
 */
import { useEffect, useMemo, type UIEvent } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { sessionRawWindow, subscribeAgentEvent } from "../adapters/tauri";
import { fetchLogPage, nextLogPage, previousLogPage, useFollowLogTail, type LogPageParam } from "./logPaging";

const MONO_STACK = "var(--font-code)";
const SCROLL_TOP_FETCH_THRESHOLD_PX = 40;

export interface RawLogViewProps {
  sessionId: string;
}

export function rawLogQueryKey(sessionId: string) {
  return ["agent-run-raw-log", sessionId] as const;
}

export function RawLogView({ sessionId }: RawLogViewProps) {
  const queryClient = useQueryClient();
  const queryKey = rawLogQueryKey(sessionId);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeAgentEvent(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, queryClient]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchLogPage((offset, limit) => sessionRawWindow(sessionId, offset, limit), pageParam as LogPageParam),
    initialPageParam: "tail" as LogPageParam,
    // The same tiling windows as the structured feed (`logPaging.ts`, issue #190): no line twice.
    getNextPageParam: (lastPage) => nextLogPage(lastPage, lastPage.lines.length),
    getPreviousPageParam: (firstPage) => previousLogPage(firstPage),
  });
  useFollowLogTail(query);

  const lines = useMemo(() => query.data?.pages.flatMap((page) => page.lines) ?? [], [query.data]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (
      event.currentTarget.scrollTop <= SCROLL_TOP_FETCH_THRESHOLD_PX &&
      query.hasPreviousPage &&
      !query.isFetchingPreviousPage
    ) {
      query.fetchPreviousPage();
    }
  }

  return (
    <div
      role="log"
      aria-label="Raw session log"
      data-testid="raw-log-scroll"
      onScroll={handleScroll}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "var(--space-md)",
        fontFamily: MONO_STACK,
      }}
    >
      {lines.map((line) => (
        <div
          key={line.line}
          className="type-label"
          style={{ display: "flex", gap: "var(--space-sm)", color: "var(--foreground)" }}
        >
          <span
            className="tabular-nums"
            style={{ color: "var(--muted-foreground)", flexShrink: 0, minWidth: "3.5em", textAlign: "right" }}
          >
            {line.line}
          </span>
          <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0 }}>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
