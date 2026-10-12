/**
 * Behavior under test (09-04-PLAN.md Task 2, PLAN-06, D-159):
 *
 * - The parallel-width control renders with the stored cap as its value and an accessible name
 *   saying what it caps.
 * - It offers exactly the integers 1 through 8: 0 and 9 are unreachable from the UI.
 * - Choosing an option issues exactly one set call carrying that integer.
 * - The occupied-slot count from `settings_get` is shown beside the cap.
 * - A refused set leaves the displayed value at the stored one and shows the returned error text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsSurface } from "../SettingsSurface";
import type { SettingsDto } from "../../adapters/tauri";

const getSettingsMock = vi.fn();
const setCapMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) =>
    Promise.resolve(command === "project_list" ? [] : undefined),
  getSettings: () => getSettingsMock(),
  settingsSetDispatchMaxParallel: (value: number) => setCapMock(value),
  setCredentialMode: vi.fn(),
  storeApiKey: vi.fn(),
  backendCapabilityProbe: () => Promise.resolve({ available: true, version: "2.1.0", apiKeyPathUsable: true }),
  listPermissionRules: () => Promise.resolve([]),
  revokePermissionRule: vi.fn(),
  openCommandTemplate: () => Promise.resolve("code {worktree_path}"),
  setOpenCommandTemplate: vi.fn(),
  projectForgeOverrides: () => Promise.resolve([]),
  settingsSetProjectForge: vi.fn(),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function settingsFixture(maxParallel: number, occupiedSlots: number): SettingsDto {
  return {
    globalCredentialMode: "local",
    projectOverrides: [],
    apiKeyConfigured: false,
    apiKeyConfiguredAt: null,
    dispatchCap: { maxParallel, occupiedSlots },
    notificationsEnabled: true,
  };
}

function renderSettings() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSurface onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function capControl() {
  return (await screen.findByRole("combobox", { name: /parallel agent sessions/i })) as HTMLSelectElement;
}

beforeEach(() => {
  getSettingsMock.mockReset();
  setCapMock.mockReset();
  getSettingsMock.mockResolvedValue(settingsFixture(3, 2));
  setCapMock.mockResolvedValue({ maxParallel: 5, occupiedSlots: 2 });
});

describe("SettingsSurface — global parallel cap", () => {
  it("renders the stored cap as the control's value under an accessible name", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture(6, 0));
    renderSettings();
    expect((await capControl()).value).toBe("6");
  });

  it("offers exactly the integers 1 through 8 and no others", async () => {
    renderSettings();
    const options = Array.from((await capControl()).options).map((o) => o.value);
    expect(options).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(options).not.toContain("0");
    expect(options).not.toContain("9");
  });

  it("choosing an option issues exactly one set call carrying that integer", async () => {
    renderSettings();
    fireEvent.change(await capControl(), { target: { value: "5" } });
    await waitFor(() => expect(setCapMock).toHaveBeenCalledTimes(1));
    expect(setCapMock).toHaveBeenCalledWith(5);
  });

  it("shows how many slots are in use beside the cap", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture(3, 3));
    renderSettings();
    await capControl();
    expect(screen.getByTestId("dispatch-cap-occupancy").textContent).toBe("3 of 3 slots in use");
  });

  it("a refused set keeps the displayed value at the stored one and shows the returned error", async () => {
    setCapMock.mockRejectedValue("parallel agent cap must be between 1 and 8, got 9");
    renderSettings();
    const control = await capControl();
    fireEvent.change(control, { target: { value: "7" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("between 1 and 8");
    expect(control.value).toBe("3");
  });
});
