/**
 * One strip (01-UI-SPEC.md "Row Anatomy"): fixed-height, single-line, truncate-not-wrap, fields
 * in fixed left-to-right order (status glyph → key → title → estimate badge → epic pill →
 * assignee avatar → criteria checked/total → priority glyph → actor-of-last-change). The status
 * glyph, key, title, priority glyph and criteria checked/total are never dropped at any
 * supported window width (≥900px) — the `.field-estimate`/`.field-epic-pill`/`.field-assignee`
 * container-query rules in `App.css` implement the progressive-disclosure ladder (estimate badge
 * drops last, epic pill and assignee avatar drop earlier) as the row's own inline size narrows;
 * `.board-row`'s `container-type: inline-size` is what makes those rules respond to the row
 * itself rather than the viewport. An epic renders as an ordinary strip in its own band
 * (01-UI-SPEC.md "Board list"); a task with no epic shows the muted "No epic" pill
 * (`legend/marks.ts`'s `epic-pill-none` mark) in the epic field slot, never a blank (D-13). The
 * criteria checked/total count (BOARD-02, D-08) is structurally exempt from the ladder — it
 * renders `0/0` for an item with zero criteria, never a blank (D-07: never for issues, but
 * issues never reach `BoardRow` — they render in `IssuesLane.tsx`'s separate lane).
 *
 * The estimate badge (D-12) renders the letter itself (S/M/L), never the stored numeric ordinal
 * — the letters are the whole point of the "never aggregated" decision. It is simply absent (no
 * badge, no placeholder) for an item with no estimate set, same discipline the epic pill already
 * uses for `null`. The actor-of-last-change field (avatar + relative time) is not yet
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
 */
import type { CSSProperties, ComponentType, MouseEvent } from "react";
import * as icons from "lucide-react";
import {
  actorTypeMarkId,
  estimateLetter,
  estimateMarkId,
  MARKS_BY_ID,
  priorityMarkId,
  statusMarkId,
} from "../legend/marks";
import type { Actor, BoardItem, EpicSummary } from "./useBoardQuery";

/** The one constant row height every board row uses — see BoardView.tsx's virtualizer. */
export const ROW_HEIGHT = 40;

