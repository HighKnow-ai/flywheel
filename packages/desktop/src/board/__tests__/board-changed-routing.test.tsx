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
import { useBoardChangedInvalidation } from "../useBoardChangedInvalidation";
import { useUiStore } from "../../state/uiStore";

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
    await fire({ projectId: VIEWED, entity: "story", id: "s1" });
    expect(keys(spy)).toEqual(expect.arrayContaining([["board", VIEWED], ["epics", VIEWED]]));
  });

  it("an event for the viewed project touches no other project's keys and no bare prefix", async () => {
    const spy = mount();
    await fire({ projectId: VIEWED, entity: "story", id: "s1" });
    expect(keys(spy)).toEqual([["board", VIEWED], ["epics", VIEWED]]);
  });

  it("an event for a different project invalidates nothing at all", async () => {
    const spy = mount();
    await fire({ projectId: "project-b", entity: "story", id: "s1" });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("an event with a null projectId broadcasts to every project's board and epics", async () => {
    const spy = mount();
    await fire({ projectId: null, entity: "git_facts", id: null });
    expect(keys(spy)).toEqual(BROADCAST);
  });

  it("an event with no projectId key at all broadcasts rather than dropping", async () => {
    const spy = mount();
    await fire({ entity: "story", id: "s1" });
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
      { projectId: VIEWED, entity: "story", id: "s1" },
      { projectId: VIEWED, entity: "story", id: "s2" },
    );
    expect(spy).toHaveBeenCalledTimes(4);
    expect(keys(spy).filter((k) => JSON.stringify(k) === JSON.stringify(["board", VIEWED]))).toHaveLength(2);
  });

  it("an interleaved foreign event neither invalidates nor reorders the viewed project's events", async () => {
    const spy = mount();
    await fire(
      { projectId: VIEWED, entity: "story", id: "s1" },
      { projectId: "project-b", entity: "story", id: "s9" },
      { projectId: VIEWED, entity: "epic", id: "e1" },
    );
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

// The shared hook (plan 13-15): the routing decision every keyed reader now goes through.
describe("useBoardChangedInvalidation — shared routing", () => {
  const PROJ = "proj-1";

  function mountWith(render: () => void) {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(render, { wrapper });
    return spy;
  }

  const DEBOUNCED_KEY = ["debounced", PROJ];
  const mountDebounced = () =>
    mountWith(() => useBoardChangedInvalidation({ kind: "project", projectId: PROJ }, [DEBOUNCED_KEY], { debounceMs: 1000 }));

  /** Fire, then let the 1s debounce window elapse. */
  async function fireAndFlush(...payloads: unknown[]) {
    await waitFor(() => expect(handlers).toHaveLength(1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      for (const payload of payloads) handlers.forEach((h) => h(payload));
      vi.advanceTimersByTime(1500);
    } finally {
      vi.useRealTimers();
    }
  }

  beforeEach(() => {
    useUiStore.setState({ currentProjectId: null });
  });

  it("a foreign-project event wakes a debounced subscriber not at all", async () => {
    const spy = mountDebounced();
    await fireAndFlush({ projectId: "proj-2", entity: "story", id: "s1" });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("same-project events invalidate a debounced subscriber exactly once after the window", async () => {
    const spy = mountDebounced();
    await fireAndFlush(
      { projectId: PROJ, entity: "story", id: "s1" },
      { projectId: PROJ, entity: "story", id: "s2" },
    );
    expect(keys(spy)).toEqual([DEBOUNCED_KEY]);
  });

  it("a projectId: null broadcast invalidates a debounced subscriber", async () => {
    const spy = mountDebounced();
    await fireAndFlush({ projectId: null, entity: "git_facts", id: null });
    expect(keys(spy)).toEqual([DEBOUNCED_KEY]);
  });

  it("a malformed payload fails open", async () => {
    const spy = mountDebounced();
    await fireAndFlush({ projectId: 7 });
    expect(keys(spy)).toEqual([DEBOUNCED_KEY]);
  });

  it("a project id that is a strict prefix of the mounted one does not match", async () => {
    const spy = mountDebounced();
    await fireAndFlush({ projectId: "proj", entity: "story", id: "s1" });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("an empty keys array registers no listener", async () => {
    mountWith(() => useBoardChangedInvalidation({ kind: "account" }, []));
    await Promise.resolve();
    expect(handlers).toHaveLength(0);
  });

  it("a project scope with an undefined projectId registers no listener", async () => {
    mountWith(() => useBoardChangedInvalidation({ kind: "project", projectId: undefined }, [["x"]]));
    await Promise.resolve();
    expect(handlers).toHaveLength(0);
  });

  it("two events in one tick on a non-debounced subscriber invalidate twice, in arrival order", async () => {
    const spy = mountWith(() => useBoardChangedInvalidation({ kind: "project", projectId: PROJ }, [["k"]]));
    await fire({ projectId: PROJ }, { projectId: null });
    expect(keys(spy)).toEqual([["k"], ["k"]]);
  });

  it("a viewed scope follows the viewed project", async () => {
    useUiStore.setState({ currentProjectId: PROJ });
    const spy = mountWith(() => useBoardChangedInvalidation({ kind: "viewed" }, [["k"]]));
    await fire({ projectId: "proj-2" });
    expect(spy).toHaveBeenCalledTimes(0);
    await fire({ projectId: PROJ });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a viewed scope with no project selected falls open", async () => {
    const spy = mountWith(() => useBoardChangedInvalidation({ kind: "viewed" }, [["k"]]));
    await fire({ projectId: "proj-2" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("an account scope is never filtered", async () => {
    const spy = mountWith(() => useBoardChangedInvalidation({ kind: "account" }, [["cap"]]));
    await fire({ projectId: "anything" });
    expect(keys(spy)).toEqual([["cap"]]);
  });
});
