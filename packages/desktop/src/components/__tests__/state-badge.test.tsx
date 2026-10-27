import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STATE_VOCABULARY, StateBadge, stateToneOf, stateWordOf, type StateTone } from "../StateBadge";
import { isIconName } from "../Icon";
import { cn } from "@highknow/design";

/**
 * StateBadge is the one place a state picks a colour (docs/design/direction.md § Components, rule 1). Every
 * state carries an icon AND a word AND a tone; the tones are four, one meaning each.
 */

const badge = (container: HTMLElement) => container.querySelector("[data-slot=badge]") as HTMLElement;

const STORY_STATES = ["shaping", "ready", "running", "in_review", "merged", "dropped"] as const;
const ATTENTION = ["waiting_on_you", "stopped"] as const;

describe("the state vocabulary", () => {
  it("covers every Story state and both attention states, each with a registered icon and a word", () => {
    for (const state of [...STORY_STATES, ...ATTENTION]) {
      const entry = STATE_VOCABULARY[state];
      expect(isIconName(entry.icon), `${state} icon ${entry.icon}`).toBe(true);
      expect(entry.label.length, `${state} word`).toBeGreaterThan(0);
    }
  });

  it("uses the icons direction.md names for Story states and attention", () => {
    expect(STORY_STATES.map((s) => STATE_VOCABULARY[s].icon)).toEqual([
      "CircleDashed",
      "Circle",
      "LoaderCircle",
      "GitPullRequest",
      "GitMerge",
      "CircleSlash",
    ]);
    expect(STATE_VOCABULARY.waiting_on_you.icon).toBe("Hand");
    expect(STATE_VOCABULARY.stopped.icon).toBe("CirclePause");
  });

  it("spends yellow on Waiting on you only, blue on work in progress only, red on Stopped or failed only", () => {
    const byTone: Record<StateTone, string[]> = { attention: [], running: [], destructive: [], neutral: [] };
    for (const [state, entry] of Object.entries(STATE_VOCABULARY)) byTone[entry.tone].push(state);
    expect(byTone.attention.sort()).toEqual(["blocked", "waiting_on_you"]);
    expect(byTone.running.sort()).toEqual(["doing", "running"]);
    expect(byTone.destructive.sort()).toEqual(["abandoned", "ci_failed", "failed", "stopped"]);
    for (const state of [
      "shaping",
      "ready",
      "in_review",
      "merged",
      "dropped",
      "passed",
      "not_run",
      "timed_out",
      "stale",
    ]) {
      expect(stateToneOf(state), state).toBe("neutral");
    }
  });

  it("words a fleet state with the run-status vocabulary, and the core's `blocked` as Waiting on you", () => {
    expect(stateWordOf("blocked")).toBe("Waiting on you");
    expect(stateWordOf("awaiting_review")).toBe("In review");
    expect(stateWordOf("in_review")).toBe("In review");
  });
});

describe("StateBadge", () => {
  it.each([...STORY_STATES, ...ATTENTION])("draws %s as an icon and a word", (state) => {
    const { container } = render(<StateBadge state={state} />);
    expect(badge(container).querySelector("svg")).not.toBeNull();
    expect(badge(container)).toHaveTextContent(STATE_VOCABULARY[state].label);
    expect(badge(container)).toHaveAttribute("data-tone", STATE_VOCABULARY[state].tone);
  });

  it("fills Waiting on you with the attention tone", () => {
    const { container } = render(<StateBadge state="waiting_on_you" />);
    expect(badge(container)).toHaveAttribute("data-variant", "attention");
    expect(badge(container).className).toMatch(/\bbg-attention\b/);
    expect(badge(container).className).toMatch(/\btext-attention-foreground\b/);
  });

  it("keeps attention and destructive filled even inline: yellow and red are only read as fills", () => {
    for (const state of ["waiting_on_you", "stopped"]) {
      const { container, unmount } = render(<StateBadge state={state} variant="inline" />);
      expect(badge(container)).toHaveAttribute("data-variant", stateToneOf(state));
      unmount();
    }
    const { container } = render(<StateBadge state="running" variant="inline" />);
    expect(badge(container)).toHaveAttribute("data-variant", "ghost");
    expect(badge(container).className).toMatch(/\btext-running\b/);
  });

  it("takes the caller's word, for a state that needs its reason", () => {
    render(<StateBadge state="stopped" label="Stopped: crash" />);
    expect(screen.getByText("Stopped: crash")).toBeInTheDocument();
  });

  it("moves the word into the accessible name when it is not drawn, never dropping it", () => {
    const { container } = render(<StateBadge state="running" hideLabel />);
    expect(screen.getByRole("img", { name: "Running" })).toBeTruthy();
    expect(badge(container).textContent).toBe("");
    expect(badge(container).querySelector("svg")).not.toBeNull();
  });

  it("draws an unknown value neutral, with the dashed circle and its own raw value", () => {
    const { container } = render(<StateBadge state="mystery" />);
    expect(badge(container)).toHaveAttribute("data-tone", "neutral");
    expect(badge(container)).toHaveTextContent("mystery");
  });

  it("pulses the icon only when asked", () => {
    const { container, rerender } = render(<StateBadge state="running" />);
    expect(container.querySelector(".agent-pulse")).toBeNull();
    rerender(<StateBadge state="running" pulse />);
    expect(container.querySelector(".agent-pulse")).not.toBeNull();
  });
});

describe("cn", () => {
  it("treats the type scale as font sizes, so a size never drops the colour beside it", () => {
    expect(cn("text-primary-foreground", "text-body")).toBe("text-primary-foreground text-body");
    expect(cn("text-body", "text-meta")).toBe("text-meta");
    expect(cn("text-foreground", "text-running")).toBe("text-running");
  });
});
