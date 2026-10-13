/**
 * Finish-review three-3 (plan 11-22): added and removed rows differed by colour alone. `review.css`
 * has always said change is carried by "the row tint and the +/- gutter"; no sign was drawn, which
 * fails WCAG 1.4.1 (use of colour). This pins the sign as TEXT in the gutter cell, measured in a
 * real engine and run under both colour schemes (`test:browser` and `test:browser:dark`).
 *
 * The sign has to be legible in its own right, so it is held to the 4.5:1 text floor against the
 * gutter paint it sits on - the gutter tint is the paint nearest a glyph that no earlier test measured.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../App.css";
import { FileDiff } from "../../FileDiff";
import { PATCHES } from "./review-fixture";
import { paintedContrast } from "./paint";

const AA_NORMAL = 4.5;

function renderDiff() {
  return render(
    <div className="rack-ground">
      <FileDiff patch={PATCHES["src/lib.rs"]} path="src/lib.rs" />
    </div>,
  );
}

const gutters = (kind: "insert" | "delete" | "normal") =>
  Array.from(document.querySelectorAll<HTMLElement>(`.review-diff td.diff-gutter-${kind}`));

describe("diff sign column (three-3)", () => {
  it("draws + on an added row and - on a removed row, as text in the gutter", () => {
    renderDiff();
    const inserts = gutters("insert").map((g) => g.textContent ?? "");
    const deletes = gutters("delete").map((g) => g.textContent ?? "");
    // Unified view: an added row has an empty old-side cell and a numbered new-side cell.
    expect(inserts.filter((t) => t.includes("+")).length, "no added-row gutter carries a +").toBeGreaterThan(0);
    expect(deletes.filter((t) => t.includes("-")).length, "no removed-row gutter carries a -").toBeGreaterThan(0);
    expect(inserts.some((t) => t.includes("-")), "an added row carries a -").toBe(false);
    expect(deletes.some((t) => t.includes("+")), "a removed row carries a +").toBe(false);
  });

  it("draws neither sign on a context row", () => {
    renderDiff();
    const normal = gutters("normal");
    expect(normal.length, "no context rows rendered").toBeGreaterThan(0);
    for (const g of normal) expect(g.textContent ?? "", "a context row carries a sign").not.toMatch(/[+-]/);
  });

  it("keeps the line number beside the sign, so the gutter still names a line", () => {
    renderDiff();
    const withSign = gutters("insert").find((g) => (g.textContent ?? "").includes("+"));
    expect(withSign?.textContent ?? "").toMatch(/\d/);
  });

  it("paints the sign at 4.5:1 against its own gutter in the active scheme", () => {
    renderDiff();
    const signs = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-sign"));
    expect(signs.length, "no sign element rendered").toBeGreaterThan(0);
    const low = signs.map((s) => paintedContrast(s)).filter((c) => c < AA_NORMAL);
    expect(low, "sign below AA").toEqual([]);
  });
});
