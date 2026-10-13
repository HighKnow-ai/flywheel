/**
 * Behavior under test (11-06-PLAN.md Task 2, D-187, D-188):
 * - nothing renders without an update; with one, the version, the notes, accept and dismiss do;
 * - accepting with no live run installs once and says a relaunch applies it;
 * - with live runs the count is named and accept does not install;
 * - dismissal holds for that version only;
 * - a failed install shows its error and keeps the banner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpdateBanner } from "../UpdateBanner";
import { resetUiState } from "../../state/uiStore";
import type { UpdateCheckDto, UpdateInstallDto } from "../../adapters/tauri";

const updateCheckMock = vi.fn();
const updateInstallMock = vi.fn();
const fleetListMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  updateCheck: () => updateCheckMock(),
  updateInstall: () => updateInstallMock(),
  fleetList: () => fleetListMock(),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

function offer(version: string, overrides: Partial<UpdateCheckDto> = {}): UpdateCheckDto {
  return { available: true, version, notes: "- fix: a thing\n- feat: another", currentVersion: "0.1.0", ...overrides };
}

function fleet(...statuses: string[]) {
  return { rows: statuses.map((runStatus) => ({ runStatus })), totalRows: statuses.length, visibleCostUsd: null };
}

function installed(overrides: Partial<UpdateInstallDto> = {}): UpdateInstallDto {
  return { staged: true, refused: false, liveRuns: 0, version: "0.2.0", message: "Flywheel 0.2.0 is installed. Relaunch to use it.", ...overrides };
}

let queryClient: QueryClient;

function mount() {
  queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <UpdateBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  updateCheckMock.mockReset();
  updateInstallMock.mockReset();
  fleetListMock.mockReset();
  fleetListMock.mockResolvedValue(fleet());
});

afterEach(() => {
  resetUiState();
  cleanup();
});

describe("UpdateBanner", () => {
  it("renders nothing when no update is available", async () => {
    updateCheckMock.mockResolvedValue({ available: false, version: null, notes: null, currentVersion: "0.1.0" });
    mount();
    await waitFor(() => expect(updateCheckMock).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("names the version and the notes, with an accept and a dismiss action", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    mount();
    expect(await screen.findByText("Flywheel 0.2.0 is available")).toBeInTheDocument();
    expect(screen.getByText(/fix: a thing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install on relaunch" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
  });

  it("renders release notes as text, never as markup", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0", { notes: '<img src=x onerror="alert(1)"><a href="https://evil.example">go</a>' }));
    const { container } = mount();
    await screen.findByText("Flywheel 0.2.0 is available");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it("installs once with no live run and says a relaunch applies it", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    updateInstallMock.mockResolvedValue(installed());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Install on relaunch" }));
    expect(await screen.findByText("Flywheel 0.2.0 is installed. Relaunch to use it.")).toBeInTheDocument();
    expect(updateInstallMock).toHaveBeenCalledTimes(1);
  });

  it("names the live-run count and does not install while agents run", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    fleetListMock.mockResolvedValue(fleet("running", "blocked", "completed"));
    mount();
    expect(await screen.findByText(/2 agents running/)).toBeInTheDocument();
    const accept = screen.getByRole("button", { name: "Install on relaunch" });
    expect(accept).toBeDisabled();
    expect(accept).toHaveAccessibleDescription(/2 agents running/);
    fireEvent.click(accept);
    expect(updateInstallMock).not.toHaveBeenCalled();
  });

  it("dismisses for that version only", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();

    updateCheckMock.mockResolvedValue(offer("0.3.0"));
    await queryClient.invalidateQueries({ queryKey: ["update-check"] });
    expect(await screen.findByText("Flywheel 0.3.0 is available")).toBeInTheDocument();
  });

  it("shows Rust's refusal count when the fleet read showed no live run", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    updateInstallMock.mockResolvedValue(installed({ staged: false, refused: true, liveRuns: 1, message: "Not updating." }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Install on relaunch" }));
    expect(await screen.findByText(/1 agent running/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install on relaunch" })).toBeInTheDocument();
  });

  it("shows a failed install's error and keeps the banner", async () => {
    updateCheckMock.mockResolvedValue(offer("0.2.0"));
    updateInstallMock.mockRejectedValue("failed:update_install:download");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Install on relaunch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("failed:update_install:download");
    expect(screen.getByText("Flywheel 0.2.0 is available")).toBeInTheDocument();
  });
});
