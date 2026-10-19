/**
 * Behavior under test (Phase 10 plan 10-03, FLEET-01, D-167/D-171):
 * - A live row whose newest log line is a tool call shows that tool and its target, worded by the
 *   session feed's own `toolCallLabel`; narration shows its first clause, clipped to the pinned width.
 * - A live row with an empty or oversize tail shows an explicit dash, and a refresh that returns an
 *   empty tail does not leave the previous line on screen.
 * - A terminal row shows no activity text at all.
 * - ONE `agent:event` listener serves the surface however many live rows it holds; ten events inside
 *   one throttle window invalidate the fleet key once; both listeners are removed on unmount.
 * - The fleet's words are the session feed's words: the same fixture line goes through `buildFeedRows`
 *   and `feedRowText` directly and the cell matches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetActivityDto, FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { buildFeedRows } from "../../session/SessionSurface";
import { feedRowText, toolCallLabel } from "../../session/FeedRow";
import { FleetSurface, ACTIVITY_MAX_CHARS, activityLine } from "../FleetSurface";
import { FLEET_ACTIVITY_THROTTLE_MS, blockedQueueQueryKey, fleetQueryKey } from "../useFleet";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();
const subscribeAgentEventMock = vi.fn();
const subscribeBoardChangedMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: (handler: () => void) => subscribeBoardChangedMock(handler),
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => subscribeAgentEventMock(handler),
  };
});

const line = (event: Record<string, unknown>) => JSON.stringify(event);
const toolCall = (toolName: string, input: unknown, seq = 1) => line({ type: "tool_call", seq, toolName, input });
const narration = (text: string, seq = 1) => line({ type: "assistant_text", seq, text });

function activity(...lines: string[]): FleetActivityDto {
  return { lines, truncated: false };
}

function row(id: string, overrides: Partial<FleetRowDto> = {}): FleetRowDto {
  return {
    sessionId: id,
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    storyId: `task-${id}`,
    storyKey: `ALP-${id}`,
    storyTitle: "Wire the thing",
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

function list(rows: FleetRowDto[]): FleetListDto {
  return { rows, totalRows: rows.length, visibleCostUsd: null };
}

let queryClient: QueryClient;

function renderFleet() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetSurface onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function cellFor(runId: string): HTMLElement {
  const item = document.querySelector(`[data-run-id="${runId}"]`) as HTMLElement;
  return within(item).getByText((_, el) => el?.getAttribute("data-field") === "activity");
}

beforeEach(() => {
  fleetListMock.mockReset();
  subscribeAgentEventMock.mockReset();
  subscribeBoardChangedMock.mockReset();
  subscribeAgentEventMock.mockImplementation(() => Promise.resolve(() => {}));
  subscribeBoardChangedMock.mockImplementation(() => Promise.resolve(() => {}));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the activity cell", () => {
  it("shows a tool call as the tool plus its target, as the session feed words it", async () => {
    const input = { file_path: "packages/core/src/git.rs" };
    fleetListMock.mockResolvedValue(list([row("1", { activity: activity(toolCall("Edit", input)) })]));
    renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="1"]')).not.toBeNull());
    expect(cellFor("1").textContent).toBe(toolCallLabel("Edit", input));
    expect(cellFor("1").textContent).toBe("Edit · packages/core/src/git.rs");
  });

  it("shows narration as its first clause", async () => {
    fleetListMock.mockResolvedValue(
      list([row("1", { activity: activity(narration("Reading the migration. Then I will wire the query.")) })]),
    );
    renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="1"]')).not.toBeNull());
    expect(cellFor("1").textContent).toBe("Reading the migration.");
  });

  it("clips a long line to the pinned width with the ellipsis at the tail, for every row kind", () => {
    expect(ACTIVITY_MAX_CHARS).toBe(80);
    const long = "w".repeat(200);
    for (const text of [
      activityLine(activity(narration(long))),
      activityLine(activity(toolCall("Bash", { command: long }))),
      activityLine(activity(line({ type: "system_notice", text: long }))),
    ]) {
      expect(text).not.toBeNull();
      expect(text!.length).toBe(ACTIVITY_MAX_CHARS);
      expect(text!.endsWith("…")).toBe(true);
    }
  });

  it("steps past events the feed suppresses to the newest row it would show", () => {
    const lines = [
      toolCall("Read", { file_path: "a.ts" }, 1),
      line({ type: "tool_result", seq: 2, toolName: "Read", output: "ok" }),
      line({ type: "cost_update", seq: 3 }),
    ];
    expect(activityLine(activity(...lines))).toBe("Read · a.ts");
  });

  it("shows the feed's own fallback for a line that is not JSON rather than dropping it", () => {
    expect(activityLine(activity("not json at all"))).toBe("not json at all");
  });

  it("says so with a dash when the tail is empty, oversize or normalises to nothing", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row("empty"),
        row("big", { activity: { lines: [], truncated: true } }),
        row("quiet", { activity: activity(line({ type: "cost_update", seq: 1 })) }),
      ]),
    );
    renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="empty"]')).not.toBeNull());
    for (const id of ["empty", "big", "quiet"]) {
      expect(cellFor(id).textContent).toBe("—");
      expect(cellFor(id).getAttribute("data-absent")).toBe("true");
    }
  });

  it("does not keep the previous line when a refresh returns an empty tail", async () => {
    let boardChanged: () => void = () => {};
    subscribeBoardChangedMock.mockImplementation((handler: () => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    });
    fleetListMock
      .mockResolvedValueOnce(list([row("1", { activity: activity(toolCall("Bash", { command: "npm test" })) })]))
      .mockResolvedValue(list([row("1")]));
    renderFleet();
    await waitFor(() => expect(cellFor("1").textContent).toBe("Bash · npm test"));

    await act(async () => boardChanged());

    await waitFor(() => expect(cellFor("1").textContent).toBe("—"));
    expect(screen.queryByText(/npm test/)).toBeNull();
  });

  it("renders no activity text for a terminal row, even if a tail were attached", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row("1", {
          runStatus: "failed",
          fleetState: "failed",
          endedAt: new Date().toISOString(),
          activity: activity(toolCall("Bash", { command: "npm test" })),
        }),
      ]),
    );
    renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="1"]')).not.toBeNull());
    expect(cellFor("1").textContent).toBe("");
    expect(screen.queryByText(/npm test/)).toBeNull();
  });
});

describe("the fleet and the session feed use the same words", () => {
  it("matches the feed's own text for the same log line, for each row kind", () => {
    const fixtures: Record<string, unknown>[] = [
      { type: "tool_call", seq: 1, toolName: "Edit", input: { file_path: "src/a.ts" } },
      { type: "system_notice", seq: 2, text: "rate limited, retrying" },
      { type: "git_retry", seq: 3, attempt: 2, max: 5 },
      { type: "unknown", raw: "garbled", line: 7 },
    ];
    for (const event of fixtures) {
      const fromFeed = feedRowText(buildFeedRows([event])[0]);
      expect(activityLine(activity(line(event)))).toBe(fromFeed);
    }
  });

  it("narration is the feed's text cut at its first clause, nothing reworded", () => {
    const event = { type: "assistant_text", seq: 1, text: "Checking the schema first. Then the query." };
    const full = feedRowText(buildFeedRows([event])[0]);
    expect(full).toBe("Checking the schema first. Then the query.");
    expect(activityLine(activity(line(event)))).toBe("Checking the schema first.");
  });
});

describe("the agent:event listener", () => {
  it("is registered once for a surface of three live rows, and both listeners are removed on unmount", async () => {
    const unlistenAgent = vi.fn();
    const unlistenBoard = vi.fn();
    subscribeAgentEventMock.mockImplementation(() => Promise.resolve(unlistenAgent));
    subscribeBoardChangedMock.mockImplementation(() => Promise.resolve(unlistenBoard));
    fleetListMock.mockResolvedValue(list([row("1"), row("2"), row("3")]));

    const view = renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="3"]')).not.toBeNull());
    expect(subscribeAgentEventMock).toHaveBeenCalledTimes(1);

    view.unmount();
    await waitFor(() => {
      expect(unlistenAgent).toHaveBeenCalledTimes(1);
      expect(unlistenBoard).toHaveBeenCalledTimes(1);
    });
  });

  it("invalidates the fleet key and the blocked-queue key once each for ten events inside one throttle window", async () => {
    expect(FLEET_ACTIVITY_THROTTLE_MS).toBe(1000);
    let onAgentEvent: (event: Record<string, unknown>) => void = () => {};
    subscribeAgentEventMock.mockImplementation((handler: (event: Record<string, unknown>) => void) => {
      onAgentEvent = handler;
      return Promise.resolve(() => {});
    });
    fleetListMock.mockResolvedValue(list([row("1")]));
    renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="1"]')).not.toBeNull());

    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    for (let i = 0; i < 10; i += 1) onAgentEvent({ type: "tool_call", seq: i });
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FLEET_ACTIVITY_THROTTLE_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    // One window, one invalidation per key (plan 10-05 added the queue key to the same listener).
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fleetQueryKey() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: blockedQueueQueryKey() });

    // A later window gets its own single invalidation of each.
    onAgentEvent({ type: "tool_call", seq: 11 });
    vi.advanceTimersByTime(FLEET_ACTIVITY_THROTTLE_MS);
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it("does not invalidate after unmount", async () => {
    let onAgentEvent: (event: Record<string, unknown>) => void = () => {};
    subscribeAgentEventMock.mockImplementation((handler: (event: Record<string, unknown>) => void) => {
      onAgentEvent = handler;
      return Promise.resolve(() => {});
    });
    fleetListMock.mockResolvedValue(list([row("1")]));
    const view = renderFleet();
    await waitFor(() => expect(document.querySelector('[data-run-id="1"]')).not.toBeNull());

    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    onAgentEvent({ type: "tool_call", seq: 1 });
    view.unmount();
    vi.advanceTimersByTime(FLEET_ACTIVITY_THROTTLE_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
