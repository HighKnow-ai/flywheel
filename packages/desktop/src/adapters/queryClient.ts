import { QueryClient } from "@tanstack/react-query";

/**
 * The configured TanStack Query client for the whole renderer.
 *
 * `refetchOnWindowFocus: false` and `staleTime: 0` are deliberate: the Rust core, not
 * window-focus heuristics, is the source of truth for freshness (D-04) — every mutation
 * emits `board:changed`, and `adapters/tauri.ts`'s `subscribeBoardChanged` invalidates the
 * affected queries. A `staleTime` of 0 means a query is never considered fresh from cache
 * alone; it is refetched whenever something invalidates it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  },
});
