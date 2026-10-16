/**
 * Behavior under test (plan 15-05, DRFT-01, D-18..D-21): the planner's declared file-set shows as
 * chips marked "drafted by the planner" (derived by the core from the event actor, never worked out
 * here), the hand-typed textarea stays beside them and is never prefilled, and both editors write the
 * same value through the same `dispatchPlanEdit` call. Approval is the accept and stages nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WavePlanSheet } from "../WavePlanSheet";
import type { DispatchPlanDto, DispatchTaskDto, FileSetProvenanceDto } from "../../adapters/tauri";

const getMock = vi.fn();
const editMock = vi.fn();
const approveMock = vi.fn();
const provenanceMock = vi.fn();
const trackedMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    dispatchPlanGet: (epicId: string) => getMock(epicId),
    dispatchPlanEdit: (planId: string, edits: unknown) => editMock(planId, edits),
    dispatchPlanApprove: (planId: string) => approveMock(planId),
    taskFileSetProvenance: (taskId: string) => provenanceMock(taskId),
    repoTrackedPaths: (planId: string) => trackedMock(planId),
  };
});

const AGENT: FileSetProvenanceDto = {
  actorName: "Claude",
  draftedByAgent: true,
  declaredAt: "2026-10-16T00:00:00Z",
  before: [],
  entries: [],
  undeclared: false,
  history: [],
  historyTruncated: false,
};
const HUMAN: FileSetProvenanceDto = { ...AGENT, actorName: "Local User", draftedByAgent: false };
const UNDECLARED: FileSetProvenanceDto = { ...AGENT, undeclared: true };

function task(overrides: Partial<DispatchTaskDto> & Pick<DispatchTaskDto, "taskId" | "taskKey">): DispatchTaskDto {
  return { title: `Title of ${overrides.taskKey}`, wave: 1, state: "planned", rationale: null, attention: null, entries: [], ...overrides };
}

function plan(overrides: Partial<DispatchPlanDto> = {}, entries: string[] = ["src/a.rs", "docs/"]): DispatchPlanDto {
  return {
    id: "plan-1",
    epicId: "epic-1",
    status: "draft",
    waveCursor: 1,
    edgesFrozen: false,
    tasks: [task({ taskId: "t1", taskKey: "FLY-1", title: "Parse the header", entries })],
    edges: [],
    ...overrides,
  };
}

async function loaded(p: DispatchPlanDto, provenance: FileSetProvenanceDto | null = AGENT) {
  getMock.mockReset().mockResolvedValue(p);
  editMock.mockReset();
  approveMock.mockReset();
  provenanceMock.mockReset().mockResolvedValue(provenance);
  trackedMock.mockReset().mockResolvedValue({ paths: ["src/a.rs", "src/b.rs", "docs/readme.md"], notShown: 0 });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WavePlanSheet epicId="epic-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Wave 1" });
  return screen.getByRole("listitem", { name: "FLY-1 Parse the header" });
}

const chipsOf = (row: HTMLElement) =>
  within(within(row).getByRole("list", { name: "Declared files for FLY-1" })).getAllByRole("listitem");

describe("the file-set chips", () => {
  it("draws one chip per stored entry in stored order and marks the row once when the planner declared it", async () => {
    const row = await loaded(plan());
    await waitFor(() => expect(within(row).getByText("drafted by the planner")).toBeInTheDocument());
    expect(chipsOf(row).map((c) => c.querySelector("code")?.textContent)).toEqual(["src/a.rs", "docs/"]);
    expect(within(row).getAllByText("drafted by the planner")).toHaveLength(1);
  });

  it("does not mark chips a human declared", async () => {
    const row = await loaded(plan(), HUMAN);
    await waitFor(() => expect(provenanceMock).toHaveBeenCalledWith("t1"));
    expect(chipsOf(row)).toHaveLength(2);
    expect(within(row).queryByText("drafted by the planner")).toBeNull();
  });

  it("renders the textarea empty even when the task has stored entries, asserted on the DOM value", async () => {
    const row = await loaded(plan());
    const field = within(row).getByLabelText("Files for FLY-1") as HTMLTextAreaElement;
    expect(field.value).toBe("");
    expect(within(row).getByRole("button", { name: "Save files for FLY-1" })).toBeDisabled();
  });

  it("issues the same edit payload from the textarea as from adding the same two chips", async () => {
    const row = await loaded(plan({}, []), null);
    editMock.mockResolvedValue(plan({}, []));
    fireEvent.change(within(row).getByLabelText("Files for FLY-1"), { target: { value: "a/b.rs\nc/" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save files for FLY-1" }));
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    const fromTextarea = editMock.mock.calls[0];

    editMock.mockReset();
    editMock.mockResolvedValueOnce(plan({}, ["a/b.rs"])).mockResolvedValueOnce(plan({}, ["a/b.rs", "c/"]));
    const add = async (value: string) => {
      const input = screen.getByLabelText("Add a file to FLY-1");
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Add file to FLY-1" }));
    };
    await add("a/b.rs");
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Add a file to FLY-1")).not.toBeDisabled());
    await add("c/");
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(2));
    expect(editMock.mock.calls[1]).toEqual(fromTextarea);
    // Adding appended to the stored order rather than reordering it.
    expect(editMock.mock.calls[1][1]).toEqual([{ taskId: "t1", entries: ["a/b.rs", "c/"] }]);
  });

  it("removes a chip with one edit carrying the remaining entries, and shows a refusal verbatim leaving the chips as stored", async () => {
    const row = await loaded(plan());
    editMock.mockRejectedValue('file-set entry "x" refused: globs are not accepted');
    fireEvent.click(within(row).getByRole("button", { name: "Remove src/a.rs from FLY-1" }));
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    expect(editMock).toHaveBeenCalledWith("plan-1", [{ taskId: "t1", entries: ["docs/"] }]);
    expect(await screen.findByText(/globs are not accepted/)).toBeInTheDocument();
    expect(chipsOf(row)).toHaveLength(2);
  });

  it("says in words that the planner could not determine an undeclared set, with no chips and the textarea still there", async () => {
    const row = await loaded(plan({}, []), UNDECLARED);
    expect(await within(row).findByText(/could not determine/i)).toBeInTheDocument();
    expect(within(row).queryByRole("list", { name: "Declared files for FLY-1" })).toBeNull();
    expect(within(row).getByLabelText("Files for FLY-1")).toBeInTheDocument();
  });

  it("renders a plan that is not a draft as read-only chips that keep the planner mark", async () => {
    const row = await loaded(plan({ status: "running", edgesFrozen: true }));
    await waitFor(() => expect(within(row).getByText("drafted by the planner")).toBeInTheDocument());
    expect(chipsOf(row)).toHaveLength(2);
    expect(within(row).queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(within(row).queryByLabelText("Add a file to FLY-1")).toBeNull();
    expect(within(row).queryByLabelText("Files for FLY-1")).toBeNull();
  });

  it("offers the adapter's tracked paths and nothing invented while the call is unresolved", async () => {
    getMock.mockReset().mockResolvedValue(plan());
    provenanceMock.mockReset().mockResolvedValue(AGENT);
    trackedMock.mockReset().mockReturnValue(new Promise(() => {})); // never resolves
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WavePlanSheet epicId="epic-1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const row = await screen.findByRole("listitem", { name: "FLY-1 Parse the header" });
    const input = within(row).getByLabelText("Add a file to FLY-1");
    fireEvent.change(input, { target: { value: "src" } });
    expect(input).toBeInTheDocument();
    expect(row.querySelectorAll("datalist option")).toHaveLength(0);
  });

  it("fills the suggestion list from the tracked paths that match what was typed", async () => {
    const row = await loaded(plan({}, []), null);
    await waitFor(() => expect(trackedMock).toHaveBeenCalledWith("plan-1"));
    fireEvent.change(within(row).getByLabelText("Add a file to FLY-1"), { target: { value: "src/" } });
    await waitFor(() =>
      expect([...row.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual([
        "src/a.rs",
        "src/b.rs",
      ]),
    );
  });
});

describe("plan approval is the file-set's accept", () => {
  it("names both effects in one sentence beside the approve control and offers no per-task accept", async () => {
    await loaded(plan());
    const sentence = await screen.findByText(/freezes the colliding paths/i);
    expect(sentence).toHaveTextContent(/file-sets/i);
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve and start" })).toBeInTheDocument();
  });

  it("states nothing about accepting once the plan is no longer a draft", async () => {
    await loaded(plan({ status: "running", edgesFrozen: true }));
    expect(screen.queryByText(/freezes the colliding paths/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve and start" })).toBeNull();
  });
});
