/**
 * A-08(a) / plan 08.1-21 Task 2: the renderer's only way to decline a task is a wrapper that
 * passes `{ taskId }` and nothing else. The reason the agent reads is derived in the Rust core
 * from the board, so a renderer-supplied string would be a second author of agent-visible text
 * (T-08.1-58). Asserted at the `invoke` seam: if a field is ever added to the payload, this fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { reviewChangesRequestState, reviewRequestChanges } from "../tauri";

describe("the decline path's adapter wrappers", () => {
  beforeEach(() => invokeMock.mockReset());

  it("reads the decline state with the command name and a task id alone", async () => {
    invokeMock.mockResolvedValue({ state: "ready", uncheckedCount: 3 });
    const state = await reviewChangesRequestState("task-1");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("review_changes_request_state", { taskId: "task-1" });
    expect(state).toEqual({ state: "ready", uncheckedCount: 3 });
  });

  it("requests changes with the command name and a task id alone, no reason text", async () => {
    invokeMock.mockResolvedValue(3);
    await expect(reviewRequestChanges("task-1")).resolves.toBe(3);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe("review_request_changes");
    expect(args).toEqual({ taskId: "task-1" });
    expect(Object.keys(args)).toEqual(["taskId"]);
  });

  it("takes exactly one argument, so a caller cannot pass a reason", () => {
    expect(reviewRequestChanges.length).toBe(1);
  });
});
