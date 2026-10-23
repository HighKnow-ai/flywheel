/**
 * A spec-change Proposal on the Epic card (docs/mvp-spec.md §3 "Proposals in shaping", issue #125), or an
 * exit-test change over a Milestone's exit test (issue #132), drawn and decided the same way.
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
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
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

/** A spec change's payload, or a Milestone exit-test change's as the same `{field, text}` (issue #132: an
 * Amend Milestone carrying only `exit_test`), or null for any other Proposal. */
export function specChangeOf(proposal: ProposalDto): { field: string; text: string } | null {
  if (proposal.verb !== "amend") return null;
  if (proposal.targetType === "milestone") {
    const payload = proposal.payload as { title?: unknown; exit_test?: unknown } | null;
    if (typeof payload?.exit_test !== "string" || (payload.title !== undefined && payload.title !== null)) return null;
    return { field: "exit_test", text: payload.exit_test };
  }
  if (proposal.targetType !== "epic") return null;
  const payload = proposal.payload as { field?: unknown; text?: unknown } | null;
  if (typeof payload?.field !== "string" || typeof payload.text !== "string") return null;
  return { field: payload.field, text: payload.text };
}

/** The payload an Amend sends: the developer's text, in the Proposal's own shape. */
function amendedPayload(proposal: ProposalDto, field: string, text: string): Record<string, unknown> {
  return proposal.targetType === "milestone" ? { title: null, exit_test: text } : { field, text };
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
      className="mt-2 flex min-w-0 flex-col gap-0.5"
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

/** One field Amend opens, its value the Proposal's as filed. */
export interface AmendField {
  name: string;
  /** Its visible label; with `hideLabel`, read only by assistive tech. */
  label: string;
  value: string;
  multiline?: boolean;
  maxLength: number;
  /** Accept edit waits until it holds text. */
  required?: boolean;
  hideLabel?: boolean;
}

export interface ProposalDecisionProps {
  proposal: ProposalDto;
  /** How the controls name the Proposal: "the proposed Scope", "New Story “Empty-line recovery”". */
  subject: string;
  /** What Amend edits, and the payload it sends; `null` when the Proposal carries no text to edit. */
  amend: { fields: AmendField[]; payload: (values: Record<string, string>) => unknown } | null;
  /** The Proposal as it reads while no edit is open. */
  children: ReactNode;
  /** Runs once a decision lands, while this Proposal is still mounted: refresh the reads, move the keyboard. */
  afterDecide: () => Promise<void>;
}

/**
 * The three decisions on a pending Proposal, made where it is drawn (issue #125; the triage drawer reuses them,
 * issue #162): Accept applies it as proposed (`proposal_accept`), Amend opens its text for editing and accepts the
 * edit in one act (`proposal_amend`), Reject asks for an optional reason (`proposal_reject`). While an edit is open
 * it replaces the Proposal's text, with the agent's why kept in sight.
 */
export function ProposalDecision({ proposal, subject, amend, children, afterDecide }: ProposalDecisionProps) {
  const fieldId = useId();
  const reasonId = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amendRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);

  const ready = amend?.fields.every((f) => !f.required || (draft[f.name] ?? "").trim() !== "") ?? false;

  async function decide(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await write();
      await afterDecide();
    } catch (err) {
      setError(`Could not decide ${subject}: ${reason(err)}`);
      setBusy(false);
    }
  }

  function submitAmend(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    if (!amend || !ready) return;
    const values = Object.fromEntries(amend.fields.map((f) => [f.name, (draft[f.name] ?? "").trim()]));
    void decide(() => proposalAmend(proposal.id, amend.payload(values)));
  }

  function submitReject(event: FormEvent) {
    event.preventDefault();
    const given = why.trim();
    void decide(() => proposalReject(proposal.id, given === "" ? null : given));
  }

  function cancel() {
    const opener = mode === "amending" ? amendRef : rejectRef;
    setMode("idle");
    setError(null);
    // Back to the control that opened the mode, once it is mounted again.
    requestAnimationFrame(() => opener.current?.focus());
  }

  function onFieldKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submitAmend(e);
    }
  }

  return (
    <>
      {mode === "amending" && amend ? (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submitAmend}>
          {/* The agent's why stays in sight while the developer edits its text. */}
          {proposal.rationale && (
            <p className="m-0 max-w-[68ch] text-small break-words text-muted-foreground">Why: {proposal.rationale}</p>
          )}
          {amend.fields.map((f, index) => {
            const id = `${fieldId}-${f.name}`;
            const common = {
              id,
              value: draft[f.name] ?? "",
              maxLength: f.maxLength,
              autoFocus: index === 0,
              disabled: busy,
              onKeyDown: onFieldKey,
            };
            return (
              <div key={f.name} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={id} className={f.hideLabel ? "sr-only" : "text-meta font-semibold text-muted-foreground"}>
                  {f.label}
                </label>
                {f.multiline ? (
                  <Textarea {...common} onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))} />
                ) : (
                  <Input {...common} className="h-8" onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))} />
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={busy || !ready} aria-label={`Accept edit to ${subject}`}>
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
        children
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
            data-decision="accept"
            onClick={() => void decide(() => proposalAccept(proposal.id))}
            aria-label={`Accept ${subject}`}
          >
            <Check aria-hidden="true" />
            {busy ? "Saving…" : "Accept"}
          </Button>
          {amend && (
            <Button
              ref={amendRef}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(Object.fromEntries(amend.fields.map((f) => [f.name, f.value])));
                setError(null);
                setMode("amending");
              }}
              aria-label={`Amend ${subject}`}
            >
              <PenLine aria-hidden="true" />
              Amend
            </Button>
          )}
          <Button
            ref={rejectRef}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setWhy("");
              setError(null);
              setMode("rejecting");
            }}
            aria-label={`Reject ${subject}`}
          >
            <Ban aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </>
  );
}

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
  const rootRef = useRef<HTMLDivElement>(null);

  async function afterDecide() {
    // Once decided the ghost unmounts; the keyboard stays on the field, at its Edit button.
    // A field with no Edit (a Done or Dropped Milestone's exit test, issues #132 and #149) takes the focus
    // itself: its `dd` is focusable.
    const dd = rootRef.current?.closest("dd") ?? null;
    const fieldEdit = dd?.previousElementSibling?.querySelector("button") ?? (dd?.hasAttribute("tabindex") ? dd : null);
    await queryClient.invalidateQueries({ queryKey });
    fieldEdit?.focus();
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`Proposed ${label}`}
      data-state="pending"
      className="mt-2.5 flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-primary bg-running-muted px-3 py-2.5"
    >
      <span className="flex items-center gap-1.5 text-meta font-semibold text-running">
        <CircleDashed aria-hidden="true" className="size-3.5" />
        Proposed {label}
      </span>
      <ProposalDecision
        proposal={proposal}
        subject={`the proposed ${label}`}
        amend={{
          fields: [{ name: "text", label: `Your ${label}`, value: text, multiline: true, maxLength: MAX_SPEC_LEN, required: true, hideLabel: true }],
          payload: (values) => amendedPayload(proposal, field, values.text),
        }}
        afterDecide={afterDecide}
      >
        <p className="m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words text-foreground">{text}</p>
        {proposal.rationale && (
          <p className="m-0 max-w-[68ch] text-small break-words text-muted-foreground">Why: {proposal.rationale}</p>
        )}
      </ProposalDecision>
    </div>
  );
}
