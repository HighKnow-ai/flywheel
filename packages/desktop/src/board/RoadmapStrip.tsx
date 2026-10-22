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
 *
 * Server data stays in React Query under the board's key (`board:changed` keeps it live), and the strip
 * never reorders its own copy: the new order is what the core says after the move.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { milestoneCreate, milestoneList, milestoneMove, type MilestoneDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useUiStore } from "../state/uiStore";
import { EPIC_STATE_WORDS } from "./EpicProgress";
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
  const requested = picked !== null && (milestones === undefined || milestones.some((m) => m.id === picked)) ? picked : null;
  const shown = requested ?? milestones?.find((m) => m.current)?.id ?? null;
  return { requested, shown };
}

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
  const { shown } = useMilestoneSelection(projectId);
  const selectMilestone = useUiStore((state) => state.selectMilestone);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // After a keyboard move the row is re-rendered at its new place; its handle keeps the focus.
  const refocus = useRef<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const headingId = useId();
  const hintId = useId();

  useEffect(() => {
    const id = refocus.current;
    if (!id || !listRef.current) return;
    const handle = listRef.current.querySelector<HTMLElement>(`[data-move-handle="${id}"]`);
    if (handle && document.activeElement !== handle) handle.focus();
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

  return (
    <section
      aria-labelledby={headingId}
      data-slot="roadmap-strip"
      className="flex flex-col rounded-lg border border-border bg-card text-card-foreground shadow-card"
    >
      <header className="flex min-h-11 items-center gap-3 border-b border-border py-1.5 pr-2 pl-4">
        <h2 id={headingId} className="m-0 text-section font-semibold">
          Roadmap
        </h2>
        {milestones.length > 0 && (
          <span className="text-small text-muted-foreground tabular-nums">
            {milestones.length === 1 ? "1 Milestone" : `${milestones.length} Milestones`}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          aria-label="Add a Milestone"
          aria-expanded={adding}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          Milestone
        </Button>
      </header>

      <p id={hintId} className="sr-only">
        Drag the row, or press Alt with the Up or Down arrow, to move it on the Roadmap.
      </p>

      {roadmap.isError && <p className="m-0 px-4 py-3 text-body text-destructive-text">{errorText(roadmap.error)}</p>}
      {roadmap.isSuccess && milestones.length === 0 && !adding && (
        <p className="m-0 px-4 py-3 text-body text-muted-foreground">
          No Milestone yet. Add the first one: an outcome, with no date.
        </p>
      )}

      {milestones.length > 0 && (
        <ol ref={listRef} aria-label="Milestones in Roadmap order" className="m-0 list-none p-0">
          {milestones.map((milestone, index) => {
            const closed = isClosed(milestone);
            const selected = milestone.id === shown;
            const dropping = dropTarget === milestone.id && dragging !== null && dragging !== milestone.id;
            const stateWord = EPIC_STATE_WORDS[milestone.state] ?? milestone.state;
            const exitTestId = `${headingId}-exit-${milestone.id}`;
            return (
              <li
                key={milestone.id}
                data-milestone-title={milestone.title}
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
                className={cn(
                  "group/milestone relative flex min-h-10 items-center border-border",
                  index > 0 && "border-t",
                  dragging === milestone.id && "opacity-50",
                  // The drop line: where the dragged Milestone will land, above or below this row.
                  "data-[drop]:after:absolute data-[drop]:after:inset-x-2 data-[drop]:after:h-0.5 data-[drop]:after:rounded-full data-[drop]:after:bg-ring",
                  "data-[drop=before]:after:-top-px data-[drop=after]:after:-bottom-px",
                )}
              >
                <span className="flex w-9 shrink-0 justify-center self-stretch">
                  {!closed && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-move-handle={milestone.id}
                          aria-label={`Move ${milestone.title}`}
                          aria-describedby={hintId}
                          onKeyDown={(event) => onRowKeyDown(event, index, true)}
                          onBlur={() => {
                            if (refocus.current === milestone.id) refocus.current = null;
                          }}
                          className="my-auto flex h-7 w-6 cursor-grab items-center justify-center rounded-sm text-subtle-foreground transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent hover:text-foreground active:cursor-grabbing"
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
                  aria-describedby={exitTestId}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => selectMilestone(projectId, milestone.id)}
                  onKeyDown={(event) => onRowKeyDown(event, index, false)}
                  className={cn(
                    "grid min-h-10 min-w-0 flex-1 grid-cols-[minmax(0,15rem)_7.5rem_minmax(0,1fr)_auto_16px] items-center gap-x-3 rounded-sm py-1 pr-3 text-left",
                    "transition-[background-color] duration-(--duration-state) ease-(--ease)",
                    selected ? "bg-running-muted" : "hover:bg-accent",
                  )}
                >
                  <span
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
                      <span className="type-condensed rounded-sm border border-border px-1.5 text-meta leading-5 text-foreground">
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
              </li>
            );
          })}
        </ol>
      )}

      {adding && (
        <NewMilestone
          projectId={projectId}
          onDone={(created) => {
            setAdding(false);
            if (created) selectMilestone(projectId, created.id);
          }}
        />
      )}

      {error && <p className="m-0 border-t border-border px-4 py-2 text-small text-destructive-text">{error}</p>}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/** "+ Milestone": a one-line outcome, added at the end of the Roadmap in Shaping. Escape or Cancel closes. */
function NewMilestone({ projectId, onDone }: { projectId: string; onDone: (created: MilestoneDto | null) => void }) {
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
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(null);
      }}
      className="flex flex-wrap items-center gap-1.5 border-t border-border py-2 pr-2 pl-12"
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
