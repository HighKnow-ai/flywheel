/**
 * The session feed in WebKit, over a long synthetic log (issue #190).
 *
 * On the installed build a 168-line handed-off session drew most rows twice, the copy offset by about
 * half a line, and further down drew the same rows again. jsdom has no layout, so an overlap cannot be
 * measured there; this file mounts the real surface at two window sizes, pages every older window in
 * the way a reader does (scrolling to the top of what is loaded), then walks the feed from top to bottom
 * and checks, at every stop, that no two mounted rows share a key and no two overlap.
 *
 * What it does NOT prove: the Tauri IPC behind the read (the adapter is stubbed over the synthetic log,
 * clamped the way `session_log_window` clamps), and that a packaged WKWebView lays out the same way
 * (this is Playwright's WebKit build).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { page } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../../SessionSurface";
import { buildFeedRows } from "../../feedRows";
import { resetUiState } from "../../../state/uiStore";
import "../../../styles/globals.css";
import { SYNTHETIC_ENDED_ROW, SYNTHETIC_RUN_ID, logWindow, syntheticSessionLog } from "../fixtures/syntheticSessionLog";

const served = vi.hoisted(() => ({ entries: [] as Record<string, unknown>[], ended: true }));

vi.mock(import("../../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  invokeCommand: (() => Promise.resolve(undefined)) as never,
  sessionLogWindow: (_id: string, offset: number, limit: number) =>
    Promise.resolve(logWindow(served.entries, offset, limit)) as never,
  sessionGet: () => Promise.resolve(served.ended ? SYNTHETIC_ENDED_ROW : null) as never,
  storyGet: () => Promise.resolve(null),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  pendingPermissionRequests: () => Promise.resolve([]),
}));

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function scroller(): HTMLElement {
  return document.querySelector("[data-testid='session-feed-scroll']") as HTMLElement;
}

function slots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='feed-row-slot']"));
}

/** Every mounted row's key and box, and any pair that shares a key or overlaps by more than a pixel. */
function problemsInView(): string[] {
  const mounted = slots().map((el) => ({ key: el.dataset.rowKey ?? "", rect: el.getBoundingClientRect() }));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of mounted) {
    if (seen.has(row.key)) problems.push(`${row.key} is mounted twice`);
    seen.add(row.key);
  }
  const byTop = [...mounted].sort((a, b) => a.rect.top - b.rect.top);
  for (const [i, below] of byTop.entries()) {
    const above = byTop[i - 1];
    if (above && below.rect.top < above.rect.bottom - 1) {
      problems.push(
        `${below.key} (top ${below.rect.top.toFixed(1)}) overlaps ${above.key} (bottom ${above.rect.bottom.toFixed(1)})`,
      );
    }
  }
  return problems;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <SessionSurface
          sessionId={SYNTHETIC_RUN_ID}
          onBack={() => {}}
          initialStatus={served.ended ? "completed" : "running"}
        />
      </div>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(slots().length).toBeGreaterThan(0));
}

/** Scroll to the top of what is loaded until the first line of the log is in the feed. */
async function pageInEverything() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const el = scroller();
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (slots().some((slot) => slot.dataset.index === "0") && el.scrollTop === 0 && fullyLoaded()) return;
  }
}

function fullyLoaded(): boolean {
  // The first row of the log is the stdin warning's successor; the first row with an index of 0 and a
  // key for the first tool call means the oldest window is in.
  const first = slots().find((slot) => slot.dataset.index === "0");
  return first?.dataset.rowKey === expectedKeys()[0];
}

function expectedKeys(): string[] {
  return buildFeedRows(served.entries).map((row) => row.key);
}

/** Walks the feed from top to bottom in half-screen steps, collecting every key and every problem. */
async function walk(): Promise<{ keys: Set<string>; problems: string[] }> {
  const el = scroller();
  const keys = new Set<string>();
  const problems: string[] = [];
  el.scrollTop = 0;
  await nextFrame();
  for (let guard = 0; guard < 400; guard += 1) {
    await nextFrame();
    for (const slot of slots()) keys.add(slot.dataset.rowKey ?? "");
    problems.push(...problemsInView().map((p) => `at scrollTop ${el.scrollTop}: ${p}`));
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) break;
    el.scrollTop += Math.max(40, Math.floor(el.clientHeight / 2));
  }
  return { keys, problems };
}

beforeEach(() => {
  resetUiState();
  served.entries = syntheticSessionLog();
});
afterEach(() => {
  resetUiState();
});

describe.each([
  [900, 600],
  [1920, 1080],
])("the session feed at %i × %i", (width, height) => {
  it.each([
    ["an ended", true],
    ["a live", false],
  ])("draws every event of %s session once, with no two rows overlapping, after scrolling", async (_label, ended) => {
    served.ended = ended;
    await page.viewport(width, height);
    await mount();
    await pageInEverything();

    const { keys, problems } = await walk();

    expect(problems).toEqual([]);
    expect([...keys].sort()).toEqual([...expectedKeys()].sort());
    expect(slots().length).toBeLessThanOrEqual(expectedKeys().length);
    // The virtualizer's own count: one slot per row of the log, never one per row per loaded page.
    const indices = slots().map((slot) => Number(slot.dataset.index));
    expect(Math.max(...indices)).toBe(expectedKeys().length - 1);
  });
});
