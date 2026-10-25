/**
 * Behavior under test:
 * - Plan 02-01 Task 1: a rendered row exists for every event a stubbed `session_log_window`
 *   read returns.
 * - Plan 02-02 Task 3: the Stop control's three-state contract.
 * - Plan 02-06 Task 2: the permission-request card's feed mount.
 * - Plan 02-07 Task 2: the structured feed itself — one row per event kind, tool-call
 *   collapse/expand, the terminal row, the "Starting session…" pulse, bounded virtualization,
 *   and scroll-triggered older-page paging.
 * - Story #56: rows flow at their own height — no slot is clipped to a reserved height, so a long
 *   agent turn reads in full (G-02-3's overlap cannot happen to rows in document flow); a running
 *   call and the floor show the agent is still working.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";
import { sessionFeedQueryKey } from "../../board/useBoardQuery";
import { resetUiState, useUiStore } from "../../state/uiStore";

/** Issue #205: Stop confirms in ConfirmDestructive. Opens it and returns its action button. */
async function openStopConfirm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  const dialog = await screen.findByRole("alertdialog");
  return within(dialog).getByRole("button", { name: "Stop the session" });
}

/** Issue #205: Discard waits in the ⋯ menu and confirms. Opens its confirmation and returns its action button. */
async function openDiscardConfirm(): Promise<HTMLElement> {
  fireEvent.keyDown(await screen.findByRole("button", { name: "More session actions" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Discard and start fresh/ }));
  const dialog = await screen.findByRole("alertdialog");
  return within(dialog).getByRole("button", { name: "Discard the session" });
}

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
    sessionLogWindow: (sessionId: string, offset: number, limit: number) =>
      invokeCommandMock("session_log_window", { sessionId, offset, limit }),
    sessionRawWindow: (sessionId: string, offset: number, limit: number) =>
      invokeCommandMock("session_raw_window", { sessionId, offset, limit }),
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => {
      capturedAgentEventHandler = handler;
      return Promise.resolve(() => {
        capturedAgentEventHandler = null;
      });
    },
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    // Default: an SessionStopResult with no warning, so every pre-existing test in this file
    // (none of which assert on the resolved value) keeps working unchanged.
    stopSession: (sessionId: string) =>
      invokeCommandMock("session_stop", { sessionId }).then(
        (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
      ),
    // Discard's own wrapper (plan 04-13) — mirrors `stopSession`'s mock shape exactly, routed
    // through the SAME `invokeCommandMock`, under its own command name.
    discardSession: (sessionId: string) =>
      invokeCommandMock("session_discard", { sessionId }).then(
        (result: unknown) => result ?? { status: "interrupted", sidecarWarning: null },
      ),
    // The permission-request card's feed mount (plan 02-06 Task 2) — no pending requests by
    // default so every pre-existing test in this file keeps rendering the plain event feed alone.
    pendingPermissionRequests: () => Promise.resolve([]),
    answerPermissionRequest: () => Promise.resolve(undefined),
    // The header's two narrow board reads (plan 11-22, four-1), routed through the same mock.
    storyGet: (storyId: string) => invokeCommandMock("story_get", { storyId }),
    // The session's stored row (issue #110). Unstubbed it resolves to nothing, as for an unknown id.
    sessionGet: (sessionId: string) => invokeCommandMock("session_get", { sessionId }),
  };
});

/** A `LogWindowDto`-shaped stub response (plan 02-07 Task 1) — mirrors what
 * `commands/session.rs`'s real `session_log_window` returns. */
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
    if (command === "session_log_window") {
      return Promise.resolve(windowFor(getEvents(), args.offset, args.limit));
    }
    return Promise.resolve(undefined);
  });
}

/** A `RawLogWindowDto`-shaped stub response (plan 02-07 Task 1) — mirrors what
 * `commands/session.rs`'s real `session_raw_window` returns. */
