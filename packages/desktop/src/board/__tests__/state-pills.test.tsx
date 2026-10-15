/**
 * Plan 14-09: the needs-decision and CI-failed pills are STATES, so they are drawn by the one
 * component in their class's colour. Before this they spent `--destructive-strip`, which put
 * needs-decision in RED beside the amber Blocked chip, although D-15 places it in needs-you.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardRow } from "../BoardRow";
import type { BoardItem } from "../useBoardQuery";

const item: BoardItem = {
  id: "task-1",
  key: "FLY-1",
  title: "A task",
  status: "in_progress",
  rank: "10",
  priority: 0,
  epicId: null,
  kind: "task",
};

const classOf = (name: RegExp) =>
  screen.getByRole("button", { name }).querySelector("[data-state-class]")?.getAttribute("data-state-class");

describe("board row state pills are drawn through StateBadge", () => {
  it("needs-decision is in the needs-you class, the same class as Blocked (D-15)", () => {
    render(<BoardRow item={item} blocked needsDecision />);
    expect(classOf(/Needs Decision/)).toBe("needs-you");
    expect(classOf(/^Blocked/)).toBe("needs-you");
  });

  it("CI failed is in the failed class", () => {
    render(<BoardRow item={item} ciFailed />);
    expect(classOf(/CI failed/)).toBe("failed");
  });

  it("each pill still prints its glyph and its word beside the colour", () => {
    render(<BoardRow item={item} needsDecision ciFailed />);
    for (const [name, word] of [[/Needs Decision/, "Needs Decision"], [/CI failed/, "CI failed"]] as const) {
      const pill = screen.getByRole("button", { name });
      expect(pill.querySelector("svg")).toBeInTheDocument();
      expect(pill).toHaveTextContent(word);
    }
  });
});
