/**
 * The project board (issue #50, restyled in the Andon world by #107): the project's Stories grouped by
 * their Epic, each Epic a card, each Story a row.
 *
 * The click model (issue #104): a Story row is a bounded object with a trailing chevron. Anywhere on it
 * that is not a control of its own (the key, the title, the *doing* Task, the state) opens the Story
 * (`StoryView.tsx`). Each row offers at most one action, the next one: Answer on a Story Waiting on you
 * (it opens the feed at the open request), Resume on a Stopped one, Open session on a Running one, Start
 * on a Ready one. Start and Resume stay where they are; nothing here opens a session on its own. Drop,
 * the Tasks and the sessions live in the Story view.
 *
 * Every read is keyed under the project so the one `board:changed` subscription keeps the board live;
 * the renderer never trusts its own write. The Milestone header (#106) sits above the roster, and each Epic of
 * the Current Milestone heads its card with its own bar and "n of m Stories merged", from the same core read.
 */
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronRight, Flag, Layers } from "lucide-react";
import {
  blockedSummary,
  epicList,
  milestoneList,
  storyListForProject,
  type EpicDto,
  type MilestoneDto,
  type StoryDto,
} from "../adapters/tauri";
import { useBoardChangedSubscription } from "./useBoardQuery";
import { DoingTask, useStoryTasks } from "./TaskChecklist";
import {
  AnswerControl,
  OpenSessionControl,
  PacketSize,
  ResumeControl,
  StartControl,
  StoryStateWord,
  endingWords,
  errorText,
  isOwnControl,
  useStopped,
} from "./StoryControls";
import { WriteStoryDialog } from "./WriteStoryDialog";
import { MilestoneHeader } from "./MilestoneHeader";
import { EpicProgress } from "./EpicProgress";
import { milestoneProgress, type EpicProgressDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
import { cn } from "@/lib/utils";

export interface StoryBoardProps {
  projectId: string;
  projectName: string;
}

export function StoryBoard({ projectId, projectName }: StoryBoardProps) {
  useBoardChangedSubscription(projectId);
  return (
    <div className="board-shell flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: projectName }]} actions={<WriteStoryDialog projectId={projectId} />} />
      <SurfaceBody>
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4">
          {/* The Current Milestone's progress (#106), above the roster of its Epics. */}
          <MilestoneHeader projectId={projectId} />
          <StoryRoster projectId={projectId} />
        </div>
      </SurfaceBody>
    </div>
  );
}

/** An Epic with the Milestone it sits in, in Roadmap order. */
interface EpicGroup {
  epic: EpicDto | null;
  milestone: MilestoneDto | null;
  stories: StoryDto[];
}

/** Every Epic of the project, in Roadmap order, read per Milestone under the board's key. */
function useProjectEpics(projectId: string) {
  const milestonesQuery = useQuery({
    queryKey: ["board", projectId, "milestones"],
    queryFn: () => milestoneList(projectId),
  });
  const milestones = milestonesQuery.data ?? [];
  const epicQueries = useQueries({
    queries: milestones.map((milestone) => ({
      queryKey: ["board", projectId, "epics", milestone.id],
      queryFn: () => epicList(milestone.id),
    })),
  });
  const epics: { epic: EpicDto; milestone: MilestoneDto }[] = [];
  milestones.forEach((milestone, index) => {
    for (const epic of epicQueries[index]?.data ?? []) epics.push({ epic, milestone });
  });
  return epics;
}

/** Stories grouped under their Epic, Epics in Roadmap order; a Story whose Epic is not read yet sits in a
 * group of its own at the end, so nothing is ever hidden while the Epics load. */
export function groupByEpic(stories: StoryDto[], epics: { epic: EpicDto; milestone: MilestoneDto }[]): EpicGroup[] {
  const groups: EpicGroup[] = epics.map(({ epic, milestone }) => ({ epic, milestone, stories: [] }));
  const byId = new Map(groups.map((group) => [group.epic?.id, group]));
  const loose: StoryDto[] = [];
  for (const story of stories) {
    const group = byId.get(story.epicId);
    if (group) group.stories.push(story);
    else loose.push(story);
  }
  const shown = groups.filter((group) => group.stories.length > 0);
  if (loose.length > 0) shown.push({ epic: null, milestone: null, stories: loose });
  return shown;
}

function StoryRoster({ projectId }: { projectId: string }) {
  const storiesQuery = useQuery({
    queryKey: ["board", projectId, "stories"],
    queryFn: () => storyListForProject(projectId),
  });
  const stories = storiesQuery.data ?? [];
  // Waiting on you (docs/mvp-spec.md §2 "Attention"): derived by the core from a live session's
  // pending request, never a stored state. Keyed under the project so `board:changed` keeps it live.
  const waitingQuery = useQuery({
    queryKey: ["board", projectId, "waiting-on-you"],
    queryFn: () => blockedSummary(projectId),
  });
  const waitingIds = new Set(waitingQuery.data?.blockedStoryIds ?? []);
  const groups = groupByEpic(stories, useProjectEpics(projectId));
  // Each Epic of the Current Milestone carries its own bar, from the header's one core read (#106).
  const progressQuery = useQuery({
    queryKey: ["board", projectId, "milestone-progress"],
    queryFn: () => milestoneProgress(projectId),
  });
  const epicProgress = new Map((progressQuery.data?.epics ?? []).map((e) => [e.epicId, e]));

  if (storiesQuery.isError) {
    return <p className="m-0 text-body text-destructive-text">{errorText(storiesQuery.error)}</p>;
  }
  if (storiesQuery.isSuccess && stories.length === 0) {
    return (
      <section className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-5 py-6 shadow-card">
        <h2 className="m-0 text-section font-semibold">No Stories yet</h2>
        <p className="m-0 text-body text-muted-foreground">
          Write the first one with the Story control above. It goes into an Epic, inside a Milestone.
        </p>
      </section>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <EpicCard
          key={group.epic?.id ?? "no-epic"}
          projectId={projectId}
          group={group}
          progress={group.epic ? epicProgress.get(group.epic.id) : undefined}
          waitingIds={waitingIds}
        />
      ))}
    </>
  );
}

