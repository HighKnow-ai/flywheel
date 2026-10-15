/**
 * FNC-07 / F8: `board:changed` carries `{ projectId, entity, id }` and `useBoardChangedSubscription`
 * routes on it. The assertion that would have caught F8 is the spy count: an event for another
 * project must call `invalidateQueries` exactly zero times, not merely leave the data unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBoardChangedSubscription } from "../useBoardQuery";

type Handler = (payload?: unknown) => void;
let handlers: Handler[] = [];

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: (handler: Handler) => {
    handlers.push(handler);
    return Promise.resolve(() => {
      handlers = handlers.filter((h) => h !== handler);
    });
  },
}));

const VIEWED = "project-a";

function mount() {
  const queryClient = new QueryClient();
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useBoardChangedSubscription(VIEWED), { wrapper });
  return spy;
}

async function fire(...payloads: unknown[]) {
  await waitFor(() => expect(handlers).toHaveLength(1));
  for (const payload of payloads) handlers.forEach((h) => h(payload));
}

const keys = (spy: ReturnType<typeof mount>) => spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);

const BROADCAST = [["board"], ["epics"]];

beforeEach(() => {
  handlers = [];
});

describe("board:changed routing", () => {
  it("an event for the viewed project invalidates that project's board and epics keys", async () => {
    const spy = mount();
    await fire({ projectId: VIEWED, entity: "task", id: "t1" });
    expect(keys(spy)).toEqual(expect.arrayContaining([["board", VIEWED], ["epics", VIEWED]]));
  });

  it("an event for the viewed project touches no other project's keys and no bare prefix", async () => {
    const spy = mount();
    await fire({ projectId: VIEWED, entity: "task", id: "t1" });
    // The fan-out keys are keyed by epic, not by project, so they ride the viewed-project branch.
    expect(keys(spy)).toEqual([["board", VIEWED], ["epics", VIEWED], ["board", "dispatch"]]);
  });

  it("an event for a different project invalidates nothing at all", async () => {
    const spy = mount();
    await fire({ projectId: "project-b", entity: "task", id: "t1" });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("an event with a null projectId broadcasts to every project's board and epics", async () => {
    const spy = mount();
    await fire({ projectId: null, entity: "git_facts", id: null });
    expect(keys(spy)).toEqual(BROADCAST);
  });

  it("an event with no projectId key at all broadcasts rather than dropping", async () => {
    const spy = mount();
    await fire({ entity: "task", id: "t1" });
    expect(keys(spy)).toEqual(BROADCAST);
  });

  it("a malformed payload (non-string projectId, missing entity, no payload) broadcasts rather than throwing", async () => {
    const spy = mount();
    await fire({ projectId: 42 }, { projectId: {}, id: 3 }, undefined, "not an object");
    expect(keys(spy)).toEqual([...BROADCAST, ...BROADCAST, ...BROADCAST, ...BROADCAST]);
  });

  it("two events for the viewed project in the same tick each invalidate — nothing is coalesced", async () => {
    const spy = mount();
    await fire(
      { projectId: VIEWED, entity: "task", id: "t1" },
      { projectId: VIEWED, entity: "task", id: "t2" },
    );
    expect(spy).toHaveBeenCalledTimes(6);
    expect(keys(spy).filter((k) => JSON.stringify(k) === JSON.stringify(["board", VIEWED]))).toHaveLength(2);
  });

  it("an interleaved foreign event neither invalidates nor reorders the viewed project's events", async () => {
    const spy = mount();
    await fire(
      { projectId: VIEWED, entity: "task", id: "t1" },
      { projectId: "project-b", entity: "task", id: "t9" },
      { projectId: VIEWED, entity: "epic", id: "e1" },
    );
    expect(spy).toHaveBeenCalledTimes(6);
  });
});
