/**
 * Behaviour under test (issue #50, reworked by issue #201): Write a Story picks its Milestone and its Epic with
 * Comboboxes (Popover + Command), never a native select. Each list ends in "New Milestone…" / "New Epic…",
 * whose fields show only once picked, and one submit writes whatever is new in order: the Milestone, the
 * Epic, then the Story. The submit sits in the dialog's footer, outside the scrolling body, so it is never
 * below the fold. The top bar offers + Story only; Add an Epic opens from the Milestone header.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryFormDialog, WriteStoryDialog } from "../WriteStoryDialog";
import type { EpicDto, MilestoneDto, StoryDto } from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneCreate = vi.fn();
const epicList = vi.fn();
const epicCreate = vi.fn();
const storyWriteByHand = vi.fn();
const success = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneCreate: (...args: unknown[]) => milestoneCreate(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    epicCreate: (...args: unknown[]) => epicCreate(...args),
    storyWriteByHand: (...args: unknown[]) => storyWriteByHand(...args),
  };
});

vi.mock("../../lib/notify", () => ({
  notify: { success: (...args: unknown[]) => success(...args), error: vi.fn(), dismiss: vi.fn() },
}));

function milestone(id: string, title: string, overrides: Partial<MilestoneDto> = {}): MilestoneDto {
  return { id, projectId: "p1", title, exitTest: null, state: "shaping", current: false, rank: id, ...overrides };
}

function epic(id: string, key: string, title: string, milestoneId: string, state = "shaping"): EpicDto {
  return {
    id,
    projectId: "p1",
    milestoneId,
    key,
    title,
    problem: null,
    scope: null,
    outOfScope: null,
    exitTest: null,
    state,
    rank: id,
  };
}

function story(key: string): StoryDto {
  return {
    id: "s1",
    projectId: "p1",
    epicId: "e1",
    key,
    title: "S",
    description: null,
    state: "ready",
    runsAfterStoryId: null,
    rank: "a",
  };
}

function wrap(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

async function openWriteStory() {
  wrap(<WriteStoryDialog projectId="p1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Write a Story" }));
  return screen.findByRole("dialog", { name: "Write a Story" });
}

/** Opens a Combobox and picks the option whose name matches. */
async function pick(name: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

beforeEach(() => {
  milestoneList
    .mockReset()
    .mockResolvedValue([
      milestone("m1", "Clean cut", { state: "done" }),
      milestone("m2", "Board and review", { current: true, state: "in_progress" }),
      milestone("m3", "One-week exit test"),
    ]);
  milestoneCreate.mockReset().mockResolvedValue(milestone("m9", "Relay"));
  epicList
    .mockReset()
    .mockImplementation((milestoneId: string) =>
      Promise.resolve(
        milestoneId === "m2" ? [epic("e1", "FLY-1", "Roster", "m2"), epic("e0", "FLY-0", "Old", "m2", "done")] : [],
      ),
    );
  epicCreate.mockReset().mockResolvedValue(epic("e9", "FLY-9", "Phones", "m9"));
  storyWriteByHand.mockReset().mockResolvedValue(story("FLY-12"));
  success.mockReset();
});

describe("Write a Story: Comboboxes, not native selects", () => {
  it("picks the Milestone and then its Epic from Comboboxes listing only open records", async () => {
    const dialog = await openWriteStory();
    expect(dialog.querySelector("select")).toBeNull();

    const epicBox = within(dialog).getByRole("combobox", { name: "Epic" });
    expect(epicBox).toBeDisabled();
    expect(epicBox).toHaveTextContent("Pick a Milestone first");

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Milestone" }));
    const milestones = await screen.findByRole("listbox");
    await within(milestones).findByRole("option", { name: /Board and review/ });
    expect(within(milestones).queryByRole("option", { name: /Clean cut/ })).toBeNull();
    expect(within(milestones).getByRole("option", { name: "New Milestone…" })).toBeInTheDocument();
    fireEvent.click(within(milestones).getByRole("option", { name: /Board and review/ }));

    expect(within(dialog).getByRole("combobox", { name: "Milestone" })).toHaveTextContent("Board and review");
    await waitFor(() => expect(epicBox).toBeEnabled());
    fireEvent.click(epicBox);
    const epics = await screen.findByRole("listbox");
    await within(epics).findByRole("option", { name: /FLY-1 Roster/ });
    expect(within(epics).queryByRole("option", { name: /Old/ })).toBeNull();
    fireEvent.click(within(epics).getByRole("option", { name: /FLY-1 Roster/ }));
    expect(epicBox).toHaveTextContent("FLY-1 Roster");
  });

  it("writes a Story with its criteria and Checks into the picked Epic, and keeps the Epic for the next one", async () => {
    const dialog = await openWriteStory();
    const write = within(dialog).getByRole("button", { name: "Write Story" });
    fireEvent.change(within(dialog).getByLabelText("Story title"), { target: { value: "Start a Story" } });
    fireEvent.change(within(dialog).getByLabelText("Criterion 1"), { target: { value: "It starts" } });
    expect(write).toBeDisabled();

    await pick("Milestone", /Board and review/);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeEnabled());
    await pick("Epic", /FLY-1 Roster/);
    expect(write).toBeEnabled();

    fireEvent.change(within(dialog).getByLabelText("Check command 1"), { target: { value: "cargo test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add criterion" }));
    fireEvent.change(within(dialog).getByLabelText("Criterion 2"), { target: { value: "It shows its state" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add criterion" }));
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "why" } });
    fireEvent.click(write);

    await waitFor(() =>
      expect(storyWriteByHand).toHaveBeenCalledWith("e1", "Start a Story", "why", [
        { statement: "It starts", checkCommand: "cargo test" },
        { statement: "It shows its state", checkCommand: null },
      ]),
    );
    await waitFor(() => expect(within(dialog).getByLabelText("Story title")).toHaveValue(""));
    expect(success).toHaveBeenCalledWith("Wrote FLY-12", expect.anything());
    expect(within(dialog).getByRole("combobox", { name: "Epic" })).toHaveTextContent("FLY-1 Roster");
    expect(milestoneCreate).not.toHaveBeenCalled();
    expect(epicCreate).not.toHaveBeenCalled();
  });

  it("cannot write a Story without a criterion", async () => {
    const dialog = await openWriteStory();
    await pick("Milestone", /Board and review/);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeEnabled());
    await pick("Epic", /FLY-1 Roster/);
    fireEvent.change(within(dialog).getByLabelText("Story title"), { target: { value: "No criteria" } });
    expect(within(dialog).getByRole("button", { name: "Write Story" })).toBeDisabled();
  });

  it("shows the core's refusal in the footer and keeps the draft", async () => {
    storyWriteByHand.mockRejectedValue(new Error("Epic is done; a new Story goes into an open Epic"));
    const dialog = await openWriteStory();
    await pick("Milestone", /Board and review/);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeEnabled());
    await pick("Epic", /FLY-1 Roster/);
    fireEvent.change(within(dialog).getByLabelText("Story title"), { target: { value: "Kept" } });
    fireEvent.change(within(dialog).getByLabelText("Criterion 1"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write Story" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Epic is done; a new Story goes into an open Epic");
    expect(alert.closest("[data-slot=dialog-footer]")).not.toBeNull();
    expect(within(dialog).getByLabelText("Story title")).toHaveValue("Kept");
  });
});

