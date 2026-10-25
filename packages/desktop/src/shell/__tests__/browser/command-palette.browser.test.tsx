/// <reference types="vite/client" />
/**
 * Does the ⌘K palette open, filter and go where it says, with nothing thrown (issue #197)?
 *
 * Renders the real `<App />` in WebKit over the critique's seeded fake backend, so the palette is opened the two
 * ways a person opens it: the header's Search button and ⌘K. Before #197 both threw
 * `undefined is not an object (evaluating 'o.subscribe')` inside cmdk and took the whole tree down, because
 * `CommandDialog` rendered `CommandInput`/`CommandList`/`CommandItem` with no `<Command>` root above them. Any
 * uncaught error or unhandled rejection during a test fails it, so "no crash" is asserted, not assumed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import App from "../../../App";
import { installFixtureBackend } from "../../../test/critique/m2-fixture";

const errors: string[] = [];
const onError = (event: ErrorEvent) => errors.push(String(event.message));
const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));

async function boardReady() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
}

async function openFromButton() {
  await userEvent.click(screen.getByRole("button", { name: "Search, ⌘K" }));
  return screen.findByRole("dialog", { name: "Search Flywheel" });
}

async function type(text: string) {
  const input = await screen.findByPlaceholderText("Find a Story, a project or a place");
  await userEvent.fill(input, text);
  return input;
}

describe("the command palette", () => {
  beforeEach(() => {
    errors.length = 0;
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    resetUiState();
    queryClient.clear();
    installFixtureBackend();
  });
  afterEach(() => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    cleanup();
    clearMocks();
    expect(errors).toEqual([]);
  });

  it("opens from the Search button with its field focused", async () => {
    await boardReady();
    const dialog = await openFromButton();
    const input = within(dialog).getByPlaceholderText("Find a Story, a project or a place");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });

  it("opens from ⌘K, and Escape closes it", async () => {
    await boardReady();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Search Flywheel" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search Flywheel" })).toBeNull());
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it("filters as you type, and says so when nothing matches", async () => {
    await boardReady();
    const dialog = await openFromButton();
    await within(dialog).findByRole("option", { name: /FLY-4/ });
    await type("ghost cards");
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("FLY-10")]));
    // Words, not scattered letters: "set" is the start of Settings, and no Story whose title merely holds an
    // s, an e and a t in that order ("Prototype the dock as a modal sheet") comes along with it.
    await type("set");
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Settings")]));
    await type("zzzz no such thing");
    await within(dialog).findByText("Nothing matches.");
    expect(within(dialog).queryAllByRole("option")).toEqual([]);
  });

  it("opens a Story picked from it, and closes", async () => {
    await boardReady();
    await openFromButton();
    await type("FLY-9");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search Flywheel" })).toBeNull());
    expect(useUiStore.getState().currentStoryId).toBe("s-9");
    await screen.findAllByText("Answer a shaping Round in the dock");
  });

  it("switches to a project picked from it", async () => {
    await boardReady();
    const dialog = await openFromButton();
    await type("highknow");
    await userEvent.click(await within(dialog).findByRole("option", { name: /highknow-web/ }));
    await waitFor(() => expect(useUiStore.getState().currentProjectId).toBe("p-hkw"));
    await screen.findAllByText("Store waitlist sign-ups in Postgres");
  });

  it("goes to Settings picked from it", async () => {
    await boardReady();
    const dialog = await openFromButton();
    await type("settings");
    await userEvent.click(await within(dialog).findByRole("option", { name: /Settings/ }));
    await waitFor(() => expect(useUiStore.getState().settingsOpen).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search Flywheel" })).toBeNull());
  });
});
