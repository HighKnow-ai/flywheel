import { QueryClient } from "@tanstack/react-query";

/**
 * The query defaults for the whole renderer.
 *
 * `refetchOnWindowFocus: false` and `staleTime: 0` are deliberate: the Rust core, not
 * window-focus heuristics, is the source of truth for freshness (D-04) — every mutation
 * emits `board:changed`, and `adapters/tauri.ts`'s `subscribeBoardChanged` invalidates the
 * affected queries. A `staleTime` of 0 means a query is never considered fresh from cache
 * alone; it is refetched whenever something invalidates it.
 *
 * `retry: 1`: every read is local IPC to the Rust core, not a flaky network. One retry after the
 * default one-second delay rides out a core that is mid-restart; more than that only delays the
 * truth. TanStack's default (three retries, 1 s + 2 s + 4 s) left a dead read spinning for seven
 * seconds before `ReadError` (components/ReadError.tsx) could say so; now it reports in about one.
 */
export const QUERY_DEFAULTS = {
  refetchOnWindowFocus: false,
  staleTime: 0,
  retry: 1,
} as const;

/** A client on the renderer's defaults: the app's one instance below, or a fresh one for a test. */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS } } });
}

/** The configured TanStack Query client for the whole renderer. */
export const queryClient = createQueryClient();
