/**
 * Phase 8.1 plan 13 (SC3, D-21, T-08.1-34/35), measured in a real engine.
 *
 * Success criterion 3 names three motions: the detail panel slides in, a group expands and
 * collapses rather than jump-cutting, the command palette animates in. None of them existed in
 * code before this plan (RESEARCH Correction 8). jsdom has no animation engine, so "this
 * element has a nonzero animation duration" and "this element is actually transitioning" can only
 * be observed here.
 *
 * One file, two invocations. Reduced motion comes from the config, not from this file:
 *   npm --prefix packages/desktop run test:browser           (default arm: durations nonzero)
 *   npm --prefix packages/desktop run test:browser:motion    (reduced arm: durations zero)
 * The first test asserts which world the engine actually landed in, so a config that silently
 * failed to switch the setting cannot make both runs measure the same case and pass twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { BoardView } from "../../BoardView";
import { CommandPalette } from "../../CommandPalette";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import { useCollapseStore } from "../../collapseStore";
import type { BandCounts, BoardItem } from "../../useBoardQuery";
import { MOTION } from "../../../theme/tokens";
// The raw source of the three touched components: the "no scripted animation" case reads what
// actually ships, so the blanket reduced-motion rule is provably the only thing that matters.
import boardViewSource from "../../BoardView.tsx?raw";
import paletteSource from "../../CommandPalette.tsx?raw";
import panelSource from "../../../item-detail/ItemDetailPanel.tsx?raw";

const invokeCommandMock = vi.fn();

// Everything the adapter exports stays real (the mutation helpers are only imported, never called
// here); only the reads the board makes on mount are answered by the fake core below.
vi.mock("../../../adapters/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../adapters/tauri")>()),
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
  boardChangeFlags: (projectId: string) => invokeCommandMock("board_change_flags", { projectId }),
  authoringProposalsPending: (projectId: string) => invokeCommandMock("authoring_proposals_pending", { projectId }),
  authoringRunForEpic: (epicId: string) => invokeCommandMock("authoring_run_for_epic", { epicId }),
}));

const reduced = import.meta.env.VITE_EXPECT_MOTION === "reduce";
const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };
const ALPHA = { id: "epic-a", key: "FLY-1", title: "Alpha" };
const BETA = { id: "epic-b", key: "FLY-2", title: "Beta" };

const task = (n: number): BoardItem => ({
  id: `t-${n}`,
  key: `FLY-${100 + n}`,
  title: `Task ${n}`,
  status: "todo",
  rank: `a${n}`,
  priority: 0,
  epicId: ALPHA.id,
  kind: "task",
});
const TASKS = Array.from({ length: 6 }, (_, i) => task(i));

beforeEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "actor_list":
      case "board_change_flags":
        return Promise.resolve([]);
      case "epic_list_all":
        return Promise.resolve({ epics: [ALPHA, BETA], total: 2, truncated: false });
      case "board_epic_progress":
        return Promise.resolve(
          [ALPHA, BETA].map((epic) => ({
            epicId: epic.id,
            byStatus: [{ status: "todo", count: epic === ALPHA ? TASKS.length : 0 }],
            total: epic === ALPHA ? TASKS.length : 0,
            done: 0,
            agentsRunning: 0,
            agentsBlocked: 0,
            criteria: null,
          })),
        );
      case "authoring_proposals_pending":
        return Promise.resolve({ proposals: [], counts: { pending: 0, accepted: 0, rejected: 0, merged: 0, deferred: 0 } });
      case "board_list": {
        const filter = (args?.filter ?? {}) as { epicIds?: (string | null)[] };
        return Promise.resolve({
          items: filter.epicIds?.[0] === ALPHA.id ? TASKS : [],
          issues: [],
          counts: EMPTY_COUNTS,
        });
      }
      default:
        // react-query rejects `undefined`; `null` is "nothing here" for every read the surfaces make.
        return Promise.resolve(null);
    }
  });
});

/** "0.22s" -> 220. The engine reports computed durations in seconds; the contract is in ms. */
const ms = (computed: string): number => Math.round(parseFloat(computed) * 1000);
const firstMs = (computed: string): number => ms(computed.split(",")[0]);

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ height: 700, width: 1200 }}>
        <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
      </div>
    </QueryClientProvider>,
  );
}

const wrapper = (key: string) => document.querySelector(`[data-row-key="${key}"]`) as HTMLElement | null;
const epicRow = async (title: string) => (await screen.findByLabelText(new RegExp(`^FLY-\\d+ ${title},`))) as HTMLElement;

