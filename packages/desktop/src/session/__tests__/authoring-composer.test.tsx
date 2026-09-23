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
import { SessionSurface } from "../SessionSurface";
import { resetUiState } from "../../state/uiStore";

afterEach(() => {
  resetUiState();
  vi.clearAllMocks();
});

const authoringStageAdvanceMock = vi.fn();
const authoringStageReturnMock = vi.fn();
const sendAuthoringTurnMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    agentRunLogWindow: () =>
      Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 }),
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
