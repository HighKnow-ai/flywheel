/**
 * Behavior under test (01-09-PLAN.md Task 3): the command palette's completeness (every
 * board-list binding has a palette entry, generated from the table rather than a fixed list) and
 * its focus-trap/restore-on-close contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "../CommandPalette";
import { actionLabel, boardListActionIds } from "../../state/keyboard";
import { EMPTY_FILTER_DRAFT, useUiStore } from "../../state/uiStore";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

function resetUiStore() {
  useUiStore.setState({
    searchTerm: "",
    filterDraft: EMPTY_FILTER_DRAFT,
    selectedItemId: null,
    paletteOpen: false,
    currentProjectId: null,
    detailItemId: null,
    deleteTarget: null,
  });
}

beforeEach(() => {
  resetUiStore();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([]);
    if (command === "board_list") {
      return Promise.resolve({
        items: [],
        issues: [],
        counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 },
      });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiStore();
});

function renderPalette() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  it("palette_covers_every_binding", async () => {
    renderPalette();
    useUiStore.getState().setPaletteOpen(true);

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const options = await waitFor(() => {
      const found = dialog.querySelectorAll('[role="option"]');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    const labels = Array.from(options).map((el) => el.textContent ?? "");

    // Iterates the binding table itself (`boardListActionIds`), not a fixed list of expected
    // labels — this is what keeps the assertion honest as later phases add board-list actions
    // (Task 2's own acceptance criterion).
    for (const id of boardListActionIds()) {
      const expectedLabel = actionLabel(id);
      expect(labels.some((label) => label.startsWith(expectedLabel))).toBe(true);
    }
  });

  it("palette_restores_focus_on_close", async () => {
    renderPalette();

    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    useUiStore.getState().setPaletteOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(dialog).toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    document.body.removeChild(trigger);
  });
});
