/**
 * The review card (docs/mvp-spec.md §8, issues #155 and #157): what the developer judges an In review Story
 * on, in the spec's order, and the Merge that ends it. The header carries Re-run Checks (`story_checks_rerun`).
 *
 * 1. Failing Checks first: every Check that has not passed at the branch's head (failed and timed out
 *    before stale and not run, as the core sorts them), with its output tail and the agent's objections.
 * 2. Every Acceptance criterion with its Check chip and a checkbox. Ticking it is the developer's
 *    acceptance (`criterion_accept`); unticking withdraws it. A Check that passed at this commit pre-ticks
 *    its criterion only as a suggestion: the box wears the dashed "not on the record yet" edge until the
 *    developer ticks it. A passing Check's objections sit under its chip.
 * 3. The Decisions section (issue #161, `DecisionsSection.tsx`): `docs/adr/` and `GLOSSARY.md` changes apart
 *    from the code, each new ADR with its bar lines, its related live ADRs and Keep.
 * 4. The warnings: "n Tasks not done" (open or doing).
 * 5. The changed files, each with its patch (`ReviewFiles`).
 * 6. The footer: what still holds Merge, then Request changes and Merge (the region's one filled primary),
 *    or, while a Check is failing, "Merge with failing Check", which confirms in an AlertDialog naming those
 *    Checks. Request changes (issue #158) opens a composer in the footer itself: the comments, one review
 *    point per line, and "Send back to Running", which then takes the filled primary in Merge's place.
 *
 * A branch that would conflict with its base branch reads Rebase needed, before everything else, naming the
 * conflicting paths; Merge is held, and "Request rebase" opens the composer pre-filled with a comment that
 * names them (`rebaseComment`, written by the core).
 *
 * Every write is a core command; the card re-reads on `board:changed` and never trusts its own edit. A
 * refused Merge shows the core's reason as written.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleDashed,
  FileDiff,
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  ListTodo,
  LoaderCircle,
  MessageSquareReply,
  MessageSquareWarning,
  RefreshCw,
  SquareTerminal,
  Undo2,
} from "lucide-react";
import {
  criterionAccept,
  criterionUnaccept,
  storyChecksRerun,
  storyMerge,
  storyRequestChanges,
  storyReview,
  type ChecksRerunDto,
  type MergeDto,
  type ReviewCheckDto,
  type ReviewCriterionDto,
  type ReviewObjectionDto,
  type StoryDto,
  type StoryReviewDto,
} from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { DecisionsSection } from "./DecisionsSection";
import { ReviewFiles } from "./ReviewFiles";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The read of one Story's review card, keyed under the project so `board:changed` keeps it live. */
export function reviewQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "review", storyId] as const;
}

export function useStoryReview(projectId: string, storyId: string) {
  return useQuery({ queryKey: reviewQueryKey(projectId, storyId), queryFn: () => storyReview(storyId) });
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What still holds Merge, in the order the developer fixes it; empty when nothing does. */
export function mergeBlockers(review: StoryReviewDto): string[] {
  const blockers: string[] = [];
  if (review.conflicts.length > 0) {
    blockers.push(`Rebase needed: merging would conflict in ${plural(review.conflicts.length, "file")}.`);
  }
  if (review.liveSession) blockers.push("A session is live: stop it before merging.");
  const unaccepted = review.criteria.filter((c) => !c.accepted).length;
  if (unaccepted > 0) blockers.push(`Accept ${unaccepted} more ${unaccepted === 1 ? "criterion" : "criteria"} to merge.`);
  if (review.uncommitted.length > 0) {
    blockers.push(`The worktree has uncommitted changes (${review.uncommitted.join(", ")}): commit or discard them.`);
  }
  return blockers;
}

/** A Check's result as a chip, then Stale when its result belongs to an older commit. */
function ReviewCheckChip({ check }: { check: ReviewCheckDto }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateBadge state={check.result} className="h-5.5 text-meta" />
      {check.stale && <StateBadge state="stale" label="Stale" className="h-5.5 text-meta" />}
    </span>
  );
}

function CheckCommand({ command }: { command: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
      <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0" />
      <code title={command} className="min-w-0 truncate font-mono text-foreground">
        {command}
      </code>
    </span>
  );
}

