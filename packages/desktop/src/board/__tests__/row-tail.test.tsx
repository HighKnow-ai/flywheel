/**
 * The task row's tail prints a value or nothing (08.1-14 finish review, finding 5). A-03 gave the
 * change cue the rule "zero ahead and cannot-measure both render nothing"; the unassigned glyph now
 * follows it, because fourteen identical "nobody" marks flatten the signals that do vary.
 *
 * The criteria count and the priority glyph are deliberately NOT in this file's rule: 01-UI-SPEC
 * § Row Anatomy lists both as never dropped and D-08 keeps the count visible at zero, so the second
 * and third tests pin that they survive.
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

  it("keeps the criteria count at zero (D-08) and the priority glyph at no priority (Row Anatomy: never dropped)", () => {
    render(<BoardRow item={ITEM} />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Priority: No priority/ })).toBeInTheDocument();
  });
});
