/**
 * 08.1 plan 15 closure, finding 7: the palette's sections are headers in the list, not a group name repeated
 * at the end of every row, and "Selected item" commands agree about their one precondition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "../CommandPalette";
import { actionLabel } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const ITEM = { id: "task-1", kind: "task", key: "FLY-1", title: "A task", status: "todo", rank: "a", priority: 0, epicId: null };

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([{ id: "p1", name: "Proj", key: "FLY" }]);
    if (command === "board_list") {
      return Promise.resolve({ items: [ITEM], issues: [], counts: { backlog: 0, todo: 1, inProgress: 0, inReview: 0, done: 0 } });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => resetUiState());

async function openPalette() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommandPalette />
    </QueryClientProvider>,
  );
  useUiStore.getState().setPaletteOpen(true);
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(5));
  return dialog;
}

describe("the palette's sections", () => {
  it("prints each group once, as a header, and never at the end of a row", async () => {
    const dialog = await openPalette();
    const options = within(dialog).getAllByRole("option");
    // A row is its label and nothing else: the old right-hand column printed "Selected item" ten times.
    for (const option of options) {
      const group = option.getAttribute("aria-description") ?? "";
      expect(option.textContent, "a row carries its label only").not.toMatch(new RegExp(`${group}$`));
      expect(option.querySelectorAll("span").length, "no second column").toBe(0);
    }
    const listbox = within(dialog).getByRole("listbox", { name: "Commands" });
    const headers = Array.from(listbox.querySelectorAll('[aria-hidden="true"]')).map((el) => el.textContent);
    expect(headers).toEqual([...new Set(headers)]);
    for (const wanted of ["Navigation", "Project", "Create", "Selected item"]) expect(headers).toContain(wanted);
  });

  it("keeps a group's commands together, in section order", async () => {
    const dialog = await openPalette();
    const listbox = within(dialog).getByRole("listbox", { name: "Commands" });
    const seen: string[] = [];
    for (const el of Array.from(listbox.children)) {
      if (el.getAttribute("role") === "option") seen.push(el.getAttribute("aria-description") ?? "");
    }
    const runs = seen.filter((g, i) => g !== seen[i - 1]);
    expect(runs, "a group appears as one run, not interleaved").toEqual([...new Set(runs)]);
    expect(runs.indexOf("Navigation")).toBeLessThan(runs.indexOf("Selected item"));
  });
});

describe("a selected-item command and the open panel", () => {
  it("Open selected item is disabled with nothing selected and no panel open, like its siblings", async () => {
    const dialog = await openPalette();
    for (const id of ["open-detail", "open-status-picker"] as const) {
      const option = within(dialog).getByRole("option", { name: actionLabel(id) });
      expect(option.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("acts on the item the detail panel is showing when no row is selected, so none of them reads disabled", async () => {
    useUiStore.getState().setDetailItemId("task-1");
    const dialog = await openPalette();
    await waitFor(() => {
      for (const id of ["open-detail", "open-status-picker", "open-priority-picker"] as const) {
        expect(within(dialog).getByRole("option", { name: actionLabel(id) }).getAttribute("aria-disabled")).toBe("false");
      }
    });
  });
});
