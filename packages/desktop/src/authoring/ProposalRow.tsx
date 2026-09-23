/**
 * One proposed item, one row (D-92, plan 05-07 Task 1) — the tray's row anatomy. Shows the target
 * type as a mark from the `agent` channel (`legend/marks.ts`'s `proposal-pending`, plan 05-03) —
 * never a bare coloured dot — the payload's own fields each rendered as their own element rather
 * than concatenated into a sentence, and the verb when it is not `create`.
 *
 * Renders NO project-key-shaped text (D-96: a pending proposal has none — key allocation happens
 * at acceptance) and no hex colour literal (token roles only).
 *
 * D-16/D-45/D-74: a proposal whose `targetId` names a row deleted underneath it is never filtered
 * out of the tray. It surfaces reactively — an accept attempt fails with the core's typed
 * `ProposalUndecidable` error, and this row switches into a stable "undecidable" render (accept
 * disabled for good, reject still live so the developer can clear it) instead of the ordinary
 * retryable-error treatment.
 *
 * Task 1 ships accept/reject; accept carries plan 05-02's own synchronous `acceptingRef` guard
 * forward unchanged (a pre-existing property, not new work). Task 2 fills the rest of the action
 * cluster: a matching guard for reject, the reject reason input, the amend editor, the
 * accept-subtree action and its own keyed guard.
 */
import { useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { useAcceptProposal, useRejectProposal } from "./useAuthoringQuery";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** The stable substring `domain::authoring_proposal::ProposalUndecidable`'s `Display` impl always
 * carries — matched against the rejected command's error text rather than the whole message,
 * whose `{proposal_id:?}`/`{target_id:?}` interpolations are not stable across rows. */
const UNDECIDABLE_MARKER = "undecidable, not auto-rejected";

function isUndecidableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(UNDECIDABLE_MARKER);
}

/** What the undecidable row names as missing — composed from the proposal's own already-known
 * `verb`/`targetType` rather than re-parsed from the backend's error text, which is written for a
 * developer reading a log, not for display. */
function undecidableReason(proposal: AuthoringProposalDto): string {
  if (proposal.verb === "amend") return `The ${proposal.targetType} this amends was deleted.`;
  if (proposal.verb === "delete") return `The ${proposal.targetType} this deletes was already removed.`;
  return `The ${proposal.targetType} this proposal targets no longer exists.`;
}

function payloadTitle(proposal: AuthoringProposalDto): string {
  const { payload } = proposal;
  if (typeof payload.title === "string") return payload.title;
  if (typeof payload.statement === "string") return payload.statement;
  if (typeof payload.assumption === "string") return payload.assumption;
  return "(untitled)";
}

/** The payload's own fields, each its own element — a criterion's statement and verification hint
 * are two distinct pieces of text a developer reads separately, never a run-on sentence. */
function PayloadFields({ proposal }: { proposal: AuthoringProposalDto }) {
  const { payload } = proposal;
  if (payload.kind === "criterion") {
    const hint = typeof payload.verification_hint === "string" ? payload.verification_hint : null;
    return (
      <>
        <span className="type-body">{typeof payload.statement === "string" ? payload.statement : ""}</span>
        {hint && (
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            {hint}
          </span>
        )}
      </>
    );
  }
  if (payload.kind === "assumption") {
    const answer = typeof payload.answer === "string" ? payload.answer : "";
    return (
      <>
        <span className="type-body">{typeof payload.assumption === "string" ? payload.assumption : ""}</span>
        {answer.length > 0 && (
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            {answer}
          </span>
        )}
      </>
    );
  }
  // task / epic
  const description = typeof payload.description === "string" ? payload.description : null;
  return (
    <>
      <span className="type-body">{typeof payload.title === "string" ? payload.title : ""}</span>
      {description && (
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {description}
        </span>
      )}
    </>
  );
}

