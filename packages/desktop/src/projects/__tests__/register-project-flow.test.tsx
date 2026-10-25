/**
 * Behavior under test (issues #210, #200): every register entry point without a surface of its own (⌘⇧O, the
 * File menu, the rail's Register project…) says a failure the same way, as one error toast, raised once per
 * failure and never while nothing has failed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const notifyError = vi.fn();
vi.mock("@/lib/notify", () => ({
  notify: { error: (...args: unknown[]) => notifyError(...args), success: vi.fn(), dismiss: vi.fn() },
}));

import { useRegistrationErrorToast } from "../RegisterProjectFlow";

describe("useRegistrationErrorToast", () => {
  beforeEach(() => notifyError.mockReset());

  it("raises one error toast for a failure", () => {
    renderHook(() => useRegistrationErrorToast(true, new Error("disk full")));
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError.mock.calls[0][0]).toMatch(/register this project/);
  });

  it("raises nothing while nothing has failed", () => {
    renderHook(() => useRegistrationErrorToast(false, null));
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("raises nothing more when a retry succeeds", () => {
    const { rerender } = renderHook(
      ({ isError, error }: { isError: boolean; error: unknown }) => useRegistrationErrorToast(isError, error),
      { initialProps: { isError: true, error: new Error("network unreachable") as unknown } },
    );
    rerender({ isError: false, error: null });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});
