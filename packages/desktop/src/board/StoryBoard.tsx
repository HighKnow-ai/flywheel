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
 * *doing* Task, the open review's diff size, and "criteria x/y · tasks x/y", shown when the row has no action
 * and the counts say something (#202). A row issues no read of its own. Only a row Waiting on you takes the
 * yellow tint (#202, direction.md's one meaning per colour); a Stopped or In review row says so in its pill.
 *
 * Reading at a glance (#202): every key is a StoryKey in a column as wide as the project's longest key, so a
 * key never wraps and every title starts in one column; live Epics come first and the Done ones fold into one
 * disclosure at the end; the roster loads behind Skeleton rows and a failed read is a ReadError.
 *
 * Every read is keyed under the project so the one `board:changed` subscription keeps the board live;
 * the renderer never trusts its own write. The Roadmap strip (#131) heads the board; the Milestone picked on it
 * (the Current one until another is picked) is what the Milestone header (#106) and the roster below show, and
 * each of its Epics heads its card with its own bar and "n of m Stories merged", from the header's core read, and
 * "n Proposals" while Story sessions have Proposals on it awaiting triage (#162), which opens the triage drawer.
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ChevronRight, CircleCheckBig, FileDiff, Flag, Layers } from "lucide-react";
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
  MakeReadyControl,
  StartControl,
  StoryStateWord,
  endingWords,
  isOwnControl,
} from "./StoryControls";
import { OpenReviewControl } from "../review/ReviewCard";
import { WriteStoryDialog } from "./WriteStoryDialog";
import { AddStoryToEpic } from "./AddRecordControls";
import { NeedsYouColumn, NeedsYouSheetButton } from "./NeedsYou";
import { ProposalDrawer, ProposalsMarker } from "../proposals/ProposalDrawer";
import { MilestoneHeader, useMilestoneProgress } from "./MilestoneHeader";
import { EPIC_HEADER_GRID, EpicHeaderActions, EpicProgress } from "./EpicProgress";
import { RoadmapStrip, useMilestoneSelection, useRoadmap } from "./RoadmapStrip";
import { EpicShapingControl } from "./EpicShapingControl";
import { SinceYouLastLooked } from "./SinceYouLastLooked";
import { ConfirmExitTest, ConfirmExitTestOutcome, epicExitTestConfirmable } from "./ConfirmExitTest";
import type { EpicProgressDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { StoryKey } from "../components/StoryKey";
import { ReadError } from "../components/ReadError";
import {
  Item,
  ItemActions,
  ItemContent,
  Skeleton,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  useLoadingPhase,
} from "@highknow/design";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";

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
          {/* One tree in both layouts, so crossing the breakpoint never remounts the roster and the dialogs it
              owns (a Write a Story draft, a Resume note) survive a resize. Narrow, both wrappers are
              display: contents and Since you last looked (#167) sits folded just above the roster; wide, it
              sits between Needs you and the roster, atop the roster's column. */}
          <div className={wide ? "grid grid-cols-[400px_minmax(0,1fr)] items-start gap-5" : "contents"}>
            {wide && <NeedsYouColumn projectId={projectId} />}
            <div className={wide ? "flex min-w-0 flex-col gap-4" : "contents"}>
              <SinceYouLastLooked projectId={projectId} />
              <StoryRoster projectId={projectId} selection={selection} scrollElement={scrollElement} />
            </div>
          </div>
        </div>
      </SurfaceBody>
      {/* The triage drawer (#162), opened by Needs you's Triage and an Epic's "n Proposals". */}
      <ProposalDrawer projectId={projectId} />
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
  const loadingPhase = useLoadingPhase(storiesQuery.isPending);

  // A failed read is the one error state (DESIGN.md § Feedback). Without the Stories there is no roster, so the
  // ReadError takes its place; without the roster's own read (`roster_rows`) the Stories still list, under a
  // ReadError saying their attention and actions could not be read.
  // The loading rule (DESIGN.md § Feedback): nothing for 150 ms, then the skeleton, held at least 400 ms.
  if (loadingPhase === "skeleton") return <RosterSkeleton />;
  if (storiesQuery.isError) return <ReadError title="Couldn't load the roster" query={storiesQuery} />;
  if (storiesQuery.isPending) return null;
  const rowsError = rowsQuery.isError && (
    <ReadError
      title="Couldn't load the roster"
      description="The Stories are listed, but who is waiting on you and each row's next action could not be read from Flywheel's local core."
      query={rowsQuery}
    />
  );
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
  // Live Epics first, in Roadmap order; the Done ones fold into one disclosure at the end (#202).
  const live = groups.filter((group) => group.epic?.state !== "done");
  const done = groups.filter((group) => group.epic?.state === "done");
  const keyWidth = `${longestKey(stories)}ch`;
  const shared = { projectId, epicProgress, figures, scrollElement, keyWidth };
  // A fragment, not a wrapper: the roster's scroll margin is re-read when the column holding it resizes.
  return (
    <>
      {rowsError}
      {live.length > 0 && <VirtualRoster groups={live} {...shared} />}
      {done.length > 0 && <DoneEpics groups={done} {...shared} />}
    </>
  );
}

/** The project's longest Story key, in characters: the key column's width in the code face, where every
 * character is one `ch` wide. Read over the whole project, so the column does not jump between Milestones. */
function longestKey(stories: StoryDto[]): number {
  return stories.reduce((longest, story) => Math.max(longest, story.key.length), 5);
}

/** The Done Epics, folded into one disclosure at the end of the roster (#202): "2 Epics done", and the count
 * of their Stories, which opens to their cards. Folded on every visit: finished work is there when asked for. */
function DoneEpics({ groups, ...shared }: { groups: EpicGroup[] } & Omit<RosterProps, "groups">) {
  const [open, setOpen] = useState(false);
  const stories = groups.reduce((sum, group) => sum + group.stories.length, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger className="group/done flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-2 text-left shadow-card transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent">
        <ChevronRight
          aria-hidden="true"
          size={16}
          className="shrink-0 text-muted-foreground transition-transform duration-(--duration-state) ease-(--ease) group-data-[state=open]/done:rotate-90"
        />
        <CircleCheckBig aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-row font-semibold tabular-nums">
          {groups.length === 1 ? "1 Epic done" : `${groups.length} Epics done`}
        </span>
        <span className="ml-auto text-meta text-muted-foreground tabular-nums">
          {stories === 1 ? "1 Story" : `${stories} Stories`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-4">
          <VirtualRoster groups={groups} {...shared} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The roster while its first read is in flight: one Epic card in its real shape, a header and four rows of
 * the rows' own height (DESIGN.md § Feedback: Skeleton in the region's own shape, never "Loading…"). */
function RosterSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the roster"
      aria-busy="true"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      <div className="flex min-h-14 items-center gap-4 border-b border-border px-4">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="ml-auto h-2.5 w-48" />
        <Skeleton className="h-3.5 w-28" />
      </div>
      {[64, 48, 72, 40].map((width, index) => (
        <div
          key={width}
          className={cn(
            "grid min-h-13 grid-cols-[152px_minmax(0,1fr)_16px] items-center gap-x-3 py-1.5 pr-3 pl-4",
            index > 0 && "border-t border-border",
          )}
        >
          <Skeleton className="h-5.5 w-20 rounded-full" />
          <span className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </span>
          <span />
        </div>
      ))}
    </div>
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
const HEADING_ESTIMATE = 65; // the header grid's min-h-11 and its padding, and its bottom border
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
      setMargin(
        roster.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(roster.parentElement ?? roster);
    // The Done Epics' roster sits below the live one, so it moves whenever anything above it changes height:
    // the scroll container's content, which holds both, resizes with it.
    const content = scrollElement.firstElementChild;
    if (content && content !== roster.parentElement) observer.observe(content);
    return () => observer.disconnect();
  }, [roster, scrollElement]);
  return margin;
}

interface RosterProps {
  projectId: string;
  groups: EpicGroup[];
  epicProgress: Map<string, EpicProgressDto>;
  /** Each Story's row figures from the roster's one read, by Story id; absent until it lands. */
  figures: Map<string, RosterRowDto>;
  scrollElement: HTMLElement | null;
  /** The key column's width: the project's longest key, in `ch` of the code face. */
  keyWidth: string;
}

function VirtualRoster({ projectId, groups, epicProgress, figures, scrollElement, keyWidth }: RosterProps) {
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
                  keyWidth={keyWidth}
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
  // The card's controls, right-aligned in the header grid's last column: n Proposals, + Story, then Shape or
  // Confirm exit test.
  const actions = epic && (
    <>
      {progress && <ProposalsMarker projectId={projectId} epic={epic} count={progress.proposals ?? 0} />}
      <AddStoryToEpic projectId={projectId} epic={epic} />
      <EpicHeadingAction projectId={projectId} group={group} />
    </>
  );
  return (
    <section
      aria-labelledby={headingId}
      style={{ top, height }}
      className="@container/epic absolute inset-x-0 overflow-hidden rounded-lg border border-border bg-card shadow-card"
    >
      {/* Inset on the right by the rows' chevron column, so the card's actions end where the rows' actions do. */}
      <header
        ref={measure}
        data-index={headingIndex}
        className={cn("border-border py-1.5 pr-10 pl-4", stories.length > 0 && "border-b")}
      >
        {progress ? (
          <EpicProgress epic={progress} headingId={headingId} actions={actions} />
        ) : (
          // An Epic outside the shown Milestone's read (or Stories whose Epic is not read yet): the same grid,
          // with the Milestone where the bar would be.
          <div className={cn(EPIC_HEADER_GRID, "min-h-11 py-1")}>
            <div className="flex min-w-0 items-center gap-2 [grid-area:title]">
              <Layers aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
              <h2 id={headingId} className="m-0 min-w-0 truncate text-section font-semibold">
                {epic ? epic.title : "Stories"}
              </h2>
              {epic && <StateBadge state={epic.state} className="shrink-0" />}
            </div>
            {milestone && (
              <span className="inline-flex min-w-0 items-center gap-1 text-small text-subtle-foreground [grid-area:bar]">
                <Flag aria-hidden="true" size={14} className="shrink-0" />
                <span className="truncate">
                  <span className="sr-only">Milestone </span>
                  {milestone.title}
                </span>
              </span>
            )}
            <span className="text-right text-small whitespace-nowrap text-muted-foreground tabular-nums [grid-area:count]">
              {stories.length === 0 ? "No Stories yet" : stories.length === 1 ? "1 Story" : `${stories.length} Stories`}
            </span>
            <EpicHeaderActions>{actions}</EpicHeaderActions>
          </div>
        )}
      </header>
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
      {!stopped && doing && <span aria-label={`${story.key} is doing`} className="truncate">{`Doing: ${doing}`}</span>}
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

/** "criteria x/y · tasks x/y", where a row has no action to offer: how far the Story is judged done. Only what
 * says something (#202): nothing on a Merged or Dropped row, whose pill already says how it ended, and no
 * count with nothing in it ("tasks 0/0"). `null` when nothing is left to say. */
export function rowCountWords(story: Pick<StoryDto, "state">, figures: RosterRowDto | null): string | null {
  if (!figures || story.state === "merged" || story.state === "dropped") return null;
  const parts = [
    figures.criteriaTotal > 0 ? `criteria ${figures.criteriaMet}/${figures.criteriaTotal}` : null,
    figures.tasksTotal > 0 ? `tasks ${figures.tasksDone}/${figures.tasksTotal}` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function RowCounts({ story, figures }: { story: StoryDto; figures: RosterRowDto | null }) {
  const words = rowCountWords(story, figures);
  if (!words) return null;
  return <span className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">{words}</span>;
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
  keyWidth,
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
  /** The key column's width, the same on every row of the project. */
  keyWidth: string;
  measure: (element: Element | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const openStory = useUiStore((state) => state.openStory);
  const here = useUiStore((state) => state.currentStoryId === story.id || state.activeSessionStoryId === story.id);
  // Attention is the core's (a Stopped Story has no live session, so it is never also Waiting on you).
  const stopped = figures?.attention === "stopped" ? { endingReason: figures.endingReason } : null;
  const waiting = figures?.attention === "waiting_on_you";
  const liveSessionId = figures?.liveSessionId ?? null;

  // The one next action, else the counts (docs/mvp-spec.md §7: "either an action button or criteria x/y · tasks x/y").
  let action: ReactNode = null;
  if (stopped) action = <ResumeControl story={story} />;
  else if (waiting) action = <AnswerControl projectId={projectId} story={story} sessionId={liveSessionId} />;
  else if (story.state === "running" && liveSessionId)
    action = <OpenSessionControl projectId={projectId} story={story} sessionId={liveSessionId} />;
  else if (story.state === "ready") action = <StartControl story={story} onError={setError} />;
  else if (figures?.canMakeReady) action = <MakeReadyControl story={story} onError={setError} />;
  else if (story.state === "in_review") action = <OpenReviewControl projectId={projectId} story={story} />;

  return (
    <Item
      asChild
      size="sm"
      className={cn(
        // An Item row (DESIGN.md's pattern table), on the roster's own grid: the state column, the key and title
        // over the detail, the action or counts, the chevron.
        "group/row absolute inset-x-0 grid min-h-13 cursor-pointer grid-cols-[152px_minmax(0,1fr)_auto_16px] gap-x-3 gap-y-0 rounded-none border-0 border-border py-1.5 pr-3 pl-4 text-body",
        "transition-[background-color,box-shadow] duration-(--duration-state) ease-(--ease)",
        !first && "border-t",
        "hover:bg-accent hover:shadow-[inset_0_0_0_1px_var(--input)]",
        // Yellow is Waiting on you, and nothing else (direction.md, one meaning per colour; #202): a Stopped or
        // In review row says what it is in its pill, on the card's own ground.
        waiting && "bg-attention-muted hover:bg-attention-muted",
        here && !waiting && "bg-running-muted hover:bg-running-muted",
      )}
    >
      <li
        ref={measure}
        data-index={index}
        data-story-id={story.id}
        data-attention={waiting ? "waiting" : stopped ? "stopped" : undefined}
        data-needs-you={waiting ? "waiting" : undefined}
        aria-current={here ? "true" : undefined}
        aria-posinset={position}
        aria-setsize={setSize}
        style={{ top }}
        // Anywhere on the row that is not a control of its own opens the Story: the doing Task and the
        // state word go there too. The key-and-title button is the same target for the keyboard.
        onClick={(event) => {
          if (!isOwnControl(event)) openStory(projectId, story.id);
        }}
      >
        <span className="flex">
          <StoryStateWord story={story} stopped={stopped} waitingOnYou={waiting} />
        </span>
        {/* Two columns, the key's and the title's, shared by the button and the detail line under it, so the
            detail starts under the title. The key column is as wide as the project's longest key. */}
        <ItemContent className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          <button
            type="button"
            aria-label={`Open Story ${story.key} ${story.title}`}
            onClick={() => openStory(projectId, story.id)}
            className="col-span-2 grid min-w-0 grid-cols-subgrid items-baseline rounded-sm text-left"
          >
            <StoryKey value={story.key} style={{ minWidth: keyWidth }} />
            <span
              className={cn(
                "truncate text-row font-semibold",
                (story.state === "merged" || story.state === "dropped") && "font-normal text-muted-foreground",
              )}
            >
              {story.title}
            </span>
          </button>
          <span className="col-start-2 min-w-0 empty:hidden">
            <RowDetail story={story} figures={figures} />
          </span>
        </ItemContent>
        <ItemActions className="justify-end">{action ?? <RowCounts story={story} figures={figures} />}</ItemActions>
        <ChevronRight
          aria-hidden="true"
          size={16}
          className="text-subtle-foreground transition-colors group-hover/row:text-foreground"
        />
        {error && <p className="col-span-full m-0 pt-1 text-small text-destructive-text">{error}</p>}
      </li>
    </Item>
  );
}
