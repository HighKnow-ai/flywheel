import type { ReactNode } from "react";
import { TruncateTip } from "@/components/TruncateTip";
import { Layers, MessagesSquare } from "lucide-react";
import type { EpicProgressDto, ShapingMarkerDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { STAGE_LABELS } from "../shaping/RoundDock";
import { StoryStateBar } from "./StoryStateBar";
import { cn } from "@highknow/design";

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
    <span
      data-shaping-marker=""
      className="flex min-w-0 items-center gap-1.5 pl-6 text-meta text-muted-foreground tabular-nums"
    >
      <MessagesSquare aria-hidden="true" size={13} className="shrink-0" />
      <TruncateTip text={words}>
        <span className="truncate">{words}</span>
      </TruncateTip>
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
 * The one grid every Epic card header sits on (issue #202): title and state, then a bar that flexes with the
 * card, then the count, then the actions, right-aligned. Every card on the roster is the same width, so the
 * bar and the count fall in one column down the board; the actions column has a floor wide enough for
 * "+ Story", Answer and the shaping chevron, so a card with fewer actions does not pull its bar right. The title takes three parts of
 * what is left and the bar two, so the title keeps its room as the card narrows. Below a 48rem card (the roster
 * beside Needs you up to a window about 1500px wide, or alone in a window under 1060px) the bar and the count
 * drop to a second line under the title, the actions staying on the first.
 *
 * Needs an `@container/epic` ancestor (the Epic's card); without one it lays out narrow.
 */
export const EPIC_HEADER_GRID = cn(
  "grid min-w-0 items-center gap-x-4 gap-y-1.5",
  "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'title_actions'_'bar_count']",
  "@3xl/epic:grid-cols-[minmax(14rem,3fr)_minmax(6rem,2fr)_minmax(9.5rem,auto)_minmax(13rem,auto)]",
  "@3xl/epic:[grid-template-areas:'title_bar_count_actions']",
);

/**
 * One Epic's progress (docs/mvp-spec.md §7, roster "one row per Epic"): its title and state, a stacked bar
 * of its Stories and "n of m Stories merged", then any actions, on the header grid (`EPIC_HEADER_GRID`).
 * Every number is the core's (`milestone_progress`); this draws. Inert: it does not navigate, so it carries
 * no chevron (direction.md, the Clickable Looks Clickable Rule).
 */
export function EpicProgress({
  epic,
  headingId,
  actions,
  className,
}: {
  epic: EpicProgressDto;
  /** Set when the row heads the Epic's card on the board: its title becomes that card's heading. */
  headingId?: string;
  /** The card's own controls (n Proposals, + Story, Shape), in the grid's right-aligned last column. */
  actions?: ReactNode;
  className?: string;
}) {
  const Title = headingId ? "h2" : "span";
  return (
    <div data-epic-id={epic.epicId} className={cn(EPIC_HEADER_GRID, "min-h-11 py-1", className)}>
      <div className="flex min-w-0 flex-col gap-0.5 [grid-area:title]">
        <div className="flex min-w-0 items-center gap-2">
          <Layers size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <TruncateTip text={epic.title}>
            <Title id={headingId} className="m-0 truncate text-section font-semibold">
              {epic.title}
            </Title>
          </TruncateTip>
          {/* Attention is shown in place of the state word (spec §2, issue #124). */}
          <StateBadge
            state={epic.attention ?? epic.state}
            label={epic.attention ? undefined : EPIC_STATE_WORDS[epic.state]}
            className="shrink-0"
          />
        </div>
        {epic.shaping && <ShapingMarker marker={epic.shaping} />}
      </div>
      <StoryStateBar counts={epic.counts} className="h-2.5 min-w-0 [grid-area:bar]" />
      <div className="text-right [grid-area:count]">
        <MergedFraction merged={epic.counts.merged} total={epic.counts.storiesTotal} />
      </div>
      <EpicHeaderActions>{actions}</EpicHeaderActions>
    </div>
  );
}

/** The header grid's actions cell: right-aligned, in the order they are given. */
export function EpicHeaderActions({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-1.5 [grid-area:actions] empty:hidden">{children}</div>
  );
}