function rawWindowFor(lines: string[], offset: number, limit: number) {
  return {
    lines: lines.slice(offset, offset + limit).map((text, i) => ({ line: offset + i, text })),
    offset,
    limit,
    total: lines.length,
  };
}

/** Stubs BOTH `session_log_window` and `session_raw_window` from one call — the raw view and
 * the structured feed are independent reads (plan 02-07 Task 3), so a test exercising the toggle
 * needs both stubbed at once. */
function mockCombinedReads(opts: { events?: Record<string, unknown>[]; rawLines?: string[] }) {
  invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
    if (command === "session_log_window") {
      return Promise.resolve(windowFor(opts.events ?? [], args.offset, args.limit));
    }
    if (command === "session_raw_window") {
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

function renderSurface(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface sessionId="run-1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}


/** The feed's rows: every list item on the surface but the breadcrumb's. */
function feedItems() {
  return screen.getAllByRole("listitem").filter((item) => !item.closest("nav"));
}

describe("SessionSurface", () => {
  it("renders exactly one row per event returned by the stubbed window read", async () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(feedItems()).toHaveLength(3));
    expect(screen.getByText("Event number 0")).toBeInTheDocument();
    expect(screen.getByText("Event number 1")).toBeInTheDocument();
    expect(screen.getByText("Event number 2")).toBeInTheDocument();
  });

  it("no row slot is clipped to a reserved height", async () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    mockWindowReads(() => events);

    renderSurface();

    await waitFor(() => expect(feedItems()).toHaveLength(3));
    const slots = document.querySelectorAll('[data-testid="feed-row-slot"]');
    expect(slots.length).toBe(3);
    slots.forEach((slot) => {
      const style = (slot as HTMLElement).style;
      expect(style.height).toBe("");
      expect(style.overflow).not.toBe("hidden");
      // Measured, not reserved: the virtualizer reads the mounted row's height through this hook.
      expect((slot as HTMLElement).dataset.index).toBeDefined();
    });
  });

  it("mounts only a window of rows for a 2,000-event session, and follows the tail while live", async () => {
    const events = Array.from({ length: 2000 }, (_, i) => makeEvent(i));
    // Serve the whole log in one page, so all 2,000 rows are in the feed at once.
    invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) =>
      Promise.resolve(
        command === "session_log_window" ? { entries: events, offset: args.offset, limit: args.limit, total: events.length } : undefined,
      ),
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderSurface();

    await screen.findByText("Event number 0");
    const slots = document.querySelectorAll('[data-testid="feed-row-slot"]');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThan(100);
    // The list still reserves the height of every row, so the scrollbar spans the whole session.
    const list = screen.getByRole("list", { name: "Session events" });
    expect(Number.parseFloat(list.style.height)).toBeGreaterThan(2000 * 20);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end" });
    // @ts-expect-error test-only cleanup of the stub installed above
    delete Element.prototype.scrollIntoView;
  });

  it("shows the ← Back affordance and calls onBack when clicked", async () => {
    mockWindowReads(() => []);

    const queryClient = new QueryClient();
    const onBack = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={onBack} />
      </QueryClientProvider>,
    );

    const backButton = await screen.findByRole("button", { name: "Back" });
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
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus={status} />
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

  it("confirms before it stops anything, then shows the stop pending (issue #205)", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_stop") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    const confirm = await openStopConfirm();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Stop this session?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/worktree stays exactly as the agent left it/);
    expect(invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_stop")).toHaveLength(0);

    fireEvent.click(confirm);

    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_stop")).toHaveLength(1);
  });

  it("Cancel leaves the session running and sends nothing (issue #205)", async () => {
    mockWindowReads(() => []);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );
    await openStopConfirm();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_stop")).toHaveLength(0);
  });

  it("leaves the stopping state from the command result when no session_closed push arrives", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_stop") {
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
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    fireEvent.click(await openStopConfirm());

    // No session_closed push ever arrives (subscribeAgentEvent's captured handler is never
    // invoked) — the surface must still leave its stopping state from the command's own result.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(
      screen.getByText(/could not confirm the agent process stopped/),
    ).toBeInTheDocument();
  });

  it("renders no warning notice when the sidecar confirms the interrupt", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_stop") return Promise.resolve({ status: "interrupted", sidecarWarning: null });
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    fireEvent.click(await openStopConfirm());

    await waitFor(() => expect(screen.getByText("Interrupted")).toBeInTheDocument());
    expect(screen.queryByText(/could not confirm/)).not.toBeInTheDocument();
  });

  it("still applies a real session_closed push, as an additional source alongside the stop result", async () => {
    mockWindowReads(() => []);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Stop" });
    capturedAgentEventHandler?.(makeSessionClosed(1, "completed"));

    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
  });

  it("renders the exact run-status word for each of the five statuses", () => {
    const cases: Array<["running" | "blocked" | "completed" | "failed" | "interrupted", string]> = [
      ["running", "Running"],
      ["blocked", "Waiting on you"],
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
  it("confirming Stop three times in one synchronous tick sends exactly one session_stop command", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_stop") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    const confirm = await openStopConfirm();
    confirm.click();
    confirm.click();
    confirm.click();

    await waitFor(() => {
      const stopCalls = invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_stop");
      expect(stopCalls).toHaveLength(1);
    });
  });

  it("re-enables Stop after a rejected stop, and a further click sends a second session_stop command", async () => {
    let stopCallCount = 0;
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_stop") {
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
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    const confirm = await openStopConfirm();
    fireEvent.click(confirm);

    // The dialog stays open with the failure's message, and its action is usable again.
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("ipc failure"));
    await waitFor(() => expect(confirm).not.toHaveAttribute("aria-busy", "true"));

    fireEvent.click(confirm);

    await waitFor(() => {
      const stopCalls = invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_stop");
      expect(stopCalls).toHaveLength(2);
    });
  });
});

