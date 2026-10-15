/**
 * TanStack Query hooks wrapping `adapters/tauri.ts` — every read and mutation the board surface
 * needs routes through `invokeCommand`, and the board query is invalidated by
 * `subscribeBoardChanged` (D-04): the renderer never trusts its own write as already resolved.
 */
import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  agentRunLogWindow,
  agentRunsForTask,
  authoringRunForEpic,
  blockedSummary,
  boardChangeFlags,
  boardScopeFlags,
  boardEpicProgress,
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
  startAuthoringRun,
  subscribeAgentEvent,
  worktreeRemovalCheck,
  worktreeRemove,
  worktreeSummary,
  type EpicProgressDto,
  type LogWindowDto,
} from "../adapters/tauri";
import { useBoardChangedInvalidation } from "./useBoardChangedInvalidation";
import { EMPTY_FILTER_DRAFT, useUiStore, type BoardFilterDraft } from "../state/uiStore";

export interface Project {
  id: string;
  keyPrefix: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  status: string;
}

/** `"epic" | "task"` — the fixed three-level hierarchy's two workable-item kinds (BOARD-01).
 * Issues are the third level and never appear in `BoardItem`; see `IssueItem` below. */
export type BoardItemKind = "epic" | "task";

export interface BoardItem {
  id: string;
  /** Optional for backward compatibility with callers built before the hierarchy widened past
   * tasks (plan 01-03) — absent means "task" (the only kind that existed then). */
  kind?: BoardItemKind;
  key: string;
  title: string;
  status: string;
  rank: string;
  priority: number;
  epicId: string | null;
  /** Nullable FK to `actors.id` (BOARD-06) — `undefined`/`null` renders as "Unassigned". */
  assigneeId?: string | null;
  /** How many of this item's acceptance criteria are checked, out of its total (BOARD-02, D-08).
   * Optional for the same backward-compatibility reason `kind` is: callers built before this
   * plan land supply neither field. `BoardRow.tsx` defaults both to 0 when absent, rendering
   * `0/0` — never a blank. */
  criteriaChecked?: number;
  criteriaTotal?: number;
}

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

/** One row of the workflow-less issues lane (D-07) — issues carry no `status` field. */
export interface IssueItem {
  id: string;
  key: string;
  title: string;
  kind: string;
  epicId: string | null;
  taskId: string | null;
}

export interface BandCounts {
  backlog: number;
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
}

export interface BoardWindow {
  items: BoardItem[];
  issues: IssueItem[];
  counts: BandCounts;
}

const PROJECTS_QUERY_KEY = ["projects"] as const;

function boardQueryKey(projectId: string | undefined) {
  return ["board", projectId] as const;
}

/** Mirrors the private `boardQueryKey` above but exported — `FilterBar.tsx` needs it too
 * (plan 01-18) to invalidate/read the same roster cache `useEpics` populates. */
export function epicsQueryKey(projectId: string | undefined) {
  return ["epics", projectId] as const;
}

/** 150ms keystroke-to-query debounce (01-UI-SPEC.md "Performance Contract", 01-RESEARCH.md Flag
 * 6): the debounce belongs at the query boundary, not the virtualization layer, which must
 * always render whatever window it currently has instantly. */
export const SEARCH_DEBOUNCE_MS = 150;

/** Delays reflecting `value` by `delayMs` — the mechanism behind `SEARCH_DEBOUNCE_MS` below.
 * Exported so `FilterBar.tsx`'s own tests (and any future field needing the same debounce
 * discipline) can reuse it rather than re-deriving a second debounce implementation. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** The wire shape `board_list`/`board_search` accept (mirrors
 * `commands::board::BoardFilterInput` on the Rust side). `undefined` fields — never present at
 * all, not `null` and not an empty array — are what "this dimension is unfiltered" means to the
 * core; `toFilterInput` is the only place that omission decision gets made. */
export interface BoardFilterInput {
  statuses?: string[];
  epicIds?: (string | null)[];
  assigneeIds?: (string | null)[];
  priorities?: number[];
  /** Present (`true`) only while the has-worktree chip is on; ABSENT when off, never `false`. */
  hasWorktree?: true;
}

/** Translate a `BoardFilterDraft` (uiStore's "empty array means unfiltered" convention) into the
 * command payload's "field absent means unfiltered" convention. Returns `undefined` when no
 * dimension is active at all, so a fully-cleared filter sends no `filter` argument rather than an
 * object of empty arrays — the exact shape `board_list`'s own `filter: Option<BoardFilterInput>`
 * treats as "the unfiltered board." */
