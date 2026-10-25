/**
 * Behaviour under test (issue #125): a shaping agent's spec change is drawn as a ghost field on the Epic
 * card, under the field it would rewrite, and decided there: Accept (as proposed), Amend (the developer's
 * edit, accepted in one act) or Reject (with an optional reason). A rejected one stays on the field shrunk
 * to one struck-through line with its reason. Nothing goes through an inbox: the decision is made on the
 * field itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpicShapingView } from "../EpicShapingView";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, EpicShapingDto, ProposalDto } from "../../adapters/tauri";
import { expectDecisionGroup } from "./decision-group";

const notifySuccess = vi.fn();
vi.mock("@/lib/notify", () => ({ notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), dismiss: vi.fn() } }));

const epicShapingRounds = vi.fn();
const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();
const proposalListPending = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    epicShapingRounds: (...args: unknown[]) => epicShapingRounds(...args),
    epicShapingSession: () => Promise.resolve("run-s"),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
    proposalListPending: (...args: unknown[]) => proposalListPending(...args),
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
  scope: "The board as the shaping surface.",
  outOfScope: null,
  exitTest: null,
  state: "shaping",
  rank: "a",
};

function proposal(id: string, field: string, text: string, extra: Partial<ProposalDto> = {}): ProposalDto {
  return {
    id,
    projectId: "p1",
    sessionId: "run-s",
    epicId: "e1",
    verb: "amend",
    targetType: "epic",
    targetId: "e1",
    payload: { field, text },
    rationale: "Round 1 narrowed it to the board",
    state: "pending",
    createdAt: "2026-10-22T10:00:00Z",
    rejectionReason: null,
    stageId: "s1",
    roundId: null,
    ...extra,
  };
}

function shaping(proposals: ProposalDto[]): EpicShapingDto {
  return { epic: EPIC, stages: [{ id: "s1", kind: "challenge_spec", state: "open", rank: 1 }], rounds: [], proposals };
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EpicShapingView projectId="p1" projectName="Threadfin" epicId="e1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

async function ghost(label: string) {
  return (await screen.findByRole("group", { name: `Proposed ${label}` })) as HTMLElement;
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1", currentEpicId: "e1" });
  epicShapingRounds.mockReset().mockResolvedValue(
    shaping([
      proposal("p-scope", "scope", "The board, and nothing else."),
      proposal("p-out", "out_of_scope", "Milestone shaping.", {
        state: "rejected",
        rejectionReason: "Already in the Epic's Problem",
      }),
    ]),
  );
  proposalAccept.mockReset().mockResolvedValue(undefined);
  proposalAmend.mockReset().mockResolvedValue(undefined);
  proposalReject.mockReset().mockResolvedValue(undefined);
  proposalListPending.mockReset().mockResolvedValue([]);
  notifySuccess.mockReset();
});

describe("ghost fields for spec-change Proposals (issue #125)", () => {
  it("draws a pending Proposal under the field it would rewrite, with its text, why, and three decisions", async () => {
    renderView();
    const card = await ghost("Scope");
    expect(card.dataset.state).toBe("pending");
    expect(within(card).getByText("The board, and nothing else.")).toBeTruthy();
    expect(within(card).getByText(/round 1 narrowed it to the board/i)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Accept the proposed Scope" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Amend the proposed Scope" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Reject the proposed Scope" })).toBeTruthy();
    // The field's own text stays in place above it: the ghost is where the change would land.
    expect(screen.getByText("The board as the shaping surface.")).toBeTruthy();
    // Not an inbox: nothing reads the project's pending list.
    expect(proposalListPending).not.toHaveBeenCalled();
  });

  it("Accept applies the Proposal as proposed", async () => {
    renderView();
    fireEvent.click(within(await ghost("Scope")).getByRole("button", { name: "Accept the proposed Scope" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p-scope"));
  });

  it("Amend starts from the proposed text and accepts the developer's edit in one act", async () => {
    renderView();
    const card = await ghost("Scope");
    fireEvent.click(within(card).getByRole("button", { name: "Amend the proposed Scope" }));
    const field = within(card).getByRole("textbox", { name: "Your Scope" }) as HTMLTextAreaElement;
    expect(field.value).toBe("The board, and nothing else.");
    fireEvent.change(field, { target: { value: "The board and the dock, nothing else." } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept edit to the proposed Scope" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("p-scope", { field: "scope", text: "The board and the dock, nothing else." }),
    );
    expect(proposalAccept).not.toHaveBeenCalled();
  });

  it("Reject takes an optional reason", async () => {
    renderView();
    const card = await ghost("Scope");
    fireEvent.click(within(card).getByRole("button", { name: "Reject the proposed Scope" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Why not? (optional)" }), {
      target: { value: "Too narrow" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p-scope", "Too narrow"));
  });

  it("Amend keeps the agent's why in sight, and Cancel returns the focus to Amend", async () => {
    renderView();
    const card = await ghost("Scope");
    const amend = within(card).getByRole("button", { name: "Amend the proposed Scope" });
    fireEvent.click(amend);
    expect(within(card).getByText(/round 1 narrowed it to the board/i)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Amend the proposed Scope" })));
  });

  it("Reject with no reason sends none", async () => {
    renderView();
    const card = await ghost("Scope");
    fireEvent.click(within(card).getByRole("button", { name: "Reject the proposed Scope" }));
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p-scope", null));
  });

  it("a rejected Proposal shrinks to one struck-through line with its reason and no decisions", async () => {
    renderView();
    const line = (await screen.findByRole("group", { name: "Rejected Out of scope" })) as HTMLElement;
    expect(line.dataset.state).toBe("rejected");
    const text = within(line).getByText("Milestone shaping.");
    expect(text.tagName).toBe("DEL");
    expect(within(line).getByText(/Already in the Epic's Problem/)).toBeTruthy();
    expect(within(line).queryAllByRole("button")).toHaveLength(0);
  });

  it("a failed decision says why and keeps the ghost", async () => {
    proposalAccept.mockRejectedValueOnce("Proposal was already accepted");
    renderView();
    const card = await ghost("Scope");
    fireEvent.click(within(card).getByRole("button", { name: "Accept the proposed Scope" }));
    expect((await within(card).findByRole("alert")).textContent).toMatch(/already accepted/);
  });

  it("is decided through the one Accept, Amend and Reject group (issue #211)", async () => {
    renderView();
    expectDecisionGroup(await ghost("Scope"), "the proposed Scope");
    // The rejected line wears the Rejected pill, the pending ghost the Proposed one.
    expect(within(await ghost("Scope")).getByText("Proposed Scope").closest("[data-slot=badge]")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Rejected Out of scope" })).getByText("Rejected").closest("[data-slot=badge]")).toBeTruthy();
  });

  it("Accept shows loading on its own button until it lands, then says what it did in a toast (issue #211)", async () => {
    let land: () => void = () => {};
    proposalAccept.mockImplementationOnce(() => new Promise<void>((resolve) => (land = resolve)));
    renderView();
    const card = await ghost("Scope");
    const accept = within(card).getByRole("button", { name: "Accept the proposed Scope" });
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toHaveAttribute("aria-busy", "true"));
    expect(accept).toHaveTextContent("Accept");
    expect(within(card).getByRole("button", { name: "Reject the proposed Scope" })).toBeDisabled();
    land();
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Accepted the proposed Scope"));
  });
});
