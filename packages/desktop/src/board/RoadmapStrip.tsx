/**
 * The Roadmap strip (docs/mvp-spec.md §7, issue #131): the top of the project screen, one slim row per
 * Milestone in Roadmap order with its name, state and one-line Exit test. There is no separate Roadmap
 * screen; this is where the developer reads and edits the Roadmap.
 *
 * - **Click a row** to switch the Milestone header and the roster below to that Milestone. The pick is UI
 *   state (`uiStore.selectedMilestoneByProject`); until there is one, the board follows the Current
 *   Milestone, which the row marks "Current".
 * - **Reorder** by dragging a row (native drag and drop, no library) or from the keyboard: the arrow keys
 *   on a row's move handle, or Alt with an arrow key anywhere on the row. Either calls `milestone_move`;
 *   the core re-ranks one row and the Current Milestone follows the new order. A Done or Dropped Milestone
 *   keeps its place: it has no handle, does not drag, and reads quieter.
 * - **+ Milestone** takes a one-line outcome and adds it at the end of the Roadmap, in Shaping, through
 *   the existing `milestone_create`, then picks it.
 * - **Revisit roadmap** starts a roadmap Round (issue #133, `RoadmapRound.tsx`): its band sits under the
 *   header, and each change it proposes is a ghost row under the Milestone it lands on, decided in place.
 * - **Shape** (issue #132): a Milestone in Shaping carries its shaping control at the end of its row
 *   (`MilestoneShapingControl`): Shape, Answer, Open session or Continue shaping. The slot is there on
 *   every row while any Milestone is in Shaping, so the columns still line up, and empty on the picked row,
 *   whose Milestone header below carries the same control.
 * - **Confirm exit test** (issue #134, `ConfirmExitTest.tsx`): once every Epic of a Milestone is Done, the
 *   same slot carries Confirm exit test instead, again empty on the picked row, whose header carries it.
 * - **Fold** (issue #201): a Roadmap of more than five Milestones opens folded to the one row the board shows
 *   (the Current Milestone, or the one picked), so Needs you stays in the first viewport. "6 Milestones" in
 *   the header is the Collapsible's trigger; the other rows grow back in place, in Roadmap order. The
 *   Developer's own fold or unfold is remembered per project (`useRoadmapFold`, kept in localStorage). An open
 *   roadmap Round shows every row, since its changes are decided on them.
 *
 * Server data stays in React Query under the board's key (`board:changed` keeps it live), and the strip
 * never reorders its own copy: the new order is what the core says after the move.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ChevronDown, ChevronRight, Flag, GripVertical, Map as MapIcon, Plus } from "lucide-react";
import { milestoneCreate, milestoneList, milestoneMove, type MilestoneDto } from "../adapters/tauri";
import { ReadError } from "../components/ReadError";
import { StateBadge } from "../components/StateBadge";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleTrigger } from "../components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import { Skeleton } from "../components/ui/skeleton";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useUiStore } from "../state/uiStore";
import { ConfirmExitTest, milestoneExitTestConfirmable } from "./ConfirmExitTest";
import { EPIC_STATE_WORDS } from "./EpicProgress";
import { GhostRow, LastRoundNote, RevisitRoadmapButton, RoundBand, useRoadmapRound } from "./RoadmapRound";
import { MilestoneShapingControl } from "./MilestoneShapingControl";
import { errorText } from "./StoryControls";
import { cn } from "@/lib/utils";

/** The project's Roadmap, under the board's key so `board:changed` keeps it live. */
export function useRoadmap(projectId: string) {
  return useQuery({ queryKey: ["board", projectId, "milestones"], queryFn: () => milestoneList(projectId) });
}

/**
 * Which Milestone the board shows. `requested` is the developer's pick when it is still on the Roadmap,
 * else `null` ("the Current one"), and is what the header asks the core for. `shown` resolves `null` to
 * the Current Milestone's id once the Roadmap is read, for the strip's highlight and the roster's filter;
 * it is `null` only when the project has no Current Milestone and nothing is picked.
 */
