/**
 * Behaviour under test (issue #126): the Stage bar above the Epic card and the Round dock. It shows the Epic's
 * three Stages, which one is open and which are closed. Its Close Stage button lists whatever keeps the open
 * Stage open (the open Round's unanswered questions, each undecided Proposal) and stays disabled until nothing
 * is; an empty Problem, Scope or Exit test is listed as a note that does not block. Closing is confirmed, goes
 * through `stage_close` (which also starts the next Stage's shaping session), and the view then reads the
 * next Stage, its dock waiting for that Stage's first Round.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpicShapingView } from "../EpicShapingView";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, EpicShapingDto, OpenItemDto, RoundDto, StageDto, StageStatusDto } from "../../adapters/tauri";

const epicShapingRounds = vi.fn();
const epicShapingSession = vi.fn();
const stageClose = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    epicShapingRounds: (...args: unknown[]) => epicShapingRounds(...args),
    epicShapingSession: (...args: unknown[]) => epicShapingSession(...args),
    stageClose: (...args: unknown[]) => stageClose(...args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

const EPIC: EpicDto = {
  id: "e1",
  projectId: "p1",
  milestoneId: "m1",
  key: "FLY-4",
  title: "Epic shaping",
  problem: "Shaping in the app is worse than in a terminal.",
  scope: null,
  outOfScope: null,
  exitTest: null,
  state: "shaping",
  rank: "a",
};

const CHALLENGE_OPEN: StageDto = { id: "s1", kind: "challenge_spec", state: "open", rank: 1 };

const ANSWERED_ROUND: RoundDto = {
  id: "r1",
  stageId: "s1",
  stageKind: "challenge_spec",
  number: 1,
  note: "This Round settles who the Epic is for.",
  state: "answered",
  held: false,
  postedAt: "2026-10-22T09:00:00Z",
  answeredAt: "2026-10-22T09:30:00Z",
  questions: [],
};

function questionItem(n: number, title: string): OpenItemDto {
  return { kind: "question", id: `q${n}`, label: `Question ${n} of Round 2 is unanswered: ${title}`, round: 2, number: n, title };
}

const PROPOSAL_ITEM: OpenItemDto = {
  kind: "proposal",
  id: "p1",
  label: "A Proposal to change the Problem is undecided",
  round: null,
  number: null,
  title: "change the Problem",
};

const WARNINGS = ["The Scope is not written yet", "The Exit test is not written yet"];

function status(openItems: OpenItemDto[], next: string | null = "slice"): StageStatusDto {
  return { stageId: "s1", openItems, warnings: WARNINGS, next, closable: openItems.length === 0 && next !== null };
}

function shaping(stages: StageDto[], openStageStatus: StageStatusDto | null, rounds: RoundDto[] = [ANSWERED_ROUND]): EpicShapingDto {
  return { epic: EPIC, stages, rounds, proposals: [], openStageStatus };
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EpicShapingView projectId="p1" projectName="Threadfin" epicId="e1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

async function bar() {
  return (await screen.findByRole("region", { name: "Stages" })) as HTMLElement;
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1", currentEpicId: "e1" });
  epicShapingRounds.mockReset();
  epicShapingSession.mockReset().mockResolvedValue("run-s");
  stageClose.mockReset();
});

describe("the Stage bar (issue #126)", () => {
  it("shows the three Stages in order with the open one marked as the current step", async () => {
    epicShapingRounds.mockResolvedValue(shaping([CHALLENGE_OPEN], status([])));
    renderView();
    const steps = within(await bar()).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual([
      "Challenge the spec, open, Stage 1 of 3",
      "Slice into Stories, not started",
      "Write the Acceptance criteria, not started",
    ]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
  });

  it("lists what is still open and keeps Close Stage disabled until nothing is", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([CHALLENGE_OPEN], status([questionItem(3, "Audience"), questionItem(4, "Surface"), PROPOSAL_ITEM])),
    );
    renderView();
    const region = await bar();
    const close = within(region).getByRole("button", { name: "Close Stage" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    expect(within(region).getByText("Challenge the spec stays open while 3 things are still open:")).toBeTruthy();
    const open = within(region).getByRole("list", { name: "Still open" });
    const lines = within(open).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      "Round 2: 2 questions unanswered · Audience and Surface",
      "Proposal undecided · Change the Problem",
    ]);
    // The list is what describes the disabled button.
    expect(close.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(close.getAttribute("aria-describedby")!)?.textContent).toContain("Audience and Surface");
    fireEvent.click(close);
    expect(stageClose).not.toHaveBeenCalled();
  });

  it("lists an empty Scope and Exit test as a note that does not block the close", async () => {
    epicShapingRounds.mockResolvedValue(shaping([CHALLENGE_OPEN], status([])));
    renderView();
    const region = await bar();
    expect(within(region).getByText(/Not blocking: The Scope is not written yet\. The Exit test is not written yet\./)).toBeTruthy();
    expect((within(region).getByRole("button", { name: "Close Stage" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closing, once confirmed, goes through stage_close and the view moves to the next Stage's first Round", async () => {
    epicShapingRounds.mockResolvedValue(shaping([CHALLENGE_OPEN], status([])));
    const slice: StageDto = { id: "s2", kind: "slice", state: "open", rank: 2 };
    stageClose.mockImplementation(async () => {
      epicShapingRounds.mockResolvedValue(
        shaping([{ ...CHALLENGE_OPEN, state: "closed" }, slice], { ...status([], "criteria"), stageId: "s2" }),
      );
      return {
        closedStageId: "s1",
        opened: slice,
        session: { id: "run-2", epicId: "e1", status: "running", permissionMode: "dontAsk" },
        launchError: null,
        sidecarWarning: null,
      };
    });
    renderView();
    const region = await bar();
    expect(within(region).getByText(/Closing it settles its answers and starts Slice into Stories/)).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Close Stage" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Close Challenge the spec?" });
    expect(stageClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close and start Slice into Stories" }));
    await waitFor(() => expect(stageClose).toHaveBeenCalledWith("s1"));

    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Stages" })).getAllByRole("listitem")[1].textContent).toBe(
        "Slice into Stories, open, Stage 2 of 3",
      ),
    );
    expect(screen.getByRole("heading", { name: "No Round yet in Slice into Stories" })).toBeTruthy();
    // The closed Stage's Round stays below, named with its Stage.
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toContain("Round 1 · Challenge the spec");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says why the next Stage's session did not start, with the Stage closed anyway", async () => {
    epicShapingRounds.mockResolvedValue(shaping([CHALLENGE_OPEN], status([])));
    stageClose.mockResolvedValue({
      closedStageId: "s1",
      opened: { id: "s2", kind: "slice", state: "open", rank: 2 },
      session: null,
      launchError: "claude was not found",
      sidecarWarning: null,
    });
    renderView();
    fireEvent.click(within(await bar()).getByRole("button", { name: "Close Stage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close and start Slice into Stories" }));
    expect(await screen.findByText("The Slice into Stories session did not start: claude was not found. Shape starts it.")).toBeTruthy();
  });

  it("keeps a refused close in the dialog with the core's reason", async () => {
    epicShapingRounds.mockResolvedValue(shaping([CHALLENGE_OPEN], status([])));
    stageClose.mockRejectedValue("the Challenge the spec Stage still has open items:\n- A Proposal to change the Scope is undecided");
    renderView();
    fireEvent.click(within(await bar()).getByRole("button", { name: "Close Stage" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close and start Slice into Stories" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("A Proposal to change the Scope is undecided");
  });

  it("does not close the last Stage yet", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping(
        [
          { id: "s1", kind: "challenge_spec", state: "closed", rank: 1 },
          { id: "s2", kind: "slice", state: "closed", rank: 2 },
          { id: "s3", kind: "criteria", state: "open", rank: 3 },
        ],
        { ...status([], null), stageId: "s3" },
        [],
      ),
    );
    renderView();
    const region = await bar();
    expect((within(region).getByRole("button", { name: "Close Stage" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(region).getByText(/Write the Acceptance criteria is the last Stage/)).toBeTruthy();
    expect(within(region).getAllByRole("listitem")[0].textContent).toBe("Challenge the spec, closed");
  });

  it("is not drawn before shaping has opened a Stage", async () => {
    epicShapingRounds.mockResolvedValue(shaping([], null, []));
    epicShapingSession.mockResolvedValue(null);
    renderView();
    await screen.findByRole("heading", { name: "No Round yet" });
    expect(screen.queryByRole("region", { name: "Stages" })).toBeNull();
  });
});
