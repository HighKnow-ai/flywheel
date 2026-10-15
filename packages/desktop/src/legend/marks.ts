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
  /**
   * How the product actually draws the mark when that is more than the bare glyph: the legend's swatch
   * must be the mark as it renders on the row, or it teaches the wrong thing. `glyph: false` means the
   * row draws the text alone (the criteria fraction); `boxed` draws it in a 1px control-edged box.
   */
  sample?: { text: string; glyph: boolean; boxed?: boolean };
}

export const MARKS: Mark[] = [
  {
    id: "row-surface",
    channel: "row-state",
    glyph: "Square",
    label: "Idle row",
    meaning: "A row at rest: no hover, no selection.",
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
    meaning:
      "This row is selected and the list holds keyboard focus: a 2px ink rule on its leading edge and the faintest surface shift. The rule is what you see; the shift is 1.07 to 1 against the ground.",
  },
  {
    id: "row-surface-selected-unfocused",
    channel: "row-state",
    glyph: "SquareMinus",
    label: "Selected, unfocused row",
    meaning:
      "This row is selected but keyboard focus has moved elsewhere (e.g. the detail panel). A task row keeps only a lighter 2px rule on the idle surface; an epic row, which has no rule, keeps a fainter surface shift.",
  },
  {
    id: "focus-ring",
    channel: "focus",
    glyph: "Focus",
    label: "Focus ring",
    meaning:
      "The element currently reachable by keyboard Tab order: a 2px ring in the brand colour. A text field that takes focus the moment it opens (the palette's search, a launch-sheet or amend field) wears the ink rule instead, so the brand is never a standing box around an input.",
  },
  // Status glyphs (01-UI-SPEC.md "Row Anatomy"). Shape and the printed word carry the meaning and
  // nothing else does: D-11 removed the paper tints, so colour is not even a redundant channel.
  {
    id: "status-backlog",
    channel: "status",
    glyph: "CircleDashed",
    label: "Backlog",
    meaning: "Not yet started: a dashed, empty circle.",
  },
  {
    id: "status-todo",
    channel: "status",
    glyph: "Circle",
    label: "Todo",
    meaning: "Queued to start: an empty circle.",
  },
  {
    id: "status-in-progress",
    channel: "status",
    glyph: "CircleDot",
    label: "In Progress",
    meaning: "Actively being worked: a circle with a dot at its centre.",
  },
  {
    id: "status-in-review",
    channel: "status",
    glyph: "CircleEllipsis",
    label: "In Review",
    meaning: "Awaiting review: a circle with an ellipsis.",
  },
  {
    id: "status-done",
    channel: "status",
    glyph: "CircleCheckBig",
    label: "Done",
    meaning: "Complete: a circle with a check mark.",
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
    meaning: "Unprioritised: keyed 0, but sorts last within its status band, not first.",
  },
  {
    id: "priority-urgent",
    channel: "priority",
    glyph: "Signal",
    label: "Urgent",
    meaning: "Highest priority: keyed 1, all bars filled.",
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
    meaning: "Lowest declared priority: keyed 4, one bar filled.",
  },
  // The orphan-task pill (D-13, 01-UI-SPEC.md "Board list") — a task with no epic shows this
  // muted pill in the epic field slot, never a blank.
  {
    id: "epic-pill-none",
    channel: "epic",
    glyph: "CircleSlash",
    label: "No epic",
    meaning: "This task has no parent epic yet: it may exist before its epic is known.",
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
      "This item names an epic Flywheel could not resolve from the project's roster: the internal id is never shown in its place.",
  },
  // The epic roster's two graphic marks (08.1 A-01, D-06). Neither is an icon on the roster itself, which
  // draws a bar; the glyph is the legend's stand-in for it.
  {
    id: "epic-progress",
    channel: "epic",
    glyph: "ChartNoAxesGantt",
    label: "Epic progress",
    meaning:
      "The bar and fraction on an epic row: tasks done over total, in the brand colour. An epic whose tasks carry no criteria prints \"no criteria yet\" instead of a percentage that would lie.",
  },
  {
    id: "epic-distribution",
    channel: "epic",
    glyph: "ChartBarStacked",
    label: "Task distribution",
    meaning:
      "The thin strip beside an epic's progress: its tasks split by status, one segment per status that has any, widest where there are most. The counts are printed under it.",
  },
  // Phase 9 plan 09-09: the running fan-out's position, on the epic row.
  {
    id: "epic-dispatch-wave",
    channel: "epic",
    glyph: "Layers",
    label: "Fan-out wave",
    meaning:
      "This epic has a plan running. The wave is the group of tasks being started now; the next wave starts when every task in this one is merged. Tasks in a wave start together only where their declared files do not overlap. A count of stuck tasks beside it names tasks that are holding the wave until you act.",
    sample: { text: "2/3", glyph: true },
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
      "How many of this item's acceptance criteria are checked, out of its total. Visible wherever the item appears; an item with none shows 0/0.",
    // The row prints the fraction alone.
    sample: { text: "2/5", glyph: false },
  },
  // Review marks (Phase 8, D-139/D-140/D-141). The first three annotate a CHECKED criterion's
  // evidence; the fourth is rendered by plan 08-07 (the legend rule runs one way — an entry ahead
  // of its renderer is correct, and it keeps this file owned by one plan).
  {
    id: "criterion-no-evidence",
    channel: "criteria",
    // Not CircleSlash: "No epic" wears that on the same task row, and "No evidence" is a link to code that is absent.
    glyph: "Unlink",
    label: "No evidence",
    meaning: "This criterion was checked without pointing at any code.",
  },
  {
    id: "criterion-anchor-fresh",
    channel: "criteria",
    glyph: "Anchor",
    label: "Evidence current",
    meaning: "The code this criterion was verified against has not changed since.",
  },
  {
    id: "criterion-anchor-stale",
    channel: "criteria",
    glyph: "History",
    label: "Evidence changed",
    meaning:
      "The code this criterion was verified against has changed since: the check still stands, but it was made against older code.",
  },
  {
    id: "integrated",
    channel: "criteria",
    glyph: "GitMerge",
    label: "Integrated",
    meaning: "This task's branch has been merged into its epic's integration branch.",
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
  // legend does not define"): the real glyph is the printed text, this entry documents the channel.
  {
    id: "project-entry",
    channel: "project",
    glyph: "FolderGit2",
    label: "Project",
    meaning: "One registered repository's board: the rail shows its key prefix as the real glyph.",
  },
  {
    id: "project-current",
    channel: "project",
    glyph: "PanelLeft",
    label: "Current project",
    meaning:
      "The project whose board is open. Its rail entry lifts to the page ground: the current position is a neutral surface shift, with no colour on it.",
  },
  {
    id: "project-unreachable",
    channel: "project",
    glyph: "TriangleAlert",
    label: "Unreachable",
    meaning:
      "This project's marker no longer matches its last known path: paired with the literal word \"Unreachable,\" never a colour change alone.",
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
      "This run was stopped by the user: a normal, deliberate outcome, not an error.",
  },
  // One mark for both places it is drawn: the run's status word and the task row's pill. They are the same
  // fact (an agent is waiting on a permission answer), so the legend carries one entry with both contexts,
  // not two rows titled "Blocked" that cannot be told apart.
  {
    id: "blocked-indicator",
    channel: "agent",
    glyph: "ShieldAlert",
    label: "Blocked",
    meaning:
      "An agent is waiting on a permission answer from you. On a run it is the run's status; on a task row it is a pill layered over the task's workflow status, which stays visible: a blocked task is still at its real status, not a sixth state.",
  },
  {
    id: "worktree-missing",
    channel: "agent",
    glyph: "TriangleAlert",
    label: "Missing",
    meaning: "The worktree Flywheel recorded for this task is not on disk.",
  },
  {
    id: "worktree-reclaimable",
    channel: "agent",
    glyph: "Recycle",
    label: "Reclaimable",
    meaning:
      "The task is done or its branch is integrated, no agent is running in it and nothing in it is uncommitted, so its disk space can be freed. The row names which.",
  },
  {
    id: "worktree-in-use",
    channel: "agent",
    glyph: "Activity",
    label: "In use",
    meaning: "An agent is running in this worktree, or is blocked waiting on you in it. It is never offered for reclaim.",
  },
  {
    id: "worktree-keep",
    channel: "agent",
    glyph: "Lock",
    label: "Keep",
    meaning:
      "Not offered for reclaim, for the reason the row states: the task is still open, the tree has uncommitted changes, the directory is missing or the project cannot be reached.",
  },
  {
    id: "run-abandoned",
    channel: "agent",
    glyph: "Unplug",
    label: "Abandoned",
    meaning: "Flywheel was not running to supervise this session; it did not reach a clean end.",
  },
  {
    id: "recovery-needed",
    channel: "agent",
    glyph: "TriangleAlert",
    label: "Needs Decision",
    meaning:
      "A previous session left something on this task for you to decide.",
  },
  {
    id: "ci-failed",
    channel: "agent",
    glyph: "CircleX",
    label: "CI failed",
    meaning:
      "A red build on this task's branch: visible on the row so a backlog being drained by agents doesn't need every task opened to spot one. It never changes the task's status.",
  },
  // Phase 8.1 plan 01 (D-15): the board row's graded change annotation — how much real work sits
  // behind a task's worktree. Deliberately NOT alert-shaped: neither is a fifth pill beside
  // Blocked / Needs Decision / CI failed, and neither uses an alert colour. Outline icons from the
  // locked icon library, per this registry's rule. Glyphs settled by amendment A-05 (08.1-09,
  // 2026-10-08): `Triangle` + count and `Dot` — outline-only rule upheld, filled glyphs declined.
  // `Circle` was the Todo status glyph in the same row; `Dot` is not used by any status mark.
  {
    id: "change-ahead",
    channel: "agent",
    glyph: "Triangle",
    label: "Commits ahead",
    meaning:
      "This task's branch has commits its epic's integration branch does not: real work waiting to be reviewed. The number is the count; a task with no worktree, or one level with its base, shows nothing.",
    // The row draws the triangle and the count together.
    sample: { text: "3", glyph: true },
  },
  {
    id: "change-dirty",
    channel: "agent",
    glyph: "Dot",
    label: "Uncommitted changes",
    meaning:
      "This task's worktree has changes that are not committed yet. Shown only when there are some: absence means a clean tree or no worktree.",
  },
  // D-153 (phase 09): how many times the scope hook refused this task's agent a write outside its
  // declared file-set. A count, graded like the change cues: absent for a task with none.
  {
    id: "scope-denied",
    channel: "agent",
    glyph: "ShieldBan",
    label: "Scope refusals",
    meaning:
      "How many times the scope hook refused this task's agent a write outside its declared files. The number is the count; a task with no refusals shows nothing. A high count means the declared files and the work disagree: widen the set from the session, or fix the plan.",
    sample: { text: "3", glyph: true },
  },
  {
    id: "destructive-gate",
    channel: "agent",
    glyph: "OctagonAlert",
    label: "Destructive",
    meaning:
      "This tool call would destroy work; it needs an explicit answer and cannot be granted standing permission. A stop-sign shape, categorically different from the shield used everywhere else in this product's permission vocabulary: the shape itself is part of the signal.",
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
    meaning: "The agent is challenging the framing: it has no tool to stage a proposal yet.",
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
      "A staged proposal awaiting your accept/reject/amend decision. It is not a blocked state: only a run that is spending money blocks.",
  },
  // Phase 14 plan 04 (D-19). The state vocabulary names two states the registry did not yet define. Awaiting
  // review REPLACES the old reuse of the status channel's In Review mark (D-170): the state now has a mark in
  // its own right, so the agent channel can say it without borrowing a task-status shape. Merged shares the
  // GitMerge glyph with the criteria channel's Integrated on purpose: it is the same fact, a branch folded
  // into its target, and two glyphs for one fact would be the undocumented variation the registry forbids.
  {
    id: "run-awaiting-review",
    channel: "agent",
    glyph: "Eye",
    label: "Awaiting review",
    meaning: "The agent finished and its task is not yet Done: the diff is waiting for you to read it.",
  },
  {
    id: "run-merged",
    channel: "agent",
    glyph: "GitMerge",
    label: "Merged",
    meaning: "This work's branch has been merged into its target. Nothing is left to do with it.",
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
  return `status-${status.replace(/_/g, "-")}`;
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
 * a status list from (the board's band headers and the legend). It is never re-typed as a second
 array of state names, so a sixth state cannot be added in the renderer alone (BOARD-04).
 */
export const STATUS_MARKS: Mark[] = MARKS.filter((mark) => mark.channel === "status");

/** A status Mark's id (`status-in-progress`) -> the schema's `tasks.status`/`epics.status` value
 * (`in_progress`) — the exact inverse of `statusMarkId`, derived by string transform rather than
 * a second literal list of state names. */
export function statusValueFromMarkId(markId: string): string {
  return markId.replace(/^status-/, "").replace(/-/g, "_");
}

/**
 * The five priority Marks, in `PRIORITY_MARK_IDS`' fixed declaration order (index === the
 * schema's `priority` value, 0-4) — `PriorityPicker.tsx` builds its option list from this, never
 * from a second, hand-typed array (mirrors `STATUS_MARKS`'s role for the band headers).
 */
export const PRIORITY_MARKS: Mark[] = PRIORITY_MARK_IDS.map((id) => MARKS_BY_ID[id]);

/** A priority Mark's id -> the schema's `priority` value (0-4) — the exact inverse of
 * `priorityMarkId`. */
export function priorityValueFromMarkId(markId: string): number {
  const index = PRIORITY_MARK_IDS.indexOf(markId as (typeof PRIORITY_MARK_IDS)[number]);
  return index === -1 ? 0 : index;
}

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
