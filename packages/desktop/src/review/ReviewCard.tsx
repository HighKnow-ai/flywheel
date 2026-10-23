/**
 * The review card (docs/mvp-spec.md §8, issue #155): what the developer judges an In review Story on, in
 * the spec's order, and the Merge that ends it.
 *
 * 1. Failing Checks first: every Check that has not passed at the branch's head (failed, timed out, not
 *    run, stale), with its output tail.
 * 2. Every Acceptance criterion with its Check chip and a checkbox. Ticking it is the developer's
 *    acceptance (`criterion_accept`); unticking withdraws it. A Check that passed at this commit pre-ticks
 *    its criterion only as a suggestion: the box wears the dashed "not on the record yet" edge until the
 *    developer ticks it.
 * 3. The footer: what still holds Merge, then Merge (the region's one filled primary), or, while a Check is
 *    failing, "Merge with failing Check", which confirms in an AlertDialog naming those Checks.
 *
 * Every write is a core command; the card re-reads on `board:changed` and never trusts its own edit. A
 * refused Merge shows the core's reason as written.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDiff, GitMerge, GitPullRequest, ListTodo, SquareTerminal } from "lucide-react";
import {
  criterionAccept,
  criterionUnaccept,
  storyMerge,
  storyReview,
  type MergeDto,
  type ReviewCheckDto,
  type ReviewCriterionDto,
  type StoryDto,
  type StoryReviewDto,
} from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
            {check.outputTail && check.outputTail.trim() !== "" && (
              <pre className="m-0 max-h-40 overflow-auto rounded-sm border border-border bg-card px-2.5 py-2 font-mono text-meta whitespace-pre-wrap text-foreground">
                {check.outputTail.trimEnd()}
              </pre>
            )}
            {!check.outputTail && check.result === "not_run" && (
              <span className="text-meta text-muted-foreground">Not run since the Check was last edited.</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CriterionRow({
  projectId,
  storyId,
  criterion,
}: {
  projectId: string;
  storyId: string;
  criterion: ReviewCriterionDto;
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
        <Checkbox
          id={id}
          checked={criterion.accepted}
          disabled={busy}
          aria-describedby={suggested ? `${id}-hint` : undefined}
          onCheckedChange={(value) => toggle(value === true)}
          className={cn("mt-0.5", suggested && "border-dashed border-primary")}
        />
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
      {suggested && (
        <p id={`${id}-hint`} className="m-0 pl-7 text-meta text-running">
          Check passed at this commit: tick to accept.
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
            <Button onClick={() => merge(true)} disabled={busy}>
              <GitMerge aria-hidden="true" />
              {busy ? "Merging…" : `Merge with ${plural(failing.length, "failing Check")}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
        {review && review.openTasks > 0 && (
          <span className="inline-flex items-center gap-1.5 text-small font-semibold tabular-nums">
            <ListTodo aria-hidden="true" size={16} />
            {`${plural(review.openTasks, "Task")} not done`}
          </span>
        )}
      </header>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {reviewQuery.isError && <p className="m-0 text-small text-destructive-text">{errorText(reviewQuery.error)}</p>}
        {review && review.failingChecks.length > 0 && <FailingChecks checks={review.failingChecks} />}
        {review && review.criteria.length === 0 && (
          <p className="m-0 text-body text-muted-foreground">This Story has no Acceptance criteria to accept.</p>
        )}
        {review && (
          <ol aria-label={`${story.key} criteria to accept`} className="m-0 list-none p-0 empty:hidden">
            {review.criteria.map((criterion) => (
              <CriterionRow key={criterion.id} projectId={projectId} storyId={story.id} criterion={criterion} />
            ))}
          </ol>
        )}
      </div>
      {review && (
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
