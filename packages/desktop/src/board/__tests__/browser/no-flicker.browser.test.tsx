/**
 * A refetch never flickers (issue #195), measured in WebKit over the seeded fixture backend.
 *
 * Each screen is rendered through the real `<App />`, settled, and then hit with a burst of
 * `board:changed` events (and, where a session is live, `agent:event`s), the shape the core emits while
 * an agent works: several in one tick, a broadcast with no project, a git-truth tick. `recordFlicker`
 * watches the screen meanwhile.
 *
 * - Unchanged data: no element may be removed or re-created, no frame may go blank, nothing may move.
 * - Changed data: the changed row is the same element before and after, its text updated in place,
 *   and at no frame was it missing or replaced by a loading line.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import { useTriageDrawer } from "../../../proposals/triageStore";
import App from "../../../App";
import { answer, installFixtureBackend, setReviewInFixture } from "../../../test/critique/m2-fixture";
import { recordFlicker, type FlickerReport } from "../../../test/flicker-recorder";

type Args = Record<string, unknown> | undefined;
type Override = (cmd: string, args: Args, base: unknown) => unknown;

let override: Override | undefined;

const GIT_BACKED = new Set([
  "story_review",
  "review_file_patch",
  "git_facts",
  "worktree_inventory",
  "story_checks_rerun",
]);

/**
 * The fixture backend, answering after a few milliseconds as the real core does (an IPC hop and a SQLite
 * read), so a burst's refetches overlap and cancel each other as they do in the shipped app. Installed
 * once per test: re-installing `mockIPC` would drop the event listeners already registered.
 */
function installBackend() {
  override = undefined;
  let n = 0;
  mockIPC(
    (cmd, payload) => {
      const base = answer(cmd, payload as Args);
      const value = override ? override(cmd, payload as Args, base) : base;
      n += 1;
      // A command that shells out to git answers in hundreds of milliseconds, a SQLite read in a few.
      const delay = GIT_BACKED.has(cmd) ? 150 + ((n * 37) % 200) : 4 + ((n * 7) % 30);
      // Through JSON, as the real IPC is: every answer is a fresh object, never the fixture's own.
      const wire = value === undefined ? null : JSON.parse(JSON.stringify(value));
      return new Promise((resolve) => setTimeout(() => resolve(wire), delay));
    },
    { shouldMockEvents: true },
  );
}

/** The `seq` of every line the session feed has loaded, in order. */
function loadedSeqs(): number[] {
  const data = queryClient.getQueryData(["agent-run-log", "ses-4b"]) as
    { pages: { entries: { seq: number }[] }[] } | undefined;
  return (data?.pages ?? []).flatMap((page) => page.entries.map((entry) => entry.seq));
}

/** Change what the backend answers from now on. */
function changeBackend(next: Override) {
  override = next;
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until no query is fetching, then a little more, so the screen is at rest. */
async function quiet() {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0), { timeout: 5000 });
  await settle(600);
  await waitFor(() => expect(queryClient.isFetching()).toBe(0), { timeout: 5000 });
}

function root(): HTMLElement {
  return (
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }))
  );
}

async function renderBoard() {
  render(<App />, { container: root() });
  await screen.findAllByText("Make clicking and navigation predictable");
  await quiet();
}

async function press(name: string | RegExp) {
  const button = (await screen.findAllByRole("button", { name }))[0];
  button.scrollIntoView({ block: "center" });
  await userEvent.click(button);
}

/**
 * The burst: what an agent at work produces in about a second. Measured on real sessions (see the PR of
 * #195): up to 21 agent events in one second, 19 inside 100 ms, and a board write (a Task, a Check, a
 * permission request) among them.
 */
async function burst({ sessionId }: { sessionId?: string } = {}) {
  const board = (entity: string, projectId: string | null = "p-fly", id: string | null = null) =>
    emit("board:changed", { projectId, entity, id });
  for (let round = 0; round < 3; round += 1) {
    await Promise.all([
      board("task", "p-fly", "t-4b"),
      board("session", "p-fly", "ses-4b"),
      board("git_facts"),
      board("check", null),
      board("story", "p-hkw", "s-h2"),
      ...(sessionId
        ? Array.from({ length: 6 }, (_, i) =>
            emit("agent:event", { runId: sessionId, type: "assistant_text", seq: 1000 + round * 10 + i }),
          )
        : []),
    ]);
    await settle(120);
  }
}

