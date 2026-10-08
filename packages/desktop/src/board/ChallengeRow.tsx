/**
 * One open proposal on an expanded epic (08.1 D-08): an agent's challenge, read inside the epic it
 * concerns and above that epic's tasks, because answering it may change what the tasks are. It is a
 * row of the one rack at the challenge height (A-03) — never a nested list.
 *
 * The same object `authoring/ProposalRow.tsx` shows in the tray and the triage lane, in the same
 * vocabulary: the target type as an uppercase label, the verb when it is not `create`, the payload's
 * title, and Accept / Reject. This is a second place to read it, not a second implementation of it.
 *
 * The proposal's text is agent-authored and is rendered only as React text (T-08.1-31).
 */
import type { CSSProperties } from "react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { payloadTitle } from "../authoring/ProposalRow";
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
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-chrome)",
  background: "transparent",
  color: "var(--text-primary-rack)",
  padding: "var(--space-xs) var(--space-md)",
  cursor: "pointer",
};

const acceptStyle: CSSProperties = { ...buttonStyle, background: "var(--accent-nontext)", border: "none" };

export function ChallengeRow({ proposal, epicLabel }: ChallengeRowProps) {
  const title = payloadTitle(proposal);
  const mark = MARKS_BY_ID["proposal-pending"];

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
      <span className="type-label" style={{ flexShrink: 0, color: "var(--accent-text-rack)", textTransform: "uppercase" }}>
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
      <button type="button" className="type-body" aria-label={`Accept "${title}" on ${epicLabel}`} style={acceptStyle}>
        Accept
      </button>
      <button type="button" className="type-body" aria-label={`Reject "${title}" on ${epicLabel}`} style={buttonStyle}>
        Reject
      </button>
    </div>
  );
}
