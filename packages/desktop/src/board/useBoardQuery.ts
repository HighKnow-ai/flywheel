/**
 * TanStack Query hooks wrapping `adapters/tauri.ts`, invalidated by `subscribeBoardChanged` (D-04):
 * the renderer never trusts its own write as already resolved. The board surface's own window,
 * group and mutation hooks were deleted with the board UI (issue #38); what remains serves the
 * surfaces that survive it (project rail, fleet, session, item-detail sections).
 */
import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentRunLogWindow,
  agentRunsForTask,
  blockedSummary,
  boardChangeFlags,
  boardScopeFlags,
  boardForgeFlags,
  boardRecoverySummary,
  forgeRequestForTask,
  gitFacts,
  gitIdentifierResolve,
  invokeCommand,
  latestAgentRunIdForTask,
  pendingOrphans,
  pendingPermissionRequests,
  sessionSummariesForTask,
  subscribeAgentEvent,
  worktreeRemovalCheck,
  worktreeRemove,
  worktreeSummary,
  type LogWindowDto,
} from "../adapters/tauri";
import { useBoardChangedInvalidation } from "./useBoardChangedInvalidation";
import { useUiStore } from "../state/uiStore";

export interface Project {
  id: string;
  keyPrefix: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  status: string;
}

/** `"epic" | "task"` — the fixed three-level hierarchy's two workable-item kinds (BOARD-01). */
export type BoardItemKind = "epic" | "task";

/** One row of the `actors` table (DATA-03) — the roster `AssigneePicker.tsx` renders. */
export interface Actor {
  id: string;
  actorType: "human" | "agent" | "system";
  displayName: string;
}

/** One row of the project's full epic roster (BOARD-06, G-01-2) — `id`, `key` and `title` only,
 * the three fields the epic pill, the filter chips and the `ParentPicker` option lists consume.
 * Deliberately not a `BoardItem`: the roster carries no `status`/`rank`/`priority`, which only
 * make sense for the currently loaded page. */
export interface EpicSummary {
  id: string;
  key: string;
  title: string;
  /** The epic's own workflow status (08.1-14 finish review: the roster header's sub-label). Optional so
   * a caller built before the roster carried it still type-checks; absent means "not known", and the
   * header then prints no status rather than a guess. */
  status?: string;
  /** `null` is a fact (no branch has been cut yet, D-25); `undefined` is "not known". */
  integrationBranch?: string | null;
}

/** `epic_list_all`'s wire shape (D-16, D-87, plan 05-04): the roster page, up to the core's
 * `EPIC_ROSTER_CEILING`, plus `total` and `truncated` so a caller can tell "every epic" from "the
 * first EPIC_ROSTER_CEILING" and surface the difference rather than swallow it (closing
 * `01-SECURITY.md` AR-01-04 without reopening G-01-2 — a truncated roster must never silently
 * degrade back into rendering a raw internal id). */
export interface EpicRoster {
  epics: EpicSummary[];
  total: number;
  truncated: boolean;
}

/** Mirrors `domain::epic::EPIC_ROSTER_CEILING` (`packages/core/src/domain/epic.rs`) — five
 * hundred times `board_list`'s own `DEFAULT_LIMIT`, and NOT a page size the renderer ever
 * paginates against. Kept in sync by hand since the two crates share no generated types yet; a
 * mismatch here would only ever understate/overstate the notice's own wording, never affect what
 * the core actually returns. */
export const EPIC_ROSTER_CEILING = 5000;

/** The plain-text truncation notice (D-16) `useEpics`'s consumers render when the roster's
 * `truncated` flag is set — naming the ceiling and the project's true epic count, never silently
 * showing a partial roster as though it were complete. Returns `null` when nothing is truncated,
 * so a caller can render conditionally on the return value alone. */
export function epicRosterTruncationNotice(roster: Pick<EpicRoster, "truncated" | "total"> | undefined): string | null {
  if (!roster?.truncated) return null;
  return `Showing the first ${EPIC_ROSTER_CEILING} of ${roster.total} epics — narrow your view to see the rest.`;
}

