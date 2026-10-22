/**
 * The andon strip (direction.md § Direction contract, § Click and navigation model): one lamp per live
 * Story session across the top of every screen, in every project, so "where is the agent" and "what needs
 * me" always have the same answer.
 *
 * A lamp is lit yellow while its session is Waiting on you, blue while its agent works, and red while its
 * Story is Stopped (Running, with no live session and no hand-off). Each lamp names the Story and what it
 * waits on or is doing, and always carries an icon and a word, never the hue alone. Order: Waiting on you
 * first (longest waiting first), then Running, then Stopped. A lamp that does not fit folds into a
 * "+n more" lamp that opens All agents. With nothing running the strip keeps its height and says so.
 *
 * Clicking a lamp opens its Story, never its session (spec §7's click model, issue #104). The lamp of the
 * Story the developer is on carries a white outline.
 *
 * Everything here is read from the fleet's one app-wide query (`useFleet`), the same read the sidebar and
 * All agents use, so the three can never disagree. A Stopped lamp reads its ending label from the same
 * `story_stopped` query the Story's own row uses.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight, CirclePause, Hand, LoaderCircle } from "lucide-react";
import { storyStopped, type FleetRowDto } from "../adapters/tauri";
import { endingWords } from "../board/StoryControls";
import { useFleet } from "../fleet/useFleet";
import { formatAge } from "../legend/runStatus";
import { prefersReducedMotion } from "../session/FeedRow";
import { useUiStore } from "../state/uiStore";
import { cn } from "@/lib/utils";

export type LampTone = "waiting" | "running" | "stopped";

export interface LampData {
  tone: LampTone;
  row: FleetRowDto;
}

const LAMP_WIDTH = 248;
const LAMP_GAP = 8;
/** The "+n more" lamp is narrower: it carries a count and a word. */
const MORE_WIDTH = 120;

function isLive(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** Every lamp the fleet read implies, in strip order. Pure, so the order is testable on its own. */
export function lampsFromFleet(rows: FleetRowDto[]): LampData[] {
  const live = rows.filter(isLive);
  const liveStories = new Set(live.map((row) => row.storyId));
  const waiting = live
    .filter((row) => row.fleetState === "blocked")
    .sort((a, b) => (a.blockedSince ?? a.startedAt).localeCompare(b.blockedSince ?? b.startedAt));
  const running = live.filter((row) => row.fleetState !== "blocked").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // Stopped: a Running Story whose newest session has ended. One lamp per Story, from that newest session.
  const newestEnded = new Map<string, FleetRowDto>();
  for (const row of rows) {
    if (isLive(row) || row.storyState !== "running" || liveStories.has(row.storyId)) continue;
    const seen = newestEnded.get(row.storyId);
    if (!seen || row.startedAt > seen.startedAt) newestEnded.set(row.storyId, row);
  }
  const stopped = [...newestEnded.values()].sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""));
  return [
    ...waiting.map((row) => ({ tone: "waiting" as const, row })),
    ...running.map((row) => ({ tone: "running" as const, row })),
    ...stopped.map((row) => ({ tone: "stopped" as const, row })),
  ];
}

/** How many lamps fit a strip of `width` px, keeping room for the "+n more" lamp when some do not. */
export function lampCapacity(width: number, count: number): number {
  const fit = (w: number) => Math.max(0, Math.floor((w + LAMP_GAP) / (LAMP_WIDTH + LAMP_GAP)));
  if (fit(width) >= count) return count;
  return Math.min(count, fit(width - MORE_WIDTH - LAMP_GAP));
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.getBoundingClientRect().width || element.offsetWidth);
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** One clock for the whole strip, so every lamp's age moves together; once a minute is enough. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const BULB_ICON = { waiting: Hand, running: LoaderCircle, stopped: CirclePause } as const;
const TONE_WORD = { waiting: "Waiting on you", running: "Running", stopped: "Stopped" } as const;

function LampDetail({ lamp, now }: { lamp: LampData; now: number }) {
  const { row, tone } = lamp;
  const stoppedQuery = useQuery({
    queryKey: ["board", row.projectId, "stopped", row.storyId],
    queryFn: () => storyStopped(row.storyId),
    enabled: tone === "stopped",
  });
  if (tone === "waiting") return <>{`Waiting on you · ${formatAge(row.blockedSince ?? row.startedAt, now)}`}</>;
  if (tone === "stopped") {
    const stopped = stoppedQuery.data;
    const reason = stopped ? endingWords(stopped.endingReason) : null;
    return <>{`Stopped${reason ? `: ${reason}` : ""} · ${formatAge(row.endedAt ?? row.startedAt, now)}`}</>;
  }
  return <>{row.doingTaskTitle ? `Doing: ${row.doingTaskTitle}` : `Running · ${formatAge(row.startedAt, now)}`}</>;
}

