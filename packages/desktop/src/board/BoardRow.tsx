/**
 * One strip (01-UI-SPEC.md "Row Anatomy"): fixed-height, single-line, truncate-not-wrap, fields
 * in fixed left-to-right order (status glyph → key → title → epic pill →
 * assignee avatar → criteria checked/total → priority glyph → actor-of-last-change). The status
 * glyph, key and title are never dropped at any supported window width (≥900px); the priority
 * glyph and the criteria count are never dropped by width either, but print nothing when they hold
 * no value (D-198.1, below) — the `.field-epic-pill`/`.field-assignee`
 * container-query rules in `App.css` implement the progressive-disclosure ladder (epic pill and
 * assignee avatar drop) as the row's own inline size narrows;
 * `.board-row`'s `container-type: inline-size` is what makes those rules respond to the row
 * itself rather than the viewport. An epic renders as an ordinary strip in its own band
 * (01-UI-SPEC.md "Board list"); a task with no epic shows the muted "No epic" pill
 * (`legend/marks.ts`'s `epic-pill-none` mark) in the epic field slot, never a blank (D-13). The
 * criteria checked/total count (BOARD-02, D-08) is structurally exempt from the ladder. D-198.1
 * amends 01-UI-SPEC § Row Anatomy: a zero criteria total (`0/0`) and "No priority" render NOTHING
 * in the tail, extending A-03's change-cue rule (absent is not a value). The count is then absent
 * exactly when the Done warning cannot fire, which is consistent with D-08 (issues never reach
 * `BoardRow` — they render in `IssuesLane.tsx`'s separate lane).
 *
 * The actor-of-last-change field (avatar + relative time) is not yet
 * implemented — no activity trail exists until a later plan — and is simply not rendered, not
 * rendered as an empty placeholder, matching the precedent 01-03/01-04 documented for the same
 * reason; see this plan's SUMMARY "Known Stubs" section.
 *
 * This row owns NO key handling of its own (01-09-PLAN.md, `state/keyboard.ts`'s doc comment):
 * `state/keyboard.ts` is the only module that maps a key to a board action, and `BoardView.tsx`'s
 * container-level handler is the only place that mapping is applied — a second, row-local
 * `onKeyDown` switching on the same letters would be exactly the "two key-handling systems
 * fighting each other" failure mode this plan exists to remove (it also used to double-fire,
 * since a bare `handleRowKeyDown` on the focused row does not stop the identical case in the
 * container's own handler from also running on the same bubbled event).
 *
 * `setSize`/`posInSet` back `aria-setsize`/`aria-posinset` (01-UI-SPEC.md "Accessibility"): the
 * band's true total (from the core's filter-aware per-band counts, 01-08) and this row's true
 * 1-indexed position within that band's currently loaded window — not the virtualizer's mounted
 * window — so a screen reader announces total/position correctly even though only a few rows
 * exist in the DOM at any moment.
 *
 * Plan 02-06 Task 3 adds the blocked indicator pill (D-37, AGNT-06): a new field inserted
 * immediately after the status glyph, layered ONTO it rather than replacing it — blocked is an
 * orthogonal signal, not a sixth workflow state (BOARD-04's five states stay locked). It carries no
 * `field-*` class, which is the SAME structural mechanism (`App.css`'s container-query rules only
 * ever target `field-*` classes) that already makes the criteria checked/total badge exempt from
 * the row's progressive-disclosure ladder — a blocked task must never silently lose its blocked
 * signal at a narrower window width (D-08's reasoning, applied here).
 *
 * Plan 03-11 Task 2 adds a second such pill, "Needs Decision" (D-46): trailing the Blocked pill
 * when both are present, or trailing the status glyph alone otherwise. It carries the SAME no-
 * `field-*`-class truncation exemption as the Blocked pill above — TWO pills are now structurally
 * exempt from the row's progressive-disclosure ladder, not one, per 03-UI-SPEC.md's own rule that
 * when a long title and both pills compete for row width, both pills hold their space and the
 * title truncates instead.
 *
 * Plan 05-08 Task 3 adds a third signal, the pending-proposal count (D-82's count, "free from
 * D-37's board-visible-state-plus-rail-count precedent") — but it is deliberately NOT a third pill
 * beside Blocked/Needs Decision: a proposal waiting on a decision burns no money (D-46: only money
 * burning blocks), so it must never be mistaken for one at a glance. It renders ONLY on an epic's
 * own row (`isEpic`), in the `field-epic-pill` slot that field is never used for on an epic row
 * (the epic-pill field renders nothing for an epic — an epic has no epic of its own), which is
 * what keeps it from ever occupying the same row real estate as the two corner pills near the
 * status glyph. It reuses `--accent-text-strip` — the strip-stock sibling of `--accent-text-rack`,
 * already the "agent, non-blocking" informational role everywhere else in this product (the
 * authoring-stage indicator, the proposal tray's own target-type label) — never the blocked role
 * two pills above already carry, and no new token was added.
 *
 * Phase 7 plan 07-08 Task 2 adds a fourth signal, the CI-failure pill (D-124): trailing the
 * Blocked/Needs Decision pair when present, or trailing the status glyph alone otherwise — built
 * exactly like those two, the SAME no-`field-*`-class truncation exemption, and `BoardView`'s own
 * `useForgeFlags(projectId)` read, never a per-row query of its own (mirrors `blocked`/
 * `needsDecision` above). D-124/D-122 are explicit: a red build raises this pill and changes
 * nothing about the row's status display — this file contains no status-writing call of any kind.
 */
