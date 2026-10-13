/**
 * Behavior under test (plan 09-09 Task 1): the one human look at a draft before anything spawns. The
 * sheet DISPLAYS the Rust response: the sequenced pairs and their colliding paths, the refusals and
 * the excluded tasks' reasons are all fixture data here, and the sheet recomputes none of them.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WavePlanSheet } from "../WavePlanSheet";
import type { DispatchPlanDto, DispatchTaskDto } from "../../adapters/tauri";

const getMock = vi.fn();
const editMock = vi.fn();
const approveMock = vi.fn();
const whyMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    dispatchPlanGet: (epicId: string) => getMock(epicId),
    dispatchPlanEdit: (planId: string, edits: unknown) => editMock(planId, edits),
    dispatchPlanApprove: (planId: string) => approveMock(planId),
    dispatchWhy: (planId: string, a: string, b: string) => whyMock(planId, a, b),
  };
});

function task(overrides: Partial<DispatchTaskDto> & Pick<DispatchTaskDto, "taskId" | "taskKey">): DispatchTaskDto {
  return {
    title: `Title of ${overrides.taskKey}`,
    wave: 1,
    state: "planned",
    rationale: null,
    attention: null,
    entries: [],
    ...overrides,
  };
}

function plan(overrides: Partial<DispatchPlanDto> = {}): DispatchPlanDto {
  return {
    id: "plan-1",
    epicId: "epic-1",
    status: "draft",
    waveCursor: 1,
    edgesFrozen: false,
    tasks: [
      task({ taskId: "t1", taskKey: "FLY-1", title: "Parse the header", wave: 1, entries: ["src/a.rs"] }),
      task({ taskId: "t2", taskKey: "FLY-2", title: "Render the header", wave: 1, entries: ["src/a.rs", "src/b.rs"] }),
      task({ taskId: "t3", taskKey: "FLY-3", title: "Write the docs", wave: 2, entries: ["docs/"] }),
      task({
        taskId: "t4",
        taskKey: "FLY-4",
        title: "Migrate the store",
        wave: 2,
        state: "skipped",
        rationale: "Needs a design decision first",
      }),
    ],
    edges: [
      {
        beforeTaskId: "t1",
        afterTaskId: "t2",
        cause: "overlap",
        collidingPaths: [{ before: "src/a.rs", after: "src/a.rs" }],
      },
    ],
    ...overrides,
  };
}

function renderSheet(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <WavePlanSheet epicId="epic-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

async function loaded(p: DispatchPlanDto = plan(), onClose = vi.fn()) {
  getMock.mockReset().mockResolvedValue(p);
  editMock.mockReset();
  approveMock.mockReset();
  whyMock.mockReset();
  const utils = renderSheet(onClose);
  await screen.findByRole("dialog", { name: "Wave plan" });
  await screen.findByRole("region", { name: "Wave 1" });
  return utils;
}

describe("WavePlanSheet", () => {
  it("renders two waves with their tasks and each task's declared entries", async () => {
    await loaded();
    const wave1 = screen.getByRole("region", { name: "Wave 1" });
    const wave2 = screen.getByRole("region", { name: "Wave 2" });
    expect(within(wave1).getByRole("listitem", { name: "FLY-1 Parse the header" })).toBeInTheDocument();
    expect(within(wave1).getByRole("listitem", { name: "FLY-2 Render the header" })).toBeInTheDocument();
    expect(within(wave2).getByRole("listitem", { name: "FLY-3 Write the docs" })).toBeInTheDocument();
    expect(screen.getByLabelText("Files for FLY-2")).toHaveValue("src/a.rs\nsrc/b.rs");
    expect(screen.getByLabelText("Files for FLY-3")).toHaveValue("docs/");
  });

  it("shows a sequenced pair with both task titles and the colliding path from the response", async () => {
    await loaded();
    const pair = screen.getByRole("listitem", { name: /FLY-2 waits for FLY-1/ });
    expect(within(pair).getByText(/Render the header/)).toBeInTheDocument();
    expect(within(pair).getByText(/Parse the header/)).toBeInTheDocument();
    expect(within(pair).getByText("src/a.rs")).toBeInTheDocument();
  });

  it("shows an excluded task with its reason instead of omitting it", async () => {
    await loaded();
    const wave2 = screen.getByRole("region", { name: "Wave 2" });
    expect(within(wave2).getByText("Migrate the store")).toBeInTheDocument();
    expect(within(wave2).getByText("Needs a design decision first")).toBeInTheDocument();
  });

  it("issues exactly one edit call carrying the new entries when a task's files are saved", async () => {
    await loaded();
    editMock.mockResolvedValue(plan());
    const field = screen.getByLabelText("Files for FLY-2");
    fireEvent.change(field, { target: { value: "src/a.rs\nsrc/c.rs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save files for FLY-2" }));
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    expect(editMock).toHaveBeenCalledWith("plan-1", [{ taskId: "t2", entries: ["src/a.rs", "src/c.rs"] }]);
  });

  it("shows the refusal the command returned and leaves the displayed set as stored", async () => {
    await loaded();
    editMock.mockRejectedValue("entry \"src/*.rs\" is refused: globs are not accepted");
    const field = screen.getByLabelText("Files for FLY-2");
    fireEvent.change(field, { target: { value: "src/*.rs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save files for FLY-2" }));
    expect(await screen.findByText(/globs are not accepted/)).toBeInTheDocument();
    expect(screen.getByLabelText("Files for FLY-2")).toHaveValue("src/a.rs\nsrc/b.rs");
  });

  it("issues exactly one edit call carrying the new wave number when a task is moved", async () => {
    await loaded();
    editMock.mockResolvedValue(plan({ edges: [] }));
    fireEvent.change(screen.getByLabelText("Wave for FLY-2"), { target: { value: "2" } });
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    expect(editMock).toHaveBeenCalledWith("plan-1", [{ taskId: "t2", wave: 2 }]);
  });

  it("shows the sequenced pairs the refreshed response reports after an edit, not its own", async () => {
    await loaded();
    // The response drops the pair although FLY-1 and FLY-2 still declare the same path in this fixture.
    editMock.mockResolvedValue(plan({ edges: [] }));
    fireEvent.change(screen.getByLabelText("Wave for FLY-2"), { target: { value: "2" } });
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /FLY-2 waits for FLY-1/ })).toBeNull());
  });

  it("displays the response's pairs, not a comparison of the entries", async () => {
    // FLY-5 shares src/b.rs with FLY-2 and the response has NO edge for them; the one edge it does
    // carry names paths that neither task declares.
    const p = plan({
      edges: [
        {
          beforeTaskId: "t1",
          afterTaskId: "t2",
          cause: "overlap",
          collidingPaths: [{ before: "src/", after: "src/lib/x.rs" }],
        },
      ],
    });
    p.tasks.push(task({ taskId: "t5", taskKey: "FLY-5", title: "Index the header", wave: 1, entries: ["src/b.rs"] }));
    await loaded(p);
    expect(screen.queryByRole("listitem", { name: /FLY-5 waits/ })).toBeNull();
    const pair = screen.getByRole("listitem", { name: /FLY-2 waits for FLY-1/ });
    expect(within(pair).getByText("src/lib/x.rs")).toBeInTheDocument();
    expect(within(pair).queryByText("src/a.rs")).toBeNull();
  });

  it("issues exactly one approve call and disables the action while it is in flight", async () => {
    let resolve: (p: DispatchPlanDto) => void = () => {};
    const { onClose } = await loaded();
    approveMock.mockReturnValue(new Promise<DispatchPlanDto>((r) => (resolve = r)));
    const button = screen.getByRole("button", { name: "Approve and start" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).toHaveBeenCalledWith("plan-1");
    await act(async () => resolve(plan({ status: "running" })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("spawns nothing and approves nothing on its own", async () => {
    await loaded();
    expect(approveMock).not.toHaveBeenCalled();
    expect(editMock).not.toHaveBeenCalled();
  });

  it("renders a plan that is not a draft read-only: no edit field, no wave control, no approve", async () => {
    await loaded(plan({ status: "running", edgesFrozen: true }));
    expect(screen.queryByLabelText("Files for FLY-2")).toBeNull();
    expect(screen.queryByLabelText("Wave for FLY-2")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save files/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve and start" })).toBeNull();
    expect(screen.getByText("src/b.rs")).toBeInTheDocument();
  });

  it("names the task that needs the user and why, on a running plan", async () => {
    const p = plan({ status: "running", edgesFrozen: true });
    p.tasks[1] = { ...p.tasks[1], state: "needs_attention", attention: "2 files are uncommitted in the worktree" };
    await loaded(p);
    const row = screen.getByRole("listitem", { name: /FLY-2 .*Render the header/ });
    expect(within(row).getByText("Needs you")).toBeInTheDocument();
    expect(within(row).getByText("2 files are uncommitted in the worktree")).toBeInTheDocument();
  });

  it("answers why from the frozen edge when asked, showing the sentence the core wrote", async () => {
    await loaded(plan({ status: "running", edgesFrozen: true }));
    whyMock.mockResolvedValue({
      kind: "sequenced",
      sentence: "FLY-2 waits for FLY-1: both declare src/a.rs",
      beforeTaskId: "t1",
      afterTaskId: "t2",
      cause: "overlap",
      collidingPaths: [{ before: "src/a.rs", after: "src/a.rs" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Why does FLY-2 wait?" }));
    expect(await screen.findByText("FLY-2 waits for FLY-1: both declare src/a.rs")).toBeInTheDocument();
    expect(whyMock).toHaveBeenCalledWith("plan-1", "t2", "t1");
  });

  it("offers no why action on a draft, whose edges are a preview and not a record", async () => {
    await loaded();
    expect(screen.queryByRole("button", { name: /Why does/ })).toBeNull();
  });

  describe("a task that declared no files (D-150, D-149)", () => {
    const signal = /no files declared/i;
    const titles: Record<string, string> = { "1": "Parse the header", "2": "Render the header", "4": "Migrate the store" };
    const row = (n: string) => screen.getByRole("listitem", { name: `FLY-${n} ${titles[n]}` });

    it("shows the signal on a draft task alongside its editable box", async () => {
      const p = plan();
      p.tasks[1] = { ...p.tasks[1], entries: [] };
      await loaded(p);
      const fly2 = row("2");
      expect(within(fly2).getByText(signal)).toBeInTheDocument();
      expect(within(fly2).getByLabelText("Files for FLY-2")).toBeInTheDocument();
    });

    it("shows the signal on a read-only (running) task", async () => {
      const p = plan({ status: "running", edgesFrozen: true });
      p.tasks[1] = { ...p.tasks[1], entries: [] };
      await loaded(p);
      expect(within(row("2")).getByText(signal)).toBeInTheDocument();
    });

    it("shows no signal on a task that declared files", async () => {
      await loaded();
      expect(within(row("1")).queryByText(signal)).toBeNull();
      expect(within(row("2")).queryByText(signal)).toBeNull();
    });

    it("shows no signal on a skipped task, which is not going to run", async () => {
      await loaded();
      expect(within(row("4")).queryByText(signal)).toBeNull();
    });

    it("reports the declared sets it was given even when the response's edge list says the pair collides", async () => {
      const p = plan();
      p.tasks[0] = { ...p.tasks[0], entries: [] };
      p.tasks[1] = { ...p.tasks[1], entries: [] };
      await loaded(p);
      expect(within(row("1")).getByText(signal)).toBeInTheDocument();
      expect(within(row("2")).getByText(signal)).toBeInTheDocument();
    });
  });
});