const STRIP_BACKGROUND: Record<string, string> = {
  backlog: "var(--strip-backlog)",
  todo: "var(--strip-todo)",
  in_progress: "var(--strip-in-progress)",
  in_review: "var(--strip-in-review)",
  done: "var(--strip-done)",
};

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
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
  onSelect?: () => void;
  onOpenDetail?: () => void;
  onOpenStatusPicker?: () => void;
  onOpenPriorityPicker?: () => void;
  onOpenEstimatePicker?: () => void;
  onOpenAssigneePicker?: () => void;
  /** Activating the blocked pill — opens the item detail panel (which renders the
   * permission-request card automatically whenever a pending request exists, plan 02-06 Task 2),
   * the fastest path from "I see something needs me" to "I answered it." */
  onOpenBlocked?: () => void;
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
  onSelect,
  onOpenDetail,
  onOpenStatusPicker,
  onOpenPriorityPicker,
  onOpenEstimatePicker,
  onOpenAssigneePicker,
  onOpenBlocked,
}: BoardRowProps) {
  const statusMark = MARKS_BY_ID[statusMarkId(item.status)];
  const blockedMark = MARKS_BY_ID["blocked-indicator"];
  const priorityMark = MARKS_BY_ID[priorityMarkId(item.priority)];
  const epicMark = MARKS_BY_ID["epic-pill-none"];
  // Defence in depth (G-01-2, T-01-17-02): once `epicsById` is the project's full roster
  // (`BoardView`'s `useEpics()`), this mark is reachable only while that roster query is pending
  // or has failed — it exists so a future regression in the roster's source degrades to a
  // readable word rather than back to an internal identifier.
  const epicUnresolvedMark = MARKS_BY_ID["epic-pill-unresolved"];
  const criteriaBadgeMark = MARKS_BY_ID["criteria-count-badge"];
  const estimateId = estimateMarkId(item.estimate);
  const estimateMark = estimateId ? MARKS_BY_ID[estimateId] : undefined;
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
  const isEpic = item.kind === "epic";
  const criteriaChecked = item.criteriaChecked ?? 0;
  const criteriaTotal = item.criteriaTotal ?? 0;

  // 01-UI-SPEC.md Accessibility: each row's accessible name concatenates key, title, status,
  // priority and the criteria checked/total count — virtualization must not silently break
  // linear screen-reader navigation. "Blocked" appends when set (D-37) — never colour alone.
  const accessibleName = `${item.key}, ${item.title}, ${statusLabel}${blocked ? ", Blocked" : ""}, priority ${priorityLabel}, ${criteriaChecked} of ${criteriaTotal} criteria checked`;

  function handleRowClick() {
    onSelect?.();
  }

  function handleBlockedPillClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenBlocked?.();
  }

  function handleStatusGlyphClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenStatusPicker?.();
  }

  function handlePriorityGlyphClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenPriorityPicker?.();
  }

  function handleEstimateBadgeClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenEstimatePicker?.();
  }

  function handleAssigneeAvatarClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenAssigneePicker?.();
  }

  // 01-UI-SPEC.md Accessibility: `row-surface-selected` vs. `row-surface-selected-unfocused`
  // must be simultaneously distinguishable from each other and from the idle/hover states — a
  // selected-but-blurred row (e.g. after Escape from the detail panel) must not look identical
  // to a focused-and-selected row.
  const selectionOverlay = focused
    ? "var(--row-surface-selected)"
    : selected
      ? "var(--row-surface-selected-unfocused)"
      : "var(--row-surface)";

  const rowStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    height: "100%",
    padding: `0 var(--space-md)`,
    background: `linear-gradient(${selectionOverlay}, ${selectionOverlay}), ${STRIP_BACKGROUND[item.status] ?? "var(--strip-backlog)"}`,
    color: "var(--text-primary-strip)",
    borderBottom: "1px solid var(--divider)",
    borderRadius: "var(--radius-strip)",
    outline: focused ? "2px solid var(--focus-ring)" : "none",
    outlineOffset: -2,
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
      <span
        role="button"
        aria-label={`Status: ${statusLabel}. Press to change.`}
        onClick={handleStatusGlyphClick}
        style={{ display: "inline-flex", flexShrink: 0, minWidth: 24, minHeight: 24, alignItems: "center", justifyContent: "center", cursor: "pointer" }}
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
          className="type-micro"
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
      {estimateMark && (
        <span
          role="button"
          className="field-estimate type-micro tabular-nums"
          aria-label={`Estimate: ${estimateMark.label}. Press to change.`}
          title={estimateMark.meaning}
          onClick={handleEstimateBadgeClick}
          style={{
            flexShrink: 0,
            minWidth: 20,
            textAlign: "center",
            color: "var(--text-muted-strip)",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            padding: "1px var(--space-xs)",
            cursor: "pointer",
          }}
        >
          {estimateLetter(item.estimate)}
        </span>
      )}
      {!isEpic && (
        <span
          className="field-epic-pill type-label"
          style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
          title={!item.epicId ? epicMark?.meaning : epic ? undefined : epicUnresolvedMark?.meaning}
        >
          {epicLabel}
        </span>
      )}
      <span
        role="button"
        className="field-assignee type-label"
        aria-label={`Assignee: ${assignee?.displayName ?? "Unassigned"}. Press to change.`}
        title={assignee ? `${assignee.displayName} (${assigneeBadgeMark?.label})` : assigneeBadgeMark?.meaning}
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
      <span
        className="type-label tabular-nums"
        title={criteriaBadgeMark?.meaning}
        style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
      >
        {criteriaChecked}/{criteriaTotal}
      </span>
      <span
        role="button"
        aria-label={`Priority: ${priorityLabel}. Press to change.`}
        title={priorityLabel}
        onClick={handlePriorityGlyphClick}
        style={{ display: "inline-flex", flexShrink: 0, cursor: "pointer" }}
      >
        <Icon name={priorityMark?.glyph ?? "SignalZero"} />
      </span>
    </div>
  );
}