import type { CSSProperties, ComponentType, MouseEvent } from "react";
import * as icons from "lucide-react";
import {
  actorTypeMarkId,
  MARKS_BY_ID,
  priorityMarkId,
  statusMarkId,
} from "../legend/marks";
import type { Actor, BoardItem, EpicSummary } from "./useBoardQuery";

/** The four row kinds the rack renders (08.1 amendment A-03). */
export type RowKind = "epic-header" | "challenge" | "task" | "band-header";

/**
 * Row height by row kind (A-03, D-13) — the rack's one source of row heights. The virtualizer's
 * size function is a lookup into this table and nothing else: no per-row measurement, so the
 * Performance Contract's fixed-size clause survives the nested model. Tests import this table
 * rather than re-declaring a height.
 */
export const ROW_HEIGHT_BY_KIND: Record<RowKind, number> = {
  "epic-header": 64,
  challenge: 48,
  task: 32,
  "band-header": 28,
};

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

export interface BoardRowProps {
  item: BoardItem;
  selected?: boolean;
  focused?: boolean;
  /** Assignee id -> actor, so this row never issues its own read of the actor roster (D-04's
   * "the renderer never trusts its own write" discipline extends to "never fetches its own
   * dependency data mid-render" here — `BoardView` owns the one `useActors()` call). */
  actorsById?: Record<string, Actor>;
  /** Epic id -> epic summary, the project's full roster supplied by `BoardView`'s `useEpics()`
   * call (BOARD-06, G-01-2) — never a window derivation. Lets the epic pill render a
   * human-readable `key title` instead of the raw internal `epic_id` ULID, for any epic in the
   * project regardless of whether it sorts inside the currently loaded board window. */
  epicsById?: Record<string, EpicSummary>;
  /** This item's true 1-indexed position within its status band's currently loaded window —
   * `aria-posinset`'s source (see the module doc comment). */
  posInSet?: number;
  /** The band's true total item count (from the core's per-band counts) — `aria-setsize`'s
   * source. */
  setSize?: number;
  /** True when this item's most recent agent run is blocked (D-37, plan 02-06 Task 3) —
   * `BoardView`'s `useBlockedSummary(projectId)` read, never a per-row query of its own. Renders
   * the blocked pill layered onto the status glyph; absent (not a visible zero) when `false`. */
  blocked?: boolean;
  /** True when this task has an outstanding recovery item — a missing worktree, or an
   * unacknowledged abandoned run (D-46, plan 03-11) — `BoardView`'s `useRecoverySummary(projectId)`
   * read, never a per-row query of its own. Renders the Needs Decision pill trailing the Blocked
   * pill (or the status glyph alone); absent (not a visible zero) when `false`. */
  needsDecision?: boolean;
  /** True when this task's most recent CI-bearing forge observation recorded a failure (D-124,
   * phase 07 plan 07-08) — `BoardView`'s `useForgeFlags(projectId)` read, never a per-row query of
   * its own (mirrors `blocked`/`needsDecision` above). Renders a CI-failure pill trailing the
   * Blocked/Needs Decision pair (or the status glyph alone); absent (not a visible zero) when
   * `false`. Never changes the status column — D-122's forward-only rule owns that. */
  ciFailed?: boolean;
  /** This task's change state (Phase 8.1 plan 01, D-15) — `BoardView`'s `useChangeFlags(projectId)`
   * read, one id-keyed map for the whole board, never a per-row query of its own. `ahead` is
   * commits beyond the task's base (`null` = the base could not be resolved, which is NOT the same
   * as `0`); `dirty` is uncommitted changes in its worktree. Renders a graded annotation beside the
   * status glyph — a count and/or a mark, each with an accessible name — and nothing at all when the
   * prop is absent (no worktree), `ahead` is `0` or `null`, and the tree is clean. */
  changeFlag?: { ahead: number | null; dirty: boolean };
  /** How many times the scope hook refused this task's agent a write outside its declared set (D-153,
   * phase 09) — `BoardView`'s `useScopeFlags(projectId)` read, one id-keyed map for the whole board,
   * never a per-row query of its own. Absent from the map for a task with no refusals, and then
   * nothing renders: no badge, no placeholder, no zero. */
  scopeDenied?: number;
  /** How many pending authoring proposals target this epic (D-82, plan 05-08 Task 3) — computed
   * client-side by `BoardView` from the same project-scoped proposal window `TriageLane.tsx`
   * reads, never a per-row query of its own (mirrors `blocked`/`needsDecision` above). Ignored for
   * a task row: only an epic's own row carries this count (a proposed task with no epic yet has no
   * row to carry it — that is D-82's own reason the triage lane exists). Absent (not a visible
   * zero) when `0`/`undefined`. */
  pendingProposalCount?: number;
  /** Drops the epic pill. In the epic lens the row sits under its epic's header, which already says
   * which epic it is, so the pill would repeat that on every line (08.1-14 finish pass). The status
   * lens keeps it: there a row's epic is real information. */
  hideEpicPill?: boolean;
  onSelect?: () => void;
  onOpenDetail?: () => void;
  onOpenPriorityPicker?: () => void;
  onOpenAssigneePicker?: () => void;
  /** Activating the blocked pill — opens the item detail panel (which renders the
   * permission-request card automatically whenever a pending request exists, plan 02-06 Task 2),
   * the fastest path from "I see something needs me" to "I answered it." */
  onOpenBlocked?: () => void;
  /** Activating the Needs Decision pill — opens the item detail panel for this task (D-46, plan
   * 03-11). 03-UI-SPEC.md asks for the panel to scroll to whichever section holds the actionable
   * content (worktree summary first, runs section otherwise); the panel exposes no target-section
   * mechanism yet, so this opens the panel plainly — see this plan's SUMMARY.md for the named gap. */
  onOpenRecovery?: () => void;
  /** Activating the CI-failure pill — opens the item detail panel for this task (D-124, phase 07
   * plan 07-08), the same destination the Blocked/Needs Decision pills already use. */
  onOpenCiFailed?: () => void;
}

