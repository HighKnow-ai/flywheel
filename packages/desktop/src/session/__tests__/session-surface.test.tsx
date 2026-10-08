/**
 * Behavior under test:
 * - Plan 02-01 Task 1: a rendered row exists for every event a stubbed `agent_run_log_window`
 *   read returns.
 * - Plan 02-02 Task 3: the Stop control's three-state contract.
 * - Plan 02-06 Task 2: the permission-request card's feed mount.
 * - Plan 02-07 Task 2: the structured feed itself — one row per event kind, tool-call
 *   collapse/expand, the terminal row, the "Starting session…" pulse, bounded virtualization,
 *   and scroll-triggered older-page paging.
 * - Plan 02-16 Task 1/3 (G-02-3): the virtual row slot is clamped to the height the virtualizer
 *   reserved for it, and a multi-kilobyte event never overlaps the row rendered beneath it. jsdom
 *   performs no layout at all, so `getBoundingClientRect` returns zeroes here and a real painted
 *   overlap can never be observed in this environment — these assertions read the DECLARED
 *   geometry instead (the inline `height` and the pixel value inside `transform`), which is the
 *   only geometry that exists in jsdom, and which is precisely the geometry the defect got wrong.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";
import { sessionFeedQueryKey } from "../../board/useBoardQuery";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { FEED_ROW_HEIGHT } from "../FeedRow";

// Every test in this file shares the same module-level Zustand store — the Discard describe
// block below is the first one in this file to write to it (`setLaunchSheetTaskId`), so it must
// leave no residue for a later test (mirrors `settings-surface.test.tsx`'s own precedent).
afterEach(() => {
  resetUiState();
});

const invokeCommandMock = vi.fn();

/** Captures the handler `SessionSurface`'s `subscribeAgentEvent` effect registers, so a test can
 * simulate a live `agent:event` push (plan 02-11 Task 3) without a real Tauri event channel. Most
 * tests in this file never call it — the default no-op unlisten below is unaffected either way. */
