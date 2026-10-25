/**
 * The parts every Proposal is drawn and decided with (issue #211), wherever it lands: a spec field's ghost
 * (`GhostCard`), a Story column, a criterion, a move or retirement plate (`StoryColumns`), a Roadmap ghost row
 * (`board/RoadmapRound`), the triage drawer and a judged-on change (through `ProposalDecision`).
 *
 * - `DecisionGroup`: Accept, Amend, Reject, in that order, as one outline Button Group at the small size. The
 *   pressed decision shows `loading`; the others are off until it lands. Amend is left out when the Proposal
 *   carries no text to edit.
 * - `RejectReasonForm`: the one-line "Why not? (optional)" field a Reject opens, with Reject and Cancel.
 * - `ProposedBadge` / `RejectedBadge`: the running-tint "Proposed …" pill and the neutral "Rejected" pill.
 * - `RejectedLine`: a rejected Proposal shrunk to a struck-through line and the Developer's reason.
 * - `OrderChip`: a number in a square chip (a question's, a Story column's order), ink or a dashed ghost.
 * - `announceDecision`: the toast that says what a decision did (DESIGN.md § Feedback).
 * - `useSettle`: the short running-tint cross-fade on a field whose text an accepted Proposal just rewrote.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Ban, Check, CircleDashed, PenLine, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/** The longest rejection reason `proposal_reject` accepts. */
export const MAX_REASON_LEN = 500;

export type Decision = "accept" | "amend" | "reject";

export interface DecisionGroupProps {
  /** How each button is named to assistive tech: `(verb) => "Accept the proposed Scope"`. */
  name: (verb: string) => string;
  /** The decision under way, if any: its button is `loading`, the others are off. */
  pending: Decision | null;
  onAccept: () => void;
  /** Left out when the Proposal carries no text to edit (a move, a retirement, a dropped Epic). */
  onAmend?: () => void;
  onReject: () => void;
  /** Amend's word: "Edit" on a judged-on change (issue #163). */
  amendWord?: string;
  amendRef?: Ref<HTMLButtonElement>;
  rejectRef?: Ref<HTMLButtonElement>;
  className?: string;
}

/** Accept, Amend and Reject: one Button Group, the same order and size on every Proposal. */
export function DecisionGroup({
  name,
  pending,
  onAccept,
  onAmend,
  onReject,
  amendWord = "Amend",
  amendRef,
  rejectRef,
  className,
}: DecisionGroupProps) {
  const off = (decision: Decision) => pending !== null && pending !== decision;
  return (
    <ButtonGroup aria-label={name("Decide")} className={cn("shrink-0", className)}>
      <Button
        variant="outline"
        size="sm"
        data-decision="accept"
        loading={pending === "accept"}
        disabled={off("accept")}
        aria-label={name("Accept")}
        onClick={onAccept}
      >
        <Check aria-hidden="true" />
        Accept
      </Button>
      {onAmend && (
        <Button
          ref={amendRef}
          variant="outline"
          size="sm"
          data-decision="amend"
          disabled={pending !== null}
          aria-label={name(amendWord)}
          onClick={onAmend}
        >
          <PenLine aria-hidden="true" />
          {amendWord}
        </Button>
      )}
      <Button
        ref={rejectRef}
        variant="outline"
        size="sm"
        data-decision="reject"
        disabled={pending !== null}
        aria-label={name("Reject")}
        onClick={onReject}
      >
        <Ban aria-hidden="true" />
        Reject
      </Button>
    </ButtonGroup>
  );
}

/** Under an open Amend: Accept edit (pending while it saves; off until `ready`), Cancel and the ⌘↩ hint. */
export function AmendActions({
  busy,
  ready,
  subject,
  onCancel,
}: {
  busy: boolean;
  ready: boolean;
  subject: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="outline" size="sm" loading={busy} disabled={!busy && !ready} aria-label={`Accept edit to ${subject}`}>
        <Check aria-hidden="true" />
        Accept edit
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
        <X aria-hidden="true" />
        Cancel
      </Button>
      <Kbd className="ml-auto">⌘↩</Kbd>
    </div>
  );
}

