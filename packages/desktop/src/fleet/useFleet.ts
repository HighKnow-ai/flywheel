import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  fleetBlockedQueue,
  fleetList,
  subscribeAgentEvent,
  subscribeBoardChanged,
  worktreeInventory,
} from "../adapters/tauri";

/** How often a running agent's activity line may be re-read: `agent:event` fires per stream event, far
 * faster than a row needs to move. Trailing edge, so the last event of a burst is always picked up. */
export const FLEET_ACTIVITY_THROTTLE_MS = 1000;

/** The fleet read's query key. No project id: one database holds every project (D-14), so the fleet is
 * a single app-wide read. */
export function fleetQueryKey() {
  return ["fleet"] as const;
}

/** The blocked queue's query key (plan 10-05). Also app-wide: no project id. */
export function blockedQueueQueryKey() {
  return ["fleet-blocked-queue"] as const;
}

/** The worktree inventory's query key (plan 10-08). Also app-wide: no project id. */
export function worktreeInventoryQueryKey() {
  return ["worktree-inventory"] as const;
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
  useFleetInvalidation();
  return useQuery({
    queryKey: fleetQueryKey(),
    // Lazy, so a test that mocks the adapter without `fleetList` fails the query, not the render.
    queryFn: () => fleetList(),
  });
}

/**
 * Every agent blocked at a pending permission request (FLEET-02, plan 10-05). Same triggers as
 * `useFleet`, through the same single shared subscription: it invalidates BOTH keys, so there is still
 * one `agent:event` listener for the whole app and no third kind of subscription.
 */
export function useBlockedQueue() {
  useFleetInvalidation();
  return useQuery({
    queryKey: blockedQueueQueryKey(),
    queryFn: () => fleetBlockedQueue(),
  });
}

/**
 * Every Story worktree across every registered project with its cached size and a named disposition
 * (WORK-07, plan 10-08). Rides the shared subscription like the other two reads, but only
 * `board:changed` invalidates it: a run starting or a Story being merged changes a row's
 * disposition, whereas an agent event stream would re-run git for every row many times a second.
 */
export function useWorktreeInventory() {
  useFleetInvalidation();
  return useQuery({
    queryKey: worktreeInventoryQueryKey(),
    queryFn: () => worktreeInventory(),
  });
}

/** One invalidation subscription per QueryClient, shared by every mounted consumer (`useFleet`,
 * `useBlockedQueue`, the project rail's count). Plan 10-03 fixed ONE app-level `agent:event` listener
 * for the fleet; a second consumer must not buy a second listener. Reference counted, so the
 * subscription lives exactly as long as at least one consumer is mounted. */
const subscriptions = new Map<QueryClient, { consumers: number; stop: () => void }>();

// The one raw `subscribeBoardChanged` caller outside `board/useBoardChangedInvalidation`: this is a
// module-level, reference-counted subscription (not a React hook, so the shared hook cannot be
// called from it), and all three keys it invalidates are account-wide, so routing on `projectId`
// would be wrong. It is the `{ kind: "account" }` decision expressed in a non-hook context.
function startInvalidation(queryClient: QueryClient): () => void {
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
  };
  const invalidateOnBoardChange = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
  };
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlistenBoard: (() => void) | undefined;
  let unlistenAgent: (() => void) | undefined;

  subscribeBoardChanged(invalidateOnBoardChange).then((fn) => {
    if (cancelled) fn();
    else unlistenBoard = fn;
  });

  subscribeAgentEvent(() => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      invalidate();
    }, FLEET_ACTIVITY_THROTTLE_MS);
  }).then((fn) => {
    if (cancelled) fn();
    else unlistenAgent = fn;
  });

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    unlistenBoard?.();
    unlistenAgent?.();
  };
}

function useFleetInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const existing = subscriptions.get(queryClient);
    if (existing) existing.consumers += 1;
    else subscriptions.set(queryClient, { consumers: 1, stop: startInvalidation(queryClient) });
    return () => {
      const current = subscriptions.get(queryClient);
      if (!current) return;
      current.consumers -= 1;
      if (current.consumers === 0) {
        current.stop();
        subscriptions.delete(queryClient);
      }
    };
  }, [queryClient]);
}
