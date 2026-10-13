import { useQuery } from "@tanstack/react-query";
import { updateCheck } from "../adapters/tauri";
import { useFleet } from "../fleet/useFleet";

/** How often the release feed is asked again (plan 11-06, D-187). Six hours: long enough to be invisible
 * and to stay far under any rate limit, short enough that a release published in the morning is offered
 * the same day to a window left open. Also the stale time, so a window-focus refetch cannot turn every
 * alt-tab into a network call; a failed check is stale at once and retries on the next focus. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function updateQueryKey() {
  return ["update-check"] as const;
}

/** The release feed's answer. The first check runs on mount, which `useQuery` does by default, so launch
 * needs no separate effect. A failed check is not retried in a loop and not shown: no banner is the right
 * reading of "could not ask". */
export function useUpdate() {
  return useQuery({
    queryKey: updateQueryKey(),
    // Lazy: the adapter is read when the query runs, not when the hook renders.
    queryFn: () => updateCheck(),
    refetchInterval: UPDATE_CHECK_INTERVAL_MS,
    staleTime: UPDATE_CHECK_INTERVAL_MS,
    retry: false,
  });
}

/** Agent runs that are live, for display only (D-188). Derived from the fleet read the rest of the app
 * already shares, so no query is added. Rust counts again with its own predicate and is the one that
 * refuses; the fleet read is capped, so this number can fall short and the refusal's own count is shown
 * when it disagrees. */
export function useLiveRunCount(): number {
  const { data } = useFleet();
  return (data?.rows ?? []).filter((row) => row.runStatus === "running" || row.runStatus === "blocked").length;
}
