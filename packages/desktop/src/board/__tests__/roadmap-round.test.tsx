/**
 * Behaviour under test (issue #211): a Roadmap ghost row is decided through the same Accept, Amend and Reject
 * Button Group as every other Proposal, at the same size and in the same order; the pressed decision shows
 * `loading` and the outcome is said in a toast; a rejected change wears the Rejected pill.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GhostRow } from "../RoadmapRound";
import { expectDecisionGroup } from "../../shaping/__tests__/decision-group";
import type { RoadmapProposalDto } from "../../adapters/tauri";

const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();
const notifySuccess = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
  };
});
vi.mock("@/lib/notify", () => ({ notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), dismiss: vi.fn() } }));

function change(id: string, verb: string, targetType: string, summary: string, extra: Partial<RoadmapProposalDto> = {}): RoadmapProposalDto {
  return {
    id,
    verb,
    targetType,
    targetId: null,
    payload: verb === "create" ? { title: "Mobile", exit_test: null } : {},
    rationale: "The Roadmap ends before mobile",
    state: "pending",
    rejectionReason: null,
    summary,
    ...extra,
  } as RoadmapProposalDto;
}

function renderRows(rows: RoadmapProposalDto[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ul>
        {rows.map((p) => (
          <GhostRow key={p.id} projectId="p1" proposal={p} />
        ))}
      </ul>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  proposalAccept.mockReset().mockResolvedValue(undefined);
  proposalAmend.mockReset().mockResolvedValue(undefined);
  proposalReject.mockReset().mockResolvedValue(undefined);
  notifySuccess.mockReset();
});

describe("a Roadmap ghost row (issue #211)", () => {
  it("is decided through the one Button Group: Accept, Amend and Reject when the change carries text", () => {
    renderRows([change("p-new", "create", "milestone", 'New Milestone "Mobile"')]);
    expectDecisionGroup(screen.getByRole("group", { name: 'Proposed: New Milestone "Mobile"' }), 'New Milestone "Mobile"', { separator: ": " });
  });

  it("leaves Amend out of the group for a change with no text to edit", () => {
    renderRows([change("p-retire", "retire", "milestone", 'Retire Milestone "Board"')]);
    expectDecisionGroup(screen.getByRole("group", { name: 'Proposed: Retire Milestone "Board"' }), 'Retire Milestone "Board"', {
      amend: false,
      separator: ": ",
    });
  });

  it("shows Accept as loading until it lands, then says what it did", async () => {
    let resolveAccept: () => void = () => {};
    proposalAccept.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveAccept = resolve)));
    renderRows([change("p-new", "create", "milestone", 'New Milestone "Mobile"')]);
    const row = screen.getByRole("group", { name: 'Proposed: New Milestone "Mobile"' });
    const accept = within(row).getByRole("button", { name: 'Accept: New Milestone "Mobile"' });
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toHaveAttribute("aria-busy", "true"));
    expect(within(row).getByRole("button", { name: 'Reject: New Milestone "Mobile"' })).toBeDisabled();
    resolveAccept();
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Accepted New Milestone "Mobile"'));
  });

  it("a rejected change wears the Rejected pill, its summary struck through and the reason under it", () => {
    renderRows([change("p-teams", "create", "milestone", 'New Milestone "Teams"', { state: "rejected", rejectionReason: "Not this year" })]);
    const line = screen.getByRole("group", { name: 'Rejected: New Milestone "Teams"' });
    expect(within(line).getByText("Rejected").closest("[data-slot=badge]")).toBeTruthy();
    expect(within(line).getByText('New Milestone "Teams"').tagName).toBe("DEL");
    expect(within(line).getByText("Your reason: Not this year")).toBeInTheDocument();
  });
});
