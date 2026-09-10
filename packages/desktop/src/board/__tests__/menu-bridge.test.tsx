/**
 * Regression test for UAT gap G-01-1 (01-16-PLAN.md): on macOS the native menu owns `⌘N` as an
 * accelerator, so the keystroke never reaches the webview and `useGlobalBindings`'s layer guard
 * never runs for it. `App.tsx`'s `menu:action` bridge used to treat every forwarded id as an
 * unambiguous click and call `returnToBoardLayer()` before dispatching — which meant a keystroke
 * that beat the round trip (the real accelerator path) tore down the very layer it was supposed
 * to be blocked by (01-UAT.md gap G-01-1's `root_cause`).
 *
 * This is the first test in the repo to drive the REAL `menu:action` subscription end to end —
 * every other suite (`layer-guard.test.tsx`, `project-rail.test.tsx`, …) stubs
 * `subscribeMenuAction` to a no-op (`() => Promise.resolve(() => {})`), which is exactly why this
 * bug shipped green. The mock below captures the handler `AppShell`'s effect passes in so this
 * file can invoke it directly, the way `on_menu_event` → `menu:action` would in a real build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "../../App";
import { BINDINGS, MENU_ACTION_IDS } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem, Project } from "../useBoardQuery";

const invokeCommandMock = vi.fn();
const openFolderDialogMock = vi.fn(() => Promise.resolve<string | null>(null));

/** Captures the real handler `AppShell`'s `useEffect` passes to `subscribeMenuAction` — never a
 * no-op stub (see the file doc comment). The returned unlisten clears it, mirroring the real
 * adapter's contract (`adapters/tauri.ts`'s `subscribeMenuAction` returns Tauri's `UnlistenFn`). */
let capturedMenuActionHandler: ((actionId: string) => void) | null = null;

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: (handler: (actionId: string) => void) => {
    capturedMenuActionHandler = handler;
    return Promise.resolve(() => {
      capturedMenuActionHandler = null;
    });
  },
  openFolderDialog: () => openFolderDialogMock(),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const PROJECTS: Project[] = [
  { id: "proj-1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/repo/flywheel", defaultBranch: "main", status: "active" },
];

const ITEMS: BoardItem[] = [
  { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "10", priority: 0, epicId: null },
];

beforeEach(() => {
  resetUiState();
  capturedMenuActionHandler = null;
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve(PROJECTS);
    if (command === "board_list") {
      return Promise.resolve({ items: ITEMS, issues: [], counts: { ...EMPTY_COUNTS, backlog: ITEMS.length } });
    }
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "events_activity_trail") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  openFolderDialogMock.mockReset();
  openFolderDialogMock.mockResolvedValue(null);
});

afterEach(() => {
  resetUiState();
  cleanup();
});

/** Renders the real app and waits for the board to mount. `BoardView` — not `AppShell` alone —
 * is what registers `create-task`/`create-epic`'s global handlers (`BoardView.tsx`'s own
 * `useGlobalBindings` call), so the menu bridge has nothing to dispatch into until the board
 * itself is up. Also waits for `subscribeMenuAction`'s promise to resolve so
 * `capturedMenuActionHandler` is populated before a test tries to call it. */
async function renderApp() {
  render(<App />);
  await screen.findByText("Flywheel");
  await waitFor(() => expect(capturedMenuActionHandler).not.toBeNull());
}

/** Same store fields `layer-guard.test.tsx`'s `openDetailPanel` sets — driving the store
 * directly rather than a keystroke, since this file is about what the menu bridge does once a
 * layer is already open, not about how the layer got there. `BoardView`'s panel renders off the
 * SELECTED item, not off `detailItemId` alone. */
function openDetailPanel(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
    useUiStore.getState().setDetailItemId(id);
  });
}

/** Invokes the captured `menu:action` handler exactly as `on_menu_event` → `menu:action` would
 * over IPC — never a synthesized keydown, so this exercises the actual bridge under test. */
function emitMenuAction(actionId: string) {
  act(() => {
    capturedMenuActionHandler?.(actionId);
  });
}

