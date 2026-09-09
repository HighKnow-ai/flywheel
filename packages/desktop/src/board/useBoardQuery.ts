/**
 * TanStack Query hooks wrapping `adapters/tauri.ts` — every read and mutation the board surface
 * needs routes through `invokeCommand`, and the board query is invalidated by
 * `subscribeBoardChanged` (D-04): the renderer never trusts its own write as already resolved.
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeCommand, subscribeBoardChanged } from "../adapters/tauri";
import { EMPTY_FILTER_DRAFT, type BoardFilterDraft } from "../state/uiStore";

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
  /** S/M/L stored as a nullable ordinal 1-3 (D-12) — `undefined`/`null` means "no estimate set",
   * rendered as no badge at all, never aggregated anywhere in the UI or a query. */
  estimate?: number | null;
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
  estimates?: number[];
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
  if (filter.estimates.length > 0) {
    input.estimates = filter.estimates;
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

/**
 * Set a task's or an epic's workflow status by keystroke (`s` then `1`-`5`, StatusPicker). Which
 * command to call depends on `kind` — the picker itself never re-derives the state list, only
 * which entity-scoped command carries the change.
 */
export function useSetStatus(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string; status: string }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_set_status" : "task_set_status", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        status: input.status,
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
 * Move a task or an epic up/down by one position within its priority band (`⌘↑`/`⌘↓`, D-11,
 * BOARD-05). Mirrors `useSetStatus`'s kind-dispatch shape exactly.
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

/** Set a task's or an epic's estimate (`e`, D-12: nullable S/M/L). `estimate: null` clears it. */
export function useSetEstimate(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: BoardItemKind; id: string; estimate: number | null }) =>
      invokeCommand<void>(input.kind === "epic" ? "epic_set_estimate" : "task_set_estimate", {
        [input.kind === "epic" ? "epicId" : "taskId"]: input.id,
        estimate: input.estimate,
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
 * G-01-EPIC-ASSIGN). Unlike `useSetStatus`/`useSetPriority`/`useSetEstimate`/`useSetAssignee`,
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
 * Subscribes EXACTLY ONCE to the core's `board:changed` push channel and invalidates the board
 * query key in the handler (D-04) — the UI must never treat its own mutation as already
 * resolved: creating a task refreshes the board because the core emitted `board:changed`.
 */
export function useBoardChangedSubscription() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => {
      queryClient.invalidateQueries({ queryKey: ["board"] });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);
}
