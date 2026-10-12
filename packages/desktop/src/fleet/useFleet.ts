import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fleetList, subscribeBoardChanged } from "../adapters/tauri";

/** The fleet read's query key. No project id: one database holds every project (D-14), so the fleet is
 * a single app-wide read. */
export function fleetQueryKey() {
  return ["fleet"] as const;
}

/**
 * Every agent run across every registered project (FLEET-01), re-read whenever `board:changed` fires.
 * That event is already app-wide, not project-scoped (`subscribeBoardChanged` takes no project
 * argument), so the fleet rides the existing D-04 push with no new mechanism: no poll timer and no
 * per-run subscription (D-171). Elapsed times tick in the view from `startedAt`, never from IPC.
 */
export function useFleet() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey: fleetQueryKey() })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: fleetQueryKey(),
    queryFn: fleetList,
  });
}