describe("SessionSurface Discard control (plan 04-13, D-66/D-67, CTX-08)", () => {
  // `impl`, when supplied, is installed INSTEAD OF the plain window-only mock below — never
  // BEFORE it. `mockWindowReads` itself calls `invokeCommandMock.mockImplementation(...)`, so
  // installing a caller's own `session_discard` behavior before calling this helper would be
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
        <SessionSurface sessionId="run-1" storyId="story-1" onBack={() => {}} initialStatus={status} />
      </QueryClientProvider>,
    );
  }

  it("renders neither Stop nor the ⋯ menu for a terminal run", () => {
    renderDiscard("completed");
    expect(screen.queryByRole("button", { name: "More session actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("offers Discard in the ⋯ menu beside Stop for a running run, never as a bare button (issue #205)", async () => {
    renderDiscard("running");
    expect(await screen.findByRole("button", { name: "More session actions" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("confirms what Discard does before it sends anything, and confirming twice in one tick sends one command", async () => {
    renderDiscard("running", (command) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_discard") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });

    const confirm = await openDiscardConfirm();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/launch sheet opens for the same Story/);
    expect(invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_discard")).toHaveLength(0);

    confirm.click();
    confirm.click();

    await waitFor(() => {
      const discardCalls = invokeCommandMock.mock.calls.filter((call: unknown[]) => call[0] === "session_discard");
      expect(discardCalls).toHaveLength(1);
    });
  });

  it("shows the discard pending and disables Stop while it runs", async () => {
    renderDiscard("running", (command) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_discard") return new Promise(() => {}); // never resolves within the test
      return Promise.resolve(undefined);
    });

    const confirm = await openDiscardConfirm();
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: "Stop", hidden: true })).toBeDisabled();
  });

  it("opens the launch sheet for this session's own Story once the discard resolves", async () => {
    renderDiscard("running", (command) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_discard") {
        return Promise.resolve({ status: "interrupted", sidecarWarning: null });
      }
      return Promise.resolve(undefined);
    });

    expect(useUiStore.getState().launchSheetStoryId).toBeNull();

    fireEvent.click(await openDiscardConfirm());

    await waitFor(() => expect(useUiStore.getState().launchSheetStoryId).toBe("story-1"));
  });

  it("keeps the confirmation open with the failure and never opens the launch sheet when the discard call is rejected", async () => {
    renderDiscard("running", (command) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], 0, 50));
      if (command === "session_discard") return Promise.reject(new Error("ipc failure"));
      return Promise.resolve(undefined);
    });

    const confirm = await openDiscardConfirm();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(/could not confirm this discard completed/),
    );
    expect(useUiStore.getState().launchSheetStoryId).toBeNull();

    // A genuine failure must leave the control usable — the action can be tried again.
    await waitFor(() => expect(confirm).not.toHaveAttribute("aria-busy", "true"));
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

    await screen.findByRole("button", { name: "Back" });
    capturedAgentEventHandler?.(
      makePersistenceFailureNotice("run-1", "Flywheel could not write this session's log — the transcript below may be incomplete."),
    );

    await screen.findByText("Flywheel could not write this session's log — the transcript below may be incomplete.");
  });

  it("renders no banner for a persistence-failure notice naming a different run", async () => {
    mockWindowReads(() => []);
    renderSurface();

    await screen.findByRole("button", { name: "Back" });
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
        <SessionSurface sessionId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );

    await screen.findByText("Starting session…");
    expect(feedItems()).toHaveLength(1);

    events = [makeEvent(0)];
    await queryClient.invalidateQueries({ queryKey: sessionFeedQueryKey("run-1") });

    await waitFor(() => expect(screen.queryByText("Starting session…")).not.toBeInTheDocument());
    await waitFor(() => expect(feedItems()).toHaveLength(1));
    expect(screen.getByText("Event number 0")).toBeInTheDocument();
  });

  it("renders a collapsed tool-call row with its verb and target, payload hidden until expanded", async () => {
    const events = [makeToolCall(0, "Bash", { command: "npm test" })];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("npm test");
    expect(screen.queryByText("command")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /(Ran|Running) · npm test/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.click();

    expect(await screen.findByText("command")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("shows both input and output for a paired tool_call/tool_result, rendered as one row", async () => {
    const events = [makeToolCall(0, "Bash", { command: "npm test" }), makeToolResult(1, "Bash", "5 passed")];
    mockWindowReads(() => events);

    renderSurface();

    const toggle = await screen.findByRole("button", { name: /(Ran|Running) · npm test/ });
    toggle.click();

    expect(await screen.findByText("command")).toBeInTheDocument();
    expect(screen.getByText(/5 passed/)).toBeInTheDocument();
    expect(feedItems()).toHaveLength(1);
  });

  it("keeps a tool-call row expanded as new events arrive below it", async () => {
    let events: Record<string, unknown>[] = [makeToolCall(0, "Bash", { command: "npm test" })];
    mockWindowReads(() => events);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole("button", { name: /(Ran|Running) · npm test/ });
    toggle.click();
    await screen.findByText("command");

    events = [...events, makeEvent(1), makeEvent(2), makeEvent(3)];
    await queryClient.invalidateQueries({ queryKey: sessionFeedQueryKey("run-1") });

    await waitFor(() => expect(feedItems().length).toBe(4));
    expect(screen.getByRole("button", { name: /(Ran|Running) · npm test/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("command")).toBeInTheDocument();
  });

  it("renders a system notice as a muted line in the row grid, with its icon (issue #205)", async () => {
    const events = [
      { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "retrying", type: "system_notice", text: "Retrying request…" },
    ];
    mockWindowReads(() => events);

    renderSurface();

    const line = (await screen.findByText("Retrying request…")).closest("p") as HTMLElement;
    expect(line).toHaveClass("feed-notice", "text-muted-foreground");
    expect(line.querySelector("svg")).not.toBeNull();
  });

  it("renders an unrecognised event kind as a raw fallback line, never dropping it", async () => {
    const events = [
      { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "mystery raw text", type: "mystery_event" },
    ];
    mockWindowReads(() => events);

    renderSurface();

    await screen.findByText("mystery raw text");
  });

  it("renders an unpaired tool_result as a result row with its text rather than disappearing", async () => {
    const events = [makeToolResult(0, "Bash", "orphaned output")];
    mockWindowReads(() => events);

    renderSurface();

    // No matching `tool_call` was ever loaded to pair against: the row still shows the result's own
    // text (T-02-33), never the raw log line.
    await screen.findByText("result · orphaned output");
    expect(screen.queryByText("result-0")).not.toBeInTheDocument();
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

    await waitFor(() => expect(feedItems().length).toBeGreaterThan(0));
    expect(feedItems().length).toBeLessThanOrEqual(50);
  });

  it("fetches the next older page when scrolled to the top of the loaded window", async () => {
    const events = Array.from({ length: 60 }, (_, i) => makeEvent(i));
    mockWindowReads(() => events);

    renderSurface();

    // Initial tail load: a probe at offset 0 reports total=60 (> the 50-row page size), so the
    // hook re-fetches the real tail window at offset 10.
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "session_log_window",
        expect.objectContaining({ offset: 10, limit: 50 }),
      ),
    );
    // The tail page (offset 10..59) is loaded; "Event number 10" is its first row and sits at
    // the top of the virtualized viewport, so it renders without needing to scroll first.
    await screen.findByText("Event number 10");

    const scrollContainer = screen.getByTestId("session-feed-scroll");
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));

    // The older window ends where the tail window starts (issue #190): lines 0..9, never 0..49 again.
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "session_log_window",
        expect.objectContaining({ offset: 0, limit: 10 }),
      ),
    );
    await screen.findByText("Event number 0");
    expect(screen.getAllByText("Event number 10")).toHaveLength(1);
  });

  it("a multi-kilobyte agent turn renders in full, with no disclosure to open first", async () => {
    const events = [makeOversizedEvent(0), makeEvent(1)];
    mockWindowReads(() => events);

    renderSurface();

    expect(await screen.findByText(new RegExp(OVERSIZED_EVENT_MARKER))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Expand full text/ })).not.toBeInTheDocument();
    expect(screen.getByText("Event number 1")).toBeInTheDocument();
  });
});

