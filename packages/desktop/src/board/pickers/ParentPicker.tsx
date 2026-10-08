/**
 * The generic sibling of the four fixed-option pickers (Status/Priority/Estimate/Assignee,
 * 01-UI-SPEC.md "Keyboard Map"). It exists because both "set a task's epic" (this plan,
 * G-01-EPIC-ASSIGN) and "set an issue's parent" (plan 01-15) are the SAME interaction over a
 * runtime list of `{id, label}` options, not four more fixed enumerations — so, exactly like
 * `AssigneePicker`, this picker has no direct-digit shortcut: the option count is not fixed at
 * design time.
 *
 * Same Radix wiring as every other picker in this directory (`FocusScope` + `DismissableLayer`,
 * portalled to `document.body` — `StatusPicker.tsx`'s doc comment explains why: each virtualized
 * board row is its own CSS stacking context, so a portal positioned from the anchor's real screen
 * coordinates is what actually escapes it). When an option carries a `group`, a non-interactive
 * heading is rendered before each run of options sharing that group — plan 01-15 uses this to
 * present epics and tasks as two labelled runs in the same list without forking this component.
 */
import { Fragment, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";

export interface ParentOption {
  id: string;
  label: string;
  /** When present, options sharing the same group render together under one non-interactive
   * heading naming the group — omit for a flat (ungrouped) list, e.g. this plan's epic list. */
  group?: string;
}

export interface ParentPickerProps {
  /** The full runtime option list, in display order. A grouped list must already be sorted so
   * that options sharing a `group` are contiguous — this component renders one heading per
   * contiguous run, not one heading per distinct group value. */
  options: ParentOption[];
  /** The parent id the selected item currently holds, or `null` for "none". */
  currentId: string | null;
  /** The label for the leading "clear the parent" option (e.g. "No epic"). */
  emptyLabel: string;
  /** The picker's `aria-label` (e.g. "Set epic") — also what the menu's accessible name is
   * asserted against in tests. */
  ariaLabel: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; bottom: number };
}

function optionStyle(selected: boolean): CSSProperties {
  return {
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
  };
}

export function ParentPicker({
  options,
  currentId,
  emptyLabel,
  ariaLabel,
  onSelect,
  onClose,
  anchorRect,
}: ParentPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  let lastGroup: string | undefined;

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
          aria-label={ariaLabel}
          className="parent-picker type-body"
          onKeyDown={handleKeyDown}
          style={{
            position: "fixed",
            top: anchorRect.bottom,
            left: anchorRect.left,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--surface-dominant)",
            color: "var(--text-primary-rack)",
            border: "1px solid var(--border-control)",
            borderRadius: "var(--radius-chrome)",
            padding: "var(--space-xs)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={currentId === null}
            autoFocus={currentId === null}
            onClick={() => onSelect(null)}
            style={optionStyle(currentId === null)}
          >
            <span>{emptyLabel}</span>
          </button>
          {options.map((option) => {
            const selected = option.id === currentId;
            const showHeading = option.group !== undefined && option.group !== lastGroup;
            if (showHeading) lastGroup = option.group;
            return (
              <Fragment key={option.id}>
                {showHeading && (
                  <div
                    className="type-label"
                    style={{
                      padding: "var(--space-xs) var(--space-sm)",
                      color: "var(--text-muted-rack)",
                    }}
                  >
                    {option.group}
                  </div>
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  autoFocus={selected}
                  onClick={() => onSelect(option.id)}
                  style={optionStyle(selected)}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {option.label}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