export interface ProposalRowProps {
  agentRunId: string;
  proposal: AuthoringProposalDto;
  /** True for a drafted criterion nested under its task (Task 1(c)) — a small visual indent, no
   * new component. */
  indented: boolean;
}

interface RowState {
  accepting: boolean;
  rejecting: boolean;
  undecidable: boolean;
  error: string | null;
}

export function ProposalRow({ agentRunId, proposal, indented }: ProposalRowProps) {
  const [state, setState] = useState<RowState>({
    accepting: false,
    rejecting: false,
    undecidable: false,
    error: null,
  });

  const acceptMutation = useAcceptProposal(agentRunId);
  const rejectMutation = useRejectProposal(agentRunId);

  // Guards two synchronous clicks in the same tick — React has not necessarily flushed the
  // `disabled` attribute before a second click fires, so a ref (synchronous read/write) is the
  // guard, not `state.accepting` alone. Carried forward from plan 05-02's own `ProposalTray.tsx`
  // unchanged (the sixth sibling of this codebase's own ackActingRef/answeringRef pattern);
  // Task 2 adds the matching guard for reject.
  const acceptingRef = useRef(false);

  async function accept() {
    if (acceptingRef.current || state.undecidable) return;
    acceptingRef.current = true;
    setState((prev) => ({ ...prev, accepting: true, error: null }));
    try {
      await acceptMutation.mutateAsync(proposal.id);
      // On success this row disappears once the shared pending-set query re-reads — the ref is
      // deliberately never reset (mirrors plan 05-02's own reasoning): the row unmounts, which is
      // what removes it.
    } catch (err) {
      acceptingRef.current = false;
      if (isUndecidableError(err)) {
        setState((prev) => ({ ...prev, accepting: false, undecidable: true, error: null }));
      } else {
        setState((prev) => ({ ...prev, accepting: false, error: "Could not accept this proposal. Try again." }));
      }
    }
  }

  async function reject() {
    setState((prev) => ({ ...prev, rejecting: true, error: null }));
    try {
      await rejectMutation.mutateAsync({ proposalId: proposal.id });
    } catch {
      setState((prev) => ({ ...prev, rejecting: false, error: "Could not reject this proposal. Try again." }));
    }
  }

  const mark = MARKS_BY_ID["proposal-pending"];
  const title = payloadTitle(proposal);

  return (
    <div
      role="group"
      aria-label={`Proposed ${proposal.targetType}: ${title}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-md)",
        marginLeft: indented ? "var(--space-lg)" : 0,
        borderRadius: "var(--radius-chrome)",
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name={mark?.glyph ?? "FileClock"} />
        </span>
        <span
          className="type-label"
          style={{ color: "var(--accent-text-rack)", textTransform: "uppercase", flexShrink: 0 }}
        >
          {proposal.targetType}
        </span>
        {proposal.verb !== "create" && (
          <span
            className="type-label"
            style={{ color: "var(--text-muted-rack)", textTransform: "uppercase", flexShrink: 0 }}
          >
            {proposal.verb}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <PayloadFields proposal={proposal} />
      </div>

      {state.undecidable && (
        // T-05-07's own undecidable state: named in place, never a substitute for the buttons
        // below — accept is disabled there, reject stays live so the developer can clear the row.
        <p className="type-label" role="alert" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {undecidableReason(proposal)}
        </p>
      )}
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="button"
          disabled={state.accepting || state.undecidable}
          onClick={() => void accept()}
          className="type-body"
          style={{
            background: "var(--accent-nontext)",
            border: "none",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: state.accepting || state.undecidable ? "default" : "pointer",
            opacity: state.accepting || state.undecidable ? 0.6 : 1,
          }}
        >
          Accept
        </button>
        <button
          type="button"
          disabled={state.rejecting}
          onClick={() => void reject()}
          className="type-body"
          style={{
            background: "transparent",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: state.rejecting ? "default" : "pointer",
            opacity: state.rejecting ? 0.6 : 1,
          }}
        >
          Reject
        </button>
      </div>

      {state.error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
