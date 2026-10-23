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
 * What a row draws besides the Story itself comes from the roster's one core read (`roster_rows`, issue #159):
 * its attention (Waiting on you, Stopped and why), the live session its Answer or Open session opens, the
 * *doing* Task, the open review's diff size, and "criteria x/y · tasks x/y", shown when the row has no action.
 * A row issues no read of its own. A row that needs the developer (Waiting on you, Stopped, In review) takes
 * the yellow tint, and its state word says which.
 *
 * Every read is keyed under the project so the one `board:changed` subscription keeps the board live;
 * the renderer never trusts its own write. The Roadmap strip (#131) heads the board; the Milestone picked on it
 * (the Current one until another is picked) is what the Milestone header (#106) and the roster below show, and
 * each of its Epics heads its card with its own bar and "n of m Stories merged", from the header's core read.
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ChevronRight, FileDiff, Flag, Layers } from "lucide-react";
import {
  epicList,
  rosterRows,
  storyListForProject,
  type EpicDto,
  type MilestoneDto,
  type RosterRowDto,
  type StoryDto,
} from "../adapters/tauri";
import { useBoardChangedSubscription } from "./useBoardQuery";
import {
  AnswerControl,
  OpenSessionControl,
  ResumeControl,
  StartControl,
  StoryStateWord,
  endingWords,
  errorText,
  isOwnControl,
} from "./StoryControls";
import { OpenReviewControl } from "../review/ReviewCard";
import { WriteStoryDialog } from "./WriteStoryDialog";
import { AddStoryToEpic } from "./AddRecordControls";
import { NeedsYouColumn, NeedsYouSheetButton } from "./NeedsYou";
import { MilestoneHeader, useMilestoneProgress } from "./MilestoneHeader";
import { EpicProgress } from "./EpicProgress";
import { RoadmapStrip, useMilestoneSelection, useRoadmap } from "./RoadmapStrip";
import { EpicShapingControl } from "./EpicShapingControl";
import { SinceYouLastLooked } from "./SinceYouLastLooked";
import { ConfirmExitTest, ConfirmExitTestOutcome, epicExitTestConfirmable } from "./ConfirmExitTest";
import type { EpicProgressDto } from "../adapters/tauri";
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
  // The roster is virtualised against the surface's own scroll container (#116), held in state so the
  // virtualizer picks it up on the render after it mounts.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const selection = useMilestoneSelection(projectId);
  // Needs you (#156) is a column beside the roster in a window 1280px wide or more, a Sheet below that.
  const wide = useWideContent(scrollElement);
  return (
    <div className="board-shell flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: projectName }]}
        actions={
          <>
            {!wide && <NeedsYouSheetButton projectId={projectId} />}
            <WriteStoryDialog projectId={projectId} />
          </>
        }
      />
      <SurfaceBody ref={setScrollElement} data-board-scroll="">
        <div className={cn("mx-auto flex w-full flex-col gap-4", wide ? "max-w-[1660px]" : "max-w-[1240px]")}>
          {/* The Roadmap (#131); the Milestone picked on it heads the board with its progress (#106), above
              the roster of its Epics. */}
          <RoadmapStrip projectId={projectId} />
          <ConfirmExitTestOutcome />
          <MilestoneHeader projectId={projectId} milestoneId={selection.requested} />
          {wide ? (
            <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-5">
              <NeedsYouColumn projectId={projectId} />
              {/* Since you last looked (#167) sits between Needs you and the roster: atop the roster's column. */}
              <div className="flex min-w-0 flex-col gap-4">
                <SinceYouLastLooked projectId={projectId} />
                <StoryRoster projectId={projectId} selection={selection} scrollElement={scrollElement} />
              </div>
            </div>
          ) : (
            <>
              {/* What changed since the last visit (#167), folded, just above the roster. */}
              <SinceYouLastLooked projectId={projectId} />
              <StoryRoster projectId={projectId} selection={selection} scrollElement={scrollElement} />
            </>
          )}
        </div>
      </SurfaceBody>
    </div>
  );
}

/** The board's width at which Needs you sits beside the roster (direction.md "First viewport"): a window
 * 1280px wide, less the 248px sidebar. The roster keeps about 570px beside the 400px column. */
