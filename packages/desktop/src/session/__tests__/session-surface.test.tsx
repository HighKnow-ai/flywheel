/**
 * Behavior under test:
 * - Plan 02-01 Task 1: a rendered row exists for every event a stubbed `agent_run_log_window`
 *   read returns.
 * - Plan 02-02 Task 3: the Stop control's three-state contract.
 * - Plan 02-06 Task 2: the permission-request card's feed mount.
 * - Plan 02-07 Task 2: the structured feed itself — one row per event kind, tool-call
 *   collapse/expand, the terminal row, the "Starting session…" pulse, bounded virtualization,
 *   and scroll-triggered older-page paging.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";
import { sessionFeedQueryKey } from "../../board/useBoardQuery";

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

/** A `LogWindowDto`-shaped stub response (plan 02-07 Task 1) — mirrors what
 * `commands/agent_run.rs`'s real `agent_run_log_window` returns. */
function windowFor(events: Record<string, unknown>[], offset: number, limit: number) {
  return {
    entries: events.slice(offset, offset + limit),
    offset,
    limit,
    total: events.length,
  };
}

function mockWindowReads(getEvents: () => Record<string, unknown>[]) {
  invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
    if (command === "agent_run_log_window") {
      return Promise.resolve(windowFor(getEvents(), args.offset, args.limit));
    }
    return Promise.resolve(undefined);
  });
}

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

function makeToolCall(seq: number, toolName: string, input: unknown) {
  return { runId: "run-1", seq, at: "2026-01-01T00:00:00.000Z", raw: `tool-${seq}`, type: "tool_call", toolName, input };
}

function makeToolResult(seq: number, toolName: string, output: unknown) {
  return { runId: "run-1", seq, at: "2026-01-01T00:00:00.000Z", raw: `result-${seq}`, type: "tool_result", toolName, output };
}

function makeSessionClosed(seq: number, reason: string, result?: { subtype: string }) {
  return { runId: "run-1", seq, at: "2026-01-01T00:00:00.000Z", raw: `closed-${seq}`, type: "session_closed", reason, result };
}

function renderSurface(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface agentRunId="run-1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

describe("SessionSurface", () => {
  it("renders exactly one row per event returned by the stubbed window read", async () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByText("Event number 0")).toBeInTheDocument();
    expect(screen.getByText("Event number 1")).toBeInTheDocument();
    expect(screen.getByText("Event number 2")).toBeInTheDocument();
  });

  it("shows the ← Board affordance and calls onBack when clicked", async () => {
    mockWindowReads(() => []);

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
    mockWindowReads(() => []);
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
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
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

describe("SessionSurface structured feed (plan 02-07 Task 2, D-32)", () => {
  it("shows exactly one Starting session… row for zero events, replaced by the first real event", async () => {
    let events: Record<string, unknown>[] = [];
    mockWindowReads(() => events);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );

    await screen.findByText("Starting session…");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    events = [makeEvent(0)];
    await queryClient.invalidateQueries({ queryKey: sessionFeedQueryKey("run-1") });

    await waitFor(() => expect(screen.queryByText("Starting session…")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("Event number 0")).toBeInTheDocument();
  });

  it("renders a collapsed tool-call row with the tool name and target joined by the middle dot, payload hidden until expanded", async () => {
    const events = [makeToolCall(0, "Bash", { command: "npm test" })];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("Bash · npm test");
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Bash · npm test/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.click();

    expect(await screen.findByText(/"command"/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("shows both input and output for a paired tool_call/tool_result, rendered as one row", async () => {
    const events = [makeToolCall(0, "Bash", { command: "npm test" }), makeToolResult(1, "Bash", "5 passed")];
    mockWindowReads(() => events);

    renderSurface();

    const toggle = await screen.findByRole("button", { name: /Bash · npm test/ });
    toggle.click();

    expect(await screen.findByText(/"command"/)).toBeInTheDocument();
    expect(screen.getByText(/5 passed/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps a tool-call row expanded as new events arrive below it", async () => {
    let events: Record<string, unknown>[] = [makeToolCall(0, "Bash", { command: "npm test" })];
    mockWindowReads(() => events);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole("button", { name: /Bash · npm test/ });
    toggle.click();
    await screen.findByText(/"command"/);

    events = [...events, makeEvent(1), makeEvent(2), makeEvent(3)];
    await queryClient.invalidateQueries({ queryKey: sessionFeedQueryKey("run-1") });

    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(4));
    expect(screen.getByRole("button", { name: /Bash · npm test/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"command"/)).toBeInTheDocument();
  });

  it("renders a system notice as a single muted micro-role line", async () => {
    const events = [
      { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "retrying", type: "system_notice", text: "Retrying request…" },
    ];
    mockWindowReads(() => events);

    renderSurface();

    const node = await screen.findByText("Retrying request…");
    expect(node.className).toContain("type-micro");
  });

  it("renders an unrecognised event kind as a raw fallback line, never dropping it", async () => {
    const events = [
      { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "mystery raw text", type: "mystery_event" },
    ];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("mystery raw text");
  });

  it("renders an unpaired tool_result as a raw fallback line rather than disappearing", async () => {
    const events = [makeToolResult(0, "Bash", "orphaned output")];
    mockWindowReads(() => events);

    renderSurface();

    // No matching `tool_call` was ever loaded to pair against, so the row falls back to the
    // event's own verbatim `raw` text rather than vanishing (T-02-33).
    await screen.findByText("result-0");
  });

  it("renders the failed terminal row with the exact gloss and the error subtype", async () => {
    const events = [makeEvent(0), makeSessionClosed(1, "failed", { subtype: "error_during_execution" })];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("This run ended in an error. The worktree was left as-is — nothing was lost.");
    expect(screen.getByText("error_during_execution")).toBeInTheDocument();
  });

  it("renders a plain terminal row for a completed run, with no destructive styling", async () => {
    const events = [makeEvent(0), makeSessionClosed(1, "completed", { subtype: "success" })];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("Completed");
    expect(screen.queryByText("This run ended in an error. The worktree was left as-is — nothing was lost.")).not.toBeInTheDocument();
  });

  it("never renders more rows than the windowed read returned", async () => {
    const events = Array.from({ length: 50 }, (_, i) => makeEvent(i));
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(50);
  });

  it("fetches the next older page when scrolled to the top of the loaded window", async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEvent(i));
    mockWindowReads(() => events);

    renderSurface();

    // Initial tail load: a probe at offset 0 reports total=60 (> the 50-row page size), so the
    // hook re-fetches the real tail window at offset 10.
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "agent_run_log_window",
        expect.objectContaining({ offset: 10, limit: 50 }),
      ),
    );
    // The tail page (offset 10..59) is loaded; "Event number 10" is its first row and sits at
    // the top of the virtualized viewport, so it renders without needing to scroll first.
    await screen.findByText("Event number 10");

    const scrollContainer = screen.getByTestId("session-feed-scroll");
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "agent_run_log_window",
        expect.objectContaining({ offset: 0, limit: 50 }),
      ),
    );
    await screen.findByText("Event number 0");
  });
});
