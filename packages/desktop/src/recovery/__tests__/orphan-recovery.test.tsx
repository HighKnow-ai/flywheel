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
    projectId: "proj-1",
    externalSessionId: "sess-1",
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
});

describe("OrphanRecoveryModal — focus (D-46)", () => {
  it("puts focus on the first row's Kill button on mount, not on Kill All", async () => {
    pendingOrphansMock.mockResolvedValue([makeOrphan({ runId: "run-1" }), makeOrphan({ runId: "run-2" })]);
    renderModal();

    const killButtons = await screen.findAllByRole("button", { name: "Kill" });
    await waitFor(() => expect(killButtons[0]).toHaveFocus());
    expect(screen.getByRole("button", { name: "Kill All" })).not.toHaveFocus();
  });
});