export const NEEDS_YOU_COLUMN_MIN_WIDTH = 1280 - 248;

/** Whether the board's content area is wide enough for the column. Before it is measured (and in jsdom, which has
 * no layout) it counts as wide, so the column is what renders first. */
function useWideContent(element: HTMLElement | null): boolean {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width === null || width === 0 || width >= NEEDS_YOU_COLUMN_MIN_WIDTH;
}

/** An Epic with the Milestone it sits in, in Roadmap order. */
interface EpicGroup {
  epic: EpicDto | null;
  milestone: MilestoneDto | null;
  stories: StoryDto[];
}

/** Every Epic of the project, in Roadmap order, read per Milestone under the board's key. */
export function useProjectEpics(projectId: string) {
  const milestones = useRoadmap(projectId).data ?? [];
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
 * group of its own at the end, so nothing is ever hidden while the Epics load. An Epic with no Story yet is
 * shown only while it is in Shaping, where its card carries Shape (issue #122). */
export function groupByEpic(stories: StoryDto[], epics: { epic: EpicDto; milestone: MilestoneDto }[]): EpicGroup[] {
  const groups: EpicGroup[] = epics.map(({ epic, milestone }) => ({ epic, milestone, stories: [] }));
  const byId = new Map(groups.map((group) => [group.epic?.id, group]));
  const loose: StoryDto[] = [];
  for (const story of stories) {
    const group = byId.get(story.epicId);
    if (group) group.stories.push(story);
    else loose.push(story);
  }
  const shown = groups.filter((group) => group.stories.length > 0 || group.epic?.state === "shaping");
  if (loose.length > 0) shown.push({ epic: null, milestone: null, stories: loose });
  return shown;
}

/** The Stories of the shown Milestone (every Story when none is shown), grouped under its Epics. A Story
 * whose Epic is not read yet stays visible in the loose group until it is placed. */
export function storiesOfMilestone(
  stories: StoryDto[],
  epics: { epic: EpicDto; milestone: MilestoneDto }[],
  shown: string | null,
): { stories: StoryDto[]; epics: { epic: EpicDto; milestone: MilestoneDto }[] } {
  if (shown === null) return { stories, epics };
  const elsewhere = new Set(epics.filter((e) => e.milestone.id !== shown).map((e) => e.epic.id));
  return {
    stories: stories.filter((story) => !elsewhere.has(story.epicId)),
    epics: epics.filter((e) => e.milestone.id === shown),
  };
}

function StoryRoster({
  projectId,
  selection,
  scrollElement,
}: {
  projectId: string;
  /** The Milestone picked on the Roadmap strip, as the header asks for it and as the roster shows it. */
  selection: { requested: string | null; shown: string | null };
  scrollElement: HTMLElement | null;
}) {
  const storiesQuery = useQuery({
    queryKey: ["board", projectId, "stories"],
    queryFn: () => storyListForProject(projectId),
  });
  const stories = storiesQuery.data ?? [];
  // Every row's figures in one core read for the shown Milestone (#159): attention (docs/mvp-spec.md §2,
  // derived by the core, never stored), the live session, the doing Task, the counts and the review's diff.
  // Keyed under the project so `board:changed` keeps it live; no row reads anything of its own.
  const rowsQuery = useQuery({
    queryKey: ["board", projectId, "roster-rows", selection.shown],
    queryFn: () => rosterRows(selection.shown as string),
    enabled: selection.shown !== null,
  });
  const figures = new Map((rowsQuery.data ?? []).map((row) => [row.storyId, row]));
  const shown = storiesOfMilestone(stories, useProjectEpics(projectId), selection.shown);
  const groups = groupByEpic(shown.stories, shown.epics);
  // Each Epic of the shown Milestone carries its own bar, from the header's one core read (#106).
  const progressQuery = useMilestoneProgress(projectId, selection.requested);
  const epicProgress = new Map((progressQuery.data?.epics ?? []).map((e) => [e.epicId, e]));

  if (storiesQuery.isError) {
    return <p className="m-0 text-body text-destructive-text">{errorText(storiesQuery.error)}</p>;
  }
  // An Epic in Shaping with no Story yet still has its card (issue #122), so only an empty roster is empty.
  if (storiesQuery.isSuccess && stories.length === 0 && groups.length === 0) {
    return (
      <section className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-5 py-6 shadow-card">
        <h2 className="m-0 text-section font-semibold">No Stories yet</h2>
        <p className="m-0 text-body text-muted-foreground">
          Write the first one with the Story control above. It goes into an Epic, inside a Milestone.
        </p>
      </section>
    );
  }
  if (storiesQuery.isSuccess && groups.length === 0) {
    return (
      <section className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card px-5 py-6 shadow-card">
        <h2 className="m-0 text-section font-semibold">No Stories in this Milestone yet</h2>
        <p className="m-0 text-body text-muted-foreground">
          Its Epics and their Stories show here once they are written. Pick another Milestone on the Roadmap above.
        </p>
      </section>
    );
  }
  return (
    <VirtualRoster
      projectId={projectId}
      groups={groups}
      epicProgress={epicProgress}
      figures={figures}
      scrollElement={scrollElement}
    />
  );
}

/*
 * The virtualised roster (#116, PRODUCT.md: instant on a project of 1,000 Stories). One virtual item per
 * Epic heading and one per Story, in Roadmap order, so only the items near the viewport are mounted. Each
 * Epic with a mounted item draws its whole card frame at its full height, absolutely placed, and mounts only
 * those of its rows that are near the viewport inside it: the cards look as they did unvirtualised.
 *
 * An item's size is its element's measured height plus the frame around it that the element does not
 * contain: the gap above every card but the first and the card's top border ride on its heading, the card's
 * bottom border on its last row. The estimates are the rows' minimum heights; jsdom, which has no layout,
 * measures zero and falls back to them.
 */
const EPIC_GAP = 16; // gap-4, the roster's gap between cards
const CARD_BORDER = 1;
const HEADING_ESTIMATE = 57; // min-h-14 and its bottom border
const ROW_ESTIMATE = 53; // min-h-13 and the top border between rows
const OVERSCAN = 8;

type RosterItem =
  | { kind: "epic"; group: number; key: string; empty: boolean }
  | { kind: "story"; group: number; key: string; story: StoryDto; position: number; first: boolean; last: boolean };

/** The roster's virtual items, and where each Epic's run of them starts. The key carries whatever changes
 * an item's frame, so a Story that becomes an Epic's last row is measured afresh, not read from the cache. */
function rosterItems(groups: EpicGroup[]): { items: RosterItem[]; starts: number[] } {
  const items: RosterItem[] = [];
  const starts: number[] = [];
  groups.forEach((group, index) => {
    starts.push(items.length);
    const empty = group.stories.length === 0;
    items.push({
      kind: "epic",
      group: index,
      key: `epic:${group.epic?.id ?? "none"}:${index === 0 ? "first" : ""}:${empty ? "empty" : ""}`,
      empty,
    });
    group.stories.forEach((story, position) => {
      const first = position === 0;
      const last = position === group.stories.length - 1;
      items.push({
        kind: "story",
        group: index,
        key: `${story.id}:${first ? "first" : ""}:${last ? "last" : ""}`,
        story,
        position,
        first,
        last,
      });
    });
  });
  return { items, starts };
}

function itemEstimate(item: RosterItem): number {
  if (item.kind === "epic") return HEADING_ESTIMATE;
  return item.first ? ROW_ESTIMATE - CARD_BORDER : ROW_ESTIMATE;
}

/** The part of an item's size its element does not contain: the gap and card borders around it. */
function itemFrame(item: RosterItem): number {
  // An Epic with no Story yet (one in Shaping) ends at its heading, which then carries the bottom border too.
  if (item.kind === "epic") return CARD_BORDER + (item.group > 0 ? EPIC_GAP : 0) + (item.empty ? CARD_BORDER : 0);
  return item.last ? CARD_BORDER : 0;
}

/** How far down the scroll container's content the roster starts: below the Milestone header, which can
 * change height as it loads, so it is re-read whenever the column holding both resizes. */
function useScrollMargin(roster: HTMLElement | null, scrollElement: HTMLElement | null): number {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (!roster || !scrollElement) return;
    const update = () =>
      setMargin(roster.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(roster.parentElement ?? roster);
    return () => observer.disconnect();
  }, [roster, scrollElement]);
  return margin;
}

function VirtualRoster({
  projectId,
  groups,
  epicProgress,
  figures,
  scrollElement,
}: {
  projectId: string;
  groups: EpicGroup[];
  epicProgress: Map<string, EpicProgressDto>;
  /** Each Story's row figures from the roster's one read, by Story id; absent until it lands. */
  figures: Map<string, RosterRowDto>;
  scrollElement: HTMLElement | null;
}) {
  const { items, starts } = rosterItems(groups);
  const [roster, setRoster] = useState<HTMLDivElement | null>(null);
  const scrollMargin = useScrollMargin(roster, scrollElement);
  // The row holding keyboard focus stays mounted when it scrolls out of view, so focus is never dropped
  // onto the page and Tab carries on from where it was.
  const [focusedStoryId, setFocusedStoryId] = useState<string | null>(null);
  const focusedIndex =
    focusedStoryId === null ? -1 : items.findIndex((item) => item.kind === "story" && item.story.id === focusedStoryId);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => itemEstimate(items[index]) + itemFrame(items[index]),
    getItemKey: (index) => items[index].key,
    measureElement: (element) => {
      const item = items[Number((element as HTMLElement).dataset.index)];
      if (!item) return 0;
      const measured = element.getBoundingClientRect().height;
      return (measured > 0 ? measured : itemEstimate(item)) + itemFrame(item);
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex < 0 || indexes.includes(focusedIndex)) return indexes;
      return [...indexes, focusedIndex].sort((a, b) => a - b);
    },
    scrollMargin,
    overscan: OVERSCAN,
  });

  // The mounted items, gathered by Epic in Roadmap order, so the DOM reads (and Tab walks) in board order.
  const cards: { group: number; rows: VirtualItem[] }[] = [];
  for (const virtualItem of virtualizer.getVirtualItems()) {
    const item = items[virtualItem.index];
    const card = cards[cards.length - 1];
    const row = item.kind === "story" ? [virtualItem] : [];
    if (card?.group === item.group) card.rows.push(...row);
    else cards.push({ group: item.group, rows: row });
  }
  const measurements = virtualizer.measurementsCache;

  return (
    <div
      ref={setRoster}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
      onFocus={(event) => {
        const row = (event.target as HTMLElement).closest("[data-story-id]");
        setFocusedStoryId(row?.getAttribute("data-story-id") ?? null);
      }}
    >
      {cards.map(({ group: index, rows }) => {
        const group = groups[index];
        const heading = measurements[starts[index]];
        const end = measurements[(starts[index + 1] ?? items.length) - 1];
        const top = heading.start - scrollMargin + (index > 0 ? EPIC_GAP : 0);
        return (
          <EpicCard
            key={group.epic?.id ?? "no-epic"}
            projectId={projectId}
            group={group}
            progress={group.epic ? epicProgress.get(group.epic.id) : undefined}
            top={top}
            height={end.end - scrollMargin - top}
            headingIndex={starts[index]}
            measure={virtualizer.measureElement}
          >
            {rows.map((virtualItem) => {
              const item = items[virtualItem.index] as Extract<RosterItem, { kind: "story" }>;
              return (
                <StoryRow
                  key={item.story.id}
                  projectId={projectId}
                  story={item.story}
                  figures={figures.get(item.story.id) ?? null}
                  index={virtualItem.index}
                  // Placed inside the card's padding box, which starts below its top border.
                  top={virtualItem.start - scrollMargin - top - CARD_BORDER}
                  first={item.first}
                  position={item.position + 1}
                  setSize={group.stories.length}
                  measure={virtualizer.measureElement}
                />
              );
            })}
          </EpicCard>
        );
      })}
    </div>
  );
}

