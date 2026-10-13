/**
 * Phase 8.1 plan 07 (D-19: "the table is not the proof"), measured in a real engine.
 *
 * `theme/__tests__/contrast.test.ts` proves the token VALUES clear their floors, by arithmetic.
 * This proves what WebKit actually paints for a real `BoardRow` after cascade, inheritance and
 * any blending: the colour of each piece of text against the colour painted behind it.
 *
 * One file, two invocations. The colour scheme comes from the config, not from this file:
 *   npm --prefix packages/desktop run test:browser        (light)
 *   npm --prefix packages/desktop run test:browser:dark   (dark)
 * The first test asserts which world was actually loaded, so a config that silently failed to
 * switch scheme cannot make both runs measure the same mode and pass twice.
 *
 * `BoardRow` has no progress element yet (the epic roster plans own it), so the progress fill is
 * measured as the token it will be painted with, on the ground it will sit on. That is the real
 * `--accent-nontext` resolved by the real engine, not a real bar.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { BoardRow } from "../../BoardRow";
import type { BoardItem } from "../../useBoardQuery";
import { contrastRatio } from "../../../theme/contrast";
import { PALETTES, type Mode } from "../../../theme/tokens";
import { effectiveBackground, paintedContrast, parseColor, toHex } from "../../../review/__tests__/browser/paint";

const AA_TEXT = 4.5;
const NON_TEXT = 3;

const mode: Mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const ITEM: BoardItem = {
  id: "t1",
  kind: "task",
  key: "FLY-9",
  title: "Add push retry",
  status: "in_progress",
  rank: "a0",
  priority: 2,
  epicId: null,
  estimate: 2,
  criteriaChecked: 1,
  criteriaTotal: 3,
};

function renderRow() {
  render(
    <div className="rack-ground" style={{ width: 1000, padding: 16 }} data-testid="ground">
      <div style={{ height: 40 }}>
        <BoardRow
          item={ITEM}
          setSize={1}
          posInSet={1}
          blocked
          needsDecision
          changeFlag={{ ahead: 3, dirty: true }}
        />
      </div>
      {/* The progress fill's token on the ground it sits on: see the file header. */}
      <div data-testid="fill" style={{ marginTop: 8, height: 6, width: 120, background: "var(--accent-nontext)" }} />
    </div>,
  );
  return screen.getByRole("listitem");
}

