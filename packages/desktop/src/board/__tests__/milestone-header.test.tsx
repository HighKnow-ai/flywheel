/**
 * Behaviour under test (issue #106): the Milestone header draws the core's `milestone_progress` answer
 * as given (the Current Milestone, its state, Exit test and next Milestone, Stories merged out of the
 * Stories that will ship, one count box per state, Epics done, the stacked bar) and each Epic's own bar
 * and "n of m Stories merged". It counts nothing itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MilestoneHeader } from "../MilestoneHeader";
import type { MilestoneProgressDto, StoryStateCountsDto } from "../../adapters/tauri";

const milestoneProgress = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return { ...actual, milestoneProgress: (...args: unknown[]) => milestoneProgress(...args) };
});

const ZERO: StoryStateCountsDto = {
  shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 0,
};

function progress(overrides: Partial<MilestoneProgressDto> = {}): MilestoneProgressDto {
  return {
    milestoneId: "m3",
    title: "Shaping",
    exitTest: "A one-line idea becomes an Epic with Ready Stories.",
    state: "in_progress",
    nextMilestoneTitle: "Board and review",
    // Deliberately not a sum of the parts: the header must print the core's total, never add its own.
    counts: { shaping: 1, ready: 2, running: 3, waitingOnYou: 1, stopped: 1, inReview: 1, merged: 2, dropped: 1, storiesTotal: 11 },
    epicsDone: 1,
    epicsTotal: 3,
    epics: [
      { epicId: "e1", key: "FLY-1", title: "Design system", state: "in_progress", counts: { ...ZERO, merged: 1, running: 2, storiesTotal: 7 } },
      { epicId: "e2", key: "FLY-2", title: "Roadmap shaping", state: "shaping", counts: ZERO },
    ],
    ...overrides,
  };
}

function renderHeader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MilestoneHeader projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("MilestoneHeader", () => {
  beforeEach(() => {
    milestoneProgress.mockReset();
  });

  it("shows the Current Milestone, its state, Exit test and the next Milestone", async () => {
    milestoneProgress.mockResolvedValue(progress());
    renderHeader();
    const header = await screen.findByRole("region", { name: "Shaping" });
    expect(milestoneProgress).toHaveBeenCalledWith("p1");
    const heading = within(header).getByRole("heading", { name: "Shaping" });
    expect(heading.parentElement?.textContent).toContain("In progress");
    expect(within(header).getByText("A one-line idea becomes an Epic with Ready Stories.")).toBeTruthy();
    expect(within(header).getByText("Next: Board and review")).toBeTruthy();
  });

  it("prints every count the core sent, Stories merged out of the core's total, and Epics done", async () => {
    milestoneProgress.mockResolvedValue(progress());
    renderHeader();
    const boxes = await screen.findByRole("list", { name: "Stories by state" });
    const names = within(boxes).getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));
    expect(names).toEqual([
      "2 of 11 Stories merged",
      "1 In review",
      "3 Running",
      "2 Ready",
      "1 Shaping",
      "1 Waiting on you",
      "1 Stopped",
      "1 Dropped",
      "1 of 3 Epics done",
    ]);
  });

  it("draws the bar from the counts, with every number in its name and Dropped left out of it", async () => {
    milestoneProgress.mockResolvedValue(progress());
    const { container } = renderHeader();
    const bar = await screen.findByRole("img", {
      name: "11 Stories: 2 merged, 1 in review, 1 waiting on you, 1 stopped, 3 running, 2 ready, 1 shaping; 1 dropped, not counted",
    });
    const segments = Array.from(bar.querySelectorAll("[data-segment]")).map((s) => [
      s.getAttribute("data-segment"),
      (s as HTMLElement).style.flexGrow,
    ]);
    expect(segments).toEqual([
      ["merged", "2"],
      ["inReview", "1"],
      ["waitingOnYou", "1"],
      ["stopped", "1"],
      ["running", "3"],
      ["ready", "2"],
      ["shaping", "1"],
    ]);
    expect(container.querySelector("[data-segment=dropped]")).toBeNull();
  });

  it("lights the Waiting on you box only while a Story waits", async () => {
    milestoneProgress.mockResolvedValue(progress());
    renderHeader();
    expect((await screen.findByRole("listitem", { name: "1 Waiting on you" })).dataset.lit).toBe("true");

    milestoneProgress.mockResolvedValue(progress({ counts: { ...ZERO, ready: 1, storiesTotal: 1 } }));
    renderHeader();
    expect((await screen.findByRole("listitem", { name: "0 Waiting on you" })).dataset.lit).toBeUndefined();
  });

  it("gives each Epic its own bar and n of m Stories merged", async () => {
    milestoneProgress.mockResolvedValue(progress());
    renderHeader();
    const epics = await screen.findByRole("list", { name: "Epics of Shaping" });
    const [first, second] = within(epics).getAllByRole("listitem");
    expect(first.textContent).toContain("Design system");
    expect(first.textContent).toContain("1 of 7 Stories merged");
    expect(within(first).getByRole("img", { name: "7 Stories: 1 merged, 2 running" })).toBeTruthy();
    expect(second.textContent).toContain("Roadmap shaping");
    expect(second.textContent).toContain("No Stories yet");
  });

  it("says so when the project has no Current Milestone", async () => {
    milestoneProgress.mockResolvedValue(null);
    renderHeader();
    expect(await screen.findByText(/No Current Milestone/)).toBeTruthy();
  });

  it("names a failed read", async () => {
    milestoneProgress.mockImplementation(async () => {
      throw new Error("database is locked");
    });
    renderHeader();
    expect(await screen.findByText("The Milestone's progress could not be read: database is locked")).toBeTruthy();
  });
});
