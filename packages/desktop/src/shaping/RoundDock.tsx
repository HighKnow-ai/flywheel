/**
 * The dock (docs/mvp-spec.md §3, issue #123): where the developer answers the shaping agent's Rounds,
 * beside the Epic card.
 *
 * The current Round heads the dock: its number, the agent's one-paragraph note, then its numbered
 * questions ([`QuestionCard`]), each with the recommended answer already filled in. While the session that
 * posted it is held on it, the Round is Waiting on you and wears the request card's frame: the attention
 * edge and the yellow band, as the session feed's question card does (#100). Under its note, a bar that
 * stays on screen while the questions scroll carries the one filled action of the region, Accept all
 * recommended, which answers every question still open with the
 * agent's recommendation (questions only: it never decides a Proposal), beside the count answered. An ADR
 * offered in the Round (issue #129) is left out of it: its Yes accepts a Proposal, so each ADR is answered on
 * its own, the hint says so, and the button is off once only ADRs are left open.
 *
 * Every answer is its own write: the dock never batches, so an answer is on the board the moment it is
 * given, and the agent receives them all once the last one lands. Earlier Rounds follow, folded.
 *
 * A Round outlives its session (issue #124). An open Round no live session is held on wears the inset band,
 * never yellow: it is not Waiting on you, though the dock still takes every answer. With no shaping session
 * live, the band carries Continue shaping, which starts a fresh session that picks this Round up; while a
 * fresh session is reading, before its `round_wait` takes the Round over, the band says so instead.
 *
 * The same dock shapes a Milestone's exit test (issue #132): the view passes its own Continue shaping as
 * `resume` and names its record with `subject`.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Hand, MessagesSquare } from "lucide-react";
import { roundAccept, roundAcceptAll, roundAnswer, type EpicDto, type RoundDto, type StageDto } from "../adapters/tauri";
import { ContinueShapingButton } from "../board/EpicShapingControl";
import { QuestionCard } from "./QuestionCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The Stage names as the developer reads them (GLOSSARY.md "Stage"). */
export const STAGE_LABELS: Record<string, string> = {
  challenge_spec: "Challenge the spec",
  slice: "Slice into Stories",
  criteria: "Write the Acceptance criteria",
  exit_test: "Exit test",
};

export interface RoundDockProps {
  /** Every Round of the record, oldest first. */
  rounds: RoundDto[];
  /**
   * The open Stage (issue #126): only one of its Rounds is current, so a Stage just opened starts with no
   * Round, and the closed Stages' Rounds are earlier ones, named with their Stage. Left out, the newest Round
   * is current.
   */
  openStage?: StageDto | null;
  /** Whether a shaping session is live on the record: before its first Round, it is reading. */
  sessionLive: boolean;
  /** The project and the Epic being shaped, for Continue shaping on an open Round with no live session. */
  projectId: string;
  /** The Epic being shaped; left out when `resume` is given (a Milestone, issue #132). */
  epic?: Pick<EpicDto, "id" | "key" | "title">;
  /** Continue shaping for the band of an open Round with no live session; the Epic's by default. */
  resume?: React.ReactNode;
  /** The record being shaped, as the empty dock names it. */
  subject?: "Epic" | "Milestone";
  /** The query to refetch once an answer is stored. */
  queryKey: readonly unknown[];
  /** Which Rounds to draw: the current one, the earlier ones, or all of them (default). */
  show?: "current" | "earlier" | "all";
  /** Every Stage of the record is closed (issue #128): shaping is done, and the dock waits for no Round. */
  done?: boolean;
  className?: string;
}

function reason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function RoundDock({
  rounds,
  openStage,
  sessionLive,
  projectId,
  epic,
  resume,
  subject = "Epic",
  queryKey,
  show = "all",
  done = false,
  className,
}: RoundDockProps) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const newest = rounds[rounds.length - 1];
  const current = newest && (openStage === undefined || newest.stageId === openStage?.id) ? newest : null;
  const earlier = (current ? rounds.slice(0, -1) : rounds).slice().reverse();
  // A Round of a Stage already closed is named with its Stage: each Stage numbers its Rounds from 1.
  const closedStage = (round: RoundDto) => openStage !== undefined && round.stageId !== openStage?.id;
  const accept = async (id: string) => {
    await roundAccept(id);
    await refresh();
  };
  const answer = async (id: string, text: string) => {
    await roundAnswer(id, text);
    await refresh();
  };
  const card = (round: RoundDto) => (
    <RoundCard
      key={round.id}
      round={round}
      sessionLive={sessionLive}
      resume={resume ?? (epic ? <ContinueShapingButton projectId={projectId} epic={epic} /> : null)}
      stageShown={closedStage(round)}
      onAccept={accept}
      onAnswer={answer}
      onAcceptAll={refresh}
    />
  );

  if (show === "earlier") {
    if (earlier.length === 0) return null;
    return <div className={cn("flex min-w-0 flex-col gap-4", className)}>{earlier.map(card)}</div>;
  }
  // Issue #128: once every Stage is closed no Round is to come, so there is no current Round to wait for.
  if (done && !current && show === "current") return null;
  const stageName = openStage && earlier.length > 0 ? ` in ${STAGE_LABELS[openStage.kind] ?? openStage.kind}` : "";
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      {current ? (
        card(current)
      ) : (
        <section
          aria-label="Rounds"
          className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-5 py-6 shadow-card"
        >
          <h2 className="m-0 text-section font-semibold">No Round yet{stageName}</h2>
          <p className="m-0 max-w-[60ch] text-body text-muted-foreground">
            {sessionLive
              ? subject === "Milestone"
                ? "The agent is reading the Milestone, the Roadmap around it and the code they touch. Its first Round lands here."
                : "The agent is reading the Epic and the code it touches. Its first Round lands here."
              : earlier.length > 0
                ? "No session is working this Stage. Continue shaping starts one; its first Round lands here."
                : `Shape this ${subject} to start a shaping session. The agent's first Round lands here.`}
          </p>
        </section>
      )}
      {show === "all" && earlier.map(card)}
    </div>
  );
}

