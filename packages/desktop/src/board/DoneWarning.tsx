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
import { useEffect, useRef, type KeyboardEvent } from "react";

export interface DoneWarningProps {
  checked: number;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DoneWarning({ checked, total, onConfirm, onCancel }: DoneWarningProps) {
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

  return (
    <div
      ref={rootRef}
      role="alertdialog"
      aria-label="Unchecked acceptance criteria"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        bottom: "var(--space-lg)",
        left: "50%",
        transform: "translateX(-50%)",
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
      <span className="type-body tabular-nums">
        {checked}/{total} criteria unchecked. Mark Done anyway?
      </span>
      <span className="type-label" style={{ color: "var(--text-muted-rack)", whiteSpace: "nowrap" }}>
        Enter to confirm · Escape to cancel
      </span>
    </div>
  );
}
