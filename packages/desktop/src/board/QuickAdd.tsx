/**
 * Inline quick-add — the creation path (D-09). Typing a title and pressing Enter creates the
 * item at the current position; Escape cancels without creating. Detail and criteria are filled
 * in afterward by opening the item — quick-add captures a title only.
 */
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { ROW_HEIGHT } from "./BoardRow";

export interface QuickAddProps {
  onCreate: (title: string) => void;
}

export function QuickAdd({ onCreate }: QuickAddProps) {
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
    }
  }

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "100%",
    padding: "0 var(--space-md)",
    background: "var(--strip-backlog)",
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
        placeholder="Type a title, press Enter to create…"
        aria-label="Quick add a task"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
