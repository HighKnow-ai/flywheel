/**
 * One open proposal on an expanded epic (08.1 D-08): an agent's challenge, read inside the epic it
 * concerns and above that epic's tasks, because answering it may change what the tasks are. It is a
 * row of the one rack at the challenge height (A-03) — never a nested list.
 *
 * The same object `authoring/ProposalRow.tsx` shows in the tray and the triage lane, in the same
 * vocabulary: the target type as an uppercase label, the verb when it is not `create`, the payload's
 * title, and Accept / Reject. This is a second place to read it, not a second implementation of it.
 *
 * Accept and Reject go through the SAME mutation hooks the tray and the lane use, passing only the
 * proposal id — there is no second accept path (T-08.1-32). The core emits `board:changed` when the
 * decision lands, and the board's existing subscription refreshes the task rows, the epic's progress
 * aggregate and the pending list. Nothing is removed optimistically: a failed decision leaves the
 * challenge where it was and says so (T-08.1-33).
 *
 * The proposal's text is agent-authored and is rendered only as React text (T-08.1-31).
 */
import { useRef, useState, type CSSProperties } from "react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { payloadTitle } from "../authoring/ProposalRow";
import { useAcceptProposal, useRejectProposal } from "../authoring/useAuthoringQuery";
import { MARKS_BY_ID } from "../legend/marks";
import { Icon } from "./BoardRow";

export interface ChallengeRowProps {
  proposal: AuthoringProposalDto;
  /** The epic this challenge concerns, as `KEY Title` — named in the row's and the buttons' names. */
  epicLabel: string;
}

const truncate: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const buttonStyle: CSSProperties = {
  flexShrink: 0,
  border: "1px solid var(--border-control)",
  borderRadius: "var(--radius-chrome)",
  background: "transparent",
  color: "var(--text-primary-rack)",
  padding: "var(--space-xs) var(--space-md)",
  cursor: "pointer",
};

// Accept and Reject are drawn alike: a --border-control edge on the row surface, as every other
// control on the page is. The brand is not an action colour (08.1-UI-SPEC § The brand rule, "No new
// one is added by this phase"), so Accept carries no fill; its name and position say what it does.

export function ChallengeRow({ proposal, epicLabel }: ChallengeRowProps) {
  const title = payloadTitle(proposal);
  const mark = MARKS_BY_ID["proposal-pending"];
  const acceptMutation = useAcceptProposal(proposal.agentRunId);
  const rejectMutation = useRejectProposal(proposal.agentRunId);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two clicks in one tick must not issue two calls: React has not flushed `disabled` yet, so a ref
  // is the guard. It is released only on failure — on success the row unmounts on the next read.
  const decidingRef = useRef(false);

  async function decide(verb: "accept" | "reject") {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(true);
    setError(null);
    try {
      if (verb === "accept") await acceptMutation.mutateAsync(proposal.id);
      else await rejectMutation.mutateAsync({ proposalId: proposal.id });
    } catch {
      decidingRef.current = false;
      setDeciding(false);
      setError(`Could not ${verb} this proposal. Try again.`);
    }
  }

  return (
    <div
      role="listitem"
      data-challenge-id={proposal.id}
      aria-label={`Proposed ${proposal.targetType} on ${epicLabel}: ${title}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        height: "100%",
        padding: "0 var(--space-md) 0 var(--space-xl)",
        background: "var(--row-surface)",
        color: "var(--text-primary-rack)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, color: "var(--text-muted-rack)" }}>
        <Icon name={mark?.glyph ?? "FileClock"} />
      </span>
      <span className="type-label" style={{ flexShrink: 0, color: "var(--text-muted-rack)", textTransform: "uppercase" }}>
        {proposal.targetType}
      </span>
      {proposal.verb !== "create" && (
        <span className="type-label" style={{ flexShrink: 0, color: "var(--text-muted-rack)", textTransform: "uppercase" }}>
          {proposal.verb}
        </span>
      )}
      <span className="type-body" title={title} style={{ ...truncate, flex: 1, minWidth: 0 }}>
        {title}
      </span>
      {error && (
        <span role="alert" className="type-label" style={{ ...truncate, flexShrink: 0, color: "var(--destructive-text-rack)" }}>
          {error}
        </span>
      )}
      <button
        type="button"
        className="type-body"
        disabled={deciding}
        onClick={() => void decide("accept")}
        aria-label={`Accept "${title}" on ${epicLabel}`}
        style={{ ...buttonStyle, opacity: deciding ? 0.6 : 1 }}
      >
        Accept
      </button>
      <button
        type="button"
        className="type-body"
        disabled={deciding}
        onClick={() => void decide("reject")}
        aria-label={`Reject "${title}" on ${epicLabel}`}
        style={{ ...buttonStyle, opacity: deciding ? 0.6 : 1 }}
      >
        Reject
      </button>
    </div>
  );
}
