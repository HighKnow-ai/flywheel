/**
 * Issue #190, over a synthetic log of the same shape as the real session that showed it:
 * - every event of the log reaches the feed exactly once, however many older windows are paged in and
 *   however often a live push refetches them;
 * - the header's clock is the session's own duration once it has ended, and counts up from the
 *   session's start while it runs;
 * - Claude CLI's own notices (the stdin warning, hook and thinking-token lines, background-task
 *   lifecycle lines) and the board server's echo of a board call are not feed rows; View raw keeps them.
 *
 * `browser/session-feed.browser.test.tsx` measures the overlap itself, which jsdom cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface, sessionSeconds } from "../SessionSurface";
import { buildFeedRows, feedRowText, usageLimitText } from "../feedRows";
import { sessionFeedQueryKey } from "../../board/useBoardQuery";
import { formatDuration } from "@/lib/format";
import { resetUiState } from "../../state/uiStore";
import {
  STDIN_WARNING,
  SYNTHETIC_ENDED_ROW,
  SYNTHETIC_RUN_ID,
  SYNTHETIC_STARTED_AT,
  logWindow,
  rawWindow,
  syntheticSessionLog,
} from "./fixtures/syntheticSessionLog";

type Entry = Record<string, unknown>;

const served = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
  stored: null as unknown,
  story: null as unknown,
  stopped: null as unknown,
  logCalls: [] as { offset: number; limit: number }[],
  rawCalls: [] as { offset: number; limit: number }[],
  push: null as ((event: Record<string, unknown>) => void) | null,
}));

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    sessionLogWindow: (_id: string, offset: number, limit: number) => {
      served.logCalls.push({ offset, limit });
      return Promise.resolve(logWindow(served.entries, offset, limit));
    },
    sessionRawWindow: (_id: string, offset: number, limit: number) => {
      served.rawCalls.push({ offset, limit });
      return Promise.resolve(rawWindow(served.entries, offset, limit));
    },
    sessionGet: () => Promise.resolve(served.stored),
    storyGet: () => Promise.resolve(served.story),
    storyStopped: () => Promise.resolve(served.stopped),
    sessionsForStory: () => Promise.resolve([]),
    worktreeSummary: () => Promise.resolve(null),
    projectsList: () => Promise.resolve([]),
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => {
      const previous = served.push;
      served.push = (event) => {
        previous?.(event);
        handler(event);
      };
      return Promise.resolve(() => {});
    },
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    pendingPermissionRequests: () => Promise.resolve([]),
  };
});

beforeEach(() => {
  served.entries = syntheticSessionLog();
  served.stored = SYNTHETIC_ENDED_ROW;
  served.story = null;
  served.stopped = null;
  served.logCalls.length = 0;
  served.rawCalls.length = 0;
  served.push = null;
});
afterEach(() => {
  resetUiState();
  vi.useRealTimers();
});

function renderSurface(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <SessionSurface sessionId={SYNTHETIC_RUN_ID} onBack={() => {}} initialStatus="completed" />
    </QueryClientProvider>,
  );
  return client;
}

function loadedSeqs(client: QueryClient): number[] {
  const data = client.getQueryData<{ pages: { entries: Entry[] }[] }>(sessionFeedQueryKey(SYNTHETIC_RUN_ID));
  return (data?.pages ?? []).flatMap((page) => page.entries.map((entry) => entry.seq as number));
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Scrolls to the top of what is loaded until the log's first line is in memory. */
async function pageInEverything(client: QueryClient) {
  const scroller = await screen.findByTestId("session-feed-scroll");
  for (let i = 0; i < 10 && !loadedSeqs(client).includes(0); i += 1) {
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await waitFor(() => expect(loadedSeqs(client).length).toBeGreaterThan(0));
  }
  await waitFor(() => expect(loadedSeqs(client)).toContain(0));
}

