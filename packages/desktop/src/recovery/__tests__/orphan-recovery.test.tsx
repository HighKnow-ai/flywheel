/**
 * Behavior under test (03-10-PLAN.md Task 1, 03-UI-SPEC.md "Orphan recovery modal", D-46; issue #210): the
 * dialog is structurally absent for an empty pending-orphan list; a populated list renders a blocking
 * AlertDialog with no Escape/click-outside/close-button dismissal; each row is an Item with the running mark,
 * the Story's key and title and when it started, and a `destructive` Stop; no raw run or session id is shown;
 * a stop in flight shows on its own button as `loading`; a successful stop removes its row (and closes the
 * dialog once the last row resolves); a failed stop leaves its row mounted with permanent failure copy naming
 * the pid; Stop n agents resolves every row concurrently, leaving only the failed ones mounted; focus on open
 * lands on the title, never on a Stop.
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
  orphanKill: (sessionId: string) => orphanKillMock(sessionId),
}));

function makeOrphan(overrides: Partial<PendingOrphanDto> = {}): PendingOrphanDto {
  return {
    runId: "run-1",
    storyId: "story-1",
    storyKey: "FLY-1",
    storyTitle: "Sample orphaned Story",
    projectId: "proj-1",
    externalSessionId: "6f1c2d4e-9a8b-4c3d-8e7f-0a1b2c3d4e5f",
    pid: 4242,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
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

/** Every row's own Stop button. */
const ROW_STOP = /^Stop (FLY-\d+’s|this) agent$/;
/** The footer's Stop n agents. */
const STOP_ALL = /^Stop (\d+ agents?|agents)$/;

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

describe("OrphanRecoveryModal — populated (issue #210)", () => {
  it("is the shadcn AlertDialog, carrying the shared overlay motion in and out", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-slot", "alert-dialog-content");
    expect(dialog.className).toMatch(/data-open:animate-in/);
    expect(dialog.className).toMatch(/data-closed:animate-out/);
    expect(dialog.className).toMatch(/duration-\(--duration-/);
  });

  it("draws each agent as an Item: the running mark, the Story's key and title, when it started, and Stop", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    const row = within(dialog).getByRole("listitem");
    expect(row).toHaveAttribute("data-slot", "item");
    expect(within(row).getByRole("img", { name: "Running" })).toBeInTheDocument();
    const key = within(row).getByText("FLY-1");
    expect(key).toHaveAttribute("data-slot", "story-key");
    expect(within(row).getByText("Sample orphaned Story")).toBeInTheDocument();
    expect(within(row).getByText(/^Started/)).toBeInTheDocument();
    expect(within(row).getByText("1m ago")).toBeInTheDocument();
    const stop = within(row).getByRole("button", { name: "Stop FLY-1’s agent" });
    expect(stop).toHaveAttribute("data-variant", "destructive");
  });

  it("shows no raw run or session id (critique F5)", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).not.toMatch(/6f1c2d4e|run-1|Run ·/);
  });

  it("says one agent in the singular", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    expect(
      await screen.findByRole("heading", { name: "1 agent still running from a previous session" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop 1 agent" })).toBeInTheDocument();
  });

  it("says several agents in the plural, and the footer counts them", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" }), makeOrphan({ runId: "run-2" })]);
    renderModal();

    expect(
      await screen.findByRole("heading", { name: "2 agents still running from a previous session" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop 2 agents" })).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByText(/spending tokens now/)).toBeInTheDocument();
  });

  it("falls back to the unresolvable-Story copy when the Story fields are absent", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ storyKey: "", storyTitle: "" })]);
    renderModal();

    expect(await screen.findByText("An unresolvable Story")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop this agent" })).toBeInTheDocument();
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

  it("does not close on a click outside", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
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

describe("OrphanRecoveryModal — Leave running (A-08(b))", () => {
  it("closes the dialog and stops nothing, from one explicit press", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan(), makeOrphan({ runId: "run-2", pid: 4343 })]);
    renderModal();

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Leave running" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(orphanKillMock).not.toHaveBeenCalled();
  });

  it("sits in the footer to the left of Stop n agents, as outline", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const leave = await screen.findByRole("button", { name: "Leave running" });
    const stopAll = screen.getByRole("button", { name: STOP_ALL });
    expect(leave.compareDocumentPosition(stopAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(leave.parentElement).toBe(stopAll.parentElement);
    expect(leave.parentElement).toHaveAttribute("data-slot", "alert-dialog-footer");
    expect(leave).toHaveAttribute("data-variant", "outline");
  });

  it("stays gone for the session: a later re-read of the orphan list does not bring the dialog back", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OrphanRecoveryModal />
      </QueryClientProvider>,
    );

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Leave running" }));
    await queryClient.invalidateQueries({ queryKey: ["pending-orphans"] });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("adds an answer, not an escape route: Escape and a click outside still do nothing, and no close word appears", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    renderModal();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close|dismiss|cancel|continue/i })).not.toBeInTheDocument();
    expect(orphanKillMock).not.toHaveBeenCalled();
  });
});

