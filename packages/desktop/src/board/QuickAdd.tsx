/**
 * Inline quick-add — the creation path (D-09). Typing a title and pressing Enter creates the
 * item at the current position; Escape cancels without creating. Detail and criteria are filled
 * in afterward by opening the item — quick-add captures a title only.
 */
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { ROW_HEIGHT } from "./BoardRow";

export interface QuickAddProps {
  onCreate: (title: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  background?: string;
  /** Focuses the input on mount (01-09-PLAN.md: `c`/`⌘N` opening quick-add on demand must land
   * the cursor in it immediately, matching "quick-add is already visible and focused" for the
   * empty-board default). Left `false` by default so `IssuesLane.tsx`'s always-mounted quick-add
   * (01-04) does not steal focus on every app load. */
  autoFocus?: boolean;
  /** Fires in addition to the existing clear-and-blur behavior when Escape cancels the row — lets
   * a caller that renders this row conditionally (`BoardView.tsx`'s on-demand quick-add) also
   * unmount it, completing the Escape ladder's "quick-add" layer (01-09-PLAN.md Task 1). */
  onEscape?: () => void;
}

export function QuickAdd({
  onCreate,
  placeholder = "Type a title, press Enter to create…",
  ariaLabel = "Quick add a task",
  background = "var(--strip-backlog)",
  autoFocus = false,
  onEscape,
}: QuickAddProps) {
  const [value, setValue] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      const title = value.trim();
      if (title.length > 0) {
        onCreate(title);
        setValue("");
      }
    } else if (event.key === "Escape") {
      setValue("");
      event.currentTarget.blur();
      onEscape?.();
    }
  }

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "100%",
    padding: "0 var(--space-md)",
    background,
    borderBottom: "1px solid var(--divider)",
    borderRadius: "var(--radius-strip)",
  };

  return (
    <div className="quick-add" style={rowStyle} data-row-height={ROW_HEIGHT}>
      <input
        className="type-body"
        style={{
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary-strip)",
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in only; see the prop doc comment.
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