function EpicCard({
  projectId,
  group,
  progress,
  waitingIds,
}: {
  projectId: string;
  group: EpicGroup;
  /** The Epic's counts when it is in the Current Milestone; its card then heads with its bar. */
  progress?: EpicProgressDto;
  waitingIds: Set<string>;
}) {
  const { epic, milestone, stories } = group;
  const headingId = `epic-${epic?.id ?? "none"}`;
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      {progress ? (
        <header className="border-b border-border px-4 py-1.5">
          <EpicProgress epic={progress} headingId={headingId} />
        </header>
      ) : (
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2.5">
        <Layers aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
        <h2 id={headingId} className="m-0 min-w-0 truncate text-section font-semibold">
          {epic ? epic.title : "Stories"}
        </h2>
        {epic && <StateBadge state={epic.state} className="h-5.5 text-meta" />}
        {milestone && (
          <span className="inline-flex min-w-0 items-center gap-1 text-small text-subtle-foreground">
            <Flag aria-hidden="true" size={14} className="shrink-0" />
            <span className="truncate">
              <span className="sr-only">Milestone </span>
              {milestone.title}
            </span>
          </span>
        )}
        <span className="ml-auto shrink-0 text-small text-muted-foreground tabular-nums">
          {stories.length === 1 ? "1 Story" : `${stories.length} Stories`}
        </span>
      </header>
      )}
      <ul aria-label={epic ? `${epic.title} Stories` : "Stories"} className="m-0 list-none p-0">
        {stories.map((story) => (
          <StoryRow key={story.id} projectId={projectId} story={story} waitingOnYou={waitingIds.has(story.id)} />
        ))}
      </ul>
    </section>
  );
}