/** A run's output tail, scrolled to its end: the failure summary is at the bottom of what a Check prints. */
function OutputTail({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      tabIndex={0}
      aria-label="Output tail"
      className="m-0 max-h-40 overflow-auto rounded-sm bg-card px-2.5 py-2 font-mono text-meta whitespace-pre-wrap text-foreground"
    >
      {text}
    </pre>
  );
}

/**
 * The handing-off agent's objections to one Check, beside it: what the developer weighs before overriding
 * or editing the Check. When the agent objected to an earlier command, that command is named.
 */
function CheckObjections({ check, className }: { check: ReviewCheckDto; className?: string }) {
  if (check.objections.length === 0) return null;
  return (
    <ul aria-label={`Agent's objections to ${check.command}`} className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}>
      {check.objections.map((objection: ReviewObjectionDto, index) => (
        <li key={index} className="flex min-w-0 items-start gap-1.5 text-small">
          <MessageSquareWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">
            <span className="font-semibold">Agent objects: </span>
            <span>{objection.why}</span>
            {objection.command !== check.command && (
              <span className="text-meta text-muted-foreground">
                {" (to "}
                <code className="font-mono">{objection.command}</code>
                {", since edited)"}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The Checks that have not passed at the branch's head, first on the card, each with its output tail. */
function FailingChecks({ checks }: { checks: ReviewCheckDto[] }) {
  const label = `${plural(checks.length, "Check")} not passing`;
  return (
    <section aria-label={label} className="flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2.5">
      <h3 className="m-0 text-small font-semibold">{`${label} at this commit`}</h3>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {checks.map((check) => (
          <li key={check.checkId} className="flex min-w-0 flex-col gap-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <ReviewCheckChip check={check} />
              <CheckCommand command={check.command} />
            </span>
            {check.outputTail && check.outputTail.trim() !== "" && <OutputTail text={check.outputTail.trimEnd()} />}
            {!check.outputTail && check.result === "not_run" && (
              <span className="text-meta text-muted-foreground">Not run since the Check was last edited.</span>
            )}
            <CheckObjections check={check} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Rebase needed: the paths a merge into the base branch would conflict in, first on the card, and the
 * request for changes that sends the agent to rebase, pre-filled with those paths.
 */
function RebaseNeeded({
  story,
  conflicts,
  onRequestRebase,
}: {
  story: StoryDto;
  conflicts: string[];
  onRequestRebase: () => void;
}) {
  return (
    <section aria-label="Rebase needed" className="flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="m-0 flex items-center gap-1.5 text-small font-semibold">
          <GitMergeConflict aria-hidden="true" className="size-4 shrink-0" />
          Rebase needed
        </h3>
        <span className="text-small text-muted-foreground">
          {`Merging into the base branch would conflict in ${plural(conflicts.length, "file")}.`}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Request a rebase of ${story.key}`}
          onClick={onRequestRebase}
          className="ml-auto"
        >
          <Undo2 aria-hidden="true" />
          Request rebase…
        </Button>
      </div>
      <ul aria-label="Conflicting files" className="m-0 flex list-none flex-col gap-1 p-0">
        {conflicts.map((path) => (
          <li key={path} className="min-w-0">
            <code title={path} className="block truncate font-mono text-meta text-foreground">
              {path}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Request changes composer, in place of the footer's actions: the comments (one review point per line,
 * the agent adds a Task for each), Cancel, and "Send back to Running", the region's filled primary while
 * it is open. A refusal or a failed launch says the core's words under it.
 */
function RequestChangesComposer({
  story,
  initial,
  onClose,
}: {
  story: StoryDto;
  initial: string;
  onClose: () => void;
}) {
  const [comments, setComments] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `request-changes-${story.id}`;

  function send() {
    if (busy) return;
    if (comments.trim() === "") {
      setEmpty(true);
      return;
    }
    setBusy(true);
    setError(null);
    storyRequestChanges(story.id, comments.trim())
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-small font-semibold">
        What should change?
      </label>
      <p id={`${id}-hint`} className="m-0 text-meta text-muted-foreground">
        One review point per line. The agent adds a Task for each, in the same worktree, before it goes on.
      </p>
      <Textarea
        id={id}
        autoFocus
        value={comments}
        disabled={busy}
        aria-invalid={empty || undefined}
        aria-describedby={empty ? `${id}-hint ${id}-empty` : `${id}-hint`}
        onChange={(event) => {
          setComments(event.target.value);
          if (event.target.value.trim() !== "") setEmpty(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
        className="max-h-60"
      />
      {empty && (
        <p id={`${id}-empty`} className="m-0 text-small text-destructive-text">
          Write at least one review point.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-small text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button aria-label={`Send ${story.key} back to Running`} aria-disabled={busy ? "true" : undefined} onClick={send}>
          <Undo2 aria-hidden="true" />
          {busy ? "Sending…" : "Send back to Running"}
        </Button>
      </div>
    </div>
  );
}

function RequestChangesButton({
  story,
  buttonRef,
  onOpen,
}: {
  story: StoryDto;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  return (
    <Button ref={buttonRef} variant="outline" aria-label={`Request changes on ${story.key}`} onClick={onOpen}>
      <MessageSquareReply aria-hidden="true" />
      Request changes…
    </Button>
  );
}

function CriterionRow({
  projectId,
  storyId,
  criterion,
  objectionsShownAbove,
}: {
  projectId: string;
  storyId: string;
  criterion: ReviewCriterionDto;
  /** Its Check is in the failing panel, which already shows the agent's objections to it. */
  objectionsShownAbove: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `review-criterion-${criterion.id}`;
  const suggested = criterion.preTicked && !criterion.accepted;

  function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    (next ? criterionAccept(criterion.id) : criterionUnaccept(criterion.id))
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: reviewQueryKey(projectId, storyId) });
        void queryClient.invalidateQueries({ queryKey: ["board", projectId, "criteria", storyId] });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start gap-3">
        {/* A pre-tick is a ghost tick: the dashed primary edge on the running tint ("not yet on the record"),
            the tick in running ink. The box stays unchecked until the developer ticks it. */}
        <span className="relative mt-0.5 flex shrink-0">
          <Checkbox
            id={id}
            checked={criterion.accepted}
            disabled={busy}
            aria-describedby={suggested ? `${id}-hint` : undefined}
            onCheckedChange={(value) => toggle(value === true)}
            className={cn(suggested && "border-dashed border-primary bg-running-muted")}
          />
          {suggested && (
            <Check aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto size-3.5 text-running" />
          )}
        </span>
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-body font-semibold break-words">
          {criterion.statement}
        </label>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pl-7">
        {criterion.check ? (
          <>
            <ReviewCheckChip check={criterion.check} />
            <CheckCommand command={criterion.check.command} />
          </>
        ) : (
          <StateBadge state="judged_at_review" label="Judged at review" className="h-5.5 text-meta" />
        )}
      </div>
      {criterion.check && !objectionsShownAbove && <CheckObjections check={criterion.check} className="pl-7" />}
      {suggested && (
        <p id={`${id}-hint`} className="m-0 flex items-center gap-1.5 pl-7 text-meta text-running">
          <CircleDashed aria-hidden="true" className="size-3.5 shrink-0" />
          Suggested · Check passed at this commit: tick to accept.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 pl-7 text-small text-destructive-text">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Merge, or "Merge with failing Check" behind an AlertDialog naming the failing Checks. Held (still in the
 * tab order, `aria-disabled`, described by the blockers) while anything but a failing Check stops it.
 */
function MergeControl({
  story,
  review,
  blockers,
  onMerged,
}: {
  story: StoryDto;
  review: StoryReviewDto;
  blockers: string[];
  onMerged?: (outcome: MergeDto) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = blockers.length > 0;
  const failing = review.failingChecks;
  const describedBy = held ? "review-merge-blockers" : undefined;

  function merge(withFailingChecks: boolean) {
    if (busy || held) return;
    setBusy(true);
    setError(null);
    storyMerge(story.id, withFailingChecks)
      .then((outcome) => {
        setConfirming(false);
        onMerged?.(outcome);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  const heldClass = held && "opacity-50";
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        {failing.length === 0 ? (
          <Button
            aria-label={`Merge ${story.key}`}
            aria-disabled={held || busy ? "true" : undefined}
            aria-describedby={describedBy}
            onClick={() => merge(false)}
            className={cn(heldClass)}
          >
            <GitMerge aria-hidden="true" />
            {busy ? "Merging…" : "Merge"}
          </Button>
        ) : (
          <Button
            variant="outline"
            aria-label={`Merge ${story.key} with failing Check`}
            aria-disabled={held ? "true" : undefined}
            aria-describedby={describedBy}
            onClick={() => {
              if (held) return;
              setError(null);
              setConfirming(true);
            }}
            className={cn("text-destructive-text", heldClass)}
          >
            <GitMerge aria-hidden="true" />
            Merge with failing Check…
          </Button>
        )}
      </div>
      {error && !confirming && (
        <p role="alert" className="m-0 basis-full text-small text-destructive-text">
          {error}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">{`Merge ${story.key} with failing Check?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`${failing.length === 1 ? "This Check has" : "These Checks have"} not passed at the branch's head. Merging records ${
                failing.length === 1 ? "it" : "them"
              } on the review as overridden.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul aria-label="Failing Checks" className="m-0 flex list-none flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2.5">
            {failing.map((check) => (
              <li key={check.checkId} className="flex min-w-0 flex-wrap items-center gap-2">
                <ReviewCheckChip check={check} />
                <CheckCommand command={check.command} />
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="m-0 text-small text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <Button variant="destructive" onClick={() => merge(true)} disabled={busy}>
              <GitMerge aria-hidden="true" />
              {busy ? "Merging…" : `Merge with ${plural(failing.length, "failing Check")}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** What a Re-run Checks recorded, in one line. */
export function rerunSummary(run: ChecksRerunDto): string {
  const total = run.passed + run.failed + run.timedOut;
  const parts = [`${run.passed} passed`, `${run.failed} failed`];
  if (run.timedOut > 0) parts.push(`${run.timedOut} timed out`);
  return `Ran ${plural(total, "Check")} at ${run.commitSha.slice(0, 7)}: ${parts.join(", ")}.`;
}

/**
 * Re-run Checks: every Check runs again in the worktree with no session, each run recorded against the
 * branch's head. A run takes minutes, so the control says it is running; the card re-reads on
 * `board:changed`. Held while a session is live (the core refuses it too), and a refusal is shown as written.
 */
function RerunChecksControl({ projectId, story, review }: { projectId: string; story: StoryDto; review: StoryReviewDto }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ChecksRerunDto | null>(null);
  const held = review.liveSession;

  function rerun() {
    if (busy || held) return;
    setBusy(true);
    setError(null);
    storyChecksRerun(story.id)
      .then((run) => {
        setLast(run);
        void queryClient.invalidateQueries({ queryKey: reviewQueryKey(projectId, story.id) });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <span aria-live="polite" className="text-meta text-muted-foreground tabular-nums">
        {busy ? "Running every Check in the worktree…" : last ? rerunSummary(last) : ""}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={held || busy ? "true" : undefined}
        aria-describedby={held ? "review-merge-blockers" : undefined}
        onClick={rerun}
        className={cn(held && "opacity-50")}
      >
        {busy ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
        Re-run Checks
      </Button>
      {error && (
        <p role="alert" className="m-0 basis-full text-right text-small text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ReviewCardProps {
  projectId: string;
  story: StoryDto;
  /** Called once the merge commit is on the base branch. */
  onMerged?: (outcome: MergeDto) => void;
}

export function ReviewCard({ projectId, story, onMerged }: ReviewCardProps) {
  const reviewQuery = useStoryReview(projectId, story.id);
  const review = reviewQuery.data;
  const blockers = review ? mergeBlockers(review) : [];
  const diff = review?.review;
  // The composer's starting text while it is open: empty for Request changes, the core's comment for Request rebase.
  const [composing, setComposing] = useState<string | null>(null);
  const requestButton = useRef<HTMLButtonElement>(null);

  function closeComposer() {
    setComposing(null);
    requestAnimationFrame(() => requestButton.current?.focus());
  }
  const hasChecks = review?.criteria.some((c) => c.check !== null) ?? false;
  const failingIds = new Set(review?.failingChecks.map((k) => k.checkId) ?? []);

  return (
    <section aria-labelledby="review-heading" className="flex flex-col rounded-lg border border-border bg-card shadow-card">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3.5 pb-2.5">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-[18px]">
            <GitPullRequest />
          </span>
          <h2 id="review-heading" className="m-0 text-section font-semibold">
            Review
          </h2>
        </span>
        {diff && (
          <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground tabular-nums">
            <FileDiff aria-hidden="true" size={16} />
            {`${plural(diff.files, "file")} · +${diff.added} −${diff.removed}`}
          </span>
        )}
        {review && hasChecks && <RerunChecksControl projectId={projectId} story={story} review={review} />}
      </header>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {reviewQuery.isError && <p className="m-0 text-small text-destructive-text">{errorText(reviewQuery.error)}</p>}
        {review && review.conflicts.length > 0 && (
          <RebaseNeeded story={story} conflicts={review.conflicts} onRequestRebase={() => setComposing(review.rebaseComment ?? "")} />
        )}
        {review && review.failingChecks.length > 0 && <FailingChecks checks={review.failingChecks} />}
        {review && <DecisionsSection decisions={review.decisions} />}
        {review && review.criteria.length === 0 && (
          <p className="m-0 text-body text-muted-foreground">This Story has no Acceptance criteria to accept.</p>
        )}
        {review && (
          <ol aria-label={`${story.key} criteria to accept`} className="m-0 list-none p-0 empty:hidden">
            {review.criteria.map((criterion) => (
              <CriterionRow
                key={criterion.id}
                projectId={projectId}
                storyId={story.id}
                criterion={criterion}
                objectionsShownAbove={failingIds.has(criterion.check?.checkId ?? "")}
              />
            ))}
          </ol>
        )}
        {review && review.openTasks > 0 && (
          <section aria-label="Warnings" className="flex flex-col gap-1 border-t border-border pt-3">
            <p className="m-0 flex items-center gap-1.5 text-small font-semibold tabular-nums">
              <ListTodo aria-hidden="true" className="size-4 shrink-0" />
              {`${plural(review.openTasks, "Task")} not done`}
            </p>
            <p className="m-0 pl-5.5 text-meta text-muted-foreground">
              Open or doing on the checklist. They do not hold Merge; read the checklist before you accept.
            </p>
          </section>
        )}
        {review && review.files.length > 0 && (
          <ReviewFiles projectId={projectId} storyId={story.id} headSha={review.headSha} files={review.files} />
        )}
      </div>
      {review && composing !== null && (
        <footer className="flex rounded-b-lg border-t border-border bg-muted/50 px-4 py-3">
          <RequestChangesComposer key={composing} story={story} initial={composing} onClose={closeComposer} />
        </footer>
      )}
      {review && composing === null && (
        <footer className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-b-lg border-t border-border bg-muted/50 px-4 py-3">
          <div id="review-merge-blockers" aria-live="polite" className="mr-auto flex min-w-0 flex-col gap-0.5 text-small">
            {blockers.map((blocker) => (
              <span key={blocker} className="text-foreground">
                {blocker}
              </span>
            ))}
            {blockers.length === 0 && (
              <span className="text-muted-foreground">
                {review.failingChecks.length > 0
                  ? "Every criterion is accepted. A Check has not passed: merging overrides it, on the record."
                  : "Every criterion is accepted and every Check passed. Merge writes the merge commit on the base branch and removes the worktree."}
              </span>
            )}
          </div>
          <RequestChangesButton story={story} buttonRef={requestButton} onOpen={() => setComposing("")} />
          <MergeControl story={story} review={review} blockers={blockers} onMerged={onMerged} />
        </footer>
      )}
    </section>
  );
}

/** The board row's action for an In review Story: opens the Story, where the review card is. */
export function OpenReviewControl({ projectId, story }: { projectId: string; story: StoryDto }) {
  const openStory = useUiStore((state) => state.openStory);
  return (
    <Button variant="outline" size="sm" aria-label={`Open review of ${story.key}`} onClick={() => openStory(projectId, story.id)}>
      <GitPullRequest aria-hidden="true" />
      Open review
    </Button>
  );
}