let capturedAgentEventHandler: ((event: Record<string, unknown>) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
      invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
    agentRunRawWindow: (agentRunId: string, offset: number, limit: number) =>
      invokeCommandMock("agent_run_raw_window", { agentRunId, offset, limit }),
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => {
      capturedAgentEventHandler = handler;
      return Promise.resolve(() => {
        capturedAgentEventHandler = null;
      });
    },
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    // Default: an AgentRunStopResult with no warning, so every pre-existing test in this file
    // (none of which assert on the resolved value) keeps working unchanged.
    stopAgentRun: (agentRunId: string) =>
      invokeCommandMock("agent_run_stop", { agentRunId }).then(
        (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
      ),
    // Discard's own wrapper (plan 04-13) — mirrors `stopAgentRun`'s mock shape exactly, routed
    // through the SAME `invokeCommandMock`, under its own command name.
    discardSession: (agentRunId: string) =>
      invokeCommandMock("agent_run_discard", { agentRunId }).then(
        (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
      ),
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

/** A `RawLogWindowDto`-shaped stub response (plan 02-07 Task 1) — mirrors what
 * `commands/agent_run.rs`'s real `agent_run_raw_window` returns. */
function rawWindowFor(lines: string[], offset: number, limit: number) {
  return {
    lines: lines.slice(offset, offset + limit).map((text, i) => ({ line: offset + i, text })),
    offset,
    limit,
    total: lines.length,
  };
}

/** Stubs BOTH `agent_run_log_window` and `agent_run_raw_window` from one call — the raw view and
 * the structured feed are independent reads (plan 02-07 Task 3), so a test exercising the toggle
 * needs both stubbed at once. */
function mockCombinedReads(opts: { events?: Record<string, unknown>[]; rawLines?: string[] }) {
  invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
    if (command === "agent_run_log_window") {
      return Promise.resolve(windowFor(opts.events ?? [], args.offset, args.limit));
    }
    if (command === "agent_run_raw_window") {
      return Promise.resolve(rawWindowFor(opts.rawLines ?? [], args.offset, args.limit));
    }
    return Promise.resolve(undefined);
  });
}

/** Installs a `window.matchMedia` stub reporting `matches` for every query — this project's own
 * jsdom test environment implements no `matchMedia` at all by default (`SessionSurface.tsx`'s own
 * `prefersReducedMotion` guards for that absence in every OTHER test in this file). */
function mockMatchMedia(matches: boolean) {
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

function makeSessionClosed(seq: number, reason: string, result?: { subtype: string }, detail?: string) {
  return { runId: "run-1", seq, at: "2026-01-01T00:00:00.000Z", raw: `closed-${seq}`, type: "session_closed", reason, result, detail };
}

const OVERSIZED_EVENT_MARKER = "OVERSIZED-END-MARKER";

/** G-02-3, Task 3: an `assistant_text`-shaped entry carrying roughly four kilobytes of text — many
 * multiples of the collapsed row height at any plausible font size, which is the condition the
 * UAT screenshot showed. The distinctive marker sits near the END of the text so a later assertion
 * can prove the expanded view reveals text the collapsed view did not. */
function makeOversizedEvent(seq: number) {
  const filler = "the-agent-said-quite-a-lot-of-words-here ".repeat(100); // ~4.2 KB
  return {
    runId: "run-1",
    seq,
    at: "2026-01-01T00:00:00.000Z",
    raw: `oversized-${seq}`,
    type: "assistant_text",
    text: `${filler}${OVERSIZED_EVENT_MARKER}`,
  };
}

/** Reads one `feed-row-slot` element's DECLARED geometry — the inline `height` and the pixel
 * value inside its `transform`. Both are declared inline by Task 1, so both are readable in
 * jsdom (which performs no layout). Fails loudly, with the element's own `outerHTML` in the
 * message, when either value is absent — an absent height IS the defect this plan closes and
 * must never be silently coerced to zero. */
function readSlotGeometry(slot: Element): { height: number; translateY: number } {
  const style = (slot as HTMLElement).style;
  const heightRaw = style.height;
  const transformRaw = style.transform;
  const heightMatch = /^([\d.]+)px$/.exec(heightRaw);
  const transformMatch = /translateY\(([\d.]+)px\)/.exec(transformRaw);
  if (!heightMatch) {
    throw new Error(`feed-row-slot has no declared pixel height: ${slot.outerHTML}`);
  }
  if (!transformMatch) {
    throw new Error(`feed-row-slot has no declared translateY transform: ${slot.outerHTML}`);
  }
  return { height: Number(heightMatch[1]), translateY: Number(transformMatch[1]) };
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

  it("every rendered row slot declares the height the virtualizer reserved and clips its overflow", async () => {
    // G-02-3 structural half: jsdom performs no layout at all — `getBoundingClientRect` returns
    // zeroes here, so a real painted overlap can never be observed in this environment. These
    // assertions read the DECLARED geometry instead — the inline `height` and `overflow` values
    // React put on the wrapper — which is the only geometry that exists in jsdom, and which is
    // precisely the geometry the defect got wrong. Task 3 below adds the behavioural half with an
    // oversized event, still reading this same declared geometry.
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const slots = document.querySelectorAll('[data-testid="feed-row-slot"]');
    expect(slots.length).toBe(3);
    slots.forEach((slot) => {
      const style = (slot as HTMLElement).style;
      expect(style.height).not.toBe("");
      expect(style.overflow).toBe("hidden");
    });
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

  it("leaves the stopping state from the command result when no session_closed push arrives", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_stop") {
        return Promise.resolve({
          status: "interrupted",
          sidecarWarning:
            "Flywheel recorded this run as interrupted, but could not confirm the agent process stopped: sidecar did not acknowledge the interrupt request within 30s",
        });
      }
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

    // No session_closed push ever arrives (subscribeAgentEvent's captured handler is never
    // invoked) — the surface must still leave its stopping state from the command's own result.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stopping…" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(
      screen.getByText(/could not confirm the agent process stopped/),
    ).toBeInTheDocument();
  });

  it("renders no warning notice when the sidecar confirms the interrupt", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_stop") return Promise.resolve({ status: "interrupted", sidecarWarning: null });
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

    await waitFor(() => expect(screen.getByText("Interrupted")).toBeInTheDocument());
    expect(screen.queryByText(/could not confirm/)).not.toBeInTheDocument();
  });

  it("still applies a real session_closed push, as an additional source alongside the stop result", async () => {
    mockWindowReads(() => []);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Stop" });
    capturedAgentEventHandler?.(makeSessionClosed(1, "completed"));

    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
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

  /**
   * 03-17-PLAN.md Task 2 (T-03-17-03): `handleStop` had no synchronous re-entry guard beyond
   * `disabled={stopping}` — a React state update that has not necessarily flushed to the DOM
   * before a second `.click()` fires in the same tick. Raw `element.click()` calls (never
   * `fireEvent.click`, which flushes `act()` between calls) reproduce the bug. Because every
   * adapter call funnels through the single `invokeCommandMock`, the count is filtered to calls
   * whose first argument is the stop command name rather than asserted via a bare
   * `toHaveBeenCalledTimes` on the shared mock.
   */
  it("clicking Stop three times in one synchronous tick sends exactly one agent_run_stop command", async () => {
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
    stopButton.click();
    stopButton.click();

    await waitFor(() => {
      const stopCalls = invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "agent_run_stop");
      expect(stopCalls).toHaveLength(1);
    });
  });

  it("re-enables Stop after a rejected stop, and a further click sends a second agent_run_stop command", async () => {
    let stopCallCount = 0;
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_stop") {
        stopCallCount += 1;
        return stopCallCount === 1
          ? Promise.reject(new Error("ipc failure"))
          : Promise.resolve({ status: "interrupted", sidecarWarning: null });
      }
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled());

    screen.getByRole("button", { name: "Stop" }).click();

    await waitFor(() => {
      const stopCalls = invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "agent_run_stop");
      expect(stopCalls).toHaveLength(2);
    });
  });
});

