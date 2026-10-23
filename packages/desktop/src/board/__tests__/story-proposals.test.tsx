/**
 * Issue #160: the Story view lists the Proposals its sessions filed, each with its kind, what it names,
 * the agent's why and evidence, and Accept / Reject while it is pending. Interim: the triage drawer
 * (#162) takes this over.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryProposals } from "../StoryProposals";
import type { ProposalDto } from "../../adapters/tauri";

const proposalListForStory = vi.fn();
const proposalAccept = vi.fn();
const proposalReject = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    proposalListForStory: (...args: unknown[]) => proposalListForStory(...args),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
  };
});

function proposal(id: string, verb: string, targetType: string, payload: unknown, state = "pending"): ProposalDto {
  return {
    id,
    projectId: "p1",
    sessionId: "run1",
    epicId: "e1",
    verb,
    targetType,
    targetId: null,
    payload,
    rationale: "The parser stops on an empty line",
    state,
    createdAt: "2026-10-23T10:00:00Z",
    rejectionReason: state === "rejected" ? "Not now" : null,
    stageId: null,
    roundId: null,
    evidence: "src/parser.rs:42 panics",
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StoryProposals projectId="p1" storyId="s1" />
    </QueryClientProvider>,
  );
}

describe("Proposals filed by this Story", () => {
  beforeEach(() => {
    proposalListForStory.mockReset();
    proposalAccept.mockReset().mockResolvedValue(undefined);
    proposalReject.mockReset().mockResolvedValue(undefined);
  });

  it("lists each Proposal by kind with its why and evidence, and decides a pending one", async () => {
    proposalListForStory.mockResolvedValue([
      proposal("p1", "create", "story", { title: "Empty-line recovery" }),
      proposal("p2", "create", "epic", { title: "Error recovery" }, "rejected"),
      proposal("p3", "retire", "story", {}, "withdrawn"),
    ]);
    renderList();
    const list = await screen.findByRole("list", { name: "Proposals filed by this Story" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("New Story");
    expect(rows[0]).toHaveTextContent("Empty-line recovery");
    expect(rows[0]).toHaveTextContent("The parser stops on an empty line");
    expect(rows[0]).toHaveTextContent("src/parser.rs:42 panics");
    expect(rows[1]).toHaveTextContent("New Epic");
    expect(rows[1]).toHaveTextContent("Rejected: Not now");
    expect(within(rows[1]).queryByRole("button", { name: /Accept/ })).toBeNull();

    fireEvent.click(within(rows[0]).getByRole("button", { name: "Accept New Story Empty-line recovery" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p1"));
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Reject New Story Empty-line recovery" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p1", null));
  });

  it("shows nothing while the Story has filed nothing", async () => {
    proposalListForStory.mockResolvedValue([]);
    const { container } = renderList();
    await waitFor(() => expect(proposalListForStory).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
