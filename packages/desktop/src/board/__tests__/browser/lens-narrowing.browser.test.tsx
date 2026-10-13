/**
 * D-REV-27 (08.1 amendment A-04, `any-child`), over the REAL chip and the REAL board in WebKit:
 * under the has-worktree chip the epic lens narrows its headers to the epics that own live work, and
 * the unfiltered roster comes back when the chip goes off.
 *
 * The "core" is a small fake that answers `board_list` the way `FILTER_WHERE` does (a task matches
 * on its own worktree; an epic row matches when any child task has one). The SQL clause itself is
 * proved against the real database in `packages/core/tests/search_filter.rs`; what this proves is
 * the half that was missing, that the lens CONSULTS the core's answer for its headers. Expected
 * headers are computed from the fixture's own worktree rows, not from 13 and 5, which are one
 * snapshot of the live board and not an invariant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { BoardView } from "../../BoardView";
import { FilterBar } from "../../FilterBar";
import { resetUiState } from "../../../state/uiStore";
import { useCollapseStore } from "../../collapseStore";
import type { BandCounts, BoardItem } from "../../useBoardQuery";

const invokeCommandMock = vi.fn();

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

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };
const EPICS = Array.from({ length: 13 }, (_, i) => ({ id: `epic-${i}`, key: `FLY-${i + 1}`, title: `Epic ${i + 1}`, status: "in_progress", integrationBranch: null }));

/** Every epic has a task; only some tasks own a live worktree, one epic owns two, and two tasks belong to no epic. */
const task = (id: string, epicId: string | null, worktree: boolean) => ({ id, epicId, worktree });
const TASKS = [
  ...EPICS.map((epic, i) => task(`t-${i}`, epic.id, [0, 3, 4, 8, 11].includes(i))),
  task("t-extra", "epic-3", true), // a second live worktree under an epic that already has one
  task("t-loose-0", null, false),
  task("t-loose-1", null, false),
];
const itemOf = (t: (typeof TASKS)[number], n: number): BoardItem => ({
  id: t.id, key: `FLY-${200 + n}`, title: `Task ${t.id}`, status: "in_progress", rank: `a${n}`, priority: 0, epicId: t.epicId, kind: "task",
});

/** What the fake core's `FILTER_WHERE` returns for `hasWorktree`: matching tasks, plus an epic row per epic with a matching child. */
function boardList(filter: { hasWorktree?: true; epicIds?: (string | null)[] } | undefined, limit: number, crowd: boolean): BoardItem[] {
  const tasks = TASKS.filter((t) => (!filter?.hasWorktree || t.worktree) && (!filter?.epicIds || filter.epicIds.includes(t.epicId)));
  const rows: BoardItem[] = tasks.map((t, n) => itemOf(t, n));
  if (!filter?.epicIds) {
    for (const epic of EPICS) {
      if (!filter?.hasWorktree || TASKS.some((t) => t.epicId === epic.id && t.worktree)) {
        rows.push({ id: epic.id, key: epic.key, title: epic.title, status: epic.status, rank: "a0", priority: 0, epicId: null, kind: "epic" });
      }
    }
    // Enough extra matching rows under one epic to fill the call's limit, as a very busy board would.
    if (crowd) for (let n = 0; n < limit; n += 1) rows.push(itemOf(task(`crowd-${n}`, "epic-1", true), 1000 + n));
  }
  return rows.slice(0, limit);
}

let crowd = false;

beforeEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  crowd = false;
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "actor_list":
      case "board_change_flags":
        return Promise.resolve([]);
      case "epic_list_all":
        return Promise.resolve({ epics: EPICS, total: EPICS.length, truncated: false });
      case "board_epic_progress":
        return Promise.resolve([
          ...EPICS.map((epic) => {
            const total = TASKS.filter((t) => t.epicId === epic.id).length;
            return { epicId: epic.id, byStatus: [{ status: "in_progress", count: total }], total, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: null };
          }),
          { epicId: null, byStatus: [{ status: "in_progress", count: 2 }], total: 2, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: null },
        ]);
      case "authoring_proposals_pending":
        return Promise.resolve({ proposals: [], counts: { pending: 0, accepted: 0, rejected: 0, merged: 0, deferred: 0 } });
      case "board_list":
      case "board_search": {
        const items = boardList(args?.filter as never, (args?.limit as number) ?? 200, crowd);
        return Promise.resolve({ items, issues: [], counts: EMPTY_COUNTS });
      }
      default:
        return Promise.resolve(null);
    }
  });
});

const epicHeaderKeys = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-row-key^="epic:"]')).map((el) => el.getAttribute("data-row-key")!.slice("epic:".length));

function renderLens() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ height: 900, width: 1200 }}>
        <FilterBar projectId="proj-1" />
        <div style={{ height: 760 }}>
          <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
        </div>
      </div>
    </QueryClientProvider>,
  );
}

const chip = () => screen.getByRole("button", { name: /^Has worktree/ });

describe("epic lens under the has-worktree chip (A-04 any-child)", () => {
  it("narrows its headers to the epics that own live work, and restores the full roster when the chip goes off", async () => {
    renderLens();
    await waitFor(() => expect(epicHeaderKeys()).toContain("epic-12"));
    const everything = epicHeaderKeys();
    const owning = [...new Set(TASKS.filter((t) => t.worktree).map((t) => `epic-${EPICS.findIndex((e) => e.id === t.epicId)}`))].sort();
    expect(owning.length, "the fixture must have fewer owning epics than epics, or this proves nothing").toBeLessThan(EPICS.length);
    expect(everything.filter((k) => k !== "none").sort(), "unfiltered, every roster epic has a header").toEqual(EPICS.map((e) => e.id).sort());
    expect(everything, "unfiltered, the No epic bucket is shown").toContain("none");

    fireEvent.click(chip());
    await waitFor(() => expect(epicHeaderKeys().filter((k) => k !== "none").sort()).toEqual(owning));
    expect(epicHeaderKeys(), "no matching task lacks an epic, so the No epic bucket has nothing to show").not.toContain("none");

    fireEvent.click(chip());
    await waitFor(() => expect(epicHeaderKeys().filter((k) => k !== "none").sort()).toEqual(EPICS.map((e) => e.id).sort()));
    expect(epicHeaderKeys()).toContain("none");
  });

  it("narrows nothing when the core's answer fills its row limit, because a header must never be hidden on an incomplete answer", async () => {
    crowd = true;
    renderLens();
    await waitFor(() => expect(epicHeaderKeys()).toContain("epic-12"));
    fireEvent.click(chip());
    // Give the narrowing read time to land, then require that every header is still there.
    await waitFor(() => expect(invokeCommandMock.mock.calls.some(([command, args]) => command === "board_list" && (args as { filter?: { hasWorktree?: boolean } })?.filter?.hasWorktree)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(epicHeaderKeys().filter((k) => k !== "none").sort()).toEqual(EPICS.map((e) => e.id).sort());
  });
});
