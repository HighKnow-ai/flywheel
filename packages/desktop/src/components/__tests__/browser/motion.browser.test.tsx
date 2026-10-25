/**
 * The motion foundation, measured in an engine (issue #198): a Collapsible animates its height, and under
 * reduced motion it changes without movement while colour and opacity transitions still run.
 *
 * One file, two kinds of invocation. Reduced motion comes from the config:
 *   npm --prefix packages/desktop run test:browser          (full motion)
 *   npm --prefix packages/desktop run test:browser:motion   (`prefers-reduced-motion: reduce`)
 * The first test asserts which world the engine landed in, so a config that silently failed to switch cannot pass
 * by measuring the other world. jsdom has no animations, no layout and no media queries, so none of this can run there.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Play } from "lucide-react";
import "../../../styles/globals.css";
import { Button } from "../../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { Spinner } from "../../ui/spinner";

const reduced = import.meta.env.VITE_EXPECT_MOTION === "reduce";

function Disclosure() {
  return (
    <Collapsible>
      <CollapsibleTrigger>Details</CollapsibleTrigger>
      <CollapsibleContent>
        <div style={{ height: 120 }}>The raw message</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function animationOf(element: Element): CSSAnimation {
  const animations = element.getAnimations() as CSSAnimation[];
  expect(animations).toHaveLength(1);
  return animations[0];
}

/** Holds an animation at its midpoint, so a measurement reads the moving frame and not either end. */
function holdAtMidpoint(animation: Animation) {
  animation.pause();
  const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
  animation.currentTime = duration / 2;
}

describe(`motion foundation (${reduced ? "reduced motion" : "full motion"})`, () => {
  it("runs in the world this config claims", () => {
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(reduced);
  });

  it(reduced ? "opens a Collapsible as a cross-fade, at full height from the first frame" : "opens a Collapsible by growing its height on the overlay duration", () => {
    render(<Disclosure />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const content = document.querySelector('[data-slot="collapsible-content"]') as HTMLElement;
    expect(content).toHaveAttribute("data-state", "open");

    const opening = animationOf(content);
    holdAtMidpoint(opening);
    const midHeight = content.getBoundingClientRect().height;
    const midOpacity = Number(getComputedStyle(content).opacity);

    if (reduced) {
      expect(opening.animationName).toBe("fade-in");
      expect(getComputedStyle(content).animationDuration).toBe("0.16s");
      expect(midHeight).toBe(120);
      expect(midOpacity).toBeGreaterThan(0);
      expect(midOpacity).toBeLessThan(1);
    } else {
      expect(opening.animationName).toBe("disclosure-open");
      expect(getComputedStyle(content).animationDuration).toBe("0.26s");
      expect(midHeight).toBeGreaterThan(0);
      expect(midHeight).toBeLessThan(120);
      // Clipped only while it moves.
      expect(getComputedStyle(content).overflow).toBe("hidden");
    }

    opening.finish();
    expect(content.getBoundingClientRect().height).toBe(120);
    expect(getComputedStyle(content).overflow).toBe("visible");
  });

  it(reduced ? "closes a Collapsible as a fade" : "closes a Collapsible faster than it opened", () => {
    render(<Disclosure />);
    const trigger = screen.getByRole("button", { name: "Details" });
    fireEvent.click(trigger);
    const content = document.querySelector('[data-slot="collapsible-content"]') as HTMLElement;
    animationOf(content).finish();

    fireEvent.click(trigger);
    // Radix keeps the content mounted while its exit animation runs.
    const closing = document.querySelector('[data-slot="collapsible-content"]') as HTMLElement;
    expect(closing).toHaveAttribute("data-state", "closed");
    const animation = animationOf(closing);
    expect(animation.animationName).toBe(reduced ? "fade-out" : "disclosure-close");
    expect(getComputedStyle(closing).animationDuration).toBe(reduced ? "0.12s" : "0.18s");
  });

  it("keeps colour transitions running in both worlds", () => {
    render(<Button variant="outline">Cancel</Button>);
    const style = getComputedStyle(screen.getByRole("button", { name: "Cancel" }));
    expect(style.transitionProperty).toContain("color");
    expect(style.transitionDuration).toBe("0.16s");
  });

  it(reduced ? "snaps a transform transition but still fades its colour" : "transitions a transform on the state duration", () => {
    render(<span className="transition-transform rotate-90">›</span>);
    const style = getComputedStyle(screen.getByText("›"));
    expect(style.transitionDuration.split(",")[0].trim()).toBe("0.16s");
    if (reduced) {
      expect(style.transitionProperty).not.toMatch(/transform|rotate|translate|scale/);
      expect(style.transitionProperty).toContain("opacity");
    } else {
      expect(style.transitionProperty).toMatch(/transform/);
    }
  });

  it(reduced ? "takes the slide and zoom out of an overlay's entrance" : "lets an overlay zoom and slide in", () => {
    render(
      <div data-testid="overlay" className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
        Popover
      </div>,
    );
    const style = getComputedStyle(screen.getByTestId("overlay"));
    if (reduced) {
      expect(style.getPropertyValue("--tw-enter-scale").trim()).toBe("1");
      expect(style.getPropertyValue("--tw-enter-translate-y").trim()).toBe("0");
    } else {
      expect(style.getPropertyValue("--tw-enter-scale").trim()).toBe(".95");
    }
    expect(style.getPropertyValue("--tw-enter-opacity").trim()).toBe("0");
  });

  it(reduced ? "lets the Spinner breathe instead of turning" : "turns the Spinner", () => {
    render(<Spinner />);
    const spinner = screen.getByRole("status", { name: "Loading" });
    expect(animationOf(spinner).animationName).toBe(reduced ? "agent-pulse" : "spin");
  });

  it("keeps a loading Button's width and label", () => {
    const { rerender } = render(
      <Button>
        <Play aria-hidden="true" />
        Start the session
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Start the session" });
    const idle = button.getBoundingClientRect().width;
    rerender(
      <Button loading>
        <Play aria-hidden="true" />
        Start the session
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Start the session" }).getBoundingClientRect().width).toBe(idle);
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
