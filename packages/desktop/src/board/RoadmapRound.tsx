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
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleMinus, Compass, Hand, ListPlus, LoaderCircle, RotateCcw, SquareTerminal, X } from "lucide-react";
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
import {
  AmendActions,
  DecisionGroup,
  ProposedBadge,
  RejectReasonForm,
  RejectedLine,
  announceDecision,
  type Decision,
} from "../shaping/ProposalParts";
import { errorText } from "./StoryControls";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Where the keyboard goes once the strip has re-read after a decision, a start or a dismissal: the next
 * undecided change after the one just decided (in the order before the decision, wrapping), else the band's
 * first action, else Revisit roadmap, else the strip's heading. Never a Milestone row's move handle, where
 * the arrow keys would reorder the Roadmap.
 */
function focusInStrip(strip: Element | null, order: string[] = [], decided: string | null = null) {
  requestAnimationFrame(() => {
    const root = strip ?? document.querySelector("[data-slot=roadmap-strip]");
    if (!root) return;
    const pending = [...root.querySelectorAll<HTMLElement>("[data-slot=roadmap-ghost-row][data-state=pending]")].filter(
      (row) => row.dataset.proposalId !== decided,
    );
    const at = decided ? order.indexOf(decided) : -1;
    const next = pending.find((row) => order.indexOf(row.dataset.proposalId ?? "") > at) ?? pending[0] ?? null;
    const target =
      next?.querySelector<HTMLElement>("button") ??
      root.querySelector<HTMLElement>("[data-slot=roadmap-round-band] button") ??
      root.querySelector<HTMLElement>("[data-slot=roadmap-revisit]") ??
      root.querySelector<HTMLElement>("h2");
    target?.focus();
  });
}

/** The open roadmap Round and its Proposals, under the board's key so `board:changed` keeps it live. */
export function useRoadmapRound(projectId: string) {
  return useQuery({ queryKey: ["board", projectId, "roadmap-round"], queryFn: () => roadmapRoundRead(projectId) });
}

/** A Roadmap Proposal's change kind, as `propose_roadmap_change` names it. */
export type RoadmapChangeKind =
  "create_milestone" | "amend_milestone" | "reorder_milestone" | "retire_milestone" | "add_epic" | "drop_epic";

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
      <Button variant="outline" size="sm" data-slot="roadmap-revisit" loading={starting} onClick={() => void start()}>
        <Compass aria-hidden="true" />
        Revisit roadmap
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
      notify.success("Started a roadmap Round");
      await queryClient.invalidateQueries({ queryKey: ["board", projectId, "roadmap-round"] });
      // Revisit roadmap gives way to the band: the keyboard follows it, onto Open session.
      focusInStrip(null);
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
  const keepRef = useRef<HTMLButtonElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const warningId = useId();
  const waiting = round.waitingOnYou;
  const live = round.sessionLive;
  const pending = proposals.filter((p) => p.state === "pending").length;
  const decided = proposals.length - pending;
  const pulse = live && !waiting && !prefersReducedMotion();
  const noted = round.notedTriggers ?? [];

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      const strip = bandRef.current?.closest("[data-slot=roadmap-strip]") ?? null;
      await roadmapRoundDismiss(round.id);
      notify.success(`Dismissed Roadmap Round ${round.number}`);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      // The band is gone: back to Revisit roadmap.
      focusInStrip(strip);
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
      ref={bandRef}
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
            <span id={warningId} role="alert" className="text-small font-semibold">
              {pending === 1
                ? "Dismissing rejects the undecided change."
                : `Dismissing rejects the ${pending} undecided changes.`}
            </span>
            <Button
              size="sm"
              variant="outline"
              aria-describedby={warningId}
              loading={dismissing}
              onClick={() => void dismiss()}
            >
              <CircleMinus aria-hidden="true" />
              Dismiss Round
            </Button>
            <Button
              ref={keepRef}
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
              <Button size="sm" variant="outline" loading={revisit.starting} onClick={() => void revisit.start()}>
                <RotateCcw aria-hidden="true" />
                Continue
              </Button>
            )}
            <Button
              ref={dismissRef}
              size="sm"
              variant="ghost"
              className={waiting ? "text-attention-foreground hover:bg-attention-foreground/10" : undefined}
              disabled={dismissing}
              aria-label={
                pending > 0
                  ? `Dismiss Roadmap Round ${round.number}, rejecting ${pending} undecided change${pending === 1 ? "" : "s"}`
                  : `Dismiss Roadmap Round ${round.number}`
              }
              onClick={() => {
                if (pending === 0) {
                  void dismiss();
                  return;
                }
                setConfirming(true);
                // The safe answer takes the focus, and the warning is read with it.
                requestAnimationFrame(() => keepRef.current?.focus());
              }}
            >
              <CircleMinus aria-hidden="true" />
              Dismiss
            </Button>
          </>
        )}
      </span>
      {/* Issue #134: a Done confirmed while this Round was open opened no Round of its own. */}
      {noted.length > 0 && (
        <p
          data-slot="roadmap-noted-triggers"
          className={cn(
            "m-0 flex min-w-0 basis-full items-start gap-1.5 text-small",
            waiting ? "text-attention-foreground" : "text-muted-foreground",
          )}
        >
          <ListPlus aria-hidden="true" className="mt-px size-4" />
          <span className="min-w-0">
            <span className="font-semibold">Also noted: {noted.join(" · ")}.</span>{" "}
            {`${live ? "The session at work started before; " : ""}${live ? "the" : "The"} Round's next session reads ${noted.length === 1 ? "it" : "them"}.`}
          </span>
        </p>
      )}
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
    <RejectedLine
      as="li"
      data-slot="roadmap-ghost-row"
      label={`Rejected: ${proposal.summary}`}
      struck={proposal.summary}
      reason={proposal.rejectionReason}
      className="border-t border-border py-1.5 pr-3 pl-10"
    />
  );
}