describe("SessionSurface Discard control (plan 04-13, D-66/D-67, CTX-08)", () => {
  // `impl`, when supplied, is installed INSTEAD OF the plain window-only mock below — never
  // BEFORE it. `mockWindowReads` itself calls `invokeCommandMock.mockImplementation(...)`, so
  // installing a caller's own `agent_run_discard` behavior before calling this helper would be
  // silently overwritten the instant this helper's own default runs.
  function renderDiscard(
    status: "running" | "blocked" | "completed" | "failed" | "interrupted" = "running",
    impl?: (command: string, args: { offset: number; limit: number }) => Promise<unknown>,
  ) {
    if (impl) {
      invokeCommandMock.mockImplementation(impl);
    } else {
      mockWindowReads(() => []);
    }
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface agentRunId="run-1" taskId="task-1" onBack={() => {}} initialStatus={status} />
      </QueryClientProvider>,
    );
  }

  it("renders neither Stop nor Discard for a terminal run", () => {
    renderDiscard("completed");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discarding…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stopping…" })).not.toBeInTheDocument();
  });

  it("reads Discard and is enabled for a running run, beside Stop", async () => {
    renderDiscard("running");
    const discardButton = await screen.findByRole("button", { name: "Discard" });
    expect(discardButton).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it(
    "clicking Discard twice in one synchronous tick sends exactly one agent_run_discard command, " +
      "with no confirmation dialog appearing in between",
    async () => {
      renderDiscard("running", (command) => {
        if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
        if (command === "agent_run_discard") return new Promise(() => {}); // never resolves within the test
        return Promise.resolve(undefined);
      });

      const discardButton = await screen.findByRole("button", { name: "Discard" });
      discardButton.click();
      discardButton.click();

      // No dialog role is present between the activation and the call — CTX-08's "single action"
      // promise, asserted as an absence rather than only checking the end state (a test that only
      // checks the end state would pass for a two-step confirm-then-discard flow too).
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await waitFor(() => {
        const discardCalls = invokeCommandMock.mock.calls.filter(
          (call: unknown[]) => call[0] === "agent_run_discard",
        );
        expect(discardCalls).toHaveLength(1);
      });
    },
  );

  it("reads Discarding… and disables both Discard and Stop immediately after activation", async () => {
    renderDiscard("running", (command) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_discard") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });

    const discardButton = await screen.findByRole("button", { name: "Discard" });
    discardButton.click();

    const discardingButton = await screen.findByRole("button", { name: "Discarding…" });
    expect(discardingButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("opens the launch sheet for this run's own task once the discard resolves", async () => {
    renderDiscard("running", (command) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_discard") {
        return Promise.resolve({ status: "interrupted", sidecarWarning: null });
      }
      return Promise.resolve(undefined);
    });

    expect(useUiStore.getState().launchSheetTaskId).toBeNull();

    const discardButton = await screen.findByRole("button", { name: "Discard" });
    discardButton.click();

    await waitFor(() => expect(useUiStore.getState().launchSheetTaskId).toBe("task-1"));
  });

  it("renders the muted warning notice and never opens the launch sheet when the discard call is rejected", async () => {
    renderDiscard("running", (command) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_discard") return Promise.reject(new Error("ipc failure"));
      return Promise.resolve(undefined);
    });

    const discardButton = await screen.findByRole("button", { name: "Discard" });
    discardButton.click();

    // Reuses the SAME muted notice `StopWarningNotice` renders for a rejected/unconfirmed Stop —
    // no second notice component was introduced.
    await screen.findByText(/could not confirm this discard completed/);
    expect(useUiStore.getState().launchSheetTaskId).toBeNull();

    // A genuine failure must leave the control usable — the discard button re-enables.
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled());
  });
});

describe("SessionSurface Stop/Discard for an authoring run (plan 05-09)", () => {
  function renderAuthoring(
    epicId: string | null,
    impl?: (command: string, args?: { offset: number; limit: number }) => Promise<unknown>,
  ) {
    if (impl) {
      invokeCommandMock.mockImplementation(impl);
    } else {
      mockWindowReads(() => []);
    }
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface
          agentRunId="run-1"
          taskId={null}
          epicId={epicId}
          authoringStage="challenge"
          onBack={() => {}}
          initialStatus="running"
        />
      </QueryClientProvider>,
    );
  }

  it("carries the epic id into the authoring launch hand-off once discard resolves", async () => {
    renderAuthoring("epic-123", (command) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_discard") {
        return Promise.resolve({ status: "interrupted", sidecarWarning: null });
      }
      return Promise.resolve(undefined);
    });

    expect(useUiStore.getState().launchSheetAuthoringHandoff).toBeNull();
    expect(useUiStore.getState().launchSheetTaskId).toBeNull();

    const discardButton = await screen.findByRole("button", { name: "Discard" });
    discardButton.click();

    await waitFor(() =>
      expect(useUiStore.getState().launchSheetAuthoringHandoff).toEqual({ epicId: "epic-123" }),
    );
    // The TASK hand-off channel must never be used for an authoring run.
    expect(useUiStore.getState().launchSheetTaskId).toBeNull();
  });

  it("carries a null epic id (a fresh-epic run) into the same hand-off channel", async () => {
    renderAuthoring(null, (command) => {
      if (command === "agent_run_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "agent_run_discard") {
        return Promise.resolve({ status: "interrupted", sidecarWarning: null });
      }
      return Promise.resolve(undefined);
    });

    const discardButton = await screen.findByRole("button", { name: "Discard" });
    discardButton.click();

    await waitFor(() =>
      expect(useUiStore.getState().launchSheetAuthoringHandoff).toEqual({ epicId: null }),
    );
  });

  it("renders the authoring-specific Stop gloss, never mentioning a worktree", async () => {
    const events = [makeSessionClosed(0, "interrupted")];
    renderAuthoring("epic-123", (command: string, args?: { offset: number; limit: number }) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve(windowFor(events, args?.offset ?? 0, args?.limit ?? 50));
      }
      return Promise.resolve(undefined);
    });

    await screen.findByText(/Every staged proposal is still waiting on the board/);
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
  });
});

