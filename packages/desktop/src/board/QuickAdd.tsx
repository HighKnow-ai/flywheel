/**
 * Inline quick-add — the creation path (D-09). Typing a title and pressing Enter creates the
 * item at the current position; Escape cancels without creating. Detail and criteria are filled
 * in afterward by opening the item — quick-add captures a title only.
 *
 * `indentTarget`/`indented`/`onIndentChange` (G-01-EPIC-ASSIGN, plan 01-15) are the Tab-nesting
 * affordance, opt-in via all three props being supplied. `IssuesLane.tsx`'s always-mounted
 * quick-add supplies none of them and keeps native Tab moving focus out of the region exactly as
 * it always has — this row never nests an issue under anything at creation time.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ROW_HEIGHT_BY_KIND } from "./BoardRow";

/** The epic (or, for a future nesting target, any item) a nested quick-add row would create
 * under — just enough to render the indent chip, never a full `BoardItem`. */
export interface QuickAddIndentTarget {
  id: string;
  key: string;
  title: string;
}

export interface QuickAddProps {
  /** `epicId` is the indent target's id when `indented` is true, `null` otherwise — always
   * `null` for a caller that never supplies `indentTarget` (G-01-EPIC-ASSIGN, plan 01-15). */
  onCreate: (title: string, epicId: string | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  background?: string;
  /** Mount-time default, now used only for the empty-board state (01-UI-SPEC.md's "Quick-add is
   * pre-focused") — every on-demand open (⌘N/⌘⇧N/`c`/the command palette/the native menu bridge)
   * goes through `focusPending` below instead (G-01-4, 01-19-PLAN.md Task 1), because the row is
   * virtualized and at volume it is not mounted at the moment the keystroke arrives. Left `false`
   * by default so `IssuesLane.tsx`'s always-mounted quick-add (01-04) does not steal focus on
   * every app load — it supplies neither this prop nor `focusPending`. */
  autoFocus?: boolean;
  /** A one-shot request (G-01-4): when `true`, this component focuses its input and immediately
   * calls `onFocusHandled` so the request is consumed exactly once. This is what makes focus
   * survive a virtualized row mounting *after* the keystroke that asked for it — `autoFocus`
   * above only fires on mount, which is too early when the row was not mounted yet. */
  focusPending?: boolean;
  /** Called once, from the same effect that consumes `focusPending`, so the caller (which owns
   * the request flag in `state/uiStore.ts`) can clear it. */
  onFocusHandled?: () => void;
  /** Fires in addition to the existing clear-and-blur behavior when Escape cancels the row — lets
   * a caller that renders this row conditionally (`BoardView.tsx`'s on-demand quick-add) also
   * unmount it, completing the Escape ladder's "quick-add" layer (01-09-PLAN.md Task 1). */
  onEscape?: () => void;
  /** What Tab would nest the new item under, or `null` when the current selection implies no
   * epic (or quick-add is composing an epic itself — an epic has no epic parent). Absent entirely
   * for a caller that never wires nesting (`IssuesLane.tsx`). */
  indentTarget?: QuickAddIndentTarget | null;
  /** Whether the row is currently nested under `indentTarget`. Caller-owned (`BoardView.tsx`
   * holds it as local state) rather than internal — the indent chip and the id `onCreate`
   * receives must stay in sync with whatever the caller renders around this row. */
  indented?: boolean;
  /** Fires when Tab/Shift+Tab change the nesting state — only ever called when `indentTarget`
   * (for Tab) or `indented` (for Shift+Tab) make the gesture meaningful; see `handleKeyDown`. */
  onIndentChange?: (indented: boolean) => void;
}

export function QuickAdd({
  onCreate,
  placeholder = "Type a title, press Enter to create…",
  ariaLabel = "Quick add a task",
  background = "var(--strip-backlog)",
  autoFocus = false,
  focusPending = false,
  onFocusHandled,
  onEscape,
  indentTarget = null,
  indented = false,
  onIndentChange,
}: QuickAddProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Consumes `focusPending` (G-01-4) — guarded so this effect is a no-op on every render except
  // the one where the caller actually raised the request. An inline arrow passed as
  // `onFocusHandled` re-running this effect on every parent render is harmless: the flag is
  // already `false` by then, and the guard below returns before touching focus again.
  useEffect(() => {
    if (!focusPending) return;
    inputRef.current?.focus();
    onFocusHandled?.();
  }, [focusPending, onFocusHandled]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && onIndentChange) {
      // Only intercepted when the nesting props are actually supplied — a caller that passes
      // none of them (IssuesLane's own quick-add) never reaches this branch at all, and Tab
      // falls through to the native browser default of moving focus out of the region.
      if (event.shiftKey) {
        if (indented) {
          event.preventDefault();
          onIndentChange(false);
        }
      } else if (indentTarget) {
        event.preventDefault();
        onIndentChange(true);
      }
      return;
    }
    if (event.key === "Enter") {
      const title = value.trim();
      if (title.length > 0) {
        onCreate(title, indented && indentTarget ? indentTarget.id : null);
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
    paddingLeft: indented ? "var(--space-xl)" : "var(--space-md)",
    background,
    borderBottom: "1px solid var(--divider)",
    borderRadius: "var(--radius-strip)",
  };

  return (
    <div className="quick-add" style={rowStyle} data-row-height={ROW_HEIGHT_BY_KIND.task}>
      {indented && indentTarget && (
        <span
          className="type-label"
          style={{
            flexShrink: 0,
            marginRight: "var(--space-xs)",
            color: "var(--text-muted-strip)",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            padding: "1px var(--space-xs)",
          }}
        >
          {indentTarget.key}
        </span>
      )}
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
        ref={inputRef}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in only; see the prop doc comment.
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
