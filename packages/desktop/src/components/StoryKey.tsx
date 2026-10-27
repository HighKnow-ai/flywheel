import type * as React from "react";
import { cn } from "@highknow/design";

/**
 * A record's key (`FLY-12`, an Epic's `E-3`), drawn the same everywhere (DESIGN.md § Components): the code
 * face, tabular, quiet, and never broken across lines. `size` follows the text it sits beside: `meta` in a
 * row or a lamp, `small` beside a 15–17px title. `tone="inherit"` takes the surrounding ink, for the andon
 * strip and a selected row; the default is the muted ink.
 */
export function StoryKey({
  value,
  size = "meta",
  tone = "muted",
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: string;
  size?: "meta" | "small";
  tone?: "muted" | "inherit";
}) {
  return (
    <span
      data-slot="story-key"
      className={cn(
        "shrink-0 font-mono font-normal whitespace-nowrap tabular-nums",
        size === "meta" ? "text-meta" : "text-small",
        tone === "muted" && "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {value}
    </span>
  );
}
