/**
 * The criteria rail (Phase 8 plan 08-06, REVW-03, D-134/D-139/D-140/D-141): the item's acceptance
 * criteria beside the diff. It COMPOSES the item panel's criteria list — the same rows,
 * revision markers, plain-check interaction and key grammar the item panel uses — and adds only
 * what review needs: what a check would attach, a per-row "check against selection" affordance,
 * and a footer counting criteria checked without evidence.
 *
 * Selecting lines writes nothing. The check is the act of attestation (T-08-06-01): only
 * `useCheckAgainstSelection`'s mutation calls the write command, and it passes no sha — the core
 * resolves the one it stores.
 */
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { criterionCheckWithAnchor, type ReviewScopeDto } from "../adapters/tauri";
import { AcceptanceCriteriaList } from "../item-detail/AcceptanceCriteriaList";
import { anchorFromSelection, type ReviewSelection } from "./selection";
import { useReviewCriteriaState } from "./useReviewQuery";

/** Returns `(criterionId) => void`: check that criterion against the current selection, or with no
 * evidence at all when nothing is selected (D-140). */
export function useCheckAgainstSelection(
  scope: ReviewScopeDto,
  itemId: string,
  selection: ReviewSelection | null,
) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (criterionId: string) => {
      const anchor = anchorFromSelection(selection);
      return criterionCheckWithAnchor({ scope, itemId, criterionId, ...(anchor ? { anchor } : {}) });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review-criteria-state", scope, itemId] }),
        queryClient.invalidateQueries({ queryKey: ["criteria", scope, itemId] }),
      ]),
  });
  return useCallback((criterionId: string) => mutation.mutate(criterionId), [mutation]);
}

export interface CriteriaRailProps {
  scope: ReviewScopeDto;
  itemId: string;
  selection: ReviewSelection | null;
  onCheck: (criterionId: string) => void;
  onFocusChange: (criterionId: string | null) => void;
}

export function CriteriaRail({ scope, itemId, selection, onCheck, onFocusChange }: CriteriaRailProps) {
  const state = useReviewCriteriaState(scope, itemId);
  const withoutEvidence = (state.data ?? []).filter((s) => s.criterion.checked && !s.anchor).length;
  const anchor = anchorFromSelection(selection);

  return (
    <aside
      aria-label="Criteria rail"
      // The list handles j/k/Space/Enter itself; the surface listens for the same keys on `window`
      // to drive the file list. Stop those here so one keystroke is never two actions.
      onKeyDown={(event) => {
        if (["j", "k", " ", "Enter"].includes(event.key)) event.stopPropagation();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", padding: "var(--space-md)" }}
    >
      <AcceptanceCriteriaList
        parentType={scope}
        parentId={itemId}
        onFocusChange={onFocusChange}
        onCheckSelected={onCheck}
      />
      <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
        {anchor
          ? `Selected: ${anchor.path}:${anchor.lineStart}${anchor.lineEnd === anchor.lineStart ? "" : `–${anchor.lineEnd}`} (${anchor.side}). Checking a criterion records this as its evidence.`
          : "No lines selected. Click diff line numbers to select; checking now records no evidence."}
      </p>
      {withoutEvidence > 0 && (
        <p className="type-label" style={{ margin: 0 }}>
          {withoutEvidence} {withoutEvidence === 1 ? "criterion" : "criteria"} checked without evidence
        </p>
      )}
    </aside>
  );
}
