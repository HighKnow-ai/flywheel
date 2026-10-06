/**
 * Review reads (Phase 8 plan 08-01) — structural siblings of `board/useBoardQuery.ts`'s
 * `useForgeRequest`: own query key, one `subscribeBoardChanged` effect that invalidates it,
 * `staleTime: 0`. No polling interval — the push-then-invalidate channel is the only refresh path.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  reviewCriteriaState,
  reviewFilePatch,
  reviewFiles,
  reviewMergePrecheck,
  subscribeBoardChanged,
  type ReviewScopeDto,
} from "../adapters/tauri";

export function reviewFilesQueryKey(scope: ReviewScopeDto, itemId: string) {
  return ["review-files", scope, itemId] as const;
}

export function reviewPatchQueryKey(
  scope: ReviewScopeDto,
  itemId: string,
  path: string,
  oldPath: string | null,
) {
  return ["review-patch", scope, itemId, path, oldPath] as const;
}

/** The scope's file list — one git read on open. */
export function useReviewFiles(scope: ReviewScopeDto, itemId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!itemId) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() =>
      queryClient.invalidateQueries({ queryKey: ["review-files", scope, itemId] }),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [scope, itemId, queryClient]);

  return useQuery({
    queryKey: itemId ? reviewFilesQueryKey(scope, itemId) : (["review-files", "none"] as const),
    queryFn: () => reviewFiles(scope, itemId as string),
    enabled: Boolean(itemId),
    staleTime: 0,
  });
}

/** One file's patch — `enabled` flips true when the file is expanded, so nothing unopened is
 * fetched. */
export function useReviewPatch(
  scope: ReviewScopeDto,
  itemId: string,
  path: string,
  oldPath: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() =>
      queryClient.invalidateQueries({ queryKey: reviewPatchQueryKey(scope, itemId, path, oldPath) }),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [scope, itemId, path, oldPath, enabled, queryClient]);

  return useQuery({
    queryKey: reviewPatchQueryKey(scope, itemId, path, oldPath),
    queryFn: () => reviewFilePatch(scope, itemId, path, oldPath),
    enabled,
    staleTime: 0,
  });
}

/** The same key `item-detail/AcceptanceCriteriaList.tsx` reads its evidence under, so the rail, the
 * surface and the item panel share one fetch. */
export function reviewCriteriaStateQueryKey(scope: ReviewScopeDto, itemId: string) {
  return ["review-criteria-state", scope, itemId] as const;
}

/** Every current criterion of the item with its anchor and staleness (REVW-03). */
export function useReviewCriteriaState(scope: ReviewScopeDto, itemId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!itemId) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() =>
      queryClient.invalidateQueries({ queryKey: reviewCriteriaStateQueryKey(scope, itemId) }),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [scope, itemId, queryClient]);

  return useQuery({
    queryKey: itemId ? reviewCriteriaStateQueryKey(scope, itemId) : (["review-criteria-state", "none"] as const),
    queryFn: () => reviewCriteriaState(scope, itemId as string),
    enabled: Boolean(itemId),
    staleTime: 0,
  });
}

export function mergePrecheckQueryKey(taskId: string) {
  return ["review-merge-precheck", taskId] as const;
}

/** What a merge of the task would do (REVW-04) — the side-effect-free dry run, so reading it is
 * free. `staleTime: 0` re-runs it whenever a new observer mounts (the confirm sheet opening), so
 * the will-conflict hint is as fresh as the sheet; the merge itself re-runs the dry run anyway. */
export function useMergePrecheck(taskId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const active = enabled && Boolean(taskId);

  useEffect(() => {
    if (!active || !taskId) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() =>
      queryClient.invalidateQueries({ queryKey: mergePrecheckQueryKey(taskId) }),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active, taskId, queryClient]);

  return useQuery({
    queryKey: taskId ? mergePrecheckQueryKey(taskId) : (["review-merge-precheck", "none"] as const),
    queryFn: () => reviewMergePrecheck(taskId as string),
    enabled: active,
    staleTime: 0,
  });
}
