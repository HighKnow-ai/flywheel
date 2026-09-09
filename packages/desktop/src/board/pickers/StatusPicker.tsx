/**
 * The status picker (01-UI-SPEC.md "Keyboard Map" — `s` opens it for the selected item; `1`-`5`
 * select Backlog/Todo/In Progress/In Review/Done directly). Its option list is generated from
 * `legend/marks.ts`'s `STATUS_MARKS` — the same registry the row strips and the Legend surface
 * read — so a sixth option cannot be added here alone (BOARD-04): this file contains no literal
 * array of state names.
 *
 * Focus trapping and dismiss-on-outside-interaction are hand-wired against the low-level Radix
 * primitives `@radix-ui/react-focus-scope` / `@radix-ui/react-dismissable-layer`
 * (01-UI-SPEC.md Design System — `component_strategy: a-selfhost-radix`: no shadcn, no
 * pre-styled Radix component, just the accessibility machinery itself).
 */
import { useRef, type ComponentType, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import * as icons from "lucide-react";
import { STATUS_MARKS, statusValueFromMarkId } from "../../legend/marks";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

export interface StatusPickerProps {
  /** The schema status value (`backlog`, `todo`, ...) the selected item currently holds. */
  currentStatus: string;
  onSelect: (status: string) => void;
  onClose: () => void;
  /**
   * Viewport-relative anchor (the triggering row/button's `getBoundingClientRect()`) the picker
   * opens beneath. Required because every virtualized board row is its own CSS stacking context
   * (each carries its own `transform` for positioning) — content that overflows a row's box
   * paints BEHIND the next row rather than above it, no matter how high its own `z-index` is
   * (z-index only orders siblings within one stacking context). Rendering through a portal to
   * `document.body`, positioned from the anchor's real screen coordinates, is what actually
   * escapes that per-row stacking context.
   */
  anchorRect: { top: number; left: number; bottom: number };
}

export function StatusPicker({ currentStatus, onSelect, onClose, anchorRect }: StatusPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    const oneIndexed = Number(event.key);
    if (Number.isInteger(oneIndexed) && oneIndexed >= 1 && oneIndexed <= STATUS_MARKS.length) {
      const mark = STATUS_MARKS[oneIndexed - 1];
      onSelect(statusValueFromMarkId(mark.id));
    }
  }

  return createPortal(
    // `onUnmountAutoFocus` is left at Radix's default (restore focus to whatever had it before
    // the picker opened) — this is what returns focus to the row on close (01-UI-SPEC.md
    // Keyboard Map: "traps focus while open and restores it to the triggering element on close").
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
          aria-label="Set status"
          className="status-picker type-body"
          onKeyDown={handleKeyDown}
          style={{
            position: "fixed",
            top: anchorRect.bottom,
            left: anchorRect.left,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            minWidth: 180,
            background: "var(--surface-secondary)",
            color: "var(--text-primary-rack)",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            padding: "var(--space-xs)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {STATUS_MARKS.map((mark, index) => {
            const value = statusValueFromMarkId(mark.id);
            const selected = value === currentStatus;
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
                  border: "none",
                  borderRadius: "var(--radius-chrome)",
                  background: selected ? "var(--surface-dominant)" : "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, width: 14 }}>
                  {index + 1}
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
