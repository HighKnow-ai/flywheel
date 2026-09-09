import type { CSSProperties, ComponentType } from "react";
import * as icons from "lucide-react";
import { MARKS, type Mark, type MarkChannel } from "./marks";

const CHANNEL_LABELS: Record<MarkChannel, string> = {
  "row-state": "Row state",
  focus: "Focus",
  status: "Status",
  priority: "Priority",
  epic: "Epic",
  criteria: "Criteria",
  estimate: "Estimate",
  assignee: "Assignee",
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
 * Row-state marks map 1:1 onto a CSS token role — render the actual token as
 * the swatch background so the legend proves the real value, not a copy. The
 * focus mark has no background token of its own; it is rendered as a ring
 * instead, which is what it actually looks like in the product.
 */
const TOKEN_BY_MARK_ID: Record<string, string> = {
  "row-surface": "var(--row-surface)",
  "row-surface-hover": "var(--row-surface-hover)",
  "row-surface-selected": "var(--row-surface-selected)",
  "row-surface-selected-unfocused": "var(--row-surface-selected-unfocused)",
  "strip-backlog": "var(--strip-backlog)",
  "strip-todo": "var(--strip-todo)",
  "strip-in-progress": "var(--strip-in-progress)",
  "strip-in-review": "var(--strip-in-review)",
  "strip-done": "var(--strip-done)",
};

function swatchStyle(mark: Mark): CSSProperties {
  const token = TOKEN_BY_MARK_ID[mark.id];
  if (token) {
    return { ...SWATCH_BASE, background: token, border: "1px solid var(--divider)" };
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

  // Marks with no dedicated background token (e.g. priority glyphs, which are ink drawn on the
  // strip, not a distinct fill) — a neutral rack swatch so the glyph itself carries the meaning.
  return {
    ...SWATCH_BASE,
    background: "var(--surface-secondary)",
    border: "1px solid var(--divider)",
  };
}

/**
 * Icon colour for a mark's swatch. Strip-tint swatches are light paper stock — the glyph must be
 * drawn in strip ink (`--text-primary-strip`), not the rack's light text colour, or it disappears
 * against the light background.
 */
function glyphColor(mark: Mark): string | undefined {
  return mark.id in TOKEN_BY_MARK_ID && mark.id.startsWith("strip-")
    ? "var(--text-primary-strip)"
    : undefined;
}

/**
 * Resolves a mark's `glyph` (a `lucide-react` export name, per the locked icon
 * decision — 01-UI-SPEC.md "Design System") to the real icon component.
 * Uniform 2px stroke, no fill — never a unicode/emoji stand-in.
 */
type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;

function Glyph({ name, color }: { name: string; color?: string }) {
  const Icon = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Icon) return null;
  return <Icon size={14} strokeWidth={2} color={color} />;
}

/**
 * The always-reachable legend surface (01-UI-SPEC.md "Selected Direction" —
 * "no mark may exist that the legend does not define"). Renders the MARKS
 * registry grouped by channel; it derives the surface from the registry
 * rather than restating it, so a mark that is not in the registry cannot
 * appear here and a mark that is in the registry cannot be missing.
 */
export function Legend() {
  const channels = Array.from(new Set(MARKS.map((m) => m.channel)));

  return (
    <section
      className="legend"
      aria-label="Legend"
      style={{
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        padding: "var(--space-lg)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-lg)",
      }}
    >
      {channels.map((channel) => (
        <div key={channel} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <h2 className="type-heading" style={{ margin: 0 }}>
            {CHANNEL_LABELS[channel]}
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            {MARKS.filter((m) => m.channel === channel).map((mark) => (
              <li
                key={mark.id}
                style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}
              >
                <span aria-hidden="true" style={swatchStyle(mark)}>
                  <Glyph name={mark.glyph} color={glyphColor(mark)} />
                </span>
                <span className="type-body" style={{ minWidth: 160 }}>
                  {mark.label}
                </span>
                <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                  {mark.meaning}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default Legend;
