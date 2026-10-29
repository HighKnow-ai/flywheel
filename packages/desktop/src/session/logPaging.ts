/**
 * How a session log is paged into memory (D-33, PROC-07): a bounded window from the TAIL, older
 * windows paged in backward as the reader scrolls up. Shared by the structured feed
 * (`board/useBoardQuery.ts`'s `useSessionFeed`) and View raw (`RawLogView.tsx`), which read the same
 * file through two commands.
 *
 * Issue #190: the windows must tile. An older window used to be "the 50 lines before the first loaded
 * one, starting no earlier than line 0", always 50 long, so the oldest window of a log whose tail did
 * not start on a multiple of 50 re-read lines the next window already held. Those lines reached the
 * feed twice under the same React key, and the virtualizer, which caches row sizes by key, drew each
 * pair on top of each other. A window now names its own length, so it ends exactly where the next one
 * starts.
 *
 * A refetch (the session's own `agent:event` pushes invalidate the read) re-reads the first window where
 * it already is (`fetchFirstLogPage`, issue #195) and every later one through `nextLogPage`, so every
 * window loaded before the refetch is still there after it, and a live log that grew past the last one
 * is followed by `useFollowLogTail`.
 */
import { useEffect } from "react";

export const LOG_PAGE_SIZE = 50;

/** `"tail"` resolves against the log's current length on every read; an explicit window never moves. */
export type LogPageParam = "tail" | { offset: number; limit: number };

/** What every window read reports: where it starts and how long the whole log is. */
export interface LogPage {
  offset: number;
  total: number;
}

/** A window read: `count` is how many lines this page holds (`entries.length` or `lines.length`). */
export type ReadWindow<P extends LogPage> = (offset: number, limit: number) => Promise<P>;

/** Reads one page. `"tail"` needs a probe first when the log is longer than one page, since only a
 * read reports `total`. An initial numeric offset (the triage jump, D-99) is an explicit window. */
export async function fetchLogPage<P extends LogPage>(read: ReadWindow<P>, param: LogPageParam | number): Promise<P> {
  if (typeof param === "number") return read(param, LOG_PAGE_SIZE);
  if (param !== "tail") return read(param.offset, param.limit);
  const probe = await read(0, LOG_PAGE_SIZE);
  if (probe.total <= LOG_PAGE_SIZE) return probe;
  return read(probe.total - LOG_PAGE_SIZE, LOG_PAGE_SIZE);
}

/** How far a live log may run past its pinned first window before a refetch resolves the tail again:
 * ten windows, so a refetch re-reads at most eleven windows however long the session runs. */
export const LOG_PIN_LIMIT = 10 * LOG_PAGE_SIZE;

/**
 * Reads the FIRST window of a paged read (issue #195). `pinned` is that window as it is already loaded,
 * if it is. A `"tail"` window that is already loaded is read again where it is, not resolved against
 * the log's new length: re-resolving it slid the loaded window forward by every new line, so on every
 * agent event the oldest rows dropped out and every other row moved up one. The lines after it are
 * read by the windows that follow (`nextLogPage`, `useFollowLogTail`). Once the log has run more than
 * `LOG_PIN_LIMIT` lines past it the tail is resolved again, which keeps a long-running read bounded.
 */
export async function fetchFirstLogPage<P extends LogPage>(
  read: ReadWindow<P>,
  param: LogPageParam | number,
  pinned: LogPage | undefined,
): Promise<P> {
  if (param !== "tail" || !pinned) return fetchLogPage(read, param);
  const page = await read(pinned.offset, LOG_PAGE_SIZE);
  if (page.total - pinned.offset > LOG_PIN_LIMIT) return fetchLogPage(read, "tail");
  return page;
}

/** The window just before `first`, ending exactly where `first` starts. */
export function previousLogPage(first: LogPage): LogPageParam | undefined {
  if (first.offset <= 0) return undefined;
  const offset = Math.max(0, first.offset - LOG_PAGE_SIZE);
  return { offset, limit: first.offset - offset };
}

/** The window just after `last`, starting exactly where `last` ends, while the log goes on. */
export function nextLogPage(last: LogPage, count: number): LogPageParam | undefined {
  const end = last.offset + count;
  // An empty window past the start means the read and its `total` disagree; never ask for it again.
  return count > 0 && end < last.total ? { offset: end, limit: LOG_PAGE_SIZE } : undefined;
}

/** Keeps the loaded windows reaching the end of the log: a refetch re-reads only as many windows as
 * were loaded, so a live log that grew past the last one gets its new lines from here. Off for a read
 * opened at an explicit offset (the triage jump), which pages forward only as the reader scrolls down,
 * so the window stays bounded. */
export function useFollowLogTail(
  query: {
    data: { pages: unknown[] } | undefined;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetching: boolean;
    fetchNextPage: () => unknown;
  },
  enabled = true,
) {
  const { hasNextPage, isFetchingNextPage, isFetching, fetchNextPage } = query;
  // The page count is a dependency too: a fetch can settle with every flag back where it was, and the
  // next window must still be asked for.
  const pageCount = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage && !isFetching) void fetchNextPage();
  }, [enabled, hasNextPage, isFetchingNextPage, isFetching, fetchNextPage, pageCount]);
}
