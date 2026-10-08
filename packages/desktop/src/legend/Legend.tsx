import type { CSSProperties, ComponentType } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import * as icons from "lucide-react";
import { MARKS, type Mark, type MarkChannel } from "./marks";
import "../styles/admin-surfaces.css";

const CHANNEL_LABELS: Record<MarkChannel, string> = {
  "row-state": "Row state",
  focus: "Focus",
  status: "Status",
  priority: "Priority",
  epic: "Epic",
  criteria: "Criteria",
  estimate: "Estimate",
  assignee: "Assignee",
  project: "Project switcher",
  agent: "Agent",
};

const SWATCH_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: "var(--radius-chrome)",
  flexShrink: 0,
};

/**
 * Row-state marks map onto the CSS roles the board paints, so the legend proves the real value and not
 * a copy. The selected surfaces are 1.07 and 1.04 against the ground, which no one can see in a 20px
 * swatch, so the swatch also draws what the board draws to tell them apart: the 2px rule (A-06). A task
 * row is the pattern: the focused rule is full ink on the selected surface, the unfocused one is the
 * lighter rule on the idle surface.
 */
const ROW_STATE_SWATCH: Record<string, { surface: string; rule?: string }> = {
  "row-surface": { surface: "var(--row-surface)" },
  "row-surface-hover": { surface: "var(--row-surface-hover)" },
  "row-surface-selected": { surface: "var(--row-surface-selected)", rule: "var(--selection-rule)" },
  "row-surface-selected-unfocused": { surface: "var(--row-surface)", rule: "var(--selection-rule-unfocused)" },
};

/** The mark as the row actually draws it, when that is more than the bare glyph. */
function sampleStyle(mark: Mark): CSSProperties | null {
  const sample = mark.sample;
  if (!sample) return null;
  return {
    ...SWATCH_BASE,
    width: "auto",
    minWidth: 20,
    gap: 2,
    padding: "0 var(--space-xs)",
    background: sample.boxed ? "transparent" : "var(--surface-secondary)",
    border: sample.boxed ? "1px solid var(--border-control)" : "1px solid var(--divider)",
    borderRadius: sample.boxed ? "var(--radius-mark)" : "var(--radius-chrome)",
    color: sample.boxed || !sample.glyph ? "var(--text-muted-rack)" : "var(--text-primary-rack)",
  };
}

function swatchStyle(mark: Mark): CSSProperties {
  const drawn = sampleStyle(mark);
  if (drawn) return drawn;
  const rowState = ROW_STATE_SWATCH[mark.id];
  if (rowState) {
    return {
      ...SWATCH_BASE,
      background: rowState.surface,
      border: "1px solid var(--divider)",
      // Rows are square; the swatch borrows the chrome radius only on the side that has no rule.
      ...(rowState.rule ? { borderLeftWidth: 2, borderLeftColor: rowState.rule, borderRadius: 0 } : {}),
    };
  }

  if (mark.channel === "focus") {
    // Focus channel: render as the ring itself, since a filled swatch would
    // misrepresent what a focus indicator actually looks like.
    return {
      ...SWATCH_BASE,
      background: "transparent",
      boxShadow: "0 0 0 2px var(--focus-ring)",
    };
  }

  // Every other mark is drawn in ink on one neutral swatch: the glyph and the printed word carry the
  // meaning. Status used to sit on a paper tint here; D-11 removed the tint channel.
  return {
    ...SWATCH_BASE,
    background: "var(--surface-secondary)",
    border: "1px solid var(--divider)",
  };
}

/**
 * Resolves a mark's `glyph` (a `lucide-react` export name, per the locked icon
 * decision — 01-UI-SPEC.md "Design System") to the real icon component.
 * Uniform 2px stroke, no fill — never a unicode/emoji stand-in.
 */
type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Glyph({ name }: { name: string }) {
  const Icon = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Icon) return null;
  return <Icon size={14} strokeWidth={2} />;
}

export interface LegendProps {
  /**
   * Present only when `Legend` is opened as a dismissable overlay (01-09-PLAN.md Task 2 —
   * `CommandPalette.tsx`'s "Open Legend" command, "the legend is one command away"). `undefined`
   * (the default) renders the bare, embeddable `<section>` exactly as every prior plan left it —
   * no other caller exists yet, but the optional-prop pattern established in `BoardView.tsx`'s
   * `emptyState` (01-08) is the precedent: an additive prop never breaks a caller that omits it.
   */
  onClose?: () => void;
}

/**
 * The always-reachable legend surface (01-UI-SPEC.md "Selected Direction" —
 * "no mark may exist that the legend does not define"). Renders the MARKS
 * registry grouped by channel; it derives the surface from the registry
 * rather than restating it, so a mark that is not in the registry cannot
 * appear here and a mark that is in the registry cannot be missing.
 */
export function Legend({ onClose }: LegendProps = {}) {
  const channels = Array.from(new Set(MARKS.map((m) => m.channel)));

  const content = (
    <section
      className={onClose ? "legend legend-dialog" : "legend"}
      aria-label="Legend"
      role={onClose ? "dialog" : undefined}
    >
      {/* The embedded form has the same title the dialog has. Only the dialog has something to close. */}
      <header className="legend-header">
        <h1 className="type-heading" style={{ margin: 0 }}>
          Legend
        </h1>
        {onClose && (
          <button
            type="button"
            aria-label="Close legend"
            onClick={onClose}
            className="type-label control-edge admin-action"
          >
            Close
          </button>
        )}
      </header>
      {/* One screen of marks per channel, ten channels: an index, so no mark is a long scroll away. Links, not a
          list, so the registry's rows stay the only list items on the surface. */}
      <nav aria-label="Legend channels" className="legend-index type-label">
        {channels.map((channel) => (
          <a
            key={channel}
            href={`#legend-channel-${channel}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(`legend-channel-${channel}`)?.scrollIntoView?.({ block: "start" });
            }}
          >
            {CHANNEL_LABELS[channel]}
          </a>
        ))}
      </nav>
      {channels.map((channel) => (
        <div key={channel} id={`legend-channel-${channel}`} className="legend-channel">
          <h2 className="type-heading" style={{ margin: 0 }}>
            {CHANNEL_LABELS[channel]}
          </h2>
          <ul className="legend-list">
            {MARKS.filter((m) => m.channel === channel).map((mark) => (
              <li key={mark.id} className="legend-row">
                <span aria-hidden="true" style={swatchStyle(mark)}>
                  {(mark.sample?.glyph ?? true) && <Glyph name={mark.glyph} />}
                  {mark.sample && <span className="type-label tabular-nums">{mark.sample.text}</span>}
                </span>
                <span className="type-body">{mark.label}</span>
                <span className="type-label legend-meaning">{mark.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );

  if (!onClose) {
    return content;
  }

  // Overlay mode — trapped/dismissable exactly like every other overlay in this codebase
  // (`pickers/StatusPicker.tsx`'s pattern; `component_strategy: a-selfhost-radix`).
  return createPortal(
    <FocusScope trapped loop asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onPointerDownOutside={onClose}
        asChild
      >
        <div className="legend-scrim">{content}</div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}

export default Legend;
