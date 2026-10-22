/**
 * The Stage bar (docs/mvp-spec.md §3 "Closing a Stage", issue #126): the Epic's three Stages, in order,
 * above the Epic card and the Round dock, with the one control that advances shaping, Close Stage.
 *
 * A Stage is closable once nothing in it is open: no unanswered question and no undecided Proposal. Even
 * then the developer closes it: nothing advances on its own. The bar lists whatever keeps the Stage open
 * (the open Round's unanswered questions on one line, each undecided Proposal on its own), and Close Stage
 * stays disabled, an outline, until that list is empty; then it becomes the region's filled action. An empty
 * Problem, Scope or Exit test is listed under it as a note that never blocks.
 *
 * Closing is confirmed, because a closed Stage stays closed: the core closes it, opens the next Stage, ends
 * the session that worked the closed one, and starts the next Stage's shaping session from a fresh packet
 * that names it. The Epic's last Stage closes with the Stories made Ready, which is not built yet.
 */
import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Circle, CircleCheck, CircleDashed, CircleDot, Info, MessageCircleQuestionMark, StepForward } from "lucide-react";
import { stageClose, type StageDto, type StageStatusDto } from "../adapters/tauri";
import { errorText } from "../board/StoryControls";
import { STAGE_LABELS } from "./RoundDock";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** An Epic's Stages, in order. */
const EPIC_STAGES = ["challenge_spec", "slice", "criteria"] as const;

export interface StageBarProps {
  /** The Epic's Stages so far, in order: closed ones, then the open one. */
  stages: StageDto[];
  /** What is still open in the open Stage, or `null` before shaping has opened one. */
  status: StageStatusDto | null;
  /** The project the Epic belongs to: every board read under it is refreshed after a close. */
  projectId: string;
  className?: string;
}

function stageLabel(kind: string) {
  return STAGE_LABELS[kind] ?? kind;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Audience", "Audience and Surface", "Audience, Surface and Scope". */
function joined(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function StageBar({ stages, status, projectId, className }: StageBarProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const openListId = useId();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);

  const open = stages.find((s) => s.state === "open") ?? null;
  const closedKinds = new Set(stages.filter((s) => s.state === "closed").map((s) => s.kind));
  const current = open ? stageLabel(open.kind) : null;
  const next = status?.next ? stageLabel(status.next) : null;
  const items = status?.openItems ?? [];
  const questions = items.filter((i) => i.kind === "question");
  const proposals = items.filter((i) => i.kind === "proposal");
  const closable = Boolean(status?.closable) && !closing;

  async function close() {
    if (!status || closing) return;
    setClosing(true);
    setError(null);
    try {
      const done = await stageClose(status.stageId);
      const notes: string[] = [];
      if (done.launchError) {
        notes.push(`The ${stageLabel(done.opened.kind)} session did not start: ${done.launchError}. Shape starts it.`);
      }
      if (done.sidecarWarning) notes.push(done.sidecarWarning);
      setNotice(notes);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    } catch (err) {
      setError(`Could not close the Stage: ${errorText(err)}`);
    } finally {
      setClosing(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-card", className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
        <h2 id={headingId} className="sr-only">
          Stages
        </h2>
        <ol className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 p-0">
          {EPIC_STAGES.map((kind, i) => {
            const isOpen = open?.kind === kind;
            const isClosed = closedKinds.has(kind);
            const Icon = isClosed ? CircleCheck : isOpen ? CircleDot : Circle;
            return (
              <li
                key={kind}
                aria-current={isOpen ? "step" : undefined}
                className="flex min-w-0 list-none items-center gap-2"
              >
                {i > 0 && <span aria-hidden="true" className="h-px w-5 shrink-0 bg-input" />}
                <span
                  className={cn(
                    "flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-small [&_svg]:size-4 [&_svg]:shrink-0",
                    isOpen && "border border-foreground font-semibold text-foreground",
                    isClosed && "text-muted-foreground",
                    !isOpen && !isClosed && "text-subtle-foreground",
                  )}
                >
                  <Icon aria-hidden="true" />
                  <span className="truncate">{stageLabel(kind)}</span>
                  <span className="sr-only">
                    {isClosed ? ", closed" : isOpen ? `, open, Stage ${i + 1} of 3` : ", not started"}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {status && open && (
          <Button
            className="ml-auto"
            variant={closable ? "default" : "outline"}
            disabled={!closable}
            aria-describedby={openListId}
            onClick={() => setConfirming(true)}
          >
            <StepForward aria-hidden="true" />
            Close Stage
          </Button>
        )}
      </div>

      {status && open && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-3">
          <div id={openListId} className="flex min-w-0 flex-col gap-2">
            {items.length > 0 ? (
              <>
                <p className="m-0 text-small font-semibold">
                  {current} stays open while {plural(items.length, "thing is", "things are")} still open:
                </p>
                <ul aria-label="Still open" className="m-0 flex min-w-0 flex-col gap-1.5 p-0">
                  {questions.length > 0 && (
                    <li className="flex min-w-0 list-none items-start gap-2 text-small [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
                      <MessageCircleQuestionMark aria-hidden="true" className="text-muted-foreground" />
                      <span className="min-w-0 break-words">
                        <span className="font-semibold tabular-nums">
                          Round {questions[0].round}: {plural(questions.length, "question", "questions")} unanswered
                        </span>
                        <span className="text-muted-foreground"> · {joined(questions.map((q) => q.title))}</span>
                      </span>
                    </li>
                  )}
                  {proposals.map((p) => (
                    <li
                      key={p.id}
                      className="flex min-w-0 list-none items-start gap-2 text-small [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
                    >
                      <CircleDashed aria-hidden="true" className="text-muted-foreground" />
                      <span className="min-w-0 break-words">
                        <span className="font-semibold">Proposal undecided</span>
                        <span className="text-muted-foreground"> · {p.title.charAt(0).toUpperCase() + p.title.slice(1)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : next ? (
              <p className="m-0 text-small">
                <span className="font-semibold">Nothing in {current} is open.</span>{" "}
                <span className="text-muted-foreground">
                  Closing it settles its answers and starts {next} in a fresh shaping session.
                </span>
              </p>
            ) : (
              <p className="m-0 text-small text-muted-foreground">
                {current} is the last Stage. Closing it makes the Epic's Stories Ready, which is not built yet.
              </p>
            )}
          </div>
          {status.warnings.length > 0 && (
            <p className="m-0 flex min-w-0 items-start gap-2 text-meta text-muted-foreground [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0">
              <Info aria-hidden="true" />
              <span className="min-w-0 break-words">Not blocking: {status.warnings.join(". ")}.</span>
            </p>
          )}
          {notice.map((n) => (
            <p key={n} role="status" className="m-0 text-small break-words">
              {n}
            </p>
          ))}
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={(nextOpen) => !closing && setConfirming(nextOpen)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">{`Close ${current}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              A closed Stage stays closed: its answers are settled. Flywheel opens {next} and starts its shaping
              session from a fresh packet; a session still working {current} ends.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="m-0 text-small break-words text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Keep it open</AlertDialogCancel>
            <Button disabled={closing} onClick={() => void close()}>
              <StepForward aria-hidden="true" />
              {closing ? "Closing…" : `Close and start ${next}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
