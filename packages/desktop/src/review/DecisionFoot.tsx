/**
 * The review decision (Phase 8.1 plan 21, A-08(a)): the two honest answers to a review sit together
 * at the foot of the criteria column, where the attestation completes. `Request changes` sends the
 * task back to its agent with its unchecked criteria as the reason; `Merge` takes it in. This is the
 * placement the approved comp draws (`comps/review.html`, `.action-row`); only the placement is
 * taken from it, because the comp fills its primary and the owner's no-filled-buttons rule governs.
 *
 * Which action leads: Merge keeps the 2px ink lead edge whenever it is offered. Request changes is a
 * hairline secondary. When Merge is not offered, Request changes does NOT inherit the lead: absence
 * does not promote a decline, so the foot simply has no lead. A decline is reversible (re-submit the
 * card, or check the criteria), not destructive, so neither action wears the destructive role.
 *
 * No confirm sheet. A decline writes nothing outside the board and spends nothing, so the cost is
 * shown before the click instead of confirmed after it: "sends N unchecked criteria back", and the
 * button's accessible description is that same line.
 *
 * The group renders nothing at all when it has nothing to show. Absence is the design.
 *
 * The write takes a task id and nothing else (T-08.1-58): there is no text field here and no way for
 * this component to author what the agent reads. A refusal the reviewer can fix is said in the
 * surface's own voice; a refusal they cannot (not in flight, integrated) says nothing.
 */
import { useId } from "react";
import { useChangesRequest, useRequestChanges } from "./useReviewQuery";

const NOTHING_UNCHECKED =
  "Every criterion is checked, so there is nothing to send back. Uncheck the one that is not met to request changes.";
const NO_CRITERIA =
  "This task has no acceptance criteria, so there is nothing to send back. Add the criterion that is not met to request changes.";
const COULD_NOT_SEND = "Could not send this back. Reload the review and try again.";

const noun = (n: number) => (n === 1 ? "criterion" : "criteria");

/** A rejection packed `refused:<category>` is the board saying no, not a failure: the re-read says
 * what changed. Anything else is a failure the reviewer may retry. */
function isRefusal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("refused");
}

export interface DecisionFootProps {
  taskId: string;
  /** The surface's one expression for whether Merge is offered (G-08-6): the button here and the
   * `m` binding read the same boolean, so they are never offered under different conditions. */
  mergeOffered: boolean;
  /** Whether anything is showing the decline read (a resolved task target). */
  declineEnabled: boolean;
  onMerge: () => void;
}

export function DecisionFoot({ taskId, mergeOffered, declineEnabled, onMerge }: DecisionFootProps) {
  const lineId = useId();
  const state = useChangesRequest(taskId, declineEnabled).data;
  const request = useRequestChanges(taskId);

  let line: string | null = null;
  let note: string | null = null;
  if (state?.state === "ready") {
    line = `Request changes sends ${state.uncheckedCount} unchecked ${noun(state.uncheckedCount)} back to the agent.`;
  } else if (state?.state === "sentBack") {
    note = `Sent back to the agent: ${state.uncheckedCount} unchecked ${noun(state.uncheckedCount)}. They go into the next session's briefing.`;
  } else if (state?.state === "refused" && state.category === "nothingUnchecked") {
    note = NOTHING_UNCHECKED;
  } else if (state?.state === "refused" && state.category === "noCriteria") {
    note = NO_CRITERIA;
  }

  const failed = request.isError && !isRefusal(request.error) && state?.state === "ready";

  if (!line && !note && !mergeOffered) return null;

  return (
    <div role="group" aria-label="Review decision" className="review-decision">
      {line && (
        <p id={lineId} className="type-label review-decision-note">
          {line}
        </p>
      )}
      {note && (
        <p role="status" className="type-label review-decision-note">
          {note}
        </p>
      )}
      {failed && (
        <p role="alert" className="type-label review-decision-alert">
          {COULD_NOT_SEND}
        </p>
      )}
      <div className="review-decision-actions">
        {line && (
          <button
            type="button"
            aria-describedby={lineId}
            disabled={request.isPending}
            onClick={() => request.mutate()}
            className="type-body control-edge review-secondary"
          >
            Request changes
          </button>
        )}
        {mergeOffered && (
          <button type="button" onClick={onMerge} className="type-body control-edge review-action">
            Merge
          </button>
        )}
      </div>
    </div>
  );
}
