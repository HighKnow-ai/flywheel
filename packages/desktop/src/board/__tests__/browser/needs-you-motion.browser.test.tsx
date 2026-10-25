/**
 * An answered Needs-you item leaves by collapsing (issue #203), measured in WebKit: its card stays in place,
 * inert, while its height, its opacity and the gap beside it go to nothing on `--duration-state` (160ms) and the
 * one curve; under reduced motion it fades where it stands, its height untouched. Then it is gone, and the
 * keyboard is on the card now in its place.
 *
 *   npm --prefix packages/desktop run test:browser -- needs-you          (full motion)
 *   npm --prefix packages/desktop run test:browser:motion -- needs-you   (`prefers-reduced-motion: reduce`)
 *
 * jsdom has no Web Animations and no layout, so none of this can run there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import "../../../styles/globals.css";
import { NeedsYouList } from "../../NeedsYou";
import { needsYouQueryKey } from "../../../fleet/useFleet";
import type { NeedsYouItemDto } from "../../../adapters/tauri";

const reduced = import.meta.env.VITE_EXPECT_MOTION === "reduce";

function review(id: string): NeedsYouItemDto {
  return {
    kind: "review",
    rank: 3,
    id,
    since: "2026-10-23T09:00:00Z",
    record: { kind: "story", id: `s-${id}`, key: `FLY-${id}`, title: `Story ${id}`, state: null },
    sessionId: null,
    request: null,
    endingReason: null,
    missingWorktree: false,
    doingTaskTitle: null,
    exitTest: null,
    milestoneTitle: null,
    round: null,
    conflicts: [],
    proposals: null,
    judgedOn: null,
  };
}

let items: NeedsYouItemDto[] = [];
let client: QueryClient;

beforeEach(() => {
  items = [review("1"), review("2"), review("3")];
  mockIPC((cmd) => (cmd === "needs_you_list" ? JSON.parse(JSON.stringify(items)) : null), { shouldMockEvents: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  // Unmount first: the fleet subscription unlistens through the mocked event plugin.
  cleanup();
  clearMocks();
});

function card(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
}

async function renderList() {
  render(
    <QueryClientProvider client={client}>
      <div style={{ width: 400 }}>
        <NeedsYouList projectId="p1" />
      </div>
    </QueryClientProvider>,
  );
  await screen.findByRole("list", { name: "Needs you, most urgent first" });
}

/** Answer item 2: the core's next read no longer has it. Resolves with its card, now leaving. */
async function answerTwo(): Promise<{ leaving: HTMLElement; animation: CSSAnimation | Animation; height: number }> {
  const before = card("2")!;
  const height = before.getBoundingClientRect().height;
  items = items.filter((i) => i.id !== "2");
  await client.invalidateQueries({ queryKey: needsYouQueryKey("p1") });
  const leaving = await waitFor(() => {
    const el = card("2");
    expect(el).toHaveAttribute("data-leaving");
    return el as HTMLElement;
  });
  const animations = leaving.getAnimations();
  expect(animations).toHaveLength(1);
  return { leaving, animation: animations[0], height };
}

describe(`An answered Needs-you item (${reduced ? "reduced motion" : "full motion"})`, () => {
  it("runs in the world this config claims", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(reduced);
  });

  it(reduced ? "fades out where it stands, without moving" : "collapses its height before it leaves, on the state duration", async () => {
    await renderList();
    const below = card("3")!;
    const belowTop = below.getBoundingClientRect().top;
    const { leaving, animation, height } = await answerTwo();
    expect(height).toBeGreaterThan(40);

    // The same element, still in its place, out of reach while it goes.
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving.inert).toBe(true);
    const timing = animation.effect!.getComputedTiming();
    expect(timing.duration).toBe(160);

    animation.pause();
    animation.currentTime = 80;
    const midHeight = leaving.getBoundingClientRect().height;
    const midOpacity = Number(getComputedStyle(leaving).opacity);
    expect(midOpacity).toBeGreaterThan(0);
    expect(midOpacity).toBeLessThan(1);
    if (reduced) {
      expect(midHeight).toBe(height);
      expect(card("3")!.getBoundingClientRect().top).toBe(belowTop);
    } else {
      expect(midHeight).toBeGreaterThan(0);
      expect(midHeight).toBeLessThan(height);
      expect(card("3")!.getBoundingClientRect().top).toBeLessThan(belowTop);
    }

    animation.finish();
    await waitFor(() => expect(card("2")).toBeNull());
    // Gone: the card below sits where the answered one began, the gap closed with it.
    expect(Math.round(card("3")!.getBoundingClientRect().top)).toBe(Math.round(belowTop - height - 10));
  });

  it("moves the keyboard to the card now in its place as the answered one starts to leave", async () => {
    await renderList();
    within(card("2")!).getByRole("button", { name: "Open Story FLY-2 Story 2" }).focus();
    const { animation } = await answerTwo();
    await waitFor(() => expect(document.activeElement).toBe(within(card("3")!).getByRole("button", { name: "Open Story FLY-3 Story 3" })));
    animation.finish();
    await waitFor(() => expect(card("2")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("FLY-2 off the list. 2 items need you.");
  });
});
