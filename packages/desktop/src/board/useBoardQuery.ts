/**
 * TanStack Query hooks wrapping `adapters/tauri.ts`, invalidated by `subscribeBoardChanged` (D-04):
 * the renderer never trusts its own write as already resolved. The board surface's own window,
 * group and mutation hooks were deleted with the board UI (issue #38); what remains serves the
 * surfaces that survive it (project rail, fleet, session, recovery).
 */
import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentRunLogWindow,
  boardRecoverySummary,
  invokeCommand,
  pendingOrphans,
  pendingPermissionRequests,
  subscribeAgentEvent,
  type LogWindowDto,
} from "../adapters/tauri";
import { useBoardChangedInvalidation } from "./useBoardChangedInvalidation";

export interface Project {
  id: string;
  keyPrefix: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  status: string;
}

const PROJECTS_QUERY_KEY = ["projects"] as const;

/** Every registered project (01-UI-SPEC.md "Project switcher"). */
export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => invokeCommand<Project[]>("project_list"),
  });
}

export interface RegisterProjectInput {
  name: string;
  repoPath: string;
  keyPrefix: string;
}

/** Register a local git repository as a project (the "Register Project…" flow). */
export function useRegisterProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterProjectInput) =>
      invokeCommand<Project>("project_register", {
        name: input.name,
        repoPath: input.repoPath,
        keyPrefix: input.keyPrefix,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
  });
}

/**
 * Subscribes EXACTLY ONCE to the core's `board:changed` push channel and routes each event by its
 * `projectId` (D-04, FNC-07) — the UI must never treat its own mutation as already resolved:
 * creating a Story refreshes the board because the core emitted `board:changed`.
 *
 * Routing: an event for the viewed project invalidates that project's board and epic keys; an event
 * for any OTHER project invalidates nothing, so a change in one project no longer re-fetches an
 * unrelated project's views; an event whose `projectId` is `null`, absent or malformed BROADCASTS
 * to the bare `["board"]` / `["epics"]` prefixes — an unroutable event that invalidated nothing
 * would leave a stale board, which is strictly worse than an over-broad refresh.
 *
 * No coalescing, debounce or timer: the event rate has not been measured, and a window sized on a
 * guess can only lose events. Two events in one tick invalidate twice.
 */
export function useBoardChangedSubscription(projectId?: string) {
  useBoardChangedInvalidation(
    { kind: "project", projectId },
    [["board", projectId], ["epics", projectId]],
    { unroutableKeys: [["board"], ["epics"]] },
  );
}

/** `usePendingPermissionRequests`' query key, keyed by `agentRunId` — the one shared query BOTH
 * the permission-request card's mount points read (AGNT-06, D-37/D-38, plan 02-06 Task 2,
 * Discretion #6: "one query, one key, consumed by both mount points, so the two instances cannot
 * disagree"). Exported so the fleet's blocked queue lands on the exact key the session feed's
 * mount uses for the same run. */
export function pendingPermissionRequestsQueryKey(agentRunId: string) {
  return ["pending-permission-requests", agentRunId] as const;
}

/**
 * The permission-request card's one shared source of truth (AGNT-06, D-37/D-38, plan 02-06 Task
 * 2) — every mount point (`SessionSurface.tsx`'s `feed` variant, the fleet's blocked queue) calls this with the SAME `agentRunId` and read the SAME query, so answering at either
 * place invalidates both instances within one pushed-delta cycle rather than leaving a stale
 * second copy (E3's `partial` consideration). `null`/`undefined` (no run yet, e.g. a Story
 * that has never had a run) disables the query entirely — never a call with an empty id.
 *
 * Invalidated on BOTH `subscribeBoardChanged` (D-04 — the answer round trip's own emit, and the
 * inbound rule-check-or-block path's emit) and `subscribeAgentEvent` (a fresh `permission_request`
 * event arrives on this channel too, per `sidecar.rs`'s reader loop) — never polled. Each mount
 * point registers its own pair of listeners (scoped to ITS OWN `agentRunId`), following this
 * file's existing per-hook subscription pattern rather than adding a third global listener.
 */
export function usePendingPermissionRequests(agentRunId: string | null | undefined) {
  const queryClient = useQueryClient();
  useBoardChangedInvalidation(
    { kind: "viewed" },
    agentRunId ? [pendingPermissionRequestsQueryKey(agentRunId)] : [],
  );

  useEffect(() => {
    if (!agentRunId) return undefined;
    const queryKey = pendingPermissionRequestsQueryKey(agentRunId);
    let unlistenAgent: (() => void) | undefined;
    let cancelled = false;

    subscribeAgentEvent(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlistenAgent = fn;
    });

    return () => {
      cancelled = true;
      unlistenAgent?.();
    };
  }, [agentRunId, queryClient]);

  return useQuery({
    queryKey: pendingPermissionRequestsQueryKey(agentRunId ?? "none"),
    queryFn: () => pendingPermissionRequests(agentRunId as string),
    enabled: Boolean(agentRunId),
  });
}

/** `useRecoverySummary`'s query key, keyed by `projectId` — D-46's board-visible "recovery
 * needed" signal (plan 03-11): the board row's Needs Decision pill and the project-rail's second
 * count badge read the SAME summary, so the two can never disagree at different moments. */
export function recoverySummaryQueryKey(projectId: string | undefined) {
  return ["recovery-summary", projectId] as const;
}

/**
 * Every Story id in `projectId` with an outstanding recovery item (a missing worktree, or an
 * unacknowledged abandoned run) plus the count (D-46, plan 03-11) — feeds `ProjectRail.tsx`'s
 * second count badge. Invalidated by
 * `subscribeBoardChanged` — every command that resolves a recovery item
 * (`worktree_recreate`/`worktree_forget_record`/`agent_run_acknowledge`) already emits
 * `board:changed`, so the pill clears through the same push-invalidate path the rest of the board
 * uses, with no second mechanism. `undefined` disables the query entirely (no project selected
 * yet).
 */
