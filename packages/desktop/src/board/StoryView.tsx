/**
 * One Story, opened from its row anywhere it is shown (issue #104), drawn as the Andon mockup's Story
 * panel (#107). It says where the developer is (project, then Story), offers Back, and gathers everything
 * the M2 flow does to a Story in visible controls: Start, Resume, Drop, the Task checklist, the Acceptance
 * criteria with their Checks, and the session list.
 *
 * While an agent works on the Story, its station sits under the title: a graphite block naming the live
 * session and what it is doing, with Open session (or Answer, while it waits on you). Opening a Story never
 * opens its session: the live agent opens only from that control; past sessions open from "Open feed".
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tip } from "@/components/Tip";
import { useQuery } from "@tanstack/react-query";
import { Bot, CircleCheck, ListChecks, Terminal } from "lucide-react";
import { blockedSummary, storyGet, storyMakeReadyOffer, worktreeSummary, type StoryDto } from "../adapters/tauri";
import { CriteriaList, checkPasses, useCriteria } from "./CriteriaList";
import {
  AnswerControl,
  DropControl,
  ListSkeleton,
  MakeReadyControl,
  OpenSessionControl,
  PacketSize,
  ResumeControl,
  SessionList,
  StartControl,
  StopControl,
  StoryStateWord,
  endingWords,
  formatWhen,
  useLiveSession,
  useStopped,
  useStorySessions,
} from "./StoryControls";
import { TaskChecklist, useStoryTasks } from "./TaskChecklist";
import { useBoardChangedSubscription, useSessionFeed } from "./useBoardQuery";
import { WriteStoryDialog } from "./WriteStoryDialog";
import { ReviewCard } from "../review/ReviewCard";
import { MoveToEpicControl } from "./MoveToEpic";
import { ReadError } from "../components/ReadError";
import { StateBadge } from "../components/StateBadge";
import { StoryKey } from "../components/StoryKey";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAge } from "../legend/runStatus";
import { prefersReducedMotion, ToolCallLine } from "../session/FeedRow";
import { buildFeedRows, findLiveCallKey, type FeedRowData } from "../session/feedRows";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
import { cn } from "@/lib/utils";

/** The read of one Story, keyed under the project so `board:changed` keeps it live. The sidebar reads
 * the same key to name the current Story. */
export function storyQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "story", storyId] as const;
}

export interface StoryViewProps {
  projectId: string;
  projectName: string;
  storyId: string;
  onBack: () => void;
}

export function StoryView({ projectId, projectName, storyId, onBack }: StoryViewProps) {
  useBoardChangedSubscription(projectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const storyQuery = useQuery({
    queryKey: storyQueryKey(projectId, storyId),
    queryFn: () => storyGet(storyId),
  });
  const story = storyQuery.data ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        onBack={onBack}
        crumbs={[
          {
            label: projectName,
            onSelect: () => setCurrentProjectId(projectId),
            ariaLabel: `Open the ${projectName} board`,
          },
          ...(story ? [{ label: story.key, mono: true }] : []),
        ]}
        actions={<WriteStoryDialog projectId={projectId} />}
      />
      <SurfaceBody>
        {/* One width for every surface of cards (DESIGN.md § Layout): up to 1240px, centred. */}
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4">
          {storyQuery.isError && <ReadError title="Couldn't load this Story" query={storyQuery} />}
          {storyQuery.isPending && <TitleCardSkeleton />}
          {storyQuery.isSuccess && !story && (
            <p className="m-0 text-body text-muted-foreground">This Story no longer exists.</p>
          )}
          {story && <StoryBody projectId={projectId} story={story} />}
        </div>
      </SurfaceBody>
    </div>
  );
}

