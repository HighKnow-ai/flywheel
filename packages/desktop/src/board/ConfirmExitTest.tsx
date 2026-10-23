/**
 * Confirm exit test (docs/mvp-spec.md §3, issue #134): the developer's minimal control for closing an Epic
 * or a Milestone. It shows on an Epic card once every Story is Merged or Dropped, and on a Milestone's row
 * and header once every Epic is Done. #61 lists it in Needs you later.
 *
 * - **Confirm exit test** opens an AlertDialog that quotes the exit test and says what confirming starts:
 *   Done is final, and the click is also the consent to a roadmap Round (Epic #60): a short one on the
 *   Epic's Milestone, or a Roadmap Round for a Milestone. With a Round already open, it says the trigger is
 *   noted on that one instead. Confirm Done is the dialog's filled action.
 * - **Not met: reopen shaping** (Decline), set apart in the same dialog, moves the record back to Shaping
 *   (`set_*_state(Shaping)`). No Round starts. A Milestone still in Shaping has nothing to reopen.
 *
 * The component stays mounted while its record is not confirmable (`available` false, nothing drawn), so
 * the dialog outlives the refetch that turns the record Done: a session that cannot start (no `claude`)
 * leaves the record Done and the Round waiting on the strip for Continue, and the dialog stays to say so.
 * Starting a Round opens nothing: the board stays put, the keyboard moves to the Round's band without
 * scrolling, and the outcome is announced.
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

/** "FLY-3 Rounds" or "Shaping": how the accessible names call the record. */
function nameOf(subject: ExitTestSubject): string {
  return subject.kind === "epic" ? `${subject.key} ${subject.title}` : subject.title;
}

/** "Rounds" or "Milestone "Shaping"": the dialog's title names the record as its card heads it. */
function titleOf(subject: ExitTestSubject): string {
  return subject.kind === "epic" ? subject.title : `Milestone "${subject.title}"`;
}

/** What confirming starts, in one sentence, as the packet's scope line puts it. */
function roundSentence(subject: ExitTestSubject, openRound: number | null): string {
  if (openRound !== null) {
    return `Roadmap Round ${openRound} is already open, so no second Round starts: this is noted on it, and its next session reads it.`;
  }
  if (subject.kind === "epic") {
    const on = subject.milestoneTitle ? `on "${subject.milestoneTitle}"` : "on its Milestone";
    return `Confirming also starts a short roadmap Round ${on}: an agent asks whether its exit test is still reachable, and whether an Epic is missing or one to drop.`;
  }
  return "Confirming also starts a Roadmap Round: an agent asks whether the next Milestone is still right, and proposes reordering, amending, retiring or adding Milestones.";
}

/** Focus `selector`'s first match once the board has re-rendered, without scrolling the board. */
function focusLater(selector: string) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  });
}

export function ConfirmExitTest({
  projectId,
  subject,
  place,
  available = true,
  className,
}: {
  projectId: string;
  subject: ExitTestSubject;
  /** The Epic card's heading or the Milestone header (full size), or a Roadmap strip line (compact). */
  place: "card" | "header" | "row";
  /** Whether the exit test can be confirmed now. While it cannot, nothing is drawn but an open dialog. */
  available?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const openRound = useRoadmapRound(projectId).data?.open ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmDoneDto | null>(null);
  const [announcement, setAnnouncement] = useState("");
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
      // Set before the refetch: the record turns Done and the dialog must still be able to say why.
      if (done.sessionError) setResult(done);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      if (!done.sessionError) {
        setOpen(false);
        setAnnouncement(
          done.outcome === "noted"
            ? `${name} is Done. Noted on Roadmap Round ${done.roundNumber}, on the Roadmap strip.`
            : `${name} is Done. Roadmap Round ${done.roundNumber} started, on the Roadmap strip.`,
        );
        focusLater("[data-slot=roadmap-round-band] button");
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
      setOpen(false);
      setAnnouncement(`Shaping reopened on ${name}.`);
      // The control is gone with the dialog: the keyboard goes to what replaced it.
      focusLater(
        subject.kind === "epic"
          ? `[aria-label^="Shape ${subject.key} "], [aria-label^="Continue shaping ${subject.key} "]`
          : `[data-row-id="${subject.id}"]`,
      );
    } catch (err) {
      setError(`Could not reopen shaping: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span
      data-slot="confirm-exit-test"
      className={cn(available ? "flex min-w-0 flex-wrap items-center justify-end gap-1.5" : "contents", className)}
    >
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {available && (
        <Button
          variant={compact ? "outline" : "default"}
          size={compact ? "xs" : "sm"}
          aria-label={`Confirm exit test of ${name}`}
          aria-haspopup="dialog"
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
      )}

      <AlertDialog open={open} onOpenChange={(next) => busy === null && setOpen(next)}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader className="w-full">
            <AlertDialogTitle className="text-section font-semibold text-balance">
              {result ? `${titleOf(subject)} is Done` : `Confirm the exit test of ${titleOf(subject)}?`}
            </AlertDialogTitle>
            {result ? (
              <AlertDialogDescription className="text-pretty">
                {`Roadmap Round ${result.roundNumber} is open, but its session could not start. Continue it from the Roadmap strip once that is fixed.`}
              </AlertDialogDescription>
            ) : (
              <AlertDialogDescription asChild>
                <div className="flex w-full flex-col gap-3 text-left text-pretty">
                  <figure className="m-0 flex flex-col gap-1 rounded-md border border-border bg-secondary px-3 py-2">
                    <figcaption id={exitId} className="text-meta font-semibold text-muted-foreground">
                      {subject.kind === "epic" ? `Exit test · ${subject.key}` : "Exit test"}
                    </figcaption>
                    <blockquote aria-labelledby={exitId} className="m-0 text-body text-foreground">
                      {subject.exitTest ?? <span className="text-subtle-foreground">Not written</span>}
                    </blockquote>
                  </figure>
                  <p className="m-0 text-body text-muted-foreground">
                    {subject.kind === "epic"
                      ? "Every Story is Merged or Dropped. A Done Epic stays done."
                      : "Every Epic is Done. A Done Milestone is frozen: later changes go in a new Milestone."}
                  </p>
                  <p className="m-0 text-body text-foreground">{roundSentence(subject, openRound?.number ?? null)}</p>
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
                {declinable && (
                  // Set apart at the start of the footer: the other answer to the question, not a way out.
                  <Button
                    variant="ghost"
                    className="sm:mr-auto"
                    aria-label={`Not met: reopen shaping on ${name}`}
                    disabled={busy !== null}
                    onClick={() => void decline()}
                  >
                    <Undo2 aria-hidden="true" />
                    {busy === "decline" ? "Reopening…" : "Not met: reopen shaping"}
                  </Button>
                )}
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
