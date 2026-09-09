/**
 * One strip (01-UI-SPEC.md "Row Anatomy"): fixed-height, single-line, truncate-not-wrap. The
 * status glyph, key and priority glyph are never dropped at any supported window width; the
 * epic pill sits in the progressive-disclosure ladder but is always rendered here since this
 * tracer's rows only ever carry the two states row anatomy requires (a real key, and either an
 * epic or the muted "No epic" pill — D-13).
 */
import type { CSSProperties, ComponentType } from "react";
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
}

export function BoardRow({ item }: BoardRowProps) {
  const statusMark = MARKS_BY_ID[statusMarkId(item.status)];
  const priorityMark = MARKS_BY_ID[priorityMarkId(item.priority)];
  const statusLabel = statusMark?.label ?? item.status;
  const priorityLabel = priorityMark?.label ?? "No priority";

  // 01-UI-SPEC.md Accessibility: each row's accessible name concatenates key, title, status and
  // priority — virtualization must not silently break linear screen-reader navigation.
  const accessibleName = `${item.key}, ${item.title}, ${statusLabel}, priority ${priorityLabel}`;

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    height: "100%",
    padding: `0 var(--space-md)`,
    background: STRIP_BACKGROUND[item.status] ?? "var(--strip-backlog)",
    color: "var(--text-primary-strip)",
    borderBottom: "1px solid var(--divider)",
    borderRadius: "var(--radius-strip)",
  };

  return (
    <div className="board-row" role="listitem" aria-label={accessibleName} style={rowStyle}>
      <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>
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
      <span
        className="type-label"
        style={{ flexShrink: 0, color: "var(--text-muted-strip)" }}
        title={item.epicId ? undefined : "No epic (D-13: a task may exist before its epic is known)"}
      >
        {item.epicId ?? "No epic"}
      </span>
      <span aria-hidden="true" title={priorityLabel} style={{ display: "inline-flex", flexShrink: 0 }}>
        <Icon name={priorityMark?.glyph ?? "SignalZero"} />
      </span>
    </div>
  );
}