export function useMilestoneSelection(projectId: string): { requested: string | null; shown: string | null } {
  const milestones = useRoadmap(projectId).data;
  const picked = useUiStore((state) => state.selectedMilestoneByProject[projectId] ?? null);
  // A pick is kept while the Roadmap loads, then dropped if that Milestone is not on it.
  const requested =
    picked !== null && (milestones === undefined || milestones.some((m) => m.id === picked)) ? picked : null;
  const shown = requested ?? milestones?.find((m) => m.current)?.id ?? null;
  return { requested, shown };
}

/**
 * A Roadmap longer than this opens folded to the row the board shows, until the Developer says otherwise. Five
 * 36px rows sit above a clamped Milestone header with Needs you still in the first viewport at 1280 x 800; past
 * that, the rows are what push it down.
 */
export const ROADMAP_FOLD_AFTER = 5;

/**
 * Whether each project's Roadmap is unfolded, as the Developer last left it (issue #201). UI state, so Zustand;
 * remembered across launches in localStorage, which may be missing or refuse (a private window): then the
 * choice lasts the session. Absent means "not chosen yet", and the Roadmap's length decides.
 */
interface RoadmapFoldState {
  openByProject: Record<string, boolean>;
  setOpen: (projectId: string, open: boolean) => void;
}

export const useRoadmapFold = create<RoadmapFoldState>()(
  persist(
    (set) => ({
      openByProject: {},
      setOpen: (projectId, open) => set((state) => ({ openByProject: { ...state.openByProject, [projectId]: open } })),
    }),
    {
      name: "flywheel.roadmap-fold",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ openByProject: state.openByProject }),
    },
  ),
);

/** A Done or Dropped Milestone keeps its place on the Roadmap. */
function isClosed(milestone: MilestoneDto): boolean {
  return milestone.state === "done" || milestone.state === "dropped";
}

/** Where `milestones[from]` lands when it moves to `to`'s place: before the Milestone that will follow it. */
function beforeIdFor(milestones: MilestoneDto[], from: number, to: number): string | null {
  return from > to ? milestones[to].id : (milestones[to + 1]?.id ?? null);
}

