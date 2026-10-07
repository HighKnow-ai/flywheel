/**
 * UAT item 2 (REVW-02/REVW-03, 08-VALIDATION.md "Manual-Only Verifications" row 2): "the rail
 * stays usable over a long diff; scroll position survives each check; the roll-up counts match
 * what the board shows."
 *
 * Two of those three are measurements, and neither is measurable in jsdom: it implements no layout,
 * so `scrollHeight` is 0 for every element and nothing can scroll (`src/test/setup.ts` says so at
 * length, and installs a fake `scrollTo` precisely because of it). A scroll-preservation assertion
 * written there would pass without the property holding — the vacuity class this file exists to
 * avoid. The third (does the rail *feel* usable) is a judgement, and what is left of it for a human
 * is named at the bottom.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { page } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// See legibility.browser.test.tsx for why the real module is spread before the override.
vi.mock("../../../adapters/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./review-fixture")).adapterModule(),
}));

import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { ReviewSurface } from "../../ReviewSurface";
import { resetSpies, resetState, state } from "./review-fixture";

function renderSurface(scope: "task" | "epic" = "task") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div className="rack-ground" style={{ height: "900px" }}>
        <ReviewSurface
          scope={scope}
          itemId={scope === "task" ? "t1" : "e1"}
          label={scope === "task" ? "FLY-9 Add push retry" : "FLY-7 Review and merge inside Flywheel"}
          fromTask={scope === "epic" ? { itemId: "t1", label: "FLY-9 Add push retry" } : undefined}
          onBack={() => {}}
        />
      </div>
    </QueryClientProvider>,
  );
}

/** The third pane — the one the patches render into. Found by its real overflow behaviour rather
 * than by a test id, so it cannot drift away from the pane the reader actually scrolls. */
function diffPane(): HTMLElement {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("div")).filter(
    (el) => el.scrollHeight > el.clientHeight + 50 && el.querySelector(".review-diff"),
  );
  expect(candidates.length, "no overflowing pane contains the diff — the fixture patch is too short").toBeGreaterThan(0);
  return candidates[candidates.length - 1];
}

async function openLongFile() {
  const nav = await screen.findByRole("navigation", { name: "Changed files" });
  const row = await waitFor(() => {
    const found = Array.from(nav.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find((b) =>
      (b.textContent ?? "").includes("src/long.ts"),
    );
    expect(found, "the long fixture file is not in the list").toBeTruthy();
    return found as HTMLButtonElement;
  });
  row.click();
  await waitFor(() => expect(document.querySelectorAll(".review-diff .diff-gutter").length).toBeGreaterThan(50), {
    timeout: 10_000,
  });
}

beforeEach(() => {
  resetState();
  resetSpies();
});

describe("UAT 2 — the rail over a long diff", () => {
  it("leaves the reader's scroll position untouched when a criterion is checked against a selection", async () => {
    state.longFile = true;
    renderSurface();
    await openLongFile();

    const pane = diffPane();
    pane.scrollTop = Math.floor(pane.scrollHeight / 2);
    await waitFor(() => expect(pane.scrollTop).toBeGreaterThan(100));
    const before = pane.scrollTop;

    // Select evidence the way a reader does — a gutter click well down the diff — then check the
    // criterion from the rail, which is the write that re-fetches criteria state and re-renders
    // both panes. That re-render is what could scroll the diff back to the top.
    const gutters = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-gutter"));
    gutters[Math.floor(gutters.length / 2)].click();
    await screen.findByText(/^Selected: src\/long\.ts:/);

    const check = await screen.findByRole("button", {
      name: 'Check "The query key carries the scope and the item id" against the selected lines',
    });
    check.click();

    await screen.findByText(/criteria checked without evidence|criterion checked without evidence|^Evidence/);
    await waitFor(() => expect(document.querySelectorAll(".review-anchor-widget").length).toBeGreaterThan(0));

    expect(pane.scrollTop, "checking a criterion moved the diff the reader was looking at").toBe(before);
  });

  it("leaves the reader's scroll position untouched when a criterion is checked with no selection", async () => {
    state.longFile = true;
    renderSurface();
    await openLongFile();

    const pane = diffPane();
    pane.scrollTop = Math.floor(pane.scrollHeight / 3);
    await waitFor(() => expect(pane.scrollTop).toBeGreaterThan(100));
    const before = pane.scrollTop;

    const check = await screen.findByRole("button", {
      name: 'Check "The summary reports a checked ratio" against the selected lines',
    });
    check.click();
    await waitFor(() => expect(document.body.textContent).toMatch(/checked without evidence/));

    expect(pane.scrollTop).toBe(before);
  });

  it("scrolls the rail independently of the diff, so a long diff never pushes the criteria away", async () => {
    state.longFile = true;
    renderSurface();
    await openLongFile();

    const rail = (await screen.findByRole("complementary", { name: "Criteria rail" })).parentElement as HTMLElement;
    const pane = diffPane();
    expect(rail, "the rail has no scroll container of its own").toBeTruthy();
    expect(rail.contains(pane), "the rail and the diff share one scroll container").toBe(false);

    pane.scrollTop = pane.scrollHeight;
    await waitFor(() => expect(pane.scrollTop).toBeGreaterThan(100));
    expect(rail.scrollTop, "scrolling the diff scrolled the rail with it").toBe(0);

    // At review width the three panes fit without the page itself scrolling sideways.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  });
});

describe("UAT 2 — the epic roll-up beneath the epic's own criteria", () => {
  it("renders one row per task with counts taken from the board, beneath the epic's own criteria", async () => {
    renderSurface("epic");

    const rollup = await screen.findByRole("region", { name: "Task criteria roll-up" });
    const rows = Array.from(rollup.querySelectorAll("li"));
    expect(rows.length).toBe(state.rollup.length);

    // Compared against the board's own numbers, not against hand-typed strings: the fixture array
    // IS the board here, so a renderer that formatted the wrong field would fail.
    rows.forEach((row, i) => {
      const t = state.rollup[i];
      const text = (row.textContent ?? "").replace(/\s+/g, " ");
      expect(text).toContain(t.key);
      expect(text).toContain(t.title);
      expect(text).toContain(t.total > 0 ? `${t.checked}/${t.total} criteria checked` : "no criteria");
      if (t.withoutEvidence > 0) expect(text).toContain(`${t.withoutEvidence} without evidence`);
      else expect(text).not.toContain("without evidence");
    });

    // "Beneath the epic's own criteria" is a layout claim, so it is read off real geometry.
    const own = await screen.findByRole("region", { name: "Acceptance criteria" });
    expect(own.getBoundingClientRect().top).toBeLessThan(rollup.getBoundingClientRect().top);
  });

  it("records the epic-scope rail as a screenshot for the one ergonomic judgement left to a human", async () => {
    state.longFile = true;
    renderSurface("epic");
    await screen.findByRole("region", { name: "Task criteria roll-up" });
    await page.screenshot({ path: "../../../../../../.planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/uat-02-epic-rail-1440x900.png" });
  });
});
