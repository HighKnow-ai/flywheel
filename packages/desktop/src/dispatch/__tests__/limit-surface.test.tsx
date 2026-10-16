/**
 * Phase 15 plan 15-03 (DRFT-12, D-34): a run held by the account limit is drawn through the EXISTING
 * needs-you class and the EXISTING `DispatchGateLine`. Nothing here adds a class, a token or a mark: the
 * limit reuses `blocked`'s class and glyph, and the words are the core's own and `WavePlanSheet`'s label.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DispatchGateLine } from "../DispatchGateLine";
import { WavePlanSheet } from "../WavePlanSheet";
import { STATE_VOCABULARY, rowVariant, stateClassOf } from "../../legend/StateBadge";
import sheetSource from "../WavePlanSheet.tsx?raw";
import badgeSource from "../../legend/StateBadge.tsx?raw";
import type { DispatchPlanDto, GateDto } from "../../adapters/tauri";

const planMock = vi.fn();
const gateMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeDispatchGateChanged: () => Promise.resolve(() => {}),
    dispatchPlanGet: (epicId: string) => planMock(epicId),
    dispatchGateState: () => gateMock(),
    dispatchGateResumeNow: () => Promise.resolve({ state: "open", message: "Dispatch is open.", resumeAt: null }),
  };
});

const LABEL = "Held by the account limit";
const REASON = "Usage limit reached (five_hour): the core wrote this sentence, not the renderer.";

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function heldPlan(): DispatchPlanDto {
  const base = { wave: 1, rationale: null, attention: null, entries: [] as string[] };
  return {
    id: "plan-1",
    epicId: "epic-1",
    status: "running",
    waveCursor: 1,
    edgesFrozen: true,
    edges: [],
    tasks: [
      { ...base, taskId: "t1", taskKey: "FLY-1", title: "Held task", state: "held_by_limit" },
      { ...base, taskId: "t2", taskKey: "FLY-2", title: "Running task", state: "running" },
    ],
  };
}

describe("a task held by the account limit", () => {
  it("is in the needs-you class, washed, with blocked's own glyph", () => {
    expect(stateClassOf("held_by_limit")).toBe("needs-you");
    expect(rowVariant("held_by_limit")).toBe("wash");
    expect(STATE_VOCABULARY.held_by_limit.markId).toBe(STATE_VOCABULARY.blocked.markId);
  });

  it("is drawn on the wave plan in the needs-you class with the word 'Held by the account limit'", async () => {
    planMock.mockReset().mockResolvedValue(heldPlan());
    render(
      <QueryClientProvider client={client()}>
        <WavePlanSheet epicId="epic-1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const held = await screen.findByRole("listitem", { name: "FLY-1 Held task" });
    const word = within(held).getByText(LABEL);
    expect(word.closest("[data-state-class]")?.getAttribute("data-state-class")).toBe("needs-you");
  });

  it("leaves an ordinary running task as plain text, not a class badge", async () => {
    planMock.mockReset().mockResolvedValue(heldPlan());
    render(
      <QueryClientProvider client={client()}>
        <WavePlanSheet epicId="epic-1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const running = await screen.findByRole("listitem", { name: "FLY-2 Running task" });
    expect(within(running).getByText("Running").closest("[data-state-class]")).toBeNull();
  });

  it("declares no literal colour in the files it changed", () => {
    for (const source of [sheetSource, badgeSource]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});

describe("DispatchGateLine on a rejected-tier pause", () => {
  function mount(gate: GateDto) {
    gateMock.mockReset().mockResolvedValue(gate);
    return render(
      <QueryClientProvider client={client()}>
        <DispatchGateLine planId="plan-1" />
      </QueryClientProvider>,
    );
  }

  it("renders the core's message verbatim, when dispatch resumes and a Resume now control", async () => {
    const at = 1_900_000_000;
    mount({ state: "paused", message: REASON, resumeAt: at });
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(screen.getByText(`Dispatch resumes ${new Date(at * 1000).toLocaleString()}.`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume now" })).toBeInTheDocument();
  });

  it("says the reset time is unknown and still offers Resume now, never a retry-soon phrasing", async () => {
    const { container } = mount({ state: "paused", message: REASON, resumeAt: null });
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(screen.getByText(/reset time is unknown/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume now" })).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/retry|retrying|soon|try again/i);
  });

  it("renders nothing at all for an open gate", async () => {
    const { container } = mount({ state: "open", message: "Dispatch is open.", resumeAt: null });
    await waitFor(() => expect(gateMock).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});
