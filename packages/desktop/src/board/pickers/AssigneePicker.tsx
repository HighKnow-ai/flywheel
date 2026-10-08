/**
 * The assignee picker (01-UI-SPEC.md "Keyboard Map" — `a` opens it for the selected item). Lists
 * every actor from `actor_list` (BOARD-06) with an explicit "Unassigned" entry first, and
 * distinguishes human from agent actors with a badge — they are peers in one actor model
 * (DATA-03), and the picker must say which is which without relying on colour alone
 * (`legend/marks.ts`'s `actorTypeMarkId`).
 *
 * Unlike `StatusPicker`/`PriorityPicker`/`EstimatePicker`, the option count is not fixed at
 * design time (the actor roster grows), so this picker has no direct-digit shortcut — options
 * are reached by the trapped `Tab` order `FocusScope` already provides and activated with the
 * browser's own `Enter`/`Space` button semantics, exactly like every other button in this list.
 * Same Radix wiring otherwise (`FocusScope` + `DismissableLayer`, portalled to `document.body`).
 */
import { useRef, type ComponentType, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import * as icons from "lucide-react";
import { actorTypeMarkId, MARKS_BY_ID } from "../../legend/marks";
import type { Actor } from "../useBoardQuery";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

export interface AssigneePickerProps {
  /** The `assignee_id` the selected item currently holds, or `null` for "Unassigned". */
  currentAssigneeId: string | null;
  /** The actor roster from `useActors()` — fetched by the caller, not by this component, so it
   * never issues a command on open (only a selection does). */
  actors: Actor[];
  onSelect: (assigneeId: string | null) => void;
  onClose: () => void;
  anchorRect: { top: number; left: number; bottom: number };
}

export function AssigneePicker({
  currentAssigneeId,
  actors,
  onSelect,
  onClose,
  anchorRect,
}: AssigneePickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const unassignedMark = MARKS_BY_ID["assignee-unassigned"];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
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
          aria-label="Set assignee"
          className="assignee-picker type-body"
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
            aria-checked={currentAssigneeId === null}
            autoFocus={currentAssigneeId === null}
            onClick={() => onSelect(null)}
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
              background: currentAssigneeId === null ? "var(--row-surface-selected)" : "transparent",
              borderLeft: currentAssigneeId === null ? "2px solid var(--selection-rule)" : "2px solid transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Icon name={unassignedMark?.glyph ?? "UserRound"} />
            <span>Unassigned</span>
          </button>
          {actors
            .filter((actor) => actor.actorType !== "system")
            .map((actor) => {
              const badgeMark = MARKS_BY_ID[actorTypeMarkId(actor.actorType)];
              const selected = actor.id === currentAssigneeId;
              return (
                <button
                  key={actor.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  autoFocus={selected}
                  onClick={() => onSelect(actor.id)}
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
                  <Icon name={badgeMark?.glyph ?? "User"} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {actor.displayName}
                  </span>
                  <span
                    className="type-micro"
                    title={badgeMark?.meaning}
                    style={{ color: "var(--text-muted-rack)", flexShrink: 0 }}
                  >
                    {badgeMark?.label}
                  </span>
                </button>
              );
            })}
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
