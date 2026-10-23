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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, CircleCheck, ListChecks, Terminal } from "lucide-react";
import { blockedSummary, sessionsForStory, storyGet, type StoryDto } from "../adapters/tauri";
import { CriteriaList, checkPasses, useCriteria } from "./CriteriaList";
import {
  AnswerControl,
  DropControl,
  OpenSessionControl,
  PacketSize,
  ResumeControl,
  SessionList,
  StartControl,
  StopControl,
  StoryStateWord,
  endingWords,
  errorText,
  formatWhen,
  useLiveSession,
  useStopped,
} from "./StoryControls";
import { StoryProposals } from "./StoryProposals";
import { TaskChecklist, useStoryTasks } from "./TaskChecklist";
import { useBoardChangedSubscription, useSessionFeed } from "./useBoardQuery";
import { WriteStoryDialog } from "./WriteStoryDialog";
import { ReviewCard } from "../review/ReviewCard";
import { MoveToEpicControl } from "./MoveToEpic";
import { StateBadge } from "../components/StateBadge";
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
          { label: projectName, onSelect: () => setCurrentProjectId(projectId), ariaLabel: `Open the ${projectName} board` },
          ...(story ? [{ label: story.key, mono: true }] : []),
        ]}
        actions={<WriteStoryDialog projectId={projectId} />}
      />
      <SurfaceBody>
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4">
          {storyQuery.isError && <p className="m-0 text-body text-destructive-text">{errorText(storyQuery.error)}</p>}
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
  return line.replace(/[*_`]+/g, "").replace(/^\s*[-#>]+\s*/, "").trim();
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
function LiveTail({ rows, waitingOnYou }: { rows: FeedRowData[]; waitingOnYou: boolean }) {
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
          <li key={row.key} className="flex min-w-0 items-center gap-2.5 py-1" data-live={row.key === liveKey ? "true" : undefined}>
            <ToolCallLine row={row} live={row.key === liveKey} surface={waitingOnYou ? "card" : "strip"} />
          </li>
        ) : (
          <li key={row.key} className="flex min-w-0 items-center gap-2.5 py-1" data-turn="true">
            <Bot aria-hidden="true" size={16} className={cn("shrink-0", waitingOnYou ? "text-muted-foreground" : "text-strip-muted-foreground")} />
            <span className={cn("min-w-0 flex-1 truncate text-small", waitingOnYou ? "text-foreground" : "text-strip-foreground")}>
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
function AgentStation({ projectId, story, waitingOnYou }: { projectId: string; story: StoryDto; waitingOnYou: boolean }) {
  const live = useLiveSession(projectId, story);
  if (!live) return null;
  return <LiveStation projectId={projectId} story={story} sessionId={live.id} startedAt={live.startedAt} waitingOnYou={waitingOnYou} />;
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
  const sessions = useQuery({
    queryKey: ["board", projectId, "sessions", story.id],
    queryFn: () => sessionsForStory(story.id),
  }).data ?? [];
  const feedQuery = useSessionFeed(sessionId);
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
          <span className="text-row font-semibold">{doing ? doing.title : "Reading the Story and the code it touches"}</span>
          <span
            className={cn("flex flex-wrap items-center gap-2 text-small tabular-nums", waitingOnYou ? "text-muted-foreground" : "text-strip-muted-foreground")}
            title={`Started ${formatWhen(startedAt)}`}
          >
            <StateBadge state={waitingOnYou ? "waiting_on_you" : "running"} pulse={pulse} className="h-5.5 text-meta" />
            {pace}
          </span>
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
      <LiveTail rows={rows} waitingOnYou={waitingOnYou} />
    </section>
  );
}

function StoryBody({ projectId, story }: { projectId: string; story: StoryDto }) {
  const [error, setError] = useState<string | null>(null);
  const tasks = useStoryTasks(projectId, story.id).data ?? [];
  const criteria = useCriteria(projectId, story.id).data ?? [];
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

  return (
    <>
      <section
        aria-labelledby="story-heading"
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-card",
          waitingOnYou && "border-attention",
        )}
      >
        <div className="flex items-start gap-3">
          <h1 id="story-heading" className="m-0 min-w-0 flex-1 text-title font-semibold text-balance">
            <span className="mr-2.5 align-[3px] font-mono text-small font-normal text-muted-foreground">{story.key}</span>
            {story.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {story.state === "ready" && <StartControl story={story} onError={setError} />}
            {stopped && <ResumeControl story={story} />}
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
        {error && <p className="m-0 text-small text-destructive-text">{error}</p>}
        {story.description && (
          <p className="m-0 max-w-[75ch] text-body whitespace-pre-wrap">{story.description}</p>
        )}
      </section>

      <AgentStation projectId={projectId} story={story} waitingOnYou={waitingOnYou} />

      {inReview && (
        <ReviewCard
          projectId={projectId}
          story={story}
          onMerged={(outcome) => setError(outcome.cleanupWarning)}
        />
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
          <TaskChecklist storyKey={story.key} storyId={story.id} tasks={tasks} />
        </Panel>
      </div>

      <StoryProposals projectId={projectId} storyId={story.id} />

      {story.state !== "shaping" && story.state !== "ready" && (
        <Panel id="story-sessions-heading" title="Sessions" icon={<Terminal />}>
          <SessionList projectId={projectId} story={story} />
        </Panel>
      )}
    </>
  );
}
