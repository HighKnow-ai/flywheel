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

export type MarkChannel =
  | "row-state"
  | "focus"
  | "status"
  | "priority"
  | "epic"
  | "criteria"
  | "estimate"
  | "assignee"
  | "project"
  | "agent";

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
  // Status glyphs (01-UI-SPEC.md "Row Anatomy" — shape carries the meaning, colour is a
  // redundant second channel). `id` matches the strip-stock CSS token for the same state, so
  // Legend.tsx can render the actual tint as the swatch background.
  {
    id: "strip-backlog",
    channel: "status",
    glyph: "CircleDashed",
    label: "Backlog",
    meaning: "Not yet started — a dashed, empty circle.",
  },
  {
    id: "strip-todo",
    channel: "status",
    glyph: "Circle",
    label: "Todo",
    meaning: "Queued to start — an empty circle.",
  },
  {
    id: "strip-in-progress",
    channel: "status",
    glyph: "CircleDot",
    label: "In Progress",
    meaning: "Actively being worked — a half-filled circle.",
  },
  {
    id: "strip-in-review",
    channel: "status",
    glyph: "CircleEllipsis",
    label: "In Review",
    meaning: "Awaiting review — a circle with an eye/dot mark.",
  },
  {
    id: "strip-done",
    channel: "status",
    glyph: "CircleCheckBig",
    label: "Done",
    meaning: "Complete — a filled circle with a check mark.",
  },
  // Priority glyphs (01-UI-SPEC.md "Row Anatomy" — a stacked-bars icon whose filled-bar count
  // increases with priority level). `No priority` is keyed `0` in the keyboard map but SORTS
  // LAST in every board query (01-UI-SPEC.md Open Decisions #6) — the glyph and this legend
  // entry describe the keymap/label, not the sort position.
  {
    id: "priority-no-priority",
    channel: "priority",
    glyph: "SignalZero",
    label: "No priority",
    meaning: "Unprioritised — keyed 0, but sorts last within its status band, not first.",
  },
  {
    id: "priority-urgent",
    channel: "priority",
    glyph: "Signal",
    label: "Urgent",
    meaning: "Highest priority — keyed 1, all bars filled.",
  },
  {
    id: "priority-high",
    channel: "priority",
    glyph: "SignalHigh",
    label: "High",
    meaning: "Keyed 2.",
  },
  {
    id: "priority-medium",
    channel: "priority",
    glyph: "SignalMedium",
    label: "Medium",
    meaning: "Keyed 3.",
  },
  {
    id: "priority-low",
    channel: "priority",
    glyph: "SignalLow",
    label: "Low",
    meaning: "Lowest declared priority — keyed 4, one bar filled.",
  },
  // The orphan-task pill (D-13, 01-UI-SPEC.md "Board list") — a task with no epic shows this
  // muted pill in the epic field slot, never a blank.
  {
    id: "epic-pill-none",
    channel: "epic",
    glyph: "CircleSlash",
    label: "No epic",
    meaning: "This task has no parent epic yet (D-13) — it may exist before its epic is known.",
  },
  // Defence in depth (G-01-2, T-01-17-02): once the epic pill resolves against the project's
  // full roster (`useEpics()`), this outcome is reachable only while that roster query is
  // pending or has failed — it exists so a future regression in the roster's source degrades to
  // a readable word rather than back to leaking `BoardRow.tsx`'s row's own internal epic id.
  {
    id: "epic-pill-unresolved",
    channel: "epic",
    glyph: "CircleHelp",
    label: "Unknown epic",
    meaning:
      "This item names an epic Flywheel could not resolve from the project's roster — the internal id is never shown in its place.",
  },
  // Acceptance-criteria marks (BOARD-02, D-05/D-06/D-08). The checked/total badge is
  // structurally exempt from the row's progressive-disclosure ladder (01-UI-SPEC.md "Row
  // Anatomy") — D-08 requires it "visible wherever the item appears."
  {
    id: "criterion-checked",
    channel: "criteria",
    glyph: "SquareCheck",
    label: "Checked criterion",
    meaning: "This acceptance criterion has been verified true.",
  },
  {
    id: "criterion-unchecked",
    channel: "criteria",
    glyph: "Square",
    label: "Unchecked criterion",
    meaning: "This acceptance criterion has not yet been verified.",
  },
  {
    id: "criteria-count-badge",
    channel: "criteria",
    glyph: "ListChecks",
    label: "Criteria checked/total",
    meaning:
      "How many of this item's acceptance criteria are checked, out of its total. Visible wherever the item appears (D-08); an item with none shows 0/0.",
  },
  // Estimate marks (D-12: S/M/L, stored as a nullable ordinal INTEGER 1-3, rendered as the
  // letters themselves — never as a number, and never aggregated anywhere in the UI or a query).
  // Sharing one glyph across the three levels is deliberate, mirroring `criteria-count-badge`:
  // the row renders the letter itself as the badge text, not the icon; the glyph exists for the
  // Legend surface's own entry.
  {
    id: "estimate-small",
    channel: "estimate",
    glyph: "Ruler",
    label: "Small",
    meaning: "S — small estimated effort. Never summed, averaged or converted to a point value.",
  },
  {
    id: "estimate-medium",
    channel: "estimate",
    glyph: "Ruler",
    label: "Medium",
    meaning: "M — medium estimated effort.",
  },
  {
    id: "estimate-large",
    channel: "estimate",
    glyph: "Ruler",
    label: "Large",
    meaning: "L — large estimated effort.",
  },
  // Assignee marks (BOARD-06) — a human and an agent actor are peers in one actor model; the
  // badge distinguishes which is which without relying on colour alone (01-UI-SPEC.md Activity
  // trail: "a badge distinguishing human vs agent vs system, never colour alone").
  {
    id: "assignee-human",
    channel: "assignee",
    glyph: "User",
    label: "Human",
    meaning: "This item is assigned to a human actor.",
  },
  {
    id: "assignee-agent",
    channel: "assignee",
    glyph: "Bot",
    label: "Agent",
    meaning: "This item is assigned to an agent actor.",
  },
  {
    id: "assignee-unassigned",
    channel: "assignee",
    glyph: "UserRound",
    label: "Unassigned",
    meaning: "No assignee is set on this item.",
  },
  // The third peer in the actor model (DATA-03) — Flywheel itself, acting without a human at the
  // keyboard (e.g. a future background reconciliation). No item is ever assigned to it in Phase 1
  // (`actorTypeMarkId` below only reaches this mark for the activity trail's own actor badge, not
  // for an assignee), but the mark exists now so `render_description`'s human/agent/system triad
  // (01-UI-SPEC.md "Activity trail") is never missing its third case.
  {
    id: "assignee-system",
    channel: "assignee",
    glyph: "Cog",
    label: "System",
    meaning: "This event or item is attributed to Flywheel itself, not a human or an agent.",
  },
  // Project switcher marks (01-UI-SPEC.md "Project switcher (left rail)", D-16, plan 01-11). The
  // rail itself renders a project's key prefix as literal text (e.g. `FLY`), not these icons —
  // these three marks exist for the Legend surface's own entries ("no mark may exist that the
  // legend does not define"), mirroring `estimate-small`/`-medium`/`-large`'s role above: the
  // real glyph is the printed text, this entry documents the channel.
  {
    id: "project-entry",
    channel: "project",
    glyph: "FolderGit2",
    label: "Project",
    meaning: "One registered repository's board — the rail shows its key prefix as the real glyph.",
  },
  {
    id: "project-current",
    channel: "project",
    glyph: "Dot",
    label: "Current project",
    meaning:
      "The project whose board is open — one of the few places the accent role marks the current position (01-UI-SPEC.md Color & Token Roles).",
  },
  {
    id: "project-unreachable",
    channel: "project",
    glyph: "TriangleAlert",
    label: "Unreachable",
    meaning:
      "This project's marker no longer matches its last known path (D-16) — paired with the literal word \"Unreachable,\" never a colour change alone.",
  },
  // Agent run-status marks (02-UI-SPEC.md "Run Status", AGNT-06) — the five run states plus the
  // orthogonal blocked indicator that layers onto a task's existing five-state status glyph rather
  // than replacing it. Published here before any surface renders them (02-04 through 02-08 own the
  // rendering); this task only defines the vocabulary.
  {
    id: "run-running",
    channel: "agent",
    glyph: "Loader",
    label: "Running",
    meaning: "This run is a live process right now.",
  },
  {
    id: "run-blocked",
    channel: "agent",
    glyph: "ShieldAlert",
    label: "Blocked",
    meaning: "This run is waiting on a permission answer from the user.",
  },
  {
    id: "run-completed",
    channel: "agent",
    glyph: "CircleCheckBig",
    label: "Completed",
    meaning: "This run ended on its own.",
  },
  {
    id: "run-failed",
    channel: "agent",
    glyph: "CircleX",
    label: "Failed",
    meaning: "This run ended in an error.",
  },
  {
    id: "run-interrupted",
    channel: "agent",
    glyph: "CircleSlash",
    label: "Interrupted",
    meaning:
      "This run was stopped by the user — a normal, deliberate outcome, not an error (D-35).",
  },
  {
    id: "blocked-indicator",
    channel: "agent",
    glyph: "ShieldAlert",
    label: "Blocked",
    meaning:
      "An orthogonal signal layered on the row's existing five-state status glyph — a blocked task is still visibly at its real workflow status, not a sixth state.",
  },
  {
    id: "worktree-missing",
    channel: "agent",
    glyph: "TriangleAlert",
    label: "Missing",
    meaning: "The worktree Flywheel recorded for this task is not on disk (D-45).",
  },
  {
    id: "run-abandoned",
    channel: "agent",
    glyph: "Unplug",
    label: "Abandoned",
    meaning: "Flywheel was not running to supervise this session; it did not reach a clean end (D-49).",
  },
  {
    id: "recovery-needed",
    channel: "agent",
    glyph: "TriangleAlert",
    label: "Needs Decision",
    meaning:
      "A previous session left something on this task for you to decide (D-46). Deliberately the same glyph as worktree-missing above — this row pill is a rollup of that same underlying fact, not a copy-paste slip, mirroring run-blocked/blocked-indicator's own shared-glyph precedent.",
  },
  {
    id: "destructive-gate",
    channel: "agent",
    glyph: "OctagonAlert",
    label: "Destructive",
    meaning:
      "This tool call would destroy work; it needs an explicit answer and cannot be granted standing permission (D-56, D-57). A stop-sign shape, categorically different from the ShieldAlert shield used everywhere else in this product's permission vocabulary — the shape itself is part of the signal.",
  },
  // D-88 (plan 05-03): the three-stage authoring machine's own marks, plus the tray's
  // proposal-pending mark. A proposal waiting on a decision burns no money (D-46: only money
  // burning blocks), so it deliberately does NOT reuse the `blocked-indicator`/`run-blocked` glyph
  // or the blocked colour role — it is a distinct signal, not a blocked one.
  {
    id: "authoring-stage-challenge",
    channel: "agent",
    glyph: "MessageCircleQuestion",
    label: "Challenge",
    meaning: "The agent is challenging the framing — it has no tool to stage a proposal yet (D-88).",
  },
  {
    id: "authoring-stage-decompose",
    channel: "agent",
    glyph: "ListTree",
    label: "Decompose",
    meaning: "The agent may draft tasks for this epic.",
  },
  {
    id: "authoring-stage-criteria",
    channel: "agent",
    glyph: "ListChecks",
    label: "Criteria",
    meaning: "The agent may draft acceptance criteria for each task.",
  },
  {
    id: "proposal-pending",
    channel: "agent",
    glyph: "FileClock",
    label: "Pending proposal",
    meaning:
      "A staged proposal awaiting your accept/reject/amend decision — not a blocked state (D-46: only money burning blocks).",
  },
];

