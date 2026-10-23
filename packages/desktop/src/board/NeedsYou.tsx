/**
 * Needs you (docs/mvp-spec.md §2 "Needs you" and §7, issue #156): everything in the project waiting on the
 * developer, ranked by the core (`needs_you_list`), each item a card with its kind, its record, a one-line
 * detail and its action, which works in place.
 *
 * From a content width of 1280px it is a 400px column beside the roster (direction.md "First viewport"); below
 * that, the top bar's Needs you button opens it as a Sheet. The sidebar's project figure is the same list's
 * length (`ProjectRail.tsx`), read under the same key.
 *
 * The actions reuse the controls every other place offers, so an answer here is the same answer:
 * - a Gated action, a permission request or a question: the permission-request card, as a band across the
 *   item (`RequestInCard`). No keystroke answers it from here: the session feed and the Waiting-on-you queue
 *   own A and D, and one key must never answer two agents;
 * - a Stopped Story: Resume; one whose worktree is missing: Recreate worktree;
 * - a Story In review: Open review, which opens the Story view (the review card lives there);
 * - Confirm exit test: the same control and dialog as the Epic card and the Milestone header;
 * - a Shaping Round: Answer (Decide for a roadmap Round) while a live session is held on it, else Continue
 *   shaping (Continue for a roadmap Round), which starts a fresh session and keeps you where you are.
 *
 * Yellow is Waiting on you only: a card wears the attention edge and tint only while a live session is held on
 * it. A Stopped Story wears the red Stopped pill; every other kind is neutral, told apart by its icon and word.
 * Its record (the key and title, with the trailing chevron) opens the Story, the Epic or the Milestone.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Box,
  ChevronRight,
  CircleCheckBig,
  CircleDashed,
  Compass,
  Flag,
  GitPullRequest,
  KeyRound,
  Layers,
  MessageCircleQuestionMark,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import {
  answerPermissionRequest,
  answerQuestion,
  roadmapRevisit,
  worktreeRecreate,
  type NeedsYouItemDto,
  type NeedsYouKind,
} from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatAge } from "../legend/runStatus";
import { PermissionRequestCard, RequestInCard, type PermissionDecision } from "../session/PermissionRequestCard";
import { useUiStore } from "../state/uiStore";
import { blockedQueueQueryKey, needsYouQueryKey, useNeedsYou } from "../fleet/useFleet";
import { pendingPermissionRequestsQueryKey } from "./useBoardQuery";
import { ResumeControl, endingWords, errorText } from "./StoryControls";
import { ConfirmExitTest, type ExitTestSubject } from "./ConfirmExitTest";
import { ContinueShapingButton } from "./EpicShapingControl";
import { ContinueMilestoneShapingButton } from "./MilestoneShapingControl";
import { cn } from "@/lib/utils";

/** Whether a live session is held on the item: the only Needs-you items drawn in yellow. */
export function isWaitingOnYou(item: NeedsYouItemDto): boolean {
  if (item.kind === "shaping_round") return item.round?.waitingOnYou ?? false;
  return item.kind === "gated_action" || item.kind === "permission_request" || item.kind === "question";
}

/** The kind's word and icon (direction.md § Icons, "Needs-you kinds"). */
const KIND: Record<NeedsYouKind, { word: string; icon: ReactNode }> = {
  gated_action: { word: "Gated action", icon: <ShieldAlert /> },
  permission_request: { word: "Permission request", icon: <KeyRound /> },
  question: { word: "Question", icon: <MessageCircleQuestionMark /> },
  stopped: { word: "Stopped", icon: <Box /> },
  review: { word: "Review", icon: <GitPullRequest /> },
  confirm_exit_test: { word: "Confirm exit test", icon: <CircleCheckBig /> },
  shaping_round: { word: "Shaping Round", icon: <CircleDashed /> },
};

/** "Round 2", or "Roadmap Round 1". */
function roundName(item: NeedsYouItemDto): string {
  const round = item.round;
  if (!round) return "Round";
  return round.subject === "roadmap" ? `Roadmap Round ${round.roundNumber}` : `Round ${round.roundNumber}`;
}

/** The item's one-line detail, in the board's words. A request's is its card: the literal command. */
export function detailOf(item: NeedsYouItemDto): string | null {
  switch (item.kind) {
    case "stopped": {
      if (item.missingWorktree) return "Its worktree is missing from disk: recreate it, then Resume";
      const doing = item.doingTaskTitle ? ` · was doing “${item.doingTaskTitle}”` : "";
      return `Stopped: ${endingWords(item.endingReason)}${doing}`;
    }
    case "review":
      return "Handed off: its diff and criteria wait for your review";
    case "confirm_exit_test":
      return item.exitTest ?? (item.record.kind === "epic" ? "Every Story is Merged or Dropped" : "Every Epic is Done");
    case "shaping_round": {
      const round = item.round;
      if (!round) return null;
      const verb = round.subject === "roadmap" ? "decided" : "answered";
      const progress = `${round.answered} of ${round.questions} ${verb}`;
      return round.waitingOnYou
        ? `${roundName(item)} · ${progress}`
        : `${roundName(item)} · No live session: your ${round.subject === "roadmap" ? "decisions" : "answers"} are kept`;
    }
    default:
      return null;
  }
}