async function measure(target: HTMLElement, run: () => Promise<void>): Promise<FlickerReport> {
  // A face still loading would land mid-burst and re-lay out every line set in it: a shift the refetch did not
  // cause (the CI flake of #208). The setup loads every face first; this says so if that ever stops holding.
  expect(
    Array.from(document.fonts, (face) => `${face.family} ${face.status}`).filter((f) => !f.endsWith(" loaded")),
  ).toEqual([]);
  const recorder = recordFlicker(target);
  await run();
  await quiet();
  return recorder.stop();
}

/** A clock ticking ("10s ago" to "11s ago") is time passing, not the refetch: only digits differ. */
const notAClock = (change: string) => {
  const [head, after] = change.split(" -> ");
  const before = head.slice(head.indexOf("] ") + 2);
  return before.replace(/\d+/g, "#") !== after?.replace(/\d+/g, "#");
};

function expectNoFlicker(report: FlickerReport) {
  expect({
    removed: report.removed,
    added: report.added,
    attributesChanged: report.attributesChanged.filter(notAClock),
    blankFrames: report.blankFrames,
    shifted: report.shifted,
  }).toEqual({
    removed: [],
    added: [],
    attributesChanged: [],
    blankFrames: 0,
    shifted: [],
  });
  if (report.layoutShiftScore !== null) expect(report.layoutShiftScore).toBe(0);
  // The recorder really sampled frames during the burst.
  expect(report.frames).toBeGreaterThan(5);
}

describe("no-flicker: a refetch with unchanged data leaves the screen untouched", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    setReviewInFixture("judging");
    installFixtureBackend();
    installBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("the board and Needs you", async () => {
    await renderBoard();
    const needsYou = await screen.findByRole("region", { name: /^Needs you/ });
    expect(needsYou).toBeInTheDocument();
    expectNoFlicker(await measure(root(), () => burst()));
  });

  it("the Story view with its live feed", async () => {
    await renderBoard();
    await press(/^Open Story FLY-4 Make clicking and navigation predictable$/);
    await screen.findByRole("heading", { name: /Make clicking and navigation predictable/ });
    await quiet();
    expectNoFlicker(await measure(root(), () => burst({ sessionId: "ses-4b" })));
  });

  it("the session feed of a running session", async () => {
    await renderBoard();
    await press(/Open FLY-4 Make clicking/);
    await screen.findAllByText(/npm --prefix packages\/desktop test -- keyboard/);
    await quiet();
    expectNoFlicker(await measure(root(), () => burst({ sessionId: "ses-4b" })));
  });

  it("the review card", async () => {
    await renderBoard();
    await press("Open review of FLY-3");
    await screen.findByRole("region", { name: "Review" });
    await quiet();
    expectNoFlicker(await measure(root(), () => burst()));
  });
});

/**
 * A live session as the core reports it: every `agent:event` is first appended to the session's log, and
 * the session's cost and tokens grow on every read, so each refetch brings back changed data.
 */
function liveSession(sessionId: string) {
  const all = (
    answer("session_log_window", { sessionId, offset: 0, limit: 100000 }) as { entries: Record<string, unknown>[] }
  ).entries;
  const log = [...all];
  let reads = 0;
  changeBackend((cmd, args, base) => {
    if (cmd === "session_log_window" && args?.sessionId === sessionId) {
      const offset = Number(args.offset ?? 0);
      const limit = Number(args.limit ?? 50);
      return { entries: log.slice(offset, offset + limit), offset, limit, total: log.length };
    }
    const grow = (run: Record<string, unknown>) =>
      run.id === sessionId
        ? {
            ...run,
            costUsd: Number(run.costUsd ?? 0) + reads * 0.01,
            outputTokens: Number(run.outputTokens ?? 0) + reads * 40,
          }
        : run;
    if ((cmd === "sessions_for_story" || cmd === "session_get") && base) {
      reads += 1;
      return Array.isArray(base) ? base.map(grow) : grow(base as Record<string, unknown>);
    }
    return base;
  });
  return async (round: number, i: number) => {
    const seqNo = log.length;
    log.push({
      seq: seqNo,
      at: new Date().toISOString(),
      raw: "{}",
      type: "assistant_text",
      text: `Live line ${round}.${i}: checking the next file.`,
    });
    await emit("agent:event", { runId: sessionId, type: "assistant_text", seq: seqNo });
  };
}