describe("SessionSurface raw view, status strip, and run-status badge (plan 02-07 Task 3)", () => {
  it("toggles between the structured feed and the raw view and back", async () => {
    const events = [makeEvent(0)];
    const rawLines = ['{"type":"assistant_text","text":"Event number 0"}'];
    mockCombinedReads({ events, rawLines });

    renderSurface();

    await screen.findByText("Event number 0");

    screen.getByRole("radio", { name: "Raw" }).click();

    await screen.findByRole("log", { name: "Raw session log" });
    expect(screen.queryByText("Event number 0")).not.toBeInTheDocument();
    await screen.findByText(rawLines[0]);

    screen.getByRole("radio", { name: "Structured" }).click();

    await screen.findByText("Event number 0");
    expect(screen.queryByRole("log", { name: "Raw session log" })).not.toBeInTheDocument();
  });

  it("renders a line number beside each raw line, seeded against a known window", async () => {
    const rawLines = ["first line", "second line", "third line"];
    mockCombinedReads({ rawLines });

    renderSurface();

    screen.getByRole("radio", { name: "Raw" }).click();
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

    screen.getByRole("radio", { name: "Raw" }).click();
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
    // Money and tokens through lib/format.ts (issue #205): two decimals, three figures.
    await waitFor(() => expect(screen.getByLabelText("Cost")).toHaveTextContent("$0.01"));
    expect(screen.getByLabelText("Tokens in")).toHaveTextContent("120 in");
    expect(screen.getByLabelText("Tokens out")).toHaveTextContent("45 out");
    expect(screen.getByLabelText("Elapsed time")).toBeInTheDocument();
  });

  it("labels the clock and reads it through lib/format.ts, never a bare h:mm:ss (issue #205)", async () => {
    mockCombinedReads({
      events: [
        { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "hi", type: "assistant_text", text: "hi" },
        makeSessionClosed(1, "completed"),
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="completed" />
      </QueryClientProvider>,
    );
    await screen.findByText("hi");
    expect(screen.getByTestId("session-clock")).toHaveTextContent(/^Duration /);
  });

  it("renders the correct glyph-and-word pair for each of the five run statuses", () => {
    const cases: Array<["running" | "blocked" | "completed" | "failed" | "interrupted", string]> = [
      ["running", "Running"],
      ["blocked", "Waiting on you"],
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["interrupted", "Interrupted"],
    ];
    for (const [status, label] of cases) {
      mockCombinedReads({});
      const { container, unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus={status} />
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
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );
    expect(container.querySelector(".agent-pulse")).not.toBeNull();
  });

  it("omits the pulse class under a reduced-motion preference but still renders the running glyph and word", () => {
    mockMatchMedia(true);
    mockCombinedReads({});
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
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
    const bash = await screen.findByRole("button", { name: /(Ran|Running) · npm test/ });
    expect(bash).toHaveAttribute("data-live", "true");
    expect(bash.querySelector(".feed-caret.agent-pulse")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Read · a.ts/ })).not.toHaveAttribute("data-live");
    running.unmount();

    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="failed" />
      </QueryClientProvider>,
    );
    const ended = await screen.findByRole("button", { name: /(Ran|Running) · npm test/ });
    expect(ended).not.toHaveAttribute("data-live");
    expect(ended.querySelector(".feed-caret")).toBeNull();
  });

  it("under reduced motion the live caret is a plain mark: present, never animated", async () => {
    mockMatchMedia(true);
    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    renderSurface();
    const bash = await screen.findByRole("button", { name: /(Ran|Running) · npm test/ });
    expect(bash.querySelector(".feed-caret")).not.toBeNull();
    expect(bash.querySelector(".agent-pulse")).toBeNull();
    // @ts-expect-error test-only cleanup of the global override installed above
    delete window.matchMedia;
  });

  it("the status bar is for live status only: it says what the agent is doing, and is gone once it waits or ends (issue #205)", async () => {
    mockCombinedReads({ events: [makeToolCall(0, "Bash", { command: "npm test" })] });
    const a = renderSurface();
    // The command sits in the code face inside the sentence, so the sentence is read as the status's text.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/^The agent is working: Running · npm test\. Last activity .+ ago\.$/),
    );
    a.unmount();

    // Waiting on you: the request card says so; the bar does not repeat it.
    mockCombinedReads({});
    const waiting = render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="blocked" />
      </QueryClientProvider>,
    );
    await screen.findByText("Waiting on you");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/answer the request above/)).toBeNull();
    waiting.unmount();

    // Ended: the header says so.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="completed" />
      </QueryClientProvider>,
    );
    await screen.findByText("Completed");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/This run has ended/)).toBeNull();
  });

  it("Story #56: a long call with heartbeats reads as still running, and its noise never becomes a row", async () => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const at = new Date().toISOString();
    mockCombinedReads({
      events: [
        { runId: "run-1", seq: 0, at: startedAt, raw: "h", type: "system_notice", text: "system: hook_started" },
        { runId: "run-1", seq: 1, at: startedAt, raw: "t", type: "thinking", text: "", hasSignature: true },
        { ...makeToolCall(2, "Bash", { command: "cargo test --workspace" }), at: startedAt, toolUseId: "toolu_long" },
        { runId: "run-1", seq: 3, at, raw: "p1", type: "tool_progress", toolUseId: "toolu_long", toolName: "Bash", elapsedSeconds: 30 },
        { runId: "run-1", seq: 4, at, raw: "p2", type: "tool_progress", toolUseId: "toolu_long", toolName: "Bash", elapsedSeconds: 60 },
        { runId: "run-1", seq: 5, at, raw: "r", type: "rate_limit", status: "allowed_warning" },
      ],
    });
    renderSurface();
    const call = await screen.findByRole("button", { name: /Running · cargo test --workspace/ });
    expect(call).toHaveTextContent("running · 1m");
    expect(feedItems()).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(/^The agent is working: Running · cargo test --workspace\. Last activity \d+s ago\.$/);
  });

  it("while running, Stop leads and Discard waits in the ⋯ menu beside it", async () => {
    mockCombinedReads({});
    renderSurface();
    const stop = await screen.findByRole("button", { name: "Stop" });
    const more = screen.getByRole("button", { name: "More session actions" });
    // Stop is the outlined control; the menu is quieter still, a ghost beside it.
    expect(stop).toHaveAttribute("data-variant", "outline");
    expect(more).toHaveAttribute("data-variant", "ghost");
  });
});

