/**
 * The roadmap Round on the Roadmap strip (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap",
 * issue #133). Everything here lives inside `RoadmapStrip.tsx`'s card: there is no Roadmap screen.
 *
 * - **Revisit roadmap** (header, outline) starts a roadmap Round and its session. The board stays put:
 *   nothing opens a session on its own (spec §7 click model); the band below offers Open session.
 * - **The band** under the header says where the open Round is, in the Round dock's own vocabulary: the
 *   running tint while the agent reads the Roadmap; the yellow band, and the card's 2px attention edge,
 *   while its session waits on the developer's decisions (Waiting on you); the inset band, with Continue,
 *   once no session is live. Dismiss sits on every state of the band.
 * - **Ghost rows**, one per proposed change, sit under the Milestone they land on (a new Milestone at the
 *   end): the ghost field's dashed primary edge on the running tint, "Proposed", the change in one line
 *   and the agent's why, then Accept, Amend (when the change carries text to edit) and Reject.
 * - **Rejected**, a change shrinks to one struck-through line with the reason, as on the Epic card.
 * - With no open Round, the header carries a quiet line naming how the last one ended: "Roadmap still
 *   holds", dismissed or decided.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, CircleDashed, CircleMinus, Compass, Hand, LoaderCircle, PenLine, RotateCcw, SquareTerminal, X } from "lucide-react";
import {
  proposalAccept,
  proposalAmend,
  proposalReject,
  roadmapRevisit,
  roadmapRoundDismiss,
  roadmapRoundRead,
  type RoadmapProposalDto,
  type RoadmapRoundDto,
} from "../adapters/tauri";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { formatAge } from "../legend/runStatus";
import { prefersReducedMotion } from "../session/FeedRow";
import { useUiStore } from "../state/uiStore";
import { errorText } from "./StoryControls";
import { cn } from "@/lib/utils";

/** The longest rejection reason `proposal_reject` accepts. */
const MAX_REASON_LEN = 500;

/** The open roadmap Round and its Proposals, under the board's key so `board:changed` keeps it live. */
export function useRoadmapRound(projectId: string) {
  return useQuery({ queryKey: ["board", projectId, "roadmap-round"], queryFn: () => roadmapRoundRead(projectId) });
}

/** A Roadmap Proposal's change kind, as `propose_roadmap_change` names it. */
export type RoadmapChangeKind =
  | "create_milestone"
  | "amend_milestone"
  | "reorder_milestone"
  | "retire_milestone"
  | "add_epic"
  | "drop_epic";

export function changeKindOf(p: RoadmapProposalDto): RoadmapChangeKind | null {
  const key = `${p.verb}:${p.targetType}`;
  switch (key) {
    case "create:milestone":
      return "create_milestone";
    case "amend:milestone":
      return "amend_milestone";
    case "reorder:milestone":
      return "reorder_milestone";
    case "retire:milestone":
      return "retire_milestone";
    case "create:epic":
      return "add_epic";
    case "retire:epic":
      return "drop_epic";
    default:
      return null;
  }
}

/** The fields Amend edits for a kind: the text the change carries. A move, a retirement or a drop carries
 * none, so it is accepted or rejected as it is. */
const AMEND_FIELDS: Partial<Record<RoadmapChangeKind, { key: string; label: string; required: boolean }[]>> = {
  create_milestone: [
    { key: "title", label: "Outcome", required: true },
    { key: "exit_test", label: "Exit test", required: false },
  ],
  amend_milestone: [
    { key: "title", label: "Title", required: false },
    { key: "exit_test", label: "Exit test", required: false },
  ],
  add_epic: [
    { key: "title", label: "Title", required: true },
    { key: "problem", label: "Problem", required: false },
  ],
};

/** "Revisit roadmap": starts a roadmap Round, or, while one is open with no live session, Continue. */
export function RevisitRoadmapButton({ projectId }: { projectId: string }) {
  const { start, starting, error } = useRevisit(projectId);
  return (
    <>
      <Button variant="outline" size="sm" disabled={starting} onClick={() => void start()}>
        <Compass aria-hidden="true" />
        {starting ? "Starting…" : "Revisit roadmap"}
      </Button>
      {error && (
        <p role="alert" className="m-0 basis-full text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </>
  );
}

function useRevisit(projectId: string) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      await roadmapRevisit(projectId);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId, "roadmap-round"] });
    } catch (err) {
      setError(`Could not start the roadmap Round: ${errorText(err)}`);
    } finally {
      setStarting(false);
    }
  }
  return { start, starting, error };
}

/** With no open Round: how the last one ended, quietly, in the header. */
export function LastRoundNote({ round, now }: { round: RoadmapRoundDto; now: number }) {
  const words =
    round.state === "dismissed"
      ? `Roadmap Round ${round.number} dismissed`
      : round.proposalsFiled === 0
        ? "Roadmap still holds"
        : `Roadmap Round ${round.number} decided`;
  const age = round.closedAt ? formatAge(round.closedAt, now) : null;
  return (
    <span data-slot="roadmap-last-round" className="min-w-0 truncate text-small text-muted-foreground">
      {words}
      {age && <span className="tabular-nums">{` · ${age}`}</span>}
    </span>
  );
}

