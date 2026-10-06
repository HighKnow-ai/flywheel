/**
 * The criteria rail (Phase 8 plan 08-06, REVW-03, D-134/D-140/D-141): the item's acceptance
 * criteria beside the diff. It COMPOSES the item panel's criteria list — the same rows,
 * revision markers, plain-check interaction and key grammar the item panel uses — and adds only
 * what review needs: the evidence, staleness and a footer counting criteria checked without
 * evidence.
 */
import type { ReviewScopeDto } from "../adapters/tauri";
import { AcceptanceCriteriaList } from "../item-detail/AcceptanceCriteriaList";
import { useReviewCriteriaState } from "./useReviewQuery";

export interface CriteriaRailProps {
  scope: ReviewScopeDto;
  itemId: string;
}

export function CriteriaRail({ scope, itemId }: CriteriaRailProps) {
  const state = useReviewCriteriaState(scope, itemId);
  const withoutEvidence = (state.data ?? []).filter((s) => s.criterion.checked && !s.anchor).length;

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
      <AcceptanceCriteriaList parentType={scope} parentId={itemId} />
      {withoutEvidence > 0 && (
        <p className="type-label" style={{ margin: 0 }}>
          {withoutEvidence} {withoutEvidence === 1 ? "criterion" : "criteria"} checked without evidence
        </p>
      )}
    </aside>
  );
}