describe("the header names the Story the session serves (11-22, finish-review four-1)", () => {
  function renderHeader(props: { storyId?: string | null }, reads: Record<string, () => Promise<unknown>>) {
    invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], args.offset, args.limit));
      return reads[command]?.() ?? Promise.resolve(undefined);
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} {...props} />
      </QueryClientProvider>,
    );
  }

  it("names the Story by key and title", async () => {
    renderHeader({ storyId: "story-1" }, { story_get: () => Promise.resolve({ key: "FLY-9", title: "Add push retry" }) });
    const story = await screen.findByRole("button", { name: "Open Story FLY-9 Add push retry" });
    // The key is a StoryKey (issue #205), the title beside it.
    expect(within(story).getByText("FLY-9")).toHaveAttribute("data-slot", "story-key");
    expect(within(story).getByText("Add push retry")).toBeInTheDocument();
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
  });

  it("offers + Epic beside + Story in the top bar, as every surface of the project does (#118)", async () => {
    renderHeader(
      { storyId: "story-1" },
      { story_get: () => Promise.resolve({ key: "FLY-9", title: "Add push retry", projectId: "p1" }) },
    );
    expect(await screen.findByRole("button", { name: "Add an Epic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write a Story" })).toBeInTheDocument();
  });

  it("says Session while the read is in flight, and keeps saying it when the Story is gone (read returns null)", async () => {
    renderHeader({ storyId: "story-deleted" }, { story_get: () => Promise.resolve(null) });
    expect(screen.getByText("Session")).toBeInTheDocument();
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("story_get", { storyId: "story-deleted" }));
    expect(screen.getByText("Session")).toBeInTheDocument();
  });

  it("does not throw or blank the header when the read fails", async () => {
    renderHeader({ storyId: "story-1" }, { story_get: () => Promise.reject(new Error("boom")) });
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("story_get", { storyId: "story-1" }));
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});

