/**
 * Behaviour under test (issue #167, spec §7 "Since you last looked"): opening the board asks the core once
 * for what changed since the last visit; the timeline renders folded to "n events since you last looked"
 * and unfolds to the events, oldest first, each naming its record. Events that land while the board is open
 * are seen live, so the timeline never asks again on a board change. With nothing new it says so and has
 * nothing to unfold; past the cap it says how many it shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SinceYouLastLooked } from "../SinceYouLastLooked";
import type { LookedEventDto, SinceLastLookedDto } from "../../adapters/tauri";

const boardVisit = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return { ...actual, boardVisit: (...args: unknown[]) => boardVisit(...args) };
});

let seq = 0;
function event(eventType: string, description: string, subjectKey: string | null, subjectTitle: string | null): LookedEventDto {
  seq += 1;
  return {
    id: `ev-${seq}`,
    projectId: "p1",
    origin: "local",
    sequence: seq,
    actorId: "a1",
    eventType,
    description,
    occurredAt: new Date(Date.now() - (10 - seq) * 60_000).toISOString(),
    subjectKey,
    subjectTitle,
  };
}

function seen(events: LookedEventDto[], total = events.length): SinceLastLookedDto {
  return { total, events };
}

function renderTimeline(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <SinceYouLastLooked projectId="p1" />
    </QueryClientProvider>,
  );
  return client;
}

describe("SinceYouLastLooked", () => {
  beforeEach(() => {
    boardVisit.mockReset();
    seq = 0;
  });

  it("renders folded with its count, then unfolds to the events in order, each naming its record", async () => {
    boardVisit.mockResolvedValue(
      seen([
        event("story.handed_off", "Handed off for review: 3 Checks passed, 0 failed, 0 timed out", "FLY-12", "Make clicking predictable"),
        event("story.state_changed", "Moved Story from in_review to merged", "FLY-12", "Make clicking predictable"),
        event("round.opened", "Opened roadmap Round 2: Epic FLY-3 done", null, null),
      ]),
    );
    renderTimeline();

    const toggle = await screen.findByRole("button", { name: /3 events since you last looked/ });
    expect(boardVisit).toHaveBeenCalledWith("p1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Since you last looked" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: "Since you last looked" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("FLY-12");
    expect(rows[0].textContent).toContain("Make clicking predictable");
    expect(rows[0].textContent).toContain("Handed off for review");
    expect(rows[1].textContent).toContain("Moved Story from in_review to merged");
    expect(rows[2].textContent).toContain("Opened roadmap Round 2");

    fireEvent.click(toggle);
    expect(screen.queryByRole("list", { name: "Since you last looked" })).toBeNull();
  });

  it("says one event in the singular", async () => {
    boardVisit.mockResolvedValue(seen([event("proposal.filed", "Proposed to create a story", "FLY-3", "Roster")]));
    renderTimeline();
    expect(await screen.findByRole("button", { name: /^1 event since you last looked/ })).toBeTruthy();
  });

  it("visits once: a board change while it is open neither asks again nor adds to the list", async () => {
    boardVisit.mockResolvedValue(seen([event("proposal.filed", "Proposed to create a story", "FLY-3", "Roster")]));
    const client = renderTimeline();
    await screen.findByRole("button", { name: /1 event since you last looked/ });

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["board", "p1"] });
      await client.invalidateQueries({ queryKey: ["board"] });
      window.dispatchEvent(new Event("focus"));
    });

    expect(boardVisit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /1 event since you last looked/ })).toBeTruthy();
  });

  it("with nothing new, says so and offers nothing to unfold", async () => {
    boardVisit.mockResolvedValue(seen([]));
    renderTimeline();
    expect(await screen.findByText("Nothing changed since you last looked")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("past the cap, counts them all and says how many it shows", async () => {
    boardVisit.mockResolvedValue(seen([event("story.state_changed", "Moved Story from ready to running", "FLY-4", "Feed")], 250));
    renderTimeline();
    fireEvent.click(await screen.findByRole("button", { name: /250 events since you last looked/ }));
    expect(screen.getByText("The newest 1 of 250")).toBeTruthy();
  });
});
