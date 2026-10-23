/**
 * Confirm exit test (docs/mvp-spec.md §3, issue #134): the developer's minimal control for closing an Epic
 * or a Milestone. It shows on an Epic card once every Story is Merged or Dropped, and on a Milestone's row
 * and header once every Epic is Done. #61 lists it in Needs you later.
 *
 * - **Confirm exit test** opens an AlertDialog that quotes the exit test and says what confirming starts:
 *   Done is final, and the click is also the consent to a roadmap Round (Epic #60): a short one on the
 *   Epic's Milestone, or a Roadmap Round for a Milestone. With a Round already open, it says the trigger is
 *   noted on that one instead. Confirm Done is the dialog's filled action.
 * - **Decline** reopens shaping at once (`set_*_state(Shaping)`): the exit test is not met, so the record
 *   goes back to be shaped. No Round starts.
 *
 * The confirmation commits before the Round's session starts, so a session that cannot start (no `claude`)
 * leaves the record Done and the Round waiting on the strip for Continue; the dialog stays open and says so.
 * Starting a Round opens nothing: the board stays put, and the keyboard moves to the Round's band.
 */
import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheckBig, Undo2 } from "lucide-react";
import {
  epicConfirmDone,
  epicSetState,
  milestoneConfirmDone,
  milestoneSetState,
  type ConfirmDoneDto,
  type MilestoneDto,
  type StoryDto,
} from "../adapters/tauri";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useRoadmapRound } from "./RoadmapRound";
import { errorText } from "./StoryControls";
import { cn } from "@/lib/utils";

/** An Epic's exit test can be confirmed once shaping is closed and every Story is Merged or Dropped. */
export function epicExitTestConfirmable(state: string, stories: Pick<StoryDto, "state">[]): boolean {
  return (
    (state === "ready" || state === "in_progress") &&
    stories.length > 0 &&
    stories.every((s) => s.state === "merged" || s.state === "dropped")
  );
}

/** A Milestone's exit test can be confirmed while it is open and every Epic in it is Done (a Dropped one
 * aside). Its shaping need not be closed: a Milestone in Shaping is confirmed, never declined. */
export function milestoneExitTestConfirmable(m: Pick<MilestoneDto, "state" | "epicsDone" | "epicsTotal">): boolean {
  const total = m.epicsTotal ?? 0;
  return m.state !== "done" && m.state !== "dropped" && total > 0 && m.epicsDone === total;
}

export type ExitTestSubject =
  | { kind: "epic"; id: string; key: string; title: string; exitTest: string | null; milestoneTitle: string | null }
  | { kind: "milestone"; id: string; title: string; exitTest: string | null; state: string };

/** "FLY-3 Rounds" or "Shaping": how the dialog and the accessible names call the record. */
function nameOf(subject: ExitTestSubject): string {
  return subject.kind === "epic" ? `${subject.key} ${subject.title}` : subject.title;
}

/** What confirming starts, in one sentence, as the packet's scope line puts it. */
function roundSentence(subject: ExitTestSubject, openRound: number | null): string {
  if (openRound !== null) {
    return `Roadmap Round ${openRound} is already open, so no second Round starts: this is noted on it, and its next session reads it.`;
  }
  if (subject.kind === "epic") {
    const on = subject.milestoneTitle ? `on "${subject.milestoneTitle}"` : "on its Milestone";
    return `It also starts a short roadmap Round ${on}: an agent asks whether its exit test is still reachable, and whether an Epic is missing or one to drop.`;
  }
  return "It also starts a Roadmap Round: an agent asks whether the next Milestone is still right, and proposes reordering, amending, retiring or adding Milestones.";
}

/** After the Round starts or the trigger is noted, the keyboard goes to the Round's band on the strip. */
function focusRoundBand() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>("[data-slot=roadmap-round-band] button")?.focus();
  });
}