/**
 * `MARKS` indexed by id — the lookup `BoardRow.tsx` uses to resolve a status/priority value to
 * its mark, so the row's glyph/label always comes from this one registry rather than a second,
 * hand-maintained mapping ("no mark may exist that the legend does not define").
 */
export const MARKS_BY_ID: Record<string, Mark> = Object.fromEntries(
  MARKS.map((mark) => [mark.id, mark]),
);

/** `tasks.status` value -> the matching status Mark's id (see migration `0002_board_schema.sql`). */
export function statusMarkId(status: string): string {
  return `strip-${status.replace(/_/g, "-")}`;
}

/**
 * `tasks.priority` (0-4, keyed exactly as the keyboard map) -> the matching priority Mark's id.
 * `0` ("No priority") sorts LAST in every board query (Open Decisions #6) — this lookup is only
 * the keymap/label mapping, never the sort position.
 */
const PRIORITY_MARK_IDS = [
  "priority-no-priority",
  "priority-urgent",
  "priority-high",
  "priority-medium",
  "priority-low",
] as const;

export function priorityMarkId(priority: number): string {
  return PRIORITY_MARK_IDS[priority] ?? PRIORITY_MARK_IDS[0];
}

/**
 * The five status Marks, in the fixed declaration order above — the ONE place the renderer reads
 * a status option list from. `StatusPicker.tsx` builds its option list from this, never from a
 * second, hand-typed array of state names, so a sixth option cannot be added in the renderer
 * alone (BOARD-04).
 */