function RoundCard({
  round,
  sessionLive,
  resume,
  stageShown,
  onAccept,
  onAnswer,
  onAcceptAll,
}: {
  round: RoundDto;
  sessionLive: boolean;
  /** Continue shaping, drawn on the band of an open Round with no live shaping session. */
  resume: React.ReactNode;
  /** Name the Round's Stage beside its number: it belongs to a Stage already closed. */
  stageShown: boolean;
  onAccept: (id: string) => Promise<void>;
  onAnswer: (id: string, text: string) => Promise<void>;
  onAcceptAll: () => Promise<unknown>;
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = round.state === "open";
  // The core's derivation: open with a LIVE session held on it (issue #124).
  const waiting = open && round.waitingOnYou;
  const total = round.questions.length;
  const answered = round.questions.filter((q) => q.answer !== null).length;
  const isAdr = (q: RoundDto["questions"][number]) => q.kind === "adr";
  const openPlain = round.questions.filter((q) => q.answer === null && !isAdr(q)).length;
  const openAdrs = round.questions.filter((q) => q.answer === null && isAdr(q)).length;
  const stage = STAGE_LABELS[round.stageKind] ?? round.stageKind;
  const headingId = `round-${round.id}`;

  async function acceptAll() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await roundAcceptAll(round.id);
      await onAcceptAll();
    } catch (err) {
      setError(`Could not accept the recommended answers: ${reason(err)}`);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-round-state={round.state}
      className={cn(
        "min-w-0 overflow-clip rounded-lg bg-card shadow-card",
        waiting ? "border-2 border-attention" : "border border-border",
      )}
    >
      <header
        className={cn(
          "flex min-h-11 items-center gap-2.5 px-4 py-2.5 [&_svg]:size-[18px] [&_svg]:shrink-0",
          waiting ? "bg-attention text-attention-foreground" : "border-b border-border bg-secondary text-foreground",
        )}
      >
        {waiting ? <Hand aria-hidden="true" /> : <MessagesSquare aria-hidden="true" className="text-muted-foreground" />}
        <h2 id={headingId} className="m-0 min-w-0 truncate text-row font-bold">
          Round {round.number}
          {stageShown ? (
            <span className="font-semibold text-muted-foreground"> · {stage}</span>
          ) : (
            <span className="sr-only">, {stage}</span>
          )}
        </h2>
        <span className={cn("ml-auto min-w-0 text-right text-small font-semibold", !waiting && "text-muted-foreground")}>
          {waiting
            ? "Waiting on you"
            : !open
              ? "Answered"
              : sessionLive
                ? "The agent is reading your answers and picks this Round up"
                : "No live session: your answers are kept"}
        </span>
        {open && !waiting && !sessionLive && resume}
      </header>
      {open && <p className="m-0 px-4 pt-3 pb-1 text-body break-words">{round.note}</p>}
      {open && (
        // The Round's one filled action, kept on screen while the questions scroll under it.
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-4 py-3">
          <Button onClick={() => void acceptAll()} disabled={accepting || openPlain === 0}>
            <CheckCheck aria-hidden="true" />
            {accepting ? "Accepting…" : "Accept all recommended"}
          </Button>
          <span className="text-small font-semibold tabular-nums">
            {answered} of {total} answered
          </span>
          <span className="min-w-0 text-small text-muted-foreground">
            {openAdrs > 0 && openPlain === 0
              ? openAdrs === 1
                ? "Only the ADR is left: answer it Yes or No."
                : `Only the ${openAdrs} ADRs are left: answer each Yes or No.`
              : openAdrs > 0
                ? openAdrs === 1
                  ? "The ADR is answered on its own: Accept all leaves it open."
                  : `Each ADR is answered on its own: Accept all leaves these ${openAdrs} open.`
                : waiting
                ? "The agent goes on once every question is answered."
                : "Every answer is saved as you give it."}
          </span>
          {error && (
            <p role="alert" className="m-0 w-full text-small break-words text-destructive-text">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        {round.questions.map((q) => (
          <QuestionCard key={q.id} question={q} open={open} onAccept={onAccept} onAnswer={onAnswer} />
        ))}
      </div>
    </section>
  );
}