describe("menu-bridge (G-01-1)", () => {
  describe("with the item detail panel open", () => {
    it("create-task leaves the panel open and does not open quick-add", async () => {
      await renderApp();
      openDetailPanel("1");

      emitMenuAction("create-task");

      expect(useUiStore.getState().quickAddOpen).toBe(false);
      expect(useUiStore.getState().detailItemId).toBe("1");
    });

    it("create-epic leaves the panel open and does not open quick-add", async () => {
      await renderApp();
      openDetailPanel("1");

      emitMenuAction("create-epic");

      expect(useUiStore.getState().quickAddOpen).toBe(false);
      expect(useUiStore.getState().detailItemId).toBe("1");
    });

    it("register-project leaves the panel open and never opens the native folder dialog", async () => {
      await renderApp();
      openDetailPanel("1");

      emitMenuAction("register-project");

      expect(openFolderDialogMock).not.toHaveBeenCalled();
      expect(useUiStore.getState().detailItemId).toBe("1");
    });

    it("open-palette opens the palette OVER the panel — the panel is not replaced (BOARD-07)", async () => {
      await renderApp();
      openDetailPanel("1");

      emitMenuAction("open-palette");

      expect(useUiStore.getState().paletteOpen).toBe(true);
      // The palette opens over the panel, it does not replace it.
      expect(useUiStore.getState().detailItemId).toBe("1");
    });
  });

  describe("with a row-level picker open", () => {
    it("open-palette is refused, matching bindingAllowedInLayer under a picker", async () => {
      await renderApp();
      act(() => {
        useUiStore.getState().setActivePicker({ kind: "status", id: "1" });
      });

      emitMenuAction("open-palette");

      expect(useUiStore.getState().paletteOpen).toBe(false);
    });
  });

  describe("with nothing open", () => {
    it("create-task still opens quick-add for a task", async () => {
      await renderApp();

      emitMenuAction("create-task");

      expect(useUiStore.getState().quickAddOpen).toBe(true);
      expect(useUiStore.getState().quickAddKind).toBe("task");
    });

    it("create-epic still opens quick-add for an epic", async () => {
      await renderApp();

      emitMenuAction("create-epic");

      expect(useUiStore.getState().quickAddOpen).toBe(true);
      expect(useUiStore.getState().quickAddKind).toBe("epic");
    });

    it("register-project still opens the native folder dialog", async () => {
      await renderApp();

      emitMenuAction("register-project");

      expect(openFolderDialogMock).toHaveBeenCalled();
    });

    it("open-palette still opens the palette", async () => {
      await renderApp();

      emitMenuAction("open-palette");

      expect(useUiStore.getState().paletteOpen).toBe(true);
    });
  });

  it("every MENU_ACTION_IDS entry resolves to a global BINDINGS entry with a key — state/keyboard.ts stays the sole key map", () => {
    for (const id of MENU_ACTION_IDS) {
      const binding = BINDINGS.find((b) => b.id === id && b.region === "global");
      expect(binding, `expected a global binding for menu action "${id}"`).toBeDefined();
      expect(binding?.key, `expected a key for menu action "${id}"`).toBeTruthy();
    }
  });
});

/**
 * `useMenuLayerSync` (01-16-PLAN.md Task 3): pushes the layer guard's verdict onto the native
 * menu bar via `menu_set_action_enabled`, so a trapped layer greys the forwarded items instead of
 * leaving them enabled-but-dead. This is the affordance half of G-01-1's fix — the enforcement
 * half (Task 1, above) is unchanged. Every assertion here reads `menuSyncCalls()`, which filters
 * `invokeCommandMock`'s calls down to just the `menu_set_action_enabled` invocations, since the
 * same mock also serves `project_list`/`board_list`/`criterion_list`/etc.
 */
