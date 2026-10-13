/**
 * The epic roster header's sub-label (08.1-14 finish review, finding 3): the comp's
 * `THRE-4 \u00b7 backlog \u00b7 no integration branch yet`, built only from what the roster knows.
 * An unknown part is left OUT, never filled in; a known absence (`null`) is said in words.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EpicHeaderRow } from "../EpicHeaderRow";

afterEach(cleanup);

function subLabel(props: { status?: string; integrationBranch?: string | null; epicKey?: string }): string {
  render(
    <EpicHeaderRow
      epicId="e1"
      epicKey={"epicKey" in props ? props.epicKey : "THRE-4"}
      title="test"
      status={props.status}
      integrationBranch={props.integrationBranch}
      collapsed
      onToggleCollapsed={() => {}}
    />,
  );
  const row = screen.getByRole("listitem");
  const text = row.querySelector(".type-label")?.textContent ?? "";
  cleanup();
  return text;
}

describe("EpicHeaderRow sub-label", () => {
  it("reads key, status and the absence of a branch, in the comp's words", () => {
    expect(subLabel({ status: "backlog", integrationBranch: null })).toBe("THRE-4 \u00b7 backlog \u00b7 no integration branch yet");
  });

  it("prints the status in words, not the stored token", () => {
    expect(subLabel({ status: "in_progress", integrationBranch: null })).toContain("\u00b7 in progress \u00b7");
  });

  it("prints the branch when one has been cut", () => {
    expect(subLabel({ status: "in_progress", integrationBranch: "epic/THRE-8-board" })).toBe("THRE-4 \u00b7 in progress \u00b7 epic/THRE-8-board");
  });

  it("leaves out what it does not know: no status and no branch prints the key alone, never a guess", () => {
    expect(subLabel({})).toBe("THRE-4");
    expect(subLabel({ status: "todo" })).toBe("THRE-4 \u00b7 todo");
  });

  it("keeps the no-epic bucket's own words", () => {
    expect(subLabel({ epicKey: undefined, status: "backlog", integrationBranch: null })).toBe("Tasks without an epic");
  });
});
