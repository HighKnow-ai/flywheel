import { afterEach, describe, expect, it, vi } from "vitest";
import { testTimeScale } from "../time-scale";

describe("testTimeScale", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is 1 when FLYWHEEL_TEST_TIME_SCALE is unset, so a developer's budgets stay as written", () => {
    vi.stubEnv("FLYWHEEL_TEST_TIME_SCALE", undefined);
    expect(testTimeScale()).toBe(1);
  });

  it("is the factor a slow runner sets", () => {
    vi.stubEnv("FLYWHEEL_TEST_TIME_SCALE", "3");
    expect(testTimeScale()).toBe(3);
  });

  it("is 1 for a value that is not a positive number", () => {
    for (const raw of ["", "zero", "0", "-2", "NaN"]) {
      vi.stubEnv("FLYWHEEL_TEST_TIME_SCALE", raw);
      expect(testTimeScale(), raw).toBe(1);
    }
  });
});
