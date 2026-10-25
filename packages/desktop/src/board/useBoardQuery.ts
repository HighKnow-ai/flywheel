/**
 * TanStack Query hooks wrapping `adapters/tauri.ts`, invalidated by `subscribeBoardChanged` (D-04):
 * the renderer never trusts its own write as already resolved. The board surface's own window,
 * group and mutation hooks were deleted with the board UI (issue #38); what remains serves the
 * surfaces that survive it (project rail, fleet, session, recovery).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  sessionLogWindow,
  boardRecoverySummary,
  invokeCommand,
  pendingOrphans,
  pendingPermissionRequests,
  type LogWindowDto,
} from "../adapters/tauri";
import { useAgentEventInvalidation, useBoardChangedInvalidation } from "./useBoardChangedInvalidation";
import {
  fetchFirstLogPage,
  nextLogPage,
  previousLogPage,
  useFollowLogTail,
  type LogPageParam,
} from "../session/logPaging";

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
 * Coalesced (issue #195): the events of one `COALESCE_MS` window invalidate each key once, sized on the
 * measured event rate (`useBoardChangedInvalidation.ts`).
 */
export function useBoardChangedSubscription(projectId?: string) {
  useBoardChangedInvalidation(
    { kind: "project", projectId },
    [
      ["board", projectId],
      ["epics", projectId],
    ],
    { unroutableKeys: [["board"], ["epics"]] },
  );
}

/** `usePendingPermissionRequests`' query key, keyed by `sessionId` — the one shared query BOTH
 * the permission-request card's mount points read (AGNT-06, D-37/D-38, plan 02-06 Task 2,
 * Discretion #6: "one query, one key, consumed by both mount points, so the two instances cannot
 * disagree"). Exported so the fleet's blocked queue lands on the exact key the session feed's
 * mount uses for the same run. */
export function pendingPermissionRequestsQueryKey(sessionId: string) {
  return ["pending-permission-requests", sessionId] as const;
}

/**
 * The permission-request card's one shared source of truth (AGNT-06, D-37/D-38, plan 02-06 Task
 * 2) — every mount point (`SessionSurface.tsx`'s `feed` variant, the fleet's blocked queue) calls this with the SAME `sessionId` and read the SAME query, so answering at either
 * place invalidates both instances within one pushed-delta cycle rather than leaving a stale
 * second copy (E3's `partial` consideration). `null`/`undefined` (no run yet, e.g. a Story
 * that has never had a run) disables the query entirely — never a call with an empty id.
 *
 * Invalidated on BOTH `subscribeBoardChanged` (D-04 — the answer round trip's own emit, and the
 * inbound rule-check-or-block path's emit) and `subscribeAgentEvent` (a fresh `permission_request`
 * event arrives on this channel too, per `sidecar.rs`'s reader loop) — never polled. Each mount
 * point registers its own pair of listeners (scoped to ITS OWN `sessionId`), following this
 * file's existing per-hook subscription pattern rather than adding a third global listener.
 */
export function usePendingPermissionRequests(sessionId: string | null | undefined) {
  const keys = sessionId ? [pendingPermissionRequestsQueryKey(sessionId)] : [];
  useBoardChangedInvalidation({ kind: "viewed" }, keys);
  // Only this session's own agent events, coalesced (issue #195).
  useAgentEventInvalidation(sessionId, keys);

  return useQuery({
    queryKey: pendingPermissionRequestsQueryKey(sessionId ?? "none"),
    queryFn: () => pendingPermissionRequests(sessionId as string),
    enabled: Boolean(sessionId),
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
 * (`worktree_recreate`/`worktree_forget_record`/`session_acknowledge`) already emits
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

/** `useSessionFeed`'s query key, keyed by `sessionId` — exported so `SessionSurface.tsx` (and
 * any future caller) can invalidate/read the same cache entry without re-deriving the key shape. */
export function sessionFeedQueryKey(sessionId: string) {
  return ["agent-run-log", sessionId] as const;
}

/**
 * The live session surface's own feed read (D-32/D-33, plan 02-07 Task 2): a bounded window
 * page-in from the TAIL of the persisted log, paging OLDER pages backward via
 * `fetchPreviousPage()` as the user scrolls toward the top of what's loaded — never the whole
 * transcript at once (PROC-07). The initial page's own `pageParam` is the literal string `"tail"`,
 * resolved against the log's length on the first read; a live `agent:event` refetch then re-reads the
 * window it resolved to (`fetchFirstLogPage`, issue #195) rather than sliding it forward, and the lines
 * after it arrive through the windows that follow. Every later page is an explicit `{ offset, limit }`
 * window that ends where the next begins, and a refetch re-reads them in order and follows the log to
 * its end (`session/logPaging.ts`, issue #190).
 *
 * `data.pages` is chronological ascending (oldest loaded page first, tail page last) — the exact
 * order `fetchPreviousPage` prepending to `data.pages` naturally produces, so a caller can render
 * `pages.flatMap(p => p.entries)` directly without a second reverse/sort step.
 *
 * `initialOffset` (D-99, plan 06-08): `null`/`undefined` (every pre-existing caller) keeps this
 * hook's own "page in from the tail" behaviour byte-identical to before. A caller with a recorded
 * log offset to open at (`SessionSurface.tsx`'s `initialFeedOffset`, the triage surface's
 * turn-pointer jump) passes it here instead, and the FIRST page resolves at that numeric offset
 * rather than `"tail"` — the same `fetchLogPage` codepath every older page already uses,
 * never a second fetch shape.
 */
export function useSessionFeed(sessionId: string, initialOffset?: number | null) {
  const queryClient = useQueryClient();
  const queryKey = sessionFeedQueryKey(sessionId);

  // A live `agent:event` push of THIS session invalidates the windowed read (D-32/D-04), coalesced
  // (issue #195) — the stream itself is never treated as the source of truth, only the persisted log
  // read back through the command.
  useAgentEventInvalidation(sessionId, [queryKey]);

  const query = useInfiniteQuery({
    queryKey,
    // A loaded tail is re-read where it is, so the window never slides under the reader (issue #195).
    queryFn: ({ pageParam }) =>
      fetchFirstLogPage(
        (offset, limit) => sessionLogWindow(sessionId, offset, limit),
        pageParam as LogPageParam | number,
        queryClient.getQueryData<InfiniteData<LogWindowDto>>(queryKey)?.pages[0],
      ),
    initialPageParam: (initialOffset ?? "tail") as LogPageParam | number,
    // Issue #190: windows tile (`session/logPaging.ts`). A refetch re-reads the first loaded window and
    // the ones after it through `nextLogPage`, so paging back never loses the tail.
    getNextPageParam: (lastPage) => nextLogPage(lastPage, lastPage.entries.length),
    getPreviousPageParam: (firstPage) => previousLogPage(firstPage),
  });
  useFollowLogTail(query, initialOffset == null);
  return query;
}
