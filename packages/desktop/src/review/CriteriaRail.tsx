/**
 * The criteria rail (Phase 8 plan 08-06, REVW-03, D-134/D-139/D-140/D-141): the item's acceptance
 * criteria beside the diff. It COMPOSES the item panel's criteria list — the same rows,
 * revision markers, plain-check interaction and key grammar the item panel uses — and adds only
 * what review needs: what a check would attach, a per-row "check against selection" affordance,
 * and a footer counting criteria checked without evidence. In epic scope it also lists the epic's
 * tasks with where their criteria stand (D-132); an epic with no tasks shows nothing for them.
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
import { useEpicTaskRollup, useReviewCriteriaState } from "./useReviewQuery";

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
  const rollup = useEpicTaskRollup(itemId, scope === "epic").data ?? [];
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
        // The rail renders the composer CLOSED even with zero criteria. The panel's zero-item
        // autofocus is right there and wrong here: this surface owns single-key bindings, so an
        // input holding focus on mount swallows them (G-08-R2-1 — `r` typed a character instead
        // of opening the epic request). Every epic with an integration branch currently has zero
        // criteria, so this was not an edge case.
        autoOpenWhenEmpty={false}
      />
      {scope === "epic" && rollup.length > 0 && (
        <section aria-label="Task criteria roll-up" style={{ borderTop: "1px solid var(--divider)", paddingTop: "var(--space-sm)" }}>
          <h3 className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
            Tasks
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            {rollup.map((t) => (
              <li key={t.taskId} style={{ display: "flex", flexDirection: "column" }}>
                <span>
                  <span className="type-label">{t.key}</span> {t.title}
                </span>
                <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                  {t.total > 0 ? `${t.checked}/${t.total} criteria checked` : "no criteria"}
                  {t.withoutEvidence > 0 ? `, ${t.withoutEvidence} without evidence` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
