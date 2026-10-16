/**
 * Behavior under test (phase 15 plan 07, D-02, D-04, DRFT-03, DRFT-07): an agent's suggested title,
 * body and priority appear INSIDE the one item form, marked as suggestions, editable as ordinary
 * text and rejectable one field at a time. The ghost is visual until the human acts: nothing is
 * written on render, hover or focus. The explicit tier (criteria) is never ghosted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPanel, type DetailItem } from "../ItemDetailPanel";
import panelSource from "../ItemDetailPanel.tsx?raw";

type Ghost = {
  proposalId: string;
  field: "title" | "description" | "priority";
  proposed: string;
  current: string | null;
  runId: string;
  actorName: string;
};

let ghosts: Ghost[] = [];
const rejectMock = vi.fn();
const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  agentRunsForTask: () => Promise.resolve([]),
  pendingPermissionRequests: () => Promise.resolve([]),
  answerPermissionRequest: () => Promise.resolve(),
  acknowledgeAgentRun: () => Promise.resolve(),
  sessionSummariesForTask: () => Promise.resolve([]),
  worktreeSummary: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
  itemProvisionalValues: () => Promise.resolve(ghosts),
  rejectAuthoringProposal: (proposalId: string, reason?: string) => rejectMock(proposalId, reason),
  invokeCommand: (command: string, args?: Record<string, unknown>) => {
    invokeCommandMock(command, args);
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "criterion_revisions") return Promise.resolve([]);
    if (command === "events_activity_trail" || command === "actor_list") return Promise.resolve([]);
    if (command === "review_criteria_state") return Promise.resolve([]);
    return Promise.resolve(undefined);
  },
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

const TASK: DetailItem = { id: "task-1", kind: "task", key: "FLY-1", title: "Old title", status: "todo", projectId: "p", priority: 2 };

const TITLE: Ghost = {
  proposalId: "prop-title", field: "title", proposed: "Sharper title", current: "Old title", runId: "run-1", actorName: "Claude Code",
};
const PRIORITY: Ghost = {
  proposalId: "prop-prio", field: "priority", proposed: "4", current: "2", runId: "run-1", actorName: "Claude Code",
};
const DESCRIPTION: Ghost = {
  proposalId: "prop-desc", field: "description", proposed: "Explains the why.", current: null, runId: "run-1", actorName: "Claude Code",
};

function renderPanel(onUpdateTitle: (t: string) => void = () => {}, item: DetailItem = TASK) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ItemDetailPanel item={item} onClose={() => {}} onUpdateTitle={onUpdateTitle} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const writes = () =>
  invokeCommandMock.mock.calls.filter(([c]) => !/^(criterion_list|criterion_revisions|events_activity_trail|actor_list|review_criteria_state)$/.test(c));

beforeEach(() => {
  ghosts = [];
  rejectMock.mockReset().mockResolvedValue(undefined);
  invokeCommandMock.mockReset();
});

describe("a provisional title", () => {
  it("renders the proposed title, the current title and the proposing agent, and writes nothing", async () => {
    ghosts = [TITLE];
    const onUpdateTitle = vi.fn();
    renderPanel(onUpdateTitle);

    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe("Sharper title"));
    expect(screen.getByText(/Old title/, { selector: ".detail-ghost-note *, .detail-ghost-note" })).toBeInTheDocument();
    expect(screen.getByText(/Claude Code/)).toBeInTheDocument();
    expect(onUpdateTitle).not.toHaveBeenCalled();
    expect(rejectMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("starts the draft at the proposed text on focus and commits it once through onUpdateTitle", async () => {
    ghosts = [TITLE];
    const onUpdateTitle = vi.fn();
    renderPanel(onUpdateTitle);
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe("Sharper title"));

    fireEvent.focus(title);
    expect(title.value).toBe("Sharper title");
    expect(onUpdateTitle).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Sharper title, edited" } });
    fireEvent.blur(title);
    expect(onUpdateTitle).toHaveBeenCalledTimes(1);
    expect(onUpdateTitle).toHaveBeenCalledWith("Sharper title, edited");
  });

  it("focusing and leaving without touching the text writes nothing", async () => {
    ghosts = [TITLE];
    const onUpdateTitle = vi.fn();
    renderPanel(onUpdateTitle);
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe("Sharper title"));

    fireEvent.focus(title);
    fireEvent.blur(title);
    expect(onUpdateTitle).not.toHaveBeenCalled();
  });

  it("Enter on the adopted suggestion is the human's explicit commit", async () => {
    ghosts = [TITLE];
    const onUpdateTitle = vi.fn();
    renderPanel(onUpdateTitle);
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe("Sharper title"));

    fireEvent.focus(title);
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onUpdateTitle).toHaveBeenCalledTimes(1);
    expect(onUpdateTitle).toHaveBeenCalledWith("Sharper title");
  });

  it("rejects once with that proposal's id, even under two synchronous activations, and the ghost goes on invalidation", async () => {
    ghosts = [TITLE];
    const { client } = renderPanel();
    const reject = await screen.findByRole("button", { name: "Reject suggested title" });

    fireEvent.click(reject);
    fireEvent.click(reject);
    expect(rejectMock).toHaveBeenCalledTimes(1);
    expect(rejectMock.mock.calls[0][0]).toBe("prop-title");

    ghosts = [];
    await client.invalidateQueries({ queryKey: ["item-provisional-values", "task-1"] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reject suggested title" })).toBeNull());
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Old title");
  });
});

describe("a provisional priority and description", () => {
  it("renders a priority ghost beside the current priority mark, from the registry", async () => {
    ghosts = [PRIORITY];
    renderPanel();
    const row = (await screen.findByText("Priority")).closest("dt")!.nextElementSibling as HTMLElement;
    await waitFor(() => expect(row.querySelector(".detail-ghost-priority")).not.toBeNull());
    expect(row.textContent).toContain("Medium");
    expect(row.querySelector(".detail-ghost-priority")!.textContent).toContain("Urgent");
    expect(screen.getByRole("button", { name: "Reject suggested priority" })).toBeInTheDocument();
  });

  it("renders a description ghost with its own reject", async () => {
    ghosts = [DESCRIPTION];
    renderPanel();
    expect(await screen.findByText("Explains the why.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject suggested description" }));
    expect(rejectMock).toHaveBeenCalledWith("prop-desc", undefined);
  });
});

describe("the tiers stay unblurred", () => {
  it("an item carrying only a pending criterion draft renders no ghost in any field", async () => {
    ghosts = []; // the read is tier-filtered: a criterion draft never reaches the panel
    renderPanel();
    await screen.findByLabelText("Title");
    expect(document.querySelector("[class*='detail-ghost']")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reject suggested/ })).toBeNull();
  });

  it("an item with no provisional values renders exactly as today", async () => {
    renderPanel();
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title.value).toBe("Old title");
    expect(title.className).not.toContain("ghost");
    expect(document.querySelector("[class*='detail-ghost']")).toBeNull();
  });

  it("has no control that rejects more than one ghost", () => {
    const names = [...panelSource.matchAll(/Reject suggested [^"`}<]*/g)].map((m) => m[0]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).not.toMatch(/\ball\b|\bselected\b/i);
    expect(panelSource).not.toMatch(/aria-label=["'`][^"'`]*\b(all|selected)\b/i);
  });

  it("reuses the existing reject and adds no timer", () => {
    expect(panelSource).toContain("useRejectProvisionalValue");
    expect(panelSource).not.toMatch(/setTimeout|setInterval|expires_at|undo_until/);
    expect(panelSource).not.toMatch(/<svg|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });
});
