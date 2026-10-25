/**
 * The lamp lighting (issue #199), measured in an engine: the world's one authored moment. A lamp whose session
 * turns Waiting on you changes colour in place on `--duration-lamp` while a yellow glow rises under it; under
 * reduced motion only its colour changes, and the lit lamp has no glow.
 *
 *   npm --prefix packages/desktop run test:browser -- andon          (full motion)
 *   npm --prefix packages/desktop run test:browser:motion -- andon   (`prefers-reduced-motion: reduce`)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../styles/globals.css";
import type { FleetRowDto } from "../../../adapters/tauri";
import { Lamp, type LampData } from "../../AndonStrip";

const reduced = import.meta.env.VITE_EXPECT_MOTION === "reduce";

const ROW: FleetRowDto = {
  sessionId: "r-1",
  projectId: "p1",
  projectName: "Flywheel",
  projectKeyPrefix: "FLY",
  projectStatus: "active",
  storyId: "s-1",
  storyKey: "FLY-6",
  storyTitle: "A Story that waits",
  storyState: "running",
  runStatus: "running",
  fleetState: "running",
  startedAt: "2026-10-22T09:00:00Z",
  endedAt: null,
  blockedSince: null,
  costUsd: null,
  tokensIn: null,
  tokensOut: null,
  doingTaskTitle: "Write the parser",
  activity: { lines: [], truncated: false },
};

const RUNNING: LampData = { tone: "running", row: ROW };
const WAITING: LampData = {
  tone: "waiting",
  row: { ...ROW, runStatus: "blocked", fleetState: "blocked", blockedSince: "2026-10-22T09:10:00Z" },
};

function Strip({ lamp }: { lamp: LampData }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <div className="bg-strip p-4">
        <Lamp lamp={lamp} current={false} now={Date.parse("2026-10-22T09:20:00Z")} />
      </div>
    </QueryClientProvider>
  );
}

function transitionsOf(element: Element): Map<string, CSSTransition> {
  const byProperty = new Map<string, CSSTransition>();
  for (const animation of element.getAnimations()) {
    if (animation instanceof CSSTransition) byProperty.set(animation.transitionProperty, animation);
  }
  return byProperty;
}

/** Whether a computed box-shadow draws anything: some shadow in it has a colour that is not fully transparent. */
function glows(boxShadow: string): boolean {
  if (boxShadow === "none") return false;
  // WebKit writes a colour as `rgba(r, g, b, a)` or, for a color-mix(), as `oklab(l a b / alpha)`.
  return [...boxShadow.matchAll(/(rgba?|oklab|oklch|color|lab|lch)\(([^)]*)\)/g)].some(([, fn, args]) => {
    if (args.includes("/")) return Number(args.split("/")[1].trim()) > 0;
    const parts = args.split(",");
    return !(fn === "rgba" && parts.length === 4 && Number(parts[3].trim()) === 0);
  });
}

/** Holds every running transition at its midpoint, so a measurement reads the moving frame. */
function holdAtMidpoint(transitions: Iterable<CSSTransition>) {
  for (const transition of transitions) {
    transition.pause();
    transition.currentTime = Number(transition.effect?.getComputedTiming().duration ?? 0) / 2;
  }
}

describe(`the andon lamp lighting (${reduced ? "reduced motion" : "full motion"})`, () => {
  it("runs in the world this config claims", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(reduced);
  });

  it(
    reduced
      ? "turns yellow with a colour cross-fade on the lamp duration, and no glow"
      : "turns yellow and raises its glow together, on the lamp duration",
    async () => {
      const { rerender } = render(<Strip lamp={RUNNING} />);
      const lamp = screen.getByRole("button", { name: /Open Story FLY-6/ });
      const unlit = getComputedStyle(lamp).backgroundColor;
      // Let the first frame settle, so the change below is a transition and not the initial style.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      rerender(<Strip lamp={WAITING} />);
      const lit = screen.getByRole("button", { name: /Open Story FLY-6/ });
      expect(lit).toBe(lamp);
      const transitions = transitionsOf(lit);
      const colour = transitions.get("background-color");
      expect(colour, "the colour change is a transition").toBeDefined();
      expect(colour!.effect?.getComputedTiming().duration).toBe(240);
      holdAtMidpoint(transitions.values());
      const midColour = getComputedStyle(lit).backgroundColor;
      expect(midColour).not.toBe(unlit);

      if (reduced) {
        expect(transitions.has("box-shadow")).toBe(false);
        expect(glows(getComputedStyle(lit).boxShadow)).toBe(false);
      } else {
        const glow = transitions.get("box-shadow");
        expect(glow, "the glow rises as a transition").toBeDefined();
        expect(glow!.effect?.getComputedTiming().duration).toBe(240);
      }

      for (const transition of transitions.values()) transition.finish();
      const settled = getComputedStyle(lit);
      expect(settled.backgroundColor).not.toBe(midColour);
      expect(glows(settled.boxShadow), settled.boxShadow).toBe(!reduced);
    },
  );
});