describe("the session feed over a long log (issue #190)", () => {
  it("loads every line of the log exactly once when every older window is paged in", async () => {
    const client = renderSurface();
    await pageInEverything(client);

    expect(loadedSeqs(client)).toEqual(range(served.entries.length));
    const keys = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='feed-row-slot']")).map((el) => el.dataset.rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every window, once each, when a live push refetches after paging back", async () => {
    const client = renderSurface();
    await pageInEverything(client);

    await act(async () => served.push?.({ type: "heartbeat", runId: "another-run" }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(loadedSeqs(client)).toEqual(range(served.entries.length));
  });

  it("follows a live log past the last loaded window, without a line twice", async () => {
    served.stored = { ...SYNTHETIC_ENDED_ROW, status: "running", endedAt: null, endingReason: null };
    const client = renderSurface();
    await pageInEverything(client);

    // The run goes on: 60 more lines, more than one window's worth.
    const grown = served.entries.slice(0, -2);
    for (let i = 0; i < 60; i += 1) {
      grown.push({ runId: SYNTHETIC_RUN_ID, seq: grown.length, at: SYNTHETIC_STARTED_AT, raw: "{}", type: "assistant_text", text: `More ${i}` });
    }
    served.entries = grown;
    await act(async () => served.push?.({ type: "assistant_text", runId: SYNTHETIC_RUN_ID }));

    await waitFor(() => expect(loadedSeqs(client)).toEqual(range(grown.length)));
  });
});

describe("View raw over a long log (issue #190)", () => {
  it("shows every line once when every older window is paged in", async () => {
    renderSurface();
    await act(async () => (await screen.findByRole("radio", { name: "Raw" })).click());
    const log = await screen.findByRole("log", { name: "Raw session log" });
    for (let i = 0; i < 10 && log.children.length < served.entries.length; i += 1) {
      await act(async () => {
        log.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await waitFor(() => expect(log.children.length).toBeGreaterThan(0));
    }
    await waitFor(() => expect(log.children.length).toBe(served.entries.length));
    const numbers = Array.from(log.children).map((line) => Number(line.firstElementChild?.textContent));
    expect(numbers).toEqual(range(served.entries.length));
  });
});

describe("the session's clock (issue #190)", () => {
  it("shows an ended session's own duration, whenever it is opened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-25T18:00:00.000Z"));
    renderSurface();

    // 09:40:35 to 09:43:36, labelled and read through lib/format.ts (issue #205).
    await waitFor(() => expect(screen.getByLabelText("Elapsed time")).toHaveTextContent(/^3m 01s$/));
    expect(screen.getByTestId("session-clock")).toHaveTextContent("Duration 3m 01s");
  });

  it("counts a live session up from its own start, not from the first line loaded", async () => {
    const startedAt = new Date(Date.now() - 125_000).toISOString();
    served.stored = { ...SYNTHETIC_ENDED_ROW, status: "running", startedAt, endedAt: null, endingReason: null };
    // The loaded window's first line is much later than the start.
    served.entries = served.entries.slice(0, 40).map((entry) => ({ ...entry, at: new Date().toISOString() }));
    renderSurface();

    await waitFor(() => expect(screen.getByLabelText("Elapsed time")).toHaveTextContent(/^2m 0[5-9]s$/));
  });

  it("reads an hour or more as hours and minutes", () => {
    const start = "2026-10-19T09:00:00.000Z";
    expect(formatDuration(sessionSeconds(start, Date.parse(start) + 3_725_000))).toBe("1h 02m");
    expect(formatDuration(sessionSeconds(start, Date.parse(start) + 59 * 60_000 + 59_000))).toBe("59m 59s");
  });
});

describe("a session the usage limit ended (issue #205)", () => {
  // 2026-10-26 16:00 local, as Claude CLI reports it: the epoch in seconds after a bar.
  const resets = new Date(2026, 9, 26, 16, 0, 0);
  const epoch = Math.floor(resets.getTime() / 1000);
  const USAGE_ENDED_ROW = {
    ...SYNTHETIC_ENDED_ROW,
    storyId: "story-1",
    status: "interrupted",
    endingReason: "usage_limit",
  };

  function usageLimitedLog(): Entry[] {
    const entries = syntheticSessionLog().slice(0, 30);
    const seq = entries.length;
    entries.push({ runId: SYNTHETIC_RUN_ID, seq, at: SYNTHETIC_STARTED_AT, raw: "{}", type: "system_notice", text: `Claude AI usage limit reached|${epoch}` });
    entries.push({ runId: SYNTHETIC_RUN_ID, seq: seq + 1, at: SYNTHETIC_STARTED_AT, raw: "{}", type: "session_closed", reason: "usage_limit" });
    return entries;
  }

  function renderStorySurface() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionSurface sessionId={SYNTHETIC_RUN_ID} storyId="story-1" onBack={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("parses the CLI's notice into a reset time, never printing the epoch", () => {
    const rows = buildFeedRows(usageLimitedLog());
    const row = rows.find((r) => r.kind === "usage_limit");
    expect(row).toEqual({ kind: "usage_limit", key: expect.any(String), resetsAt: resets.toISOString() });
    expect(rows.map(feedRowText).join("\n")).not.toContain(String(epoch));
    expect(usageLimitText(resets.toISOString(), new Date(2026, 9, 26, 12, 0).getTime())).toBe("Usage limit reached · resets 16:00");
    expect(usageLimitText(resets.toISOString(), new Date(2026, 9, 26, 17, 0).getTime())).toBe("Usage limit reached · reset at 16:00");
    expect(usageLimitText(undefined)).toBe("Usage limit reached");
  });

  it("closes on an Alert that says when the limit resets and offers Resume and Open Story", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
    served.entries = usageLimitedLog();
    served.stored = USAGE_ENDED_ROW;
    served.story = { id: "story-1", key: "PRESALES-1014", title: "Write answers back", projectId: "p1" };
    served.stopped = { sessionId: SYNTHETIC_RUN_ID, endingReason: "usage_limit", endedAt: SYNTHETIC_STARTED_AT };
    renderStorySurface();

    const alert = await screen.findByTestId("usage-limit-alert");
    expect(alert).toHaveTextContent("Usage limit reached · resets 16:00");
    expect(alert.textContent).not.toContain(String(epoch));
    expect(await within(alert).findByRole("button", { name: "Resume PRESALES-1014" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Open Story" })).toBeInTheDocument();
    // The notice is the Alert now: it is not repeated as a feed row just above it.
    expect(screen.getAllByText(/Usage limit reached/)).toHaveLength(1);
  });

  it("offers no Resume once the Story has moved on from this session", async () => {
    served.entries = usageLimitedLog();
    served.stored = USAGE_ENDED_ROW;
    served.story = { id: "story-1", key: "PRESALES-1014", title: "Write answers back", projectId: "p1" };
    served.stopped = null;
    renderStorySurface();

    const alert = await screen.findByTestId("usage-limit-alert");
    expect(within(alert).getByRole("button", { name: "Open Story" })).toBeInTheDocument();
    expect(within(alert).queryByRole("button", { name: /Resume/ })).toBeNull();
  });
});

describe("CLI notices stay in View raw (issue #190)", () => {
  const NOT_THE_AGENTS_WORK = [/^Warning: no stdin data received/, /^system: hook_/, /^system: thinking/, /^system: task_/, /board_tool_request/];

  it("are not feed rows", () => {
    const texts = buildFeedRows(syntheticSessionLog()).map(feedRowText);
    for (const pattern of NOT_THE_AGENTS_WORK) {
      expect(texts.filter((text) => pattern.test(text)), String(pattern)).toEqual([]);
    }
    // A stderr line that is not a known CLI notice still shows: a spawn error must never vanish.
    const other = buildFeedRows([{ seq: 0, type: "system_notice", text: "error: unknown option '--frobnicate'" }]);
    expect(other.map(feedRowText)).toEqual(["error: unknown option '--frobnicate'"]);
  });

  it("render nowhere in the feed, and stay in View raw", async () => {
    // One window long, so View raw's tail window holds the log's first line.
    served.entries = syntheticSessionLog().slice(0, 40);
    renderSurface();
    await screen.findByText(/Synthetic turn/);
    expect(screen.queryByText(STDIN_WARNING)).not.toBeInTheDocument();

    await act(async () => screen.getByRole("radio", { name: "Raw" }).click());
    await waitFor(() => expect(screen.getByRole("log", { name: "Raw session log" })).toHaveTextContent("no stdin data received"));
  });
});