/** The open Round's band: where it is, Open session or Continue, and Dismiss. */
export function RoundBand({
  projectId,
  round,
  proposals,
}: {
  projectId: string;
  round: RoadmapRoundDto;
  proposals: RoadmapProposalDto[];
}) {
  const queryClient = useQueryClient();
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const revisit = useRevisit(projectId);
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const waiting = round.waitingOnYou;
  const live = round.sessionLive;
  const pending = proposals.filter((p) => p.state === "pending").length;
  const decided = proposals.length - pending;
  const pulse = live && !waiting && !prefersReducedMotion();

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await roadmapRoundDismiss(round.id);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    } catch (err) {
      setError(`Could not dismiss the Round: ${errorText(err)}`);
      setDismissing(false);
    }
  }

  const status = waiting
    ? `Waiting on you · ${decided} of ${proposals.length} decided`
    : live
      ? proposals.length > 0
        ? `The agent is proposing changes · ${proposals.length} so far`
        : "The agent is reading the Roadmap"
      : "No live session: your decisions are kept";

  return (
    <div
      data-slot="roadmap-round-band"
      data-round-state={waiting ? "waiting" : live ? "running" : "idle"}
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-4 py-2 [&_svg]:shrink-0",
        waiting && "border-attention bg-attention text-attention-foreground",
        !waiting && live && "border-border bg-running-muted text-foreground",
        !waiting && !live && "border-border bg-secondary text-foreground",
      )}
    >
      {waiting ? (
        <Hand aria-hidden="true" size={18} />
      ) : live ? (
        <LoaderCircle aria-hidden="true" size={18} className={cn("text-running", pulse && "agent-pulse")} />
      ) : (
        <Compass aria-hidden="true" size={18} className="text-muted-foreground" />
      )}
      <h3 className="m-0 text-row font-bold">Roadmap Round {round.number}</h3>
      <span className={cn("text-small", waiting ? "text-attention-foreground" : "text-muted-foreground")}>
        {round.triggerLabel}
      </span>
      <span
        role="status"
        className={cn(
          "min-w-0 text-small font-semibold tabular-nums",
          waiting ? "text-attention-foreground" : live ? "text-running" : "text-muted-foreground",
        )}
      >
        {status}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {confirming ? (
          <>
            <span className="text-small font-semibold">
              {pending === 1 ? "Dismissing rejects the undecided change." : `Dismissing rejects the ${pending} undecided changes.`}
            </span>
            <Button size="sm" variant="outline" disabled={dismissing} onClick={() => void dismiss()}>
              <CircleMinus aria-hidden="true" />
              {dismissing ? "Dismissing…" : "Dismiss Round"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={waiting ? "text-attention-foreground hover:bg-attention-foreground/10" : undefined}
              disabled={dismissing}
              onClick={() => {
                setConfirming(false);
                requestAnimationFrame(() => dismissRef.current?.focus());
              }}
            >
              <X aria-hidden="true" />
              Keep it
            </Button>
          </>
        ) : (
          <>
            {live && round.sessionId ? (
              <Button size="sm" variant="outline" onClick={() => setActiveSessionId(round.sessionId, null)}>
                <SquareTerminal aria-hidden="true" />
                Open session
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={revisit.starting} onClick={() => void revisit.start()}>
                <RotateCcw aria-hidden="true" />
                {revisit.starting ? "Starting…" : "Continue"}
              </Button>
            )}
            <Button
              ref={dismissRef}
              size="sm"
              variant="ghost"
              className={waiting ? "text-attention-foreground hover:bg-attention-foreground/10" : undefined}
              disabled={dismissing}
              aria-label={`Dismiss Roadmap Round ${round.number}, changing nothing`}
              onClick={() => (pending > 0 ? setConfirming(true) : void dismiss())}
            >
              <CircleMinus aria-hidden="true" />
              Dismiss
            </Button>
          </>
        )}
      </span>
      {(error ?? revisit.error) && (
        <p role="alert" className="m-0 basis-full text-small break-words text-destructive-text">
          {error ?? revisit.error}
        </p>
      )}
    </div>
  );
}

/** One proposed change: a ghost row, or, rejected, a struck-through line. */
export function GhostRow({ projectId, proposal }: { projectId: string; proposal: RoadmapProposalDto }) {
  if (proposal.state === "rejected") return <RejectedRow proposal={proposal} />;
  if (proposal.state !== "pending") return null;
  return <PendingRow projectId={projectId} proposal={proposal} />;
}

function RejectedRow({ proposal }: { proposal: RoadmapProposalDto }) {
  return (
    <li
      data-slot="roadmap-ghost-row"
      data-state="rejected"
      aria-label={`Rejected: ${proposal.summary}`}
      className="flex min-w-0 flex-col gap-0.5 border-t border-border py-1.5 pr-3 pl-10"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-small text-muted-foreground">
        <Ban aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
        <span className="shrink-0 text-meta font-semibold text-subtle-foreground">Rejected</span>
        <del className="min-w-0 truncate decoration-1" title={proposal.summary}>
          {proposal.summary}
        </del>
      </span>
      <span className="truncate pl-5 text-meta text-subtle-foreground" title={proposal.rejectionReason ?? undefined}>
        {proposal.rejectionReason ? `Your reason: ${proposal.rejectionReason}` : "No reason given"}
      </span>
    </li>
  );
}

