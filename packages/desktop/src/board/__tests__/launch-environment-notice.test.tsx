/**
 * Issue #88: a missing `claude` and an unreadable login shell are said on screen, naming the PATH;
 * a healthy environment shows nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useUiStore } from "../../state/uiStore";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchEnvironmentNotice } from "../LaunchEnvironmentNotice";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => invokeCommandMock(command),
}));

function renderNotice() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LaunchEnvironmentNotice />
    </QueryClientProvider>,
  );
}

beforeEach(() => invokeCommandMock.mockReset());

describe("LaunchEnvironmentNotice", () => {
  it("names the searched PATH when claude is missing", async () => {
    const searched = "/usr/bin:/bin:/usr/sbin:/sbin";
    invokeCommandMock.mockResolvedValue({
      path: searched,
      pathWarning: null,
      claudeError: `claude was not found on the PATH Flywheel searched: ${searched}.`,
    });
    renderNotice();
    const alert = await screen.findByRole("alert", { name: "Launch environment" });
    expect(alert.textContent).toContain(searched);
    expect(invokeCommandMock).toHaveBeenCalledWith("launch_environment");
  });

  it("shows the fallback warning when the login shell could not be read", async () => {
    invokeCommandMock.mockResolvedValue({
      path: "/usr/bin:/bin",
      pathWarning: "Flywheel could not read your login shell's PATH (/bin/zsh took longer than 5s)",
      claudeError: null,
    });
    renderNotice();
    expect((await screen.findByRole("alert")).textContent).toContain("took longer than 5s");
  });

  it("shows nothing when the PATH was read and claude is on it", async () => {
    invokeCommandMock.mockResolvedValue({ path: "/opt/homebrew/bin:/usr/bin", pathWarning: null, claudeError: null });
    renderNotice();
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("LaunchEnvironmentNotice — the reserved slot (issue #210, critique F6)", () => {
  it("is an Alert in the layout's flow, never fixed over the andon strip", async () => {
    invokeCommandMock.mockResolvedValue({
      path: "/usr/bin",
      pathWarning: null,
      claudeError: "claude was not found on the PATH Flywheel searched: /usr/bin.",
    });
    renderNotice();
    const alert = await screen.findByRole("alert", { name: "Launch environment" });
    expect(alert).toHaveAttribute("data-slot", "alert");
    for (let node: HTMLElement | null = alert; node; node = node.parentElement) {
      expect(node.style.position).not.toBe("fixed");
      expect(node.className).not.toMatch(/\bfixed\b|\babsolute\b/);
    }
    expect(screen.getByText("Flywheel can’t find claude")).toBeInTheDocument();
  });

  it("offers Open Settings, which opens Settings", async () => {
    useUiStore.getState().setSettingsOpen(false);
    invokeCommandMock.mockResolvedValue({ path: "/usr/bin", pathWarning: null, claudeError: "claude was not found." });
    renderNotice();
    fireEvent.click(await screen.findByRole("button", { name: "Open Settings" }));
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });
});