/** Re-renders every half minute, for the ages. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The ranked list, as the column and the Sheet both draw it. */
export function NeedsYouList({ projectId, className }: { projectId: string; className?: string }) {
  const query = useNeedsYou(projectId);
  const items = query.data ?? [];
  const now = useNow();
  if (query.isError) {
    return <p className="m-0 text-small text-destructive-text">{`Could not read Needs you: ${errorText(query.error)}`}</p>;
  }
  if (query.isSuccess && items.length === 0) {
    return (
      <div className={cn("flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-4 shadow-card", className)}>
        <span className="text-row font-semibold">Nothing needs you</span>
        <span className="text-small text-muted-foreground">
          A request, a stopped agent, a Story to review or a Round to answer shows here, most urgent first.
        </span>
      </div>
    );
  }
  return (
    <ol aria-label="Needs you, most urgent first" className={cn("m-0 flex list-none flex-col gap-2.5 p-0", className)}>
      {items.map((item) => (
        <NeedsYouCard key={`${item.kind}:${item.id}`} projectId={projectId} item={item} now={now} />
      ))}
    </ol>
  );
}

/** The count beside the heading and on the Sheet's button: yellow while anything in it waits on you. */
function NeedsYouCount({ items }: { items: NeedsYouItemDto[] }) {
  if (items.length === 0) return null;
  const waiting = items.some(isWaitingOnYou);
  return (
    <Badge
      variant={waiting ? "attention" : "secondary"}
      data-count="needs-you"
      className="h-5 min-w-5 rounded-md px-1.5 text-meta tabular-nums"
    >
      {items.length}
    </Badge>
  );
}

function Heading({ projectId, id }: { projectId: string; id: string }) {
  const items = useNeedsYou(projectId).data ?? [];
  return (
    <h2 id={id} className="m-0 flex items-center gap-2 px-0.5 text-section font-semibold">
      <BellRing aria-hidden="true" size={18} className="shrink-0" />
      Needs you
      <NeedsYouCount items={items} />
    </h2>
  );
}

/** The 400px column beside the roster: stays in view while the roster scrolls. */
export function NeedsYouColumn({ projectId }: { projectId: string }) {
  return (
    <section
      aria-labelledby="needs-you-heading"
      data-slot="needs-you"
      className="sticky top-0 flex max-h-[calc(100dvh-148px)] min-h-0 flex-col gap-2.5 self-start overflow-y-auto pb-1"
    >
      <Heading projectId={projectId} id="needs-you-heading" />
      <NeedsYouList projectId={projectId} />
    </section>
  );
}

/** Under 1280px: the top bar's Needs you button and the Sheet it opens. */
export function NeedsYouSheetButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const items = useNeedsYou(projectId).data ?? [];
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-label={items.length > 0 ? `Open Needs you, ${items.length} items` : "Open Needs you"}
        onClick={() => setOpen(true)}
      >
        <BellRing aria-hidden="true" />
        Needs you
        <NeedsYouCount items={items} />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[440px] gap-0 bg-background data-[side=right]:w-[440px] data-[side=right]:sm:max-w-[440px]"
        >
          <SheetHeader className="border-b border-border bg-card px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-section font-semibold">
              <BellRing aria-hidden="true" size={18} />
              Needs you
              <NeedsYouCount items={items} />
            </SheetTitle>
            <SheetDescription className="text-small text-muted-foreground">
              Most urgent first. Every action works here.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <NeedsYouList projectId={projectId} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The record an item is about: its key and title, opening the Story, the Epic or the Milestone. */
