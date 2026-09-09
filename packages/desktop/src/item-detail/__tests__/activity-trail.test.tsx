/**
 * Behavior under test (01-10-PLAN.md Task 3, component bullet): a single-event trail renders
 * exactly one entry (no empty-state placeholder, no "Load more"); a 60-event trail renders the
 * first bounded 50-event page with a "Load more" affordance beyond it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityTrail, type ActivityEventDto } from "../ActivityTrail";

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
