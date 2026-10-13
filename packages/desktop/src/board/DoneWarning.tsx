/**
 * The non-modal inline confirmation for moving an item to Done with unchecked criteria (D-08):
 * warns, never blocks. Exact copy from 01-UI-SPEC.md's Copywriting Contract ("Done-with-
 * unchecked-criteria warning" row) — `Enter` confirms, `Escape` cancels.
 *
 * A hard block was rejected because criteria become immutable from Phase 4 onward (BOARD-03), so
 * a wrong criterion would leave the user fighting their own tool. The caller (`BoardView.tsx`)
 * gates the status mutation itself: it does not call `set_task_status`/`set_epic_status` until
 * this component's `onConfirm` fires, so cancelling simply never applies the pending change —
 * "reverts the status change" by never having made it (01-UI-SPEC.md State Inventory).
 *
 * Renders nothing when there is nothing to warn about: zero total criteria, or nothing left
 * unchecked — it never fires for either case.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";

export interface DoneWarningProps {
  checked: number;
  total: number;
  /** The item's own key, so the warning names what it is about ("THRE-26"). Omitted by a caller with none. */
  itemKey?: string;
  /**
   * The triggering row's `getBoundingClientRect()`. The warning is a POPOVER (UI-SPEC § Overlay Rule 2:
   * "anchored to a trigger"), so it opens under the row it concerns. Absent when that row is not on screen
   * (a change raised from the detail panel for an off-screen row): it then falls back to the bottom centre.
   */
  anchorRect?: { top: number; left: number; bottom: number };
  onConfirm: () => void;
  onCancel: () => void;
}

/** Room under the anchor the popover needs; below it, the popover opens above the row instead. */
const POPOVER_HEIGHT_GUESS = 56;
const POPOVER_MAX_WIDTH = 640;

export function DoneWarning({ checked, total, itemKey, anchorRect, onConfirm, onCancel }: DoneWarningProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hasUnchecked = total > 0 && checked < total;

  useEffect(() => {
    if (hasUnchecked) {
      rootRef.current?.focus();
    }
  }, [hasUnchecked]);

  if (!hasUnchecked) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  // Placed from the row's real screen coordinates, like the five pickers (a portal-free `position: fixed`).
  let placement: CSSProperties;
  if (anchorRect) {
    const above = anchorRect.bottom + POPOVER_HEIGHT_GUESS > window.innerHeight;
    placement = {
      position: "fixed",
      left: Math.max(8, Math.min(anchorRect.left + 16, window.innerWidth - POPOVER_MAX_WIDTH - 8)),
      ...(above ? { bottom: window.innerHeight - anchorRect.top + 4 } : { top: anchorRect.bottom + 4 }),
    };
  } else {
    placement = { position: "fixed", bottom: "var(--space-lg)", left: "50%", transform: "translateX(-50%)" };
  }

  return (
    <div
      ref={rootRef}
      role="alertdialog"
      aria-label="Unchecked acceptance criteria"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        ...placement,
        maxWidth: POPOVER_MAX_WIDTH,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        border: "1px solid var(--border-popover)",
        borderRadius: "var(--radius-chrome)",
        boxShadow: "var(--shadow-popover)",
        outline: "none",
      }}
    >
      {/* "2 of 3 criteria unchecked", not "1/3": the fraction read two ways (one unchecked, or one checked). */}
      <span className="type-body tabular-nums">
        {itemKey ? `${itemKey} · ` : ""}
        {total - checked} of {total} criteria unchecked. Mark Done anyway?
      </span>
      <span className="type-label" style={{ color: "var(--text-muted-rack)", whiteSpace: "nowrap" }}>
        Enter to confirm · Escape to cancel
      </span>
    </div>
  );
}
