/**
 * The top bar (issue #199): on a narrow header the middle crumbs fold into BreadcrumbEllipsis, a menu that still
 * goes to each folded place, and Search folds to an icon Button whose ⌘K hint is a Kbd in its Tooltip. jsdom has
 * no layout, so the widths themselves are measured by the layout-defect check (`test:layout-defects`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PageHeader } from "../PageHeader";
import { resetUiState, useUiStore } from "../../state/uiStore";

beforeEach(() => resetUiState());

describe("PageHeader", () => {
  it("folds the crumbs between the first and the last into a menu that still goes to each place", async () => {
    const openStory = vi.fn();
    render(
      <PageHeader
        crumbs={[
          { label: "A project with a forty-character name ok", onSelect: vi.fn() },
          { label: "FLY-1234", mono: true, onSelect: openStory, ariaLabel: "Open Story FLY-1234" },
          { label: "session-id", mono: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Show the folded places" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "FLY-1234" }));
    expect(openStory).toHaveBeenCalledTimes(1);
  });

  it("has no folded-places menu with two crumbs or fewer", () => {
    render(
      <PageHeader
        crumbs={[
          { label: "Flywheel", onSelect: vi.fn() },
          { label: "FLY-1", mono: true },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Show the folded places" })).toBeNull();
  });

  it("opens the palette from Search, and shows its ⌘K hint as a Kbd", () => {
    render(<PageHeader crumbs={[{ label: "Flywheel" }]} />);
    const search = screen.getByRole("button", { name: "Search, ⌘K" });
    expect(search.querySelector("[data-slot=kbd]")).toHaveTextContent("⌘K");
    fireEvent.click(search);
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });
});
