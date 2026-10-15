/**
 * The Cycle region's read (Phase 14 plan 14-01, RECD-09): the active Cycle's goal and its folded
 * progress. Server state lives in React Query only, never in Zustand. Invalidated on
 * `subscribeBoardChanged` like every other board-wide read, never polled.
 */
import { useQuery } from "@tanstack/react-query";
import { cycleRegion } from "../adapters/tauri";
import { useBoardChangedInvalidation } from "./useBoardChangedInvalidation";

export function cycleRegionQueryKey(projectId: string | undefined) {
  return ["cycle-region", projectId] as const;
}

export function useCycleRegionQuery(projectId: string | undefined) {
  useBoardChangedInvalidation({ kind: "project", projectId }, projectId ? [cycleRegionQueryKey(projectId)] : []);

  return useQuery({
    queryKey: cycleRegionQueryKey(projectId),
    queryFn: () => cycleRegion(projectId as string),
    enabled: Boolean(projectId),
  });
}
