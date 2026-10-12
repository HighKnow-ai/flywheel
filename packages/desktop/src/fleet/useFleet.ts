import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fleetList, subscribeAgentEvent, subscribeBoardChanged } from "../adapters/tauri";

/** How often a running agent's activity line may be re-read: `agent:event` fires per stream event, far
 * faster than a row needs to move. Trailing edge, so the last event of a burst is always picked up. */
export const FLEET_ACTIVITY_THROTTLE_MS = 1000;

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
 *
 * Plan 10-03 adds ONE app-level `agent:event` listener, because `board:changed` is not emitted per
 * agent event and an activity line driven by it alone would not move. It is not D-171's rejected
 * per-run subscription: one static listener for the whole surface, registered once, whose only job is
 * to trailing-edge-throttle an invalidation of the same single query key. It never reads the payload
 * and never writes the cache, so the one read path (and the one normaliser, in the view) is unchanged.
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    subscribeAgentEvent(() => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
      }, FLEET_ACTIVITY_THROTTLE_MS);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      unlisten?.();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: fleetQueryKey(),
    queryFn: fleetList,
  });
}
