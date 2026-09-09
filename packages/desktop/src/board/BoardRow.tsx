/**
 * One strip (01-UI-SPEC.md "Row Anatomy"): fixed-height, single-line, truncate-not-wrap. The
 * status glyph, key and priority glyph are never dropped at any supported window width. An epic
 * renders as an ordinary strip in its own band (01-UI-SPEC.md "Board list"); a task with no epic
 * shows the muted "No epic" pill (`legend/marks.ts`'s `epic-pill-none` mark) in the epic field
 * slot, never a blank (D-13). Fields this plan does not yet implement (assignee avatar, criteria
 * checked/total, actor-of-last-change) are simply not rendered — not rendered as an empty
 * placeholder — because their underlying features (assignee picker, acceptance criteria,
 * activity trail) do not exist yet in any plan through this one; see the SUMMARY's "Known
 * Stubs" section, matching the precedent plan 01-03 documented for these same fields.
 */
import type { CSSProperties, ComponentType, KeyboardEvent, MouseEvent } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID, priorityMarkId, statusMarkId } from "../legend/marks";
import type { BoardItem } from "./useBoardQuery";

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
  onSelect?: () => void;
  onOpenDetail?: () => void;
  onOpenStatusPicker?: () => void;
}

export function BoardRow({
  item,
  selected = false,
  focused = false,
  onSelect,
  onOpenDetail,
  onOpenStatusPicker,
}: BoardRowProps) {
  const statusMark = MARKS_BY_ID[statusMarkId(item.status)];
  const priorityMark = MARKS_BY_ID[priorityMarkId(item.priority)];
  const epicMark = MARKS_BY_ID["epic-pill-none"];
  const statusLabel = statusMark?.label ?? item.status;
  const priorityLabel = priorityMark?.label ?? "No priority";
  const isEpic = item.kind === "epic";

  // 01-UI-SPEC.md Accessibility: each row's accessible name concatenates key, title, status and
  // priority — virtualization must not silently break linear screen-reader navigation.
  const accessibleName = `${item.key}, ${item.title}, ${statusLabel}, priority ${priorityLabel}`;

  function handleRowClick() {
    onSelect?.();
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === "o") {
      event.preventDefault();
      onOpenDetail?.();
    } else if (event.key === "s") {
      event.preventDefault();
      onOpenStatusPicker?.();
    }
  }

  function handleStatusGlyphClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
    onOpenStatusPicker?.();
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
      tabIndex={focused ? 0 : -1}
      style={rowStyle}
      onClick={handleRowClick}
      onDoubleClick={onOpenDetail}
      onKeyDown={handleRowKeyDown}
    >
      <span
        role="button"
        aria-label={`Status: ${statusLabel}. Press to change.`}
        onClick={handleStatusGlyphClick}
        style={{ display: "inline-flex", flexShrink: 0, minWidth: 24, minHeight: 24, alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <Icon name={statusMark?.glyph ?? "Circle"} />
      </span>
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
      {!isEpic && (
        <span
          className="type-label"
          style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
          title={item.epicId ? undefined : epicMark?.meaning}
        >
          {item.epicId ?? epicMark?.label ?? "No epic"}
        </span>
      )}
      <span aria-hidden="true" title={priorityLabel} style={{ display: "inline-flex", flexShrink: 0 }}>
        <Icon name={priorityMark?.glyph ?? "SignalZero"} />
      </span>
    </div>
  );
}
