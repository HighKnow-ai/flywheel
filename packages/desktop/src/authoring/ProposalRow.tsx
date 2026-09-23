/**
 * One proposed item, one row (D-92, plan 05-07) — the tray's row anatomy. Shows the target type as
 * a mark from the `agent` channel (`legend/marks.ts`'s `proposal-pending`, plan 05-03) — never a
 * bare coloured dot — the payload's own fields each rendered as their own element rather than
 * concatenated into a sentence, and the verb when it is not `create`. A per-row action cluster
 * (Task 2) offers accept, reject (with an inline optional-reason field), amend (opens
 * `ProposalAmendEditor.tsx` in place) and, on a task root with at least one pending drafted
 * criterion, accept-subtree (D-95, the ONE bulk path — never a tray-wide accept-all).
 *
 * Renders NO project-key-shaped text (D-96: a pending proposal has none — key allocation happens
 * at acceptance) and no hex colour literal (token roles only).
 *
 * Every action that reaches the backend is guarded by a synchronous `useRef` — the
 * `ackActingRef`/`answeringRef`/`stoppingRef` pattern this codebase has applied repeatedly — so
 * two synchronous clicks in the same tick can never issue two backend calls; React has not
 * necessarily flushed the disabling re-render before the second click fires. A rejected/accepted
 * row leaves the pending list and can never re-activate (the guard is never reset on that path); a
 * failed action stays retryable (the guard IS reset there).
 *
 * D-16/D-45/D-74: a proposal whose `targetId` names a row deleted underneath it is never filtered
 * out of the tray. It surfaces reactively — an accept attempt fails with the core's typed
 * `ProposalUndecidable` error, and this row switches into a stable "undecidable" render (accept
 * disabled for good, reject still live so the developer can clear it) instead of the ordinary
 * retryable-error treatment.
 */
import { useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { useAcceptProposal, useRejectProposal } from "./useAuthoringQuery";
import { ProposalAmendEditor } from "./ProposalAmendEditor";

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
  /** How many PENDING drafted criteria sit under this proposal — only ever non-zero for a `task`
   * root; a criterion row and a childless task both pass `0`, which is what keeps the subtree
   * action off both (D-95). */
  pendingChildCount: number;
  acceptingSubtree: boolean;
  onAcceptSubtree: () => void;
}

interface RowState {
  accepting: boolean;
  rejecting: boolean;
  undecidable: boolean;
  error: string | null;
}

export function ProposalRow({
  agentRunId,
  proposal,
  indented,
  pendingChildCount,
  acceptingSubtree,
  onAcceptSubtree,
}: ProposalRowProps) {
  const [state, setState] = useState<RowState>({
    accepting: false,
    rejecting: false,
    undecidable: false,
    error: null,
  });
  const [rejectReason, setRejectReason] = useState("");
  const [editing, setEditing] = useState(false);

  const acceptMutation = useAcceptProposal(agentRunId);
  const rejectMutation = useRejectProposal(agentRunId);

  // Guards two synchronous clicks in the same tick — React has not necessarily flushed the
  // `disabled` attribute before a second click fires, so a ref (synchronous read/write) is the
  // guard, not `state.accepting`/`state.rejecting` alone. `acceptingRef` carries plan 05-02's own
  // guard forward unchanged; `rejectingRef` is this task's matching addition — the same sibling
  // pattern this codebase has now applied repeatedly (`session/PermissionRequestCard.tsx`'s
  // `answeringRef`, `session/SessionSurface.tsx`'s `stoppingRef`, and others).
  const acceptingRef = useRef(false);
  const rejectingRef = useRef(false);

  const canAcceptSubtree = proposal.targetType === "task" && pendingChildCount > 0;

  async function accept() {
    if (acceptingRef.current || state.undecidable) return;
    acceptingRef.current = true;
    setState((prev) => ({ ...prev, accepting: true, error: null }));
    try {
      await acceptMutation.mutateAsync(proposal.id);
      // On success this row disappears once the shared pending-set query re-reads — no local
      // "accepted" state to hold, and the ref is deliberately never reset (the row unmounts, which
      // is what removes it).
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
    if (rejectingRef.current) return;
    rejectingRef.current = true;
    setState((prev) => ({ ...prev, rejecting: true, error: null }));
    try {
      const reason = rejectReason.trim();
      await rejectMutation.mutateAsync({
        proposalId: proposal.id,
        reason: reason.length > 0 ? reason : undefined,
      });
      // Mirrors `accept`'s own success path — the row unmounts on refetch, the ref is never reset.
    } catch {
      rejectingRef.current = false;
      setState((prev) => ({ ...prev, rejecting: false, error: "Could not reject this proposal. Try again." }));
    }
  }

  function openEditor() {
    if (state.undecidable) return;
    setEditing(true);
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
        {editing ? (
          <ProposalAmendEditor
            agentRunId={agentRunId}
            proposal={proposal}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : (
          <PayloadFields proposal={proposal} />
        )}
      </div>

      {state.undecidable && (
        // T-05-07's own undecidable state: named in place, never a substitute for the buttons
        // below — accept is disabled there, reject stays live so the developer can clear the row.
        <p className="type-label" role="alert" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {undecidableReason(proposal)}
        </p>
      )}

      {!editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
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
            {!state.undecidable && (
              <button
                type="button"
                onClick={openEditor}
                className="type-body"
                style={{
                  background: "transparent",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "var(--text-primary-rack)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: "pointer",
                }}
              >
                Amend
              </button>
            )}
            {canAcceptSubtree && (
              <button
                type="button"
                disabled={acceptingSubtree}
                onClick={onAcceptSubtree}
                aria-label={`Accept task and its ${pendingChildCount} criteria`}
                className="type-body"
                style={{
                  background: "transparent",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "var(--text-primary-rack)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: acceptingSubtree ? "default" : "pointer",
                  opacity: acceptingSubtree ? 0.6 : 1,
                }}
              >
                {acceptingSubtree ? "Accepting…" : `Accept task and its ${pendingChildCount} criteria`}
              </button>
            )}
          </div>
          {!state.undecidable && (
            <input
              aria-label={`Reason for rejecting "${title}" (optional)`}
              placeholder="tell the agent why, and it can try again"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              className="type-label"
              style={{
                background: "transparent",
                border: "1px solid var(--divider)",
                borderRadius: "var(--radius-chrome)",
                color: "inherit",
                padding: "var(--space-xs) var(--space-sm)",
              }}
            />
          )}
        </div>
      )}

      {state.error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
