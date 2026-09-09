/**
 * Local UI state — the free-text search term, the in-progress filter selection, and the
 * currently selected item id. Held in Zustand, kept entirely separate from TanStack Query's
 * server-state cache (`board/useBoardQuery.ts`) — letting the two blur is what makes an eventual
 * web port painful, and the adapter seam only pays off if the split stays clean
 * (01-08-PLAN.md, `.claude/CLAUDE.md`'s stack guidance).
 *
 * Band-collapse state is NOT duplicated here — it already has its own home in
 * `board/collapseStore.ts` (01-04), which this module does not touch or re-export.
 *
 * The filter/search state here is a *draft*: nothing in this file ever calls the Tauri command
 * surface. `useBoardQuery.ts`'s `toFilterInput` translates a `BoardFilterDraft` into the shape
 * `board_list`/`board_search` accept, and the debounce that turns a raw keystroke into a query
 * lives there too (at the query boundary, not here — 01-UI-SPEC.md "Performance Contract").
 */
import { create } from "zustand";

/**
 * The in-progress filter selection (BOARD-06): every field is an empty array when that dimension
 * is unfiltered — the same "empty means unfiltered" convention `core::query::filter::BoardFilter`
 * uses on the Rust side, so `toFilterInput` in `useBoardQuery.ts` is a direct, lossless
 * translation rather than a second filter model with its own edge cases.
 *
 * `epicIds`/`assigneeIds` carry `null` as an explicit member meaning "No epic"/"Unassigned" —
 * never a bare absence a caller has to infer.
 */
export interface BoardFilterDraft {
  statuses: string[];
  epicIds: (string | null)[];
  assigneeIds: (string | null)[];
  priorities: number[];
  estimates: number[];
}

export const EMPTY_FILTER_DRAFT: BoardFilterDraft = {
  statuses: [],
  epicIds: [],
  assigneeIds: [],
  priorities: [],
  estimates: [],
};

/** True when at least one filter dimension carries a value — the renderer's own signal for which
 * of the two empty-window states to show (01-UI-SPEC.md "State Inventory": "distinct copy...
 * clarifies filters are active"). Search alone (no filter chip) also counts as "filters active"
 * from the caller's perspective — see `Board`'s own combination of this with the search term. */
export function isFilterDraftActive(filter: BoardFilterDraft): boolean {
  return (
    filter.statuses.length > 0 ||
    filter.epicIds.length > 0 ||
    filter.assigneeIds.length > 0 ||
    filter.priorities.length > 0 ||
    filter.estimates.length > 0
  );
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface UiState {
  searchTerm: string;
  filterDraft: BoardFilterDraft;
  selectedItemId: string | null;
  setSearchTerm: (term: string) => void;
  toggleStatus: (status: string) => void;
  toggleEpic: (epicId: string | null) => void;
  toggleAssignee: (assigneeId: string | null) => void;
  togglePriority: (priority: number) => void;
  toggleEstimate: (estimate: number) => void;
  clearFilters: () => void;
  setSelectedItemId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchTerm: "",
  filterDraft: EMPTY_FILTER_DRAFT,
  selectedItemId: null,

  setSearchTerm: (term) => set({ searchTerm: term }),

  toggleStatus: (status) =>
    set((state) => ({
      filterDraft: { ...state.filterDraft, statuses: toggleValue(state.filterDraft.statuses, status) },
    })),

  toggleEpic: (epicId) =>
    set((state) => ({
      filterDraft: { ...state.filterDraft, epicIds: toggleValue(state.filterDraft.epicIds, epicId) },
    })),

  toggleAssignee: (assigneeId) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        assigneeIds: toggleValue(state.filterDraft.assigneeIds, assigneeId),
      },
    })),

  togglePriority: (priority) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        priorities: toggleValue(state.filterDraft.priorities, priority),
      },
    })),

  toggleEstimate: (estimate) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        estimates: toggleValue(state.filterDraft.estimates, estimate),
      },
    })),

  // Clears the search term too — "Clear Filters" (Copywriting Contract) is the one recovery
  // action offered from the empty-filter-result state, and a lingering search term with no
  // filter chips would still leave the board looking "stuck" after the user asks to clear it.
  clearFilters: () => set({ filterDraft: EMPTY_FILTER_DRAFT, searchTerm: "" }),

  setSelectedItemId: (id) => set({ selectedItemId: id }),
}));