/**
 * The action in an Epic card's heading: Confirm exit test once shaping is closed and every Story is Merged
 * or Dropped (issue #134), else the shaping control, which shows only while the Epic is in Shaping.
 */
function EpicHeadingAction({ projectId, group }: { projectId: string; group: EpicGroup }) {
  const { epic, milestone, stories } = group;
  if (!epic) return null;
  if (epicExitTestConfirmable(epic.state, stories)) {
    return (
      <ConfirmExitTest
        projectId={projectId}
        place="card"
        subject={{
          kind: "epic",
          id: epic.id,
          key: epic.key,
          title: epic.title,
          exitTest: epic.exitTest,
          milestoneTitle: milestone?.title ?? null,
        }}
      />
    );
  }
  return <EpicShapingControl projectId={projectId} epic={epic} />;
}

function EpicCard({
  projectId,
  group,
  progress,
  top,
  height,
  headingIndex,
  measure,
  children,
}: {
  group: EpicGroup;
  /** The Epic's counts when it is in the Current Milestone; its card then heads with its bar. */
  progress?: EpicProgressDto;
  /** Where the card sits in the roster and how tall it is, every row counted, mounted or not. */
  top: number;
  height: number;
  /** The heading's virtual item, measured from its element. */
  headingIndex: number;
  measure: (element: Element | null) => void;
  projectId: string;
  children: ReactNode;
}) {
  const { epic, milestone, stories } = group;
  const headingId = `epic-${epic?.id ?? "none"}`;
  return (
    <section
      aria-labelledby={headingId}
      style={{ top, height }}
      className="absolute inset-x-0 overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      {progress ? (
        <header
          ref={measure}
          data-index={headingIndex}
          className={cn("flex items-center gap-3 border-border px-4 py-1.5", stories.length > 0 && "border-b")}
        >
          <EpicProgress epic={progress} headingId={headingId} className="min-w-0 flex-1" />
          {epic && <AddStoryToEpic projectId={projectId} epic={epic} />}
          {/* A fixed slot on every progress-headed card, so each Epic's bar still sits in one column; inset by
              the rows' chevron column, so Shape sits above the rows' own actions. */}
          <span className="mr-7 flex max-w-[360px] min-w-[152px] flex-none justify-end">
            {epic && <EpicHeadingAction projectId={projectId} group={group} />}
          </span>
        </header>
      ) : (
      <header
        ref={measure}
        data-index={headingIndex}
        className={cn("flex min-h-14 items-center gap-3 border-border px-4 py-2.5", stories.length > 0 && "border-b")}
      >
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
          {stories.length === 0 ? "No Stories yet" : stories.length === 1 ? "1 Story" : `${stories.length} Stories`}
        </span>
        {epic && <AddStoryToEpic projectId={projectId} epic={epic} />}
        {epic && (
          <span className="mr-7 flex min-w-0 justify-end">
            <EpicHeadingAction projectId={projectId} group={group} />
          </span>
        )}
      </header>
      )}
      {/* Only the rows near the viewport are mounted; each is placed against the card, not the list. */}
      <ul aria-label={epic ? `${epic.title} Stories` : "Stories"} className="m-0 list-none p-0">
        {children}
      </ul>
    </section>
  );
}