type Mode = "idle" | "amending" | "rejecting";

function payloadOf(proposal: RoadmapProposalDto): Record<string, unknown> {
  return proposal.payload && typeof proposal.payload === "object" ? { ...(proposal.payload as Record<string, unknown>) } : {};
}

function PendingRow({ projectId, proposal }: { projectId: string; proposal: RoadmapProposalDto }) {
  const queryClient = useQueryClient();
  const kind = changeKindOf(proposal);
  const fields = kind ? AMEND_FIELDS[kind] : undefined;
  const reasonId = useId();
  const fieldIds = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amendRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  async function decide(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Once decided the row changes under the focus: keep the keyboard on the strip, at its next row.
    const next = rowRef.current?.nextElementSibling?.querySelector<HTMLElement>("button") ?? null;
    try {
      await write();
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      setMode("idle");
      next?.focus();
    } catch (err) {
      setError(`Could not decide "${proposal.summary}": ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function openAmend() {
    const payload = payloadOf(proposal);
    setDraft(Object.fromEntries((fields ?? []).map((f) => [f.key, typeof payload[f.key] === "string" ? (payload[f.key] as string) : ""])));
    setError(null);
    setMode("amending");
  }

  function submitAmend(event: FormEvent) {
    event.preventDefault();
    if (!fields || fields.some((f) => f.required && !draft[f.key]?.trim())) return;
    const payload = payloadOf(proposal);
    for (const f of fields) {
      const text = draft[f.key]?.trim() ?? "";
      payload[f.key] = text === "" ? null : text;
    }
    void decide(() => proposalAmend(proposal.id, payload));
  }

  function cancel() {
    const opener = mode === "amending" ? amendRef : rejectRef;
    setMode("idle");
    setError(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  const amendable = !!fields;
  const canSubmitAmend = !!fields && fields.every((f) => !f.required || !!draft[f.key]?.trim());

  return (
    <li ref={rowRef} data-slot="roadmap-ghost-row" data-state="pending" data-kind={kind ?? undefined} className="border-t border-border px-2 py-1.5">
      <div
        role="group"
        aria-label={`Proposed: ${proposal.summary}`}
        className="flex min-w-0 flex-col gap-1.5 rounded-md border border-dashed border-primary bg-running-muted py-2 pr-2 pl-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex shrink-0 items-center gap-1.5 text-meta font-semibold text-running">
            <CircleDashed aria-hidden="true" className="size-3.5" />
            Proposed
          </span>
          <span className="min-w-0 flex-1 basis-60 text-row font-semibold break-words text-foreground">{proposal.summary}</span>
          {mode === "idle" && (
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label={`Accept: ${proposal.summary}`}
                onClick={() => void decide(() => proposalAccept(proposal.id))}
              >
                <Check aria-hidden="true" />
                {busy ? "Saving…" : "Accept"}
              </Button>
              {amendable && (
                <Button ref={amendRef} variant="ghost" size="sm" disabled={busy} aria-label={`Amend: ${proposal.summary}`} onClick={openAmend}>
                  <PenLine aria-hidden="true" />
                  Amend
                </Button>
              )}
              <Button
                ref={rejectRef}
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Reject: ${proposal.summary}`}
                onClick={() => {
                  setWhy("");
                  setError(null);
                  setMode("rejecting");
                }}
              >
                <Ban aria-hidden="true" />
                Reject
              </Button>
            </span>
          )}
        </div>
        {proposal.rationale && (
          <p className="m-0 max-w-[68ch] text-small break-words text-muted-foreground">Why: {proposal.rationale}</p>
        )}

        {mode === "amending" && fields && (
          <form
            className="flex max-w-[68ch] min-w-0 flex-col gap-2 pt-1"
            onSubmit={submitAmend}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancel();
              }
            }}
          >
            {fields.map((f, i) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${fieldIds}-${f.key}`} className="text-meta font-semibold text-muted-foreground">
                  {f.required ? f.label : `${f.label} (optional)`}
                </label>
                <Input
                  id={`${fieldIds}-${f.key}`}
                  value={draft[f.key] ?? ""}
                  autoFocus={i === 0}
                  disabled={busy}
                  className="h-7.5 bg-card"
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="outline" size="sm" disabled={busy || !canSubmitAmend}>
                <Check aria-hidden="true" />
                {busy ? "Saving…" : "Accept edit"}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </form>
        )}

        {mode === "rejecting" && (
          <form
            className="flex min-w-0 flex-wrap items-center gap-2 pt-1"
            onSubmit={(event) => {
              event.preventDefault();
              const given = why.trim();
              void decide(() => proposalReject(proposal.id, given === "" ? null : given));
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
              className="h-7.5 min-w-48 flex-1 bg-card"
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

        {error && (
          <p role="alert" className="m-0 text-small break-words text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