describe("no-flicker: a live session's refetches update in place", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    setReviewInFixture("judging");
    installFixtureBackend();
    installBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  async function liveBurst(push: (round: number, i: number) => Promise<void>) {
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 6; i += 1) await push(round, i);
      await emit("board:changed", { projectId: "p-fly", entity: "task", id: "t-4b" });
      await emit("board:changed", { projectId: "p-fly", entity: "git_facts", id: null });
      await settle(150);
    }
  }

  function expectInPlace(report: FlickerReport, survivors: Element[]) {
    // A bounded tail may drop its oldest line as a new one arrives; it must never re-create one it keeps.
    expect(report.recreated).toEqual([]);
    expect(report.blankFrames).toBe(0);
    for (const el of survivors) expect(el.isConnected).toBe(true);
  }

  it("the Story view keeps every element while its live session's data grows", async () => {
    await renderBoard();
    await press(/^Open Story FLY-4 Make clicking and navigation predictable$/);
    const heading = await screen.findByRole("heading", { name: /Make clicking and navigation predictable/ });
    await quiet();
    const push = liveSession("ses-4b");
    const report = await measure(root(), () => liveBurst(push));
    expectInPlace(report, [heading]);
  });

  it("the session feed appends the new lines and keeps the old rows", async () => {
    await renderBoard();
    await press(/Open FLY-4 Make clicking/);
    const old = (await screen.findAllByText(/npm --prefix packages\/desktop test -- keyboard/))[0];
    await quiet();
    const push = liveSession("ses-4b");
    const report = await measure(root(), () => liveBurst(push));
    expectInPlace(report, [old]);
    expect(await screen.findByText(/Live line 2\.5/)).toBeInTheDocument();
  });

  it("the feed at the measured peak rate keeps every loaded line, never re-creates a row and never jumps back", async () => {
    await renderBoard();
    await press(/Open FLY-4 Make clicking/);
    await screen.findAllByText(/npm --prefix packages\/desktop test -- keyboard/);
    await quiet();
    const firstSeq = loadedSeqs()[0];
    const push = liveSession("ses-4b");
    const counting = override!;
    let calls = 0;
    changeBackend((cmd, args, base) => {
      if (cmd === "session_log_window") calls += 1;
      return counting(cmd, args, base);
    });
    const scroller = document.querySelector('[data-testid="session-feed-scroll"]') as HTMLElement;
    let backJumps = 0;
    let lastTop = scroller.scrollTop;
    let sampling = true;
    const frame = () => {
      if (!sampling) return;
      if (scroller.scrollTop < lastTop - 1) backJumps += 1;
      lastTop = scroller.scrollTop;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // 60 agent events at 20 a second, the measured peak, with a board write every tenth: the log runs past
    // its first 50-line window.
    const report = await measure(root(), async () => {
      for (let i = 0; i < 60; i += 1) {
        await push(0, i);
        if (i % 10 === 0) await emit("board:changed", { projectId: "p-fly", entity: "task", id: "t-4b" });
        await settle(50);
      }
    });
    sampling = false;
    // The window grew instead of sliding: the first line loaded is still loaded, and so is the newest.
    expect(loadedSeqs()[0]).toBe(firstSeq);
    expect(await screen.findByText(/Live line 0\.59/)).toBeInTheDocument();
    expect(report.recreated).toEqual([]);
    expect(report.blankFrames).toBe(0);
    expect(backJumps).toBe(0);
    // Coalesced: far fewer log reads than events (one per event, and a second for a window, before #195).
    expect(calls).toBeLessThan(60);
  });
});

