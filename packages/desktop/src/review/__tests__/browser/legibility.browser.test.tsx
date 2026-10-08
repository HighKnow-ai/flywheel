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
  it("keeps every syntax-token colour at AA against the row it is painted on, tinted or not", async () => {
    renderSurface();
    await expandEveryFile();

    // Grouped so a failure names the role and the row kind, not just "something is low".
    const worst = new Map<string, { ratio: number; fg: string; bg: string; sample: string }>();
    for (const leaf of tokenLeaves()) {
      const kind = rowKind(leaf);
      if (kind === "other") continue;
      const ratio = paintedContrast(leaf);
      for (const role of tokenRoles(leaf)) {
        const key = `${kind}/${role}`;
        const current = worst.get(key);
        if (!current || ratio < current.ratio) {
          worst.set(key, {
            ratio,
            fg: toHex(effectiveForeground(leaf)),
            bg: toHex(effectiveBackground(leaf)),
            sample: (leaf.textContent ?? "").trim().slice(0, 24),
          });
        }
      }
    }

    expect(worst.size, "no tokenized diff rows were measured — the fixture or the tokenizer is broken").toBeGreaterThan(5);
    // Printed on every run, pass or fail: the measurement is the artifact, not just the verdict.
    // eslint-disable-next-line no-console
    console.log(
      "UAT-1 painted contrast (role/row -> ratio):\n" +
        [...worst.entries()]
          .sort((a, b) => a[1].ratio - b[1].ratio)
          .map(([key, m]) => `  ${key.padEnd(34)} ${m.ratio.toFixed(2)}:1  on ${m.bg}  e.g. ${JSON.stringify(m.sample)}`)
          .join("\n"),
    );

    const failures = [...worst.entries()].filter(([, m]) => m.ratio < AA_NORMAL);
    expect(
      failures.map(([key, m]) => `${key} = ${m.ratio.toFixed(2)}:1 on ${m.bg}`),
      "token colours below AA on their painted row",
    ).toEqual([]);
  });

  it("marks a word-level edit without painting a second signal-hue layer behind its glyphs (G-08-1)", async () => {
    renderSurface();
    await expandEveryFile();

    const insertEdits = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-code-insert .diff-code-edit"));
    const deleteEdits = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-code-delete .diff-code-edit"));
    // Not vacuous: a fixture that stopped producing word-level edits must fail here, not pass.
    expect(insertEdits.length, "the fixture produced no added-row edit spans").toBeGreaterThan(0);
    expect(deleteEdits.length, "the fixture produced no removed-row edit spans").toBeGreaterThan(0);

    // An edit span adds no paint of its own: what resolves behind it is its row's tint, byte for byte.
    const rowPaint = (edit: HTMLElement) => toHex(effectiveBackground(edit.closest("td.diff-code") as Element));
    const stacked = [...insertEdits, ...deleteEdits]
      .filter((edit) => toHex(effectiveBackground(edit)) !== rowPaint(edit))
      .map((edit) => `${edit.closest("td.diff-code")?.className} edit paints ${toHex(effectiveBackground(edit))} over row ${rowPaint(edit)}`);
    expect(stacked, "edit spans paint their own background behind glyphs").toEqual([]);

    // The signal moved, it was not deleted: a mark that is present and differs by row kind.
    const insertMark = getComputedStyle(insertEdits[0]).boxShadow;
    const deleteMark = getComputedStyle(deleteEdits[0]).boxShadow;
    expect(insertMark, "added-row edit is unmarked").not.toBe("none");
    expect(deleteMark, "removed-row edit is unmarked").not.toBe("none");
    expect(insertMark, "added and removed edit marks are identical").not.toBe(deleteMark);
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
    await page.screenshot({ path: "../../../../../../.planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/uat-01-review-diff-1440x900.png" });
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
