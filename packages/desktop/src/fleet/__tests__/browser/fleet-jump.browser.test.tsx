/**
 * Where a fleet row takes you, in WebKit with real key events (plan 11-15, D-REV-51).
 *
 * `jump.test.tsx` asserts the same destinations in jsdom, where a key press is a synthetic event fired at
 * `window`. This file mounts the same real shell (`<App />`, which renders AppShell) in the browser arm,
 * over the same stubbed adapter, and presses keys through Playwright's keyboard, so the shortcuts the
 * fleet binds (`j`, Enter, `b`) are exercised through the engine's own key handling.
 *
 * What it proves: Enter on a selected row and a click both replace the fleet with that run's session; the
 * session's Back returns to the fleet; the `b` key on a row in another project switches the project and
 * opens that item's detail panel. What it does NOT prove: the Tauri IPC behind any read (the adapter is
 * stubbed), and that a packaged WKWebView delivers the same key events (this is Playwright's WebKit build,
 * not the shipped one).
 *
 * Runs in both colour schemes under the browser configs; nothing here depends on the scheme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import type { FleetListDto, FleetRowDto } from "../../../adapters/tauri";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import App from "../../../App";

const served = vi.hoisted(() => ({ fleet: undefined as unknown, commands: [] as string[] }));

const PROJECTS = [
  { id: "proj-A", keyPrefix: "ALP", name: "Alpha", repoPath: "/repo/alpha", defaultBranch: "main", status: "active" },
  { id: "proj-B", keyPrefix: "BET", name: "Beta", repoPath: "/repo/beta", defaultBranch: "main", status: "active" },
];
const BOARDS: Record<string, unknown[]> = {
  "proj-A": [{ id: "story-a1", key: "ALP-1", title: "Alpha one", status: "backlog", rank: "10", priority: 0, epicId: null }],
  "proj-B": [{ id: "story-b7", key: "BET-7", title: "Beta seven", status: "backlog", rank: "10", priority: 0, epicId: null }],
};

vi.mock(import("../../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  invokeCommand: ((command: string, args?: Record<string, unknown>) => {
    served.commands.push(command);
    if (command === "project_list") return Promise.resolve(PROJECTS);
    if (command === "board_list" || command === "board_search") {
      const items = BOARDS[(args?.projectId as string) ?? ""] ?? [];
      return Promise.resolve({ items, issues: [], counts: { backlog: items.length, todo: 0, inProgress: 0, inReview: 0, done: 0 } });
    }
    if (command === "actor_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  }) as never,
  fleetList: () => Promise.resolve(served.fleet as FleetListDto),
  fleetBlockedQueue: () => Promise.resolve([]),
  fleetWatchRun: () => Promise.resolve(),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusStory: () => Promise.resolve(),
  sessionLogWindow: (_id: string, offset: number, limit: number) =>
    Promise.resolve({
      entries: [{ type: "assistant_text", seq: 0, at: new Date().toISOString(), raw: "{}", text: "Reading the reconciliation module." }],
      offset,
      limit,
      total: 1,
    }),
  sessionRawWindow: (_id: string, offset: number, limit: number) => Promise.resolve({ entries: [], offset, limit, total: 0 }),
  pendingPermissionRequests: () => Promise.resolve([]),
}));

function fleetRow(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    sessionId: "run-b",
    projectId: "proj-B",
    projectName: "Beta",
    projectKeyPrefix: "BET",
    projectStatus: "active",
    storyId: "story-b7",
    storyKey: "BET-7",
    storyTitle: "Beta seven",
    storyState: "running",
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date(Date.now() - 125_000).toISOString(),
    endedAt: null,
    blockedSince: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    doingTaskTitle: null,
    activity: { lines: [], truncated: false },
    ...overrides,
  };
}

async function mountOnFleet(currentProjectId = "proj-A") {
  served.fleet = { rows: [fleetRow({})], totalRows: 1, visibleCostUsd: null } satisfies FleetListDto;
  useUiStore.setState({ currentProjectId, fleetSurface: { view: "fleet" } });
  const view = render(<App />);
  await waitFor(() => expect(view.container.querySelector("[data-run-id]")).not.toBeNull());
  return view;
}

const sessionBack = () => document.querySelector<HTMLElement>(".session-back");
const fleetRows = () => document.querySelectorAll("[data-run-id]");

beforeEach(() => {
  resetUiState();
  queryClient.clear();
  served.commands.length = 0;
  (document.activeElement as HTMLElement | null)?.blur();
});
afterEach(() => {
  cleanup();
  resetUiState();
});

describe("AppShell in WebKit: where a fleet row takes you, with real key presses", () => {
  it("j then Enter replaces the fleet with that run's session, and Back returns to it", async () => {
    await mountOnFleet();
    await userEvent.keyboard("j");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(fleetRows().length, "the fleet gave way to the session").toBe(0);
    expect(useUiStore.getState().activeSessionId).toBe("run-b");
    await waitFor(() => expect(document.body.textContent).toContain("Reading the reconciliation module."));

    await userEvent.click(sessionBack() as HTMLElement);

    await waitFor(() => expect(fleetRows().length).toBe(1));
    expect(sessionBack()).toBeNull();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });

  it("a real click on the row opens the same session", async () => {
    const { container } = await mountOnFleet();
    await userEvent.click(container.querySelector('[data-run-id="run-b"] [data-field="state"]') as HTMLElement);
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(useUiStore.getState().activeSessionId).toBe("run-b");
  });

  it("j then b on a row in another project switches the project and opens that item's detail panel", async () => {
    await mountOnFleet("proj-A");
    expect(useUiStore.getState().currentProjectId).toBe("proj-A");
    await userEvent.keyboard("j");
    await userEvent.keyboard("b");
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("story-b7"));
    expect(useUiStore.getState().currentProjectId).toBe("proj-B");
    expect(useUiStore.getState().activeSessionId, "the jump to the item never opens the session").toBeNull();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("BET-7");
    expect(fleetRows().length).toBe(0);
  });

  it("clicking the subject key does the same, and does not also open the session", async () => {
    const { container } = await mountOnFleet("proj-A");
    await userEvent.click(container.querySelector("[data-subject-target]") as HTMLElement);
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("story-b7"));
    expect(useUiStore.getState().currentProjectId).toBe("proj-B");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });
});
