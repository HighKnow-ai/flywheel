/**
 * 08.1 plan 17: what the session group's finish pass pins at the source level. jsdom cannot paint;
 * `browser/session-group.browser.test.tsx` measures the same decisions in WebKit.
 *
 *  1. No brand-filled and no destructive-filled actions (owner decision 2026-10-08). Ink on the brand fill was
 *     3.05:1 light, 4.42:1 dark; ink on the destructive fill was 2.95 / 2.86:1.
 *  2. The one lead per section wears a 2px ink edge; the destructive gate's lead is drawn in the destructive
 *     TEXT role. Nothing is a side stripe.
 *  3. The launch sheet draws scrim, shadow and edge from the per-mode overlay roles, never a literal.
 *  4. No focus ring driven by a prop (the roving-tabindex defect class), and no text area left on the
 *     engine's own focus ring.
 *  5. The running-session pulse keeps its reduced-motion branch, and no raw-HTML path reaches agent output.
 */
import { describe, expect, it } from "vitest";
import css from "../session.css?raw";
import surface from "../SessionSurface.tsx?raw";
import feedRow from "../FeedRow.tsx?raw";
import card from "../PermissionRequestCard.tsx?raw";
import rawLog from "../RawLogView.tsx?raw";
import launchSheet from "../../launch-sheet/LaunchSheet.tsx?raw";

const SOURCES = { surface, feedRow, card, rawLog, launchSheet };