describe("Write a Story: New Milestone… and New Epic…", () => {
  it("shows the new records' fields only once they are picked", async () => {
    const dialog = await openWriteStory();
    expect(within(dialog).queryByLabelText("Milestone title")).toBeNull();
    expect(within(dialog).queryByLabelText("Exit test")).toBeNull();
    expect(within(dialog).queryByLabelText("Epic title")).toBeNull();

    await pick("Milestone", /Board and review/);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeEnabled());
    await pick("Epic", "New Epic…");
    expect(within(dialog).getByLabelText("Epic title")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Milestone title")).toBeNull();

    await pick("Milestone", "New Milestone…");
    expect(within(dialog).getByLabelText("Milestone title")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Exit test")).toBeInTheDocument();
    // A new Milestone has no Epic yet: its Story goes into a new one.
    expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Epic" })).toHaveTextContent("New Epic");
    expect(within(dialog).getByLabelText("Epic title")).toBeInTheDocument();
  });

  it("writes a new Milestone, then a new Epic in it, then the Story in that Epic, from one submit", async () => {
    const dialog = await openWriteStory();
    await pick("Milestone", "New Milestone…");
    fireEvent.change(within(dialog).getByLabelText("Milestone title"), { target: { value: "  Relay  " } });
    fireEvent.change(within(dialog).getByLabelText("Exit test"), { target: { value: "A phone reads the board" } });
    fireEvent.change(within(dialog).getByLabelText("Epic title"), { target: { value: "Phones" } });
    fireEvent.change(within(dialog).getByLabelText("Story title"), { target: { value: "Read-only board" } });
    fireEvent.change(within(dialog).getByLabelText("Criterion 1"), { target: { value: "It renders" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write Story" }));

    await waitFor(() =>
      expect(storyWriteByHand).toHaveBeenCalledWith("e9", "Read-only board", null, [
        { statement: "It renders", checkCommand: null },
      ]),
    );
    expect(milestoneCreate).toHaveBeenCalledWith("p1", "Relay", "A phone reads the board");
    expect(epicCreate).toHaveBeenCalledWith("m9", "Phones");
    // What was written is now picked, so the next Story goes into the same Epic without writing it twice.
    expect(within(dialog).getByRole("combobox", { name: "Milestone" })).toHaveTextContent("Relay");
    expect(within(dialog).getByRole("combobox", { name: "Epic" })).toHaveTextContent("Phones");
    expect(within(dialog).queryByLabelText("Milestone title")).toBeNull();
  });

  it("keeps the new Milestone it wrote when the Epic then fails, so trying again does not write it twice", async () => {
    epicCreate.mockRejectedValueOnce(new Error("database is locked"));
    const dialog = await openWriteStory();
    await pick("Milestone", "New Milestone…");
    fireEvent.change(within(dialog).getByLabelText("Milestone title"), { target: { value: "Relay" } });
    fireEvent.change(within(dialog).getByLabelText("Epic title"), { target: { value: "Phones" } });
    fireEvent.change(within(dialog).getByLabelText("Story title"), { target: { value: "Read-only board" } });
    fireEvent.change(within(dialog).getByLabelText("Criterion 1"), { target: { value: "It renders" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write Story" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("database is locked");

    fireEvent.click(within(dialog).getByRole("button", { name: "Write Story" }));
    await waitFor(() => expect(storyWriteByHand).toHaveBeenCalled());
    expect(milestoneCreate).toHaveBeenCalledTimes(1);
    expect(epicCreate).toHaveBeenLastCalledWith("m9", "Phones");
  });
});

describe("Write a Story: the footer", () => {
  it("puts Write Story in the dialog's footer, outside the scrolling body", async () => {
    const dialog = await openWriteStory();
    const write = within(dialog).getByRole("button", { name: "Write Story" });
    expect(write.closest("[data-slot=dialog-footer]")).not.toBeNull();
    expect(write.closest("[data-slot=write-story-body]")).toBeNull();
    expect(within(dialog).getByLabelText("Story title").closest("[data-slot=write-story-body]")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" }).closest("[data-slot=dialog-footer]")).not.toBeNull();
  });
});

describe("The top bar's add", () => {
  it("offers + Story only, filled once the project has a Milestone", async () => {
    wrap(<WriteStoryDialog projectId="p1" />);
    const story = await screen.findByRole("button", { name: "Write a Story" });
    expect(screen.queryByRole("button", { name: "Add an Epic" })).toBeNull();
    await waitFor(() => expect(story).toHaveAttribute("data-variant", "default"));
  });

  it("is outline on a project with no Milestone, where the Roadmap's + Milestone leads", async () => {
    milestoneList.mockResolvedValue([]);
    wrap(<WriteStoryDialog projectId="p1" />);
    const story = await screen.findByRole("button", { name: "Write a Story" });
    await waitFor(() => expect(story).toHaveAttribute("data-variant", "outline"));
  });
});

describe("Add an Epic", () => {
  it("opens on the preset Milestone, asks only the Epic's title, adds it and closes", async () => {
    const onClose = vi.fn();
    wrap(<StoryFormDialog projectId="p1" mode="epic" preset={{ milestoneId: "m2" }} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Add an Epic" });
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: "Milestone" })).toHaveTextContent("Board and review"),
    );
    expect(within(dialog).queryByRole("combobox", { name: "Epic" })).toBeNull();
    expect(within(dialog).queryByLabelText("Story title")).toBeNull();

    const add = within(dialog).getByRole("button", { name: "Add Epic" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Epic title"), { target: { value: "Since you last looked" } });
    fireEvent.click(add);
    await waitFor(() => expect(epicCreate).toHaveBeenCalledWith("m2", "Since you last looked"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith("Added FLY-9 Phones");
  });
});
