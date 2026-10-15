/**
 * Review reads (Phase 8 plan 08-01) — structural siblings of `board/useBoardQuery.ts`'s
 * `useForgeRequest`: own query key, one `subscribeBoardChanged` effect that invalidates it,
 * `staleTime: 0`. No polling interval — the push-then-invalidate channel is the only refresh path.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import {
  forgeEpicRequestDraft,
  forgeRequestForEpic,
  reviewChangesRequestState,
  reviewEpicTaskRollup,
  reviewCriteriaState,
  reviewFilePatch,
  reviewFiles,
  reviewMergePrecheck,
  reviewRequestChanges,
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

  useBoardChangedInvalidation({ kind: "viewed" }, itemId ? [["review-files", scope, itemId]] : []);

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

  useBoardChangedInvalidation({ kind: "viewed" }, enabled ? [reviewPatchQueryKey(scope, itemId, path, oldPath)] : []);

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

  useBoardChangedInvalidation({ kind: "viewed" }, itemId ? [reviewCriteriaStateQueryKey(scope, itemId)] : []);

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
  const active = enabled && Boolean(taskId);

  useBoardChangedInvalidation({ kind: "viewed" }, active && taskId ? [mergePrecheckQueryKey(taskId)] : []);

  return useQuery({
    queryKey: taskId ? mergePrecheckQueryKey(taskId) : (["review-merge-precheck", "none"] as const),
    queryFn: () => reviewMergePrecheck(taskId as string),
    enabled: active,
    staleTime: 0,
  });
}

export function changesRequestQueryKey(taskId: string) {
  return ["review-changes-request", taskId] as const;
}

/** Whether a decline is offered for the task, already sent back, or refused by a named category
 * (A-08(a)). A read in the exact shape of `useMergePrecheck`: board-changed invalidates its own key,
 * `staleTime: 0`. `enabled` is whether anything is showing it. */
export function useChangesRequest(taskId: string | undefined, enabled: boolean) {
  const active = enabled && Boolean(taskId);

  useBoardChangedInvalidation({ kind: "viewed" }, active && taskId ? [changesRequestQueryKey(taskId)] : []);

  return useQuery({
    queryKey: taskId ? changesRequestQueryKey(taskId) : (["review-changes-request", "none"] as const),
    queryFn: () => reviewChangesRequestState(taskId as string),
    enabled: active,
    staleTime: 0,
  });
}

/** Send the task back (A-08(a)). The mutation takes no input but the task id it was built with, so
 * nothing the surface holds can become the reason. It re-reads the decline state on settle whether
 * the write succeeded or was refused: the surface shows the board's answer, never its own. */
export function useRequestChanges(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reviewRequestChanges(taskId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: changesRequestQueryKey(taskId) }),
  });
}

export function epicRequestDraftQueryKey(epicId: string) {
  return ["review-epic-request-draft", epicId] as const;
}

export function epicRequestQueryKey(epicId: string) {
  return ["review-epic-request", epicId] as const;
}

/** The epic's request draft and the named reason it cannot be proposed (REVW-05) — a read, so
 * `enabled` is whether anything is showing it. */
export function useEpicRequestDraft(epicId: string | undefined, enabled: boolean) {
  const active = enabled && Boolean(epicId);

  useBoardChangedInvalidation({ kind: "viewed" }, active && epicId ? [epicRequestDraftQueryKey(epicId)] : []);

  return useQuery({
    queryKey: epicId ? epicRequestDraftQueryKey(epicId) : (["review-epic-request-draft", "none"] as const),
    queryFn: () => forgeEpicRequestDraft(epicId as string),
    enabled: active,
    staleTime: 0,
  });
}

export function epicTaskRollupQueryKey(epicId: string) {
  return ["review-epic-task-rollup", epicId] as const;
}

/** Each task of the epic with its criteria counts (D-132) — a read, so `enabled` is whether an
 * epic-scope rail is showing it. */
export function useEpicTaskRollup(epicId: string | undefined, enabled: boolean) {
  const active = enabled && Boolean(epicId);

  useBoardChangedInvalidation({ kind: "viewed" }, active && epicId ? [epicTaskRollupQueryKey(epicId)] : []);

  return useQuery({
    queryKey: epicId ? epicTaskRollupQueryKey(epicId) : (["review-epic-task-rollup", "none"] as const),
    queryFn: () => reviewEpicTaskRollup(epicId as string),
    enabled: active,
    staleTime: 0,
  });
}

/** The epic's existing request, read live from the forge. */
export function useEpicRequest(epicId: string | undefined, enabled = true) {
  const active = enabled && Boolean(epicId);

  useBoardChangedInvalidation({ kind: "viewed" }, active && epicId ? [epicRequestQueryKey(epicId)] : []);

  return useQuery({
    queryKey: epicId ? epicRequestQueryKey(epicId) : (["review-epic-request", "none"] as const),
    queryFn: () => forgeRequestForEpic(epicId as string),
    enabled: active,
    staleTime: 0,
    retry: false,
  });
}
