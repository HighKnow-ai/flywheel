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
 * (`pickers/PriorityPicker.tsx`'s pattern) — `component_strategy: a-selfhost-radix`. Escape defaults
 * to cancel (T-01-25's explicit requirement); the destructive "Delete" button is never
 * `autoFocus`ed, so a stray Enter press while the dialog is opening lands on Cancel, not Delete.
 * Cancel carries `autoFocus` itself as well as the scope's mount handler, because a reviewer found
 * the dialog opening with focus on the scrim's own `tabindex="-1"` container, where Enter answers
 * nothing: the attribute makes the first focus deterministic, and the scope then leaves it alone.
 */
import { useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { Trash2 } from "lucide-react";
import "../styles/states-and-confirms.css";

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
          className="confirm-scrim"
        >
          <div className="type-body confirm-dialog">
            <h2 className="type-heading">
              Delete {itemType} {itemKey}?
            </h2>
            <p className="type-body">
              "{title}" and its acceptance criteria will be permanently removed. This can't be
              undone.
            </p>
            <div className="confirm-actions">
              <button
                ref={cancelRef}
                type="button"
                autoFocus
                className="type-body control-edge confirm-action"
                onClick={onCancel}
              >
                Cancel
              </button>
              {/* The destructive text role on an edge, never a fill (2.95:1 light, 2.86:1 dark as a fill),
                  and the icon tells it from the accent by more than hue. */}
              <button
                type="button"
                className="type-body control-edge confirm-action confirm-action-destructive"
                onClick={onConfirm}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
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