export function toFilterInput(filter: BoardFilterDraft): BoardFilterInput | undefined {
  const input: BoardFilterInput = {};
  let active = false;
  if (filter.statuses.length > 0) {
    input.statuses = filter.statuses;
    active = true;
  }
  if (filter.epicIds.length > 0) {
    input.epicIds = filter.epicIds;
    active = true;
  }
  if (filter.assigneeIds.length > 0) {
    input.assigneeIds = filter.assigneeIds;
    active = true;
  }
  if (filter.priorities.length > 0) {
    input.priorities = filter.priorities;
    active = true;
  }
  if (filter.hasWorktree) {
    input.hasWorktree = true;
    active = true;
  }
  return active ? input : undefined;
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

/**
 * The bounded board window for one project (D-03 — the core returns a page, never the whole
 * board), optionally narrowed by `filter`/`searchTerm` (BOARD-06, plan 01-08). `searchTerm` is
 * debounced here, at the query boundary — every other layer (the virtualization layer, the
 * search field itself) always renders/reflects the immediate value instantly.
 *
 * Renders whichever core command actually applies: an empty/whitespace-only search term calls
 * `board_list` (the plain, possibly-filtered window); a real term calls `board_search`. There is
 * exactly one place that decision is made — never a client-side re-filter of a `board_list`
 * result, which would be the second implementation D-03 forbids.
 *
 * `placeholderData: keepPreviousData` is what keeps the previously-rendered window on screen
 * during a refetch (01-UI-SPEC.md "State Inventory": "the currently-visible window never
 * re-skeletons on a refetch, only on true zero-to-first-paint") — callers distinguish the two
 * with `isFetching` (a refetch in flight) vs. `data === undefined` (nothing to show yet).
 */
export function useBoardQuery(
  projectId: string | undefined,
  filter: BoardFilterDraft = EMPTY_FILTER_DRAFT,
  searchTerm = "",
) {
  const debouncedTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);
  const trimmedTerm = debouncedTerm.trim();
  const filterInput = toFilterInput(filter);

  return useQuery({
    queryKey: [...boardQueryKey(projectId), filterInput ?? null, trimmedTerm],
    queryFn: () =>
      trimmedTerm.length > 0
        ? invokeCommand<BoardWindow>("board_search", {
            projectId,
            term: trimmedTerm,
            filter: filterInput,
          })
        : invokeCommand<BoardWindow>("board_list", { projectId, filter: filterInput }),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  });
}

/**
 * Create a task at the current position (D-09 quick-add), optionally under an epic. `task_create`
 * has accepted `epic_id: Option<String>` since plan 01-04 — this hook silently dropping it was
 * the first of G-01-EPIC-ASSIGN's three causes: a task created under a selected epic (plan
 * 01-15's nested quick-add) would still land parentless because nothing ever sent the id.
 */
export function useCreateTask(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; epicId?: string | null }) =>
      invokeCommand<BoardItem>("task_create", {
        projectId,
        title: input.title,
        epicId: input.epicId,
      }),
    onSuccess: () => {
      // The core also emits `board:changed` (D-04) — this is a courtesy immediate refetch for
      // the tab that made the mutation; `useBoardChangedSubscription` is the source of truth for
      // every OTHER surface's freshness, and stays authoritative even if this call were removed.
      queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) });
    },
  });
}

