/**
 * UAT item 1 (REVW-01, 08-VALIDATION.md "Manual-Only Verifications" row 1), measured instead of
 * eyeballed: "added/removed tints do not fight token colour; text stays legible" at review width.
 *
 * Why this could not live in the jsdom suite: every diff row tint in `review.css` is a
 * `color-mix(in srgb, <token> N%, …)`, and jsdom neither resolves `color-mix` nor composites alpha
 * — `getComputedStyle(row).backgroundColor` there is the literal source text. The ratio is only
 * knowable in an engine that paints. WebKit is the engine the macOS shell ships (WKWebView).
 *
 * What a human still has to judge afterwards is narrow and named at the bottom of this file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { page } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

// The factory spreads the REAL module before overriding: native ESM in the browser refuses a
// partial mock outright ("Importing binding name 'x' is not found") the moment any module in the
// import graph imports an export the factory omitted, where vite-node's loader tolerates it. The
// structural guarantee survives the spread — every export the review tree uses is overridden
// below, and any un-overridden write would reach the real `invoke` and throw for want of
// `window.__TAURI_INTERNALS__`, which is still a hard failure rather than a silent success.
vi.mock("../../../adapters/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./review-fixture")).adapterModule(),
}));

import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { ReviewSurface } from "../../ReviewSurface";
import { effectiveBackground, effectiveForeground, paintedContrast, toHex } from "./paint";
import { PATCHES, resetSpies, resetState } from "./review-fixture";

/** WCAG 2.2 AA for normal-size text. The diff renders at 12px, which is not "large text" under
 * 1.4.3 by any reading, so 4.5:1 is the applicable floor — not 3:1. */
const AA_NORMAL = 4.5;

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div className="rack-ground" style={{ height: "900px" }}>
        <ReviewSurface scope="task" itemId="t1" label="FLY-9 Add push retry" onBack={() => {}} />
      </div>
    </QueryClientProvider>,
  );
}

/** Every token span that actually paints text (leaves only — a nested token's colour is the
 * leaf's, and measuring a parent would double-count its children's glyphs). */
function tokenLeaves(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".review-diff [class*='token']")).filter(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0,
  );
}

/** `react-diff-view` puts the change kind on the code CELL (`diff-code diff-code-insert`), not on
 * the `<tr>` (which is a bare `diff-line`) — so the tint behind a token is the cell's. */
function rowKind(el: Element): "insert" | "delete" | "normal" | "other" {
  const cell = el.closest("td.diff-code, .diff-code");
  const classes = cell?.className ?? "";
  if (/diff-code-insert/.test(classes)) return "insert";
  if (/diff-code-delete/.test(classes)) return "delete";
  if (/diff-code-normal/.test(classes)) return "normal";
  return "other";
}

/** Every leaf whose painted contrast against its own row is under the AA floor, named for the failure message. */
function belowAA(leaves: HTMLElement[]): string[] {
  return leaves
    .filter((leaf) => rowKind(leaf) !== "other" && paintedContrast(leaf) < AA_NORMAL)
    .map((leaf) => `${rowKind(leaf)} = ${paintedContrast(leaf).toFixed(2)}:1`);
}

/** The token role, as `review.css` assigns colour: its non-structural class names. */
function tokenRoles(el: Element): string[] {
  return Array.from(el.classList).filter((c) => c !== "token");
}