export function RoadmapStrip({ projectId }: { projectId: string }) {
  const roadmap = useRoadmap(projectId);
  const milestones = roadmap.data ?? [];
  const roundView = useRoadmapRound(projectId).data;
  const openRound = roundView?.open ?? null;
  const proposals = openRound ? (roundView?.proposals ?? []) : [];
  const ghostsUnder = (milestoneId: string) => proposals.filter((p) => p.anchorMilestoneId === milestoneId);
  const trailingGhosts = proposals.filter(
    (p) => p.anchorMilestoneId === null || !milestones.some((m) => m.id === p.anchorMilestoneId),
  );
  const { shown } = useMilestoneSelection(projectId);
  const selectMilestone = useUiStore((state) => state.selectMilestone);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // After a keyboard move the row is re-rendered at its new place; its handle keeps the focus.
  const refocus = useRef<string | null>(null);
  // After "+ Milestone" adds one, its row takes the focus once the Roadmap has re-read it.
  const focusRow = useRef<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const handleHintId = useId();
  const rowHintId = useId();
  const formId = useId();
  const listId = useId();
  const chosenOpen = useRoadmapFold((state) => state.openByProject[projectId]);
  const setFoldOpen = useRoadmapFold((state) => state.setOpen);
  // More than five Milestones (past about 180px of rows) open folded until the Developer says otherwise; an open Round shows them all.
  const foldable = milestones.length > 1 && !openRound;
  const unfolded = !foldable || (chosenOpen ?? milestones.length <= ROADMAP_FOLD_AFTER);
  const visible = (milestone: MilestoneDto) => unfolded || milestone.id === shown;
  const firstVisible = milestones.findIndex(visible);

  useEffect(() => {
    const id = refocus.current;
    if (!id || !listRef.current) return;
    const handle = listRef.current.querySelector<HTMLElement>(`[data-move-handle="${id}"]`);
    if (handle && document.activeElement !== handle) handle.focus();
  });
  useEffect(() => {
    const id = focusRow.current;
    if (!id || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
    if (row) {
      focusRow.current = null;
      row.focus();
    }
  });

  async function move(from: number, to: number, viaKeyboard: boolean) {
    const milestone = milestones[from];
    if (!milestone || isClosed(milestone) || to < 0 || to >= milestones.length || to === from) return;
    setError(null);
    refocus.current = viaKeyboard ? milestone.id : null;
    try {
      await milestoneMove(milestone.id, beforeIdFor(milestones, from, to));
      setAnnouncement(`Moved ${milestone.title} to position ${to + 1} of ${milestones.length}`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  function onRowKeyDown(event: KeyboardEvent, index: number, onHandle: boolean) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (!onHandle && !event.altKey) return;
    event.preventDefault();
    void move(index, event.key === "ArrowUp" ? index - 1 : index + 1, true);
  }

  function onDrop(event: DragEvent, index: number) {
    event.preventDefault();
    const from = milestones.findIndex((m) => m.id === dragging);
    setDragging(null);
    setDropTarget(null);
    if (from >= 0) void move(from, index, false);
  }

  const draggedIndex = milestones.findIndex((m) => m.id === dragging);
  // Issue #132: the shaping slot, on every row while any Milestone is in Shaping; issue #134: or while any
  // Milestone's exit test can be confirmed, which the same slot carries.
  const actionSlot = milestones.some((m) => m.state === "shaping" || milestoneExitTestConfirmable(m));

  return (
    <Collapsible asChild open={unfolded} onOpenChange={(next) => setFoldOpen(projectId, next)} disabled={!foldable}>
      <section
        aria-labelledby={headingId}
        data-slot="roadmap-strip"
        data-round-waiting={openRound?.waitingOnYou || undefined}
        className={cn(
          "flex flex-col overflow-clip rounded-lg bg-card text-card-foreground shadow-card",
          // A roadmap Round its session waits on wears the request card's 2px attention edge.
          openRound?.waitingOnYou ? "border-2 border-attention" : "border border-border",
        )}
      >
        <header className="flex min-h-11 items-center gap-3 border-b border-border py-1.5 pr-2 pl-4">
          <h2 id={headingId} className="m-0 text-section font-semibold">
            Roadmap
          </h2>
          {milestones.length > 0 &&
            (foldable ? (
              // The fold's trigger: the count, which says what unfolding shows.
              <CollapsibleTrigger asChild aria-controls={listId}>
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-1.5 text-small font-normal text-muted-foreground tabular-nums"
                >
                  {`${milestones.length} Milestones`}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "transition-transform duration-(--duration-state) ease-(--ease)",
                      !unfolded && "-rotate-90",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            ) : (
              <span className="text-small text-muted-foreground tabular-nums">
                {milestones.length === 1 ? "1 Milestone" : `${milestones.length} Milestones`}
              </span>
            ))}
          {!openRound && roundView?.last && <LastRoundNote round={roundView.last} now={Date.now()} />}
          <span className="ml-auto flex items-center gap-1.5">
            {!openRound && roadmap.isSuccess && milestones.length > 0 && <RevisitRoadmapButton projectId={projectId} />}
            {/* On an empty Roadmap the Empty below carries the one add. */}
            {milestones.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                ref={addRef}
                aria-label="Add a Milestone"
                aria-expanded={adding}
                aria-controls={adding ? formId : undefined}
                onClick={() => setAdding(true)}
              >
                <Plus aria-hidden="true" />
                Milestone
              </Button>
            )}
          </span>
        </header>
        {openRound && <RoundBand projectId={projectId} round={openRound} proposals={proposals} />}

        <p id={handleHintId} className="sr-only">
          Press the Up or Down arrow to move it on the Roadmap, or drag the row.
        </p>
        <p id={rowHintId} className="sr-only">
          Alt with the Up or Down arrow moves it on the Roadmap.
        </p>

        {roadmap.isPending && <Skeleton aria-label="Loading the Roadmap" className="mx-4 my-2 h-5 rounded-sm" />}
        {roadmap.isError && <ReadError title="Couldn't load the Roadmap" query={roadmap} className="m-3 w-auto" />}
        {roadmap.isSuccess && milestones.length === 0 && !adding && (
          <Empty className="gap-3 p-5">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MapIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No Milestone yet</EmptyTitle>
              <EmptyDescription>Add the first one: an outcome, with no date.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                ref={addRef}
                aria-label="Add a Milestone"
                aria-expanded={false}
                onClick={() => setAdding(true)}
              >
                <Plus aria-hidden="true" />
                Milestone
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {milestones.length > 0 && (
          <ol ref={listRef} id={listId} aria-label="Milestones in Roadmap order" className="m-0 list-none p-0">
            {milestones.map((milestone, index) => {
              // Folded, every row but the one the board shows shrinks to nothing and leaves the tab order.
              const folded = !visible(milestone);
              const closed = isClosed(milestone);
              const selected = milestone.id === shown;
              const dropping = dropTarget === milestone.id && dragging !== null && dragging !== milestone.id;
              const stateWord = EPIC_STATE_WORDS[milestone.state] ?? milestone.state;
              const exitTestId = `${headingId}-exit-${milestone.id}`;
              const ghosts = ghostsUnder(milestone.id);
              return (
                <li
                  key={milestone.id}
                  data-milestone-title={milestone.title}
                  data-selected={selected || undefined}
                  data-drop={dropping ? (draggedIndex > index ? "before" : "after") : undefined}
                  draggable={!closed}
                  onDragStart={(event) => {
                    if (closed) return;
                    event.dataTransfer.effectAllowed = "move";
                    // Firefox only starts a drag that carries data.
                    event.dataTransfer.setData("text/plain", milestone.title);
                    setDragging(milestone.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(event) => {
                    if (dragging === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dropTarget !== milestone.id) setDropTarget(milestone.id);
                  }}
                  onDrop={(event) => onDrop(event, index)}
                  inert={folded}
                  aria-hidden={folded || undefined}
                  data-folded={folded || undefined}
                  className={cn(
                    // The fold grows and shrinks each row in place (DESIGN.md § Motion: a disclosure grows on the
                    // overlay duration and leaves on the exit); under reduced motion it only fades.
                    "group/milestone relative grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-(--duration-overlay) ease-(--ease) motion-reduce:transition-opacity",
                    folded && "grid-rows-[0fr] opacity-0 duration-(--duration-overlay-exit)",
                    dragging === milestone.id && "opacity-50",
                    // The drop line: where the dragged Milestone will land, above or below this row.
                    "data-[drop]:after:absolute data-[drop]:after:inset-x-2 data-[drop]:after:h-0.5 data-[drop]:after:rounded-full data-[drop]:after:bg-ring",
                    "data-[drop=before]:after:-top-px data-[drop=after]:after:-bottom-px",
                  )}
                >
                  <div className={cn("min-h-0 overflow-hidden border-border", index > firstVisible && "border-t")}>
                    <div
                      className={cn(
                        "flex min-h-9 items-center transition-[background-color] duration-(--duration-state) ease-(--ease)",
                        // The picked Milestone takes the selected-row tint across the whole row, its handle too.
                        selected ? "bg-running-muted" : "hover:bg-accent",
                      )}
                    >
                      <span className="flex w-8 shrink-0 justify-center self-stretch pl-1">
                        {!closed && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                data-slot="roadmap-move-handle"
                                data-move-handle={milestone.id}
                                aria-label={`Move ${milestone.title}`}
                                aria-describedby={handleHintId}
                                onKeyDown={(event) => onRowKeyDown(event, index, true)}
                                onBlur={() => {
                                  if (refocus.current === milestone.id) refocus.current = null;
                                }}
                                className="my-auto flex h-7 w-6 cursor-grab items-center justify-center rounded-sm text-subtle-foreground transition-colors duration-(--duration-state) ease-(--ease) hover:bg-secondary hover:text-foreground active:cursor-grabbing"
                              >
                                <GripVertical aria-hidden="true" size={16} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Drag to reorder, or use the arrow keys</TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={`${milestone.title}, ${stateWord}${milestone.current ? ", Current Milestone" : ""}`}
                        data-row-id={milestone.id}
                        aria-describedby={closed ? exitTestId : `${exitTestId} ${rowHintId}`}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => selectMilestone(projectId, milestone.id)}
                        onKeyDown={(event) => onRowKeyDown(event, index, false)}
                        className="grid min-h-9 min-w-0 flex-1 grid-cols-[minmax(8rem,14rem)_7.5rem_minmax(0,1fr)_4.5rem_16px] items-center gap-x-3 rounded-sm py-1 pr-3 text-left"
                      >
                        <span
                          title={milestone.title}
                          className={cn(
                            "truncate text-row",
                            closed ? "font-normal text-muted-foreground" : "font-semibold",
                          )}
                        >
                          {milestone.title}
                        </span>
                        <span className="flex">
                          <StateBadge state={milestone.state} label={stateWord} className="h-5.5 text-meta" />
                        </span>
                        <span
                          id={exitTestId}
                          title={milestone.exitTest ?? undefined}
                          className={cn(
                            "truncate text-small",
                            closed ? "text-subtle-foreground" : "text-muted-foreground",
                            milestone.exitTest === null && "text-subtle-foreground",
                          )}
                        >
                          {milestone.exitTest ?? "Exit test not written yet"}
                        </span>
                        <span className="flex justify-end">
                          {milestone.current && (
                            <span className="inline-flex items-center gap-1 text-meta font-semibold text-foreground">
                              <Flag aria-hidden="true" size={13} strokeWidth={2.25} />
                              Current
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          size={16}
                          className={cn(
                            "transition-colors",
                            selected ? "text-running" : "text-subtle-foreground group-hover/milestone:text-foreground",
                          )}
                        />
                      </button>
                      {actionSlot && (
                        <span data-slot="roadmap-shaping" className="flex w-36 shrink-0 justify-end py-1 pr-2">
                          {/* The picked Milestone's header, right below, carries its control: one per screen. Issue
                          #134: every Epic Done, the slot holds Confirm exit test instead of shaping. */}
                          {!selected &&
                            (milestoneExitTestConfirmable(milestone) ? (
                              <ConfirmExitTest
                                projectId={projectId}
                                place="row"
                                subject={{
                                  kind: "milestone",
                                  id: milestone.id,
                                  title: milestone.title,
                                  exitTest: milestone.exitTest,
                                  state: milestone.state,
                                }}
                              />
                            ) : (
                              <MilestoneShapingControl projectId={projectId} milestone={milestone} place="strip" />
                            ))}
                        </span>
                      )}
                    </div>
                    {/* Issue #133: the roadmap Round's proposed changes to this Milestone, a list of their own. */}
                    {ghosts.length > 0 && (
                      <ul aria-label={`Proposed changes to ${milestone.title}`} className="m-0 list-none p-0">
                        {ghosts.map((p) => (
                          <GhostRow key={p.id} projectId={projectId} proposal={p} />
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {trailingGhosts.length > 0 && (
          <ul
            aria-label="Proposed new Milestones"
            className="m-0 list-none border-border p-0 [&>li:first-child]:border-t"
          >
            {trailingGhosts.map((p) => (
              <GhostRow key={p.id} projectId={projectId} proposal={p} />
            ))}
          </ul>
        )}

        {adding && (
          <NewMilestone
            id={formId}
            projectId={projectId}
            onDone={(created) => {
              setAdding(false);
              // Focus never falls to the page: back to "+ Milestone", then onto the new row once it is read.
              addRef.current?.focus();
              if (created) {
                focusRow.current = created.id;
                selectMilestone(projectId, created.id);
              }
            }}
          />
        )}

        {error && <p className="m-0 border-t border-border px-4 py-2 text-small text-destructive-text">{error}</p>}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>
    </Collapsible>
  );
}

/** "+ Milestone": a one-line outcome, added at the end of the Roadmap in Shaping. Escape or Cancel closes. */
function NewMilestone({
  id,
  projectId,
  onDone,
}: {
  id: string;
  projectId: string;
  onDone: (created: MilestoneDto | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const outcome = title.trim();
    if (outcome === "" || saving) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await milestoneCreate(projectId, outcome));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <form
      id={id}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(null);
      }}
      className="flex flex-wrap items-center gap-1.5 border-t border-border py-2 pr-2 pl-8"
    >
      <Input
        aria-label="New Milestone's outcome"
        placeholder="One line: the outcome it delivers, with no date"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="h-7.5 min-w-60 flex-1"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={title.trim() === "" || saving}>
        Add Milestone
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
        Cancel
      </Button>
      {error && <p className="m-0 basis-full text-small text-destructive-text">{error}</p>}
    </form>
  );
}
