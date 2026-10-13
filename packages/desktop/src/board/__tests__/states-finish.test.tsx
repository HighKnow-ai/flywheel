/**
 * 08.1 plan 19: what the states-and-confirms group's finish pass pins at the source level. jsdom cannot paint;
 * `browser/states-group.browser.test.tsx` measures the same decisions in WebKit. The group is the first-run
 * state, the unreachable project, the registration flow, and the delete, done-warning and orphan-recovery
 * confirmations.
 *
 *  1. No brand fill and no destructive fill, anywhere in the group (owner decision 2026-10-08; AA).
 *  2. A destructive action is the destructive TEXT role on an edge, icon-paired, never `--destructive-strip` as a fill.
 *  3. The two modal confirmations are on the DIALOG tier: the per-mode scrim, the dialog shadow and edge.
 *  4. No literal colour, scrim or shadow, and no scripted animation.
 *  5. The brand mark is still an image element (T-08.1-54) and the unreachable state still pairs glyph and word.
 *  6. The blocking modal still has no dismiss path.
 *
 * It reads the shipped stylesheet, not the DOM: jsdom stubs CSS, so a class name asserted on an element proves
 * nothing about the rule behind it (the lesson of the deleted `agent-pulse`, 08.1-17).
 */
import { describe, expect, it } from "vitest";
import css from "../../styles/states-and-confirms.css?raw";
import firstRun from "../FirstRun.tsx?raw";
import glyph from "../../assets/logo-glyph.svg?raw";
import unreachable from "../../projects/ProjectUnreachable.tsx?raw";
import register from "../../projects/RegisterProjectFlow.tsx?raw";
import deleteConfirm from "../DeleteConfirm.tsx?raw";
import doneWarning from "../DoneWarning.tsx?raw";
import orphan from "../../recovery/OrphanRecoveryModal.tsx?raw";

const SOURCES = { firstRun, unreachable, register, deleteConfirm, doneWarning, orphan };