function Panel({
  id,
  title,
  icon,
  count,
  children,
  className,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("rounded-lg border border-border bg-card shadow-card", className)}>
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-[18px]">
          {icon}
        </span>
        <h2 id={id} className="m-0 text-section font-semibold">
          {title}
        </h2>
        {count}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function Count({ done, total, label }: { done: number; total: number; label: string }) {
  if (total === 0) return null;
  return (
    <span className="text-body text-muted-foreground tabular-nums" aria-label={`${done} of ${total} ${label}`}>
      {`${done}/${total}`}
    </span>
  );
}

/** How many lines the station's live tail shows: enough to read the agent's pace at a glance. */
export const STATION_TAIL_LENGTH = 4;

type CallRow = Extract<FeedRowData, { kind: "tool_call" }>;
type TurnRow = Extract<FeedRowData, { kind: "assistant_text" }>;

/**
 * The live tail's lines, oldest first: the agent's last tool calls and, when it came among them, its
 * newest turn, as the mockup's station interleaves them. At most one turn, so the calls keep the room.
 */
export function stationTail(rows: FeedRowData[], length = STATION_TAIL_LENGTH): (CallRow | TurnRow)[] {
  const tail: (CallRow | TurnRow)[] = [];
  let sawTurn = false;
  for (let i = rows.length - 1; i >= 0 && tail.length < length; i -= 1) {
    const row = rows[i];
    if (row.kind === "tool_call") tail.unshift(row);
    else if (row.kind === "assistant_text" && !sawTurn && row.text.trim() !== "") {
      sawTurn = true;
      tail.unshift(row);
    }
  }
  return tail;
}

/** A turn as one plain line: its first non-empty line, with markdown's emphasis and code marks removed. */
function turnLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/[*_`]+/g, "")
    .replace(/^\s*[-#>]+\s*/, "")
    .trim();
}

/** Re-renders every second, for the station's "last activity" age. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The live tail: the last few lines of the session, worded as the feed words them, the call in flight
 * with its running clock. On graphite the list takes the `dark` scope, so running ink and a failed Check's
 * red read in their dark-ground values (direction.md § Colour: the brand hue is lifted on dark grounds). */
function LiveTail({ rows, waitingOnYou, root }: { rows: FeedRowData[]; waitingOnYou: boolean; root: string | null }) {
  const tail = stationTail(rows);
  // While the session waits on you, the unanswered call is held, not running: it never wears the clock.
  const liveKey = waitingOnYou ? null : findLiveCallKey(rows);
  if (tail.length === 0) return null;
  return (
    <ol
      aria-label="Last tool calls"
      className={cn(
        "m-0 flex list-none flex-col border-t px-0 pt-1.5",
        waitingOnYou ? "border-border" : "dark border-white/15 text-strip-foreground",
      )}
    >
      {tail.map((row) =>
        row.kind === "tool_call" ? (
          <li
            key={row.key}
            className="flex min-w-0 items-center gap-2.5 py-1"
            data-live={row.key === liveKey ? "true" : undefined}
          >
            <ToolCallLine row={row} live={row.key === liveKey} surface={waitingOnYou ? "card" : "strip"} root={root} />
          </li>
        ) : (
          <li key={row.key} className="flex min-w-0 items-center gap-2.5 py-1" data-turn="true">
            <Bot
              aria-hidden="true"
              size={16}
              className={cn("shrink-0", waitingOnYou ? "text-muted-foreground" : "text-strip-muted-foreground")}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-small",
                waitingOnYou ? "text-foreground" : "text-strip-foreground",
              )}
            >
              {turnLine(row.text)}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

/**
 * The live agent on this Story, as the Andon mockup's station: what it is doing, its session and pace
 * (session n · how long · last activity), the way into its session (Open session, or Answer while it waits
 * on you), Stop, and the live tail. Graphite while the agent works; the yellow tint while it waits on you.
 */
function AgentStation({
  projectId,
  story,
  waitingOnYou,
}: {
  projectId: string;
  story: StoryDto;
  waitingOnYou: boolean;
}) {
  const live = useLiveSession(projectId, story);
  if (!live) return null;
  return (
    <LiveStation
      projectId={projectId}
      story={story}
      sessionId={live.id}
      startedAt={live.startedAt}
      waitingOnYou={waitingOnYou}
    />
  );
}

function LiveStation({
  projectId,
  story,
  sessionId,
  startedAt,
  waitingOnYou,
}: {
  projectId: string;
  story: StoryDto;
  sessionId: string;
  startedAt: string;
  waitingOnYou: boolean;
}) {
  const tasks = useStoryTasks(projectId, story.id).data ?? [];
  // The same read as the session list, so the ordinal matches what it shows (newest first).
  const sessions = useStorySessions(projectId, story.id).data ?? [];
  const feedQuery = useSessionFeed(sessionId);
  // The Story's worktree, against which the tail's paths and commands read relative, as the feed's do (#205).
  const { data: worktree } = useQuery({
    queryKey: ["session-worktree", story.id],
    queryFn: () => worktreeSummary(story.id).catch(() => null),
    retry: false,
  });
  const entries = useMemo(() => feedQuery.data?.pages.flatMap((page) => page.entries) ?? [], [feedQuery.data]);
  const rows = useMemo(() => buildFeedRows(entries), [entries]);
  const now = useNow();
  const doing = tasks.find((task) => task.state === "doing");
  const pulse = !waitingOnYou && !prefersReducedMotion();
  const index = sessions.findIndex((session) => session.id === sessionId);
  const ordinal = index >= 0 ? sessions.length - index : null;
  // The newest entry of any kind is the agent's last sign of life, rows or not (a heartbeat counts).
  const lastActivityAt = [...entries].reverse().find((entry) => typeof entry.at === "string")?.at as string | undefined;
  const pace = [
    ordinal ? `Session ${ordinal}` : "Live session",
    formatAge(startedAt, now),
    lastActivityAt ? `last activity ${formatAge(lastActivityAt, now)} ago` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      aria-label="Live agent"
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-5 py-4",
        waitingOnYou
          ? "border-attention bg-attention-muted text-foreground"
          : "border-border bg-strip text-strip-foreground",
      )}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
            waitingOnYou ? "bg-attention text-attention-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          <Bot size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-row font-semibold">
            {doing ? doing.title : "Reading the Story and the code it touches"}
          </span>
          <Tip content={`Started ${formatWhen(startedAt)}`}>
            <span
              className={cn(
                "flex flex-wrap items-center gap-2 text-small tabular-nums",
                waitingOnYou ? "text-muted-foreground" : "text-strip-muted-foreground",
              )}
            >
              <StateBadge
                state={waitingOnYou ? "waiting_on_you" : "running"}
                pulse={pulse}
                className="h-5.5 text-meta"
              />
              {pace}
            </span>
          </Tip>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {waitingOnYou ? (
            <AnswerControl projectId={projectId} story={story} />
          ) : (
            <OpenSessionControl projectId={projectId} story={story} variant="default" />
          )}
          <StopControl story={story} sessionId={sessionId} onStrip={!waitingOnYou} />
        </span>
      </div>
      <LiveTail rows={rows} waitingOnYou={waitingOnYou} root={worktree?.path ?? null} />
    </section>
  );
}

/** The title card while the Story's first read is under way: bars in its shape, never "Loading…". */
function TitleCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the Story"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-card"
    >
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

/**
 * The Story's title, clamped to three lines with the key before it (issue #204: a 200-character title must
 * not push the station off a 900 × 600 window). When the clamp hides part of it, "Show full title" unclamps it
 * in place and "Show less" clamps it again; the heading's accessible name is always the whole title.
 */
function StoryTitle({ story }: { story: StoryDto }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const heading = ref.current;
    if (!heading || expanded) return;
    const measure = () => setClamped(heading.scrollHeight > heading.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    return () => observer.disconnect();
  }, [expanded, story.title]);

  return (
    <div className="flex min-w-0 flex-1 basis-80 flex-col items-start gap-1">
      <h1
        ref={ref}
        id="story-heading"
        data-slot="story-title"
        className={cn(
          "m-0 min-w-0 self-stretch text-title font-semibold text-pretty break-words",
          !expanded && "line-clamp-3",
        )}
      >
        <StoryKey value={story.key} size="small" className="mr-1.5 align-[3px]" /> {story.title}
      </h1>
      {(clamped || expanded) && (
        <Button
          variant="link"
          size="xs"
          aria-expanded={expanded}
          aria-controls="story-heading"
          onClick={() => setExpanded((open) => !open)}
          className="h-auto px-0 text-small"
        >
          {expanded ? "Show less" : "Show full title"}
        </Button>
      )}
    </div>
  );
}

function StoryBody({ projectId, story }: { projectId: string; story: StoryDto }) {
  const [error, setError] = useState<string | null>(null);
  const tasksQuery = useStoryTasks(projectId, story.id);
  const criteriaQuery = useCriteria(projectId, story.id);
  const tasks = tasksQuery.data ?? [];
  const criteria = criteriaQuery.data ?? [];
  const stopped = useStopped(projectId, story);
  // The same read the board's rows use, so the two never disagree on Waiting on you.
  const waitingQuery = useQuery({
    queryKey: ["board", projectId, "waiting-on-you"],
    queryFn: () => blockedSummary(projectId),
  });
  const waitingOnYou = !stopped && (waitingQuery.data?.blockedStoryIds ?? []).includes(story.id);
  const open = story.state !== "merged" && story.state !== "dropped";
  const liveTasks = tasks.filter((task) => task.state !== "dropped");
  const doneTasks = liveTasks.filter((task) => task.state === "done").length;
  const passing = criteria.filter(checkPasses).length;
  // In review, the review card holds the criteria (issue #155): they are accepted there, not listed twice.
  const inReview = story.state === "in_review";
  // A Shaping Story whose Epic's shaping is closed is made Ready here (issue #166); the core says whether.
  const makeReady = useQuery({
    queryKey: ["board", projectId, "make-ready", story.id],
    queryFn: () => storyMakeReadyOffer(story.id),
    enabled: story.state === "shaping",
  }).data;
  const makeReadyOffered = story.state === "shaping" && makeReady?.offered === true;

  return (
    <>
      <section
        aria-labelledby="story-heading"
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-card",
          waitingOnYou && "border-attention",
        )}
      >
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <StoryTitle story={story} />
          {/* The title card's one next action is its one filled primary; Move is outline and Drop is text. */}
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {story.state === "ready" && <StartControl story={story} onError={setError} variant="default" />}
            {makeReadyOffered && (
              <MakeReadyControl
                story={story}
                refusal={makeReady?.refusal ?? null}
                onError={setError}
                variant="default"
              />
            )}
            {stopped && <ResumeControl story={story} variant="default" />}
            {open && <MoveToEpicControl projectId={projectId} story={story} onError={setError} />}
            {open && <DropControl story={story} />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small text-muted-foreground">
          <StoryStateWord story={story} stopped={stopped} waitingOnYou={waitingOnYou} withReason />
          {liveTasks.length > 0 && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <ListChecks aria-hidden="true" size={16} />
              {`Tasks ${doneTasks}/${liveTasks.length}`}
            </span>
          )}
          {criteria.length > 0 && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CircleCheck aria-hidden="true" size={16} />
              {`Checks ${passing}/${criteria.length}`}
            </span>
          )}
          {open && <PacketSize story={story} />}
        </div>
        {stopped && (
          <p className="m-0 text-small text-muted-foreground">
            {`The last session ended (${endingWords(stopped.endingReason)})${
              stopped.endedAt ? ` at ${formatWhen(stopped.endedAt)}` : ""
            } without handing off. Resume starts a fresh session from the Context packet.`}
          </p>
        )}
        {makeReadyOffered && makeReady?.refusal && (
          <p className="m-0 text-small text-muted-foreground">{`Make Ready waits: ${makeReady.refusal}.`}</p>
        )}
        {error && (
          <p role="alert" className="m-0 text-small text-destructive-text">
            {error}
          </p>
        )}
        {story.description && <p className="m-0 max-w-[75ch] text-body whitespace-pre-wrap">{story.description}</p>}
      </section>

      <AgentStation projectId={projectId} story={story} waitingOnYou={waitingOnYou} />

      {inReview && (
        <ReviewCard projectId={projectId} story={story} onMerged={(outcome) => setError(outcome.cleanupWarning)} />
      )}

      <div className={cn("grid grid-cols-1 items-start gap-4", !inReview && "lg:grid-cols-2")}>
        {!inReview && (
          <Panel
            id="story-criteria-heading"
            title="Acceptance criteria"
            icon={<CircleCheck />}
            count={<Count done={passing} total={criteria.length} label="criteria passing their Check" />}
          >
            <CriteriaList projectId={projectId} storyId={story.id} storyKey={story.key} />
          </Panel>
        )}
        <Panel
          id="story-tasks-heading"
          title="Tasks"
          icon={<ListChecks />}
          count={<Count done={doneTasks} total={liveTasks.length} label="Tasks done" />}
        >
          {/* The empty checklist shows only once the read succeeded: a failed read is never "No Tasks yet". */}
          {tasksQuery.isError ? (
            <ReadError title="Couldn't load the Tasks" query={tasksQuery} />
          ) : tasksQuery.isPending ? (
            <ListSkeleton rows={3} label="Loading the Tasks" />
          ) : (
            <TaskChecklist storyKey={story.key} storyId={story.id} tasks={tasks} />
          )}
        </Panel>
      </div>

      {story.state !== "shaping" && story.state !== "ready" && (
        <Panel id="story-sessions-heading" title="Sessions" icon={<Terminal />}>
          <SessionList projectId={projectId} story={story} />
        </Panel>
      )}
    </>
  );
}
