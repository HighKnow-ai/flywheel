import { Layers, MessagesSquare } from "lucide-react";
import type { EpicProgressDto, ShapingMarkerDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { STAGE_LABELS } from "../shaping/RoundDock";
import { StoryStateBar } from "./StoryStateBar";
import { cn } from "@/lib/utils";

/** Where an Epic in Shaping has got to, in words: "Stage 2 of 3, Slice into Stories · Round 3 · 2 of 5
 * answered" (issue #159). The core reads it; this only words it. */
export function shapingMarkerWords(marker: ShapingMarkerDto): string {
  if (marker.stageKind === null) return "Not shaped yet";
  const stage = `Stage ${marker.stageRank ?? 1} of 3, ${STAGE_LABELS[marker.stageKind] ?? marker.stageKind}`;
  if (marker.roundNumber === null) return `${stage} · no Round yet`;
  const round = `Round ${marker.roundNumber}`;
  return marker.roundOpen
    ? `${stage} · ${round} · ${marker.answered} of ${marker.questions} answered`
    : `${stage} · ${round} answered`;
}

/** The shaping marker under an Epic's title on its roster card, in secondary ink beside `messages-square`. */
function ShapingMarker({ marker }: { marker: ShapingMarkerDto }) {
  const words = shapingMarkerWords(marker);
  return (
    <span data-shaping-marker="" className="flex min-w-0 items-center gap-1.5 pl-6 text-meta text-muted-foreground tabular-nums">
      <MessagesSquare aria-hidden="true" size={13} className="shrink-0" />
      <span className="truncate" title={words}>
        {words}
      </span>
    </span>
  );
}

/** The Epic and Milestone state words (GLOSSARY.md "Epic state"); `done` is the Exit test confirmed. */
export const EPIC_STATE_WORDS: Record<string, string> = {
  shaping: "Shaping",
  ready: "Ready",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

/** "3 of 7 Stories merged", with the two numbers set apart so they read first. */
export function MergedFraction({ merged, total }: { merged: number; total: number }) {
  if (total === 0) return <span className="text-small text-muted-foreground">No Stories yet</span>;
  return (
    <span className="text-small whitespace-nowrap text-muted-foreground tabular-nums">
      <b className="font-semibold text-foreground">
        {merged} of {total}
      </b>{" "}
      {total === 1 ? "Story" : "Stories"} merged
    </span>
  );
}

/**
 * One Epic's progress (docs/mvp-spec.md §7, roster "one row per Epic"): its title and state, a stacked bar
 * of its Stories and "n of m Stories merged". Every number is the core's (`milestone_progress`); this draws.
 * Inert: it does not navigate, so it carries no chevron (direction.md, the Clickable Looks Clickable Rule).
 */
export function EpicProgress({
  epic,
  headingId,
  className,
}: {
  epic: EpicProgressDto;
  /** Set when the row heads the Epic's card on the board: its title becomes that card's heading. */
  headingId?: string;
  className?: string;
}) {
  const Title = headingId ? "h2" : "span";
  return (
    <div
      data-epic-id={epic.epicId}
      // A row of three at board widths, so every Epic's bar sits in one column; on a narrow window the bar and
      // the fraction wrap under the title rather than squeezing it.
      className={cn("flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 py-1", className)}
    >
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Layers size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <Title id={headingId} className="m-0 truncate text-section font-semibold" title={epic.title}>
            {epic.title}
          </Title>
          {/* Attention is shown in place of the state word (spec §2, issue #124). */}
          <StateBadge
            state={epic.attention ?? epic.state}
            label={epic.attention ? undefined : EPIC_STATE_WORDS[epic.state]}
            className="shrink-0"
          />
        </div>
        {epic.shaping && <ShapingMarker marker={epic.shaping} />}
      </div>
      <div className="flex min-w-0 flex-[0_1_448px] items-center gap-4">
        <StoryStateBar counts={epic.counts} className="h-2.5 min-w-0 flex-1" />
        <div className="w-[150px] flex-none text-right">
          <MergedFraction merged={epic.counts.merged} total={epic.counts.storiesTotal} />
        </div>
      </div>
    </div>
  );
}
