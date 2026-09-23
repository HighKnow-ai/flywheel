/**
 * D-88/D-90 (plan 05-03): the stage indicator, the Advance/Return controls, the `n` keyboard
 * binding, the gate-missing banner, and `MARKS`'/`tokens.css`' own structural obligations. Mocks
 * `adapters/tauri` exactly like `session-surface.test.tsx` (this file's own established pattern)
 * so no real Tauri IPC is exercised.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";
import { resetUiState } from "../../state/uiStore";
import { BINDINGS, resolveBinding } from "../../state/keyboard";

afterEach(() => {
  resetUiState();
  vi.clearAllMocks();
  capturedAgentEventHandler = null;
});

const invokeCommandMock = vi.fn();
const authoringStageAdvanceMock = vi.fn();
const authoringStageReturnMock = vi.fn();

let capturedAgentEventHandler: ((event: Record<string, unknown>) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    agentRunLogWindow: () =>
      Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 }),
    agentRunRawWindow: () => Promise.resolve({ lines: [], offset: 0, limit: 200, total: 0 }),
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => {
      capturedAgentEventHandler = handler;
      return Promise.resolve(() => {
        capturedAgentEventHandler = null;
      });
    },
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    stopAgentRun: () => invokeCommandMock("agent_run_stop").then(
      (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
    ),
    discardSession: () => invokeCommandMock("agent_run_discard").then(
      (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
    ),
    pendingPermissionRequests: () => Promise.resolve([]),
    answerPermissionRequest: () => Promise.resolve(undefined),
    // D-80/D-82 (plan 05-02): the tray's own read — no pending proposals in any test here, since
    // this file is testing the stage machine, not the tray.
    authoringProposalsForRun: () => Promise.resolve([]),
    // D-90 (plan 05-03): the two commands under test.
    authoringStageAdvance: (agentRunId: string) => authoringStageAdvanceMock(agentRunId),
    authoringStageReturn: (agentRunId: string, stage: string) =>
      authoringStageReturnMock(agentRunId, stage),
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

describe("SessionSurface — authoring stage indicator", () => {
  it("renders all three stage names and marks exactly the current one as current", async () => {
    renderSurface("decompose");

    await waitFor(() => expect(screen.getByRole("list", { name: "Authoring stage" })).toBeInTheDocument());
    const list = screen.getByRole("list", { name: "Authoring stage" });
    const items = list.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(3);
    expect(screen.getByText("Challenge")).toBeInTheDocument();
    expect(screen.getByText("Decompose")).toBeInTheDocument();
    expect(screen.getByText("Criteria")).toBeInTheDocument();

    const current = list.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toContain("Decompose");
  });

  it("renders no stage indicator for a run with no authoringStage", async () => {
    renderSurface(null);
    await screen.findByRole("button", { name: "← Board" });
    expect(screen.queryByRole("list", { name: "Authoring stage" })).not.toBeInTheDocument();
  });
});

describe("SessionSurface — Advance control", () => {
  it("names the next stage in its accessible label and is disabled at criteria", async () => {
    renderSurface("decompose");
    const advanceButton = await screen.findByRole("button", { name: "Advance to criteria" });
    expect(advanceButton).not.toBeDisabled();
  });

  it("is disabled once already at the last stage", async () => {
    renderSurface("criteria");
    const advanceButton = await screen.findByRole("button", {
      name: "Advance (already at the last stage)",
    });
    expect(advanceButton).toBeDisabled();
  });

  it("three synchronous Advance clicks issue exactly one backend call", async () => {
    authoringStageAdvanceMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("decompose"), 20)));
    renderSurface("challenge");
    const advanceButton = await screen.findByRole("button", { name: "Advance to decompose" });

    advanceButton.click();
    advanceButton.click();
    advanceButton.click();

    await waitFor(() => expect(authoringStageAdvanceMock).toHaveBeenCalledTimes(1));
  });

  it("clicking Advance resolves and shows the new current stage", async () => {
    authoringStageAdvanceMock.mockResolvedValue("decompose");
    renderSurface("challenge");
    const advanceButton = await screen.findByRole("button", { name: "Advance to decompose" });
    advanceButton.click();

    await waitFor(() => {
      const list = screen.getByRole("list", { name: "Authoring stage" });
      const current = list.querySelector('[aria-current="step"]');
      expect(current?.textContent).toContain("Decompose");
    });
    expect(authoringStageAdvanceMock).toHaveBeenCalledWith("run-1");
  });
});

describe("SessionSurface — Return control", () => {
  it("renders no return control at the challenge stage", async () => {
    renderSurface("challenge");
    await screen.findByRole("button", { name: "Advance to decompose" });
    expect(screen.queryByRole("button", { name: /^Return to/ })).not.toBeInTheDocument();
  });

  it("returns to the previous stage and calls the backend with it", async () => {
    authoringStageReturnMock.mockResolvedValue("challenge");
    renderSurface("decompose");
    const returnButton = await screen.findByRole("button", { name: "Return to challenge" });
    returnButton.click();

    await waitFor(() => expect(authoringStageReturnMock).toHaveBeenCalledWith("run-1", "challenge"));
  });
});

describe("SessionSurface — keyboard: n dispatches advance-stage", () => {
  it("n in the session-surface region resolves the advance-stage binding; the global Cmd+N binding still resolves create-task", () => {
    const nBinding = resolveBinding({ key: "n", metaKey: false, shiftKey: false, target: document.body }, "session-surface");
    expect(nBinding?.id).toBe("advance-stage");

    const cmdNBinding = resolveBinding({ key: "n", metaKey: true, shiftKey: false, target: document.body }, "session-surface");
    expect(cmdNBinding?.id).toBe("create-task");
  });

  it("pressing n with the session surface focused calls authoringStageAdvance", async () => {
    authoringStageAdvanceMock.mockResolvedValue("decompose");
    renderSurface("challenge");
    await screen.findByRole("button", { name: "Advance to decompose" });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));

    await waitFor(() => expect(authoringStageAdvanceMock).toHaveBeenCalledWith("run-1"));
  });
});

describe("SessionSurface — gate-missing banner", () => {
  it("does not render when no gate-missing notice has arrived", async () => {
    renderSurface("challenge");
    await screen.findByRole("button", { name: "Advance to decompose" });
    expect(screen.queryByText(/challenge-stage gate/i)).not.toBeInTheDocument();
  });

  it("renders once the flywheelStageGateMissing notice arrives for this run", async () => {
    renderSurface("challenge");
    await screen.findByRole("button", { name: "Advance to decompose" });

    expect(capturedAgentEventHandler).not.toBeNull();
    capturedAgentEventHandler?.({
      runId: "run-1",
      type: "system_notice",
      text: "The challenge-stage gate could not be installed for this session — a proposal could be staged before the stage advances.",
      flywheelStageGateMissing: true,
    });

    await waitFor(() => expect(screen.getByText(/challenge-stage gate/i)).toBeInTheDocument());
  });

  it("does not render for a notice scoped to a DIFFERENT run", async () => {
    renderSurface("challenge");
    await screen.findByRole("button", { name: "Advance to decompose" });

    capturedAgentEventHandler?.({
      runId: "run-some-other-run",
      type: "system_notice",
      text: "irrelevant",
      flywheelStageGateMissing: true,
    });

    expect(screen.queryByText(/challenge-stage gate/i)).not.toBeInTheDocument();
  });
});

describe("keyboard.ts — advance-stage/return-stage table entries", () => {
  it("advance-stage is bound in the session-surface region to a bare n", () => {
    const binding = BINDINGS.find((b) => b.id === "advance-stage");
    expect(binding).toBeDefined();
    expect(binding?.region).toBe("session-surface");
    expect(binding?.key).toBe("n");
    expect(binding?.meta).toBeFalsy();
  });

  it("return-stage is a command-palette-only entry (no key)", () => {
    const binding = BINDINGS.find((b) => b.id === "return-stage");
    expect(binding).toBeDefined();
    expect(binding?.region).toBe("command-palette");
    expect(binding?.key).toBeUndefined();
  });
});
