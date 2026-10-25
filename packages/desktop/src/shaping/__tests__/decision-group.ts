import { expect } from "vitest";
import { within } from "@testing-library/react";

/**
 * Every Proposal is decided through the one Button Group (issue #211): Accept, then Amend when the Proposal carries
 * text to edit, then Reject, each an outline button at the small size, named by its verb and the Proposal.
 */
export function expectDecisionGroup(
  scope: HTMLElement,
  subject: string,
  options: { amend?: boolean; separator?: string; size?: "sm" | "xs" } = {},
) {
  const { amend = true, separator = " ", size = "sm" } = options;
  const group = within(scope).getByRole("group", { name: `Decide${separator}${subject}` });
  expect(group).toHaveAttribute("data-slot", "button-group");
  const buttons = within(group).getAllByRole("button");
  const verbs = amend ? ["Accept", "Amend", "Reject"] : ["Accept", "Reject"];
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(verbs.map((v) => `${v}${separator}${subject}`));
  expect(buttons.map((b) => b.textContent)).toEqual(verbs);
  for (const b of buttons) {
    expect(b).toHaveAttribute("data-variant", "outline");
    expect(b).toHaveAttribute("data-size", size);
  }
  return group;
}