/** An open review's diff size as the row says it: "+40 −7 · 3 files". */
export function diffSizeWords(diff: { files: number; added: number; removed: number }): string {
  return `+${diff.added} −${diff.removed} · ${diff.files === 1 ? "1 file" : `${diff.files} files`}`;
}

/** Why a row needs the developer, if it does (docs/mvp-spec.md §7 "rows that need Cyril tinted"): a session
 * Waiting on you, a Stopped Story, or a review to make. The state word beside the tint says which. */
type NeedsYou = "waiting" | "stopped" | "review";

/** The row's second line: why it stopped, what its agent is doing, or the size of the diff in review. */
function RowDetail({ story, figures }: { story: StoryDto; figures: RosterRowDto | null }) {
  const stopped = figures?.attention === "stopped";
  const doing = figures?.doingTaskTitle ?? null;
  const review = story.state === "in_review" ? (figures?.review ?? null) : null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 truncate text-meta text-subtle-foreground">
      {stopped && (
        <>
          <span className="shrink-0 font-semibold text-destructive-text">{`Stopped: ${endingWords(figures.endingReason)}`}</span>
          {doing && <span className="truncate">{`· was doing “${doing}”`}</span>}
        </>
      )}
      {!stopped && doing && (
        <span aria-label={`${story.key} is doing`} className="truncate">{`Doing: ${doing}`}</span>
      )}
      {review && (
        <span className="inline-flex shrink-0 items-center gap-1 self-center text-muted-foreground tabular-nums">
          <FileDiff aria-hidden="true" size={13} className="shrink-0" />
          <span className="sr-only">Diff </span>
          {diffSizeWords(review)}
        </span>
      )}
      {story.state === "dropped" && <span>Dropped: kept readable, no worktree</span>}
    </span>
  );
}

