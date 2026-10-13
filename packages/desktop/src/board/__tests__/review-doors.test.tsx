/**
 * Behavior under test (08-04-PLAN.md, D-133): the board keystroke and the command palette are two
 * of the four doors onto the review surface. Assertions read the `reviewSurface` store field
 * directly so this file does not depend on the review surface's own markup. Harness follows
 * `keyboard-nav.test.tsx` (board) and `command-palette-resolve.test.tsx` (palette).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { CommandPalette } from "../CommandPalette";
import { bindingAllowedInLayer } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { GitIdentityOutcomeDto } from "../../adapters/tauri";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();
const gitIdentifierResolveMock = vi.fn<(raw: string) => Promise<GitIdentityOutcomeDto>>();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  gitIdentifierResolve: (raw: string) => gitIdentifierResolveMock(raw),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
}));

const COUNTS: BandCounts = { backlog: 2, todo: 0, inProgress: 0, inReview: 0, done: 0 };
const TASK: BoardItem = { id: "t1", key: "FLY-1", title: "A task", status: "backlog", rank: "10", priority: 0, epicId: null };
const EPIC: BoardItem = { ...TASK, id: "e1", key: "FLY-2", title: "An epic", rank: "20", kind: "epic" };

beforeEach(() => {
  resetUiState();
  showStatusBands();
  invokeCommandMock.mockReset();
  gitIdentifierResolveMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list" || command === "project_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  gitIdentifierResolveMock.mockResolvedValue({ outcome: "notFound" });
});

afterEach(() => resetUiState());

function renderBoard(items: BoardItem[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardView projectId="proj-1" items={items} counts={COUNTS} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
  return screen.getByRole("list", { name: "Board" });
}

describe("board keystroke door", () => {
  it("opens task scope on a task row", () => {
    const list = renderBoard([TASK, EPIC]);
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "v" });
    expect(useUiStore.getState().reviewSurface).toEqual({ scope: "task", itemId: "t1", label: "FLY-1 A task" });
  });

  it("opens epic scope on an epic row", () => {
    const list = renderBoard([TASK, EPIC]);
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "v" });
    expect(useUiStore.getState().reviewSurface).toEqual({ scope: "epic", itemId: "e1", label: "FLY-2 An epic" });
  });

  it("opens nothing on an issue row (a kind with no acceptance criteria)", () => {
    // The board list never selects issues; the cast proves the action's own refusal anyway.
    const list = renderBoard([{ ...TASK, kind: "issue" as never }]);
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "v" });
    expect(useUiStore.getState().reviewSurface).toBeNull();
  });

  it("opens nothing with no row focused", () => {
    const list = renderBoard([TASK]);
    fireEvent.keyDown(list, { key: "v" });
    expect(useUiStore.getState().reviewSurface).toBeNull();
  });

  it("is permitted in the board layer and refused in the review-surface layer", () => {
    expect(bindingAllowedInLayer("open-review", "board")).toBe(true);
    expect(bindingAllowedInLayer("open-review", "review-surface")).toBe(false);
  });

  it("keeps the review surface's own expand key unreachable from the board", () => {
    expect(bindingAllowedInLayer("expand-file", "board")).toBe(false);
    expect(bindingAllowedInLayer("expand-file", "quick-add")).toBe(false);
    expect(bindingAllowedInLayer("expand-file", "review-surface")).toBe(true);
  });
});

const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const BRANCH = "flywheel/fly-42-some-title";
const resolved = (itemKind: string, matchedSha: string | null): GitIdentityOutcomeDto => ({
  outcome: "resolved",
  resolution: {
    projectId: "proj-a",
    itemKind,
    itemId: "task-1",
    itemKey: "FLY-42",
    itemTitle: "Fix login bug",
    matchedSha,
    runId: null,
  },
});

async function typeInPalette(value: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommandPalette />
    </QueryClientProvider>,
  );
  useUiStore.getState().setPaletteOpen(true);
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.change(screen.getByRole("textbox", { name: "Command search" }), { target: { value } });
  return dialog;
}

async function reviewOption(dialog: HTMLElement) {
  return waitFor(() => {
    const found = Array.from(dialog.querySelectorAll('[role="option"]')).find((el) =>
      (el.textContent ?? "").startsWith("Review"),
    );
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
}

describe("command palette door", () => {
  it.each([
    ["a branch name", BRANCH, resolved("task", null)],
    ["a commit sha", HASH, resolved("task", HASH)],
  ])("offers a review entry for %s and opens task scope", async (_name, typed, outcome) => {
    gitIdentifierResolveMock.mockImplementation((raw) => Promise.resolve(raw === typed ? outcome : { outcome: "notFound" }));
    const dialog = await typeInPalette(typed);
    fireEvent.click(await reviewOption(dialog));

    expect(useUiStore.getState().reviewSurface).toEqual({ scope: "task", itemId: "task-1", label: "FLY-42 Fix login bug" });
    expect(useUiStore.getState().detailItemId).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("uses epic scope for a resolved epic", async () => {
    gitIdentifierResolveMock.mockResolvedValue(resolved("epic", null));
    const dialog = await typeInPalette(BRANCH);
    fireEvent.click(await reviewOption(dialog));
    expect(useUiStore.getState().reviewSurface?.scope).toBe("epic");
  });

  it("keeps the detail route as the default first entry", async () => {
    gitIdentifierResolveMock.mockResolvedValue(resolved("task", HASH));
    const dialog = await typeInPalette(HASH);
    await reviewOption(dialog);
    const options = dialog.querySelectorAll('[role="option"]');
    expect(options[0].textContent).toContain("FLY-42");
    fireEvent.click(options[0]);
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-1"));
    expect(useUiStore.getState().reviewSurface).toBeNull();
  });
});