/** Comment lines out, so a doc comment may still say what the old code did. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

/** One rule's declaration block, by its exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]":()-]/g, "\\$&").replace(/=/g, "=");
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is not declared in session.css`).toBeTruthy();
  return match![2];
}

describe("the session group draws its actions, it does not fill them", () => {
  it.each(Object.entries(SOURCES))("%s paints no brand fill, no destructive fill and no on-accent ink", (_name, source) => {
    expect(code(source)).not.toMatch(/--accent-nontext|--text-on-accent|--destructive-strip/);
    expect(code(source)).not.toMatch(/background:\s*"var\(--(destructive|accent)/);
  });

  it("session.css never fills a control with the brand or a destructive role", () => {
    expect(code(css)).not.toMatch(/\n\s*background:[^;]*var\(--(accent-nontext|destructive)/);
  });

  it(".session-action is a transparent ground with ink text", () => {
    const body = rule(".session-action");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*var\(--text-primary-rack\)/);
  });

  it("the lead is a 2px ink edge with the pixel given back by padding, and is not brand", () => {
    const body = rule(".session-action.session-action-lead");
    expect(body).toMatch(/border:\s*2px solid var\(--selection-rule\)/);
    expect(body).toMatch(/padding:\s*calc\(var\(--space-xs\) - 1px\) calc\(var\(--space-md\) - 1px\)/);
    expect(body).not.toMatch(/accent|background/);
  });

  it("the destructive lead is the destructive TEXT role on an edge, never a fill", () => {
    const body = rule(".session-action.session-action-lead.session-action-destructive");
    expect(body).toMatch(/border-color:\s*var\(--destructive-text-rack\)/);
    expect(body).toMatch(/color:\s*var\(--destructive-text-rack\)/);
    expect(body).not.toMatch(/background/);
  });

  it("hover on a drawn action is the quiet inset wash, never the divider wash that sat under coloured text", () => {
    const body = rule(".session-action:hover:not(:disabled)");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/box-shadow:\s*inset 0 0 0 1000px var\(--row-surface-hover\)/);
    expect(body).not.toMatch(/--divider/);
    expect(rule(".session-action.session-action-destructive:hover:not(:disabled)")).toMatch(/border-color:\s*var\(--destructive-text-rack\)/);
  });

  it("every header action, the composer's Send and the sheet's buttons are control-edged actions", () => {
    const drawn = (source: string) => (source.match(/control-edge session-action/g) ?? []).length;
    // Return, Advance, View raw, Stop, Discard, Review changes, Send.
    expect(drawn(surface)).toBe(7);
    // Deny and Allow-just-this-once (destructive), Allow (routine). The routine Deny is a text action.
    expect(drawn(card)).toBe(3);
    // Cancel and the submit.
    expect(drawn(launchSheet)).toBe(2);
  });

  it("the destructive gate keeps its emphasis reversed: Deny leads on the destructive card, Allow on the routine one", () => {
    const lead = (source: string) => (source.match(/session-action-lead/g) ?? []).length;
    expect(lead(card)).toBe(2); // one per variant, exactly one visible at a time
    expect(card).toMatch(/session-action-lead session-action-destructive[^"]*"\s*>\s*Deny/);
    expect(card).toMatch(/session-action session-action-lead type-body"\s*>\s*Allow\s*</);
  });
});

describe("08.1 group-four finish-review closure", () => {
  it("while a run is live the lead is Stop, never Discard (an authoring run's lead is Advance)", () => {
    expect(surface).toMatch(/onClick=\{handleStop\}[\s\S]{0,200}session-action type-label\$\{stage \? "" : " session-action-lead"\}/);
    const discard = surface.match(/onClick=\{handleDiscard\}[\s\S]{0,260}?>/)![0];
    expect(discard).toContain('className="control-edge session-action type-label"');
    expect(discard).not.toContain("session-action-lead");
  });

  it("the routine card ranks Allow (a box and a lead), Deny (text and a caret), then the permanent grant below a gutter", () => {
    expect(code(card)).toMatch(/className="session-text-action type-body"\s*>\s*Deny/);
    expect(code(card)).toContain('className="session-grant"');
    expect(rule(".session-grant")).toMatch(/border-top:\s*1px solid var\(--divider\)/);
    // The scope is carried by weight on the words, not by an underline.
    expect(code(card)).toContain("<strong>for this project</strong>");
    expect(code(card)).not.toMatch(/textDecoration/);
    expect(rule(".session-text-action strong")).toMatch(/font-weight:\s*600/);
    // A text action has no box and no fill.
    const body = rule(".session-text-action");
    expect(body).toMatch(/border:\s*none/);
    expect(body).toMatch(/background:\s*transparent/);
  });

  it("the placeholder is a role, in the stylesheet (the engine's own was an unowned grey)", () => {
    expect(rule(".session-field::placeholder")).toMatch(/color:\s*var\(--text-placeholder\)/);
  });

  it("the live row carries a caret that keeps the reduced-motion rule, and the meter never prints a bare dash", () => {
    expect(code(feedRow)).toMatch(/prefersReducedMotion\(\) \? "feed-caret" : "feed-caret agent-pulse"/);
    expect(code(surface)).not.toMatch(/"—"/);
  });

  it("the transcript sits on the floor and the page ends on a bar", () => {
    expect(code(surface)).toMatch(/marginTop: "auto", flexShrink: 0/);
    expect(code(surface)).toContain('className="session-floor type-label"');
    expect(rule(".session-floor")).toMatch(/border-top:\s*1px solid var\(--divider\)/);
  });
});

describe("the permission card is bounded by an edge, not a stripe or a fill", () => {
  it("has no side stripe in the component or the stylesheet", () => {
    expect(code(card)).not.toMatch(/borderLeft|border-left/);
    expect(code(css)).not.toMatch(/border-(left|right)\s*:/);
  });

  it(".session-card draws the 3:1 control role, and the destructive card swaps it for the destructive text role", () => {
    expect(rule(".session-card")).toMatch(/border:\s*1px solid var\(--border-control\)/);
    expect(rule(".session-card")).not.toMatch(/background/);
    expect(rule(".session-card.session-card-destructive")).toMatch(/border-color:\s*var\(--destructive-text-rack\)/);
  });

  it("keeps the consequence sentence and the glyph pairing", () => {
    expect(card).toContain("Destructive action — needs your OK");
    expect(card).toContain('"destructive-gate"');
  });
});

describe("the launch sheet is a sheet on the per-mode overlay roles", () => {
  it("holds no literal colour, scrim or shadow", () => {
    expect(code(launchSheet)).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}/);
    expect(code(launchSheet)).not.toMatch(/boxShadow/);
  });

  it(".launch-scrim is --scrim, and .launch-sheet is --shadow-sheet with the sheet tier's edge", () => {
    expect(rule(".launch-scrim")).toMatch(/background:\s*var\(--scrim\)/);
    const sheet = rule(".launch-sheet");
    expect(sheet).toMatch(/box-shadow:\s*var\(--shadow-sheet\)/);
    expect(sheet).toMatch(/border:\s*1px solid var\(--border-sheet\)/);
    expect(sheet).toMatch(/border-radius:\s*var\(--radius-chrome\)/);
    expect(launchSheet).toContain('className="launch-scrim"');
    expect(launchSheet).toContain('className="launch-sheet"');
  });

  it("an overlay never interpolates opacity on mount", () => {
    expect(css).not.toMatch(/animation|transition|opacity/);
  });

  it("draws its fields and its modes from the control role, never the hairline", () => {
    // The hairline stays where it separates regions (header, footer, the compaction marker) and in the
    // loading skeleton's bars; a control's own edge is never drawn from it.
    const hairlines = code(launchSheet).split("\n").filter((line) => line.includes("--divider"));
    expect(hairlines.length).toBeGreaterThan(0);
    for (const line of hairlines) expect(line, line).toMatch(/border(Top|Bottom):|background:/);
    expect(launchSheet.match(/control-edge session-field launch-field/g)?.length).toBe(2);
    expect(launchSheet).toContain("control-edge launch-mode");
  });

  it("the chosen mode is told by an ink edge, a 2px ink foot rule and weight, not by the brand, a surface shift or a 2px box", () => {
    const body = rule('.launch-mode[aria-checked="true"]');
    expect(body).toMatch(/border-color:\s*var\(--selection-rule\)/);
    expect(body).toMatch(/box-shadow:\s*inset 0 -2px 0 var\(--selection-rule\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).not.toMatch(/accent|row-surface/);
  });
});

describe("focus rings", () => {
  it("no component drives a ring from a prop", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      expect(code(source), name).not.toMatch(/outline\s*:/);
    }
  });

  it("a text area takes the ink ring, not the engine's own", () => {
    const body = rule(".session-field:focus-visible");
    expect(body).toMatch(/outline:\s*2px solid var\(--selection-rule\)/);
  });
});

describe("the two things this group must not lose", () => {
  it("SessionSurface still omits the pulse class under reduced motion rather than freezing the glyph", () => {
    expect(surface).toMatch(/const pulsing = status === "running" && !prefersReducedMotion\(\)/);
    expect(feedRow).toMatch(/export function prefersReducedMotion/);
    expect(surface).toMatch(/className=\{pulsing \? "agent-pulse" : undefined\}/);
  });

  it("no raw-HTML rendering path reaches agent output", () => {
    // Built from parts so this file does not itself trip the plan's negative grep over the directory.
    const rawHtml = new RegExp("dangerously" + "SetInner" + "HTML|inner" + "HTML");
    for (const [name, source] of Object.entries(SOURCES)) {
      expect(code(source), name).not.toMatch(rawHtml);
    }
  });
});
