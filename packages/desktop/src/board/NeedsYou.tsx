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
 * - a judged-on change (issue #163), ranked with Review: its before and after, and Accept, Edit and Reject
 *   in place (`JudgedOnChange`);
 * - Confirm exit test: the same control and dialog as the Epic card and the Milestone header;
 * - the Proposals row (issue #162): Triage, which opens the triage drawer;
 * - a Shaping Round: Answer (Decide for a roadmap Round) while a live session is held on it, else Continue
 *   shaping (Continue for a roadmap Round), which starts a fresh session and keeps you where you are.
 *
 * Yellow is Waiting on you only: a card wears the attention edge and tint only while a live session is held on
 * it. A Stopped Story wears the red Stopped pill; every other kind is neutral, told apart by its icon and word.
 * Its record (the key and title, with the trailing chevron) opens the Story, the Epic or the Milestone.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Box,
  ChevronRight,
  CircleCheckBig,
  CircleDashed,
  Compass,
  Flag,
  GitMergeConflict,
  GitPullRequest,
  KeyRound,
  Layers,
  Lightbulb,
  MessageCircleQuestionMark,
  RotateCcw,
  Scale,
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
import {
  PermissionRequestCard,
  RequestHeaderless,
  type PermissionDecision,
} from "../session/PermissionRequestCard";
import { questionsFromPayload } from "../session/feedRows";
import { useUiStore } from "../state/uiStore";
import { blockedQueueQueryKey, needsYouQueryKey, useNeedsYou } from "../fleet/useFleet";
import { pendingPermissionRequestsQueryKey } from "./useBoardQuery";
import { ResumeControl, endingWords, errorText } from "./StoryControls";
import { ConfirmExitTest, type ExitTestSubject } from "./ConfirmExitTest";
import { JudgedOnChange, judgedOnWord } from "./JudgedOnChange";
import { ContinueShapingButton } from "./EpicShapingControl";
import { ContinueMilestoneShapingButton } from "./MilestoneShapingControl";
import { TriageButton } from "../proposals/ProposalDrawer";
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
  judged_on: { word: "Judged-on change", icon: <Scale /> },
  confirm_exit_test: { word: "Confirm exit test", icon: <CircleCheckBig /> },
  proposals: { word: "Proposals", icon: <Lightbulb /> },
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
      return item.conflicts.length > 0
        ? `Merging would conflict in ${item.conflicts.join(", ")}: request a rebase from its review`
        : "Handed off: its diff and criteria wait for your review";
    case "proposals":
      return item.proposals ? landingWords(item.proposals) : null;
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
    case "question": {
      const questions = questionsFromPayload(item.request?.inputPayload ?? null);
      if (questions.length === 0) return null;
      const lead = questions.length > 1 ? `${questions.length} questions: ` : "";
      return `${lead}${questions[0].question}`;
    }
    default:
      return null;
  }
}

/** "n from m Stories": the Proposals row's record line (spec §5 "One row"). */
export function proposalsWords(p: { count: number; stories: number }): string {
  return `${p.count} from ${p.stories} ${p.stories === 1 ? "Story" : "Stories"}`;
}

/** Where the Proposals land: "On 2 Epics and the Roadmap". */
function landingWords(p: { epics: number; roadmap: boolean }): string {
  const epics = p.epics === 0 ? null : p.epics === 1 ? "1 Epic" : `${p.epics} Epics`;
  return `On ${[epics, p.roadmap ? "the Roadmap" : null].filter(Boolean).join(" and ")}`;
}

/** Whether an item's action is one that may be the column's one filled primary (DESIGN.md "The One Filled
 * Action Rule"): Resume, Recreate worktree, Confirm exit test. */
function takesPrimary(item: NeedsYouItemDto): boolean {
  return item.kind === "stopped" || item.kind === "confirm_exit_test";
}

const keyOf = (item: NeedsYouItemDto) => `${item.kind}:${item.id}`;

/** "FLY-5", "Epic FLY-8", "Milestone Shaping", "the Roadmap": how the live region names a record. */
function recordWords(item: NeedsYouItemDto): string {
  const { record } = item;
  if (item.kind === "proposals") return "Proposals";
  if (record.kind === "roadmap") return "the Roadmap";
  if (record.kind === "story") return record.key ?? record.title;
  if (record.kind === "epic") return `Epic ${record.key ?? record.title}`;
  return `Milestone ${record.title}`;
}

