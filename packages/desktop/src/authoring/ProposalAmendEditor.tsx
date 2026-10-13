/**
 * The staged row's own field-by-field editor (D-94, plan 05-07) — opened by a task/epic's title
 * and description, a criterion's statement and verification hint, or an assumption's assumption
 * and answer, and saving writes the STAGED row, leaving it `pending`. Accepting is a separate,
 * later action; what materialises afterward is the developer's own text.
 *
 * D-94 rejects accept-then-edit explicitly (05-CONTEXT.md): the board would hold a wrong statement
 * in between, the agent would learn nothing from the correction, and against an already-locked
 * task the first edit would become a revision of something that arrived wrong. This editor writes
 * to staging — the only place a correction can happen before the board sees anything — and does
 * not route through the board's own item-detail editors, which exist for a different moment in the
 * lifecycle (after acceptance).
 *
 * Validates with the same non-empty/length-bound rules the accept path's own domain layer applies
 * (`packages/core/src/domain/authoring_proposal.rs`'s `validate_payload`), so the developer is told
 * at the keystroke rather than at the round trip.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { useAmendProposal } from "./useAuthoringQuery";
import "../styles/admin-surfaces.css";

/** Mirrors `domain::authoring_proposal::MAX_PROPOSAL_TITLE_LEN`. */
const MAX_PROPOSAL_TITLE_LEN = 500;
/** Mirrors `domain::authoring_proposal::MAX_PROPOSAL_TEXT_LEN`. */
const MAX_PROPOSAL_TEXT_LEN = 1000;

export interface ProposalAmendEditorProps {
  agentRunId: string;
  proposal: AuthoringProposalDto;
  onCancel: () => void;
  onSaved: () => void;
}

interface BuildResult {
  payload: Record<string, unknown> | null;
  error: string | null;
}

function fieldFrom(proposal: AuthoringProposalDto, field: string): string {
  const value = proposal.payload[field];
  return typeof value === "string" ? value : "";
}

export function ProposalAmendEditor({ agentRunId, proposal, onCancel, onSaved }: ProposalAmendEditorProps) {
  const kind = typeof proposal.payload.kind === "string" ? proposal.payload.kind : proposal.targetType;

  const [title, setTitle] = useState(fieldFrom(proposal, "title"));
  const [description, setDescription] = useState(fieldFrom(proposal, "description"));
  const [statement, setStatement] = useState(fieldFrom(proposal, "statement"));
  const [verificationHint, setVerificationHint] = useState(fieldFrom(proposal, "verification_hint"));
  const [assumption, setAssumption] = useState(fieldFrom(proposal, "assumption"));
  const [answer, setAnswer] = useState(fieldFrom(proposal, "answer"));
  const [error, setError] = useState<string | null>(null);

  const amendMutation = useAmendProposal(agentRunId);
  const savingRef = useRef(false);

  function build(): BuildResult {
    if (kind === "task" || kind === "epic") {
      const trimmedTitle = title.trim();
      if (trimmedTitle.length === 0 || trimmedTitle.length > MAX_PROPOSAL_TITLE_LEN) {
        return { payload: null, error: `Title must be 1-${MAX_PROPOSAL_TITLE_LEN} characters.` };
      }
      const trimmedDescription = description.trim();
      if (trimmedDescription.length > MAX_PROPOSAL_TEXT_LEN) {
        return { payload: null, error: `Description must be at most ${MAX_PROPOSAL_TEXT_LEN} characters.` };
      }
      return {
        payload: {
          kind,
          title: trimmedTitle,
          description: trimmedDescription.length > 0 ? trimmedDescription : null,
        },
        error: null,
      };
    }
    if (kind === "criterion") {
      const trimmedStatement = statement.trim();
      if (trimmedStatement.length === 0 || trimmedStatement.length > MAX_PROPOSAL_TEXT_LEN) {
        return { payload: null, error: `Statement must be 1-${MAX_PROPOSAL_TEXT_LEN} characters.` };
      }
      const trimmedHint = verificationHint.trim();
      if (trimmedHint.length > MAX_PROPOSAL_TEXT_LEN) {
        return { payload: null, error: `Verification hint must be at most ${MAX_PROPOSAL_TEXT_LEN} characters.` };
      }
      return {
        payload: {
          kind,
          statement: trimmedStatement,
          verification_hint: trimmedHint.length > 0 ? trimmedHint : null,
        },
        error: null,
      };
    }
    // assumption
    const trimmedAssumption = assumption.trim();
    if (trimmedAssumption.length === 0 || trimmedAssumption.length > MAX_PROPOSAL_TEXT_LEN) {
      return { payload: null, error: `Assumption must be 1-${MAX_PROPOSAL_TEXT_LEN} characters.` };
    }
    const trimmedAnswer = answer.trim();
    if (trimmedAnswer.length > MAX_PROPOSAL_TEXT_LEN) {
      return { payload: null, error: `Answer must be at most ${MAX_PROPOSAL_TEXT_LEN} characters.` };
    }
    return { payload: { kind, assumption: trimmedAssumption, answer: trimmedAnswer }, error: null };
  }

  async function save() {
    if (savingRef.current) return;
    const built = build();
    if (!built.payload) {
      setError(built.error);
      return;
    }
    savingRef.current = true;
    setError(null);
    try {
      await amendMutation.mutateAsync({ proposalId: proposal.id, payload: built.payload });
      // The row survives (it stays `pending`) — the guard is deliberately never reset here,
      // matching this codebase's own "released only on the paths where the row survives"
      // discipline: `onSaved` unmounts this editor, which is what removes it.
      onSaved();
    } catch {
      savingRef.current = false;
      setError("Could not save your edit. Try again.");
    }
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // Keeps the shared `proposal-tray` region binding from ever seeing this keystroke — the
    // typing-target guard in `state/keyboard.ts`'s `resolveBinding` already covers a bare key, but
    // stopping propagation here is the same belt-and-suspenders discipline
    // `item-detail/AcceptanceCriteriaList.tsx`'s own inline editors apply.
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label="Edit staged proposal"
      onClick={(event) => event.stopPropagation()}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}
    >
      {(kind === "task" || kind === "epic") && (
        <>
          <input
            className="type-body control-edge admin-field"
            aria-label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={handleFieldKeyDown}
            autoFocus
          />
          <input
            className="type-label control-edge admin-field"
            aria-label="Description"
            placeholder="Description (optional)…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={handleFieldKeyDown}
          />
        </>
      )}
      {kind === "criterion" && (
        <>
          <input
            className="type-body control-edge admin-field"
            aria-label="Statement"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            onKeyDown={handleFieldKeyDown}
            autoFocus
          />
          <input
            className="type-label control-edge admin-field"
            aria-label="Verification hint"
            placeholder="Verification hint (optional)…"
            value={verificationHint}
            onChange={(event) => setVerificationHint(event.target.value)}
            onKeyDown={handleFieldKeyDown}
          />
        </>
      )}
      {kind === "assumption" && (
        <>
          <input
            className="type-body control-edge admin-field"
            aria-label="Assumption"
            value={assumption}
            onChange={(event) => setAssumption(event.target.value)}
            onKeyDown={handleFieldKeyDown}
            autoFocus
          />
          <input
            className="type-label control-edge admin-field"
            aria-label="Answer"
            placeholder="Answer (optional)…"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={handleFieldKeyDown}
          />
        </>
      )}

      {error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="button"
          onClick={() => void save()}
          className="type-body control-edge admin-action admin-action-lead"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="type-body control-edge admin-action"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