const PROJECTS_QUERY_KEY = ["projects"] as const;

/** The epic roster's query key, the cache `useEpics` populates. */
export function epicsQueryKey(projectId: string | undefined) {
  return ["epics", projectId] as const;
}

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

/** Every actor (human, agent, system) — the `AssigneePicker`'s roster (BOARD-06). Actors are
 * seeded at migration time and rarely change, so this query has no need to poll. */
export function useActors() {
  return useQuery({
    queryKey: ["actors"],
    queryFn: () => invokeCommand<Actor[]>("actor_list"),
  });
}

/**
 * The project's full epic roster (BOARD-06, G-01-2) — explicitly not the currently-loaded board
 * window `useBoardQuery` returns. `BoardRow`'s epic pill, `FilterBar`'s chip list and both
 * `ParentPicker` option lists (plan 01-18) resolve every epic id against this, never against
 * `items`: an epic that sorts outside `board_list`'s `DEFAULT_LIMIT`/200-row page still has an
 * entry here, which is what closes the defect a windowed lookup could not.
 *
 * `enabled: Boolean(projectId)` mirrors `useBoardQuery`'s own gating — no project selected issues
 * no `epic_list_all` call.
 */
export function useEpics(projectId: string | undefined) {
  return useQuery({
    queryKey: epicsQueryKey(projectId),
    queryFn: () => invokeCommand<EpicRoster>("epic_list_all", { projectId }),
    enabled: Boolean(projectId),
  });
}

/**
 * Subscribes EXACTLY ONCE to the core's `board:changed` push channel and routes each event by its
 * `projectId` (D-04, FNC-07) — the UI must never treat its own mutation as already resolved:
 * creating a task refreshes the board because the core emitted `board:changed`, and creating,
 * renaming or deleting an epic — from anywhere: the quick-add, the command palette, a future agent
 * writer — refreshes the chip list, the epic pill and the picker options through this same push.
 *
 * Routing: an event for the viewed project invalidates that project's board and epic-roster keys
 * (plus the `["board", "dispatch"]` fan-out keys, which are keyed by epic, not by project); an event
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
    [["board", projectId], epicsQueryKey(projectId), ["board", "dispatch"]],
    { unroutableKeys: [["board"], ["epics"]] },
  );
}

/** `usePendingPermissionRequests`' query key, keyed by `agentRunId` — the one shared query BOTH
 * the permission-request card's mount points read (AGNT-06, D-37/D-38, plan 02-06 Task 2,
 * Discretion #6: "one query, one key, consumed by both mount points, so the two instances cannot
 * disagree"). Exported so a caller resolving its own `agentRunId` late (`ItemDetailPanel.tsx`) can
 * still land on the exact key the session feed's mount uses for the same run. */
export function pendingPermissionRequestsQueryKey(agentRunId: string) {
  return ["pending-permission-requests", agentRunId] as const;
}

/**
 * The permission-request card's one shared source of truth (AGNT-06, D-37/D-38, plan 02-06 Task
 * 2) — both mount points (`SessionSurface.tsx`'s `feed` variant, `ItemDetailPanel.tsx`'s `compact`
 * variant) call this with the SAME `agentRunId` and read the SAME query, so answering at either
 * place invalidates both instances within one pushed-delta cycle rather than leaving a stale
 * second copy (E3's `partial` consideration). `null`/`undefined` (no run yet, e.g. an epic/issue,
 * or a task that has never had a run) disables the query entirely — never a call with an empty id.
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

/** `useLatestAgentRunId`'s query key, keyed by `taskId`. */
function latestAgentRunIdQueryKey(taskId: string) {
  return ["latest-agent-run", taskId] as const;
}

