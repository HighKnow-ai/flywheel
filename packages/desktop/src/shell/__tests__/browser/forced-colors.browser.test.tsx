/**
 * Do the andon lamps and StateBadge stay legible when the system replaces the colours (issue #135)?
 *
 * Forced colors (a Windows contrast theme, `forced-colors: active`) discards every colour in `styles/globals.css`
 * and paints text, glyphs, borders and grounds from a small system palette. The yellow, blue and red that tell a
 * lamp's tone apart are then gone, so what is left must carry it: the bulb glyph, the word, and ink that still
 * contrasts with its ground. jsdom cannot model the substitution, so this runs in an engine; which engine matters,
 * see `vitest.browser.forced-colors.config.ts` (Chromium: WebKit reports the media query and substitutes nothing).
 *
 * One file, two kinds of invocation. Forced colors comes from the config:
 *   npm --prefix packages/desktop run test:browser                 (ordinary arm: the substitution must NOT happen)
 *   npm --prefix packages/desktop run test:browser:forced-colors   (forced arm: it must)
 * The first two tests assert which world the engine landed in and that the substitution itself happened (not only
 * the media query), so a config that silently failed to switch the mode cannot pass by measuring the ordinary world.
 *
 * What it does NOT prove: a real Windows contrast theme's palette (Playwright's emulation uses Chromium's default
 * forced palette), or the packaged WebView2.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../styles/globals.css";
import "../../../App.css";
import type { FleetRowDto } from "../../../adapters/tauri";
import { StateBadge } from "../../../components/StateBadge";
import { Lamp, type LampData, type LampTone } from "../../AndonStrip";

vi.mock(import("../../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  storyStopped: () => Promise.resolve({ sessionId: "r-stopped", endingReason: "crash", endedAt: null }),
}));

const expectForced = import.meta.env.VITE_EXPECT_FORCED_COLORS === "active";

/** WCAG AA for body text: the floor every ink must keep against its own ground, forced or not. */
const AA = 4.5;

type Rgba = [number, number, number, number];

function parse(colour: string): Rgba {
  const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  expect(parts.length, `unparseable colour ${colour}`).toBeGreaterThanOrEqual(3);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function luminance([r, g, b]: Rgba): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The engine's own value of a system colour keyword, read the way the engine resolves it, not assumed. */
function systemColour(keyword: "Canvas" | "CanvasText"): Rgba {
  const probe = document.createElement("span");
  probe.style.color = keyword;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return parse(value);
}

/** The ground the element's text sits on: the nearest opaque background up the tree, else the canvas. */
function groundOf(element: Element): Rgba {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const ground = parse(getComputedStyle(node).backgroundColor);
    if (ground[3] >= 0.99) return ground;
  }
  return systemColour("Canvas");
}