export function BoardRow({
  item,
  selected = false,
  focused = false,
  actorsById,
  epicsById,
  posInSet,
  setSize,
  blocked = false,
  needsDecision = false,
  ciFailed = false,
  changeFlag,
  scopeDenied = 0,
  pendingProposalCount = 0,
  hideEpicPill = false,
  onSelect,
  onOpenDetail,
  onOpenPriorityPicker,
  onOpenAssigneePicker,
  onOpenBlocked,
  onOpenRecovery,
  onOpenCiFailed,
}: BoardRowProps) {
  const statusMark = MARKS_BY_ID[statusMarkId(item.status)];
  const blockedMark = MARKS_BY_ID["blocked-indicator"];
  const recoveryMark = MARKS_BY_ID["recovery-needed"];
  const ciFailedMark = MARKS_BY_ID["ci-failed"];
  const changeAheadMark = MARKS_BY_ID["change-ahead"];
  const changeDirtyMark = MARKS_BY_ID["change-dirty"];
  const scopeDeniedMark = MARKS_BY_ID["scope-denied"];
  const priorityMark = MARKS_BY_ID[priorityMarkId(item.priority)];
  const epicMark = MARKS_BY_ID["epic-pill-none"];
  // Defence in depth (G-01-2, T-01-17-02): once `epicsById` is the project's full roster
  // (`BoardView`'s `useEpics()`), this mark is reachable only while that roster query is pending
  // or has failed — it exists so a future regression in the roster's source degrades to a
  // readable word rather than back to an internal identifier.
  const epicUnresolvedMark = MARKS_BY_ID["epic-pill-unresolved"];
  const criteriaBadgeMark = MARKS_BY_ID["criteria-count-badge"];
  const proposalPendingMark = MARKS_BY_ID["proposal-pending"];
  const assignee = item.assigneeId ? actorsById?.[item.assigneeId] : undefined;
  const epic = item.epicId ? epicsById?.[item.epicId] : undefined;
  // Exactly three outcomes, never a fourth: no epic id -> "No epic"; an epic id that resolves in
  // the roster -> its key/title; an epic id that does not resolve -> "Unknown epic". No branch
  // here can put the row's own epic id into the pill's text (G-01-2's reported defect).
  const epicLabel = !item.epicId
    ? (epicMark?.label ?? "No epic")
    : epic
      ? `${epic.key} ${epic.title}`
      : (epicUnresolvedMark?.label ?? "Unknown epic");
  const assigneeBadgeMark = MARKS_BY_ID[
    assignee ? actorTypeMarkId(assignee.actorType) : "assignee-unassigned"
  ];
  const statusLabel = statusMark?.label ?? item.status;
  const priorityLabel = priorityMark?.label ?? "No priority";
  const hasPriority = priorityMarkId(item.priority) !== priorityMarkId(0);
  const isEpic = item.kind === "epic";
  const criteriaChecked = item.criteriaChecked ?? 0;
  const criteriaTotal = item.criteriaTotal ?? 0;
  // D-15: graded, so a count appears only when there is something to count — `null` (cannot
  // measure) and `0` (level) both read as "nothing to show", never as a printed zero.
  const aheadCount = changeFlag?.ahead ?? 0;
  const aheadLabel = aheadCount === 1 ? "1 commit ahead" : `${aheadCount} commits ahead`;
  const isDirty = changeFlag?.dirty ?? false;
  const scopeLabel = scopeDenied === 1 ? "1 scope refusal" : `${scopeDenied} scope refusals`;

  // 01-UI-SPEC.md Accessibility: each row's accessible name concatenates key, title, status,
  // priority and the criteria checked/total count — virtualization must not silently break
  // linear screen-reader navigation. "Blocked" appends when set (D-37) — never colour alone.
  // "Needs Decision" appends after it when set (D-46) — same discipline, never colour alone.
  const accessibleName = `${item.key}, ${item.title}, ${statusLabel}${blocked ? ", Blocked" : ""}${needsDecision ? ", Needs Decision" : ""}${ciFailed ? ", CI failed" : ""}, priority ${priorityLabel}, ${criteriaChecked} of ${criteriaTotal} criteria checked${aheadCount > 0 ? `, ${aheadLabel}` : ""}${isDirty ? ", uncommitted changes" : ""}${scopeDenied > 0 ? `, ${scopeLabel}` : ""}`;

  function handleRowClick() {
    onSelect?.();
  }

  function handleBlockedPillClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenBlocked?.();
  }

  function handleRecoveryPillClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenRecovery?.();
  }

  function handleCiFailedPillClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenCiFailed?.();
  }

  function handlePriorityGlyphClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenPriorityPicker?.();
  }

  function handleAssigneeAvatarClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenAssigneePicker?.();
  }

  // A-06: selection is a surface shift PLUS a 2px left rule. Full ink and the surface shift while the
  // list has focus; once it has lost it, the lighter control tone on the IDLE surface, so focus reads
  // as band-present against band-absent as well as ink against grey (08.1-14 finish review: the two
  // selected surfaces were 1.01 apart and only a 2px tick told them apart). The shift cannot be made
  // stronger than ~1.08 without lowering a text role under AA (tokens.css), so the unfocused state
  // gives it up entirely rather than keep a second near-identical one. Idle and hover reserve the
  // same 2px transparent so a row changing state never reflows its content. One branch, extended
  // (not a second): `selectionOverlay` and `selectionRule` move together.
  const selectionOverlay = focused ? "var(--row-surface-selected)" : "var(--row-surface)";
  const selectionRule = focused
    ? "var(--selection-rule)"
    : selected
      ? "var(--selection-rule-unfocused)"
      : "transparent";

  const rowStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    height: "100%",
    padding: `0 var(--space-md)`,
    // One surface family (D-11): the per-status paper tints are gone, so the row's only background
    // is the selection overlay over the rack's own ground. Rows are square (no radius).
    background: selectionOverlay,
    color: "var(--text-primary-strip)",
    borderBottom: "1px solid var(--divider)",
    borderLeft: `2px solid ${selectionRule}`,
    // The keyboard-focus ring is NOT drawn here. `focused` means "selected, and the list holds DOM
    // focus", which a mouse click also produces, so an inline ring would stay on the row after every
    // click and make the brand the cursor (D-12). App.css draws it on `.board-row:focus-visible`, which
    // the engine matches for keyboard focus only, inset to -4 so it clears the 2px rule above.
  };

  return (
    <div
      className="board-row"
      role="listitem"
      aria-label={accessibleName}
      aria-selected={selected}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      tabIndex={focused ? 0 : -1}
      style={rowStyle}
      onClick={handleRowClick}
      onDoubleClick={onOpenDetail}
    >
      {/* Read-only (DRFT-04, D-19): status is derived from git and forge state, so the glyph is a
          value and offers no control. The row's own accessible name already states the status. */}
      <span
        aria-hidden="true"
        style={{ display: "inline-flex", flexShrink: 0, minWidth: 24, minHeight: 24, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name={statusMark?.glyph ?? "Circle"} />
      </span>
      {blocked && (
        // No `field-*` class — the same structural mechanism that already exempts the criteria
        // count from `App.css`'s container-query truncation ladder (D-08's reasoning, applied
        // here). Layered onto the status glyph above, never replacing it (D-37/BOARD-04).
        <span
          role="button"
          aria-label={`${blockedMark?.label ?? "Blocked"}. Press to view the pending request.`}
          title={blockedMark?.meaning}
          onClick={handleBlockedPillClick}
          className="type-label"
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 2,
            color: "var(--blocked-text-strip)",
            border: "1px solid var(--blocked-text-strip)",
            borderRadius: "var(--radius-chrome)",
            padding: "1px var(--space-xs)",
            cursor: "pointer",
          }}
        >
          <Icon name={blockedMark?.glyph ?? "ShieldAlert"} size={12} />
          {blockedMark?.label ?? "Blocked"}
        </span>
      )}
      {needsDecision && (
        // No `field-*` class (see the module doc comment above) — the same truncation-exemption
        // mechanism the Blocked pill above already uses, extended to a second pill (D-46). Trails
        // the Blocked pill when both are present, or the status glyph alone otherwise.
        <span
          role="button"
          aria-label={`${recoveryMark?.label ?? "Needs Decision"}. Press to view.`}
          title={recoveryMark?.meaning}
          onClick={handleRecoveryPillClick}
          className="type-label"
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 2,
            color: "var(--destructive-strip)",
            border: "1px solid var(--destructive-strip)",
            borderRadius: "var(--radius-chrome)",
            padding: "1px var(--space-xs)",
            cursor: "pointer",
          }}
        >
          <Icon name={recoveryMark?.glyph ?? "TriangleAlert"} size={12} />
          {recoveryMark?.label ?? "Needs Decision"}
        </span>
      )}
      {ciFailed && (
        // No `field-*` class (see the module doc comment above) — the same truncation-exemption
        // mechanism the two pills above already use, extended to a fourth signal (D-124). Trails
        // the Blocked/Needs Decision pair when present, or the status glyph alone otherwise. Never
        // a status-column change — D-122's forward-only rule owns that column (see the module
        // header comment's own structural grep gate).
        <span
          role="button"
          aria-label={`${ciFailedMark?.label ?? "CI failed"}. Press to view.`}
          title={ciFailedMark?.meaning}
          onClick={handleCiFailedPillClick}
          className="type-label"
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 2,
            color: "var(--destructive-strip)",
            border: "1px solid var(--destructive-strip)",
            borderRadius: "var(--radius-chrome)",
            padding: "1px var(--space-xs)",
            cursor: "pointer",
          }}
        >
          <Icon name={ciFailedMark?.glyph ?? "CircleX"} size={12} />
          {ciFailedMark?.label ?? "CI failed"}
        </span>
      )}
      {aheadCount > 0 && (
        // D-15's graded annotation: a mark plus the count, named for a screen reader — never colour
        // alone. No `field-*` class (same truncation exemption as the pills above), and not a
        // `role="button"` pill: it is information, not an alert. The count takes the brand TEXT role
        // (DIRECTION s2: commits-ahead is the one data channel the brand carries besides progress);
        // the glyph and the accessible name stay, so meaning never rests on colour.
        <span
          role="img"
          aria-label={aheadLabel}
          title={changeAheadMark?.meaning}
          className="type-label tabular-nums"
          style={{ display: "inline-flex", flexShrink: 0, alignItems: "center", gap: 2, color: "var(--accent-text-rack)" }}
        >
          <Icon name={changeAheadMark?.glyph ?? "Triangle"} size={12} />
          {aheadCount}
        </span>
      )}
      {isDirty && (
        <span
          role="img"
          aria-label="uncommitted changes"
          title={changeDirtyMark?.meaning}
          style={{ display: "inline-flex", flexShrink: 0, alignItems: "center", color: "var(--text-muted-strip)" }}
        >
          <Icon name={changeDirtyMark?.glyph ?? "Dot"} size={12} />
        </span>
      )}
      {scopeDenied > 0 && (
        // D-153: a graded count, like the change cues above — information, not an alert, so no
        // button role and no `field-*` class (never dropped by the truncation ladder). Absent for a
        // task with no refusals: a printed zero would make every quiet task look measured.
        <span
          data-testid="scope-badge"
          role="img"
          aria-label={scopeLabel}
          title={scopeDeniedMark?.meaning}
          className="type-label tabular-nums"
          style={{ display: "inline-flex", flexShrink: 0, alignItems: "center", gap: 2, color: "var(--text-primary-strip)" }}
        >
          <Icon name={scopeDeniedMark?.glyph ?? "ShieldBan"} size={12} />
          {scopeDenied}
        </span>
      )}
      <span
        className="type-body tabular-nums"
        style={{ flexShrink: 0, minWidth: 64, fontWeight: 600 }}
      >
        {item.key}
      </span>
      <span
        className="type-body"
        title={item.title}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.title}
      </span>
      {!isEpic && !hideEpicPill && (
        <span
          className="field-epic-pill type-label"
          style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
          title={!item.epicId ? epicMark?.meaning : epic ? undefined : epicUnresolvedMark?.meaning}
        >
          {epicLabel}
        </span>
      )}
      {isEpic && pendingProposalCount > 0 && (
        // D-82 (plan 05-08 Task 3): the epic-pill field slot is never used for an epic row itself
        // (an epic has no epic of its own, see `!isEpic` above) — reused here rather than adding a
        // new field, so this signal never competes with the Blocked/Needs Decision pills near the
        // status glyph for the same row space. Not a `blocked`-role colour (D-46: a pending
        // proposal burns no money) — `--accent-text-strip`, the same "agent, informational" role
        // `--accent-text-rack` already carries elsewhere in this product.
        <span
          className="field-epic-pill type-label tabular-nums"
          title={proposalPendingMark?.meaning}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0, color: "var(--accent-text-strip)" }}
        >
          <Icon name={proposalPendingMark?.glyph ?? "FileClock"} size={12} />
          {pendingProposalCount}
        </span>
      )}
      {item.assigneeId && (
        // An unassigned row prints no glyph: absent is not a value, the same discipline as the epic pill
        // and the change cue (A-03: a zero or an unknown renders nothing). Fourteen identical
        // "nobody" marks down a roster flatten the signals that do vary (08.1-14 finish review). The
        // picker is still one key (`a`), the palette and the detail panel away. D-198.1 extends the
        // same rule to the criteria count (`0/0`) and the priority glyph ("No priority") below.
        <span
          role="button"
          className="field-assignee type-label"
          aria-label={`Assignee: ${assignee?.displayName ?? "Assigned"}. Press to change.`}
          title={assignee ? `${assignee.displayName} (${assigneeBadgeMark?.label})` : undefined}
          onClick={handleAssigneeAvatarClick}
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 2,
            color: "var(--text-muted-strip)",
            cursor: "pointer",
          }}
        >
          <Icon name={assigneeBadgeMark?.glyph ?? "UserRound"} size={12} />
        </span>
      )}
      {criteriaTotal > 0 && (
        <span
          className="type-label tabular-nums"
          title={criteriaBadgeMark?.meaning}
          style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
        >
          {criteriaChecked}/{criteriaTotal}
        </span>
      )}
      {hasPriority && (
        <span
          role="button"
          aria-label={`Priority: ${priorityLabel}. Press to change.`}
          title={priorityLabel}
          onClick={handlePriorityGlyphClick}
          style={{ display: "inline-flex", flexShrink: 0, cursor: "pointer" }}
        >
          <Icon name={priorityMark?.glyph ?? "SignalZero"} />
        </span>
      )}
    </div>
  );
}