type Mode = "idle" | "amending" | "rejecting";

function payloadOf(proposal: RoadmapProposalDto): Record<string, unknown> {
  return proposal.payload && typeof proposal.payload === "object"
    ? { ...(proposal.payload as Record<string, unknown>) }
    : {};
}

function PendingRow({ projectId, proposal }: { projectId: string; proposal: RoadmapProposalDto }) {
  const queryClient = useQueryClient();
  const kind = changeKindOf(proposal);
  const fields = kind ? AMEND_FIELDS[kind] : undefined;
  const fieldIds = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Decision | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const amendRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  async function decide(decision: Decision, write: () => Promise<void>) {
    if (busy) return;
    setPending(decision);
    setError(null);
    // Once decided the row changes under the focus: keep the keyboard on the strip, at the next undecided change.
    const strip = rowRef.current?.closest("[data-slot=roadmap-strip]") ?? null;
    const order = strip
      ? [...strip.querySelectorAll<HTMLElement>("[data-slot=roadmap-ghost-row][data-state=pending]")].map(
          (r) => r.dataset.proposalId ?? "",
        )
      : [];
    try {
      await write();
      announceDecision(decision, proposal.summary);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      setMode("idle");
      focusInStrip(strip, order, proposal.id);
    } catch (err) {
      setError(`Could not decide "${proposal.summary}": ${errorText(err)}`);
    } finally {
      setPending(null);
    }
  }

  function openAmend() {
    const payload = payloadOf(proposal);
    setDraft(
      Object.fromEntries(
        (fields ?? []).map((f) => [f.key, typeof payload[f.key] === "string" ? (payload[f.key] as string) : ""]),
      ),
    );
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
    void decide("amend", () => proposalAmend(proposal.id, payload));
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
    <li
      ref={rowRef}
      data-slot="roadmap-ghost-row"
      data-state="pending"
      data-proposal-id={proposal.id}
      data-kind={kind ?? undefined}
      className="@container border-t border-border px-2 py-1.5"
    >
      <div
        role="group"
        aria-label={`Proposed: ${proposal.summary}`}
        className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1.5 rounded-md border border-dashed border-primary bg-running-muted py-2 pr-2 pl-3 @[40rem]:grid-cols-[minmax(0,1fr)_auto]"
      >
        {/* Reading order: the change, then why, then the decisions, as on the Epic card's ghost field. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 @[40rem]:col-start-1">
          <span className="shrink-0 self-center">
            <ProposedBadge>Proposed</ProposedBadge>
          </span>
          <span className="min-w-0 flex-1 basis-60 text-row font-semibold break-words text-foreground">
            {proposal.summary}
          </span>
        </div>
        {proposal.rationale && (
          <p className="m-0 max-w-[68ch] text-small break-words text-muted-foreground @[40rem]:col-start-1">
            Why: {proposal.rationale}
          </p>
        )}
        {mode === "idle" && (
          <DecisionGroup
            name={(verb) => `${verb}: ${proposal.summary}`}
            pending={pending}
            amendRef={amendRef}
            rejectRef={rejectRef}
            className="self-start @[40rem]:col-start-2 @[40rem]:row-span-2 @[40rem]:row-start-1"
            onAccept={() => void decide("accept", () => proposalAccept(proposal.id))}
            onAmend={amendable ? openAmend : undefined}
            onReject={() => {
              setError(null);
              setMode("rejecting");
            }}
          />
        )}

        {mode === "amending" && fields && (
          <form
            className="flex max-w-[68ch] min-w-0 flex-col gap-2 pt-1 @[40rem]:col-span-2"
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
                <Label htmlFor={`${fieldIds}-${f.key}`} className="text-meta font-semibold text-muted-foreground">
                  {f.required ? f.label : `${f.label} (optional)`}
                </Label>
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
            <AmendActions busy={busy} ready={canSubmitAmend} subject={proposal.summary} onCancel={cancel} />
          </form>
        )}

        {mode === "rejecting" && (
          <RejectReasonForm
            busy={busy}
            className="pt-1 @[40rem]:col-span-2"
            inputClassName="bg-card"
            onReject={(why) => void decide("reject", () => proposalReject(proposal.id, why))}
            onCancel={cancel}
          />
        )}

        {error && (
          <p role="alert" className="m-0 text-small break-words text-destructive-text @[40rem]:col-span-2">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