describe("no-flicker: a refetch with changed data updates in place", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    setReviewInFixture("judging");
    installFixtureBackend();
    installBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  /** Records every frame in which `find()` found nothing, or a loading line showed. */
  function watchFrames(find: () => Element | null) {
    let missing = 0;
    let loading = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      if (!find()) missing += 1;
      if (/Reading|Loading/.test(root().innerText)) loading += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      running = false;
      return { missing, loading };
    };
  }

  it("a Task's new title on the Story view replaces the old one in the same element", async () => {
    await renderBoard();
    await press(/^Open Story FLY-4 Make clicking and navigation predictable$/);
    const before = await screen.findByText("Open a Story's live session from its row on the board");
    await quiet();
    const row = before.closest("li") ?? before.parentElement!;
    const stop = watchFrames(() => (row.isConnected ? row : null));
    changeBackend((cmd, _args, base) =>
      cmd === "task_list" && Array.isArray(base)
        ? (base as { id: string; title: string }[]).map((t) =>
            t.id === "t-4c" ? { ...t, title: "Open a Story's live session from its board row" } : t,
          )
        : base,
    );
    const report = await measure(root(), () => burst({ sessionId: "ses-4b" }));
    const frames = stop();
    expect(await screen.findByText("Open a Story's live session from its board row")).toBeInTheDocument();
    expect(row.isConnected).toBe(true);
    expect(row.textContent).toContain("Open a Story's live session from its board row");
    expect(frames).toEqual({ missing: 0, loading: 0 });
    expect(report.blankFrames).toBe(0);
  });

  it("a roster row's new doing Task updates in place on the board", async () => {
    await renderBoard();
    const row = document.querySelector('li[data-story-id="s-4"]')!;
    expect(row).not.toBeNull();
    const textBefore = row.textContent;
    const stop = watchFrames(() => (row.isConnected ? row : null));
    changeBackend((cmd, _args, base) =>
      cmd === "roster_rows" && Array.isArray(base)
        ? (base as { storyId: string }[]).map((r) =>
            r.storyId === "s-4" ? { ...r, doingTaskTitle: "Open a Story's live session from its row on the board" } : r,
          )
        : base,
    );
    const report = await measure(root(), () => burst());
    const frames = stop();
    expect(row.isConnected).toBe(true);
    expect(row.textContent).not.toBe(textBefore);
    expect(row.textContent).toContain("Doing: Open a Story's live session from its row on the board");
    expect(frames).toEqual({ missing: 0, loading: 0 });
    expect(report.blankFrames).toBe(0);
    expect(report.removed.filter((r) => !r.startsWith("#text"))).toEqual([]);
  });

  it("a new commit on the branch re-reads the review's diffs without a Reading-the-diff frame", async () => {
    await renderBoard();
    await press("Open review of FLY-3");
    const card = await screen.findByRole("region", { name: "Review" });
    const diff = (await within(card).findAllByRole("group", { name: /^Diff of / }))[0];
    await quiet();
    let reading = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      if (/Reading the diff/.test(card.innerText)) reading += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // The agent committed again: the review reports a new head, so every open file's patch is read again.
    changeBackend((cmd, _args, base) =>
      cmd === "story_review" && base ? { ...(base as object), headSha: "a1b2c3d" } : base,
    );
    const report = await measure(root(), () => burst());
    running = false;
    expect(reading).toBe(0);
    expect(diff.isConnected).toBe(true);
    expect(report.blankFrames).toBe(0);
  });

  it("the review card's Check result updates in place", async () => {
    await renderBoard();
    await press("Open review of FLY-3");
    const card = await screen.findByRole("region", { name: "Review" });
    await quiet();
    const stop = watchFrames(() => (card.isConnected ? card : null));
    setReviewInFixture("ready");
    const report = await measure(root(), () => burst());
    const frames = stop();
    expect(card.isConnected).toBe(true);
    expect(within(card).queryByText(/expected 4.31/)).toBeNull();
    expect(frames).toEqual({ missing: 0, loading: 0 });
    expect(report.blankFrames).toBe(0);
  });
});
