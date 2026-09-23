/**
 * The proposal tray (D-80/D-82, plan 05-02) — a sibling panel beside the feed on
 * `SessionSurface.tsx`, reading its own query (`board/useBoardQuery.ts`'s `useAuthoringProposals`)
 * rather than being woven into `FeedRow.tsx`'s per-event rendering — the same composition
 * `StatusStrip`/`PermissionRequestCard` already use for their own mount points.
 *
 * For this plan (05-02's tracer), it renders: a heading with a pending count, one row per pending
 * proposal showing the payload's `title` and its `targetType`, and one Accept control per row.
 * D-96: a staged proposal has no project key yet — key allocation happens at acceptance — so a
 * pending row renders NO key-shaped identifier at all, not a placeholder, not a dash in the key
 * slot.
 */
import { useRef, useState } from "react";
import { acceptAuthoringProposal } from "../adapters/tauri";
import { useAuthoringProposals } from "../board/useBoardQuery";

export interface AuthoringProposalRow {
  id: string;
  targetType: string;
  payload: { kind: string; title?: string; [key: string]: unknown };
}

export interface ProposalTrayProps {
  /** The authoring run this tray is mounted against. `null`/`undefined` disables the underlying
   * query entirely (mirrors `PermissionRequestCard`'s own `agentRunId`-gated mount pattern). */
  agentRunId: string | null | undefined;
}

/** One proposal row's own accept/error state — independent per proposal id, mirroring
 * `PermissionRequestCard.tsx`'s `RowState` exactly. */
interface RowState {
  accepting: boolean;
  error: string | null;
}

function ProposalRow({ proposal }: { proposal: AuthoringProposalRow }) {
  const [state, setState] = useState<RowState>({ accepting: false, error: null });

  // Guards two synchronous clicks in the same tick — React has not necessarily flushed the
  // `disabled` attribute before a second click fires, so a ref (synchronous read/write) is the
  // guard, not `state.accepting` alone. The sixth sibling of this codebase's own
  // ackActingRef/answeringRef/removingRef/killingRef/stoppingRef pattern
  // (`item-detail/RunsSection.tsx`, `session/PermissionRequestCard.tsx`, and others).
  const acceptingRef = useRef(false);

  async function accept() {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setState({ accepting: true, error: null });
    try {
      await acceptAuthoringProposal(proposal.id);
      // On success this row disappears once the shared pending-set query re-reads — no local
      // "accepted" state to hold, and the ref is deliberately never reset (mirrors
      // PermissionRequestCard.tsx's own reasoning): the row unmounts, which is what removes it.
    } catch {
      acceptingRef.current = false;
      setState({ accepting: false, error: "Could not accept this proposal. Try again." });
    }
  }

  const title = typeof proposal.payload.title === "string" ? proposal.payload.title : "(untitled)";

  return (
    <div
      role="group"
      aria-label={`Proposed ${proposal.targetType}: ${title}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-chrome)",
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
        <span
          className="type-label"
          style={{ color: "var(--accent-text-rack)", textTransform: "uppercase", flexShrink: 0 }}
        >
          {proposal.targetType}
        </span>
        <span
          className="type-heading"
          title={title}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {title}
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="button"
          disabled={state.accepting}
          onClick={() => void accept()}
          className="type-body"
          style={{
            background: "var(--accent-nontext)",
            border: "none",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: state.accepting ? "default" : "pointer",
            opacity: state.accepting ? 0.6 : 1,
          }}
        >
          Accept
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

export function ProposalTray({ agentRunId }: ProposalTrayProps) {
  const proposalsQuery = useAuthoringProposals(agentRunId);
  const proposals = proposalsQuery.data ?? [];

  return (
    <div
      role="region"
      aria-label="Staged proposals"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
      <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        {proposals.length} pending proposal{proposals.length === 1 ? "" : "s"}
      </span>
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.id}
          proposal={{ id: proposal.id, targetType: proposal.targetType, payload: proposal.payload }}
        />
      ))}
    </div>
  );
}
