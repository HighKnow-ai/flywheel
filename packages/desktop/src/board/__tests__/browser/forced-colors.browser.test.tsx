/**
 * Phase 14 plan 08 (criterion 3, T-14-08-04): does every state stay readable when the system replaces the colours?
 *
 * Forced colors (a Windows contrast theme) discards every colour in `styles/tokens.css` and paints text, glyphs and
 * borders in a small system palette. The five state classes then ink identically, so the glyph, the word and any
 * boundary are the whole signal. jsdom cannot model that, so this runs in an engine. Which engine matters: see
 * `vitest.browser.forced-colors.config.ts` (Chromium, because forced colors is a Windows mechanism and the Windows
 * shell is WebView2; WebKit reports the media query and substitutes nothing).
 *
 * One file, two kinds of invocation, like `motion.browser.test.tsx`. Forced colors comes from the config:
 *   npm --prefix packages/desktop run test:browser                 (ordinary arm: the substitution must NOT happen)
 *   npm --prefix packages/desktop run test:browser:forced-colors   (forced arm: it must)
 * The first test asserts which world the engine landed in, and the second asserts the substitution itself rather than
 * only the media query, so a config that silently failed to switch the mode cannot pass by measuring the ordinary world.
 *
 * THE FALLBACK IS A MEASURED NO-OP. Nothing in the stylesheet handles `forced-colors`, and this file shows nothing needs
 * to: under the substitution every state keeps its glyph (14x14 and drawn), its word or its accessible name, and the edge
 * variant keeps a 1px border on all four sides (the engine forces the border colour, it does not drop the border). The
 * wash is discarded (the background is forced to the canvas, so it paints nothing); that is asserted below rather than
 * hidden, and is acceptable only because a wash is never the sole carrier of a state (14-DIRECTION.md, CVD thresholds).
 * The five inks collapse to one colour, and the pairs are told apart by glyph and word, asserted for all ten.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { StateBadge, type StateBadgeVariant } from "../../../legend/StateBadge";
import { BoardRow } from "../../BoardRow";
import type { BoardItem } from "../../useBoardQuery";
import { PALETTES, type Mode, type Palette } from "../../../theme/tokens";

const expectForced = import.meta.env.VITE_EXPECT_FORCED_COLORS === "active";
const mode: Mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** One state per class, with the word the component prints for it. */
const STATES = [
  { state: "blocked", cls: "NeedsYou", word: "Blocked" },
  { state: "running", cls: "Running", word: "Running" },
  { state: "failed", cls: "Failed", word: "Failed" },
  { state: "merged", cls: "Merged", word: "Merged" },
  { state: "completed", cls: "Quiet", word: "Completed" },
] as const;
const VARIANTS: StateBadgeVariant[] = ["text", "wash", "edge", "mark"];

/** The engine's own value of a system colour keyword, read the way the engine resolves it, not assumed to be black. */
function systemColour(keyword: "CanvasText" | "Canvas", property: "color" | "backgroundColor"): string {
  const probe = document.createElement("span");
  probe.style[property] = keyword;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe)[property];
  probe.remove();
  return value;
}

