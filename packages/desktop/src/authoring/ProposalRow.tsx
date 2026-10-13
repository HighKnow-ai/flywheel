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
 *
 * Keyboard (Task 3): `a`/`d`/`e`/`Shift+A` reach this row through `state/keyboard.ts`'s
 * `useRegionBindings`, called below with the tray's own region, ONLY while `selected` is true — no
 * key listener lives in this file. `Shift+A` (accept-subtree) is gated inert here — on a
 * criterion row or a task with no pending children the call never reaches the backend, mirroring
 * how the destructive permission card gates `Shift+A` inert in its own row handler (T-05-07-02).
 *
 * Plan 06-07 Task 1 (D-103): this SAME component also acts on the dedicated triage surface — the
 * optional `region` prop (default `"proposal-tray"`, so every existing caller is byte-identical in
 * behaviour) is threaded through the one `useRegionBindings` call instead of a hard-coded literal.
 * `onMerge`/`onDefer` are rendered and dispatched ONLY when supplied (`ProposalTray.tsx`/
 * `board/TriageLane.tsx` supply neither). `onMerge` never itself calls the backend — it opens
 * `TriageSurface.tsx`'s own target picker (D-101: no default target, no single-keystroke merge) —
 * so it needs no synchronous-tick ref of its own, only this file's ordinary `state.undecidable`
 * guard. `onDefer` IS a real backend call from this row's perspective, so it is guarded exactly
 * like `accept`/`reject` above.
 */
import { useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings, type FocusRegion, type UiLayer } from "../state/keyboard";
import { useAcceptProposal, useRejectProposal } from "./useAuthoringQuery";
import { ProposalAmendEditor } from "./ProposalAmendEditor";
import "../styles/admin-surfaces.css";

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

export function payloadTitle(proposal: AuthoringProposalDto): string {
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
  /** Whether this row currently holds the tray's own selection (`ProposalTray.tsx`'s
   * `j`/`k`-moved index) — the ONE row whose keyboard bindings actually act. */
  selected: boolean;
  onSelect: () => void;
  /** How many PENDING drafted criteria sit under this proposal — only ever non-zero for a `task`
   * root; a criterion row and a childless task both pass `0`, which is what keeps the subtree
   * action off both (D-95). */
  pendingChildCount: number;
  acceptingSubtree: boolean;
  onAcceptSubtree: () => void;
  /** The keyboard region this row acts within (Task 1, plan 06-07) — defaults to the tray's own
   * region so every existing caller (`ProposalTray.tsx`, `board/TriageLane.tsx`) is byte-identical
   * in behaviour. `TriageSurface.tsx` is the one caller that supplies `"triage-surface"`. */
  region?: FocusRegion;
  /** Opens the merge target picker for THIS row (Task 2, `triage/TriageSurface.tsx`) — rendered
   * and dispatched ONLY when supplied, so the tray (which supplies neither this nor `onDefer`)
   * renders no merge control at all. The mutation itself never runs here: only the picker's own
   * explicit target choice ever calls `useMergeProposal` (D-101 — no default target, no
   * single-keystroke merge). */
  onMerge?: () => void;
  /** Defers this row (Task 2, D-102) — rendered and dispatched ONLY when supplied. Unlike
   * `onMerge`, this IS the backend call, so it is guarded exactly like `accept`/`reject` below. */
  onDefer?: () => Promise<void>;
}

interface RowState {
  accepting: boolean;
  rejecting: boolean;
  deferring: boolean;
  undecidable: boolean;
  error: string | null;
}