describe("SessionSurface persistence-failure banner (plan 02-12, CR-03/PROC-07)", () => {
  function makePersistenceFailureNotice(runId: string, text: string) {
    return {
      runId,
      seq: -1,
      at: "2026-01-01T00:00:00.000Z",
      raw: text,
      type: "system_notice",
      text,
      flywheelPersistenceFailure: true,
    };
  }

  it("shows the incomplete-transcript banner when a persistence-failure notice arrives", async () => {
    mockWindowReads(() => []);
    renderSurface();

    await screen.findByRole("button", { name: "← Board" });
    capturedAgentEventHandler?.(
      makePersistenceFailureNotice("run-1", "Flywheel could not write this session's log — the transcript below may be incomplete."),
    );

    await screen.findByText("Flywheel could not write this session's log — the transcript below may be incomplete.");
  });

  it("renders no banner for a persistence-failure notice naming a different run", async () => {
    mockWindowReads(() => []);
    renderSurface();

    await screen.findByRole("button", { name: "← Board" });
    capturedAgentEventHandler?.(
      makePersistenceFailureNotice("run-9-a-different-run", "Some other run's log failed to open."),
    );

    expect(screen.queryByText("Some other run's log failed to open.")).not.toBeInTheDocument();
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

  it("renders the terminal event's detail beneath the machine-detail line for a failed run (G-02-2)", async () => {
    const events = [
      makeEvent(0),
      makeSessionClosed(1, "failed", { subtype: "error_during_execution" }, "Error: something went wrong on stderr"),
    ];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("error_during_execution");
    expect(screen.getByText("Error: something went wrong on stderr")).toBeInTheDocument();
  });

  it("renders no detail block for a failed run whose terminal event carries none", async () => {
    const events = [makeEvent(0), makeSessionClosed(1, "failed", { subtype: "error_during_execution" })];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("error_during_execution");
    // Absent, not an empty string — nothing extra renders when the sidecar had nothing to say.
    expect(screen.queryByTestId("terminal-detail")).not.toBeInTheDocument();
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

  it("G-02-3: a multi-kilobyte event never overlaps the row beneath it", async () => {
    const events = [makeOversizedEvent(0), makeEvent(1), makeEvent(2)];
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const slots = Array.from(document.querySelectorAll('[data-testid="feed-row-slot"]'));
    expect(slots.length).toBe(3);

    const geometries = slots.map(readSlotGeometry);
    for (let i = 0; i < geometries.length - 1; i += 1) {
      const earlier = geometries[i];
      const later = geometries[i + 1];
      expect(earlier.translateY + earlier.height).toBeLessThanOrEqual(later.translateY);
    }

    // The oversized row's declared height equals the collapsed constant imported from FeedRow —
    // proving the reservation did not silently grow to accommodate the payload.
    expect(geometries[0].height).toBe(FEED_ROW_HEIGHT);
  });

  it("G-02-3: an oversized row's full text is reachable in place", async () => {
    const events = [makeOversizedEvent(0)];
    mockWindowReads(() => events);

    renderSurface();

    const toggle = await screen.findByRole("button", { name: /Expand full text/ });
    expect(screen.queryByText(new RegExp(OVERSIZED_EVENT_MARKER))).not.toBeInTheDocument();

    toggle.click();

    expect(await screen.findByText(new RegExp(OVERSIZED_EVENT_MARKER))).toBeInTheDocument();
  });
});

describe("SessionSurface raw view, status strip, and run-status badge (plan 02-07 Task 3)", () => {
  it("toggles between the structured feed and the raw view and back", async () => {
    const events = [makeEvent(0)];
    const rawLines = ['{"type":"assistant_text","text":"Event number 0"}'];
    mockCombinedReads({ events, rawLines });

    renderSurface();

    await screen.findByText("Event number 0");

    screen.getByRole("button", { name: "View raw" }).click();

    await screen.findByRole("log", { name: "Raw session log" });
    expect(screen.queryByText("Event number 0")).not.toBeInTheDocument();
    await screen.findByText(rawLines[0]);

    screen.getByRole("button", { name: "View structured" }).click();

    await screen.findByText("Event number 0");
    expect(screen.queryByRole("log", { name: "Raw session log" })).not.toBeInTheDocument();
  });

  it("renders a line number beside each raw line, seeded against a known window", async () => {
    const rawLines = ["first line", "second line", "third line"];
    mockCombinedReads({ rawLines });

    renderSurface();

    screen.getByRole("button", { name: "View raw" }).click();
    await screen.findByText("first line");

    expect(screen.getByText("second line")).toBeInTheDocument();
    expect(screen.getByText("third line")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("pages through the same bounded window the feed uses — a large log still renders at most one page's worth of lines", async () => {
    const rawLines = Array.from({ length: 250 }, (_, i) => `raw line ${i}`);
    mockCombinedReads({ rawLines });

    renderSurface();

    screen.getByRole("button", { name: "View raw" }).click();
    // The tail page is offset 200..249 (total 250, page size 50) — its first line renders.
    await screen.findByText("raw line 200");

    const rendered = screen.getAllByText(/^raw line \d+$/);
    // LOG_WINDOW_MAX_LIMIT (packages/core/src/session_log.rs) is 100 — the raw view's own page
    // size (50) already stays well under it, so a large log never renders more than one bounded
    // page's worth of lines at once.
    expect(rendered.length).toBeLessThanOrEqual(100);
  });

  it("renders the status strip with elapsed time, tokens in, tokens out, and a USD cost figure", async () => {
    const events = [
      { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "hi", type: "assistant_text", text: "hi" },
      {
        runId: "run-1",
        seq: 1,
        at: "2026-01-01T00:00:05.000Z",
        raw: "result",
        type: "result",
        subtype: "success",
        totalCostUsd: 0.0123,
        tokensIn: 120,
        tokensOut: 45,
      },
    ];
    mockCombinedReads({ events });

    renderSurface();

    await screen.findByText("hi");
    await waitFor(() => expect(screen.getByLabelText("Cost")).toHaveTextContent("$0.0123"));
    expect(screen.getByLabelText("Tokens in")).toHaveTextContent("120 in");
    expect(screen.getByLabelText("Tokens out")).toHaveTextContent("45 out");
    expect(screen.getByLabelText("Elapsed time")).toBeInTheDocument();
  });

  it("renders the correct glyph-and-word pair for each of the five run statuses", () => {
    const cases: Array<["running" | "blocked" | "completed" | "failed" | "interrupted", string]> = [
      ["running", "Running"],
      ["blocked", "Blocked"],
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["interrupted", "Interrupted"],
    ];
    for (const [status, label] of cases) {
      mockCombinedReads({});
      const { container, unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus={status} />
        </QueryClientProvider>,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(container.querySelector("svg")).toBeInTheDocument();
      unmount();
    }
  });

  it("applies the pulse class to the running badge when no reduced-motion preference is set", () => {
    mockCombinedReads({});
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );
    expect(container.querySelector(".agent-pulse")).not.toBeNull();
  });

  it("omits the pulse class under a reduced-motion preference but still renders the running glyph and word", () => {
    mockMatchMedia(true);
    mockCombinedReads({});
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".agent-pulse")).toBeNull();

    // @ts-expect-error test-only cleanup of the global override installed above
    delete window.matchMedia;
  });
});

describe("08.1 group-four finish-review closure (behaviour)", () => {
  it("prints no meter figures while there are none, and prints them once they exist", async () => {
    mockCombinedReads({ events: [{ runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "hi", type: "assistant_text", text: "hi" }] });
    const { unmount } = renderSurface();
    await screen.findByText("hi");
    expect(screen.getByLabelText("Elapsed time")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tokens in")).toBeNull();
    expect(screen.queryByLabelText("Tokens out")).toBeNull();
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(document.body.textContent).not.toContain("—");
    unmount();
  });

  it("the running tool call, and only that one, wears the live caret; a finished run's call does not", async () => {
    mockCombinedReads({ events: [makeToolCall(0, "Read", { file_path: "a.ts" }), makeToolResult(1, "Read", "ok"), makeToolCall(2, "Bash", { command: "npm test" })] });
    const running = renderSurface();
    const bash = await screen.findByRole("button", { name: /Bash · npm test/ });
    expect(bash).toHaveAttribute("data-live", "true");
    expect(bash.querySelector(".feed-caret.agent-pulse")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Read · a.ts/ })).not.toHaveAttribute("data-live");
    running.unmount();

    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="failed" />
      </QueryClientProvider>,
    );
    const ended = await screen.findByRole("button", { name: /Bash · npm test/ });
    expect(ended).not.toHaveAttribute("data-live");
    expect(ended.querySelector(".feed-caret")).toBeNull();
  });

  it("under reduced motion the live caret is a plain mark: present, never animated", async () => {
    mockMatchMedia(true);
    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    renderSurface();
    const bash = await screen.findByRole("button", { name: /Bash · npm test/ });
    expect(bash.querySelector(".feed-caret")).not.toBeNull();
    expect(bash.querySelector(".agent-pulse")).toBeNull();
    // @ts-expect-error test-only cleanup of the global override installed above
    delete window.matchMedia;
  });

  it("every state has a floor: waiting on the agent, waiting on the developer, the run's end", async () => {
    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    const a = renderSurface();
    expect(await screen.findByText("Waiting on the agent.")).toBeInTheDocument();
    a.unmount();

    mockCombinedReads({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface agentRunId="run-1" onBack={() => {}} initialStatus="completed" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/This run has ended\./)).toBeInTheDocument();
  });

  it("while running, Stop leads and Discard sits on the plain edge", async () => {
    mockCombinedReads({});
    renderSurface();
    const stop = await screen.findByRole("button", { name: "Stop" });
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(stop.className).toContain("session-action-lead");
    expect(discard.className).not.toContain("session-action-lead");
  });
});

describe("review offer (08-04, D-133)", () => {
  function renderOffer(status: "running" | "blocked" | "completed" | "failed" | "interrupted", taskId: string | null) {
    mockCombinedReads({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface agentRunId="run-1" taskId={taskId} onBack={() => {}} initialStatus={status} />
      </QueryClientProvider>,
    );
  }

  it.each(["completed", "failed", "interrupted"] as const)("offers review of the task once the run is %s", (status) => {
    renderOffer(status, "task-1");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(useUiStore.getState().reviewSurface).toEqual({ scope: "task", itemId: "task-1", label: "This task" });
  });

  it.each(["running", "blocked"] as const)("offers nothing while the run is %s", (status) => {
    renderOffer(status, "task-1");
    expect(screen.queryByRole("button", { name: "Review changes" })).not.toBeInTheDocument();
  });

  it("offers nothing for a terminal run with no task id", () => {
    renderOffer("completed", null);
    expect(screen.queryByRole("button", { name: "Review changes" })).not.toBeInTheDocument();
  });
});