/**
 * The most recent agent run id for `taskId` (AGNT-06, plan 02-06 Task 2) — `ItemDetailPanel.tsx`'s
 * own resolution of "this task's active run," so its compact permission-request card mount can
 * read the exact same `agentRunId`-keyed `usePendingPermissionRequests` query the session feed's
 * mount uses for the same run. `undefined` (an epic/issue, which has no worktree of its own to run
 * an agent in — D-37's Boundary note) disables the query entirely. Invalidated on
 * `subscribeBoardChanged` (Start Work's own `board:changed` emit, D-04) — never polled.
 */
export function useLatestAgentRunId(taskId: string | undefined) {
  const queryKey = taskId ? latestAgentRunIdQueryKey(taskId) : (["latest-agent-run", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [latestAgentRunIdQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => latestAgentRunIdForTask(taskId as string),
    enabled: Boolean(taskId),
  });
}

/** `useBlockedSummary`'s query key, keyed by `projectId` — D-37's board-visible blocked signal
 * (plan 02-06 Task 3): the board row indicator and the project-rail count read the SAME summary,
 * so the two can never disagree at different moments. */
export function blockedSummaryQueryKey(projectId: string | undefined) {
  return ["blocked-summary", projectId] as const;
}

/**
 * Every blocked task id in `projectId` plus the count (D-37, plan 02-06 Task 3) — feeds
 * `BoardRow.tsx`'s blocked pill and `ProjectRail.tsx`'s count badge. Invalidated by
 * `subscribeBoardChanged` — the same pushed delta that already drives the board (D-04); never
 * polled. `undefined` disables the query entirely (no project selected yet).
 */
export function useBlockedSummary(projectId: string | undefined) {

  useBoardChangedInvalidation({ kind: "project", projectId }, projectId ? [blockedSummaryQueryKey(projectId)] : []);

  return useQuery({
    queryKey: blockedSummaryQueryKey(projectId),
    queryFn: () => blockedSummary(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** `useRecoverySummary`'s query key, keyed by `projectId` — D-46's board-visible "recovery
 * needed" signal (plan 03-11): the board row's Needs Decision pill and the project-rail's second
 * count badge read the SAME summary, so the two can never disagree at different moments. */
export function recoverySummaryQueryKey(projectId: string | undefined) {
  return ["recovery-summary", projectId] as const;
}

/**
 * Every task id in `projectId` with an outstanding recovery item (a missing worktree, or an
 * unacknowledged abandoned run) plus the count (D-46, plan 03-11) — feeds `BoardRow.tsx`'s Needs
 * Decision pill and `ProjectRail.tsx`'s second count badge. Invalidated by
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

/** `useAgentRuns`' query key, keyed by `taskId` (plan 02-07 Task 1, 02-UI-SPEC.md "Runs
 * section"). */
function agentRunsQueryKey(taskId: string) {
  return ["agent-runs", taskId] as const;
}

/**
 * A task's agent runs, newest first (02-UI-SPEC.md "Runs section") — the item detail panel's
 * future Runs-section data source (this plan builds the read path; a later plan renders it).
 * Invalidated on `subscribeBoardChanged` (Start Work's own emit, D-04) — never polled.
 * `undefined` disables the query entirely.
 *
 * No second query for the abandoned-run acknowledgment (plan 03-10, D-49): `agent_run_acknowledge`
 * emits `board:changed` exactly like every other state-changing command in this file, so this
 * SAME invalidation is what makes the Acknowledge button disappear once the row re-reads a
 * non-null `acknowledgedAt`.
 */
export function useAgentRuns(taskId: string | undefined) {
  const queryKey = taskId ? agentRunsQueryKey(taskId) : (["agent-runs", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [agentRunsQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => agentRunsForTask(taskId as string),
    enabled: Boolean(taskId),
  });
}

/** `useTaskSessionSummaries`' query key, keyed by `taskId` (plan 04-09 Task 3). */
function taskSessionSummariesQueryKey(taskId: string) {
  return ["task-session-summaries", taskId] as const;
}

/**
 * Every session summary recorded for `taskId` (plan 04-09 Task 3) — the item detail panel's Runs
 * section mounts each summary under the run row that produced it. Invalidated on
 * `subscribeBoardChanged` — `handle_inbound_summary_reported` (Rust) emits `{ entity: "task", id
 * }` alongside its `{ entity: "agent_run", id }` emit specifically so this query refetches
 * whenever a new summary lands, mirroring `useAgentRuns`' own invalidation shape.
 * `undefined` disables the query entirely.
 */
export function useTaskSessionSummaries(taskId: string | undefined) {
  const queryKey = taskId
    ? taskSessionSummariesQueryKey(taskId)
    : (["task-session-summaries", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [taskSessionSummariesQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => sessionSummariesForTask(taskId as string),
    enabled: Boolean(taskId),
  });
}

/** `useWorktreeSummary`'s query key, keyed by `taskId` (plan 02-07 Task 1, 02-UI-SPEC.md
 * "Worktree summary"). */
function worktreeSummaryQueryKey(taskId: string) {
  return ["worktree-summary", taskId] as const;
}

/**
 * A task's worktree summary line (02-UI-SPEC.md "Worktree summary") — the item detail panel's
 * future worktree-summary data source (this plan builds the read path; a later plan renders it).
 * `null` for a task with no worktree yet. Invalidated on `subscribeBoardChanged` — never polled.
 * `undefined` disables the query entirely.
 *
 * The missing-worktree decision banner (plan 03-09, D-45) resolves through this SAME
 * invalidation, not a second mechanism: `worktree_recreate`/`worktree_forget_record` both emit
 * `board:changed` on success, so once either resolves this query re-reads and the row's `status`
 * flips away from `"missing"` — the banner disappears because the data changed, never because of
 * a local optimistic flag.
 */
export function useWorktreeSummary(taskId: string | undefined) {
  const queryKey = taskId ? worktreeSummaryQueryKey(taskId) : (["worktree-summary", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [worktreeSummaryQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => worktreeSummary(taskId as string),
    enabled: Boolean(taskId),
  });
}

/** `useGitFacts`' query key, keyed by `taskId` (Phase 7 plan 07-01, LINK-02/LINK-09). */
export function gitFactsQueryKey(taskId: string) {
  return ["git-facts", taskId] as const;
}

/**
 * A task's full git truth (LINK-02, LINK-09) — exact structural sibling of [`useWorktreeSummary`]:
 * its own query key, a single `subscribeBoardChanged` effect that invalidates it, and `enabled:
 * Boolean(taskId)`. `null` for a task with no worktree yet. Invalidated on `subscribeBoardChanged`
 * — the scheduler's `board:changed` emit (D-113) is this query's only refresh path; there is no
 * polling interval and no second push channel here.
 */
export function useGitFacts(taskId: string | undefined) {
  const queryKey = taskId ? gitFactsQueryKey(taskId) : (["git-facts", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [gitFactsQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => gitFacts(taskId as string),
    enabled: Boolean(taskId),
  });
}

/** `useForgeRequest`'s query key, keyed by `taskId` (Phase 7 plan 07-08, LINK-05/LINK-06). */
export function forgeRequestQueryKey(taskId: string) {
  return ["forge-request", taskId] as const;
}

/**
 * `taskId`'s live forge request (Phase 7 plan 07-08, D-75's "derive at read time, never cache a
 * verdict" discipline) — structural sibling of [`useGitFacts`]/[`useWorktreeSummary`]: its own
 * query key, a single `subscribeBoardChanged` effect that invalidates it, `enabled:
 * Boolean(taskId)`. Unlike those two, this also carries `staleTime: 0` — the scheduler's own
 * forge-poll tick (plan 07-07) already pushes `board:changed` on a transition, but the panel's own
 * read must never answer from a cache that could disagree with the forge the instant it is open,
 * so a value here is never served stale even between two pushes.
 */
export function useForgeRequest(taskId: string | undefined) {
  const queryKey = taskId ? forgeRequestQueryKey(taskId) : (["forge-request", "none"] as const);

  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [forgeRequestQueryKey(taskId)] : []);

  return useQuery({
    queryKey,
    queryFn: () => forgeRequestForTask(taskId as string),
    enabled: Boolean(taskId),
    staleTime: 0,
  });
}

/** `useForgeFlags`'s query key, keyed by `projectId` (Phase 7 plan 07-08, D-124/D-123) — exact
 * structural sibling of [`blockedSummaryQueryKey`]/[`recoverySummaryQueryKey`]. */
export function forgeFlagsQueryKey(projectId: string | undefined) {
  return ["forge-flags", projectId] as const;
}

/**
 * Every distinct task in `projectId` carrying an outstanding forge flag (D-124's board-row
 * CI-failure pill, D-123's unmet-criteria rollup) — feeds `BoardRow.tsx`'s CI-failure pill. Exact
 * structural sibling of [`useBlockedSummary`]/[`useRecoverySummary`]: project-scoped, invalidated
 * on `subscribeBoardChanged` (the forge-poll tick's own emit, plan 07-07), never polled —
 * `useBoardQuery.ts` carries no `refetchInterval` anywhere. `undefined` disables the query
 * entirely (no project selected yet).
 */
export function useForgeFlags(projectId: string | undefined) {
  useBoardChangedInvalidation(
    { kind: "project", projectId },
    projectId ? [forgeFlagsQueryKey(projectId)] : [],
  );

  return useQuery({
    queryKey: forgeFlagsQueryKey(projectId),
    queryFn: () => boardForgeFlags(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** `useChangeFlags`'s query key, keyed by `projectId` (Phase 8.1 plan 01, D-16). */
export function changeFlagsQueryKey(projectId: string | undefined) {
  return ["change-flags", projectId] as const;
}

/** How long a burst of `board:changed` events is allowed to collapse into one sweep. */
const CHANGE_FLAGS_REFRESH_WINDOW_MS = 1000;

/**
 * Every active worktree's change state (commits ahead, dirty) for the WHOLE board in one query
 * (D-15/D-16) — feeds the `BoardRow` change annotation. Structural sibling of [`useForgeFlags`]:
 * project-scoped and refreshed from `subscribeBoardChanged`, never polled. Unlike that hook, each
 * refresh spawns git, and `board:changed` fires on every board mutation and every scheduler digest
 * change — so the invalidation is coalesced into one per window (`invalidateQueries` refetches an
 * active query whatever its `staleTime`, so `staleTime` alone would not bound the sweep rate).
 * `undefined` disables the query (no project selected yet).
 */
export function useChangeFlags(projectId: string | undefined) {
  useBoardChangedInvalidation(
    { kind: "project", projectId },
    projectId ? [changeFlagsQueryKey(projectId)] : [],
    { debounceMs: CHANGE_FLAGS_REFRESH_WINDOW_MS },
  );

  return useQuery({
    queryKey: changeFlagsQueryKey(projectId),
    queryFn: () => boardChangeFlags(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 5000,
  });
}

/** `useScopeFlags`'s query key, keyed by `projectId` (Phase 9 plan 06, D-153). */
export function scopeFlagsQueryKey(projectId: string | undefined) {
  return ["scope-flags", projectId] as const;
}

/**
 * Every task in `projectId` with at least one scope refusal, with its count (D-153) — feeds the
 * `BoardRow` badge. Structural sibling of [`useForgeFlags`]: ONE project-wide read for the board,
 * invalidated on `subscribeBoardChanged` (a refusal emits one), never polled. The read is one
 * grouped, indexed aggregate that spawns nothing, so unlike [`useChangeFlags`] it needs no
 * coalescing window. A task with no refusal is absent from the data. `undefined` disables it.
 */
export function useScopeFlags(projectId: string | undefined) {

  useBoardChangedInvalidation({ kind: "project", projectId }, projectId ? [scopeFlagsQueryKey(projectId)] : []);

  return useQuery({
    queryKey: scopeFlagsQueryKey(projectId),
    queryFn: () => boardScopeFlags(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** A cheap client-side pre-check mirroring `flywheel_core::git_identity::classify`'s two accepted
 * shapes (D-127/D-128, Phase 7 plan 07-05) — never the source of truth for validation (the core's
 * own `classify` is, called again server-side before any git invocation, T-07-05-01). This exists
 * only to avoid spending an IPC call on every keystroke of an ordinary text search (T-07-05-05). */
function looksLikeGitIdentifier(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("flywheel/")) return true;
  return trimmed.length >= 7 && trimmed.length <= 64 && /^[0-9a-fA-F]+$/.test(trimmed);
}

/** `useGitIdentifier`'s query key, keyed by the trimmed input (D-127/D-128, Phase 7 plan 07-05). */
export function gitIdentifierQueryKey(raw: string) {
  return ["git-identifier", raw] as const;
}

/**
 * Resolve a pasted commit hash or `flywheel/` branch name to its board item (D-127/D-128,
 * LINK-04) — a one-shot read-time question, never a live view: `enabled` only when the trimmed
 * input could plausibly classify, so ordinary text search in the command palette spends no IPC
 * call per keystroke, and `staleTime: 0` so a resolution can never be served from a cache that
 * could disagree with git (D-128). Subscribes to nothing — `subscribeBoardChanged` would only
 * ever refresh a question the user has already stopped asking.
 */
export function useGitIdentifier(raw: string) {
  const trimmed = raw.trim();
  return useQuery({
    queryKey: gitIdentifierQueryKey(trimmed),
    queryFn: () => gitIdentifierResolve(trimmed),
    enabled: looksLikeGitIdentifier(raw),
    staleTime: 0,
  });
}

/** `useWorktreeRemovalCheck`'s query key, keyed by `taskId` (WORK-03, plan 03-01 Task 1). */
function worktreeRemovalCheckQueryKey(taskId: string) {
  return ["worktree-removal-check", taskId] as const;
}

/**
 * A fresh, never-cached `git status --porcelain` read for the worktree-removal dialog (WORK-03,
 * D-41/D-42, plan 03-01 Task 1). `enabled` defaults `false` and the query carries `staleTime: 0`/
 * `gcTime: 0` so the read is taken fresh every time the dialog opens and is never served from a
 * stale cache entry — the UI-SPEC's own "never cached" rule for this surface.
 */
export function useWorktreeRemovalCheck(taskId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: taskId ? worktreeRemovalCheckQueryKey(taskId) : (["worktree-removal-check", "none"] as const),
    queryFn: () => worktreeRemovalCheck(taskId as string),
    enabled: Boolean(taskId) && enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Remove a task's worktree (WORK-03, D-41/D-42/D-43, plan 03-01 Task 1). The core also emits
 * `board:changed` (D-04) after a successful removal — `subscribeBoardChanged` is the source of
 * truth for every surface's freshness; this mutation's own invalidation is a courtesy immediate
 * refetch for the tab that made the call.
 */
export function useRemoveWorktree(taskId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => worktreeRemove(taskId as string),
    onSuccess: () => {
      if (taskId) {
        queryClient.invalidateQueries({ queryKey: worktreeSummaryQueryKey(taskId) });
      }
    },
  });
}

/**
 * Resolves `taskId`'s most recent agent run and opens it in the live session surface (D-31, plan
 * 02-08 Task 3) — the ONE entry point `board/BoardView.tsx`'s board-list `l` key
 * (`open-live-session`, `state/keyboard.ts`) and `board/CommandPalette.tsx`'s matching palette
 * command both call, so "which run is active" is computed once, not twice per 02-08-PLAN.md's own
 * action text. A task with no runs yet resolves to `null` and is a no-op — no route change, no
 * error, matching this codebase's own precedent for every other inapplicable-row action (e.g.
 * `open-epic-picker` on an epic row).
 */
export async function openLiveSessionForTask(taskId: string): Promise<void> {
  const agentRunId = await latestAgentRunIdForTask(taskId);
  if (agentRunId) useUiStore.getState().setActiveAgentRunId(agentRunId, taskId);
}
