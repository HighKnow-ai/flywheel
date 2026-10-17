/**
 * Behavior under test (10-07-PLAN.md Task 2, FLEET-05, D-174): the renderer reports a watched run
 * only when the session is the visible surface, and nothing while the fleet (or anything above the
 * session in App.tsx's precedence chain) is showing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWatchedRun } from "../useWatchedRun";
import { useUiStore } from "../../state/uiStore";

const fleetWatchRunMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  fleetWatchRun: (id: string | null) => fleetWatchRunMock(id),
}));

beforeEach(() => {
  fleetWatchRunMock.mockReset();
  fleetWatchRunMock.mockResolvedValue(undefined);
  act(() => {
    useUiStore.setState({
      activeAgentRunId: null,
      settingsOpen: false,
      fleetSurface: null,
    });
  });
});

const last = () => fleetWatchRunMock.mock.calls[fleetWatchRunMock.mock.calls.length - 1]?.[0];

describe("useWatchedRun", () => {
  it("reports nothing with no session open", () => {
    renderHook(() => useWatchedRun());
    expect(last()).toBeNull();
  });

  it("reports the session run when it is the visible surface", () => {
    renderHook(() => useWatchedRun());
    act(() => useUiStore.setState({ activeAgentRunId: "run-1" }));
    expect(last()).toBe("run-1");
  });

  it("reports nothing while the fleet is showing, so a banner still fires with the fleet open", () => {
    renderHook(() => useWatchedRun());
    act(() => useUiStore.setState({ fleetSurface: { view: "fleet" } }));
    expect(last()).toBeNull();
  });

  it("clears the report when a higher-precedence surface comes on top, and restores it after", () => {
    renderHook(() => useWatchedRun());
    act(() => useUiStore.setState({ activeAgentRunId: "run-1" }));
    for (const patch of [{ settingsOpen: true }]) {
      act(() => useUiStore.setState(patch as never));
      expect(last()).toBeNull();
      act(() => useUiStore.setState({ settingsOpen: false }));
      expect(last()).toBe("run-1");
    }
  });

  it("a rejected report is swallowed", () => {
    fleetWatchRunMock.mockRejectedValue(new Error("nope"));
    expect(() => renderHook(() => useWatchedRun())).not.toThrow();
  });
});