async function expandEveryFile() {
  const nav = await screen.findByRole("navigation", { name: "Changed files" });
  const fileRows = () => Array.from(nav.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"));
  await waitFor(() => expect(fileRows().length).toBe(Object.keys(PATCHES).length));
  for (const row of fileRows()) row.click();
  await waitFor(() => expect(tokenLeaves().length).toBeGreaterThan(40), { timeout: 10_000 });
}

beforeEach(() => {
  resetState();
  resetSpies();
});

describe("UAT 1 — diff legibility at review width", () => {
  it("paints no syntax hue: every token leaf is the code's own ink, so change is the row tint and the gutter alone", async () => {
    renderSurface();
    await expandEveryFile();

    // Tokens are still produced (the tokenizer is unchanged), so the spans exist; what 08.1's group-three
    // closure removed is their colour. Status hues mean "added" / "removed" and nothing else.
    const leaves = tokenLeaves();
    expect(leaves.length, "no tokenized diff rows were measured - the fixture or the tokenizer is broken").toBeGreaterThan(40);
    const recoloured = leaves
      .filter((leaf) => toHex(effectiveForeground(leaf)) !== toHex(effectiveForeground(leaf.closest("td.diff-code") as Element)))
      .map((leaf) => `${tokenRoles(leaf).join(".")} paints ${toHex(effectiveForeground(leaf))} on ${rowKind(leaf)}`);
    expect(recoloured, "token spans repaint the code").toEqual([]);

    // And the code itself stays at AA on every row paint it can sit on.
    expect(belowAA(leaves), "code below AA on its painted row").toEqual([]);
  });

  it("keeps every token leaf at 4.5:1 and in the code's own ink while a row is gutter-selected (D-REV-06)", async () => {
    renderSurface();
    await expandEveryFile();

    // One real gutter click per change kind, the way a reader selects: the selected row stacks the
    // selection layer over the row tint, which is the state no other test measured.
    for (const kind of ["delete", "insert"] as const) {
      const gutter = document.querySelector<HTMLElement>(`.review-diff td.diff-gutter-${kind}`);
      expect(gutter, `no ${kind} gutter rendered`).toBeTruthy();
      gutter!.click();
      await waitFor(() =>
        expect(document.querySelectorAll(".review-diff td.diff-code-selected").length, `${kind} gutter click selected nothing`).toBeGreaterThan(0),
      );

      const leaves = tokenLeaves();
      const selected = leaves.filter((leaf) => leaf.closest("td.diff-code-selected"));
      // Not vacuous: the measured set must include tokens that actually sit on the selected row.
      expect(selected.length, `no token leaf sits on the ${kind}-selected row`).toBeGreaterThan(0);
      const measured = selected.map((leaf) => paintedContrast(leaf).toFixed(2));
      // eslint-disable-next-line no-console
      console.log(`D-REV-06 ${kind}-selected row, ${selected.length} token leaves, painted contrast: min ${Math.min(...measured.map(Number))}:1`);

      expect(belowAA(leaves), `code below AA with a ${kind} row selected`).toEqual([]);
      expect(
        leaves
          .filter((leaf) => toHex(effectiveForeground(leaf)) !== toHex(effectiveForeground(leaf.closest("td.diff-code") as Element)))
          .map((leaf) => tokenRoles(leaf).join(".")),
        `a token repaints the code with a ${kind} row selected`,
      ).toEqual([]);
    }
  });

  it("does not wrap code: a long line scrolls the pane sideways and no token breaks mid-word", async () => {
    renderSurface();
    await expandEveryFile();
    const cells = Array.from(document.querySelectorAll<HTMLElement>(".review-diff td.diff-code"));
    expect(cells.length).toBeGreaterThan(10);
    for (const cell of cells) {
      const style = getComputedStyle(cell);
      expect(style.whiteSpace, "code must not wrap").toBe("pre");
      expect(style.wordBreak, "code must not break mid-token").toBe("normal");
    }
    // The table is at least the pane wide and grows past it for a long line, so the pane (overflow: auto) scrolls.
    const table = document.querySelector<HTMLElement>("table.review-diff")!;
    expect(table.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(table).tableLayout).toBe("auto");
  });

  it("does not mark a word-level edit: the 2px weight is the selection rule's, and the row tint carries the change (G-08-1)", async () => {
    renderSurface();
    await expandEveryFile();

    const insertEdits = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-code-insert .diff-code-edit"));
    const deleteEdits = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-code-delete .diff-code-edit"));
    // Not vacuous: a fixture that stopped producing word-level edits must fail here, not pass.
    expect(insertEdits.length, "the fixture produced no added-row edit spans").toBeGreaterThan(0);
    expect(deleteEdits.length, "the fixture produced no removed-row edit spans").toBeGreaterThan(0);

    // An edit span adds no paint and no mark of its own: what resolves behind it is its row's tint, byte for byte.
    const rowPaint = (edit: HTMLElement) => toHex(effectiveBackground(edit.closest("td.diff-code") as Element));
    const stacked = [...insertEdits, ...deleteEdits]
      .filter((edit) => toHex(effectiveBackground(edit)) !== rowPaint(edit))
      .map((edit) => `${edit.closest("td.diff-code")?.className} edit paints ${toHex(effectiveBackground(edit))} over row ${rowPaint(edit)}`);
    expect(stacked, "edit spans paint their own background behind glyphs").toEqual([]);
    for (const edit of [...insertEdits, ...deleteEdits]) {
      expect(getComputedStyle(edit).boxShadow, "an edit span carries an underline").toBe("none");
    }
  });

  it("paints an added and a removed row as distinguishable from an unchanged one", async () => {
    renderSurface();
    await expandEveryFile();

    const sample = (kind: string) => {
      const row = document.querySelector(`.review-diff .diff-${kind}`) ?? document.querySelector(`.review-diff tr.${kind}`);
      expect(row, `no ${kind} row rendered`).toBeTruthy();
      return toHex(effectiveBackground(row as Element));
    };
    const insert = sample("code-insert");
    const del = sample("code-delete");
    const normal = sample("code-normal");

    // eslint-disable-next-line no-console
    console.log(`UAT-1 row tints: insert=${insert} delete=${del} normal=${normal}`);
    expect(insert, "the added tint resolves to the same paint as an unchanged row").not.toBe(normal);
    expect(del, "the removed tint resolves to the same paint as an unchanged row").not.toBe(normal);
    expect(insert, "added and removed rows paint identically").not.toBe(del);
  });

  it("records the surface as a screenshot at review width for the one judgement left to a human", async () => {
    renderSurface();
    await expandEveryFile();
    // The only remaining human question is aesthetic ("does this tint fight the token colour for
    // ME"), and it is answerable from an image rather than from driving the app.
    await page.screenshot({ path: "../../../../../../target/uat-screenshots/uat-01-review-diff-1440x900.png" });
  });
});

describe("08.1-16 - code and gutter text against every row paint, measured in the engine", () => {
  const KINDS = ["insert", "delete", "normal"] as const;

  it("keeps the code at 4.5:1 on added, removed, unchanged and selected rows, and the gutter text on its tint", () => {
    const host = document.createElement("div");
    host.className = "rack-ground";
    const row = (kind: string, extra: string) =>
      `<tr class="diff-line"><td class="diff-gutter diff-gutter-${kind}${extra}">12</td>` +
      `<td class="diff-code diff-code-${kind}${extra}"><span>x</span></td></tr>`;
    host.innerHTML =
      `<table class="diff review-diff diff-unified"><tbody>` +
      KINDS.flatMap((kind) => [row(kind, ""), row(kind, " diff-code-selected diff-gutter-selected")]).join("") +
      `</tbody></table>`;
    document.body.append(host);

    const measured: string[] = [];
    const failures: string[] = [];
    for (const tr of host.querySelectorAll("tr")) {
      const gutter = tr.querySelector("td.diff-gutter") as HTMLElement;
      const label = `${/diff-gutter-(insert|delete|normal)/.exec(gutter.className)![1]}${/selected/.test(gutter.className) ? "+selected" : ""}`;
      const gutterRatio = paintedContrast(gutter);
      const code = tr.querySelector("span") as HTMLElement;
      const codeRatio = paintedContrast(code);
      measured.push(`  ${label.padEnd(16)} gutter ${gutterRatio.toFixed(2)}:1 on ${toHex(effectiveBackground(gutter))}, code ${codeRatio.toFixed(2)}:1`);
      if (gutterRatio < AA_NORMAL) failures.push(`${label} gutter = ${gutterRatio.toFixed(2)}:1`);
      if (codeRatio < AA_NORMAL) failures.push(`${label} code = ${codeRatio.toFixed(2)}:1`);
    }
    // eslint-disable-next-line no-console
    console.log(`08.1-16 painted contrast, 6 row paints:\n${measured.sort().join("\n")}`);
    host.remove();
    expect(failures, "code or gutter text below AA on its painted row").toEqual([]);
  });
});

describe("UAT 1 — the light/dark half of the item's wording", () => {
  it("records that the product ships ONE token set in two modes, each read by its own run", () => {
    // The UAT item asks for "light AND dark themes". Until Phase 8.1 plan 07 the product shipped
    // one palette and this test recorded that fact, failing the day a second theme appeared so
    // the item would be re-opened deliberately. Plan 07 is that day: `styles/tokens.css` now
    // carries a dark colour-scheme block. The re-run the old wording demanded is the diff
    // legibility test above, executed once per config — `test:browser` reads it in light,
    // `test:browser:dark` in dark. What this keeps recording is the shape: exactly one
    // scheme-switching rule, and no `[data-theme]` second mechanism for a mode to drift through.
    const sheets = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText);
      } catch {
        return [];
      }
    });
    expect(sheets.filter((text) => /prefers-color-scheme/.test(text)), "exactly one dark block").toHaveLength(1);
    expect(sheets.filter((text) => /\[data-theme/.test(text)), "a second theme mechanism exists").toEqual([]);
  });
});
