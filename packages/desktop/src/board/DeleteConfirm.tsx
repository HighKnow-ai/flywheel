/**
 * The destructive-delete confirmation (⌘⌫, 01-UI-SPEC.md "Copywriting Contract" — "Destructive
 * confirmation (delete)"; threat T-01-25). Not named in `01-09-PLAN.md`'s `files_modified` list —
 * added under deviation Rule 2 (missing critical functionality): the plan's own action text and
 * threat register require delete to "always route through the destructive confirmation that names
 * the item type, key and title," and no such surface existed anywhere in the codebase before this
 * plan (`useBoardQuery.ts`'s `useDeleteItem` mutation already existed from 01-04/01-07 but had no
 * caller — `BoardView.tsx` never issued a delete before this plan wired `⌘⌫`).
 *
 * Trapped via the same Radix primitives every other overlay in this codebase uses
 * (`pickers/StatusPicker.tsx`'s pattern) — `component_strategy: a-selfhost-radix`. Escape defaults
 * to cancel (T-01-25's explicit requirement); the destructive "Delete" button is never
 * `autoFocus`ed, so a stray Enter press while the dialog is opening lands on Cancel, not Delete.
 */
import { useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";

export interface DeleteConfirmProps {
  itemType: "Epic" | "Task" | "Issue";
  itemKey: string;
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirm({ itemType, itemKey, title, onConfirm, onCancel }: DeleteConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  }

  return createPortal(
    <FocusScope trapped loop asChild onMountAutoFocus={(event) => {
      event.preventDefault();
      cancelRef.current?.focus();
    }}>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
        onPointerDownOutside={onCancel}
        asChild
      >
        <div
          role="alertdialog"
          aria-label={`Delete ${itemType} ${itemKey}?`}
          onKeyDown={handleKeyDown}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            className="type-body"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
              maxWidth: 420,
              padding: "var(--space-lg)",
              background: "var(--surface-secondary)",
              color: "var(--text-primary-rack)",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            }}
          >
            <h2 className="type-heading" style={{ margin: 0 }}>
              Delete {itemType} {itemKey}?
            </h2>
            <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
              "{title}" and its acceptance criteria will be permanently removed. This can't be
              undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
              <button
                ref={cancelRef}
                type="button"
                className="type-body"
                onClick={onCancel}
                style={{
                  padding: "var(--space-xs) var(--space-md)",
                  borderRadius: "var(--radius-chrome)",
                  border: "1px solid var(--divider)",
                  background: "var(--surface-dominant)",
                  color: "var(--text-primary-rack)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="type-body"
                onClick={onConfirm}
                style={{
                  padding: "var(--space-xs) var(--space-md)",
                  borderRadius: "var(--radius-chrome)",
                  border: "1px solid var(--destructive-strip)",
                  background: "var(--destructive-strip)",
                  // `--text-primary-strip` (dark ink, meant for strip PAPER stock) measures only
                  // 2.2:1 against `--destructive-strip` — `--text-primary-rack` (the light rack
                  // text token) measures 6.3:1 here instead, well past AA. Caught in this plan's
                  // own craft-floor review, not shipped as a first draft.
                  color: "var(--text-primary-rack)",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
