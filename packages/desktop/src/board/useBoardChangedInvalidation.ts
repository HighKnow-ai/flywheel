/**
 * The ONE place a pushed event is routed to the query keys it affects (FNC-07): `board:changed` through
 * `useBoardChangedInvalidation`, and a session's `agent:event` through `useAgentEventInvalidation`.
 *
 * Every keyed reader in the renderer used to carry its own copy of the same effect — subscribe,
 * `cancelled`/`unlisten` bookkeeping, invalidate on every event — and ignored the payload, so an
 * event in project A re-fetched project B's views. Routing the decision through one module means the readers cannot drift apart.
 *
 * Three scope kinds for `board:changed`, because there are three genuine routing decisions in the tree:
 * - `project` — the reader's keys embed a `projectId`; only that project's events wake it.
 * - `viewed`  — the reader's keys embed an id (Story, Epic, run) that exists only inside the project
 *               currently being viewed; only the viewed project's events wake it.
 * - `account` — the reader's data is account-wide; every event wakes it.
 *
 * The unroutable branch is deliberate: an event whose `projectId` is `null`, absent or malformed
 * (it crossed a process boundary) invalidates rather than being dropped, and so does a `viewed`
 * scope with no project selected. An unroutable event that invalidated nothing would leave a stale
 * board, which is strictly worse than an over-broad refresh — that trade stays explicit here
 * rather than becoming an accident of a missing branch. An `agent:event` with no `runId` fails open
 * the same way.
 *
 * Coalescing (issue #195): every event lands in a batch that is invalidated `COALESCE_MS` after the
 * batch's FIRST event, once per distinct key. The window never moves, so a steady stream still
 * refreshes the screen at most `1000 / COALESCE_MS` times a second and never waits longer than one
 * window; nothing is lost, because every key of every event in the window is in the batch.
 */
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { subscribeAgentEvent, subscribeBoardChanged, type BoardChangedPayload } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";

/**
 * The coalescing window, sized on the measured event rate (issue #195). Over the 18 real Claude Code
 * sessions in the owner's app data (2026-09-11 to 2026-10-25), a session emits 38 `agent:event`s a
 * minute on average, and its bursts reach 19 events inside 100 ms (21 in one second): a tool call, its
 * result and the assistant text that follows arrive together. Without a window every one of those
 * re-read the session log, cancelling the read before it, so a burst of 19 cost 19 overlapping
 * refetches of every loaded window and the feed showed none of them until the burst ended. 100 ms
 * folds such a burst into one refetch, and is under the threshold at which a delay is noticed.
 */
export const COALESCE_MS = 100;

/** Keys collected over one window, invalidated together when it closes. */
export interface InvalidationBatch {
  add(keys: readonly QueryKey[]): void;
  cancel(): void;
}

function isPrefix(prefix: QueryKey, key: QueryKey): boolean {
  return prefix.length < key.length && prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));
}

/** A batch that invalidates every key it was given, once each, `windowMs` after its first. A key that
 * another key of the same batch prefixes is left out: invalidating the prefix already covers it. */
export function createInvalidationBatch(queryClient: QueryClient, windowMs = COALESCE_MS): InvalidationBatch {
  let pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const keys = [...pending.values()];
    pending = new Map();
    for (const queryKey of keys) {
      if (keys.some((other) => isPrefix(other, queryKey))) continue;
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  return {
    add(keys) {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (timer === undefined && pending.size > 0) timer = setTimeout(flush, windowMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = new Map();
    },
  };
}

export type BoardChangedScope =
  { kind: "project"; projectId: string | null | undefined } | { kind: "viewed" } | { kind: "account" };

export function useBoardChangedInvalidation(
  scope: BoardChangedScope,
  keys: readonly QueryKey[],
  options?: { coalesceMs?: number; unroutableKeys?: readonly QueryKey[] },
): void {
  const queryClient = useQueryClient();
  const viewedProjectId = useUiStore((s) => s.currentProjectId);
  const scopeProjectId = scope.kind === "project" ? scope.projectId : scope.kind === "viewed" ? viewedProjectId : null;

  // Read through refs so the effect resubscribes only when the key SET changes, not per render.
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const unroutableRef = useRef(options?.unroutableKeys);
  unroutableRef.current = options?.unroutableKeys;
  const coalesceMs = options?.coalesceMs ?? COALESCE_MS;
  const keysJson = JSON.stringify(keys);
  const disabled = keys.length === 0 || (scope.kind === "project" && scope.projectId === undefined);

  useEffect(() => {
    if (disabled) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const batch = createInvalidationBatch(queryClient, coalesceMs);

    // `payload` may be undefined or the wrong shape: it crossed a process boundary.
    subscribeBoardChanged((payload?: Partial<BoardChangedPayload>) => {
      if (scope.kind === "account") return batch.add(keysRef.current);
      const eventProjectId = payload?.projectId;
      if (typeof eventProjectId !== "string") {
        return batch.add(unroutableRef.current ?? keysRef.current);
      }
      // A `viewed` scope with no project selected cannot say what is its own: fail open.
      if (scopeProjectId === null || eventProjectId === scopeProjectId) {
        return batch.add(keysRef.current);
      }
      return undefined;
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      batch.cancel();
    };
    // `scope` is read only for `kind`, which is a dep; `keys` is read through `keysRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, scopeProjectId, scope.kind, keysJson, coalesceMs, disabled]);
}

/**
 * Routes `agent:event` to one session's keys: only that session's events wake them (issue #195). Every
 * reader of a session's live data (its feed, View raw, its permission requests) used to invalidate on
 * every agent event of every session, so three running agents re-read each open feed three times as
 * often as its own agent spoke. An event with no string `runId` fails open. Coalesced like
 * `board:changed`. `null`/`undefined` subscribes to nothing.
 */
export function useAgentEventInvalidation(sessionId: string | null | undefined, keys: readonly QueryKey[]): void {
  const queryClient = useQueryClient();
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const keysJson = JSON.stringify(keys);

  useEffect(() => {
    if (!sessionId || keysRef.current.length === 0) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const batch = createInvalidationBatch(queryClient);
    subscribeAgentEvent((event) => {
      const runId = event?.runId;
      if (typeof runId === "string" && runId !== sessionId) return;
      batch.add(keysRef.current);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      batch.cancel();
    };
  }, [queryClient, sessionId, keysJson]);
}