describe(`board row legibility, painted, ${mode} scheme`, () => {
  it("loaded the world this run claims to measure", () => {
    expect(mode, "the config asked for one scheme and the engine landed in the other").toBe(
      import.meta.env.VITE_EXPECT_SCHEME ?? "light",
    );
    const declared = getComputedStyle(document.documentElement).getPropertyValue("--surface-dominant").trim();
    expect(declared, "the engine resolved a different ground than the typed mirror for this mode").toBe(
      PALETTES[mode].surfaceDominant,
    );
  });

  it("paints the key, the title and the muted metadata at AA against what is behind them", () => {
    const row = renderRow();
    const measured: Array<[string, HTMLElement]> = [
      ["key", screen.getByText("FLY-9")],
      ["title", screen.getByText("Add push retry")],
      ["criteria count (muted)", screen.getByText("1/3")],
      ["epic pill (muted)", screen.getByText("No epic")],
      ["blocked pill (data channel)", row.querySelector<HTMLElement>('[aria-label^="Blocked"]')!],
      ["needs-decision pill (data channel)", row.querySelector<HTMLElement>('[aria-label^="Needs Decision"]')!],
    ];
    for (const [name, el] of measured) {
      expect(el, `${name} was not rendered`).toBeTruthy();
      expect(paintedContrast(el), `${mode}: ${name} painted below AA`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("paints every text role at AA on the SELECTED surface too (08.1-14 finish review, finding 4)", () => {
    // The selected band is as strong as AA lets it be; this is the painted half of that claim: the
    // engine's composite of the selected wash, behind the weakest text roles on the row.
    render(
      <div className="rack-ground" style={{ width: 1000, padding: 16 }}>
        <div style={{ height: 40 }}>
          <BoardRow item={ITEM} setSize={1} posInSet={1} blocked needsDecision ciFailed selected focused changeFlag={{ ahead: 3, dirty: true }} />
        </div>
      </div>,
    );
    const row = screen.getByRole("listitem");
    expect(toHex(effectiveBackground(row)), `${mode}: the selected row should paint the selected surface`).toBe(
      PALETTES[mode].rowSurfaceSelected,
    );
    const measured: Array<[string, HTMLElement]> = [
      ["key", screen.getByText("FLY-9")],
      ["criteria count (muted)", screen.getByText("1/3")],
      ["blocked pill", row.querySelector<HTMLElement>('[aria-label^="Blocked"]')!],
      ["needs-decision pill", row.querySelector<HTMLElement>('[aria-label^="Needs Decision"]')!],
      ["CI-failed pill", row.querySelector<HTMLElement>('[aria-label^="CI failed"]')!],
      ["commits-ahead count (brand text)", row.querySelector<HTMLElement>('[role="img"][aria-label$="commits ahead"]')!],
    ];
    for (const [name, el] of measured) {
      expect(el, `${name} was not rendered`).toBeTruthy();
      expect(paintedContrast(el), `${mode}: ${name} painted below AA on the selected surface`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("paints the progress fill and the change annotation's glyph at the non-text floor", () => {
    const row = renderRow();
    const ground = screen.getByTestId("ground");
    const fill = screen.getByTestId("fill");
    const fillRatio = contrastRatio(toHex(effectiveBackground(fill)), toHex(effectiveBackground(ground)));
    expect(fillRatio, `${mode}: progress fill against its ground`).toBeGreaterThanOrEqual(NON_TEXT);

    const ahead = row.querySelector<HTMLElement>('[role="img"][aria-label$="commits ahead"]');
    const dirty = row.querySelector<HTMLElement>('[role="img"][aria-label="uncommitted changes"]');
    expect(ahead, "the commits-ahead annotation was not rendered").toBeTruthy();
    expect(dirty, "the uncommitted-changes mark was not rendered").toBeTruthy();
    expect(paintedContrast(ahead!), `${mode}: commits-ahead glyph`).toBeGreaterThanOrEqual(NON_TEXT);
    expect(paintedContrast(dirty!), `${mode}: uncommitted-changes glyph`).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe(`selection rule, painted, ${mode} scheme (A-06)`, () => {
  /** What the engine actually resolved for one row state: the rule's colour and the surface under it. */
  function paintedRule(props: { selected?: boolean; focused?: boolean }) {
    const { unmount } = render(
      <div className="rack-ground" style={{ width: 1000 }}>
        <div style={{ height: 32 }}>
          <BoardRow item={ITEM} {...props} />
        </div>
      </div>,
    );
    const row = screen.getByRole("listitem");
    const style = getComputedStyle(row);
    const painted = {
      rule: toHex(parseColor(style.borderLeftColor)),
      width: style.borderLeftWidth,
      surface: toHex(effectiveBackground(row)),
    };
    unmount();
    return painted;
  }

  it("shows a different, visible rule for idle, selected-unfocused and selected-focused, all 2px", () => {
    const idle = paintedRule({});
    const unfocused = paintedRule({ selected: true });
    const focused = paintedRule({ selected: true, focused: true });

    for (const [name, state] of [["idle", idle], ["unfocused", unfocused], ["focused", focused]] as const) {
      expect(state.width, `${mode}: ${name} rule width, so a row changing state never reflows`).toBe("2px");
    }
    // The surfaces alone cannot carry this (1.011 / 1.014 apart): the RULES must, as painted.
    expect(contrastRatio(focused.rule, unfocused.rule), `${mode}: focused vs unfocused rule`).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrastRatio(focused.rule, focused.surface), `${mode}: focused rule on its surface`).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrastRatio(unfocused.rule, unfocused.surface), `${mode}: unfocused rule on its surface`).toBeGreaterThanOrEqual(NON_TEXT);
    // Idle's rule is the same transparent 2px, so it paints as the ground itself.
    expect(idle.rule).not.toBe(focused.rule);
    expect(idle.rule).not.toBe(unfocused.rule);
  });
});


describe(`focus ring, painted, ${mode} scheme (08.1-14 finish review)`, () => {
  /** The selected row with the list holding focus: the props a mouse click AND a key press both produce. */
  function renderFocusedRow() {
    render(
      <div className="rack-ground" style={{ width: 1000 }}>
        <div style={{ height: 32 }}>
          <BoardRow item={ITEM} selected focused />
        </div>
      </div>,
    );
    return screen.getByRole("listitem");
  }

  it("a pointer click paints no ring; keyboard focus paints the ring inset past the 2px rule", async () => {
    const row = renderFocusedRow();

    await userEvent.click(row);
    expect(document.activeElement, "the click should have focused the row").toBe(row);
    // The regression this pins: the ring was driven by the `focused` prop, so a click left a blue
    // rectangle on the row for good and the brand became the cursor (D-12).
    expect(getComputedStyle(row).outlineStyle, `${mode}: a mouse click must not paint the focus ring`).toBe("none");

    row.blur();
    await userEvent.keyboard("{ArrowDown}");
    row.focus();
    const keyboard = getComputedStyle(row);
    expect(keyboard.outlineStyle, `${mode}: keyboard focus must paint the ring`).toBe("solid");
    expect(keyboard.outlineWidth).toBe("2px");
    expect(keyboard.outlineOffset, "the ring clears the 2px selection rule").toBe("-4px");
    expect(toHex(parseColor(keyboard.outlineColor))).toBe(PALETTES[mode].focusRing);
    // Both marks show at once: the ink rule is not painted over.
    expect(toHex(parseColor(keyboard.borderLeftColor))).toBe(PALETTES[mode].selectionRule);
  });
});
