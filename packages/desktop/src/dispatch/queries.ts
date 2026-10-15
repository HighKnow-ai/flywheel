/**
 * The fan-out surface's server state. Keys sit under `["board", ...]` so the one `board:changed`
 * subscription (`useBoardChangedSubscription`) refreshes them; the Rust core, not an optimistic local
 * write, is the source of truth for plan state (D-04).
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import {
  dispatchGateState,
  dispatchPlanGet,
  dispatchPlanningRun,
  getSettings,
  subscribeDispatchGateChanged,
  type DispatchCapDto,
} from "../adapters/tauri";

export const dispatchPlanKey = (epicId: string) => ["board", "dispatch", "plan", epicId] as const;
export const planningRunKey = (epicId: string) => ["board", "dispatch", "planning-run", epicId] as const;
export const GATE_KEY = ["board", "dispatch", "gate"] as const;
export const CAP_KEY = ["board", "dispatch", "cap"] as const;

/** A Tauri rejection is a bare string; an `Error` carries `message`. Either way the user reads the core's words. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDispatchPlan(epicId: string | null) {
  return useQuery({
    queryKey: dispatchPlanKey(epicId ?? ""),
    queryFn: () => dispatchPlanGet(epicId as string),
    enabled: epicId !== null,
  });
}

export function usePlanningRun(epicId: string | null) {
  return useQuery({
    queryKey: planningRunKey(epicId ?? ""),
    queryFn: () => dispatchPlanningRun(epicId as string),
    enabled: epicId !== null,
  });
}

/** The gate is account-wide. It refetches on `board:changed` (via its key) and on `dispatch:gate_changed`. */
export function useDispatchGate(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeDispatchGateChanged(() => {
      queryClient.invalidateQueries({ queryKey: GATE_KEY });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, queryClient]);
  return useQuery({ queryKey: GATE_KEY, queryFn: dispatchGateState, enabled });
}

/** The cap and what is actually running against it, as `settings_get` reports them. */
export function useDispatchCap(enabled = true) {
  // Account-wide: the running-run count moves on any project's event, and the central subscription
  // no longer wakes this key for a foreign one (FNC-07).
  useBoardChangedInvalidation({ kind: "account" }, enabled ? [CAP_KEY] : []);
  return useQuery<DispatchCapDto>({
    queryKey: CAP_KEY,
    queryFn: async () => (await getSettings()).dispatchCap,
    enabled,
  });
}