/** The row's second line: what the agent is doing, why it stopped, or how big its next session starts. */
function RowDetail({
  projectId,
  story,
  stoppedReason,
}: {
  projectId: string;
  story: StoryDto;
  stoppedReason: string | null;
}) {
  const tasks = useStoryTasks(projectId, story.id).data ?? [];
  const doing = tasks.find((task) => task.state === "doing");
  const open = story.state !== "merged" && story.state !== "dropped";
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 truncate text-meta text-subtle-foreground">
      {stoppedReason !== null && (
        <>
          <span className="shrink-0 font-semibold text-destructive-text">{`Stopped: ${stoppedReason}`}</span>
          {doing && <span className="truncate">{`· was doing “${doing.title}”`}</span>}
        </>
      )}
      {stoppedReason === null && <DoingTask tasks={tasks} storyKey={story.key} className="truncate" />}
      {open && stoppedReason === null && !doing && <PacketSize story={story} className="truncate" />}
      {story.state === "dropped" && <span>Dropped: kept readable, no worktree</span>}
    </span>
  );
}

function StoryRow({
  projectId,
  story,
  waitingOnYou,
}: {
  projectId: string;
  story: StoryDto;
  /** A live session of this Story holds a Gated action, permission request or question. */
  waitingOnYou: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const stopped = useStopped(projectId, story);
  const openStory = useUiStore((state) => state.openStory);
  const here = useUiStore((state) => state.currentStoryId === story.id || state.activeSessionStoryId === story.id);
  // A Stopped Story has no live session, so it is never Waiting on you (the core agrees).
  const waiting = waitingOnYou && !stopped;

  let action: React.ReactNode = null;
  if (stopped) action = <ResumeControl story={story} />;
  else if (waiting) action = <AnswerControl projectId={projectId} story={story} />;
  else if (story.state === "running") action = <OpenSessionControl projectId={projectId} story={story} />;
  else if (story.state === "ready") action = <StartControl story={story} onError={setError} />;

  return (
    <li
      data-story-id={story.id}
      data-attention={waiting ? "waiting" : stopped ? "stopped" : undefined}
      aria-current={here ? "true" : undefined}
      // Anywhere on the row that is not a control of its own opens the Story: the doing Task and the
      // state word go there too. The key-and-title button is the same target for the keyboard.
      onClick={(event) => {
        if (!isOwnControl(event)) openStory(projectId, story.id);
      }}
      className={cn(
        "group/row relative cursor-pointer border-t border-border first:border-t-0 transition-[background-color,box-shadow] duration-(--duration-state) ease-(--ease)",
        "hover:bg-accent hover:shadow-[inset_0_0_0_1px_var(--input)]",
        waiting && "bg-attention-muted hover:bg-attention-muted",
        here && !waiting && "bg-running-muted hover:bg-running-muted",
      )}
    >
      <div className="grid min-h-13 grid-cols-[152px_minmax(0,1fr)_auto_16px] items-center gap-x-3 py-1.5 pr-3 pl-4">
        <span className="flex">
          <StoryStateWord story={story} stopped={stopped} waitingOnYou={waiting} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <button
            type="button"
            aria-label={`Open Story ${story.key} ${story.title}`}
            onClick={() => openStory(projectId, story.id)}
            className="flex min-w-0 items-baseline gap-2 rounded-sm text-left"
          >
            <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground">{story.key}</span>
            <span
              className={cn(
                "truncate text-row font-semibold",
                (story.state === "merged" || story.state === "dropped") && "font-normal text-muted-foreground",
              )}
            >
              {story.title}
            </span>
          </button>
          <span className="pl-16">
            <RowDetail projectId={projectId} story={story} stoppedReason={stopped ? endingWords(stopped.endingReason) : null} />
          </span>
        </span>
        <span className="flex justify-end">{action}</span>
        <ChevronRight aria-hidden="true" size={16} className="text-subtle-foreground transition-colors group-hover/row:text-foreground" />
      </div>
      {error && <p className="m-0 px-4 pb-2 text-small text-destructive-text">{error}</p>}
    </li>
  );
}
