/**
 * Behavior under test (Phase 7 plan 07-05, LINK-04/D-127/D-128): pasting a commit hash or a
 * `flywheel/` branch name into the existing command palette resolves it to its board item, ahead
 * of the fuzzy matches, with ordinary text search spending no IPC call. A sibling of
 * `palette.test.tsx`, not an edit of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "../CommandPalette";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { GitIdentityOutcomeDto } from "../../adapters/tauri";

const invokeCommandMock = vi.fn();
const gitIdentifierResolveMock = vi.fn<(raw: string) => Promise<GitIdentityOutcomeDto>>();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  gitIdentifierResolve: (raw: string) => gitIdentifierResolveMock(raw),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const BRANCH = "flywheel/fly-42-some-title";

const RESOLVED_TASK: GitIdentityOutcomeDto = {
  outcome: "resolved",
  resolution: {
    projectId: "proj-a",
    itemKind: "task",
    itemId: "task-1",
    itemKey: "FLY-42",
    itemTitle: "Fix login bug",
    matchedSha: HASH,
    runId: "run-abc123",
  },
};

const RESOLVED_EPIC: GitIdentityOutcomeDto = {
  outcome: "resolved",
  resolution: {
    projectId: "proj-b",
    itemKind: "epic",
    itemId: "epic-1",
    itemKey: "FLY-9",
    itemTitle: "Ship the thing",
    matchedSha: null,
    runId: null,
  },
};

const NOT_FOUND: GitIdentityOutcomeDto = { outcome: "notFound" };

function renderPalette() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

async function openPaletteAndType(value: string) {
  renderPalette();
  useUiStore.getState().setPaletteOpen(true);
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = screen.getByRole("textbox", { name: "Command search" });
  fireEvent.change(input, { target: { value } });
  return dialog;
}

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  gitIdentifierResolveMock.mockReset();
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
  gitIdentifierResolveMock.mockResolvedValue(NOT_FOUND);
});

afterEach(() => {
  resetUiState();
});

describe("CommandPalette git identifier resolution", () => {
  it("typing_a_resolving_hash_appends_one_entry_ahead_of_fuzzy_matches", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) =>
      Promise.resolve(raw === HASH ? RESOLVED_TASK : NOT_FOUND),
    );
    const dialog = await openPaletteAndType(HASH);

    const options = await waitFor(() => {
      const found = dialog.querySelectorAll('[role="option"]');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(options[0].textContent).toContain("FLY-42");
    expect(options[0].textContent).toContain("Fix login bug");
  });

  it("activating_the_resolved_entry_navigates_and_closes_the_palette", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) =>
      Promise.resolve(raw === HASH ? RESOLVED_TASK : NOT_FOUND),
    );
    const dialog = await openPaletteAndType(HASH);

    const option = await waitFor(() => {
      const found = dialog.querySelector('[role="option"]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(useUiStore.getState().currentProjectId).toBe("proj-a");
      expect(useUiStore.getState().selectedItemId).toBe("task-1");
      expect(useUiStore.getState().detailItemId).toBe("task-1");
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });
  });

  it("typing_a_resolving_branch_name_behaves_identically", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) =>
      Promise.resolve(raw === BRANCH ? RESOLVED_EPIC : NOT_FOUND),
    );
    const dialog = await openPaletteAndType(BRANCH);

    const options = await waitFor(() => {
      const found = dialog.querySelectorAll('[role="option"]');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(options[0].textContent).toContain("FLY-9");
    expect(options[0].textContent).toContain("Ship the thing");
  });

  it("typing_ordinary_text_makes_no_resolve_call", async () => {
    await openPaletteAndType("create a new task please");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    });
    expect(gitIdentifierResolveMock).not.toHaveBeenCalled();
  });

  it("empty_query_makes_no_resolve_call", async () => {
    renderPalette();
    useUiStore.getState().setPaletteOpen(true);
    await screen.findByRole("dialog", { name: "Command palette" });

    expect(gitIdentifierResolveMock).not.toHaveBeenCalled();
  });

  it("a_hash_that_resolves_to_nothing_appends_no_entry_and_shows_no_error", async () => {
    gitIdentifierResolveMock.mockResolvedValue(NOT_FOUND);
    const dialog = await openPaletteAndType(HASH);

    await waitFor(() => expect(gitIdentifierResolveMock).toHaveBeenCalledWith(HASH));
    const options = dialog.querySelectorAll('[role="option"]');
    for (const option of Array.from(options)) {
      expect(option.textContent ?? "").not.toMatch(/ambiguous/i);
    }
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("an_ambiguous_prefix_outcome_appends_one_non_activatable_entry_naming_the_count", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) =>
      Promise.resolve(raw === HASH ? { outcome: "ambiguousPrefix", matches: 3 } : NOT_FOUND),
    );
    const dialog = await openPaletteAndType(HASH);

    const option = await waitFor(() => {
      const found = Array.from(dialog.querySelectorAll('[role="option"]')).find((el) =>
        (el.textContent ?? "").includes("3"),
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(option.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(option);
    // A disabled option's own click handler never fires `run()` — the palette must stay open.
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("an_ambiguous_across_repositories_outcome_appends_one_non_activatable_entry", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) =>
      Promise.resolve(raw === HASH ? { outcome: "ambiguousAcrossRepositories", repositories: 2 } : NOT_FOUND),
    );
    const dialog = await openPaletteAndType(HASH);

    const option = await waitFor(() => {
      const found = Array.from(dialog.querySelectorAll('[role="option"]')).find((el) =>
        (el.textContent ?? "").toLowerCase().includes("repositories"),
      );
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });

  it("only_one_git_identifier_entry_is_present_when_a_hash_then_a_branch_are_typed_in_sequence", async () => {
    gitIdentifierResolveMock.mockImplementation((raw) => {
      if (raw === HASH) return Promise.resolve(RESOLVED_TASK);
      if (raw === BRANCH) return Promise.resolve(RESOLVED_EPIC);
      return Promise.resolve(NOT_FOUND);
    });
    const dialog = await openPaletteAndType(HASH);
    const input = screen.getByRole("textbox", { name: "Command search" });

    await waitFor(() => {
      const found = Array.from(dialog.querySelectorAll('[role="option"]')).filter((el) =>
        (el.textContent ?? "").includes("FLY-42"),
      );
      expect(found).toHaveLength(1);
    });

    fireEvent.change(input, { target: { value: BRANCH } });

    await waitFor(() => {
      const gitEntries = Array.from(dialog.querySelectorAll('[role="option"]')).filter(
        (el) => (el.textContent ?? "").includes("FLY-42") || (el.textContent ?? "").includes("FLY-9"),
      );
      expect(gitEntries).toHaveLength(1);
      expect(gitEntries[0].textContent).toContain("FLY-9");
    });
  });
});
