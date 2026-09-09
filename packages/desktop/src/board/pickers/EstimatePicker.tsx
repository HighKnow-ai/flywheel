/**
 * The estimate picker (01-UI-SPEC.md "Keyboard Map" — `e` opens it for the selected item). Its
 * option list is generated from `legend/marks.ts`'s `ESTIMATE_MARKS` (S/M/L, D-12's nullable
 * ordinal 1-3) plus one literal "Clear" row for the field's nullability — the field carries no
 * default, so a picker over it must offer a way back to unset. `0` clears, `1`-`3` select S/M/L
 * directly (mirrors `PriorityPicker`'s 0-indexed-from-"no value" digit scheme, not
 * `StatusPicker`'s 1-indexed one).
 *
 * Same Radix wiring as `StatusPicker.tsx`/`PriorityPicker.tsx`.
 */
import { useRef, type ComponentType, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import * as icons from "lucide-react";
import { ESTIMATE_MARKS } from "../../legend/marks";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

export interface EstimatePickerProps {
  /** The schema estimate value (1-3, S/M/L) the selected item currently holds, or `null`. */
  currentEstimate: number | null;
  onSelect: (estimate: number | null) => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; bottom: number };
}

export function EstimatePicker({ currentEstimate, onSelect, onClose, anchorRect }: EstimatePickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "0" || event.key === "Backspace") {
      onSelect(null);
      return;
    }
    const value = Number(event.key);
    if (Number.isInteger(value) && value >= 1 && value <= ESTIMATE_MARKS.length) {
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
          aria-label="Set estimate"
          className="estimate-picker type-body"
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
          <button
            type="button"
            role="menuitemradio"
            aria-checked={currentEstimate == null}
            autoFocus={currentEstimate == null}
            onClick={() => onSelect(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-xs) var(--space-sm)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              background: currentEstimate == null ? "var(--surface-dominant)" : "transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, width: 14 }}>
              0
            </span>
            <Icon name="CircleSlash" />
            <span>Clear</span>
          </button>
          {ESTIMATE_MARKS.map((mark, index) => {
            const value = index + 1;
            const selected = value === currentEstimate;
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