export function Lamp({ lamp, current, now }: { lamp: LampData; current: boolean; now: number }) {
  const openStory = useUiStore((state) => state.openStory);
  const { row, tone } = lamp;
  const Bulb = BULB_ICON[tone];
  const pulse = tone === "running" && !prefersReducedMotion();
  const subject = `${row.storyKey} ${row.storyTitle}`.trim();
  return (
    <button
      type="button"
      data-lamp={tone}
      data-story-id={row.storyId}
      aria-current={current ? "location" : undefined}
      aria-label={`Open Story ${subject}, ${TONE_WORD[tone]}`}
      title={subject}
      onClick={() => openStory(row.projectId, row.storyId)}
      style={{ width: LAMP_WIDTH }}
      className={cn(
        "group/lamp flex h-13 shrink-0 items-center gap-2.5 rounded-lg border px-2.5 text-left transition-colors duration-(--duration-lamp) ease-(--ease) focus-visible:outline-strip-foreground",
        tone === "waiting"
          ? "border-attention bg-attention text-attention-foreground hover:bg-attention/90"
          : "border-white/10 bg-lamp text-strip-foreground hover:bg-white/10",
        current && "outline-2 outline-offset-2 outline-strip-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          tone === "waiting" && "bg-attention-foreground/10 text-attention-foreground",
          tone === "running" && "bg-primary text-primary-foreground",
          tone === "stopped" && "bg-destructive text-destructive-foreground",
        )}
      >
        <Bulb size={16} strokeWidth={2} className={pulse ? "agent-pulse" : undefined} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5 text-small font-semibold">
          <span className="shrink-0 font-mono text-meta font-normal">{row.storyKey}</span>
          <span className="truncate">{row.storyTitle}</span>
        </span>
        <span
          className={cn(
            "truncate text-meta",
            tone === "waiting" ? "font-semibold text-attention-foreground" : "text-strip-muted-foreground",
          )}
        >
          <LampDetail lamp={lamp} now={now} />
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        size={16}
        className={cn("shrink-0", tone === "waiting" ? "text-attention-foreground" : "text-strip-muted-foreground")}
      />
    </button>
  );
}

export function AndonStrip() {
  const rows = useFleet().data?.rows ?? [];
  const lamps = lampsFromFleet(rows);
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const placeStoryId = useUiStore((state) => (state.activeSessionId ? state.activeSessionStoryId : state.currentStoryId));
  const [laneRef, laneWidth] = useWidth<HTMLDivElement>();
  const now = useMinuteTick();
  const capacity = laneWidth > 0 ? lampCapacity(laneWidth, lamps.length) : lamps.length;
  const shown = lamps.slice(0, capacity);
  const hidden = lamps.length - shown.length;
  const liveCount = lamps.filter((lamp) => lamp.tone !== "stopped").length;

  return (
    <section
      aria-label="Agents"
      className="flex h-18 shrink-0 items-center gap-3 border-b border-border bg-strip px-4 text-strip-foreground"
    >
      <div className="flex w-14 shrink-0 flex-col gap-0.5">
        <span className="font-condensed text-meta tracking-[0.06em] text-strip-muted-foreground uppercase">Agents</span>
        <span className="text-section leading-none font-semibold tabular-nums" aria-label={`${liveCount} live`}>
          {liveCount}
        </span>
      </div>
      <div ref={laneRef} role="list" aria-label="Live sessions" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {lamps.length === 0 ? (
          <span role="listitem" className="text-small text-strip-muted-foreground">
            No agent running
          </span>
        ) : (
          <>
            {shown.map((lamp) => (
              <div role="listitem" key={lamp.row.sessionId} className="shrink-0">
                <Lamp lamp={lamp} current={lamp.row.storyId === placeStoryId} now={now} />
              </div>
            ))}
            {hidden > 0 && (
              <div role="listitem" className="shrink-0">
                <button
                  type="button"
                  onClick={() => setFleetSurface({ view: "fleet" })}
                  style={{ width: MORE_WIDTH }}
                  className="flex h-13 items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/25 text-small font-semibold text-strip-foreground transition-colors duration-(--duration-state) ease-(--ease) hover:bg-white/10 focus-visible:outline-strip-foreground"
                >
                  {`+${hidden} more`}
                  <ChevronRight aria-hidden="true" size={16} className="text-strip-muted-foreground" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Open All agents"
        onClick={() => setFleetSurface({ view: "fleet" })}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-3 text-body font-semibold text-strip-foreground transition-colors duration-(--duration-state) ease-(--ease) hover:bg-white/10 focus-visible:outline-strip-foreground"
      >
        <Activity aria-hidden="true" size={16} />
        All agents
      </button>
    </section>
  );
}