/**
 * Issue #110: the header and controls follow the session's STORED status, not the "running" default
 * a surface opened without a caller-supplied status used to keep for good. Opened from its Story (no
 * `initialStatus`), a finished session must say how and when it ended and offer no Stop.
 */
describe("SessionSurface status from the stored session row (issue #110)", () => {
  function storedRow(overrides: Record<string, unknown>) {
    return {
      id: "run-1",
      storyId: "story-1",
      status: "running",
      startedAt: "2026-10-19T10:00:00Z",
      endedAt: null,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      externalSessionId: null,
      acknowledgedAt: null,
      abandonedReason: null,
      endingReason: null,
      ...overrides,
    };
  }

  function mockStoredRow(row: Record<string, unknown>) {
    invokeCommandMock.mockImplementation((command: string, args: { offset: number; limit: number }) => {
      if (command === "session_log_window") return Promise.resolve(windowFor([], args.offset, args.limit));
      if (command === "session_get") return Promise.resolve(row);
      return Promise.resolve(undefined);
    });
  }

  function renderOpenedFromStory(row: Record<string, unknown>) {
    mockStoredRow(row);
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("a handed-off session shows how and when it ended, and offers no Stop or Discard", async () => {
    renderOpenedFromStory(
      storedRow({ status: "completed", endedAt: "2026-10-19T10:40:00Z", endingReason: "handed_off" }),
    );

    const ending = await screen.findByTestId("session-ending");
    // How, then when: a relative time with the absolute one on its <time> and in a Tooltip (RelativeTime).
    expect(ending).toHaveTextContent(/^Ended \S.* · handed off$/);
    expect(ending.querySelector("time")).toHaveAttribute("datetime", "2026-10-19T10:40:00.000Z");
    expect(screen.getByTestId("session-clock")).toHaveTextContent("Duration 40m 00s");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More session actions" })).not.toBeInTheDocument();
  });

  it("a session stopped by Cyril shows the stop, its times, and offers no Stop", async () => {
    renderOpenedFromStory(
      storedRow({ status: "interrupted", endedAt: "2026-10-19T10:15:00Z", endingReason: "stopped_by_developer" }),
    );

    const ending = await screen.findByTestId("session-ending");
    expect(ending).toHaveTextContent(/^Ended \S.* · stopped by you$/);
    expect(screen.getByTestId("session-clock")).toHaveTextContent("Duration 15m 00s");
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("the stored end wins over a caller that still thinks the session is running", async () => {
    mockStoredRow(storedRow({ status: "failed", endedAt: "2026-10-19T10:05:00Z", endingReason: "crash" }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} initialStatus="running" />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("session-ending")).toHaveTextContent(/· crash$/);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("a live session still shows Running with Stop and Discard, and no ending", async () => {
    renderOpenedFromStory(storedRow({}));

    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("session_get", { sessionId: "run-1" }));
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More session actions" })).toBeInTheDocument();
    expect(screen.queryByTestId("session-ending")).not.toBeInTheDocument();
  });

  it("draws one header for a running, a waiting and an ended session (issue #205)", async () => {
    /** The header's shape: its two lines and what each holds, by slot, never by the words inside. */
    function headerShape() {
      const header = screen.getByTestId("session-header");
      const [titleLine, metaLine] = Array.from(header.children);
      return {
        lines: header.children.length,
        badge: titleLine.querySelector('[data-slot="badge"]') !== null,
        toggle: within(titleLine as HTMLElement).queryByRole("radiogroup", { name: "Feed view" }) !== null,
        clock: within(metaLine as HTMLElement).queryByTestId("session-clock") !== null,
      };
    }
    const shapes = [];
    for (const row of [
      storedRow({}),
      storedRow({ status: "blocked" }),
      storedRow({ status: "interrupted", endedAt: "2026-10-19T10:15:00Z", endingReason: "usage_limit" }),
    ]) {
      const { unmount } = renderOpenedFromStory(row);
      await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("session_get", { sessionId: "run-1" }));
      await waitFor(() => expect(screen.getByTestId("session-clock")).toBeInTheDocument());
      shapes.push(headerShape());
      unmount();
    }
    expect(shapes[0]).toEqual({ lines: 2, badge: true, toggle: true, clock: true });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("another session's close does not end this one", async () => {
    renderOpenedFromStory(storedRow({}));

    await screen.findByRole("button", { name: "Stop" });
    capturedAgentEventHandler?.({ ...makeSessionClosed(1, "completed"), runId: "run-2" });

    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("session_get", { sessionId: "run-1" }));
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });
});
