import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STATE_VOCABULARY, StateBadge, rowVariant, stateClassOf } from "../StateBadge";
import { MARKS, MARKS_BY_ID } from "../marks";
import { RUN_STATUS_MARK_IDS } from "../runStatus";

/**
 * Phase 14 plan 04 (VIS-01, D-15, D-19). `StateBadge` is the ONE consumer of the `--state-*` tokens and it
 * always draws a glyph and a word or an accessible name beside the colour: colour is the fastest channel
 * and never the only one. This file proves it is safe to.
 */

const badge = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

describe("StateBadge: glyph, word and the class's ink, all present", () => {
  it("draws blocked as a glyph, the words Waiting on you and the needs-you ink", () => {
    const { container } = render(<StateBadge state="blocked" />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(badge(container).style.color).toBe("var(--state-needs-you-text)");
    expect(badge(container).dataset.stateClass).toBe("needs-you");
  });

  it.each([
    ["running", "Running", "running", "run-running"],
    ["failed", "Failed", "failed", "run-failed"],
    ["merged", "Merged", "merged", "run-merged"],
    ["abandoned", "Abandoned", "needs-you", "run-abandoned"],
  ])("draws %s with its own word, glyph and class ink", (state, word, cls, markId) => {
    const { container } = render(<StateBadge state={state} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(badge(container).style.color).toBe(`var(--state-${cls}-text)`);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(STATE_VOCABULARY[state].markId).toBe(markId);
  });

  it.each([
    ["completed", "Completed"],
    ["interrupted", "Interrupted"],
  ])("draws %s in the quiet class: a glyph and a word, no saturated role", (state, word) => {
    const { container } = render(<StateBadge state={state} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(badge(container).style.color).toBe("var(--state-quiet-text)");
    expect(container.innerHTML).not.toMatch(/--state-(needs-you|running|failed|merged)/);
  });

  it("puts every needs-you member in the needs-you class (D-15)", () => {
    for (const state of ["blocked", "awaiting_review", "abandoned", "needs_decision", "proposals_pending"]) {
      expect(stateClassOf(state), state).toBe("needs-you");
    }
    expect(stateClassOf("failed")).toBe("failed");
    expect(stateClassOf("ci_failed")).toBe("failed");
  });

  it("agrees with the fleet's NEEDS YOU band: blocked, awaiting review and abandoned are saturated together", async () => {
    const { bandForState } = await import("../runStatus");
    for (const state of ["blocked", "awaiting_review", "abandoned"] as const) {
      expect(bandForState(state)).toBe("needs-you");
      expect(stateClassOf(state)).toBe("needs-you");
    }
  });
});

describe("StateBadge: the vocabulary is five classes and no more (Phase 15 plan 03, D-34)", () => {
  it("has exactly the five named classes across every key, so a new key that invents a class fails here", () => {
    const classes = new Set(Object.values(STATE_VOCABULARY).map((entry) => entry.cls));
    expect([...classes].sort()).toEqual(["failed", "merged", "needs-you", "quiet", "running"]);
    expect(classes.size).toBe(5);
  });

  it("puts a task held by the account limit in blocked's own class and mark: a key, not a class", () => {
    expect(STATE_VOCABULARY.held_by_limit).toEqual(STATE_VOCABULARY.blocked);
    expect(stateClassOf("held_by_limit")).toBe("needs-you");
    expect(rowVariant("held_by_limit")).toBe("wash");
  });

  it("draws the caller's own word beside the glyph when given a label, and keeps it as the accessible name when hidden", () => {
    const { container, rerender } = render(<StateBadge state="held_by_limit" label="Held by the account limit" />);
    expect(screen.getByText("Held by the account limit")).toBeTruthy();
    expect(badge(container).dataset.stateClass).toBe("needs-you");
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(<StateBadge state="held_by_limit" label="Held by the account limit" hideLabel />);
    expect(screen.getByRole("img", { name: "Held by the account limit" })).toBeTruthy();
  });
});

describe("StateBadge: a state the vocabulary does not know", () => {
  it("renders the quiet class with its raw value as the word, a glyph, and does not throw", () => {
    const { container } = render(<StateBadge state="warming_up" />);
    expect(screen.getByText("warming_up")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(badge(container).style.color).toBe("var(--state-quiet-text)");
    expect(badge(container).dataset.stateClass).toBe("quiet");
  });

  it("renders an empty string as a glyph and a quiet class, never an empty element", () => {
    const { container } = render(<StateBadge state="" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(badge(container).textContent?.length).toBeGreaterThan(0);
  });

  it("does not resolve an Object.prototype key as a known state", () => {
    expect(stateClassOf("constructor")).toBe("quiet");
    expect(stateClassOf("__proto__")).toBe("quiet");
  });
});

describe("StateBadge: colour is never the only channel", () => {
  it("keeps an accessible name carrying the word when the label is not drawn", () => {
    const { container } = render(<StateBadge state="blocked" hideLabel />);
    expect(screen.getByRole("img", { name: "Waiting on you" })).toBeTruthy();
    expect(screen.getByLabelText("Waiting on you")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("keeps the raw value as the accessible name of an unknown state with the label hidden", () => {
    render(<StateBadge state="warming_up" hideLabel />);
    expect(screen.getByRole("img", { name: "warming_up" })).toBeTruthy();
  });
});

describe("StateBadge: the four draw variants are the four roles", () => {
  it("ink-only draws the text role and no ground", () => {
    const { container } = render(<StateBadge state="running" variant="text" />);
    expect(badge(container).style.color).toBe("var(--state-running-text)");
    expect(badge(container).style.background).toBe("");
  });

  it("on a wash draws the wash behind the text role", () => {
    const { container } = render(<StateBadge state="running" variant="wash" />);
    expect(badge(container).style.background).toBe("var(--state-running-wash)");
    expect(badge(container).style.color).toBe("var(--state-running-text)");
  });

  it("with an edge draws a full 1px boundary on all sides and never a side stripe", () => {
    const { container } = render(<StateBadge state="running" variant="edge" />);
    const el = badge(container);
    expect(el.style.borderWidth).toBe("1px");
    expect(el.style.borderStyle).toBe("solid");
    expect(el.style.borderColor).toBe("var(--state-running-edge)");
    // Every side is the same 1px: a shorthand width expands to all four, so no side can be a 2px stripe.
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      expect(el.style[`border${side}Width`], side).toBe("1px");
    }
  });

  it("as a mark paints the glyph in the mark role and leaves the word to inherit", () => {
    const { container } = render(<StateBadge state="running" variant="mark" />);
    const glyph = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(glyph.style.color).toBe("var(--state-running-mark)");
    expect(badge(container).style.color).toBe("");
    expect(screen.getByText("Running")).toBeTruthy();
  });
});

describe("StateBadge: the glyph and the word come from the published registry", () => {
  it("resolves every state's mark id to a registered mark, so none renders a fallback glyph silently", () => {
    for (const [state, entry] of Object.entries(STATE_VOCABULARY)) {
      expect(MARKS_BY_ID[entry.markId], `state "${state}" names mark "${entry.markId}", which is not in MARKS`).toBeDefined();
    }
  });

  it("agrees with RUN_STATUS_MARK_IDS for every run status it shares", () => {
    for (const [state, markId] of Object.entries(RUN_STATUS_MARK_IDS)) {
      expect(STATE_VOCABULARY[state].markId, state).toBe(markId);
    }
  });

  it("registers merged and awaiting review in MARKS, each with a glyph, a label and a meaning (D-19)", () => {
    for (const id of ["run-merged", "run-awaiting-review"]) {
      const mark = MARKS.find((m) => m.id === id);
      expect(mark, id).toBeDefined();
      expect(mark!.glyph.length).toBeGreaterThan(0);
      expect(mark!.label.length).toBeGreaterThan(0);
      expect(mark!.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe("StateBadge: the pulse (Phase 14 plan 07, the one continuous-motion exception)", () => {
  it("pulses the glyph only when asked, and the glyph stays hidden from assistive tech either way", () => {
    const { container, rerender } = render(<StateBadge state="running" />);
    expect(container.querySelector(".agent-pulse")).toBeNull();
    rerender(<StateBadge state="running" pulse />);
    const glyph = container.querySelector(".agent-pulse") as HTMLElement;
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Running")).toBeTruthy();
  });
});

describe("rowVariant: which states a list row washes (Phase 14 plan 09)", () => {
  it("washes every needs-you and failed state, and nothing else the vocabulary knows", () => {
    for (const state of Object.keys(STATE_VOCABULARY)) {
      const cls = stateClassOf(state);
      expect(rowVariant(state), state).toBe(cls === "needs-you" || cls === "failed" ? "wash" : "text");
    }
    expect(rowVariant("blocked")).toBe("wash");
    expect(rowVariant("ci_failed")).toBe("wash");
    expect(rowVariant("running")).toBe("text");
    expect(rowVariant("merged")).toBe("text");
  });

  it("leaves a value the vocabulary does not know as ink", () => {
    expect(rowVariant("something-new")).toBe("text");
  });
});
