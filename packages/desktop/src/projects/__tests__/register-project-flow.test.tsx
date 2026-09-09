/**
 * Behavior under test (WR-01, 01-REVIEW.md): `useRegistrationErrorNotice` must clear its message
 * the moment `isError` goes back to `false` — not only after its own 4s auto-clear timeout fires.
 * Before this fix, a registration failure followed by an immediate successful retry (the same
 * `useRegisterProjectFlow()`/`useMutation` instance every entry point shares) left the stale
 * "Couldn't register this project — …" notice on screen indefinitely, because the effect's early
 * `if (!isError) return;` guard skipped `setMessage(null)` entirely.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegistrationErrorNotice } from "../RegisterProjectFlow";

describe("useRegistrationErrorNotice", () => {
  it("shows the error message while isError is true", () => {
    const { result } = renderHook(() => useRegistrationErrorNotice(true, new Error("disk full")));
    expect(result.current).toBe("Couldn't register this project — disk full");
  });

  it("stays null when isError has never been true", () => {
    const { result } = renderHook(() => useRegistrationErrorNotice(false, null));
    expect(result.current).toBeNull();
  });

  it("clears the message immediately when a retry succeeds (isError flips back to false)", () => {
    const { result, rerender } = renderHook(
      ({ isError, error }: { isError: boolean; error: unknown }) =>
        useRegistrationErrorNotice(isError, error),
      { initialProps: { isError: true, error: new Error("network unreachable") as unknown } },
    );
    expect(result.current).toBe("Couldn't register this project — network unreachable");

    // The retry succeeds — `useMutation` resets `isError` to `false` as soon as the new
    // `mutate`/`mutateAsync` call starts, well before the 4s auto-clear timeout from the first
    // failure would fire.
    rerender({ isError: false, error: null });

    expect(result.current).toBeNull();
  });
});