function RecordButton({ projectId, item }: { projectId: string; item: NeedsYouItemDto }) {
  const openStory = useUiStore((s) => s.openStory);
  const openEpic = useUiStore((s) => s.openEpic);
  const openMilestone = useUiStore((s) => s.openMilestone);
  const { record } = item;
  if (record.kind === "roadmap" || !record.id) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-row font-semibold">
        <Compass aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
        Roadmap
      </span>
    );
  }
  const id = record.id;
  const noun = record.kind === "story" ? "Story" : record.kind === "epic" ? "Epic" : "Milestone";
  const open = () => {
    if (record.kind === "story") openStory(projectId, id);
    else if (record.kind === "epic") openEpic(projectId, id);
    else openMilestone(projectId, id);
  };
  return (
    <button
      type="button"
      aria-label={`Open ${noun} ${[record.key, record.title].filter(Boolean).join(" ")}`}
      title={`Open ${noun} ${[record.key, record.title].filter(Boolean).join(" ")}`}
      onClick={open}
      className="group/record -mx-1.5 flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent"
    >
      {record.kind === "epic" && <Layers aria-hidden="true" size={15} className="shrink-0 self-center text-muted-foreground" />}
      {record.kind === "milestone" && <Flag aria-hidden="true" size={15} className="shrink-0 self-center text-muted-foreground" />}
      {record.key && <span className="shrink-0 font-mono text-meta text-muted-foreground">{record.key}</span>}
      <span className="min-w-0 flex-1 line-clamp-2 text-row font-semibold">{record.title}</span>
      <ChevronRight
        aria-hidden="true"
        size={16}
        className="shrink-0 self-center text-subtle-foreground transition-colors group-hover/record:text-foreground"
      />
    </button>
  );
}

/** The state an item's lead pill names: the attention it is in, or none for a decision about future work. */
function LeadPill({ item }: { item: NeedsYouItemDto }) {
  const kind = KIND[item.kind];
  const kindWord = (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-meta font-semibold text-muted-foreground [&_svg]:size-[15px] [&_svg]:shrink-0">
      {kind.icon}
      <span className="truncate">{item.kind === "stopped" && item.missingWorktree ? "Missing worktree" : kind.word}</span>
    </span>
  );
  if (isWaitingOnYou(item)) {
    return (
      <>
        <StateBadge state="waiting_on_you" className="h-5.5 text-meta" />
        {kindWord}
      </>
    );
  }
  if (item.kind === "stopped") {
    return (
      <>
        <StateBadge state="stopped" className="h-5.5 text-meta" />
        {item.missingWorktree && kindWord}
      </>
    );
  }
  if (item.kind === "review") return <StateBadge state="in_review" className="h-5.5 text-meta" />;
  if (item.kind === "shaping_round") return <StateBadge state="round_waiting" className="h-5.5 text-meta" />;
  return (
    <Badge variant="outline" className="h-5.5 text-meta">
      {kind.icon}
      {kind.word}
    </Badge>
  );
}

function NeedsYouCard({ projectId, item, now }: { projectId: string; item: NeedsYouItemDto; now: number }) {
  const waiting = isWaitingOnYou(item);
  const detail = detailOf(item);
  const age = formatAge(item.since, now);
  const request = item.request;
  return (
    <li
      data-kind={item.kind}
      data-item-id={item.id}
      data-attention={waiting ? "waiting" : item.kind === "stopped" ? "stopped" : undefined}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-card",
        waiting ? "border-2 border-attention" : "border-border",
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-1.5 px-4 pt-3", waiting && "bg-attention-muted", request ? "pb-3" : "pb-3.5")}>
        <div className="flex min-w-0 items-center gap-2">
          <LeadPill item={item} />
          <span
            aria-label={`Waiting ${age}`}
            title={item.since.replace("T", " ").slice(0, 16)}
            className="ml-auto shrink-0 text-meta text-subtle-foreground tabular-nums"
          >
            {age}
          </span>
        </div>
        <RecordButton projectId={projectId} item={item} />
        {detail && (
          <p
            data-field="detail"
            title={detail}
            className={cn("m-0 truncate text-small text-muted-foreground", item.kind === "confirm_exit_test" && "line-clamp-2 whitespace-normal")}
          >
            {detail}
          </p>
        )}
        {!request && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <ItemAction projectId={projectId} item={item} />
          </div>
        )}
      </div>
      {request && <RequestBand item={item} />}
    </li>
  );
}

/** A request's card, as a band across the item: Allow once and Deny, or the question's answers. */
function RequestBand({ item }: { item: NeedsYouItemDto }) {
  const queryClient = useQueryClient();
  const request = item.request!;
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: needsYouQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    if (item.sessionId) void queryClient.invalidateQueries({ queryKey: pendingPermissionRequestsQueryKey(item.sessionId) });
  }
  return (
    // The band's own bottom rule would double the card's edge, so the card's edge closes it.
    <div className="px-5 [&_[data-card]]:border-b-0">
      <RequestInCard.Provider value>
        <PermissionRequestCard
          variant="compact"
          keyboardEnabled={false}
          requests={[
            {
              id: request.id,
              toolName: request.toolName,
              inputPayload: request.inputPayload,
              destructiveCategory: request.destructiveCategory,
              suggestedRule: request.suggestedRule,
            },
          ]}
          onAnswer={async (requestId: string, decision: PermissionDecision, rule?: string) => {
            await answerPermissionRequest(requestId, decision, rule);
            refresh();
          }}
          onAnswerQuestion={async (requestId, picks) => {
            await answerQuestion(requestId, picks);
            refresh();
          }}
        />
      </RequestInCard.Provider>
    </div>
  );
}

