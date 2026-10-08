/**
 * Behavior under test (01-10-PLAN.md Task 3, component bullet): a single-event trail renders
 * exactly one entry (no empty-state placeholder, no "Load more"); a 60-event trail renders the
 * first bounded 50-event page with a "Load more" affordance beyond it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityTrail, collapseRepeats, type ActivityEventDto } from "../ActivityTrail";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function makeEvent(i: number): ActivityEventDto {
  return {
    id: `event-${i.toString().padStart(4, "0")}`,
    projectId: "proj-1",
    origin: "local",
    sequence: i + 1,
    actorId: "actor-1",
    eventType: "task.updated",
    description: `Edit number ${i}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };
}

function renderTrail() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityTrail parentType="task" parentId="task-1" />
    </QueryClientProvider>,
  );
}

describe("ActivityTrail", () => {
  it("renders exactly one entry for a single-event trail", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "events_activity_trail") return Promise.resolve([makeEvent(0)]);
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("Edit number 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("renders the first 50-event page with a Load more affordance for a 60-event trail", async () => {
    const allEvents = Array.from({ length: 60 }, (_, i) => makeEvent(i));
    invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "events_activity_trail") {
        const offset = (args?.offset as number | undefined) ?? 0;
        const limit = (args?.limit as number | undefined) ?? 50;
        return Promise.resolve(allEvents.slice(offset, offset + limit));
      }
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(50));
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });
});

describe("Git lock-exhaustion entry (D-53, plan 03-13)", () => {
  const EXHAUSTION_SENTENCE = "Git lock contention: git commit in /repo/path failed after 5 attempts.";

  function makeExhaustionEvent(i: number): ActivityEventDto {
    return {
      id: `exhaustion-${i}`,
      projectId: "proj-1",
      origin: "local",
      sequence: i + 1,
      actorId: "system-actor",
      eventType: "git.lock_exhausted",
      description: EXHAUSTION_SENTENCE,
      occurredAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("renders the Copywriting Contract sentence with the repository, command and attempt count interpolated", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "events_activity_trail") return Promise.resolve([makeExhaustionEvent(0)]);
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText(EXHAUSTION_SENTENCE)).toBeInTheDocument();
  });

  it("renders two exhaustion entries as two ordinary separate trail entries", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "events_activity_trail") return Promise.resolve([makeExhaustionEvent(0), makeExhaustionEvent(1)]);
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getAllByText(EXHAUSTION_SENTENCE)).toHaveLength(2);
  });
});

describe("a repeated run of the same event reads as one entry (08.1-15 closure, finding 2)", () => {
  const same = (i: number): ActivityEventDto => ({ ...makeEvent(i), id: `same-${i}`, description: "criterion created", eventType: "criterion.created" });

  function mockTrail(events: ActivityEventDto[]) {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "events_activity_trail") return Promise.resolve(events);
      if (command === "actor_list") return Promise.resolve([{ id: "actor-1", actorType: "human", displayName: "Local User" }]);
      return Promise.resolve(undefined);
    });
  }

  it("folds consecutive identical events into one row with a count", async () => {
    mockTrail([same(0), same(1), same(2), makeEvent(9)]);
    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    // Newest first: the run of three is older than `Edit number 9`, so it is the second row.
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Edit number 9");
    expect(rows[1].textContent).toContain("criterion created");
    expect(rows[1].textContent).toContain("×3");
    expect(rows[0].textContent).not.toContain("×");
  });

  it("does not fold events that are separated by a different one", async () => {
    mockTrail([same(0), makeEvent(1), same(2)]);
    renderTrail();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
  });

  it("does not print the actor-kind enum, and draws no per-row glyph", async () => {
    mockTrail([makeEvent(0)]);
    renderTrail();

    const row = (await screen.findAllByRole("listitem"))[0];
    expect(row.textContent).toContain("Local User");
    expect(row.textContent).not.toMatch(/Human|Agent|System/);
    expect(row.querySelector("svg"), "no person glyph beside every row").toBeNull();
  });

  it("collapseRepeats keeps the NEWEST event's time and never folds a lock exhaustion", () => {
    const a = { ...same(0), occurredAt: "2026-01-02T00:00:00.000Z" };
    const b = { ...same(1), occurredAt: "2026-01-01T00:00:00.000Z" };
    const folded = collapseRepeats([a, b]);
    expect(folded).toHaveLength(1);
    expect(folded[0].event.occurredAt).toBe(a.occurredAt);
    const lock = (i: number): ActivityEventDto => ({ ...makeEvent(i), id: `l${i}`, eventType: "git.lock_exhausted", description: "x" });
    expect(collapseRepeats([lock(0), lock(1)])).toHaveLength(2);
  });
});
