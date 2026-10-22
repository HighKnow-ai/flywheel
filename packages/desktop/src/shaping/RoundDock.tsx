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
 * agent's recommendation (questions only: it never decides a Proposal), beside the count answered.
 *
 * Every answer is its own write: the dock never batches, so an answer is on the board the moment it is
 * given, and the agent receives them all once the last one lands. Earlier Rounds follow, folded.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Hand, MessagesSquare } from "lucide-react";
import { roundAccept, roundAcceptAll, roundAnswer, type RoundDto } from "../adapters/tauri";
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
  /** Whether a shaping session is live on the record: before its first Round, it is reading. */
  sessionLive: boolean;
  /** The query to refetch once an answer is stored. */
  queryKey: readonly unknown[];
  /** Which Rounds to draw: the current one, the earlier ones, or all of them (default). */
  show?: "current" | "earlier" | "all";
  className?: string;
}

function reason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function RoundDock({ rounds, sessionLive, queryKey, show = "all", className }: RoundDockProps) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  if (rounds.length === 0) {
    if (show === "earlier") return null;
    return (
      <section
        aria-label="Rounds"
        className={cn("flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-5 py-6 shadow-card", className)}
      >
        <h2 className="m-0 text-section font-semibold">No Round yet</h2>
        <p className="m-0 max-w-[60ch] text-body text-muted-foreground">
          {sessionLive
            ? "The agent is reading the Epic and the code it touches. Its first Round lands here."
            : "Shape this Epic to start a shaping session. The agent's first Round lands here."}
        </p>
      </section>
    );
  }

  const current = rounds[rounds.length - 1];
  const earlier = rounds.slice(0, -1).reverse();
  const accept = async (id: string) => {
    await roundAccept(id);
    await refresh();
  };
  const answer = async (id: string, text: string) => {
    await roundAnswer(id, text);
    await refresh();
  };

  if (show === "earlier") {
    if (earlier.length === 0) return null;
    return (
      <div className={cn("flex min-w-0 flex-col gap-4", className)}>
        {earlier.map((round) => (
          <RoundCard key={round.id} round={round} onAccept={accept} onAnswer={answer} onAcceptAll={refresh} />
        ))}
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <RoundCard round={current} onAccept={accept} onAnswer={answer} onAcceptAll={refresh} />
      {show === "all" &&
        earlier.map((round) => (
          <RoundCard key={round.id} round={round} onAccept={accept} onAnswer={answer} onAcceptAll={refresh} />
        ))}
    </div>
  );
}

function RoundCard({
  round,
  onAccept,
  onAnswer,
  onAcceptAll,
}: {
  round: RoundDto;
  onAccept: (id: string) => Promise<void>;
  onAnswer: (id: string, text: string) => Promise<void>;
  onAcceptAll: () => Promise<unknown>;
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = round.state === "open";
  const waiting = open && round.held;
  const total = round.questions.length;
  const answered = round.questions.filter((q) => q.answer !== null).length;
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
          <span className="sr-only">, {stage}</span>
        </h2>
        <span className={cn("ml-auto shrink-0 text-small font-semibold", !waiting && "text-muted-foreground")}>
          {waiting ? "Waiting on you" : open ? "No live session: your answers are kept" : "Answered"}
        </span>
      </header>
      {open && <p className="m-0 px-4 pt-3 pb-1 text-body break-words">{round.note}</p>}
      {open && (
        // The Round's one filled action, kept on screen while the questions scroll under it.
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-4 py-3">
          <Button onClick={() => void acceptAll()} disabled={accepting || answered === total}>
            <CheckCheck aria-hidden="true" />
            {accepting ? "Accepting…" : "Accept all recommended"}
          </Button>
          <span className="text-small font-semibold tabular-nums">
            {answered} of {total} answered
          </span>
          <span className="min-w-0 text-small text-muted-foreground">
            {waiting ? "The agent goes on once every question is answered." : "Every answer is saved as you give it."}
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