function countWords(n: number): string {
  return n === 0 ? "Nothing needs you." : n === 1 ? "1 item needs you." : `${n} items need you.`;
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

/**
 * The ranked list, as the column and the Sheet both draw it. Only the first card whose action can be a filled
 * primary draws it filled; every other card's is an outline (one filled primary per region). When an action
 * done here takes its card off the list, the keyboard moves to the card now in its place (or to the empty
 * state), and a polite live region says what went and how many are left.
 */
export function NeedsYouList({ projectId, className }: { projectId: string; className?: string }) {
  const query = useNeedsYou(projectId);
  const items = query.data ?? [];
  const now = useNow();
  const listRef = useRef<HTMLOListElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  /** The card holding the keyboard, by key and place, so it can be replaced once it leaves the list. */
  const focused = useRef<{ key: string; index: number } | null>(null);
  const previous = useRef<NeedsYouItemDto[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const keys = items.map(keyOf).join("|");

  useEffect(() => {
    if (!query.isSuccess) return;
    const before = previous.current;
    previous.current = items;
    if (!before) return;
    const now = new Set(items.map(keyOf));
    const gone = before.filter((item) => !now.has(keyOf(item)));
    if (gone.length === 0) return;
    setAnnouncement(`${gone.map(recordWords).join(", ")} off the list. ${countWords(items.length)}`);
    const was = focused.current;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (!was || !lost || !gone.some((item) => keyOf(item) === was.key)) return;
    requestAnimationFrame(() => {
      const cards = listRef.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [];
      const card = cards[Math.min(was.index, cards.length - 1)];
      const target = card?.querySelector<HTMLElement>("[data-record], button") ?? emptyRef.current;
      target?.focus({ preventScroll: false });
    });
    // `keys` stands for `items`: the effect runs when the list's membership changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, query.isSuccess]);

  const live = (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  );
  if (query.isError) {
    return <p className="m-0 text-small text-destructive-text">{`Could not read Needs you: ${errorText(query.error)}`}</p>;
  }
  if (query.isSuccess && items.length === 0) {
    return (
      <div
        ref={emptyRef}
        tabIndex={-1}
        className={cn("flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-4 shadow-card", className)}
      >
        {live}
        <span className="text-row font-semibold">Nothing needs you</span>
        <span className="text-small text-muted-foreground">
          A request, a stopped agent, a Story to review, a change to what a Story is judged on, a Proposal or a Round to
          answer shows here, most urgent first.
        </span>
      </div>
    );
  }
  const filled = items.findIndex((item) => !isWaitingOnYou(item) && takesPrimary(item));
  return (
    <>
      {live}
      <ol
        ref={listRef}
        aria-label="Needs you, most urgent first"
        className={cn("m-0 flex list-none flex-col gap-2.5 p-0", className)}
      >
        {items.map((item, index) => (
          <NeedsYouCard
            key={keyOf(item)}
            projectId={projectId}
            item={item}
            now={now}
            filled={index === filled}
            onFocusCard={() => {
              focused.current = { key: keyOf(item), index };
            }}
          />
        ))}
      </ol>
    </>
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
  if (item.kind === "proposals" && item.proposals) {
    // Inert: the row opens nothing itself; Triage opens the drawer.
    return <span className="text-row font-semibold tabular-nums">{proposalsWords(item.proposals)}</span>;
  }
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
      data-record=""
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
  if (item.kind === "review") {
    return (
      <>
        <StateBadge state="in_review" className="h-5.5 text-meta" />
        {item.conflicts.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-meta font-semibold text-muted-foreground [&_svg]:size-[15px] [&_svg]:shrink-0">
            <GitMergeConflict aria-hidden="true" />
            <span className="truncate">Rebase needed</span>
          </span>
        )}
      </>
    );
  }
  if (item.kind === "shaping_round") return <StateBadge state="round_waiting" className="h-5.5 text-meta" />;
  return (
    <Badge variant="outline" className="h-5.5 text-meta">
      {kind.icon}
      {item.kind === "judged_on" && item.judgedOn ? judgedOnWord(item.judgedOn) : kind.word}
    </Badge>
  );
}

function NeedsYouCard({
  projectId,
  item,
  now,
  filled,
  onFocusCard,
}: {
  projectId: string;
  item: NeedsYouItemDto;
  now: number;
  /** This card's action is the column's one filled primary. */
  filled: boolean;
  onFocusCard: () => void;
}) {
  const waiting = isWaitingOnYou(item);
  const detail = detailOf(item);
  const age = formatAge(item.since, now);
  const request = item.request;
  return (
    <li
      data-kind={item.kind}
      data-item-id={item.id}
      data-attention={waiting ? "waiting" : item.kind === "stopped" ? "stopped" : undefined}
      onFocus={onFocusCard}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-card",
        waiting ? "border-2 border-attention" : "border-border",
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-1.5 px-4 pt-3", waiting && "bg-attention-muted", request ? "pb-3" : "pb-3.5")}>
        <div className="flex min-w-0 items-center gap-2">
          <LeadPill item={item} />
          <time
            dateTime={item.since}
            title={item.since.replace("T", " ").slice(0, 16)}
            className="ml-auto shrink-0 text-meta text-subtle-foreground tabular-nums"
          >
            <span className="sr-only">Waiting </span>
            {age}
          </time>
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
        {item.kind === "judged_on" && item.judgedOn && (
          <div className="mt-1 min-w-0">
            <JudgedOnChange item={item} />
          </div>
        )}
        {!request && item.kind !== "judged_on" && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <ItemAction projectId={projectId} item={item} filled={filled} />
          </div>
        )}
      </div>
      {request && <RequestBand item={item} />}
    </li>
  );
}

/**
 * A request's card inside the item, under its record: the literal command and Deny / Allow once (Deny leading on
 * a Gated action), or the question's form. The card's own yellow header is left out (`RequestHeaderless`): the
 * lead line already names the kind and the attention edge carries the yellow. A question folds to Answer, which
 * opens its form in place, so one question never fills the column.
 */
function RequestBand({ item }: { item: NeedsYouItemDto }) {
  const queryClient = useQueryClient();
  const request = item.request!;
  const question = item.kind === "question";
  const [open, setOpen] = useState(!question);
  const formId = `needs-you-request-${request.id}`;
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: needsYouQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    if (item.sessionId) void queryClient.invalidateQueries({ queryKey: pendingPermissionRequestsQueryKey(item.sessionId) });
  }
  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-attention/60 px-4 pt-3 pb-4">
      {question && (
        <Button
          variant="attention"
          size="sm"
          className="self-start"
          aria-expanded={open}
          aria-controls={formId}
          aria-label={`Answer ${item.record.key ?? ""}'s question`.trim()}
          onClick={() => setOpen((was) => !was)}
        >
          <MessageCircleQuestionMark aria-hidden="true" />
          {open ? "Hide the questions" : "Answer"}
        </Button>
      )}
      {open && (
        <div id={formId}>
          <RequestHeaderless.Provider value>
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
          </RequestHeaderless.Provider>
        </div>
      )}
    </div>
  );
}

function ItemAction({ projectId, item, filled }: { projectId: string; item: NeedsYouItemDto; filled: boolean }) {
  const openStory = useUiStore((s) => s.openStory);
  const { record } = item;
  switch (item.kind) {
    case "stopped":
      if (!record.id || !record.key) return null;
      return item.missingWorktree ? (
        <RecreateWorktree storyId={record.id} storyKey={record.key} filled={filled} />
      ) : (
        <ResumeControl story={{ id: record.id, key: record.key }} variant={filled ? "default" : "outline"} />
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
      return <ConfirmExitTest projectId={projectId} subject={subject} place="card" outline={!filled} className="justify-start" />;
    }
    case "proposals":
      return <TriageButton projectId={projectId} count={item.proposals?.count ?? 0} />;
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
function RecreateWorktree({ storyId, storyKey, filled }: { storyId: string; storyKey: string; filled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={filled ? "default" : "outline"}
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