describe("OrphanRecoveryModal — stop in flight and outcomes", () => {
  it("shows the stop under way on the row's own button (Button loading)", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: ROW_STOP }));

    await waitFor(() => expect(screen.getByRole("button", { name: ROW_STOP })).toHaveAttribute("aria-busy", "true"));
  });

  it("removes the row on a successful stop, closing the dialog once it was the last row", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan()]);
    orphanKillMock.mockResolvedValue(killDto({ killed: true }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: ROW_STOP }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("leaves a failed row mounted with its pid, and the dialog stays open even as the only remaining row", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 9999 })]);
    orphanKillMock.mockResolvedValue(killDto({ killed: false, pid: 9999, detail: "still running" }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: ROW_STOP }));

    expect(await screen.findByText(/Couldn’t stop it \(PID 9999\)/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("leaves a failed row mounted even when the call itself rejects", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 1234 })]);
    orphanKillMock.mockRejectedValue(new Error("ipc failure"));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: ROW_STOP }));

    expect(await screen.findByText(/Couldn’t stop it \(PID 1234\)/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("Stop n agents resolves every row in one press, leaving exactly the failed rows mounted", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "Stop 3 agents" }));

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText(/Couldn’t stop it \(PID 3\)/)).toBeInTheDocument();
  });

  it("a failed row presents no control that looks retryable — no Stop on it", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ pid: 7 })]);
    orphanKillMock.mockResolvedValue(killDto({ killed: false, pid: 7, detail: "still running" }));
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: ROW_STOP }));

    await screen.findByText(/Couldn’t stop it \(PID 7\)/);
    expect(screen.queryByRole("button", { name: ROW_STOP })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: STOP_ALL })).toBeDisabled();
  });
});

/**
 * Success criterion 2 (ROADMAP.md, quoted verbatim): "the application must never reach the board
 * implying a clean launch it did not achieve." A Stop-all where every stop fails must leave the
 * dialog fully honest about it.
 */
describe("OrphanRecoveryModal — criterion 2 honesty (03-10 Task 3)", () => {
  it("a Stop-all where every stop fails leaves all three rows mounted, each naming its own distinct pid, with no way out", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 101 }),
      makeOrphan({ runId: "run-b", pid: 202 }),
      makeOrphan({ runId: "run-c", pid: 303 }),
    ]);
    orphanKillMock.mockImplementation((runId: string) =>
      Promise.resolve(killDto({ killed: false, pid: { "run-a": 101, "run-b": 202, "run-c": 303 }[runId], detail: "still running" })),
    );
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Stop 3 agents" }));

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByText(/Couldn’t stop it \(PID 101\)/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t stop it \(PID 202\)/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t stop it \(PID 303\)/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "3 agents still running from a previous session" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /close|dismiss|continue/i })).toHaveLength(0);
  });
});

describe("OrphanRecoveryModal — focus (D-46)", () => {
  it("puts initial focus on the dialog's title: never on a Stop (08.1 closure)", async () => {
    // The dialog blocks the board and cannot be dismissed, so one errant Enter on a focused Stop would stop a
    // running agent. The title takes the focus; every button is a deliberate Tab away.
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" }), makeOrphan({ runId: "run-2" })]);
    renderModal();

    const stops = await screen.findAllByRole("button", { name: ROW_STOP });
    const heading = screen.getByRole("heading", { name: /2 agents still running/ });
    await waitFor(() => expect(heading).toHaveFocus());
    for (const stop of stops) expect(stop).not.toHaveFocus();
    expect(screen.getByRole("button", { name: STOP_ALL })).not.toHaveFocus();
  });
});

/**
 * 03-17-PLAN.md Task 1 (T-03-17-01): a row's in-flight flag is a React state update that has not necessarily
 * flushed before a second `.click()` fires in the same tick, so the guard is a ref. Raw `element.click()` calls
 * (never `fireEvent.click`, which flushes `act()` between calls) reproduce the race; `orphanKillMock` returns a
 * never-resolving promise so the row's state never settles mid-test.
 */
describe("OrphanRecoveryModal — synchronous double activation (03-17, T-03-17-01)", () => {
  it("clicking a row's Stop three times in one synchronous tick issues exactly one orphanKill call for that run", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" })]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const stop = await screen.findByRole("button", { name: ROW_STOP });
    stop.click();
    stop.click();
    stop.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(1));
    expect(orphanKillMock).toHaveBeenCalledWith("run-1");
  });

  it("clicking Stop n agents three times in one synchronous tick issues exactly one orphanKill call per row", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const stopAll = await screen.findByRole("button", { name: STOP_ALL });
    stopAll.click();
    stopAll.click();
    stopAll.click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
  });

  it("two rows, each row's own Stop clicked once in the same tick, each get their own independent call", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const stops = await screen.findAllByRole("button", { name: ROW_STOP });
    stops[0].click();
    stops[1].click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    const calledIds = orphanKillMock.mock.calls.map((call: unknown[]) => call[0]);
    expect(calledIds).toEqual(expect.arrayContaining(["run-a", "run-b"]));
  });

  it("Stop n agents clicked, then a row's own Stop clicked in the same tick, that row still receives exactly one call", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockReturnValue(new Promise(() => {}));
    renderModal();

    const stops = await screen.findAllByRole("button", { name: ROW_STOP });
    const stopAll = screen.getByRole("button", { name: STOP_ALL });

    stopAll.click();
    stops[0].click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    expect(orphanKillMock.mock.calls.filter((call: unknown[]) => call[0] === "run-a")).toHaveLength(1);
  });

  it("a rejected stop releases the guard without preventing Stop n agents from still reaching a pending sibling row", async () => {
    pendingOrphansMock.mockResolvedValue([
      makeOrphan({ runId: "run-a", pid: 1 }),
      makeOrphan({ runId: "run-b", pid: 2 }),
    ]);
    orphanKillMock.mockImplementation((runId: string) =>
      runId === "run-a" ? Promise.reject(new Error("ipc failure")) : new Promise(() => {}),
    );
    renderModal();

    const stops = await screen.findAllByRole("button", { name: ROW_STOP });
    stops[0].click();

    await screen.findByText(/Couldn’t stop it \(PID 1\)/);

    screen.getByRole("button", { name: STOP_ALL }).click();

    await waitFor(() => expect(orphanKillMock).toHaveBeenCalledTimes(2));
    expect(orphanKillMock).toHaveBeenNthCalledWith(2, "run-b");
  });
});
