/**
 * Behavior under test (10-07-PLAN.md Task 3, FLEET-05, D-176):
 *
 * - Exactly one notification switch renders, reflecting the stored value, with no per-project control.
 * - Toggling it calls the adapter wrapper once with the new value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsSurface } from "../SettingsSurface";
import type { SettingsDto } from "../../adapters/tauri";

const getSettingsMock = vi.fn();
const setNotificationsMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => Promise.resolve(command === "project_list" ? [] : undefined),
  getSettings: () => getSettingsMock(),
  settingsSetNotificationsEnabled: (value: boolean) => setNotificationsMock(value),
  setCredentialMode: vi.fn(),
  storeApiKey: vi.fn(),
  backendCapabilityProbe: () => Promise.resolve({ available: true, version: "2.1.0", apiKeyPathUsable: true }),
  listPermissionRules: () => Promise.resolve([]),
  revokePermissionRule: vi.fn(),
  openCommandTemplate: () => Promise.resolve("code {worktree_path}"),
  setOpenCommandTemplate: vi.fn(),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function fixture(notificationsEnabled: boolean): SettingsDto {
  return {
    globalCredentialMode: "local",
    projectOverrides: [{ projectId: "p1", projectName: "api", credentialMode: null }],
    apiKeyConfigured: false,
    apiKeyConfiguredAt: null,
    notificationsEnabled,
  };
}

function renderSettings() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSurface onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getSettingsMock.mockReset();
  setNotificationsMock.mockReset();
  getSettingsMock.mockResolvedValue(fixture(true));
  setNotificationsMock.mockResolvedValue(false);
});

describe("SettingsSurface — notification switch", () => {
  it("renders exactly one switch, checked from the stored value, even with projects registered", async () => {
    renderSettings();
    const box = (await screen.findByTestId("notifications-switch")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getAllByRole("checkbox", { name: /notify when an agent/i })).toHaveLength(1);
    expect(screen.getAllByTestId("notifications-switch")).toHaveLength(1);
  });

  it("reads an off value as unchecked", async () => {
    getSettingsMock.mockResolvedValue(fixture(false));
    renderSettings();
    expect(((await screen.findByTestId("notifications-switch")) as HTMLInputElement).checked).toBe(false);
  });

  it("toggling calls the setter once with the new value", async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId("notifications-switch"));
    await waitFor(() => expect(setNotificationsMock).toHaveBeenCalledTimes(1));
    expect(setNotificationsMock).toHaveBeenCalledWith(false);
  });
});
