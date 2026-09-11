/**
 * Behavior under test (plan 02-01 Task 1, acceptance criteria): a rendered row exists for every
 * event a stubbed `agent_run_log_window` read returns. Plan 02-02 Task 3 adds the Stop
 * control's three-state contract below.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
      invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
    // The permission-request card's feed mount (plan 02-06 Task 2) — no pending requests by
    // default so every pre-existing test in this file keeps rendering the plain event feed alone.
    pendingPermissionRequests: () => Promise.resolve([]),
    answerPermissionRequest: () => Promise.resolve(undefined),
  };
});

function makeEvent(i: number) {
  return {
    runId: "run-1",
    seq: i,
    at: "2026-01-01T00:00:00.000Z",
    raw: `line-${i}`,
    type: "assistant_text",
    text: `Event number ${i}`,
  };
}

function renderSurface() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface agentRunId="run-1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

describe("SessionSurface", () => {
  it("renders exactly one row per event returned by the stubbed window read", async () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve(events.slice(args.offset, args.offset + args.limit));
      }
      return Promise.resolve(undefined);
    });

    renderSurface();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByText("Event number 0")).toBeInTheDocument();
    expect(screen.getByText("Event number 1")).toBeInTheDocument();
    expect(screen.getByText("Event number 2")).toBeInTheDocument();
  });

  it("shows the ← Board affordance and calls onBack when clicked", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const queryClient = new QueryClient();
    const onBack = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={onBack} />
      </QueryClientProvider>,
    );

    const backButton = await screen.findByRole("button", { name: "← Board" });
    backButton.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("SessionSurface Stop control (plan 02-02 Task 3, D-35)", () => {
  function renderWithStatus(status: "running" | "blocked" | "completed" | "failed" | "interrupted") {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus={status} />
      </QueryClientProvider>,
    );
  }

  it("renders no stop control for a terminal run", () => {
    renderWithStatus("completed");
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stopping…" })).not.toBeInTheDocument();
  });

  it("reads Stop and is enabled for a running run", async () => {
    renderWithStatus("running");
    const stopButton = await screen.findByRole("button", { name: "Stop" });
    expect(stopButton).toBeEnabled();
  });

  it("reads Stopping… and is disabled immediately after activation", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve([]);
      if (command === "agent_run_stop") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    stopButton.click();

    const stoppingButton = await screen.findByRole("button", { name: "Stopping…" });
    expect(stoppingButton).toBeDisabled();
  });

  it("renders the exact run-status word for each of the five statuses", () => {
    const cases: Array<["running" | "blocked" | "completed" | "failed" | "interrupted", string]> = [
      ["running", "Running"],
      ["blocked", "Blocked"],
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["interrupted", "Interrupted"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = renderWithStatus(status);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});
