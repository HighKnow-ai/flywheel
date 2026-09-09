/**
 * TanStack Query hooks wrapping `adapters/tauri.ts` — every read and mutation the board surface
 * needs routes through `invokeCommand`, and the board query is invalidated by
 * `subscribeBoardChanged` (D-04): the renderer never trusts its own write as already resolved.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeCommand, subscribeBoardChanged } from "../adapters/tauri";

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

/** The bounded board window for one project (D-03 — the core returns a page, never the whole board). */
export function useBoardQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: boardQueryKey(projectId),
    queryFn: () => invokeCommand<BoardWindow>("board_list", { projectId }),
    enabled: Boolean(projectId),
  });
}

/** Create a task at the current position (D-09 quick-add). */
export function useCreateTask(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      invokeCommand<BoardItem>("task_create", { projectId, title }),
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

/** Create an issue (proposals/notes — no status, D-07). */
export function useCreateIssue(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; kind: string }) =>
      invokeCommand<IssueItem>("issue_create", {
        projectId,
        title: input.title,
        kind: input.kind,
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
