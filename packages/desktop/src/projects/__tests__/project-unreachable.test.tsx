/**
 * Issue #210 (critique F7): an unreachable project keeps the shell's top bar, draws Empty with an Alert naming
 * where Flywheel looked, and offers two answers: Locate project… and Remove from Flywheel…, the second
 * confirmed in ConfirmDestructive. A failed Locate is an Alert with a human line and the raw detail folded away.
 * The rail beside it is proved in `unreachable-in-app.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectUnreachable } from "../ProjectUnreachable";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { Project } from "../../board/useBoardQuery";

const invokeCommandMock = vi.fn();
const openFolderMock = vi.fn();
const projectHideMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  openFolderDialog: () => openFolderMock(),
  projectHide: (projectId: string) => projectHideMock(projectId),
}));

const GONE: Project = {
  id: "proj-2",
  keyPrefix: "GONE",
  name: "Gone",
  repoPath: "/Users/dev/repos/gone",
  defaultBranch: "main",
  status: "unreachable",
};
const HEALTHY: Project = { ...GONE, id: "proj-1", name: "Flywheel", repoPath: "/r/flywheel", status: "active" };

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectUnreachable project={GONE} projects={[HEALTHY, GONE]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset().mockResolvedValue(undefined);
  openFolderMock.mockReset().mockResolvedValue(null);
  projectHideMock.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("ProjectUnreachable (issue #210)", () => {
  it("keeps the top bar, with the project's name as the page", () => {
    renderSurface();
    const crumbs = screen.getByRole("navigation", { name: "You are here" });
    expect(within(crumbs).getByText("Gone")).toBeInTheDocument();
  });

  it("is Empty with an Alert naming the path Flywheel expected", () => {
    renderSurface();
    const heading = screen.getByRole("heading", { level: 1, name: "Can’t find this project" });
    const empty = heading.closest("[data-slot=empty]") as HTMLElement;
    expect(empty).not.toBeNull();
    const alert = within(empty).getByRole("alert");
    expect(alert).toHaveAttribute("data-slot", "alert");
    expect(within(alert).getByText("/Users/dev/repos/gone")).toBeInTheDocument();
    expect(within(alert).getByText(/Nothing was scanned or guessed automatically/)).toBeInTheDocument();
  });

  it("offers Locate project… as the primary, which relocates to the folder picked", async () => {
    openFolderMock.mockResolvedValue("/Users/dev/elsewhere/gone");
    renderSurface();
    const locate = screen.getByRole("button", { name: "Locate project…" });
    expect(locate).toHaveAttribute("data-variant", "default");
    fireEvent.click(locate);
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("project_relocate", {
        projectId: "proj-2",
        newRepoPath: "/Users/dev/elsewhere/gone",
      }),
    );
  });

  it("says a failed Locate as an Alert with a human line, the raw message behind Details", async () => {
    openFolderMock.mockResolvedValue("/tmp/wrong");
    invokeCommandMock.mockRejectedValue("marker mismatch at /tmp/wrong");
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "Locate project…" }));
    const title = await screen.findByText("Couldn’t locate this project");
    const failure = title.closest("[data-slot=action-failure]") as HTMLElement;
    expect(within(failure).getByText(/Pick the folder/)).toBeInTheDocument();
    expect(within(failure).queryByText("marker mismatch at /tmp/wrong")).toBeNull();
    expect(within(failure).getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("offers Remove from Flywheel…, which confirms before hiding the project and lands on another", async () => {
    renderSurface();
    const remove = screen.getByRole("button", { name: "Remove from Flywheel…" });
    expect(remove).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(remove);

    const confirm = await screen.findByRole("alertdialog", { name: "Remove Gone from Flywheel?" });
    expect(projectHideMock).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove the project" }));

    await waitFor(() => expect(projectHideMock).toHaveBeenCalledWith("proj-2"));
    await waitFor(() => expect(useUiStore.getState().currentProjectId).toBe("proj-1"));
  });

  it("keeps the project when the confirm is cancelled", async () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "Remove from Flywheel…" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(projectHideMock).not.toHaveBeenCalled();
  });
});