function expectLegible(element: Element, what: string) {
  const ink = parse(getComputedStyle(element).color);
  const ratio = contrast(ink, groundOf(element));
  expect(ratio, `${what}: ink ${ink.join(",")} on its ground is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
}

function expectDrawnGlyph(root: Element, what: string) {
  const glyph = root.querySelector("svg");
  expect(glyph, `${what}: no glyph`).toBeTruthy();
  const box = glyph!.getBoundingClientRect();
  expect(box.width > 0 && box.height > 0, `${what}: the glyph is not drawn`).toBe(true);
  // The glyph is stroked in currentColor; it must inherit a visible ink, not be painted out.
  expect(getComputedStyle(glyph!).visibility).toBe("visible");
}

function row(tone: LampTone): FleetRowDto {
  const live = tone !== "stopped";
  return {
    sessionId: `r-${tone}`,
    projectId: "p1",
    projectName: "Flywheel",
    projectKeyPrefix: "FLY",
    projectStatus: "active",
    storyId: `s-${tone}`,
    storyKey: "FLY-7",
    storyTitle: `A ${tone} Story`,
    storyState: "running",
    runStatus: tone === "waiting" ? "blocked" : live ? "running" : "interrupted",
    fleetState: tone === "waiting" ? "blocked" : live ? "running" : "interrupted",
    startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endedAt: live ? null : new Date().toISOString(),
    blockedSince: tone === "waiting" ? new Date().toISOString() : null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    doingTaskTitle: null,
    activity: { lines: [], truncated: false },
  };
}

const TONES = [
  { tone: "waiting", word: "Waiting on you" },
  { tone: "running", word: "Running" },
  { tone: "stopped", word: "Stopped" },
] as const;

function renderLamp(tone: LampTone): HTMLElement {
  const lamp: LampData = { tone, row: row(tone) };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <section className="bg-strip p-4 text-strip-foreground">
        <Lamp lamp={lamp} current={false} now={Date.now()} />
      </section>
    </QueryClientProvider>,
  );
  return document.querySelector<HTMLElement>(`[data-lamp="${tone}"]`)!;
}

/** One state per tone, so every fill the badge can wear is measured. */
const BADGES = [
  { state: "blocked", word: "Waiting on you" },
  { state: "running", word: "Running" },
  { state: "failed", word: "Failed" },
  { state: "merged", word: "Merged" },
  { state: "ready", word: "Ready" },
] as const;

function renderBadge(state: string, variant: "pill" | "inline" = "pill", hideLabel = false): HTMLElement {
  render(
    <div className="bg-background p-2 text-foreground">
      <StateBadge state={state} variant={variant} hideLabel={hideLabel} />
    </div>,
  );
  return document.querySelector<HTMLElement>("[data-state]")!;
}

describe(`the andon lamps and StateBadge under ${expectForced ? "forced colors" : "ordinary colours"}`, () => {
  it("loaded the world this run claims to measure", () => {
    expect(
      window.matchMedia("(forced-colors: active)").matches,
      "the config asked for one forced-colors setting and the engine landed in the other",
    ).toBe(expectForced);
  });

  it("the substitution itself happened (or, in the ordinary arm, did not): the media query alone is not enough", () => {
    // The waiting lamp inks dark on yellow and the running lamp light on graphite; forced colors paints both the
    // same system ink, so the two inks agree exactly when the engine substituted.
    const waiting = getComputedStyle(renderLamp("waiting")).color;
    document.body.replaceChildren();
    const runningInk = getComputedStyle(renderLamp("running")).color;
    if (expectForced) expect(runningInk, "forced colors left the tone inks apart").toBe(waiting);
    else expect(runningInk, "the ordinary arm must ink waiting and running differently").not.toBe(waiting);
  });

  it.each(TONES)("the $tone lamp keeps its bulb, its word and legible ink", ({ tone, word }) => {
    const lamp = renderLamp(tone);
    expectDrawnGlyph(lamp, `${tone} lamp`);
    expect(lamp.getAttribute("aria-label"), `${tone} lamp: the accessible name lost its word`).toContain(word);
    expect(lamp.textContent, `${tone} lamp: the Story is not named`).toContain("FLY-7");
    expectLegible(lamp, `${tone} lamp`);
    for (const text of lamp.querySelectorAll(".truncate")) expectLegible(text, `${tone} lamp line "${text.textContent}"`);
    const border = getComputedStyle(lamp);
    expect(border.borderTopStyle, `${tone} lamp: the boundary is gone`).toBe("solid");
    expect(border.borderTopWidth).toBe("1px");
  });

  it("the three lamp tones are told apart by bulb glyph and by detail word, whatever the colours did", () => {
    const seen = TONES.map(({ tone }) => {
      const lamp = renderLamp(tone);
      const entry = { tone, glyph: lamp.querySelector("svg")!.innerHTML, detail: lamp.querySelectorAll(".truncate")[1]?.textContent ?? "" };
      document.body.replaceChildren();
      return entry;
    });
    expect(new Set(seen.map((s) => s.glyph)).size, "two tones share a bulb glyph").toBe(TONES.length);
    expect(seen.find((s) => s.tone === "waiting")!.detail).toContain("Waiting on you");
    expect(seen.find((s) => s.tone === "running")!.detail).toContain("Running");
    expect(seen.find((s) => s.tone === "stopped")!.detail).toContain("Stopped");
  });

  it.each(BADGES)("the $state badge keeps its glyph, its word and legible ink, as a pill and inline", ({ state, word }) => {
    for (const variant of ["pill", "inline"] as const) {
      const badge = renderBadge(state, variant);
      expectDrawnGlyph(badge, `${state}/${variant}`);
      expect(badge.textContent, `${state}/${variant}: the word is gone`).toContain(word);
      expectLegible(badge, `${state}/${variant}`);
      document.body.replaceChildren();
    }
    renderBadge(state, "pill", true);
    expect(screen.getByRole("img", { name: word }), `${state}: the hidden word left the accessible name`).toBeTruthy();
  });

  it("every pair of badge states is told apart by glyph or word, whatever the colours did", () => {
    const seen = BADGES.map(({ state }) => {
      const badge = renderBadge(state);
      const entry = { state, key: `${badge.querySelector("svg")!.innerHTML}|${badge.textContent}` };
      document.body.replaceChildren();
      return entry;
    });
    expect(new Set(seen.map((s) => s.key)).size, "two states draw the same glyph and word").toBe(BADGES.length);
  });
});
