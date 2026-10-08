/**
 * Behavior under test (03-10-PLAN.md Task 1, 03-UI-SPEC.md "Orphan recovery modal", D-46): the
 * modal is structurally absent for an empty pending-orphan list; a populated list renders a
 * blocking overlay with no Escape/click-outside/close-button dismissal; each row carries task
 * identity, run identity, a relative start time and a Kill action; a kill in flight shows a
 * transient "Killing…" label; a successful kill removes its row (and unmounts the modal once the
 * last row resolves); a failed kill leaves its row mounted with permanent failure copy naming the
 * pid; Kill All resolves every row concurrently, leaving only the failed ones mounted; focus on
 * mount lands on the first row's Kill button, never on Kill All.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrphanRecoveryModal } from "../OrphanRecoveryModal";
import type { OrphanKillDto, PendingOrphanDto } from "../../adapters/tauri";

const pendingOrphansMock = vi.fn();
const orphanKillMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  pendingOrphans: () => pendingOrphansMock(),
  orphanKill: (agentRunId: string) => orphanKillMock(agentRunId),
}));

function makeOrphan(overrides: Partial<PendingOrphanDto> = {}): PendingOrphanDto {
  return {
    runId: "run-1",
    taskId: "task-1",
    taskKey: "FLY-1",
    taskTitle: "Sample orphaned task",
    epicId: null,
    epicKey: null,
    epicTitle: null,
    projectId: "proj-1",
    externalSessionId: "sess-1",
    pid: 4242,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

/** An authoring orphan (CR-01, D-84) — `taskId`/`taskKey`/`taskTitle` are always null for these,
 * mirroring what `flywheel_core::domain::agent_run::LiveOrphan` actually produces via the two
 * `LEFT JOIN`s in `IN_FLIGHT_AGENT_RUNS_SELECT_SQL`. */
function makeAuthoringOrphan(overrides: Partial<PendingOrphanDto> = {}): PendingOrphanDto {
  return makeOrphan({
    taskId: null,
    taskKey: null,
    taskTitle: null,
    epicId: "epic-1",
    epicKey: "FLY-E1",
    epicTitle: "Sample epic",
    ...overrides,
  });
}

function killDto(overrides: Partial<OrphanKillDto> = {}): OrphanKillDto {
  return { killed: true, pid: 4242, detail: null, ...overrides };
}

function renderModal() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrphanRecoveryModal />
    </QueryClientProvider>,
  );
}

describe("OrphanRecoveryModal — empty list", () => {
  it("renders nothing at all for an empty pending-orphan list", async () => {
    pendingOrphansMock.mockResolvedValue([]);
    const { container } = renderModal();

    await waitFor(() => expect(pendingOrphansMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("renders nothing while the launch classification read is in flight", () => {
    pendingOrphansMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderModal();

    expect(container).toBeEmptyDOMElement();
  });
});

describe("OrphanRecoveryModal — populated", () => {
  it("renders a blocking overlay naming task identity, run identity, start time and a Kill action per row", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("FLY-1")).toBeInTheDocument();
    expect(within(dialog).getByText("Sample orphaned task")).toBeInTheDocument();
    expect(within(dialog).getByText("Run · session sess-1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Kill" })).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Every process above is spending tokens right now — Flywheel didn't start any of them this time.",
      ),
    ).toBeInTheDocument();
  });

  it("interpolates singular wording for exactly one orphan", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    expect(
      await screen.findByText("Flywheel found 1 agent process still running from a previous session."),
    ).toBeInTheDocument();
  });

  it("interpolates plural wording for more than one orphan", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" }), makeOrphan({ runId: "run-2" })]);
    renderModal();

    expect(
      await screen.findByText("Flywheel found 2 agent processes still running from a previous session."),
    ).toBeInTheDocument();
  });

  it("falls back to the unresolvable-task copy when the task fields are absent", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ taskKey: "", taskTitle: "" })]);
    renderModal();

    expect(await screen.findByText("an unresolvable task")).toBeInTheDocument();
  });

  it("CR-01: renders epic identity, not task identity, for an authoring orphan of an existing epic", async () => {
    pendingOrphansMock.mockResolvedValue([makeAuthoringOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("FLY-E1")).toBeInTheDocument();
    expect(within(dialog).getByText("Sample epic")).toBeInTheDocument();
    expect(within(dialog).queryByText("an unresolvable task")).not.toBeInTheDocument();
  });

  it("CR-01: renders 'Shaping a new epic' for an authoring orphan whose epic does not exist yet", async () => {
    pendingOrphansMock.mockResolvedValue([makeAuthoringOrphan({ epicId: null, epicKey: null, epicTitle: null })]);
    renderModal();

    expect(await screen.findByText("Shaping a new epic")).toBeInTheDocument();
  });

  it("renders no cost figure, token count, or route into the live session surface", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    await screen.findByRole("alertdialog");
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /watch live|view/i })).not.toBeInTheDocument();
  });
});