function ItemAction({ projectId, item }: { projectId: string; item: NeedsYouItemDto }) {
  const openStory = useUiStore((s) => s.openStory);
  const { record } = item;
  switch (item.kind) {
    case "stopped":
      if (!record.id || !record.key) return null;
      return item.missingWorktree ? (
        <RecreateWorktree storyId={record.id} storyKey={record.key} />
      ) : (
        <ResumeControl story={{ id: record.id, key: record.key }} />
      );
    case "review":
      if (!record.id) return null;
      return (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Open review of ${record.key ?? ""} ${record.title}`.replace("  ", " ")}
          onClick={() => openStory(projectId, record.id as string)}
        >
          <GitPullRequest aria-hidden="true" />
          Open review
        </Button>
      );
    case "confirm_exit_test": {
      if (!record.id) return null;
      const subject: ExitTestSubject =
        record.kind === "epic"
          ? {
              kind: "epic",
              id: record.id,
              key: record.key ?? "",
              title: record.title,
              exitTest: item.exitTest,
              milestoneTitle: item.milestoneTitle,
            }
          : { kind: "milestone", id: record.id, title: record.title, exitTest: item.exitTest, state: record.state ?? "ready" };
      return <ConfirmExitTest projectId={projectId} subject={subject} place="card" className="justify-start" />;
    }
    case "shaping_round":
      return <RoundAction projectId={projectId} item={item} />;
    default:
      return null;
  }
}

/** Answer (or Decide) while a live session is held on the Round; Continue shaping while none works it. */
function RoundAction({ projectId, item }: { projectId: string; item: NeedsYouItemDto }) {
  const openEpic = useUiStore((s) => s.openEpic);
  const openMilestone = useUiStore((s) => s.openMilestone);
  const { record } = item;
  const round = item.round;
  if (!round) return null;
  if (round.waitingOnYou) {
    const roadmap = round.subject === "roadmap";
    return (
      <Button
        variant="attention"
        size="sm"
        aria-label={roadmap ? `Decide ${roundName(item)}` : `Answer ${roundName(item)} of ${[record.key, record.title].filter(Boolean).join(" ")}`}
        onClick={() => {
          if (roadmap) {
            // The roadmap Round is decided on the Roadmap strip, on this board.
            const band = document.querySelector<HTMLElement>("[data-slot=roadmap-round-band]");
            band?.scrollIntoView({ block: "nearest" });
            band?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
          } else if (record.kind === "milestone" && record.id) openMilestone(projectId, record.id);
          else if (record.id) openEpic(projectId, record.id);
        }}
      >
        <MessageCircleQuestionMark aria-hidden="true" />
        {roadmap ? "Decide" : "Answer"}
      </Button>
    );
  }
  if (round.subject === "roadmap") return <ContinueRoadmapRound projectId={projectId} />;
  if (!record.id) return null;
  if (record.kind === "milestone") return <ContinueMilestoneShapingButton projectId={projectId} milestone={{ id: record.id, title: record.title }} />;
  return <ContinueShapingButton projectId={projectId} epic={{ id: record.id, key: record.key ?? "", title: record.title }} />;
}

/** Continue a roadmap Round no session works: `roadmap_revisit` picks the open Round up. */
function ContinueRoadmapRound({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label="Continue the roadmap Round"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          setError(null);
          roadmapRevisit(projectId)
            .then(() => queryClient.invalidateQueries({ queryKey: ["board", projectId, "roadmap-round"] }))
            .catch((err: unknown) => setError(`Could not continue the roadmap Round: ${errorText(err)}`))
            .finally(() => setStarting(false));
        }}
      >
        <RotateCcw aria-hidden="true" />
        {starting ? "Starting…" : "Continue"}
      </Button>
      {error && (
        <p role="alert" className="m-0 basis-full text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </>
  );
}

/** Recreate a missing worktree (D-45) on the Story's branch; Resume then starts from it. */
function RecreateWorktree({ storyId, storyKey }: { storyId: string; storyKey: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        aria-label={`Recreate the worktree of ${storyKey}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          worktreeRecreate(storyId)
            .catch((err: unknown) => setError(`Could not recreate the worktree: ${errorText(err)}`))
            .finally(() => setBusy(false));
        }}
      >
        <Box aria-hidden="true" />
        {busy ? "Recreating…" : "Recreate worktree"}
      </Button>
      {error && (
        <p role="alert" className="m-0 basis-full text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </>
  );
}