/** Create an epic at the top level (⌘⇧N / palette "Create Epic"). */
export function useCreateEpic(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => invokeCommand<BoardItem>("epic_create", { projectId, title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/**
 * Create an issue (proposals/notes — no status, D-07), optionally filed under an epic or a task.
 * `issue_create` has accepted `epic_id`/`task_id: Option<String>` since plan 01-04 — this hook
 * silently dropping both was the second half of G-01-EPIC-ASSIGN's first cause (the live database
 * held an issue with both columns NULL because nothing ever sent them): `CommandPalette.tsx`'s
 * "Create Issue" command now supplies whichever one the current selection implies.
 */
export function useCreateIssue(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; kind: string; epicId?: string | null; taskId?: string | null }) =>
      invokeCommand<IssueItem>("issue_create", {
        projectId,
        title: input.title,
        kind: input.kind,
        epicId: input.epicId,
        taskId: input.taskId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
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
 * Move a task or an epic up/down by one position within its priority band (`⌘↑`/`⌘↓`, D-11,
 * BOARD-05). Dispatches on `kind` to the matching entity-scoped command.
 */
export function useReorderItem(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string; direction: "up" | "down" }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_reorder" : "task_reorder", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        direction: input.direction,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/** Set a task's or an epic's priority (`p` then `0`-`4`, D-11). */
export function useSetPriority(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string; priority: number }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_set_priority" : "task_set_priority", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        priority: input.priority,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/** Set a task's or an epic's assignee (`a`, BOARD-06). `assigneeId: null` clears it
 * ("Unassigned"). */
export function useSetAssignee(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string; assigneeId: string | null }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_set_assignee" : "task_set_assignee", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        assigneeId: input.assigneeId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/**
 * Reparent a task under an epic, or orphan it with `epicId: null` (`m`, `ParentPicker`,
 * G-01-EPIC-ASSIGN). Unlike `useSetPriority`/`useSetAssignee`,
 * there is no epic-kind branch here — this action exists only for tasks, because the hierarchy is
 * fixed at three levels and an epic has no epic parent of its own.
 */
export function useSetTaskEpic(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; epicId: string | null }) =>
      invokeCommand<void>("task_set_epic", { taskId: input.taskId, epicId: input.epicId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/**
 * Reparent an issue under an epic, under a task, or detach it (`ParentPicker`,
 * G-01-EPIC-ASSIGN, plan 01-15 — the issue half of the hierarchy `useSetTaskEpic` above closed
 * for tasks). Invokes plan 01-12's `issue_set_parent` command with the exact camelCase
 * `issueId`/`parentKind`/`parentId` arguments it expects; `parentKind: null, parentId: null`
 * detaches the issue entirely. An issue holds exactly one parent at a time — the renderer sends
 * one `parentKind`/`parentId` pair, matching `IssueParent`'s single-variant write on the server.
 */
export function useSetIssueParent(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { issueId: string; parentKind: "epic" | "task" | null; parentId: string | null }) =>
      invokeCommand<void>("issue_set_parent", {
        issueId: input.issueId,
        parentKind: input.parentKind,
        parentId: input.parentId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/** Patch a task's or an epic's title/description from the item detail panel. */
export function useUpdateItem(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: BoardItemKind;
      id: string;
      title?: string;
      description?: string;
    }) =>
      invokeCommand<BoardItem>(input.kind === "epic" ? "epic_update" : "task_update", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        title: input.title,
        description: input.description,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}

/** Delete a task or an epic (⌘⌫, destructive confirmation owned by the caller). */
export function useDeleteItem(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_delete" : "task_delete", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
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
    [boardQueryKey(projectId), epicsQueryKey(projectId), ["board", "dispatch"]],
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

/** `useEpicProgress`'s query key, keyed by `projectId` (Phase 8.1 plan 05, D-05/D-06). */
export function epicProgressQueryKey(projectId: string | undefined) {
  return ["epic-progress", projectId] as const;
}

/**
 * Every epic's roll-up for the WHOLE board in one query (D-05/D-06): task counts by status, agents
 * running/blocked and criteria position, read from one grouped aggregate over all of the project's
 * tasks — not from the loaded board window, which is a 200-row page. Structural sibling of
 * [`useForgeFlags`]: project-scoped, invalidated on `subscribeBoardChanged`, never polled. One
 * query for the board and never one per epic (D-16's rule). `undefined` disables the query.
 */
export function useEpicProgress(projectId: string | undefined, enabled = true) {

  useBoardChangedInvalidation({ kind: "project", projectId }, projectId && enabled ? [epicProgressQueryKey(projectId)] : []);

  return useQuery({
    queryKey: epicProgressQueryKey(projectId),
    queryFn: () => boardEpicProgress(projectId as string),
    enabled: Boolean(projectId) && enabled,
  });
}

/** Which group a scoped fetch is for: one epic (or the no-epic bucket) or one status band. */
export type GroupScope = { kind: "epic"; epicId: string | null } | { kind: "status"; status: string };

/** Mirrors `commands/board.rs`'s `MAX_LIMIT` — the most rows one `board_list` call will return.
 * The core clamps to this itself (T-01-24, T-08.1-13); it is repeated here only so the hook can
 * tell the caller when a group is bigger than one call can hold, rather than look complete. */
const GROUP_FETCH_MAX_ROWS = 500;

export interface GroupItems {
  /** Exactly what the core returned for the scope — no client-side narrowing (D-03). */
  items: BoardItem[];
  /** The explicit row limit the fetch passed. */
  limit: number;
  /** The group's expected row count, as passed in (from the aggregate or the counts field). */
  total: number;
  /** True when the group is bigger than one call can return, i.e. `items` is a strict prefix. */
  truncated: boolean;
}

/** An epic's task total for its header — straight from the aggregate, never from rows loaded. */
export function epicHeaderTotal(
  progress: EpicProgressDto[] | undefined,
  epicId: string | null,
): number | undefined {
  return progress?.find((p) => p.epicId === epicId)?.total;
}

/** A status band's header total — straight from the list command's own `counts` field. */
export function bandHeaderTotal(counts: BandCounts | undefined, status: string): number | undefined {
  if (!counts) return undefined;
  const key = ({ in_progress: "inProgress", in_review: "inReview" } as const)[
    status as "in_progress" | "in_review"
  ] ?? (status as keyof BandCounts);
  return counts[key];
}

/** The board's own active filter and search term — folded into every scoped group fetch so a
 * group shows exactly what the unscoped board would show for it (D-03: the core does the
 * filtering, there is no second implementation here). */
export interface GroupBase {
  filter?: BoardFilterInput;
  term?: string;
}

/**
 * The filter one group's fetch sends: the board's active filter with the group's own dimension
 * pinned to the group. `null` when the active filter already excludes the group (e.g. an epic
 * outside the epic chips) — the group is then empty by definition and costs no fetch.
 */
export function scopedFilter(base: BoardFilterInput | undefined, scope: GroupScope): BoardFilterInput | null {
  if (scope.kind === "status") {
    if (base?.statuses && !base.statuses.includes(scope.status)) return null;
    return { ...base, statuses: [scope.status] };
  }
  if (base?.epicIds && !base.epicIds.includes(scope.epicId)) return null;
  return { ...base, epicIds: [scope.epicId] };
}

/**
 * One group's scoped fetch, as query options so [`useGroupItems`] (one group) and
 * [`useGroupItemsMany`] (every group of the active lens) share a single definition. Reuses the
 * EXISTING `board_list` (or `board_search` while a search term is active) through its existing
 * `epicIds`/`statuses` filter dimensions — no list-by-epic command and no client-side narrowing.
 * What it fixes is the row limit: an unscoped read lands on the core's default of 200, so a group
 * bigger than that was silently cut short (RESEARCH Correction 3). The limit here is sized from
 * the group's own `total` and clamped to what the core will return.
 */
function groupItemsQueryOptions(
  projectId: string | undefined,
  scope: GroupScope,
  total: number | undefined,
  enabled: boolean,
  base?: GroupBase,
) {
  const limit = Math.min(Math.max(total ?? 1, 1), GROUP_FETCH_MAX_ROWS);
  const filter = scopedFilter(base?.filter, scope);
  const term = base?.term?.trim() ?? "";

  return {
    queryKey: [...boardQueryKey(projectId), "group", filter, limit, term] as const,
    queryFn: async (): Promise<GroupItems> => {
      const window =
        term.length > 0
          ? await invokeCommand<BoardWindow>("board_search", { projectId, term, filter, limit })
          : await invokeCommand<BoardWindow>("board_list", { projectId, filter, limit });
      return {
        items: window.items,
        limit,
        total: total as number,
        truncated: (total as number) > limit,
      };
    },
    enabled: Boolean(projectId) && enabled && filter !== null && total !== undefined,
  };
}

/**
 * The rows of one expanded group (an epic, the no-epic bucket or a status band).
 *
 * `total` is the row count to expect: an epic's aggregate total, a band's `counts` figure — and
 * for the no-epic bucket, its tasks PLUS the project's epic rows, because the core's epic filter
 * puts an epic row (whose own epic id is null) into the no-epic bucket. The query key sits under
 * the board's own key, so `useBoardChangedSubscription`'s invalidation refreshes it. `enabled`
 * lets a collapsed group cost nothing.
 */
export function useGroupItems(
  projectId: string | undefined,
  scope: GroupScope,
  total: number | undefined,
  enabled = true,
  base?: GroupBase,
) {
  return useQuery<GroupItems>(groupItemsQueryOptions(projectId, scope, total, enabled, base));
}

/** Just each group's data, aligned to the input order. A module-level function so `useQueries`
 * can structurally share the combined result: the rack's rows memo depends on it. */
const pickGroupData = (results: { data: GroupItems | undefined }[]) => results.map((r) => r.data);

/**
 * Every group of the active lens in one hook (a hook cannot be called per group): the scoped fetch
 * of [`useGroupItems`], run for each group whose `enabled` is true. Returns each group's fetched
 * rows aligned to `groups`, `undefined` while a group is collapsed, loading or failed.
 */
export function useGroupItemsMany(
  projectId: string | undefined,
  groups: { scope: GroupScope; total: number | undefined; enabled: boolean }[],
  base?: GroupBase,
) {
  return useQueries({
    queries: groups.map((g) => groupItemsQueryOptions(projectId, g.scope, g.total, g.enabled, base)),
    combine: pickGroupData,
  });
}

/** Which epic headers the active filter and search leave standing (A-04, D-REV-27). */
export interface FilteredEpics {
  /** Epics the core's own filter returned a row for: the epic row itself (the has-worktree chip puts
   * an epic in when any child task has a worktree) or a task that belongs to it. */
  epicIds: string[];
  /** Whether a matching task belongs to no epic, i.e. whether the "No epic" bucket still has a reason to show. */
  hasNoEpicTasks: boolean;
  /** True when the answer filled one call's row limit, so it may be a strict prefix: callers must not
   * hide a header on an incomplete answer. */
  truncated: boolean;
}

/**
 * The epic lens under a filter: which headers have anything left to show. ONE unscoped read through
 * the SAME `board_list`/`board_search` and the SAME filter the groups use, so the core does the
 * filtering (D-03) and there is no second implementation; this only asks "which epics did it return
 * rows for". Off (no query, no cost) while no filter or search is active. Fails open: until the answer
 * lands, or if it may be cut short, every header shows. Header COUNTS stay board-wide (the aggregate
 * is not filter-aware); only the set of headers narrows.
 */
export function useFilteredEpics(projectId: string | undefined, base: GroupBase | undefined, enabled: boolean) {
  const filter = base?.filter;
  const term = base?.term?.trim() ?? "";
  const active = filter !== undefined || term.length > 0;
  return useQuery<FilteredEpics>({
    queryKey: [...boardQueryKey(projectId), "filtered-epics", filter ?? null, term],
    queryFn: async () => {
      const limit = GROUP_FETCH_MAX_ROWS;
      const window =
        term.length > 0
          ? await invokeCommand<BoardWindow>("board_search", { projectId, term, filter, limit })
          : await invokeCommand<BoardWindow>("board_list", { projectId, filter, limit });
      const epicIds = new Set<string>();
      let hasNoEpicTasks = false;
      for (const item of window.items) {
        if ((item.kind ?? "task") === "epic") epicIds.add(item.id);
        else if (item.epicId) epicIds.add(item.epicId);
        else hasNoEpicTasks = true;
      }
      return { epicIds: [...epicIds], hasNoEpicTasks, truncated: window.items.length >= limit };
    },
    enabled: Boolean(projectId) && enabled && active,
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

/** D-84/D-86 (plan 05-02): the `shape-epic` command's own entry point — starts a fresh
 * epic-authoring session against no existing epic (SHAPE-01) and opens the session surface on the
 * returned run id, mirroring `openLiveSessionForTask`'s own "call the command, then set
 * `activeAgentRunId` from its result" shape. `run.authoringStage` is threaded through as the
 * third `setActiveAgentRunId` argument so `SessionSurface.tsx` mounts `ProposalTray` immediately,
 * without a second round trip to learn the run is an authoring session. */
export async function startAuthoringSessionForProject(projectId: string): Promise<void> {
  const run = await startAuthoringRun(projectId);
  useUiStore.getState().setActiveAgentRunId(run.id, null, run.authoringStage, run.epicId);
}

/** D-84/D-86/D-91 (plan 05-10): "Continue shaping" — the ONE entry point both new reopen doors
 * (the board row's `r` action and `ItemDetailPanel.tsx`'s own section, both in `BoardView.tsx`)
 * call, so a running-session collision is caught in exactly one place regardless of which door
 * fired. First asks `authoringRunForEpic` (a pure read) whether `epicId` already has a
 * running/blocked authoring session — if so, routes straight to it (`setActiveAgentRunId`) and
 * starts no second run, asserted by a call count (`authoring_run_start` is never invoked on this
 * path). Otherwise opens the authoring launch sheet against `epicId` (reusing
 * `launchSheetAuthoringHandoff`, D-85/plan 05-09's own Discard hand-off channel) so the epic
 * packet is shown BEFORE any token is spent — the sheet's own Start Shaping button is what
 * eventually calls `startAuthoringRun`. */
export async function continueShapingEpic(epicId: string): Promise<void> {
  const running = await authoringRunForEpic(epicId);
  if (running) {
    useUiStore.getState().setActiveAgentRunId(running.id, null, running.authoringStage, running.epicId);
    return;
  }
  useUiStore.getState().setLaunchSheetAuthoringHandoff(epicId);
}