export const STATUS_MARKS: Mark[] = MARKS.filter((mark) => mark.channel === "status");

/** A status Mark's id (`strip-in-progress`) -> the schema's `tasks.status`/`epics.status` value
 * (`in_progress`) — the exact inverse of `statusMarkId`, derived by string transform rather than
 * a second literal list of state names. */
export function statusValueFromMarkId(markId: string): string {
  return markId.replace(/^strip-/, "").replace(/-/g, "_");
}

/**
 * The five priority Marks, in `PRIORITY_MARK_IDS`' fixed declaration order (index === the
 * schema's `priority` value, 0-4) — `PriorityPicker.tsx` builds its option list from this, never
 * from a second, hand-typed array (mirrors `STATUS_MARKS`'s role for `StatusPicker.tsx`).
 */
export const PRIORITY_MARKS: Mark[] = PRIORITY_MARK_IDS.map((id) => MARKS_BY_ID[id]);

/** A priority Mark's id -> the schema's `priority` value (0-4) — the exact inverse of
 * `priorityMarkId`. */
export function priorityValueFromMarkId(markId: string): number {
  const index = PRIORITY_MARK_IDS.indexOf(markId as (typeof PRIORITY_MARK_IDS)[number]);
  return index === -1 ? 0 : index;
}

/**
 * D-12: S/M/L stored as a nullable ordinal 1-3. `null` (no estimate set) has no mark — the badge
 * is simply not rendered for that item, never a placeholder.
 */
