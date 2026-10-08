/**
 * The priority picker (01-UI-SPEC.md "Keyboard Map" — `p` opens it for the selected item; `0`-`4`
 * select the level directly, matching the schema's own keyed values exactly — unlike
 * `StatusPicker`'s 1-indexed digits). Its option list is generated from `legend/marks.ts`'s
 * `PRIORITY_MARKS` — the same registry the row strip's priority glyph and the Legend surface
 * read — so a sixth level cannot be added here alone: this file contains no literal array of
 * priority names.
 *
 * Same Radix wiring as `StatusPicker.tsx` (`FocusScope` + `DismissableLayer`, portalled to
 * `document.body` because every virtualized row is its own stacking context) — traps focus while
 * open, restores it to the row on close via Radix's default unmount-restore behaviour, and only
 * calls the core once a choice is made, never on open.
 */
import { useRef, type ComponentType, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import * as icons from "lucide-react";
import { PRIORITY_MARKS, priorityValueFromMarkId } from "../../legend/marks";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

export interface PriorityPickerProps {
  /** The schema priority value (0-4) the selected item currently holds. */
  currentPriority: number;
  onSelect: (priority: number) => void;
  onClose: () => void;
  /** Viewport-relative anchor the picker opens beneath — see `StatusPicker.tsx`'s own doc
   * comment for why this must be a portal positioned from real screen coordinates rather than
   * CSS `position: absolute` inside the row. */
  anchorRect: { top: number; left: number; bottom: number };
}

export function PriorityPicker({ currentPriority, onSelect, onClose, anchorRect }: PriorityPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const value = Number(event.key);
    if (Number.isInteger(value) && value >= 0 && value < PRIORITY_MARKS.length) {
      onSelect(value);
    }
  }

  return createPortal(
    <FocusScope trapped loop asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onPointerDownOutside={onClose}
        onFocusOutside={onClose}
        asChild
      >
        <div
          ref={menuRef}
          role="menu"
          aria-label="Set priority"
          className="priority-picker type-body"
          onKeyDown={handleKeyDown}
          style={{
            position: "fixed",
            top: anchorRect.bottom,
            left: anchorRect.left,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            minWidth: 180,
            background: "var(--surface-dominant)",
            color: "var(--text-primary-rack)",
            border: "1px solid var(--border-popover)",
            borderRadius: "var(--radius-chrome)",
            padding: "var(--space-xs)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {PRIORITY_MARKS.map((mark) => {
            const value = priorityValueFromMarkId(mark.id);
            const selected = value === currentPriority;
            return (
              <button
                key={mark.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                autoFocus={selected}
                onClick={() => onSelect(value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  padding: "var(--space-xs) var(--space-sm)",
                  // Per-side, not `border: "none"`: the selected rule below is `borderLeft`, and React warns when a
                  // shorthand and one of its longhands are both set on a style that re-renders.
                  borderTop: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  borderRadius: 0,
                  background: selected ? "var(--row-surface-selected)" : "transparent",
                  borderLeft: selected ? "2px solid var(--selection-rule)" : "2px solid transparent",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, width: 14 }}>
                  {value}
                </span>
                <Icon name={mark.glyph} />
                <span>{mark.label}</span>
              </button>
            );
          })}
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