export function ProposalRow({
  agentRunId,
  proposal,
  indented,
  selected,
  onSelect,
  pendingChildCount,
  acceptingSubtree,
  onAcceptSubtree,
  region = "proposal-tray",
  onMerge,
  onDefer,
}: ProposalRowProps) {
  const [state, setState] = useState<RowState>({
    accepting: false,
    rejecting: false,
    deferring: false,
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
  // `onMerge`'s own guard: merge here means "open the target picker", not "call the backend" — the
  // actual `useMergeProposal` call lives in `TriageSurface.tsx`'s own picker, gated on its own
  // ref (T-06-32) — so this one only needs the file's ordinary `state.undecidable` guard below, not
  // a second synchronous-tick ref of its own. `deferringRef` mirrors `rejectingRef` exactly:
  // `onDefer` IS a real backend call from this row's own perspective.
  const deferringRef = useRef(false);

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

  // Opens the merge target picker one layer up (`TriageSurface.tsx`) — never calls
  // `useMergeProposal` itself (D-101: no default target, no single-keystroke merge).
  function openMerge() {
    if (state.undecidable || !onMerge) return;
    onMerge();
  }

  async function defer() {
    if (deferGuard()) return;
    deferringRef.current = true;
    setState((prev) => ({ ...prev, deferring: true, error: null }));
    try {
      await onDefer?.();
      // Mirrors `accept`'s own success path — the row unmounts once the pending query re-reads
      // (this proposal has left the pending status), and the ref is deliberately never reset.
    } catch {
      deferringRef.current = false;
      setState((prev) => ({ ...prev, deferring: false, error: "Could not defer this proposal. Try again." }));
    }
  }

  function deferGuard(): boolean {
    return deferringRef.current || state.undecidable || !onDefer;
  }

  useRegionBindings(region, region as UiLayer, {
    "accept-proposal": () => {
      if (selected) void accept();
    },
    "reject-proposal": () => {
      if (selected) void reject();
    },
    "amend-proposal": () => {
      if (selected) openEditor();
    },
    "accept-proposal-subtree": () => {
      if (selected && canAcceptSubtree) onAcceptSubtree();
    },
    "merge-proposal": () => {
      if (selected) openMerge();
    },
    "defer-proposal": () => {
      if (selected) void defer();
    },
  });

  const mark = MARKS_BY_ID["proposal-pending"];
  const title = payloadTitle(proposal);

  return (
    <div
      role="group"
      aria-label={`Proposed ${proposal.targetType}: ${title}`}
      onClick={onSelect}
      className="proposal-row"
      data-selected={selected ? "true" : "false"}
      aria-current={selected ? "true" : undefined}
      style={{ marginLeft: indented ? "var(--space-lg)" : 0 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name={mark?.glyph ?? "FileClock"} />
        </span>
        <span className="type-label" style={{ color: "var(--text-muted-rack)", textTransform: "uppercase", flexShrink: 0 }}>
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
            {/* One lead per row: the subtree accept where there is one (it is the larger decision), else Accept.
                With a subtree on offer the bare Accept says what it does, "task only": two buttons that begin
                "Accept" at one weight were the hazard (08.1 group-five finish review). */}
            <button
              type="button"
              disabled={state.accepting || state.undecidable}
              onClick={() => void accept()}
              className={`type-body control-edge admin-action${canAcceptSubtree ? "" : " admin-action-lead"}`}
            >
              {canAcceptSubtree ? "Accept task only" : "Accept"}
            </button>
            <button
              type="button"
              disabled={state.rejecting}
              onClick={() => void reject()}
              className="type-body control-edge admin-action"
            >
              Reject
            </button>
            {!state.undecidable && (
              <button
                type="button"
                onClick={openEditor}
                className="type-body control-edge admin-action"
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
                className="type-body control-edge admin-action admin-action-lead"
              >
                {acceptingSubtree ? "Accepting…" : `Accept task and its ${pendingChildCount} criteria`}
              </button>
            )}
            {onMerge && !state.undecidable && (
              <button
                type="button"
                onClick={openMerge}
                className="type-body control-edge admin-action"
              >
                Merge
              </button>
            )}
            {onDefer && !state.undecidable && (
              <button
                type="button"
                disabled={state.deferring}
                onClick={() => void defer()}
                className="type-body control-edge admin-action"
              >
                {state.deferring ? "Deferring…" : "Defer"}
              </button>
            )}
          </div>
          {!state.undecidable && (
            <input
              aria-label={`Reason for rejecting "${title}" (optional)`}
              placeholder="tell the agent why, and it can try again"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              className="type-label control-edge admin-field"
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
