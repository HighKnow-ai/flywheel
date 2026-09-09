import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryClient } from "../queryClient";

describe("queryClient", () => {
  it("is constructed as a QueryClient instance", () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it("defaults refetchOnWindowFocus to false", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it("defaults staleTime to 0", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(0);
  });
});