/** Open Alpha's detail panel the way the keyboard does: select the epic row, press Enter on the list. */
async function openPanel(): Promise<HTMLElement> {
  renderBoard();
  fireEvent.click(await epicRow("Alpha"));
  fireEvent.keyDown(screen.getByRole("list", { name: "Board" }), { key: "Enter" });
  return screen.findByRole("dialog", { name: /detail$/ });
}

describe(`motion, measured in WebKit, ${reduced ? "reduced-motion" : "default"} arm`, () => {
  it("loaded the world this run claims to measure", () => {
    expect(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      "the config asked for one motion setting and the engine landed in the other",
    ).toBe(reduced);
    expect(
      getComputedStyle(document.documentElement).getPropertyValue("--duration-panel").trim(),
      "the engine resolved a different panel duration than this arm expects",
    ).toBe(reduced ? "0s" : MOTION.durationPanel);
  });

  it("slides the detail panel in over the panel duration, transform only", async () => {
    const panel = await openPanel();
    const style = getComputedStyle(panel);
    expect(style.animationName).toBe("panel-slide-in");
    expect(firstMs(style.animationDuration)).toBe(reduced ? 0 : parseInt(MOTION.durationPanel, 10));
    // Animating width would re-evaluate every board row's container ladder on every frame.
    expect(style.transitionProperty).not.toMatch(/width/);
  });

  it("opens the command palette over the palette duration, at full opacity, with a transform-only settle", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPalette />
      </QueryClientProvider>,
    );
    act(() => useUiStore.getState().setPaletteOpen(true));
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const panel = dialog.querySelector(".command-palette") as HTMLElement;
    const style = getComputedStyle(panel);
    expect(style.animationName).toBe("palette-settle");
    expect(firstMs(style.animationDuration)).toBe(reduced ? 0 : parseInt(MOTION.durationPalette, 10));
    // Never a fade (08.1-UI-SPEC.md § Motion): the first frame is already at full opacity.
    expect(style.opacity).toBe("1");
    expect(getComputedStyle(dialog).opacity).toBe("1");
  });

  it("gives the rows below an expanding group a transform transition and the new rows an enter animation", async () => {
    renderBoard();
    const alpha = await epicRow("Alpha");
    await waitFor(() => expect(alpha).toHaveAccessibleName(/tasks done/));
    fireEvent.click(within(alpha).getByRole("button", { name: /^Expand/ }));
    await waitFor(() => expect(wrapper("task:t-5")).not.toBeNull());

    const below = getComputedStyle(wrapper("epic:epic-b")!);
    expect(below.transitionProperty).toMatch(/transform/);
    expect(firstMs(below.transitionDuration)).toBe(reduced ? 0 : parseInt(MOTION.durationCollapse, 10));

    const entering = getComputedStyle(wrapper("task:t-0")!);
    expect(entering.animationName).toBe("row-enter");
    expect(firstMs(entering.animationDuration)).toBe(reduced ? 0 : parseInt(MOTION.durationCollapse, 10));
  });

  it("actually moves the rows below, in the engine, when a group expands", async () => {
    renderBoard();
    const alpha = await epicRow("Alpha");
    await waitFor(() => expect(alpha).toHaveAccessibleName(/tasks done/));
    const beta = wrapper("epic:epic-b")!;
    let sawTransformTransition = false;
    const watch = () => {
      if (beta.getAnimations().some((a) => a instanceof CSSTransition && a.transitionProperty === "transform")) {
        sawTransformTransition = true;
      }
    };
    const timer = window.setInterval(watch, 8);
    fireEvent.click(within(alpha).getByRole("button", { name: /^Expand/ }));
    await waitFor(() => expect(wrapper("task:t-5")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
    window.clearInterval(timer);
    // Reduced motion: the state change applies instantly, so no transition is ever started.
    expect(sawTransformTransition).toBe(!reduced);
  });

  it("still traps focus in the panel and still dismisses it with Escape", async () => {
    const panel = await openPanel();
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /detail$/ })).not.toBeInTheDocument());
  });

  it("still returns nothing while the palette is closed, and opens from the store", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPalette />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    act(() => useUiStore.getState().setPaletteOpen(true));
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    act(() => useUiStore.getState().setPaletteOpen(false));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument());
  });

  it("drives no animation from script and measures no row", () => {
    for (const [name, source] of [
      ["BoardView.tsx", boardViewSource],
      ["CommandPalette.tsx", paletteSource],
      ["ItemDetailPanel.tsx", panelSource],
    ] as const) {
      const code = source
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      expect(code, `${name}: scripted animation escapes the blanket reduced-motion rule`).not.toMatch(
        /requestAnimationFrame|\.animate\(/,
      );
    }
    expect(boardViewSource.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")).not.toMatch(
      /measureElement/,
    );
  });
});
