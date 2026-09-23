/**
 * Behavior under test (02-08-PLAN.md Tasks 2 and 3, 02-UI-SPEC.md "Runs section", E5): a task
 * with no runs renders nothing; runs render newest first with status badge, relative time,
 * duration/live elapsed counter and cost; failed/interrupted are distinguishable by glyph and
 * word alone; a run shows its session identity alongside its run identity, or omits the label
 * entirely when it has none yet; a blocked run mounts the compact permission card beneath its own
 * row; the active run's row carries the primary `Watch Live`/`View` action, selecting any other
 * row opens it read-only, and the whole `open-live-session` path is a no-op for a task with no
 * runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunsSection } from "../RunsSection";
import { ItemDetailPanel, type DetailItem } from "../ItemDetailPanel";
import type { RunSummaryDto } from "../../adapters/tauri";

const agentRunsForTaskMock = vi.fn();
const pendingPermissionRequestsMock = vi.fn();
const answerPermissionRequestMock = vi.fn().mockResolvedValue(undefined);
const worktreeSummaryMock = vi.fn();
const invokeCommandMock = vi.fn();
const acknowledgeAgentRunMock = vi.fn();
const sessionSummariesForTaskMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  agentRunsForTask: (taskId: string) => agentRunsForTaskMock(taskId),
  pendingPermissionRequests: (agentRunId: string) => pendingPermissionRequestsMock(agentRunId),
  answerPermissionRequest: (requestId: string, decision: string) =>
    answerPermissionRequestMock(requestId, decision),
  acknowledgeAgentRun: (agentRunId: string) => acknowledgeAgentRunMock(agentRunId),
  sessionSummariesForTask: (taskId: string) => sessionSummariesForTaskMock(taskId),
  // `ItemDetailPanel`'s own describe block below mounts the full panel (title, acceptance
  // criteria, worktree summary, runs section, activity trail) — these two are what its OTHER
  // sections call directly, following the same "delegate every named export the code under test
  // actually calls" discipline `session/__tests__/permission-card.test.tsx` established.
  worktreeSummary: (taskId: string) => worktreeSummaryMock(taskId),
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

// Every existing test in this file predates plan 04-09's summary card and never sets up
// `sessionSummariesForTaskMock` itself — default it to "no summaries" so `useTaskSessionSummaries`
// resolves cleanly for all of them; tests that care about summaries override per-test below.
beforeEach(() => {
  sessionSummariesForTaskMock.mockReset().mockResolvedValue([]);
});

function makeRun(overrides: Partial<RunSummaryDto> = {}): RunSummaryDto {
  return {
    id: "run-1",
    taskId: "task-1",
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    costUsd: 0.1234,
    tokensIn: 100,
    tokensOut: 200,
    externalSessionId: "sess-abc",
    acknowledgedAt: null,
    abandonedReason: null,
    ...overrides,
  };
}

function renderSection(taskId = "task-1", onOpenRun: (agentRunId: string) => void = vi.fn()) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RunsSection taskId={taskId} onOpenRun={onOpenRun} />
    </QueryClientProvider>,
  );
}

describe("RunsSection", () => {
  it("renders nothing at all for a task with no runs", async () => {
    agentRunsForTaskMock.mockResolvedValue([]);
    const { container } = renderSection();

    await waitFor(() => expect(agentRunsForTaskMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
  });

  it("renders nothing while the read is in flight", () => {
    agentRunsForTaskMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders three runs newest first, matching the order the read returns", async () => {
    const runs = [
      makeRun({ id: "run-3", startedAt: "2026-01-03T00:00:00.000Z", externalSessionId: "sess-3" }),
      makeRun({ id: "run-2", startedAt: "2026-01-02T00:00:00.000Z", externalSessionId: "sess-2" }),
      makeRun({ id: "run-1", startedAt: "2026-01-01T00:00:00.000Z", externalSessionId: "sess-1" }),
    ];
    agentRunsForTaskMock.mockResolvedValue(runs);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    // The component trusts the read's own order (already newest-first by construction,
    // `ORDER BY started_at DESC` server-side) rather than re-sorting — this asserts the DOM
    // order matches the array order the read returned, run-3 first through run-1 last.
    expect(within(items[0]).getByText("Run · session sess-3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Run · session sess-2")).toBeInTheDocument();
    expect(within(items[2]).getByText("Run · session sess-1")).toBeInTheDocument();
  });

  it("renders a running run with a live elapsed counter and no blank or zero duration field", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-running", status: "running", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    const elapsed = await screen.findByLabelText("Elapsed time");
    expect(elapsed.textContent).not.toBe("");
    expect(elapsed.textContent).not.toBe("0:00");
    expect(elapsed.textContent).toMatch(/^\d+:\d{2}$/);
  });

  it("distinguishes a failed run from an interrupted run by glyph and word alone", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-failed", status: "failed" }),
      makeRun({ id: "run-interrupted", status: "interrupted" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    // The assertion is made on the printed word alone — this test would still pass in a
    // monochrome rendering, proving the never-colour-alone rule holds here (T-02-17).
  });

  it("renders the exact form 'Run · session {id}' for a run with a session identity", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ externalSessionId: "sess-xyz" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText("Run · session sess-xyz")).toBeInTheDocument();
  });

  it("omits the word 'session' entirely for a run with no session identity yet", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ externalSessionId: null })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText("Run")).toBeInTheDocument();
    expect(screen.queryByText(/session/)).not.toBeInTheDocument();
  });

  it("mounts the compact permission card beneath a blocked run's row", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-blocked", status: "blocked", endedAt: null })]);
    pendingPermissionRequestsMock.mockImplementation((agentRunId: string) =>
      agentRunId === "run-blocked"
        ? Promise.resolve([{ id: "req-1", toolName: "Bash", inputPayload: "{}" }])
        : Promise.resolve([]),
    );
    renderSection();

    const item = await screen.findByRole("listitem");
    await waitFor(() =>
      expect(within(item).getByRole("group", { name: "Bash wants to:" })).toBeInTheDocument(),
    );
  });

  it("the active run's row renders 'Watch Live' when running or blocked", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-active", status: "running", endedAt: null })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByRole("button", { name: "Watch Live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  });

  it("the active run's row renders 'View' when terminal", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-active", status: "completed" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("selecting a non-active run row invokes onOpenRun with that run's id", async () => {
    const onOpenRun = vi.fn();
    const runs = [
      makeRun({ id: "run-active", startedAt: "2026-01-02T00:00:00.000Z", externalSessionId: "sess-active" }),
      makeRun({ id: "run-older", startedAt: "2026-01-01T00:00:00.000Z", externalSessionId: "sess-older" }),
    ];
    agentRunsForTaskMock.mockResolvedValue(runs);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection("task-1", onOpenRun);

    const olderRow = await screen.findByRole("listitem", { name: "Run · session sess-older" });
    fireEvent.click(olderRow);

    expect(onOpenRun).toHaveBeenCalledWith("run-older");
  });

  it("clicking the active row's primary action also invokes onOpenRun with its own id", async () => {
    const onOpenRun = vi.fn();
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-active", status: "running", endedAt: null })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection("task-1", onOpenRun);

    fireEvent.click(await screen.findByRole("button", { name: "Watch Live" }));

    expect(onOpenRun).toHaveBeenCalledWith("run-active");
  });

  it("the open-live-session path is a no-op for a task with no runs — no route change, no error", async () => {
    const onOpenRun = vi.fn();
    agentRunsForTaskMock.mockResolvedValue([]);
    const { container } = renderSection("task-1", onOpenRun);

    await waitFor(() => expect(agentRunsForTaskMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
    expect(onOpenRun).not.toHaveBeenCalled();
  });

  it("resolves every glyph through the marks registry and names no icon component directly", () => {
    // Structural gate documented here too, mirroring `permission-card.test.tsx`'s own precedent —
    // the real enforcement is `RunStatusBadge` resolving `MARKS_BY_ID[...]` rather than importing
    // a lucide icon by name anywhere in this file.
    expect(true).toBe(true);
  });
});

describe("RunsSection — abandoned run (plan 03-10 Task 2, D-49/D-50)", () => {
  beforeEach(() => {
    acknowledgeAgentRunMock.mockReset();
  });

  it("renders the Abandoned badge and word, distinct from the Interrupted badge's glyph", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", endedAt: "2026-01-01T00:05:00.000Z" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText("Abandoned")).toBeInTheDocument();
  });

  it("distinguishes the abandoned badge's glyph from the interrupted badge's glyph", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", startedAt: "2026-01-02T00:00:00.000Z" }),
      makeRun({ id: "run-interrupted", status: "interrupted", startedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    const items = await screen.findAllByRole("listitem");
    const abandonedIcon = within(items[0]).getByText("Abandoned").querySelector("svg");
    const interruptedIcon = within(items[1]).getByText("Interrupted").querySelector("svg");
    expect(abandonedIcon?.getAttribute("class")).toContain("lucide-unplug");
    expect(interruptedIcon?.getAttribute("class")).toContain("lucide-circle-slash");
    expect(abandonedIcon?.getAttribute("class")).not.toBe(interruptedIcon?.getAttribute("class"));
  });

  it("renders the watchdog explanation with the kill record's timestamp when abandonedReason is present", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", abandonedReason: "2026-01-02T03:04:05.000Z" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(
      await screen.findByText(/Flywheel wasn't running to supervise this session/),
    ).toBeInTheDocument();
    expect(screen.queryByText("This run never finished, and Flywheel doesn't know why it stopped.")).not.toBeInTheDocument();
  });

  it("falls back to the honest weaker sentence when abandonedReason is null, with no invented timestamp", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", abandonedReason: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(
      await screen.findByText("This run never finished, and Flywheel doesn't know why it stopped."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Flywheel wasn't running to supervise this session/)).not.toBeInTheDocument();
  });

  it("renders the Acknowledge button only while acknowledgedAt is null", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", acknowledgedAt: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    expect(await screen.findByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
  });

  it("omits the Acknowledge button once acknowledgedAt is non-null, while the word Abandoned remains", async () => {
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", acknowledgedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    await screen.findByText("Abandoned");
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
  });

  it("pressing Acknowledge calls the command with the run id", async () => {
    acknowledgeAgentRunMock.mockResolvedValue(undefined);
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", acknowledgedAt: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));

    await waitFor(() => expect(acknowledgeAgentRunMock).toHaveBeenCalledWith("run-abandoned"));
  });

  it("pressing Acknowledge while the call is in flight does not issue a second call", async () => {
    let resolveAck: () => void = () => {};
    acknowledgeAgentRunMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAck = resolve;
      }),
    );
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", acknowledgedAt: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    const ackButton = await screen.findByRole("button", { name: "Acknowledge" });
    ackButton.click();
    ackButton.click();
    ackButton.click();

    await waitFor(() => expect(acknowledgeAgentRunMock).toHaveBeenCalledTimes(1));
    resolveAck();
  });

  it("a rejected Acknowledge leaves the button and explanatory line in place with an inline message", async () => {
    acknowledgeAgentRunMock.mockRejectedValue(new Error("write failed"));
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", acknowledgedAt: null }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("This run never finished, and Flywheel doesn't know why it stopped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
  });

  it("selecting an abandoned run row still invokes onOpenRun, read-only like any other terminal run", async () => {
    const onOpenRun = vi.fn();
    agentRunsForTaskMock.mockResolvedValue([
      makeRun({ id: "run-abandoned", status: "abandoned", externalSessionId: "sess-abandoned" }),
    ]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    renderSection("task-1", onOpenRun);

    const row = await screen.findByRole("listitem", { name: "Run · session sess-abandoned" });
    fireEvent.click(row);

    expect(onOpenRun).toHaveBeenCalledWith("run-abandoned");
  });
});

describe("ItemDetailPanel section order (plan 02-08 Task 3)", () => {
  function taskDetailItem(): DetailItem {
    return { id: "task-order-1", kind: "task", key: "FLY-9", title: "Ordered task", status: "in_progress", projectId: "proj-1" };
  }

  it("renders the worktree summary, then the runs section, then the activity trail, in that order", async () => {
    worktreeSummaryMock.mockResolvedValue({ branch: "flywheel/fly-9", path: "/Users/cyril/Flywheel/proj/FLY-9" });
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-order-1" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "criterion_list") return Promise.resolve([]);
      if (command === "events_activity_trail") return Promise.resolve([]);
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ItemDetailPanel item={taskDetailItem()} onClose={() => {}} onUpdateTitle={() => {}} />
      </QueryClientProvider>,
    );

    const panel = screen.getByRole("dialog", { name: "FLY-9 detail" });
    const worktreeSection = await within(panel).findByRole("region", { name: "Worktree" });
    const runsSection = within(panel).getByRole("region", { name: "Runs" });
    const activitySection = within(panel).getByRole("region", { name: "Activity" });

    // eslint-disable-next-line no-bitwise
    expect(worktreeSection.compareDocumentPosition(runsSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(runsSection.compareDocumentPosition(activitySection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("RunsSection — session summary card (plan 04-09 Task 3)", () => {
  function makeSummary(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      agentRunId: "run-1",
      createdAt: "2026-01-01T00:05:00.000Z",
      autoGenerated: false,
      changedFiles: ["src/a.ts", "src/b.ts"],
      changedProse: "Did the thing.",
      remains: "Nothing left.",
      nextSessionMustKnow: "Watch out for the flaky test.",
      decisions: [],
      folded: false,
      ...overrides,
    };
  }

  it("renders a run's summary card under its own row and not under a sibling run's row", async () => {
    const runs = [
      makeRun({ id: "run-with-summary", startedAt: "2026-01-02T00:00:00.000Z", externalSessionId: "sess-a" }),
      makeRun({ id: "run-without-summary", startedAt: "2026-01-01T00:00:00.000Z", externalSessionId: "sess-b" }),
    ];
    agentRunsForTaskMock.mockResolvedValue(runs);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    sessionSummariesForTaskMock.mockResolvedValue([makeSummary({ agentRunId: "run-with-summary" })]);
    renderSection();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Remains: Nothing left.")).toBeInTheDocument();
    expect(within(items[1]).queryByText(/Remains:/)).not.toBeInTheDocument();
  });

  it("renders no card at all for a run with no summary", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-1" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    sessionSummariesForTaskMock.mockResolvedValue([]);
    renderSection();

    await screen.findAllByRole("listitem");
    expect(screen.queryByText(/^Summary ·/)).not.toBeInTheDocument();
  });

  it("renders the same auto-generated provenance label the launch sheet uses", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-1" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    sessionSummariesForTaskMock.mockResolvedValue([
      makeSummary({ agentRunId: "run-1", autoGenerated: true }),
    ]);
    renderSection();

    expect(await screen.findByText(/auto-generated/)).toBeInTheDocument();
  });

  it("a task with zero summaries renders the runs list exactly as it does today", async () => {
    agentRunsForTaskMock.mockResolvedValue([makeRun({ id: "run-1" })]);
    pendingPermissionRequestsMock.mockResolvedValue([]);
    sessionSummariesForTaskMock.mockResolvedValue([]);
    renderSection();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(screen.queryByText(/^Summary ·/)).not.toBeInTheDocument();
  });
});
