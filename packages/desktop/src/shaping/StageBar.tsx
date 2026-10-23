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
 *
 * A Milestone (issue #132) has one Stage, Exit test, so its bar is the one-step variant (`stages={MILESTONE_STAGES}`,
 * `record="Milestone"`): closing Exit test opens nothing and starts no session; it makes the Milestone Ready.
 */
import { useEffect, useId, useState } from "react";
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
export const EPIC_STAGES = ["challenge_spec", "slice", "criteria"] as const;

/** A Milestone's one Stage (issue #132). */
export const MILESTONE_STAGES = ["exit_test"] as const;

export interface StageBarProps {
  /** The Epic's Stages so far, in order: closed ones, then the open one. */
  stages: StageDto[];
  /** What is still open in the open Stage, or `null` before shaping has opened one. */
  status: StageStatusDto | null;
  /** The project the Epic belongs to: every board read under it is refreshed after a close. */
  projectId: string;
  /** Whether a shaping session is live on the Epic: a notice that the session did not start clears once one is. */
  sessionLive: boolean;
  /** The record's Stages in order: an Epic's three (default), or a Milestone's one (issue #132). */
  order?: readonly string[];
  /** The record being shaped. Closing a Milestone's last Stage makes it Ready (issue #132). */
  record?: "Epic" | "Milestone";
  className?: string;
}

function stageLabel(kind: string) {
  return STAGE_LABELS[kind] ?? kind;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}


export function StageBar({
  stages,
  status,
  projectId,
  sessionLive,
  order = EPIC_STAGES,
  record = "Epic",
  className,
}: StageBarProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const openListId = useId();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  // A "did not start" notice is stale once a session is live on the Epic (Shape started it).
  useEffect(() => {
    if (sessionLive) setNotice([]);
  }, [sessionLive]);

  const open = stages.find((s) => s.state === "open") ?? null;
  const closedKinds = new Set(stages.filter((s) => s.state === "closed").map((s) => s.kind));
  const current = open ? stageLabel(open.kind) : null;
  const next = status?.next ? stageLabel(status.next) : null;
  const items = status?.openItems ?? [];
  const questions = items.filter((i) => i.kind === "question");
  const proposals = items.filter((i) => i.kind === "proposal");
  const closable = Boolean(status?.closable) && !closing;
  // Issue #132: the Milestone's one Stage closes to Ready instead of opening a next one.
  const finishes = record === "Milestone" && !next;
  // A Milestone's Stage is named after the field it shapes, so it is called a Stage outright: "the Exit test
  // Stage is open" never reads as the exit test itself.
  const stageRef = record === "Milestone" && current ? `the ${current} Stage` : current;
  const StageRef = stageRef ? stageRef.charAt(0).toUpperCase() + stageRef.slice(1) : stageRef;

  async function close() {
    if (!status || closing) return;
    setClosing(true);
    setError(null);
    try {
      const done = await stageClose(status.stageId);
      const notes: string[] = [];
      if (done.launchError && done.opened) {
        notes.push(`The ${stageLabel(done.opened.kind)} session did not start: ${done.launchError}. Shape starts it.`);
      }
      if (!done.opened && finishes) notes.push(`${StageRef} is closed: the ${record} is Ready.`);
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
        {/* The steps never truncate: at narrow widths Close Stage drops to its own line instead. The open Stage
            is drawn as a neutral chip (inset ground, 1px edge), never as a button: nothing here but Close Stage
            acts. */}
        <ol className="m-0 flex flex-none items-center gap-2 p-0">
          {order.map((kind, i) => {
            const isOpen = open?.kind === kind;
            const isClosed = closedKinds.has(kind);
            const Icon = isClosed ? CircleCheck : isOpen ? CircleDot : Circle;
            return (
              <li
                key={kind}
                aria-current={isOpen ? "step" : undefined}
                className="flex list-none items-center gap-2"
              >
                {i > 0 && <span aria-hidden="true" className="h-px w-4 shrink-0 bg-input" />}
                <span
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full text-small whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0",
                    isOpen && "border border-border bg-secondary px-2.5 font-semibold text-foreground",
                    isClosed && "text-muted-foreground",
                    !isOpen && !isClosed && "text-subtle-foreground",
                  )}
                >
                  <Icon aria-hidden="true" />
                  <span>{stageLabel(kind)}</span>
                  <span className="sr-only">
                    {isClosed ? ", closed" : isOpen ? `, open, Stage ${i + 1} of ${order.length}` : ", not started"}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {status && open && (
          // `aria-disabled`, not `disabled`: the button stays in the tab order, so a keyboard user reaches it and
          // hears the list of what keeps the Stage open as its description.
          <Button
            className="ml-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            variant={closable ? "default" : "outline"}
            aria-disabled={!closable}
            aria-describedby={openListId}
            onClick={() => {
              if (closable) setConfirming(true);
            }}
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
                  {StageRef} stays open while{" "}
                  {[
                    questions.length > 0 && plural(questions.length, "question", "questions"),
                    proposals.length > 0 && plural(proposals.length, "Proposal", "Proposals"),
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  {items.length === 1 ? "is" : "are"} still open:
                </p>
                <ul aria-label="Still open" className="m-0 flex min-w-0 flex-col gap-1.5 p-0">
                  {questions.length > 0 && (
                    <li className="flex min-w-0 list-none items-start gap-2 text-small [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
                      <MessageCircleQuestionMark aria-hidden="true" className="text-muted-foreground" />
                      <span className="min-w-0 break-words">
                        <span className="font-semibold tabular-nums">
                          Round {questions[0].round}: {plural(questions.length, "question", "questions")} unanswered
                        </span>
                        <span className="text-muted-foreground"> · {questions.map((q) => q.title).join(", ")}</span>
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
            ) : finishes ? (
              <p className="m-0 text-small">
                <span className="font-semibold">Nothing in {stageRef} is open.</span>{" "}
                <span className="text-muted-foreground">
                  It is the {record}'s only Stage: closing it settles its answers and makes the {record} Ready.
                </span>
              </p>
            ) : (
              <p className="m-0 text-small text-muted-foreground">
                {current} is the last Stage. Closing it makes the Epic's Stories Ready, which is not built yet.
              </p>
            )}
          </div>
          {status.warnings.length > 0 && (
            <p className="m-0 flex min-w-0 items-start gap-2 text-meta text-subtle-foreground [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0">
              <Info aria-hidden="true" />
              <span className="min-w-0 break-words">Not blocking: {status.warnings.join(". ")}.</span>
            </p>
          )}
        </div>
      )}
      {/* Always mounted, so a notice that lands in it is announced. */}
      <div role="status" className="flex min-w-0 flex-col gap-1 empty:hidden px-4 pb-3">
        {notice.map((n) => (
          <p key={n} className="m-0 text-small break-words">
            {n}
          </p>
        ))}
      </div>

      <AlertDialog open={confirming} onOpenChange={(nextOpen) => !closing && setConfirming(nextOpen)}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">{`Close ${stageRef}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {finishes
                ? `A closed Stage stays closed: its answers are settled. Flywheel moves the ${record} to Ready; a session still working ${stageRef} ends.`
                : `A closed Stage stays closed: its answers are settled. Flywheel opens ${next} and starts its shaping session from a fresh packet; a session still working ${current} ends.`}
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
              {closing ? "Closing…" : finishes ? `Close and make it Ready` : `Close and start ${next}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
