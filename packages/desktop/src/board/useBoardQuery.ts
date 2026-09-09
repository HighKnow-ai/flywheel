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

export interface BoardItem {
  id: string;
  key: string;
  title: string;
  status: string;
  rank: string;
  priority: number;
  epicId: string | null;
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