/** Comment lines out, so a doc comment may still say what the old code did. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

/** One rule's declaration block, by its exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]":()>-]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is not declared in states-and-confirms.css`).toBeTruthy();
  return match![2];
}

describe("the group draws its actions, it does not fill them", () => {
  it.each(Object.entries(SOURCES))("%s paints no brand fill, no destructive fill and no on-accent ink", (_name, source) => {
    expect(code(source)).not.toMatch(/--accent-nontext|--text-on-accent|--destructive-strip/);
    expect(code(source)).not.toMatch(/background:\s*"var\(--(destructive|accent)/);
  });

  it("holds no literal colour, scrim or shadow, here or in any component of the group", () => {
    for (const [name, source] of Object.entries({ ...SOURCES, css })) {
      expect(code(source), name).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/);
    }
  });

  it("never fills anything with the brand or a destructive role, and never uses on-accent ink", () => {
    expect(code(css)).not.toMatch(/background[^;]*var\(--(accent|destructive|focus-ring)/);
    expect(code(css)).not.toMatch(/--text-on-accent|--destructive-strip/);
  });

  it("every drawn action is transparent with ink text and hovers on the quiet inset wash, not the divider", () => {
    for (const selector of [".state-action", ".confirm-action"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(/background:\s*transparent/);
      expect(body, selector).toMatch(/color:\s*var\(--text-primary-rack\)/);
      const hover = rule(`${selector}:hover:not(:disabled)`);
      expect(hover, selector).toMatch(/box-shadow:\s*inset 0 0 0 1000px var\(--row-surface-hover\)/);
      expect(hover, selector).not.toMatch(/--divider/);
    }
  });

  it("a state's one lead is a 2px ink edge with the pixel given back by padding, and is not brand", () => {
    const body = rule(".state-action.state-action-lead");
    expect(body).toMatch(/border:\s*2px solid var\(--selection-rule\)/);
    expect(body).toMatch(/padding:\s*calc\(var\(--space-sm\) - 1px\) calc\(var\(--space-lg\) - 1px\)/);
    expect(body).not.toMatch(/accent|background/);
    for (const [name, source] of Object.entries({ firstRun, unreachable })) {
      expect(source, name).toContain("control-edge state-action state-action-lead");
    }
  });

  it("the confirm-the-key field draws a control boundary and wears the ink ring, not the brand", () => {
    expect(firstRun).toContain("control-edge state-field");
    const ring = rule(".state-field:focus-visible");
    expect(ring).toMatch(/outline:\s*2px solid var\(--selection-rule\)/);
    expect(ring).not.toContain("--focus-ring");
  });

  it("no focus ring is driven by a prop in any component of the group (the roving-ring defect class)", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      if (name === "doneWarning") continue; // outline: "none" on a non-interactive, programmatically focused container is not a ring
      expect(code(source), name).not.toMatch(/outline/);
    }
  });
});

describe("a destructive action is the destructive text role on an edge, icon-paired", () => {
  it(".confirm-action-destructive is edge and text in the asserted role, never a fill", () => {
    const body = rule(".confirm-action.confirm-action-destructive");
    expect(body).toMatch(/border:\s*2px solid var\(--destructive-text-rack\)/);
    expect(body).toMatch(/color:\s*var\(--destructive-text-rack\)/);
    expect(body).not.toMatch(/background/);
    const hover = rule(".confirm-action.confirm-action-destructive:hover:not(:disabled)");
    expect(hover).toMatch(/border-color:\s*var\(--destructive-text-rack\)/);
  });

  it("Delete and Kill All carry the destructive class and an icon beside the word", () => {
    expect(deleteConfirm).toMatch(/confirm-action-destructive[\s\S]{0,400}<Trash2\b/);
    expect(orphan).toMatch(/confirm-action-destructive[\s\S]{0,600}<OctagonX\b/);
  });

  it("the unreachable state has no eyebrow above its heading (craft floor line 27: no kicker, no brief earns it back)", () => {
    // The marker kept its job where it is a data channel: the project's own rail entry, glyph and word.
    expect(code(unreachable)).not.toMatch(/TriangleAlert|state-flag/);
    expect(code(unreachable)).not.toMatch(/>\s*Unreachable\s*</);
    expect(code(css)).not.toContain(".state-flag");
    // The heading is the first element of the surface (a JSX comment may sit before it).
    expect(code(unreachable)).toMatch(/className="project-unreachable state-surface">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<h1/);
  });

  it("DoneWarning names the task, says how many are unchecked in words, and is anchored to its row", () => {
    expect(code(doneWarning)).toContain("criteria unchecked. Mark Done anyway?");
    expect(code(doneWarning)).toMatch(/\{total - checked\} of \{total\} criteria unchecked/);
    expect(code(doneWarning)).not.toMatch(/\{checked\}\/\{total\}/);
    expect(code(doneWarning)).toMatch(/itemKey \? `\$\{itemKey\} · ` : ""/);
    expect(code(doneWarning)).toMatch(/anchorRect\.bottom \+ 4/);
  });
});

describe("the two modal confirmations are on the dialog tier", () => {
  it("the scrim is the per-mode role at full value, over a dialog with the dialog shadow and edge", () => {
    expect(rule(".confirm-scrim")).toMatch(/background:\s*var\(--scrim\)/);
    expect(rule(".confirm-scrim")).not.toMatch(/opacity|animation|transition/);
    const dialog = rule(".confirm-dialog");
    expect(dialog).toMatch(/box-shadow:\s*var\(--shadow-dialog\)/);
    expect(dialog).toMatch(/border:\s*1px solid var\(--border-dialog\)/);
    expect(dialog).toMatch(/border-radius:\s*var\(--radius-chrome\)/);
    expect(dialog).not.toMatch(/--shadow-(popover|sheet)|--border-(popover|sheet)/);
  });

  it.each([
    ["DeleteConfirm", deleteConfirm],
    ["OrphanRecoveryModal", orphan],
  ])("%s draws the scrim and the dialog from the classes, with no inline background, shadow or border", (_name, source) => {
    expect(source).toContain('className="confirm-scrim"');
    expect(source).toMatch(/className="[^"]*confirm-dialog\b/);
    expect(code(source)).not.toMatch(/boxShadow|background:|border:\s*"1px solid var\(--divider\)"/);
  });

  it("DoneWarning stays on the popover tier, with no scrim, since D-08 warns and never blocks", () => {
    expect(code(doneWarning)).toMatch(/boxShadow: "var\(--shadow-popover\)"/);
    expect(code(doneWarning)).toMatch(/border: "1px solid var\(--border-popover\)"/);
    expect(code(doneWarning)).not.toMatch(/--scrim/);
  });
});

describe("nothing in the group animates, and the blocking layer still blocks", () => {
  it("has no scripted animation and no CSS animation or transition on a confirmation", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      expect(code(source), name).not.toMatch(/requestAnimationFrame|\.animate\(/);
    }
    expect(code(css)).not.toMatch(/@keyframes|animation:|transition:/);
  });

  it("OrphanRecoveryModal mounts no dismissable layer and binds no Escape", () => {
    expect(code(orphan)).not.toMatch(/DismissableLayer|onEscapeKeyDown|onPointerDownOutside|"Escape"|onKeyDown/);
  });

  it("DeleteConfirm still defaults Escape and an outside click to cancel, focuses Cancel and never Delete", () => {
    expect(code(deleteConfirm)).toMatch(/onEscapeKeyDown/);
    expect(code(deleteConfirm)).toMatch(/onPointerDownOutside=\{onCancel\}/);
    const buttons = code(deleteConfirm).match(/<button\b[\s\S]*?>/g) ?? [];
    const cancel = buttons.find((b) => /ref=\{cancelRef\}/.test(b))!;
    const del = buttons.find((b) => /confirm-action-destructive/.test(b))!;
    expect(cancel, "the Cancel button").toBeTruthy();
    expect(cancel).toMatch(/\bautoFocus\b/);
    expect(del).not.toMatch(/autoFocus/);
  });
});

describe("the brand mark stays a reference, and the copy stays the contract's", () => {
  it("A-08(c): first-run draws the mark in ink, with no brand fill anywhere in its markup, style or glyph asset", () => {
    expect(code(firstRun)).not.toMatch(/--accent|--text-on-accent|logo\.svg/);
    const mark = css.match(/(^|\n)\.first-run-mark\s*\{([^}]*)\}/)?.[2] ?? "";
    expect(mark).toMatch(/background-color:\s*var\(--text-primary-rack\)/);
    expect(mark).not.toMatch(/accent|hsl\(|#[0-9a-f]{3,6}/i);
    // The glyph asset is the shape only: the rounded brand tile (a blue rect) is gone.
    expect(glyph).not.toMatch(/<rect|hsl\(|#3c64dd/i);
    expect(glyph).toContain("<path");
  });

  it("renders the mark by reference and never through raw HTML (T-08.1-54)", () => {
    expect(code(firstRun)).toMatch(/maskImage: `url\(\$\{glyphUrl\}\)`/);
    expect(code(firstRun)).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps the Copywriting Contract's strings verbatim", () => {
    expect(firstRun).toContain("No projects yet");
    expect(firstRun).toContain("Register Project…");
    expect(unreachable).toContain("Can&rsquo;t find this project");
    expect(unreachable).toContain("Locate Project…");
    expect(unreachable).toContain("Nothing was scanned or guessed automatically.");
    expect(deleteConfirm).toContain("will be permanently removed. This can't be");
    expect(orphan).toContain("Flywheel found ${count} agent process");
  });
});