describe("useMenuLayerSync (G-01-1, Task 3)", () => {
  function menuSyncCalls(): Array<{ actionId: string; enabled: boolean }> {
    return invokeCommandMock.mock.calls
      .filter(([command]) => command === "menu_set_action_enabled")
      .map(([, args]) => args as { actionId: string; enabled: boolean });
  }

  it("pushes enabled: true for all four MENU_ACTION_IDS ids on mount with nothing open", async () => {
    await renderApp();

    const calls = menuSyncCalls();
    for (const id of MENU_ACTION_IDS) {
      expect(calls).toContainEqual({ actionId: id, enabled: true });
    }
  });

  it("opening the item detail panel disables register-project/create-task/create-epic but not open-palette", async () => {
    await renderApp();
    invokeCommandMock.mockClear();

    openDetailPanel("1");
    await waitFor(() => expect(menuSyncCalls().length).toBeGreaterThan(0));

    const calls = menuSyncCalls();
    expect(calls).toContainEqual({ actionId: "register-project", enabled: false });
    expect(calls).toContainEqual({ actionId: "create-task", enabled: false });
    expect(calls).toContainEqual({ actionId: "create-epic", enabled: false });
    // The palette must stay reachable over a trapped panel (BOARD-07) — its verdict is
    // unchanged from the board layer, so no call is issued for it at all (delta-only).
    expect(calls.find((c) => c.actionId === "open-palette")).toBeUndefined();
  });

  it("opening a row-level picker disables open-palette too, matching bindingAllowedInLayer under \"picker\"", async () => {
    await renderApp();
    invokeCommandMock.mockClear();

    act(() => {
      useUiStore.getState().setActivePicker({ kind: "status", id: "1" });
    });
    await waitFor(() => expect(menuSyncCalls().length).toBeGreaterThan(0));

    expect(menuSyncCalls()).toContainEqual({ actionId: "open-palette", enabled: false });
  });

  it("opening the command palette disables open-palette (Toggle Command Palette greys while the palette is up); closing it re-enables", async () => {
    await renderApp();
    invokeCommandMock.mockClear();

    act(() => {
      useUiStore.getState().setPaletteOpen(true);
    });
    await waitFor(() => expect(menuSyncCalls().length).toBeGreaterThan(0));
    expect(menuSyncCalls()).toContainEqual({ actionId: "open-palette", enabled: false });

    invokeCommandMock.mockClear();
    act(() => {
      useUiStore.getState().setPaletteOpen(false);
    });
    await waitFor(() => expect(menuSyncCalls().length).toBeGreaterThan(0));
    expect(menuSyncCalls()).toContainEqual({ actionId: "open-palette", enabled: true });
  });

  it("closing everything re-enables register-project/create-task/create-epic", async () => {
    await renderApp();
    openDetailPanel("1");
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("1"));
    invokeCommandMock.mockClear();

    act(() => {
      useUiStore.getState().setDetailItemId(null);
      useUiStore.getState().setSelectedItemId(null);
    });
    await waitFor(() => expect(menuSyncCalls().length).toBeGreaterThan(0));

    const calls = menuSyncCalls();
    expect(calls).toContainEqual({ actionId: "register-project", enabled: true });
    expect(calls).toContainEqual({ actionId: "create-task", enabled: true });
    expect(calls).toContainEqual({ actionId: "create-epic", enabled: true });
  });

  it("a layer change that does not alter any verdict issues no further calls (delta-only, not one round trip per store write)", async () => {
    await renderApp();
    invokeCommandMock.mockClear();

    // Quick-add from the board layer: both "board" and "quick-add" permit the identical set, so
    // no id's verdict actually changes.
    act(() => {
      useUiStore.getState().openQuickAdd("task");
    });
    // Give any (incorrectly) queued microtask a chance to land before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(menuSyncCalls()).toEqual([]);
  });

  it("a rejected menu_set_action_enabled call does not throw out of the hook and does not break the rendered tree", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "menu_set_action_enabled") return Promise.reject(new Error("no native menu attached"));
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "project_list") return Promise.resolve(PROJECTS);
      if (command === "board_list") {
        return Promise.resolve({ items: ITEMS, issues: [], counts: { ...EMPTY_COUNTS, backlog: ITEMS.length } });
      }
      if (command === "criterion_list") return Promise.resolve([]);
      if (command === "events_activity_trail") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    await renderApp();
    await act(async () => {
      openDetailPanel("1");
      await Promise.resolve();
    });

    // Still mounted, still interactive — the rejected push degraded silently rather than
    // crashing the tree (a renderer with no native menu attached must still work).
    expect(screen.getByText("Flywheel")).toBeInTheDocument();
    expect(useUiStore.getState().detailItemId).toBe("1");
  });
});
