/**
 * Behavior under test (plan 09-09 Task 3): the line that says why dispatch is waiting. Open renders
 * nothing; paused and warning render the reason the core wrote plus the one action that applies. The
 * renderer composes no reason of its own, so the fixtures use reasons no renderer could have guessed.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DispatchGateLine } from "../DispatchGateLine";
import type { DispatchPlanDto, GateDto } from "../../adapters/tauri";

const gateMock = vi.fn();
const resumeNowMock = vi.fn();
const advanceMock = vi.fn();
let gateChangedHandlers: Array<() => void> = [];

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    dispatchGateState: () => gateMock(),
    dispatchGateResumeNow: () => resumeNowMock(),
    dispatchAdvanceNow: (planId: string) => advanceMock(planId),
    subscribeDispatchGateChanged: (handler: () => void) => {
      gateChangedHandlers.push(handler);
      return Promise.resolve(() => {
        gateChangedHandlers = gateChangedHandlers.filter((h) => h !== handler);
      });
    },
  };
});

const PAUSED_REASON = "The five-hour allowance for this account is used up.";
const WARNING_REASON = "Eighty percent of this week's allowance is gone.";

function mount(gate: GateDto) {
  gateMock.mockReset().mockResolvedValue(gate);
  resumeNowMock.mockReset();
  advanceMock.mockReset();
  gateChangedHandlers = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <DispatchGateLine planId="plan-1" />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

const paused = (resumeAt: number | null): GateDto => ({ state: "paused", message: PAUSED_REASON, resumeAt });
const warning: GateDto = { state: "warning", message: WARNING_REASON, resumeAt: null };
const open: GateDto = { state: "open", message: "Dispatch is open.", resumeAt: null };

describe("DispatchGateLine", () => {
  it("renders nothing at all while the gate is open", async () => {
    const { container } = mount(open);
    await waitFor(() => expect(gateMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("status", { name: "Dispatch gate" })).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a paused gate's reason verbatim with a resume-now action", async () => {
    mount(paused(null));
    expect(await screen.findByText(PAUSED_REASON)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Advance now" })).toBeNull();
  });

  it("says when dispatch will resume when the core knows", async () => {
    const at = 1_900_000_000;
    mount(paused(at));
    await screen.findByText(PAUSED_REASON);
    expect(screen.getByText(new RegExp(new Date(at * 1000).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.queryByText(/reset time is unknown/)).toBeNull();
  });

  it("says the reset time is unknown and that only a manual resume clears it when the core has no instant", async () => {
    mount(paused(null));
    await screen.findByText(PAUSED_REASON);
    expect(screen.getByText(/reset time is unknown/i)).toBeInTheDocument();
    expect(screen.getByText(/only a manual resume/i)).toBeInTheDocument();
  });

  it("renders a warning's reason, an advance-now action and that the running wave finishes", async () => {
    mount(warning);
    expect(await screen.findByText(WARNING_REASON)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advance now" })).toBeInTheDocument();
    expect(screen.getByText(/running wave will finish/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume now" })).toBeNull();
  });

  it("issues exactly one resume-now call, disabled while it is in flight, and clears the line from the response", async () => {
    mount(paused(null));
    let resolve: (g: GateDto) => void = () => {};
    resumeNowMock.mockReturnValue(new Promise<GateDto>((r) => (resolve = r)));
    const button = await screen.findByRole("button", { name: "Resume now" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(resumeNowMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(open));
    await waitFor(() => expect(screen.queryByText(PAUSED_REASON)).toBeNull());
  });

  it("issues exactly one advance-now call for this plan, disabled while it is in flight", async () => {
    mount(warning);
    let resolve: (p: DispatchPlanDto) => void = () => {};
    advanceMock.mockReturnValue(new Promise<DispatchPlanDto>((r) => (resolve = r)));
    const button = await screen.findByRole("button", { name: "Advance now" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledWith("plan-1");
    await act(async () => resolve({} as DispatchPlanDto));
  });

  it("shows the core's refusal when advance-now is refused", async () => {
    mount(warning);
    advanceMock.mockRejectedValue("wave 1 is not entirely merged or skipped");
    fireEvent.click(await screen.findByRole("button", { name: "Advance now" }));
    expect(await screen.findByText(/not entirely merged or skipped/)).toBeInTheDocument();
  });

  it("re-reads the gate when the core announces a change", async () => {
    mount(open);
    await waitFor(() => expect(gateChangedHandlers.length).toBe(1));
    gateMock.mockResolvedValue(paused(null));
    await act(async () => gateChangedHandlers.forEach((h) => h()));
    expect(await screen.findByText(PAUSED_REASON)).toBeInTheDocument();
  });
});
