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
 *    from the code, each new ADR with its bar lines, its related live ADRs and its decision (Keep, Not an ADR,
 *    Wrong decision, issue #164), and each change's flags. A new ADR marked anything but Keep holds Merge, and
 *    the composer lists the ADR review points the core sends after the comments; with any, the comments may
 *    stay empty.
 * 4. The warnings: "n Tasks not done" (open or doing).
 * 5. The changed files, each with its patch (`ReviewFiles`).
 * 6. The footer: what still holds Merge, then Request changes and Merge (the region's one filled primary),
 *    or, while a Check is failing, "Merge with failing Check", which confirms in an AlertDialog naming those
 *    Checks. Request changes (issue #158) opens a composer in the footer itself: the comments, one review
 *    point per line, and "Send back to Running", which then takes the filled primary in Merge's place.
 *
 * Issue #207: the footer sticks to the bottom of the Story view, so Merge is in reach past every diff, and
 * says in one line what holds it (the whole list is the "What holds Merge" Alert before the files). Rebase
 * needed, the failing Checks, the Tasks not done and that list are Alerts. Merge and Re-run Checks are
 * `loading` while they run; Re-run Checks shows its step ("Running 8 Checks · 3/8") over a Progress bar,
 * Merge says its step in the footer, and a merge that lands raises a toast with Open board.
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
  CircleSlash,
  CircleX,
  FileDiff,
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  ListTodo,
  MessageSquareReply,
  MessageSquareWarning,
  RefreshCw,
  ScrollText,
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
  subscribeChecksProgress,
  type ChecksProgressPayload,
  type ChecksRerunDto,
  type MergeDto,
  type ReviewCheckDto,
  type ReviewCriterionDto,
  type ReviewObjectionDto,
  type StoryDto,
  type StoryReviewDto,
} from "../adapters/tauri";
import { ReadError } from "../components/ReadError";
import { StateBadge } from "../components/StateBadge";
import { DecisionsSection } from "./DecisionsSection";
import { ReviewFiles } from "./ReviewFiles";
import { useUiStore } from "../state/uiStore";
import { notify } from "../lib/notify";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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

/** The list of what holds Merge, which describes Merge and Re-run Checks while they are held. */
const MERGE_BLOCKERS_ID = "review-merge-blockers";

/** What still holds Merge, in the order the developer fixes it; empty when nothing does. */
export function mergeBlockers(review: StoryReviewDto): string[] {
  const blockers: string[] = [];
  if (review.conflicts.length > 0) {
    blockers.push(`Rebase needed: merging would conflict in ${plural(review.conflicts.length, "file")}.`);
  }
  if (review.liveSession) blockers.push("A session is live: stop it before merging.");
  const unaccepted = review.criteria.filter((c) => !c.accepted).length;
  if (unaccepted > 0) blockers.push(`Accept ${unaccepted} more ${unaccepted === 1 ? "criterion" : "criteria"} to merge.`);
  for (const change of review.decisions) {
    const decision = change.newAdr?.decision.kind;
    if (decision && decision !== "keep") {
      blockers.push(
        `${change.path} is marked ${decision === "not_an_adr" ? "Not an ADR" : "Wrong decision"}: request changes, or set it back to Keep.`,
      );
    }
  }
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

/**
 * A Check's command in the code face. On the card it keeps to one line and truncates (the whole command is
 * its title); `wrap` breaks it anywhere instead, for the Merge confirm, where the Developer must read all of it.
 */
function CheckCommand({ command, wrap = false }: { command: string; wrap?: boolean }) {
  return (
    <span className={cn("flex min-w-0 gap-1.5 text-meta text-muted-foreground", wrap ? "basis-full items-start" : "items-center")}>
      <SquareTerminal aria-hidden="true" className={cn("size-3.5 shrink-0", wrap && "mt-0.5")} />
      <code
        title={wrap ? undefined : command}
        className={cn("min-w-0 font-mono text-foreground", wrap ? "break-all whitespace-pre-wrap" : "truncate")}
      >
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
    <Alert role="region" aria-label={label} variant="destructive" className="gap-y-2 px-3 py-2.5 text-small">
      <CircleX aria-hidden="true" />
      <AlertTitle className="text-small font-semibold">{`${label} at this commit`}</AlertTitle>
      <ul className="col-start-2 m-0 flex min-w-0 list-none flex-col gap-2.5 p-0">
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
    </Alert>
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
    <Alert role="region" aria-label="Rebase needed" className="gap-y-2 px-3 py-2.5 text-small">
      <GitMergeConflict aria-hidden="true" />
      <AlertTitle className="text-small font-semibold">Rebase needed</AlertTitle>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <AlertDescription className="text-small text-muted-foreground">
          {`Merging into the base branch would conflict in ${plural(conflicts.length, "file")}.`}
        </AlertDescription>
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
      <ul aria-label="Conflicting files" className="col-start-2 m-0 flex min-w-0 list-none flex-col gap-1 p-0">
        {conflicts.map((path) => (
          <li key={path} className="min-w-0">
            <code title={path} className="block truncate font-mono text-meta text-foreground">
              {path}
            </code>
          </li>
        ))}
      </ul>
    </Alert>
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
  adrPoints,
  onClose,
}: {
  story: StoryDto;
  initial: string;
  /** The ADR review points the core sends after the comments. */
  adrPoints: string[];
  onClose: () => void;
}) {
  const [comments, setComments] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `request-changes-${story.id}`;

  function send() {
    if (busy) return;
    if (comments.trim() === "" && adrPoints.length === 0) {
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
        className="max-h-[30dvh]"
      />
      {adrPoints.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span id={`${id}-adr`} className="text-meta font-semibold text-muted-foreground">
            {`Also sent: ${adrPoints.length === 1 ? "1 ADR review point" : `${adrPoints.length} ADR review points`}`}
          </span>
          <ul aria-labelledby={`${id}-adr`} className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
            {adrPoints.map((point) => (
              <li key={point} className="flex min-w-0 items-start gap-1.5 text-small break-words text-foreground">
                <ScrollText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}
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
        <Button aria-label={`Send ${story.key} back to Running`} loading={busy} onClick={send}>
          <Undo2 aria-hidden="true" />
          Send back to Running
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
 * While it runs the button is `loading` and `onPending` hears it, so the footer can say the step; once the
 * merge commit lands a toast says so ("FLY-3 merged into main", Open board).
 */
function MergeControl({
  projectId,
  story,
  review,
  blockers,
  onPending,
  onMerged,
}: {
  projectId: string;
  story: StoryDto;
  review: StoryReviewDto;
  blockers: string[];
  onPending: (pending: boolean) => void;
  onMerged?: (outcome: MergeDto) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = blockers.length > 0;
  const failing = review.failingChecks;
  const describedBy = held ? MERGE_BLOCKERS_ID : undefined;

  function merge(withFailingChecks: boolean) {
    if (busy || held) return;
    setBusy(true);
    onPending(true);
    setError(null);
    storyMerge(story.id, withFailingChecks)
      .then((outcome) => {
        setConfirming(false);
        notify.success(`${story.key} merged into ${outcome.baseBranch}`, {
          description: outcome.cleanupWarning ?? "Worktree cleaned.",
          action: { label: "Open board", onClick: () => useUiStore.getState().setCurrentProjectId(projectId) },
        });
        onMerged?.(outcome);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => {
        setBusy(false);
        onPending(false);
      });
  }

  const heldClass = held && "opacity-50";
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        {failing.length === 0 ? (
          <Button
            aria-label={`Merge ${story.key}`}
            aria-disabled={held ? "true" : undefined}
            aria-describedby={describedBy}
            loading={busy}
            onClick={() => merge(false)}
            className={cn(heldClass)}
          >
            <GitMerge aria-hidden="true" />
            Merge
          </Button>
        ) : (
          <Button
            variant="outline"
            aria-label={`Merge ${story.key} with failing Check`}
            aria-disabled={held ? "true" : undefined}
            aria-describedby={describedBy}
            loading={busy}
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
        {/* Wide enough for a real Check command, never wider than the window; a long list scrolls inside. */}
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-xl">
          <AlertDialogHeader className="min-w-0">
            <AlertDialogTitle className="text-section font-semibold">{`Merge ${story.key} with failing Check?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`${failing.length === 1 ? "This Check has" : "These Checks have"} not passed at the branch's head. Merging records ${
                failing.length === 1 ? "it" : "them"
              } on the review as overridden.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <ul
              aria-label="Failing Checks"
              tabIndex={0}
              className="m-0 flex min-h-0 min-w-0 list-none flex-col gap-2.5 overflow-y-auto rounded-md border border-border bg-muted px-3 py-2.5"
            >
              {failing.map((check) => (
                <li key={check.checkId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <ReviewCheckChip check={check} />
                  <CheckCommand command={check.command} wrap />
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="m-0 text-small text-destructive-text">
                {error}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Not yet</AlertDialogCancel>
            <Button variant="destructive" loading={busy} onClick={() => merge(true)}>
              <GitMerge aria-hidden="true" />
              {`Merge with ${plural(failing.length, "failing Check")}`}
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
 * branch's head. A run takes minutes, so while it runs the button is `loading` and the step reads beside it
 * ("Running 8 Checks · 3/8") over a Progress bar fed by `checks:progress`; the card re-reads on
 * `board:changed`. Held while a session is live (the core refuses it too), and a refusal is shown as written.
 */
function RerunChecksControl({ projectId, story, review }: { projectId: string; story: StoryDto; review: StoryReviewDto }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ChecksProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ChecksRerunDto | null>(null);
  const held = review.liveSession;
  const checkCount = review.criteria.filter((c) => c.check !== null).length;

  async function rerun() {
    if (busy || held) return;
    setBusy(true);
    setProgress(null);
    setError(null);
    // Listen before the run starts, so its first report is not missed. A failed subscription costs only the count.
    const unlisten = await subscribeChecksProgress((payload) => {
      if (payload.storyId === story.id) setProgress(payload);
    }).catch(() => null);
    try {
      const run = await storyChecksRerun(story.id);
      setLast(run);
      void queryClient.invalidateQueries({ queryKey: reviewQueryKey(projectId, story.id) });
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      unlisten?.();
      setBusy(false);
      setProgress(null);
    }
  }

  const total = progress?.total ?? checkCount;
  const step = progress ? `Running ${plural(total, "Check")} · ${progress.done}/${total}` : `Running ${plural(total, "Check")}`;
  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <span className="flex min-w-0 flex-col items-end gap-1">
        <span aria-live="polite" className="text-meta text-muted-foreground tabular-nums">
          {busy ? step : last ? rerunSummary(last) : ""}
        </span>
        {busy && <Progress aria-label="Checks run" value={progress?.done ?? 0} max={Math.max(total, 1)} className="w-32" />}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={held ? "true" : undefined}
        aria-describedby={held ? MERGE_BLOCKERS_ID : undefined}
        loading={busy}
        onClick={() => void rerun()}
        className={cn(held && "opacity-50")}
      >
        <RefreshCw aria-hidden="true" />
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

/** What still holds Merge, in full, after what the Developer judges and before the diffs. */
function MergeBlockers({ blockers }: { blockers: string[] }) {
  return (
    <Alert role="region" aria-label="What holds Merge" className="gap-y-1.5 px-3 py-2.5 text-small">
      <CircleSlash aria-hidden="true" />
      <AlertTitle className="text-small font-semibold">What holds Merge</AlertTitle>
      {/* Merge and Re-run Checks are described by this list (its words, not the Alert's label). */}
      <ul id={MERGE_BLOCKERS_ID} className="col-start-2 m-0 flex min-w-0 list-none flex-col gap-1 p-0">
        {blockers.map((blocker) => (
          <li key={blocker} className="min-w-0 break-words text-foreground">
            {blocker}
          </li>
        ))}
      </ul>
    </Alert>
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
  const queryClient = useQueryClient();
  const review = reviewQuery.data;
  const blockers = review ? mergeBlockers(review) : [];
  const diff = review?.review;
  // The composer's starting text while it is open: empty for Request changes, the core's comment for Request rebase.
  const [composing, setComposing] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const requestButton = useRef<HTMLButtonElement>(null);

  function closeComposer() {
    setComposing(null);
    requestAnimationFrame(() => requestButton.current?.focus());
  }
  const hasChecks = review?.criteria.some((c) => c.check !== null) ?? false;
  const failingIds = new Set(review?.failingChecks.map((k) => k.checkId) ?? []);

  // The footer sticks to the bottom of the Story view while the card is in view, so Merge and Request
  // changes are in reach from anywhere in a long review, never only past every diff. Its ground is opaque
  // (the half-inset tint laid over the card), so a diff scrolling under it never shows through.
  const footerClass = "sticky bottom-0 z-10 rounded-b-lg border-t border-border bg-card";
  const footerInner = "rounded-b-lg bg-muted/50 px-4 py-3";

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
        {reviewQuery.isError && <ReadError title={`Couldn't load the review of ${story.key}`} query={reviewQuery} />}
        {review && review.conflicts.length > 0 && (
          <RebaseNeeded story={story} conflicts={review.conflicts} onRequestRebase={() => setComposing(review.rebaseComment ?? "")} />
        )}
        {review && review.failingChecks.length > 0 && <FailingChecks checks={review.failingChecks} />}
        {review && (
          <DecisionsSection
            storyId={story.id}
            decisions={review.decisions}
            onDecided={() => void queryClient.invalidateQueries({ queryKey: reviewQueryKey(projectId, story.id) })}
          />
        )}
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
          <Alert role="region" aria-label="Warnings" className="px-3 py-2.5 text-small">
            <ListTodo aria-hidden="true" />
            <AlertTitle className="text-small font-semibold tabular-nums">{`${plural(review.openTasks, "Task")} not done`}</AlertTitle>
            <AlertDescription className="text-meta text-muted-foreground">
              Open or doing on the checklist. They do not hold Merge; read the checklist before you accept.
            </AlertDescription>
          </Alert>
        )}
        {review && blockers.length > 0 && <MergeBlockers blockers={blockers} />}
        {review && review.files.length > 0 && (
          <ReviewFiles projectId={projectId} storyId={story.id} headSha={review.headSha} files={review.files} />
        )}
      </div>
      {review && composing !== null && (
        <footer className={footerClass}>
          <div className={cn("flex", footerInner)}>
            <RequestChangesComposer
              key={composing}
              story={story}
              initial={composing}
              adrPoints={review.adrReviewPoints}
              onClose={closeComposer}
            />
          </div>
        </footer>
      )}
      {review && composing === null && (
        <footer className={footerClass}>
          <div className={cn("flex flex-wrap items-center justify-end gap-x-4 gap-y-2", footerInner)}>
            <p aria-live="polite" className="m-0 mr-auto flex min-w-32 flex-1 basis-0 items-baseline gap-2 text-small">
              {merging ? (
                <span className="line-clamp-2 min-w-0 text-muted-foreground">{`Merging ${story.key}: writing the merge commit, then removing the worktree.`}</span>
              ) : blockers.length > 0 ? (
                <>
                  <span title={blockers[0]} className="min-w-0 truncate text-foreground">
                    {blockers[0]}
                  </span>
                  {blockers.length > 1 && (
                    <span className="shrink-0 text-muted-foreground tabular-nums">{`+${blockers.length - 1} more`}</span>
                  )}
                </>
              ) : (
                <span className="line-clamp-2 min-w-0 text-muted-foreground">
                  {review.failingChecks.length > 0
                    ? "Every criterion is accepted. A Check has not passed: merging overrides it, on the record."
                    : "Every criterion is accepted and every Check passed. Merge writes the merge commit on the base branch and removes the worktree."}
                </span>
              )}
            </p>
            <RequestChangesButton story={story} buttonRef={requestButton} onOpen={() => setComposing("")} />
            <MergeControl
              projectId={projectId}
              story={story}
              review={review}
              blockers={blockers}
              onPending={setMerging}
              onMerged={onMerged}
            />
          </div>
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
