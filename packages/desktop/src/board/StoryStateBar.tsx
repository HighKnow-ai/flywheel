import type { CSSProperties } from "react";
import type { StoryStateCountsDto } from "../adapters/tauri";
import type { IconName } from "../components/Icon";
import { cn } from "@/lib/utils";

/**
 * The stacked bar of Story states (docs/mvp-spec.md §7; direction.md § Tokens, `--chart-*`), shared by the
 * Milestone header and each Epic row so every bar on the board reads the same way.
 *
 * Segments run from done to not started: Merged, In review, then the two attention states the core splits
 * out of Running (Waiting on you, Stopped), Running, Ready and Shaping. The colours are the reserved bar
 * greys plus the three signal colours, each meaning what it means everywhere else: graphite for Merged,
 * yellow only for Waiting on you, blue for an agent at work, red for Stopped. Shaping is a hatch, the shape
 * of something not yet solid. Dropped is not a segment: a Dropped Story is closed but is not progress, so
 * the bar's denominator is the core's `storiesTotal`, which leaves Dropped out (the header names them).
 *
 * The bar never carries a count alone: it has an accessible name with every number, and the header's count
 * boxes repeat each segment's swatch as its legend.
 */
export interface BarSegment {
  key: keyof Omit<StoryStateCountsDto, "dropped" | "storiesTotal">;
  /** The state word, as StateBadge prints it. */
  label: string;
  /** The state's Lucide icon (components/StateBadge.tsx vocabulary). */
  icon: IconName;
  /** The swatch, as classes, so the legend draws exactly what the bar draws. */
  swatch: string;
  style?: CSSProperties;
}

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(-45deg, var(--chart-4) 0 3px, transparent 3px 6px)",
  boxShadow: "inset 0 0 0 1px var(--chart-4)",
};

export const BAR_SEGMENTS: readonly BarSegment[] = [
  { key: "merged", label: "Merged", icon: "GitMerge", swatch: "bg-chart-1" },
  { key: "inReview", label: "In review", icon: "GitPullRequest", swatch: "bg-chart-2" },
  { key: "waitingOnYou", label: "Waiting on you", icon: "Hand", swatch: "bg-attention" },
  { key: "stopped", label: "Stopped", icon: "CirclePause", swatch: "bg-destructive" },
  { key: "running", label: "Running", icon: "LoaderCircle", swatch: "bg-chart-3" },
  { key: "ready", label: "Ready", icon: "Circle", swatch: "bg-chart-4" },
  { key: "shaping", label: "Shaping", icon: "CircleDashed", swatch: "bg-transparent", style: HATCH },
];

/** "7 Stories: 1 merged, 1 in review, …, 1 Dropped not counted" — the bar's accessible name. */
export function barDescription(counts: StoryStateCountsDto): string {
  const total = counts.storiesTotal;
  const parts = BAR_SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`);
  const head = `${total} ${total === 1 ? "Story" : "Stories"}`;
  const body = parts.length > 0 ? `: ${parts.join(", ")}` : "";
  const dropped = counts.dropped > 0 ? `; ${counts.dropped} dropped, not counted` : "";
  return `${head}${body}${dropped}`;
}

export function StoryStateBar({ counts, className }: { counts: StoryStateCountsDto; className?: string }) {
  const description = barDescription(counts);
  return (
    <div
      role="img"
      aria-label={description}
      title={description}
      data-slot="story-state-bar"
      className={cn(
        "flex h-3 w-full gap-0.5 overflow-hidden rounded-full",
        counts.storiesTotal === 0 && "bg-secondary shadow-[inset_0_0_0_1px_var(--border)]",
        className,
      )}
    >
      {BAR_SEGMENTS.map((segment) =>
        counts[segment.key] > 0 ? (
          <span
            key={segment.key}
            data-segment={segment.key}
            className={cn(
              "block h-full transition-[flex-grow] duration-(--duration-state) ease-(--ease)",
              segment.swatch,
            )}
            style={{ flexGrow: counts[segment.key], flexBasis: 0, ...segment.style }}
          />
        ) : null,
      )}
    </div>
  );
}
