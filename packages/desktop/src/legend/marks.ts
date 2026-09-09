/**
 * The single registry of every mark the UI may render (01-UI-SPEC.md
 * "Selected Direction" — "Raised by Orienteering Map (declined)": a
 * published, always-reachable legend, and "no mark may exist that the
 * legend does not define."
 *
 * Legend.tsx renders exactly this array — it never restates a second,
 * hand-maintained list. Later plans append their own entries here as they
 * introduce new glyphs (status shapes, priority bar-counts, actor badges,
 * etc.) rather than inventing an undocumented mark.
 */

export type MarkChannel = "row-state" | "focus";

export interface Mark {
  /** Stable identifier — matches the CSS token role this mark represents, where one exists. */
  id: string;
  /** Which channel of meaning this mark belongs to, for grouping in the Legend surface. */
  channel: MarkChannel;
  /**
   * The glyph shown in the legend, named as a `lucide-react` export (01-UI-SPEC.md's
   * locked icon-library decision: uniform 2px stroke, round joins, outline-only —
   * no filled glyphs, no unicode/emoji standing in for an icon system). Legend.tsx
   * resolves this name to the real icon component. Never empty — a mark's meaning
   * must never rest on colour alone.
   */
  glyph: string;
  /** The printed word shown next to the glyph. Never empty. */
  label: string;
  /** What the mark means, for the legend's descriptive text. */
  meaning: string;
}

export const MARKS: Mark[] = [
  {
    id: "row-surface",
    channel: "row-state",
    glyph: "Square",
    label: "Idle row",
    meaning: "A row at rest — no hover, no selection.",
  },
  {
    id: "row-surface-hover",
    channel: "row-state",
    glyph: "SquareDashed",
    label: "Hovered row",
    meaning: "The pointer is currently over this row.",
  },
  {
    id: "row-surface-selected",
    channel: "row-state",
    glyph: "SquareDot",
    label: "Selected row",
    meaning: "This row is selected and the list holds keyboard focus.",
  },
  {
    id: "row-surface-selected-unfocused",
    channel: "row-state",
    glyph: "SquareMinus",
    label: "Selected, unfocused row",
    meaning:
      "This row is selected but keyboard focus has moved elsewhere (e.g. the detail panel).",
  },
  {
    id: "focus-ring",
    channel: "focus",
    glyph: "Focus",
    label: "Focus ring",
    meaning: "The element currently reachable by keyboard Tab order.",
  },
];