const ESTIMATE_MARK_IDS = ["estimate-small", "estimate-medium", "estimate-large"] as const;

export function estimateMarkId(estimate: number | null | undefined): string | undefined {
  if (estimate == null) return undefined;
  return ESTIMATE_MARK_IDS[estimate - 1];
}

/** The rendered letter for an estimate value (D-12: the letters are the badge — never the
 * numeric ordinal, which would invite the aggregate reading D-12 explicitly forbids). */
const ESTIMATE_LETTERS = ["S", "M", "L"] as const;

export function estimateLetter(estimate: number | null | undefined): string | undefined {
  if (estimate == null) return undefined;
  return ESTIMATE_LETTERS[estimate - 1];
}

/** The three estimate Marks, in `ESTIMATE_MARK_IDS`' fixed declaration order (index + 1 === the
 * schema's `estimate` value, 1-3) — `EstimatePicker.tsx` builds its option list from this. */
export const ESTIMATE_MARKS: Mark[] = ESTIMATE_MARK_IDS.map((id) => MARKS_BY_ID[id]);

/** `actors.type` (`human`/`agent`/`system`) -> the matching actor-badge Mark's id — the one
 * lookup both the assignee picker and the activity trail (`ActivityTrail.tsx`, BOARD-09) use to
 * render human/agent/system as three visually distinct badges, never colour alone. Any other
 * string (a future actor type, or a malformed row) falls back to the `human` badge as a
 * defensive default, not an expected path. */
export function actorTypeMarkId(actorType: string): string {
  if (actorType === "agent") return "assignee-agent";
  if (actorType === "system") return "assignee-system";
  return "assignee-human";
}