describe("OrphanRecoveryModal — undismissable (T-03-10-01, D-46)", () => {
  it("does not close on Escape", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("does not close on a click at the scrim", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialog);

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("has no button whose accessible name matches a close, dismiss or cancel word", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    await screen.findByRole("alertdialog");
    expect(screen.queryByRole("button", { name: /close|dismiss|cancel/i })).not.toBeInTheDocument();
  });
});

describe("OrphanRecoveryModal — Leave them running (A-08(b))", () => {
  it("dismisses the modal and kills nothing, from one explicit press", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan(), makeOrphan({ runId: "run-2", pid: 4343 })]);
    renderModal();

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Leave them running" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(orphanKillMock).not.toHaveBeenCalled();
  });

  it("sits on the hairline to the left of Kill All", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const leave = await screen.findByRole("button", { name: "Leave them running" });
    const killAll = screen.getByRole("button", { name: "Kill All" });
    expect(leave.compareDocumentPosition(killAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(leave.parentElement).toBe(killAll.parentElement);
  });

  it("stays gone for the session: a later re-read of the orphan list does not bring the modal back", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrphanRecoveryModal />
      </QueryClientProvider>,
    );

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Leave them running" }));
    await queryClient.invalidateQueries({ queryKey: ["pending-orphans"] });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("adds an answer, not an escape route: Escape and a scrim click still do nothing, and no close word appears", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close|dismiss|cancel|continue/i })).not.toBeInTheDocument();
    expect(orphanKillMock).not.toHaveBeenCalled();
  });
});

describe("OrphanRecoveryModal — kill in flight and outcomes", () => {
  it("shows a transient 'Killing…' label in place of the Kill button while a kill is in flight", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill" }));

    expect(await screen.findByText("Killing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kill" })).not.toBeInTheDocument();
  });

  it("removes the row on a successful kill, unmounting the modal once it was the last row", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    orphanKillMock.mockResolvedValue(killDto({ killed: true }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("leaves a failed row mounted with its pid, and the modal stays present even as the only remaining row", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 9999 })]);
    orphanKillMock.mockResolvedValue(killDto({ killed: false, pid: 9999, detail: "still running" }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill" }));

    const failureText = await screen.findByText(/Couldn't kill this process \(PID 9999\)/);
    expect(failureText).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("leaves a failed row mounted even when the call itself rejects", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 1234 })]);
    orphanKillMock.mockRejectedValue(new Error("ipc failure"));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill" }));

    expect(await screen.findByText(/Couldn't kill this process \(PID 1234\)/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("Kill All resolves every row in one press, leaving exactly the failed rows mounted", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
      makeOrphan({ runId: "run-c", pid: 3 }),
    ]);
    orphanKillMock.mockImplementation((runId: string) =>
      Promise.resolve(
        runId === "run-c" ? killDto({ killed: false, pid: 3, detail: "still running" }) : killDto({ killed: true }),
      ),
    );
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill All" }));

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText(/Couldn't kill this process \(PID 3\)/)).toBeInTheDocument();
  });

  it("a failed row presents no enabled control that looks retryable — no enabled button named Kill", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 7 })]);
    orphanKillMock.mockResolvedValue(killDto({ killed: false, pid: 7, detail: "still running" }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill" }));

    await screen.findByText(/Couldn't kill this process \(PID 7\)/);
    expect(screen.queryByRole("button", { name: "Kill" })).not.toBeInTheDocument();
  });
});

/**
 * Success criterion 2 (ROADMAP.md, quoted verbatim): "the application must never reach the board
 * implying a clean launch it did not achieve." The application must not be able to lie about this
 * — a Kill All where every single kill fails must leave the modal fully honest about it.
 */
