/**
 * 08.1 plan 16: what the review group's finish pass pins, at the source level (jsdom cannot paint;
 * `browser/review-group.browser.test.tsx` measures the same decisions in WebKit).
 *
 *  1. No brand-filled actions (owner decision 2026-10-08): Merge, Open request and the two sheets'
 *     confirm buttons are drawn with a control edge on their own surface. Ink on the brand fill was
 *     3.05:1 light, 4.42:1 dark.
 *  2. No destructive FILL (08.1-15 found 2.95 / 2.86:1): destructive is the text role beside a glyph.
 *  3. Both sheets draw scrim, shadow and edge from the per-mode overlay roles, never a literal.
 *  4. No focus ring driven by a prop (the roving-tabindex defect class): rings are `:focus-visible`.
 */
import { describe, expect, it } from "vitest";
import css from "../review.css?raw";
import reviewSurface from "../ReviewSurface.tsx?raw";
import mergeSheet from "../MergeConfirmSheet.tsx?raw";
import requestSheet from "../EpicRequestSheet.tsx?raw";
import fileDiff from "../FileDiff.tsx?raw";
import criteriaRail from "../CriteriaRail.tsx?raw";
import criteriaList from "../../item-detail/AcceptanceCriteriaList.tsx?raw";

const SOURCES = { reviewSurface, mergeSheet, requestSheet, fileDiff, criteriaRail };

/** Comment lines out, so a doc comment may still say what the old code did. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

/** One rule's declaration block, by its exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]"=]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is not declared in review.css`).toBeTruthy();
  return match![2];
}

describe("the review group draws its actions, it does not fill them", () => {
  it.each(Object.entries(SOURCES))("%s paints no brand fill and no destructive fill", (_name, source) => {
    expect(code(source)).not.toMatch(/--accent-nontext|--text-on-accent/);
    expect(code(source)).not.toMatch(/background:\s*"var\(--(destructive|accent)/);
  });

  it("review.css never fills a control with the brand or a destructive role", () => {
    // The diff's `--diff-*-background-color` tints are a data channel (D-11); a `background:` is a control's.
    expect(code(css)).not.toMatch(/\n\s*background:[^;]*var\(--(accent-nontext|destructive)/);
  });

  it(".review-action is a transparent ground with ink text, set apart by weight", () => {
    const body = rule(".review-action");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*var\(--text-primary-rack\)/);
    expect(body).toMatch(/font-weight:\s*600/);
  });

  it("Merge, Open request and both confirm buttons carry the control edge and .review-action", () => {
    const drawn = (source: string) => (source.match(/control-edge review-action/g) ?? []).length;
    expect(drawn(reviewSurface), "the header's Merge").toBe(1);
    expect(drawn(mergeSheet), "the merge sheet's confirm").toBe(1);
    expect(drawn(requestSheet), "the request bar's and the request sheet's confirm").toBe(2);
  });

  it("a destructive line is the destructive text role beside a glyph, not a fill", () => {
    expect(rule(".review-warn")).toMatch(/color:\s*var\(--destructive-text-rack\)/);
    expect(code(mergeSheet)).toContain("review-warn");
    expect(code(mergeSheet)).toContain("TriangleAlert");
  });
});

describe("08.1 group-three finish-review closure: what was removed stays removed", () => {
  it("the diff carries no syntax colouring: review.css declares no .token rule", () => {
    expect(code(css)).not.toMatch(/\.token\b/);
    expect(code(fileDiff)).not.toMatch(/accent-text-rack|success-text-rack|blocked-text-rack/);
  });

  it("a word-level edit is not underlined: no rule styles .diff-code-edit with a shadow", () => {
    expect(code(css)).not.toMatch(/diff-code-edit\s*\{/);
    expect(code(css)).not.toMatch(/inset 0 -2px/);
  });

  it("code does not wrap, and the diff scrolls sideways instead", () => {
    const body = rule(".review-diff .diff-code");
    expect(body).toMatch(/white-space:\s*pre\b/);
    expect(body).toMatch(/word-break:\s*normal/);
    expect(body).not.toMatch(/break-all|anywhere/);
    expect(rule(".review-diff")).toMatch(/width:\s*max-content/);
  });

  it("no action label and no status letter is the brand (D-12 lists four sites, none of them these)", () => {
    expect(code(reviewSurface)).not.toMatch(/accent-text-rack/);
    expect(code(mergeSheet)).not.toMatch(/accent-text-rack/);
    expect(code(fileDiff)).not.toMatch(/accent-text-rack/);
    expect(code(criteriaList)).not.toMatch(/"var\(--accent-text-rack\)"/);
    expect(code(reviewSurface)).toMatch(/color: "var\(--text-muted-rack\)", width: "1\.5ch"/);
  });

  it("the leading action wears the 2px ink edge (A-07), in the surface and in both sheets", () => {
    const lead = rule(".control-edge.review-action");
    expect(lead).toMatch(/border:\s*2px solid var\(--selection-rule\)/);
    expect(lead).toMatch(/padding:\s*calc\(var\(--space-xs\) - 1px\)/);
    // The scope toggles are not leads.
    expect(rule(".review-scope")).not.toMatch(/selection-rule/);
  });

  it("a conflict's files are mono hairline rows, not the engine's disc bullets", () => {
    expect(rule(".review-conflicts")).toMatch(/list-style:\s*none/);
    expect(rule(".review-conflicts > li")).toMatch(/border-bottom:\s*1px solid var\(--divider\)/);
    expect(code(mergeSheet)).not.toMatch(/paddingLeft: "var\(--space-lg\)"/);
    expect((code(mergeSheet).match(/className="review-conflicts"/g) ?? []).length).toBe(2);
  });

  it("with a conflict predicted the lead is an attempt, not a merge", () => {
    expect(code(mergeSheet)).toContain('"Attempt merge"');
  });
});

describe("the sheets draw their overlay from the per-mode roles", () => {
  it.each([
    ["merge sheet", mergeSheet],
    ["epic request sheet", requestSheet],
  ])("the %s has no literal colour, scrim or shadow", (_name, source) => {
    expect(code(source)).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}|boxShadow/);
    expect(code(source)).toContain('className="review-sheet-scrim"');
    expect(code(source)).toContain("review-sheet");
  });

  it("a wrapping sheet title is set at 1.4 leading on the locked size", () => {
    expect(rule(".review-sheet-title")).toMatch(/line-height:\s*1\.4/);
    expect(mergeSheet).toContain("review-sheet-title");
    expect(requestSheet).toContain("review-sheet-title");
  });

  it("the scrim is --scrim, the sheet is --shadow-sheet on a --border-sheet edge", () => {
    expect(rule(".review-sheet-scrim")).toMatch(/background:\s*var\(--scrim\)/);
    expect(rule(".review-sheet")).toMatch(/box-shadow:\s*var\(--shadow-sheet\)/);
    expect(rule(".review-sheet")).toMatch(/border:\s*1px solid var\(--border-sheet\)/);
  });
});

describe("no ring is driven by a prop", () => {
  it.each(Object.entries(SOURCES))("%s has no inline outline", (_name, source) => {
    expect(code(source)).not.toMatch(/outline\s*:/);
  });

  it("a changed-file row selects as a surface shift plus the 2px ink rule, square", () => {
    expect(rule(".review-file")).toMatch(/border-left:\s*2px solid transparent/);
    const selected = rule('.review-file[data-focused="true"]');
    expect(selected).toMatch(/background:\s*var\(--row-surface-selected\)/);
    expect(selected).toMatch(/border-left-color:\s*var\(--selection-rule\)/);
  });
});
