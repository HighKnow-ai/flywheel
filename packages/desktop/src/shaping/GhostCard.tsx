/**
 * A spec-change Proposal on the Epic card (docs/mvp-spec.md §3 "Proposals in shaping", issue #125).
 *
 * Pending, it is a ghost of the field it would rewrite, drawn right under that field's text: a dashed edge
 * in the brand hue on the running tint, the shape of something not yet on the record. It reads "Proposed
 * Scope", the agent's whole new text at the field's own measure, and the agent's why. Three decisions sit
 * under it, made on the field and never in an inbox:
 *
 * - Accept applies the text as proposed (`proposal_accept`, one transaction with the decision).
 * - Amend opens the text for editing; accepting the edit is one act (`proposal_amend`).
 * - Reject asks for an optional reason (`proposal_reject`), which the next shaping packet carries.
 *
 * Rejected, it shrinks to one struck-through line in secondary ink with the reason after it, so the Epic
 * card keeps what was turned down and why, without competing with the live field.
 */
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, CircleDashed, PenLine, X } from "lucide-react";
import { proposalAccept, proposalAmend, proposalReject, type ProposalDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

/** The longest spec field the core accepts (`proposal_apply::MAX_SPEC_FIELD_LEN`). */
const MAX_SPEC_LEN = 20_000;
/** The longest rejection reason `proposal_reject` accepts. */
const MAX_REASON_LEN = 500;

/** A spec change's payload, or null for any other Proposal. */
export function specChangeOf(proposal: ProposalDto): { field: string; text: string } | null {
  if (proposal.verb !== "amend" || proposal.targetType !== "epic") return null;
  const payload = proposal.payload as { field?: unknown; text?: unknown } | null;
  if (typeof payload?.field !== "string" || typeof payload.text !== "string") return null;
  return { field: payload.field, text: payload.text };
}

function reason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface GhostCardProps {
  proposal: ProposalDto;
  /** The field's name as the card reads it: "Scope". */
  label: string;
  /** The read to refresh once a decision lands. */
  queryKey: readonly unknown[];
}

export function GhostCard({ proposal, label, queryKey }: GhostCardProps) {
  const change = specChangeOf(proposal);
  if (!change) return null;
  return proposal.state === "rejected" ? (
    <RejectedLine text={change.text} label={label} reason={proposal.rejectionReason} />
  ) : (
    <PendingGhost proposal={proposal} field={change.field} text={change.text} label={label} queryKey={queryKey} />
  );
}

function RejectedLine({ text, label, reason }: { text: string; label: string; reason: string | null }) {
  return (
    <div
      role="group"
      aria-label={`Rejected ${label}`}
      data-state="rejected"
      className="mt-2 flex min-w-0 flex-col gap-0.5 rounded-sm border border-dashed border-border px-2 py-1"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-small text-muted-foreground">
        <Ban aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="shrink-0 text-meta font-semibold text-subtle-foreground">Rejected</span>
        <del className="min-w-0 truncate decoration-1" title={text}>
          {text}
        </del>
      </span>
      <span className="truncate pl-5 text-meta text-subtle-foreground" title={reason ?? undefined}>
        {reason ? `Your reason: ${reason}` : "No reason given"}
      </span>
    </div>
  );
}

type Mode = "idle" | "amending" | "rejecting";

function PendingGhost({
  proposal,
  field,
  text,
  label,
  queryKey,
}: {
  proposal: ProposalDto;
  field: string;
  text: string;
  label: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const draftId = useId();
  const reasonId = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await write();
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError(`Could not decide the proposed ${label}: ${reason(err)}`);
      setBusy(false);
    }
  }

  function submitAmend(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    const edited = draft.trim();
    if (!edited) return;
    void decide(() => proposalAmend(proposal.id, { field, text: edited }));
  }

  function submitReject(event: FormEvent) {
    event.preventDefault();
    const given = why.trim();
    void decide(() => proposalReject(proposal.id, given === "" ? null : given));
  }

  function cancel() {
    setMode("idle");
    setError(null);
  }

  return (
    <div
      role="group"
      aria-label={`Proposed ${label}`}
      data-state="pending"
      className="mt-2.5 flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-primary bg-running-muted px-3 py-2.5"
    >
      <span className="flex items-center gap-1.5 text-meta font-semibold text-running">
        <CircleDashed aria-hidden="true" className="size-3.5" />
        Proposed {label}
      </span>

      {mode === "amending" ? (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submitAmend}>
          <label htmlFor={draftId} className="sr-only">
            Your {label}
          </label>
          <Textarea
            id={draftId}
            value={draft}
            maxLength={MAX_SPEC_LEN}
            autoFocus
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                cancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                submitAmend(e);
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={busy || !draft.trim()} aria-label="Accept your edit">
              <Check aria-hidden="true" />
              {busy ? "Saving…" : "Accept edit"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              <X aria-hidden="true" />
              Cancel
            </Button>
            <Kbd className="ml-auto">⌘↩</Kbd>
          </div>
        </form>
      ) : (
        <>
          <p className="m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words text-foreground">{text}</p>
          {proposal.rationale && (
            <p className="m-0 max-w-[68ch] text-small break-words text-muted-foreground">Why: {proposal.rationale}</p>
          )}
        </>
      )}

      {mode === "rejecting" && (
        <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={submitReject}>
          <label htmlFor={reasonId} className="sr-only">
            Why not? (optional)
          </label>
          <Input
            id={reasonId}
            value={why}
            maxLength={MAX_REASON_LEN}
            autoFocus
            disabled={busy}
            placeholder="Why not? (optional)"
            className="h-7.5 min-w-48 flex-1"
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                cancel();
              }
            }}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            <Ban aria-hidden="true" />
            {busy ? "Saving…" : "Reject"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        </form>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void decide(() => proposalAccept(proposal.id))}
            aria-label={`Accept the proposed ${label}`}
          >
            <Check aria-hidden="true" />
            {busy ? "Saving…" : "Accept"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setDraft(text);
              setError(null);
              setMode("amending");
            }}
            aria-label={`Amend the proposed ${label}`}
          >
            <PenLine aria-hidden="true" />
            Amend
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setWhy("");
              setError(null);
              setMode("rejecting");
            }}
            aria-label={`Reject the proposed ${label}`}
          >
            <X aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