describe("OrphanRecoveryModal — criterion 2 honesty (03-10 Task 3)", () => {
  it("a Kill All where every kill fails leaves all three rows mounted, each naming its own distinct pid, with no way out", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 101 }),
      makeOrphan({ runId: "run-b", pid: 202 }),
      makeOrphan({ runId: "run-c", pid: 303 }),
    ]);
    orphanKillMock.mockImplementation((runId: string) =>
      Promise.resolve(killDto({ killed: false, pid: { "run-a": 101, "run-b": 202, "run-c": 303 }[runId], detail: "still running" })),
    );
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Kill All" }));

    // (a) three rows remain
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    // (b) each row's text contains its own distinct pid
    expect(screen.getByText(/Couldn't kill this process \(PID 101\)/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't kill this process \(PID 202\)/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't kill this process \(PID 303\)/)).toBeInTheDocument();
    // (c) the modal heading is still in the document
    expect(
      screen.getByText("Flywheel found 3 agent processes still running from a previous session."),
    ).toBeInTheDocument();
    // (d) no button whose accessible name matches a close, dismiss or continue word — the
    // application must never reach the board implying a clean launch it did not achieve.
    const buttons = screen.queryAllByRole("button", { name: /close|dismiss|continue/i });
    expect(buttons).toHaveLength(0);
  });
});

describe("OrphanRecoveryModal — focus (D-46)", () => {
  it("puts initial focus on the dialog's heading: never on a Kill, never on Kill All (08.1 closure)", async () => {
    // The modal blocks the board and cannot be dismissed, so one errant Enter on a focused Kill would kill a
    // running agent. The title takes the focus; every button is a deliberate Tab away.
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" }), makeOrphan({ runId: "run-2" })]);
    renderModal();

    const killButtons = await screen.findAllByRole("button", { name: "Kill" });
    const heading = screen.getByRole("heading", { name: /found 2 agent processes/ });
    await waitFor(() => expect(heading).toHaveFocus());
    for (const kill of killButtons) expect(kill).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Kill All" })).not.toHaveFocus();
  });

  it("prints no dangling \"Run\" for a run with no session id, and still prints the session when there is one", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-1", externalSessionId: "sess-1" }),
      makeOrphan({ runId: "run-2", externalSessionId: null }),
    ]);
    renderModal();
    await screen.findAllByRole("button", { name: "Kill" });
    expect(screen.getByText("Run · session sess-1")).toBeInTheDocument();
    expect(screen.queryByText("Run")).toBeNull();
  });
});

/**
 * 03-17-PLAN.md Task 1 (T-03-17-01): `handleKill`/`handleKillAll` had NO synchronous re-entry
 * guard at all — a row's `killing` flag is a React state update that has not necessarily flushed
 * to the DOM before a second `.click()` fires in the same tick, so two synchronous clicks both
 * read the same stale row and dispatch twice. Raw `element.click()` calls (never `fireEvent.click`,
 * which flushes `act()` between calls) reproduce the bug; `orphanKillMock` returns a
 * never-resolving promise so the row's `killing` state never settles mid-test.
 */
describe("OrphanRecoveryModal — synchronous double activation (03-17, T-03-17-01)", () => {
  it("clicking a pending orphan's Kill button three times in one synchronous tick issues exactly one orphanKill call for that run", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" })]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const killButton = await screen.findByRole("button", { name: "Kill" });
    killButton.click();
    killButton.click();
    killButton.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(1));
    expect(orphanKillMock).toHaveBeenCalledWith("run-1");
  });

  it("clicking Kill All three times in one synchronous tick issues exactly one orphanKill call per row, never three per row", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const killAllButton = await screen.findByRole("button", { name: "Kill All" });
    killAllButton.click();
    killAllButton.click();
    killAllButton.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
  });

  it("two rows, each row's own Kill button clicked once in the same tick, each get their own independent call", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const killButtons = await screen.findAllByRole("button", { name: "Kill" });
    killButtons[0].click();
    killButtons[1].click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    const calledIds = orphanKillMock.mock.calls.map((call: unknown[]) => call[0]);
    expect(calledIds).toEqual(expect.arrayContaining(["run-a", "run-b"]));
  });

  it("Kill All clicked, then a still-listed row's own Kill button clicked in the same tick, that row still receives exactly one call", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const killButtons = await screen.findAllByRole("button", { name: "Kill" });
    const firstRowKill = killButtons[0];
    const killAllButton = screen.getByRole("button", { name: "Kill All" });

    killAllButton.click();
    firstRowKill.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    expect(orphanKillMock.mock.calls.filter((call: unknown[]) => call[0] === "run-a")).toHaveLength(1);
  });

  it("a rejected kill releases the guard without preventing Kill All from still reaching a still-pending sibling row", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockImplementation((runId: string) =>
      runId === "run-a" ? Promise.reject(new Error("ipc failure")) : new Promise(() => {}),
    );
    renderModal();

    const killButtons = await screen.findAllByRole("button", { name: "Kill" });
    killButtons[0].click();

    await screen.findByText(/Couldn't kill this process \(PID 1\)/);

    const killAllButton = screen.getByRole("button", { name: "Kill All" });
    killAllButton.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    expect(orphanKillMock).toHaveBeenNthCalledWith(2, "run-b");
  });
});
