/**
 * The task row's tail prints a value or nothing (08.1-14 finish review, finding 5). A-03 gave the
 * change cue the rule "zero ahead and cannot-measure both render nothing"; the unassigned glyph now
 * follows it, because fourteen identical "nobody" marks flatten the signals that do vary.
 *
 * D-198.1 extends the rule to the criteria count and the priority glyph: `0/0` and "No priority"
 * render nothing, a real count and a real priority still render (the last two tests).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardRow } from "../BoardRow";
import type { Actor, BoardItem } from "../useBoardQuery";

const ITEM: BoardItem = {
  id: "t1",
  kind: "task",
  key: "FLY-9",
  title: "Add push retry",
  status: "todo",
  rank: "a0",
  priority: 0,
  epicId: null,
  estimate: null,
  criteriaChecked: 0,
  criteriaTotal: 0,
};
const ACTOR: Actor = { id: "a1", displayName: "Cyril", actorType: "human" } as Actor;

afterEach(cleanup);

describe("the task row's tail", () => {
  it("prints no assignee glyph for an unassigned task, and one for an assigned task", () => {
    render(<BoardRow item={ITEM} />);
    expect(screen.queryByRole("button", { name: /^Assignee/ })).not.toBeInTheDocument();
    cleanup();
    render(<BoardRow item={{ ...ITEM, assigneeId: "a1" }} actorsById={{ a1: ACTOR }} />);
    expect(screen.getByRole("button", { name: "Assignee: Cyril. Press to change." })).toBeInTheDocument();
  });

  it("still prints an assignee glyph while the actor roster has not landed, never a false 'Unassigned'", () => {
    render(<BoardRow item={{ ...ITEM, assigneeId: "a1" }} />);
    expect(screen.getByRole("button", { name: /^Assignee: Assigned/ })).toBeInTheDocument();
  });

  it("prints no criteria count at 0/0 and no priority glyph at no priority (D-198.1)", () => {
    render(<BoardRow item={ITEM} />);
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Priority:/ })).not.toBeInTheDocument();
  });

  it("still prints a real criteria count and a real priority glyph", () => {
    render(<BoardRow item={{ ...ITEM, criteriaChecked: 1, criteriaTotal: 3, priority: 2 }} />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Priority: / })).toBeInTheDocument();
  });
});