export function ConfirmExitTest({
  projectId,
  subject,
  place,
  className,
}: {
  projectId: string;
  subject: ExitTestSubject;
  /** The Epic card's heading or the Milestone header (full size), or a Roadmap strip row (compact). */
  place: "card" | "header" | "row";
  className?: string;
}) {
  const queryClient = useQueryClient();
  const openRound = useRoadmapRound(projectId).data?.open ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmDoneDto | null>(null);
  const exitId = useId();
  const name = nameOf(subject);
  const compact = place === "row";
  const declinable = subject.kind === "epic" || subject.state !== "shaping";

  async function confirm() {
    if (busy) return;
    setBusy("confirm");
    setError(null);
    try {
      const done = subject.kind === "epic" ? await epicConfirmDone(subject.id) : await milestoneConfirmDone(subject.id);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      if (done.sessionError) {
        // Done all the same: the dialog stays to say the Round waits for Continue.
        setResult(done);
      } else {
        setOpen(false);
        focusRoundBand();
      }
    } catch (err) {
      setError(`Could not confirm the exit test: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setError(null);
    try {
      if (subject.kind === "epic") await epicSetState(subject.id, "shaping");
      else await milestoneSetState(subject.id, "shaping");
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    } catch (err) {
      setError(`Could not reopen shaping: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span data-slot="confirm-exit-test" className={cn("flex min-w-0 flex-wrap items-center justify-end gap-1.5", className)}>
      {error && !open && (
        <span role="alert" title={error} className="min-w-0 truncate text-small text-destructive-text">
          {error}
        </span>
      )}
      <Button
        variant={compact ? "outline" : "default"}
        size={compact ? "xs" : "sm"}
        aria-label={`Confirm exit test of ${name}`}
        disabled={busy !== null}
        onClick={() => {
          setError(null);
          setResult(null);
          setOpen(true);
        }}
        className="shrink-0"
      >
        <CircleCheckBig aria-hidden="true" />
        Confirm exit test
      </Button>
      {declinable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={compact ? "xs" : "sm"}
              aria-label={`Decline exit test of ${name}: reopen shaping`}
              disabled={busy !== null}
              onClick={() => void decline()}
              className="shrink-0"
            >
              <Undo2 aria-hidden="true" />
              {busy === "decline" ? "Reopening…" : "Decline"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Not met: reopen shaping</TooltipContent>
        </Tooltip>
      )}

      <AlertDialog open={open} onOpenChange={(next) => busy === null && setOpen(next)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">
              {result ? `${name} is Done` : `Confirm ${name}'s exit test?`}
            </AlertDialogTitle>
            {result ? (
              <AlertDialogDescription>
                {`Roadmap Round ${result.roundNumber} is open, but its session could not start. Continue it from the Roadmap strip once that is fixed.`}
              </AlertDialogDescription>
            ) : (
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-3 text-left">
                  <figure className="m-0 flex flex-col gap-1 rounded-md border border-border bg-secondary px-3 py-2">
                    <figcaption id={exitId} className="text-meta font-semibold text-muted-foreground">
                      Exit test
                    </figcaption>
                    <blockquote aria-labelledby={exitId} className="m-0 max-w-[68ch] text-body text-foreground">
                      {subject.exitTest ?? <span className="text-subtle-foreground">Not written</span>}
                    </blockquote>
                  </figure>
                  <p className="m-0 text-body text-foreground">
                    {subject.kind === "epic"
                      ? "Every Story is Merged or Dropped. A Done Epic stays done."
                      : "Every Epic is Done. A Done Milestone is frozen: later changes go in a new Milestone."}
                  </p>
                  <p className="m-0 text-body text-muted-foreground">{roundSentence(subject, openRound?.number ?? null)}</p>
                </div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {result?.sessionError && (
            <p role="alert" className="m-0 rounded-md border border-border bg-secondary px-3 py-2 font-mono text-meta break-words text-muted-foreground">
              {result.sessionError}
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 text-small break-words text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            {result ? (
              <AlertDialogCancel>Close</AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel disabled={busy !== null}>Not yet</AlertDialogCancel>
                <Button aria-label={`Confirm ${name} Done`} disabled={busy !== null} onClick={() => void confirm()}>
                  <Check aria-hidden="true" />
                  {busy === "confirm" ? "Confirming…" : "Confirm Done"}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
