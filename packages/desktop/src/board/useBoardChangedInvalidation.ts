/**
 * The ONE place a `board:changed` event is routed to the query keys it affects (FNC-07).
 *
 * Every keyed reader in the renderer used to carry its own copy of the same effect — subscribe,
 * `cancelled`/`unlisten` bookkeeping, invalidate on every event — and ignored the payload, so an
 * event in project A re-fetched project B's views. Routing the decision through one hook means the readers cannot drift apart.
 *
 * Three scope kinds, because there are three genuine routing decisions in the tree:
 * - `project` — the reader's keys embed a `projectId`; only that project's events wake it.
 * - `viewed`  — the reader's keys embed an id (Story, Epic, run) that exists only inside the project
 *               currently being viewed; only the viewed project's events wake it.
 * - `account` — the reader's data is account-wide; every event wakes it.
 *
 * The unroutable branch is deliberate: an event whose `projectId` is `null`, absent or malformed
 * (it crossed a process boundary) invalidates rather than being dropped, and so does a `viewed`
 * scope with no project selected. An unroutable event that invalidated nothing would leave a stale
 * board, which is strictly worse than an over-broad refresh — that trade stays explicit here
 * rather than becoming an accident of a missing branch.
 *
 * No coalescing unless `debounceMs` is passed: the event rate has not been measured, and a window
 * sized on a guess can only lose events. Two events in one tick invalidate twice, in arrival order.
 */
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { subscribeBoardChanged, type BoardChangedPayload } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";

export type BoardChangedScope =
  | { kind: "project"; projectId: string | null | undefined }
  | { kind: "viewed" }
  | { kind: "account" };

export function useBoardChangedInvalidation(
  scope: BoardChangedScope,
  keys: readonly QueryKey[],
  options?: { debounceMs?: number; unroutableKeys?: readonly QueryKey[] },
): void {
  const queryClient = useQueryClient();
  const viewedProjectId = useUiStore((s) => s.currentProjectId);
  const scopeProjectId =
    scope.kind === "project" ? scope.projectId : scope.kind === "viewed" ? viewedProjectId : null;

  // Read through refs so the effect resubscribes only when the key SET changes, not per render.
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const unroutableRef = useRef(options?.unroutableKeys);
  unroutableRef.current = options?.unroutableKeys;
  const debounceMs = options?.debounceMs;
  const keysJson = JSON.stringify(keys);
  const disabled = keys.length === 0 || (scope.kind === "project" && scope.projectId === undefined);

  useEffect(() => {
    if (disabled) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const invalidate = (toInvalidate: readonly QueryKey[]) => {
      if (debounceMs === undefined) {
        for (const queryKey of toInvalidate) queryClient.invalidateQueries({ queryKey });
        return;
      }
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        for (const queryKey of toInvalidate) void queryClient.invalidateQueries({ queryKey });
      }, debounceMs);
    };

    // `payload` may be undefined or the wrong shape: it crossed a process boundary.
    subscribeBoardChanged((payload?: Partial<BoardChangedPayload>) => {
      if (scope.kind === "account") return invalidate(keysRef.current);
      const eventProjectId = payload?.projectId;
      if (typeof eventProjectId !== "string") {
        return invalidate(unroutableRef.current ?? keysRef.current);
      }
      // A `viewed` scope with no project selected cannot say what is its own: fail open.
      if (scopeProjectId === null || eventProjectId === scopeProjectId) {
        return invalidate(keysRef.current);
      }
      return undefined;
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      if (pending !== undefined) clearTimeout(pending);
    };
    // `scope` is read only for `kind`, which is a dep; `keys` is read through `keysRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, scopeProjectId, scope.kind, keysJson, debounceMs, disabled]);
}