/** "criteria x/y · tasks x/y", where a row has no action to offer: how far the Story is judged done. */
function RowCounts({ figures }: { figures: RosterRowDto | null }) {
  if (!figures) return null;
  return (
    <span className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">
      {`criteria ${figures.criteriaMet}/${figures.criteriaTotal} · tasks ${figures.tasksDone}/${figures.tasksTotal}`}
    </span>
  );
}

function StoryRow({
  projectId,
  story,
  figures,
  index,
  top,
  first,
  position,
  setSize,
  measure,
}: {
  projectId: string;
  story: StoryDto;
  /** The row's figures from the roster's one core read; `null` until it lands. */
  figures: RosterRowDto | null;
  /** The row's virtual item, measured from its element, and where it sits in its Epic's card. */
  index: number;
  top: number;
  /** The Epic's first row draws no rule above it: the card's heading already does. */
  first: boolean;
  /** Its place among the Epic's Stories, for assistive tech, which sees only the mounted rows. */
  position: number;
  setSize: number;
  measure: (element: Element | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const openStory = useUiStore((state) => state.openStory);
  const here = useUiStore((state) => state.currentStoryId === story.id || state.activeSessionStoryId === story.id);
  // Attention is the core's (a Stopped Story has no live session, so it is never also Waiting on you).
  const stopped = figures?.attention === "stopped" ? { endingReason: figures.endingReason } : null;
  const waiting = figures?.attention === "waiting_on_you";
  const liveSessionId = figures?.liveSessionId ?? null;
  const needsYou: NeedsYou | null = waiting ? "waiting" : stopped ? "stopped" : story.state === "in_review" ? "review" : null;

  // The one next action, else the counts (docs/mvp-spec.md §7: "either an action button or criteria x/y · tasks x/y").
  let action: ReactNode = null;
  if (stopped) action = <ResumeControl story={story} />;
  else if (waiting) action = <AnswerControl projectId={projectId} story={story} sessionId={liveSessionId} />;
  else if (story.state === "running" && liveSessionId)
    action = <OpenSessionControl projectId={projectId} story={story} sessionId={liveSessionId} />;
  else if (story.state === "ready") action = <StartControl story={story} onError={setError} />;
  else if (story.state === "in_review") action = <OpenReviewControl projectId={projectId} story={story} />;

  return (
    <li
      ref={measure}
      data-index={index}
      data-story-id={story.id}
      data-attention={waiting ? "waiting" : stopped ? "stopped" : undefined}
      data-needs-you={needsYou ?? undefined}
      aria-current={here ? "true" : undefined}
      aria-posinset={position}
      aria-setsize={setSize}
      style={{ top }}
      // Anywhere on the row that is not a control of its own opens the Story: the doing Task and the
      // state word go there too. The key-and-title button is the same target for the keyboard.
      onClick={(event) => {
        if (!isOwnControl(event)) openStory(projectId, story.id);
      }}
      className={cn(
        "group/row absolute inset-x-0 cursor-pointer border-border transition-[background-color,box-shadow] duration-(--duration-state) ease-(--ease)",
        !first && "border-t",
        "hover:bg-accent hover:shadow-[inset_0_0_0_1px_var(--input)]",
        // A row that needs the developer takes the yellow tint (DESIGN.md); its state word says why.
        needsYou && "bg-attention-muted hover:bg-attention-muted",
        here && !needsYou && "bg-running-muted hover:bg-running-muted",
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
          <span className="pl-16 empty:hidden">
            <RowDetail story={story} figures={figures} />
          </span>
        </span>
        <span className="flex justify-end">{action ?? <RowCounts figures={figures} />}</span>
        <ChevronRight aria-hidden="true" size={16} className="text-subtle-foreground transition-colors group-hover/row:text-foreground" />
      </div>
      {error && <p className="m-0 px-4 pb-2 text-small text-destructive-text">{error}</p>}
    </li>
  );
}
