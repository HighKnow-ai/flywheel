/**
 * The expensive gate's capture step for surface group three (08.1 plan 16, D-24): the review surface
 * with a real diff and the real criteria rail, and the merge confirm sheet open, as the REAL components
 * paint them in WebKit at the surface's real layout width (1440x900: the three panes use clamp()), in
 * whichever colour scheme the config selected. Written into `.impeccable/review/` beside the approved
 * comp as `review-group-built-<scheme>-{surface,merge-sheet,merge-conflict}-1440x900`.
 *
 * Content: THRE-58 is the real board's own task; its three criteria are the ones 08.1-03 seeded. The
 * diff of `README.md` is the real uncommitted change in THRE-58's worktree; the diff of
 * `CriteriaRail.tsx` is the comp's FIXTURE (a real commit of this repository standing in for a task with
 * something worth reviewing, because THRE-58 has no commits ahead today). The conflicted precheck is a
 * FIXTURE too. Each is labelled on the page.
 *
 * It pins what jsdom cannot: that no action paints the brand, that every control draws a 3:1 boundary,
 * that a click leaves no ring, and that the sheet's scrim and shadow resolve to the per-mode roles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page, userEvent } from "vitest/browser";
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";

vi.mock("../../../adapters/tauri", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const fixture = await import("./review-fixture");
  const comp = (await import(
    "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json"
  )).default as unknown as {
    criteria: { id: string; task_key: string; statement: string; verification_hint: string | null; checked: number; rank: string }[];
    diffs: { real: { patch: string }[]; fixture: { path: string; patch: string } };
  };
  const criteria = comp.criteria
    .filter((c) => c.task_key === "THRE-58")
    .map((c) => ({
      id: c.id, parentType: "task", parentId: "t1", statement: c.statement, verificationHint: c.verification_hint,
      checked: c.checked === 1, rank: c.rank, revision: 1, revisionOf: null, supersededAt: null,
    }));
  const states = criteria.map((criterion) => ({ criterion, anchor: null, staleness: null }));
  const FIXTURE_PATH = comp.diffs.fixture.path;
  const patches: Record<string, string> = { "README.md": comp.diffs.real[0].patch + "\n", [FIXTURE_PATH]: comp.diffs.fixture.patch.trimStart() };
  const base = fixture.adapterModule();
  return {
    ...real,
    ...base,
    invokeCommand: (command: string, ...rest: unknown[]) =>
      command === "criterion_list"
        ? Promise.resolve(criteria)
        : command === "review_criteria_state"
          ? Promise.resolve(states)
          : (base.invokeCommand as (c: string, ...r: unknown[]) => Promise<unknown>)(command, ...rest),
    reviewCriteriaState: () => Promise.resolve(states),
    reviewFiles: () =>
      Promise.resolve({
        target: { state: "resolved", postMerge: false, base: "flywheel/thre-8-integration", head: "flywheel/thre-58-wire-up-the-focus-trap-41", projectId: "p1", epicId: "e1", taskId: "t1" },
        files: [
          { path: "README.md", oldPath: null, status: "M", added: 2, removed: 0, binary: false },
          { path: FIXTURE_PATH, oldPath: null, status: "M", added: 49, removed: 6, binary: false },
        ],
      }),
    reviewFilePatch: (_s: unknown, _i: unknown, path: string) => Promise.resolve(patches[path] ?? null),
  };
});

import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import reviewCss from "../../review.css?raw";
import diffViewCss from "react-diff-view/style/index.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { ReviewSurface } from "../../ReviewSurface";
import { CONFLICTED_PRECHECK, resetSpies, resetState, state } from "./review-fixture";
import { LIGHT, DARK } from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";
import { effectiveBackground, toHex as paintHex } from "./paint";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const PALETTE = scheme === "dark" ? DARK : LIGHT;
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
const FIXTURE_PATH = (data.diffs.fixture as { path: string }).path;

const toHex = (computed: string): string => {
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
};
const ratio = (a: string, b: string) => contrastRatio(a, b);

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div className="rack-ground" style={{ height: 900, width: 1440 }}>
        <p className="type-label" style={{ position: "absolute", right: 24, bottom: 8, margin: 0, color: "var(--text-muted-rack)", zIndex: 1 }}>
          FIXTURE diff: a real commit of this repository stands in for a task with something to review.
        </p>
        <ReviewSurface scope="task" itemId="t1" label="THRE-58 Wire up the focus trap #41" onBack={() => {}} />
      </div>
    </QueryClientProvider>,
  );
}

async function writeHtml(name: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}, ${scheme}</title>` +
    `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}\n${diffViewCss}\n${reviewCss}</style></head><body>${document.body.innerHTML}</body></html>`;
  await commands.writeFile(`${OUT_FROM_ROOT}/${name}-${scheme}.html`, html);
}

function expectDrawn(button: HTMLElement, name: string, ground: string) {
  const style = getComputedStyle(button);
  expect(style.backgroundColor, `${name} must not be filled`).toBe("rgba(0, 0, 0, 0)");
  expect(ratio(toHex(style.borderTopColor), ground), `${name}'s edge`).toBeGreaterThanOrEqual(3);
  expect(ratio(toHex(style.color), ground), `${name}'s text`).toBeGreaterThanOrEqual(4.5);
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

beforeEach(() => {
  resetState();
  resetSpies();
});

describe(`review group, built, ${scheme} scheme`, () => {
  it("the surface: a drawn Merge, a ringless click, the A-06 selected file, a ruled selected line", async () => {
    mount();
    const merge = await screen.findByRole("button", { name: "Merge" });
    expectDrawn(merge, "Merge", PALETTE.surfaceDominant);

    const nav = await screen.findByRole("navigation", { name: "Changed files" });
    const fileButton = await waitFor(() => {
      const b = Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent?.includes(FIXTURE_PATH));
      expect(b).toBeTruthy();
      return b!;
    });
    await userEvent.click(fileButton);
    // Mouse: the click leaves no ring (`:focus-visible` only) and the row is selected as a board row is.
    expect(getComputedStyle(fileButton).outlineStyle, "a click must not leave a ring on a file row").toBe("none");
    expect(fileButton.getAttribute("data-focused")).toBe("true");
    // Selection is motion-confirmed (120ms): read the settled paint, not the first frame.
    await waitFor(() => {
      expect(toHex(getComputedStyle(fileButton).borderLeftColor), "the 2px ink rule").toBe(PALETTE.selectionRule);
      expect(toHex(getComputedStyle(fileButton).backgroundColor), "the surface shift").toBe(PALETTE.rowSurfaceSelected);
    });

    await waitFor(() => expect(document.querySelectorAll(".review-diff .diff-gutter-insert").length).toBeGreaterThan(5), { timeout: 10_000 });
    const gutters = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-gutter-insert"));
    await userEvent.click(gutters[3]);
    await userEvent.click(gutters[4]);
    const selected = await waitFor(() => {
      const g = document.querySelector<HTMLElement>(".review-diff .diff-gutter-selected");
      expect(g).toBeTruthy();
      return g!;
    });
    expect(getComputedStyle(selected).boxShadow, "a selected line carries the 2px ink rule").toContain(
      scheme === "dark" ? "rgb(237, 237, 237)" : "rgb(31, 35, 40)",
    );
    const selectedCode = document.querySelector<HTMLElement>(".review-diff .diff-code-selected")!;
    expect(paintHex(effectiveBackground(selectedCode)), "not the library's pale yellow").toBe(PALETTE.rowSurfaceSelected);

    // The rail beside the diff: the three real criteria, unchecked, none ringed by the click above.
    const rail = screen.getByRole("complementary", { name: "Criteria rail" });
    await waitFor(() => expect(rail.textContent).toContain("Tab and Shift+Tab cycle within the dialog"));
    expect(rail.querySelectorAll("[role=listitem], li").length).toBeGreaterThanOrEqual(3);

    await settle();
    await page.screenshot({ path: `${OUT}/review-group-built-${scheme}-surface-1440x900.png` });
    await writeHtml("review-group-built");
  });

  it("the merge sheet: the per-mode scrim and shadow, a drawn confirm, a --border-control edge", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge sheet" });
    const scrim = dialog.parentElement as HTMLElement;
    expect(getComputedStyle(scrim).backgroundColor, "the scrim resolves from --scrim").toBe(
      scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)",
    );
    const style = getComputedStyle(dialog);
    expect(style.boxShadow, "the sheet shadow resolves from --shadow-sheet").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.7)" : "rgba(31, 35, 40, 0.24)");
    expect(ratio(toHex(style.borderTopColor), PALETTE.surfaceSecondary), "the sheet's edge is the control boundary").toBeGreaterThanOrEqual(3);
    const confirm = await waitFor(() => {
      const b = dialog.querySelector<HTMLButtonElement>("button:not([disabled]).review-action");
      expect(b).toBeTruthy();
      return b!;
    });
    expectDrawn(confirm, "the confirm Merge", PALETTE.surfaceSecondary);
    expect(dialog.textContent).toMatch(/3 commits, 5 files, into FLY-7's integration branch\./);

    await settle();
    await page.screenshot({ path: `${OUT}/review-group-built-${scheme}-merge-sheet-1440x900.png` });
    await writeHtml("review-group-merge-sheet");
  });

  it("the merge sheet with a predicted conflict: destructive text beside a glyph, no fill", async () => {
    state.precheck = CONFLICTED_PRECHECK; // FIXTURE: the real board has no conflicting task today.
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge sheet" });
    const warn = await waitFor(() => {
      const w = dialog.querySelector<HTMLElement>(".review-warn");
      expect(w).toBeTruthy();
      return w!;
    });
    expect(warn.querySelector("svg"), "the destructive line is paired with a glyph").toBeTruthy();
    expect(toHex(getComputedStyle(warn).color)).toBe(PALETTE.destructiveTextRack);
    expect(getComputedStyle(warn).backgroundColor, "destructive is text, never a fill").toBe("rgba(0, 0, 0, 0)");
    expect(ratio(PALETTE.destructiveTextRack, PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);

    await settle();
    await page.screenshot({ path: `${OUT}/review-group-built-${scheme}-merge-conflict-1440x900.png` });
    await writeHtml("review-group-merge-conflict");
  });
});