/** The "Why not? (optional)" field a Reject opens; Escape cancels, an empty reason sends none. */
export function RejectReasonForm({
  busy,
  onReject,
  onCancel,
  stacked = false,
  className,
  inputClassName,
}: {
  busy: boolean;
  onReject: (why: string | null) => void;
  onCancel: () => void;
  /** The field over its buttons, for a narrow column; beside them otherwise. */
  stacked?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const reasonId = useId();
  const [why, setWhy] = useState("");
  return (
    <form
      className={cn("flex min-w-0 gap-2", stacked ? "flex-col" : "flex-wrap items-center", className)}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const given = why.trim();
        onReject(given === "" ? null : given);
      }}
    >
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
        className={cn("h-7.5", !stacked && "min-w-48 flex-1", inputClassName)}
        onChange={(e) => setWhy(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <span className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="sm" loading={busy}>
          <Ban aria-hidden="true" />
          Reject
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </span>
    </form>
  );
}

/** "Proposed Scope", "Proposed Story", "Proposed move": the running-tint pill a pending Proposal wears. */
export function ProposedBadge({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <Badge variant="running" className="h-5.5 self-start px-2 text-meta">
      {icon ?? <CircleDashed aria-hidden="true" />}
      {children}
    </Badge>
  );
}

/** "Rejected": a decided Proposal's neutral pill. */
export function RejectedBadge() {
  return (
    <Badge variant="neutral" className="h-5 px-1.5 text-meta text-muted-foreground">
      <Ban aria-hidden="true" />
      Rejected
    </Badge>
  );
}

/** A rejected Proposal: its pill, the text struck through, then the Developer's reason. */
export function RejectedLine({
  label,
  struck,
  reason,
  as: Tag = "div",
  className,
  ...data
}: {
  label: string;
  struck: string;
  reason: string | null;
  as?: "div" | "li";
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const body = (
    <div role="group" aria-label={label} data-state="rejected" className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2 text-small text-muted-foreground">
        <RejectedBadge />
        <del className="min-w-0 truncate decoration-1" title={struck}>
          {struck}
        </del>
      </span>
      <span className="truncate text-meta text-subtle-foreground" title={reason ?? undefined}>
        {reason ? `Your reason: ${reason}` : "No reason given"}
      </span>
    </div>
  );
  // In a list the item stays a list item, with the named group inside it.
  return Tag === "li" ? (
    <li aria-label={label} data-state="rejected" className={cn("min-w-0", className)} {...data}>
      {body}
    </li>
  ) : (
    <div className={cn("min-w-0", className)} {...data}>
      {body}
    </div>
  );
}

/**
 * A number in a square chip: a question's number, a Story column's place in the order. `ink` for one still to
 * answer or a Story on the record, `ghost` (dashed brand edge) for a pending Story, `quiet` once answered.
 */
export function OrderChip({ number, tone = "ink" }: { number: number; tone?: "ink" | "ghost" | "quiet" }) {
  return (
    <Badge
      aria-hidden="true"
      data-tone={tone}
      variant={tone === "ghost" ? "outline" : tone === "quiet" ? "secondary" : "default"}
      className={cn(
        "size-5 rounded-sm px-0 text-meta tabular-nums",
        tone === "ink" && "bg-foreground text-card",
        tone === "ghost" && "border-dashed border-primary text-running",
        tone === "quiet" && "text-muted-foreground",
      )}
    >
      {number}
    </Badge>
  );
}

/** What a decision did, as a toast: "Accepted the proposed Scope". */
export function announceDecision(decision: Decision | "edit", subject: string) {
  const words = { accept: "Accepted", amend: "Accepted your edit to", edit: "Accepted your edit to", reject: "Rejected" } as const;
  notify.success(`${words[decision]} ${subject}`);
}

/**
 * A field whose text just changed under it (an accepted Proposal landed): `true` for one frame, so the field
 * takes the running tint at once and cross-fades back to its ground on the overlay duration. Colour only, so
 * reduced motion keeps it. A change the Developer made by hand is marked with `own()` first and not tinted.
 */
export function useSettle(value: unknown) {
  const [settling, setSettling] = useState(false);
  const first = useRef(true);
  const own = useRef(false);
  const previous = useRef(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    if (own.current) {
      own.current = false;
      return;
    }
    setSettling(true);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettling(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [value]);
  return {
    settling,
    /** Call before saving the Developer's own edit: that change is not tinted. */
    own: () => {
      own.current = true;
    },
    className: cn(
      "-mx-1.5 rounded-sm px-1.5 transition-colors ease-(--ease)",
      settling ? "bg-running-muted duration-0" : "duration-(--duration-overlay)",
    ),
  };
}
