/**
 * The composer (SHAPE-01, plan 05-12 Task 1): the one seam between a developer and a live
 * authoring session's conversation. Mocks `adapters/tauri` exactly like
 * `authoring-stage.test.tsx`'s own established pattern, so no real Tauri IPC is exercised.
 *
 * Task 2 adds the developer-turn feed row assertions; Task 3 adds the bare-Advance-keypress
 * confirmation. Both extend this same file rather than starting a second one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface, buildFeedRows } from "../SessionSurface";
import { resetUiState } from "../../state/uiStore";

afterEach(() => {
  resetUiState();
  vi.clearAllMocks();
});

const authoringStageAdvanceMock = vi.fn();
const authoringStageReturnMock = vi.fn();
const sendAuthoringTurnMock = vi.fn();
const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
      invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
    agentRunRawWindow: () => Promise.resolve({ lines: [], offset: 0, limit: 200, total: 0 }),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    stopAgentRun: () => Promise.resolve({ status: "interrupted", sidecarWarning: null }),
    discardSession: () => Promise.resolve({ status: "interrupted", sidecarWarning: null }),
    pendingPermissionRequests: () => Promise.resolve([]),
    answerPermissionRequest: () => Promise.resolve(undefined),
    authoringProposalsForRun: () => Promise.resolve([]),
    authoringStageAdvance: (agentRunId: string) => authoringStageAdvanceMock(agentRunId),
    authoringStageReturn: (agentRunId: string, stage: string) =>
      authoringStageReturnMock(agentRunId, stage),
    sendAuthoringTurn: (agentRunId: string, text: string) => sendAuthoringTurnMock(agentRunId, text),
  };
});

/** A `LogWindowDto`-shaped stub response — mirrors `session-surface.test.tsx`'s own `windowFor`. */
function windowFor(events: Record<string, unknown>[], offset: number, limit: number) {
  return { entries: events.slice(offset, offset + limit), offset, limit, total: events.length };
}

/** Default: no entries, so every Task 1 test above keeps rendering an empty feed. Task 2 tests
 * below call this with their own entries before rendering. */
function mockWindowReads(getEvents: () => Record<string, unknown>[] = () => []) {
  invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
    if (command === "agent_run_log_window") {
      return Promise.resolve(windowFor(getEvents(), args.offset, args.limit));
    }
    return Promise.resolve(undefined);
  });
}

function makeDeveloperTurn(turnId: string, text: string, origin: "developer" | "application" = "developer") {
  return {
    runId: "run-1",
    at: "2026-01-01T00:00:00.000Z",
    raw: text,
    type: "developer_turn",
    text,
    origin,
    turnId,
  };
}

// Default: an empty feed, so every Task 1 test above (none of which cares about feed content)
// keeps rendering unchanged. `vi.clearAllMocks()` (afterEach) clears call history only — it does
// not remove this implementation, matching `session-surface.test.tsx`'s own precedent.
mockWindowReads();

function mockMatchMedia(matches = true) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderSurface(authoringStage: string | null = "challenge") {
  mockMatchMedia();
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage={authoringStage} />
    </QueryClientProvider>,
  );
}

async function findComposer() {
  return screen.findByRole("textbox", { name: "Message" });
}

describe("SessionSurface — authoring composer", () => {
  it("renders a composer for an authoring run", async () => {
    renderSurface("challenge");
    expect(await findComposer()).toBeInTheDocument();
  });

  it("renders no composer for an ordinary task-execution run", async () => {
    renderSurface(null);
    await waitFor(() => expect(screen.getByText("Session")).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
  });

  it("submitting calls the named turn wrapper once, with the run id and the trimmed message", async () => {
    sendAuthoringTurnMock.mockResolvedValue(undefined);
    renderSurface("challenge");
    const composer = await findComposer();
    fireEvent.change(composer, { target: { value: "  hello there  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendAuthoringTurnMock).toHaveBeenCalledTimes(1));
    expect(sendAuthoringTurnMock).toHaveBeenCalledWith("run-1", "hello there");
  });

  it("two submits in one synchronous tick dispatch exactly one call", async () => {
    sendAuthoringTurnMock.mockResolvedValue(undefined);
    renderSurface("challenge");
    const composer = await findComposer();
    fireEvent.change(composer, { target: { value: "a message" } });
    const sendButton = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => expect(sendAuthoringTurnMock).toHaveBeenCalledTimes(1));
  });

  it("a rejected send leaves the typed text in place and surfaces a worded message", async () => {
    sendAuthoringTurnMock.mockRejectedValue(new Error("no live session"));
    renderSurface("challenge");
    const composer = await findComposer();
    fireEvent.change(composer, { target: { value: "hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendAuthoringTurnMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect((composer as HTMLTextAreaElement).value).toBe("hello there");
  });

  it("a whitespace-only message dispatches nothing", async () => {
    renderSurface("challenge");
    const composer = await findComposer();
    fireEvent.change(composer, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendAuthoringTurnMock).not.toHaveBeenCalled();
  });
});

describe("SessionSurface — developer-turn feed rows (Task 2)", () => {
  it("a developer_turn feed entry becomes a developer-turn row, not a raw line and not assistant prose", async () => {
    mockWindowReads(() => [makeDeveloperTurn("turn-1", "hello from the developer")]);
    renderSurface("challenge");

    // The row shows the plain text — never the JSON-stringified raw line a "raw" row would show,
    // and never merged into the same presentation an assistant reply gets without a way to tell
    // them apart. `findByText` polls until the async feed query resolves (the "Starting session…"
    // placeholder row also carries `role="listitem"`, so waiting on listitem count alone would
    // resolve on that row instead of the real one).
    expect(await screen.findByText("hello from the developer")).toBeInTheDocument();

    mockWindowReads(() => []);
  });

  it("buildFeedRows: two developer-turn entries never collide on one feed key", () => {
    const rows = buildFeedRows([
      makeDeveloperTurn("turn-a", "first message"),
      makeDeveloperTurn("turn-b", "second message"),
    ]);
    const developerTurnRows = rows.filter((row) => row.kind === "developer_turn");
    expect(developerTurnRows).toHaveLength(2);
    const keys = developerTurnRows.map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
    // Keyed off the turn identifier, not the flattened array position — the property the plan's
    // own "without it, every synthetic turn would share one key" reasoning depends on.
    for (const key of keys) {
      expect(key).toContain("turn-");
    }
  });
});