export function useRecoverySummary(projectId: string | undefined) {

  useBoardChangedInvalidation({ kind: "project", projectId }, projectId ? [recoverySummaryQueryKey(projectId)] : []);

  return useQuery({
    queryKey: recoverySummaryQueryKey(projectId),
    queryFn: () => boardRecoverySummary(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** `usePendingOrphans`'s query key — one fixed key, no project scoping, since the launch
 * classification (plan 03-06, PROC-05) runs once for the whole app, not per project. */
export function pendingOrphansQueryKey() {
  return ["pending-orphans"] as const;
}

/**
 * The launch-time live-orphan list (plan 03-06, PROC-05, D-46) — the recovery modal's own data
 * source. Deliberately `staleTime: Infinity` with NO `subscribeBoardChanged` invalidation: this
 * is a launch-time fact resolved once before the window ever painted, not a live query, and
 * re-fetching it on every board change would make the modal flicker as unrelated mutations land.
 * Plan 03-10's kill action invalidates this query key explicitly, after each kill.
 */
export function usePendingOrphans() {
  return useQuery({
    queryKey: pendingOrphansQueryKey(),
    queryFn: () => pendingOrphans(),
    staleTime: Infinity,
  });
}

/** `useSessionFeed`'s own page size (plan 02-07 Task 1/2, D-33) — matches
 * `commands/agent_run.rs`'s `LOG_WINDOW_DEFAULT_LIMIT`. */
const SESSION_FEED_PAGE_SIZE = 50;

/** `useSessionFeed`'s query key, keyed by `agentRunId` — exported so `SessionSurface.tsx` (and
 * any future caller) can invalidate/read the same cache entry without re-deriving the key shape. */
export function sessionFeedQueryKey(agentRunId: string) {
  return ["agent-run-log", agentRunId] as const;
}

/** `useInfiniteQuery`'s own page-identity value: `"tail"` for the initial (most-recent) page,
 * a numeric byte-line offset for every page paged in afterward via `fetchPreviousPage` (D-33's
 * "page backwards from the tail"). */
type SessionFeedPageParam = number | "tail";

/** Resolve ONE page of `useSessionFeed`'s window. `"tail"` is resolved in two calls when the log
 * is longer than one page: a first call learns the log's true `total` (every `read_window` call
 * reports it, regardless of the requested window), then a second call requests the actual last
 * page at `total - PAGE_SIZE`. A log no longer than one page needs only the first call — its own
 * `offset: 0` window already covers everything. */
async function fetchSessionFeedPage(
  agentRunId: string,
  pageParam: SessionFeedPageParam,
): Promise<LogWindowDto> {
  if (pageParam !== "tail") {
    return agentRunLogWindow(agentRunId, pageParam, SESSION_FEED_PAGE_SIZE);
  }
  const probe = await agentRunLogWindow(agentRunId, 0, SESSION_FEED_PAGE_SIZE);
  if (probe.total <= SESSION_FEED_PAGE_SIZE) return probe;
  const tailOffset = probe.total - SESSION_FEED_PAGE_SIZE;
  return agentRunLogWindow(agentRunId, tailOffset, SESSION_FEED_PAGE_SIZE);
}

/**
 * The live session surface's own feed read (D-32/D-33, plan 02-07 Task 2): a bounded window
 * page-in from the TAIL of the persisted log, paging OLDER pages backward via
 * `fetchPreviousPage()` as the user scrolls toward the top of what's loaded — never the whole
 * transcript at once (PROC-07). Because the initial page's own `pageParam` is the literal string
 * `"tail"` rather than a fixed numeric offset, a live `agent:event` invalidation naturally
 * re-resolves that page against the log's CURRENT total on every refetch — the tail page always
 * catches up to newly arrived events, while every older page already loaded keeps its own stable
 * numeric offset (appending to the end of a log never shifts an earlier line's offset).
 *
 * `data.pages` is chronological ascending (oldest loaded page first, tail page last) — the exact
 * order `fetchPreviousPage` prepending to `data.pages` naturally produces, so a caller can render
 * `pages.flatMap(p => p.entries)` directly without a second reverse/sort step.
 *
 * `initialOffset` (D-99, plan 06-08): `null`/`undefined` (every pre-existing caller) keeps this
 * hook's own "page in from the tail" behaviour byte-identical to before. A caller with a recorded
 * log offset to open at (`SessionSurface.tsx`'s `initialFeedOffset`, the triage surface's
 * turn-pointer jump) passes it here instead, and the FIRST page resolves at that numeric offset
 * rather than `"tail"` — the same `fetchSessionFeedPage` codepath every older page already uses,
 * never a second fetch shape.
 */
export function useSessionFeed(agentRunId: string, initialOffset?: number | null) {
  const queryClient = useQueryClient();
  const queryKey = sessionFeedQueryKey(agentRunId);

  // A live `agent:event` push invalidates the windowed read (D-32/D-04) — the stream itself is
  // never treated as the source of truth, only the persisted log read back through the command.
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
  }, [agentRunId, queryClient]);

  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchSessionFeedPage(agentRunId, pageParam as SessionFeedPageParam),
    initialPageParam: (initialOffset ?? "tail") as SessionFeedPageParam,
    // The feed never pages "forward" past the tail — new events arrive by the tail page itself
    // re-resolving on invalidation (see doc comment above), not by fetching a page after it.
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage) =>
      firstPage.offset > 0 ? Math.max(0, firstPage.offset - SESSION_FEED_PAGE_SIZE) : undefined,
  });
}
