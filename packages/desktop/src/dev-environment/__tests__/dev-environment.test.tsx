/**
 * Issue #786: the development builds' hidden Environment picker.
 *
 * - Nothing shows while the install talks to production; staging or a temporary Environment shows its name.
 * - ⌘⌥⇧E opens the picker, and so does the indicator; no other chord does.
 * - Choosing sends the tier and, for a temporary Environment only, the typed name; the indicator follows.
 * - A refused name is said in the picker, which stays open.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DevEnvironment, isPickerChord, type DevEnvironmentDto } from "../DevEnvironment";

const invokeMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
}));

const PRODUCTION: DevEnvironmentDto = { name: "production", apiOrigin: "https://api.highknow.ai", production: true };
const STAGING: DevEnvironmentDto = {
  name: "staging",
  apiOrigin: "https://staging-api.highknow.dev",
  production: false,
};
const DEMO: DevEnvironmentDto = { name: "env-demo", apiOrigin: "https://env-demo-api.highknow.dev", production: false };

let stored: DevEnvironmentDto;

function renderPicker() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DevEnvironment />
    </QueryClientProvider>,
  );
}

function pressChord(init: KeyboardEventInit = { metaKey: true, altKey: true, shiftKey: true }) {
  fireEvent.keyDown(window, { code: "KeyE", key: "´", ...init });
}

beforeEach(() => {
  stored = PRODUCTION;
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) =>
    command === "dev_environment_get" ? Promise.resolve(stored) : Promise.reject(new Error(`unexpected ${command}`)),
  );
});

describe("DevEnvironment", () => {
  it("shows nothing while the install talks to production", async () => {
    renderPicker();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("dev_environment_get", undefined));
    expect(screen.queryByRole("button", { name: /^Environment:/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names a non-production Environment in its indicator, which opens the picker", async () => {
    stored = STAGING;
    renderPicker();
    const indicator = await screen.findByRole("button", { name: "Environment: staging. Choose another" });
    expect(indicator).toHaveTextContent("staging");
    fireEvent.click(indicator);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "This build talks to staging, at https://staging-api.highknow.dev.",
    );
  });

  it("opens on ⌘⌥⇧E and on no other chord", async () => {
    renderPicker();
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    pressChord({ metaKey: true, shiftKey: true });
    pressChord({ metaKey: true, altKey: true });
    pressChord({ metaKey: true, altKey: true, shiftKey: true, ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    pressChord();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("chooses a temporary Environment by its typed name, and the indicator follows", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "dev_environment_get" ? Promise.resolve(stored) : Promise.resolve(DEMO),
    );
    renderPicker();
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    pressChord();
    fireEvent.click(await screen.findByRole("radio", { name: "Temporary" }));
    const submit = screen.getByRole("button", { name: "Use this Environment" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "demo" } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("dev_environment_choose", { tier: "temporary", name: "demo" }),
    );
    expect(await screen.findByRole("button", { name: "Environment: env-demo. Choose another" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends no name for staging", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "dev_environment_get" ? Promise.resolve(stored) : Promise.resolve(STAGING),
    );
    renderPicker();
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    pressChord();
    fireEvent.click(await screen.findByRole("radio", { name: "Staging" }));
    fireEvent.click(screen.getByRole("button", { name: "Use this Environment" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("dev_environment_choose", { tier: "staging", name: null }),
    );
  });

  it("says why a name was refused and stays open", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "dev_environment_get"
        ? Promise.resolve(stored)
        : Promise.reject("a temporary Environment's name is lower-case letters, digits and inner hyphens"),
    );
    renderPicker();
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    pressChord();
    fireEvent.click(await screen.findByRole("radio", { name: "Temporary" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "not ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this Environment" }));
    expect(await screen.findByText(/lower-case letters, digits and inner hyphens/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("isPickerChord", () => {
  it("reads the physical key, since ⌥ changes the character", () => {
    const chord = { metaKey: true, altKey: true, shiftKey: true, ctrlKey: false };
    expect(isPickerChord(new KeyboardEvent("keydown", { ...chord, code: "KeyE", key: "´" }))).toBe(true);
    expect(isPickerChord(new KeyboardEvent("keydown", { ...chord, code: "KeyR", key: "E" }))).toBe(false);
  });
});