/** `#rrggbb` -> `rgb(r, g, b)`, the form `getComputedStyle` returns. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const glyphOf = (badge: HTMLElement): SVGElement => badge.querySelector("svg")!;
const tokenInk = (cls: string): string => rgb(PALETTES[mode][`state${cls}Text` as keyof Palette]);

function renderBadge(state: string, variant: StateBadgeVariant = "text", hideLabel = false): HTMLElement {
  render(
    <div className="rack-ground" style={{ padding: 8 }}>
      <StateBadge state={state} variant={variant} hideLabel={hideLabel} />
    </div>,
  );
  return document.querySelector<HTMLElement>("[data-state-class]")!;
}

describe(`state badge under ${expectForced ? "forced colors" : "ordinary colours"}`, () => {
  it("loaded the world this run claims to measure", () => {
    expect(
      window.matchMedia("(forced-colors: active)").matches,
      "the config asked for one forced-colors setting and the engine landed in the other",
    ).toBe(expectForced);
  });

  it("the system substitution itself happened (or, in the ordinary arm, did not): the media query alone is not enough", () => {
    const canvasText = systemColour("CanvasText", "color");
    for (const { state, cls } of STATES) {
      const ink = getComputedStyle(renderBadge(state)).color;
      if (expectForced) {
        expect(ink, `${state}: forced colors left the token ink in place; the engine is not substituting`).toBe(canvasText);
        expect(ink, `${state}: the ink is still the ${cls} token`).not.toBe(tokenInk(cls));
      } else {
        expect(ink, `${state}: the ordinary arm must paint the ${cls} token`).toBe(tokenInk(cls));
      }
      document.body.replaceChildren();
    }
  });

  it.each(STATES)("$state keeps a drawn glyph in every variant", ({ state }) => {
    for (const variant of VARIANTS) {
      const badge = renderBadge(state, variant);
      const box = glyphOf(badge).getBoundingClientRect();
      expect(box.width, `${state}/${variant}: the glyph has no width`).toBeGreaterThan(0);
      expect(box.height, `${state}/${variant}: the glyph has no height`).toBeGreaterThan(0);
      document.body.replaceChildren();
    }
  });

  it.each(STATES)("$state keeps its word, and its accessible name when the word is hidden", ({ state, word }) => {
    const shown = renderBadge(state);
    expect(shown.textContent, `${state}: the drawn word is gone`).toContain(word);
    document.body.replaceChildren();
    renderBadge(state, "mark", true);
    expect(screen.getByRole("img", { name: word }), `${state}: the accessible name is gone`).toBeTruthy();
    document.body.replaceChildren();
  });

  it.each(STATES)("$state edge variant keeps a visible boundary: 1px, solid, on all four sides", ({ state }) => {
    const style = getComputedStyle(renderBadge(state, "edge"));
    const canvasText = systemColour("CanvasText", "color");
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      expect(style[`border${side}Width`], `${state}: border-${side.toLowerCase()} width`).toBe("1px");
      expect(style[`border${side}Style`], `${state}: border-${side.toLowerCase()} style`).toBe("solid");
    }
    if (expectForced) expect(style.borderTopColor, `${state}: the boundary is not in a system colour`).toBe(canvasText);
  });

  it("every pair of the five classes is told apart by glyph and by word, whatever the colours did", () => {
    const seen = STATES.map(({ state }) => {
      const badge = renderBadge(state);
      const entry = { state, word: badge.textContent ?? "", glyph: glyphOf(badge).innerHTML, ink: getComputedStyle(badge).color };
      document.body.replaceChildren();
      return entry;
    });
    let pairs = 0;
    for (let i = 0; i < seen.length; i += 1) {
      for (let j = i + 1; j < seen.length; j += 1) {
        pairs += 1;
        expect(seen[i].word, `${seen[i].state} and ${seen[j].state} print the same word`).not.toBe(seen[j].word);
        expect(seen[i].glyph, `${seen[i].state} and ${seen[j].state} draw the same glyph`).not.toBe(seen[j].glyph);
      }
    }
    expect(pairs, "the pair set must not be empty or truncated").toBe(10);
    if (expectForced) {
      expect(new Set(seen.map((s) => s.ink)).size, "forced colors should have collapsed the five inks to one colour").toBe(1);
    }
  });

  it.runIf(expectForced)("the wash is discarded (painted as the canvas), so it is never the only carrier of a state", () => {
    const canvas = systemColour("Canvas", "backgroundColor");
    for (const { state } of STATES) {
      const badge = renderBadge(state, "wash");
      const background = getComputedStyle(badge).backgroundColor;
      expect([canvas, "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)"], `${state}: the wash painted ${background}`).toContain(background);
      expect(badge.textContent).not.toBe("");
      expect(glyphOf(badge).getBoundingClientRect().width).toBeGreaterThan(0);
      document.body.replaceChildren();
    }
  });
});

const ITEM: BoardItem = {
  id: "t1",
  kind: "task",
  key: "FLY-9",
  title: "Add push retry",
  status: "in_progress",
  rank: "a0",
  priority: 2,
  epicId: null,
  criteriaChecked: 1,
  criteriaTotal: 3,
};

// Follow-up recorded by plan 14-07 for 14-09: the needs-decision and CI-failed pills in BoardRow still spend
// `--destructive-strip`, not the state vocabulary. They are measured here so the rewire inherits the numbers; this
// plan does not move them.
describe(`board row state chips under ${expectForced ? "forced colors" : "ordinary colours"}`, () => {
  it.each(["Blocked", "Needs Decision", "CI failed"])("the %s chip keeps a glyph and a word", (label) => {
    render(
      <div className="rack-ground" style={{ width: 1000, padding: 16 }}>
        <div style={{ height: 40 }}>
          <BoardRow item={ITEM} setSize={1} posInSet={1} blocked needsDecision ciFailed />
        </div>
      </div>,
    );
    const chip = document.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
    expect(chip, `${label}: chip not rendered`).toBeTruthy();
    const glyph = chip!.querySelector("svg");
    expect(glyph, `${label}: no glyph`).toBeTruthy();
    expect(glyph!.getBoundingClientRect().width, `${label}: glyph has no width`).toBeGreaterThan(0);
    expect((chip!.textContent ?? "").trim() !== "" || chip!.getAttribute("aria-label"), `${label}: no word`).toBeTruthy();
  });
});
