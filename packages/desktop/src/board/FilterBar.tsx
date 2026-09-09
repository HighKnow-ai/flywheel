/**
 * The always-visible top-bar search field and filter chips (01-UI-SPEC.md "Search & filter" —
 * search lives in the bar, not behind the command palette, since it is a primary daily action;
 * `⌘F` and `/` both focus it). Chips cover every dimension BOARD-06 names: status, epic
 * (including "No epic"), assignee (including "Unassigned"), priority and estimate.
 *
 * This component owns no server data and runs no query of its own — it only reads/writes
 * `state/uiStore.ts`'s filter draft and search term. `board/useBoardQuery.ts`'s `useBoardQuery`
 * is the single place that draft is debounced and translated into a `board_list`/`board_search`
 * call (D-03: no second filtering implementation, not even a client-side preview of one).
 *
 * The epic chip list is derived from whichever epics are present in the *currently loaded*
 * window (`items` below) rather than a dedicated "list every epic" query — a known simplification
 * documented in this plan's SUMMARY ("Known Stubs"): composing the epic filter with another
 * active filter that hides every row of a given epic will drop that epic from the chip list too.
 */
import { useMemo, useRef, type CSSProperties } from "react";
import { Search, X } from "lucide-react";
import {
  ESTIMATE_MARKS,
  MARKS_BY_ID,
  PRIORITY_MARKS,
  STATUS_MARKS,
  estimateLetter,
  priorityValueFromMarkId,
  statusValueFromMarkId,
} from "../legend/marks";
import { useGlobalBindings } from "../state/keyboard";
import { isFilterDraftActive, useUiStore } from "../state/uiStore";
import { useActors, type BoardItem } from "./useBoardQuery";

export interface FilterBarProps {
  /** The currently loaded window's items (used only to derive the epic chip list — see the
   * module doc comment above for the limitation this implies). */
  items: BoardItem[];
  /** A refetch is in flight while the previously-loaded window stays rendered underneath
   * (`useBoardQuery`'s `placeholderData: keepPreviousData`) — shown as a small non-blocking
   * indicator inside the search field itself, never a re-skeleton of the list
   * (01-UI-SPEC.md "State Inventory"). */
  isFetching?: boolean;
}

function chipStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "var(--space-xs) var(--space-sm)",
    borderRadius: "var(--radius-chrome)",
    border: `1px solid ${active ? "var(--accent-text-rack)" : "var(--divider)"}`,
    background: active ? "var(--surface-dominant)" : "var(--surface-secondary)",
    color: active ? "var(--accent-text-rack)" : "var(--text-primary-rack)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

export function FilterBar({ items, isFetching = false }: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // `⌘F`/`/` (01-UI-SPEC.md "Search & filter") — routed through `state/keyboard.ts`'s
  // `useGlobalBindings`, not a hand-rolled `event.key === '/'` listener (01-09-PLAN.md Task 1:
  // "no board component attaches its own bare-letter key handler"). The ambiguity guard that used
  // to live here — ignore the shortcut while another text field already has focus, so `/` still
  // types a literal slash into, say, the quick-add title input — is now `resolveBinding`'s own
  // `isTypingTarget` check, applied uniformly to every global binding, not just this one.
  useGlobalBindings({ "focus-search": () => inputRef.current?.focus() });

  const searchTerm = useUiStore((state) => state.searchTerm);
  const setSearchTerm = useUiStore((state) => state.setSearchTerm);
  const filterDraft = useUiStore((state) => state.filterDraft);
  const toggleStatus = useUiStore((state) => state.toggleStatus);
  const toggleEpic = useUiStore((state) => state.toggleEpic);
  const toggleAssignee = useUiStore((state) => state.toggleAssignee);
  const togglePriority = useUiStore((state) => state.togglePriority);
  const toggleEstimate = useUiStore((state) => state.toggleEstimate);
  const clearFilters = useUiStore((state) => state.clearFilters);

  const actorsQuery = useActors();
  const actors = actorsQuery.data ?? [];

  const epicOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (item.kind === "epic") {
        seen.set(item.id, `${item.key} ${item.title}`);
      }
    }
    return Array.from(seen.entries());
  }, [items]);

  const anyActive = isFilterDraftActive(filterDraft) || searchTerm.trim().length > 0;

  return (
    <div
      className="filter-bar"
      role="search"
      aria-label="Search and filter the board"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <Search
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "var(--space-sm)",
            color: "var(--text-muted-rack)",
            pointerEvents: "none",
          }}
        />
        <input
          ref={inputRef}
          className="type-body"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search titles, bodies or a key like FLY-142…"
          aria-label="Search items"
          aria-busy={isFetching}
          style={{
            width: 320,
            padding: `var(--space-xs) ${isFetching ? "calc(var(--space-lg) + 4px)" : "var(--space-sm)"} var(--space-xs) calc(var(--space-lg) + 4px)`,
            borderRadius: "var(--radius-chrome)",
            border: "1px solid var(--divider)",
            background: "var(--surface-dominant)",
            color: "var(--text-primary-rack)",
          }}
        />
        {isFetching && (
          <span
            aria-hidden="true"
            className="search-fetching-indicator"
            title="Refreshing results…"
            style={{
              position: "absolute",
              right: "var(--space-sm)",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-text-rack)",
            }}
          />
        )}
      </div>

      {/* `id`s below are `CommandPalette.tsx`'s "Filter by Status/Epic/Assignee/Priority" commands'
          focus target (01-09-PLAN.md Task 2) — the palette moves focus to the first chip in the
          matching group rather than duplicating this group's own toggle logic. */}
      <div id="filter-status" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        {STATUS_MARKS.map((mark) => {
          const value = statusValueFromMarkId(mark.id);
          const selected = filterDraft.statuses.includes(value);
          return (
            <button
              key={mark.id}
              type="button"
              className="type-label"
              aria-pressed={selected}
              onClick={() => toggleStatus(value)}
              style={chipStyle(selected)}
            >
              {mark.label}
            </button>
          );
        })}
      </div>

      <div id="filter-priority" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        {PRIORITY_MARKS.map((mark) => {
          const value = priorityValueFromMarkId(mark.id);
          const selected = filterDraft.priorities.includes(value);
          return (
            <button
              key={mark.id}
              type="button"
              className="type-label"
              aria-pressed={selected}
              onClick={() => togglePriority(value)}
              style={chipStyle(selected)}
            >
              {mark.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        {ESTIMATE_MARKS.map((mark, index) => {
          const value = index + 1;
          const selected = filterDraft.estimates.includes(value);
          return (
            <button
              key={mark.id}
              type="button"
              className="type-label"
              aria-pressed={selected}
              onClick={() => toggleEstimate(value)}
              style={chipStyle(selected)}
            >
              {estimateLetter(value)}
            </button>
          );
        })}
      </div>

      <div id="filter-epic" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        <button
          key="no-epic"
          type="button"
          className="type-label"
          aria-pressed={filterDraft.epicIds.includes(null)}
          onClick={() => toggleEpic(null)}
          style={chipStyle(filterDraft.epicIds.includes(null))}
        >
          {MARKS_BY_ID["epic-pill-none"]?.label ?? "No epic"}
        </button>
        {epicOptions.map(([epicId, label]) => {
          const selected = filterDraft.epicIds.includes(epicId);
          return (
            <button
              key={epicId}
              type="button"
              className="type-label"
              aria-pressed={selected}
              onClick={() => toggleEpic(epicId)}
              style={chipStyle(selected)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div id="filter-assignee" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        <button
          key="unassigned"
          type="button"
          className="type-label"
          aria-pressed={filterDraft.assigneeIds.includes(null)}
          onClick={() => toggleAssignee(null)}
          style={chipStyle(filterDraft.assigneeIds.includes(null))}
        >
          {MARKS_BY_ID["assignee-unassigned"]?.label ?? "Unassigned"}
        </button>
        {actors.map((actor) => {
          const selected = filterDraft.assigneeIds.includes(actor.id);
          return (
            <button
              key={actor.id}
              type="button"
              className="type-label"
              aria-pressed={selected}
              onClick={() => toggleAssignee(actor.id)}
              style={chipStyle(selected)}
            >
              {actor.displayName}
            </button>
          );
        })}
      </div>

      {anyActive && (
        <button
          type="button"
          className="type-label"
          onClick={clearFilters}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-xs)",
            padding: "var(--space-xs) var(--space-sm)",
            borderRadius: "var(--radius-chrome)",
            border: "1px solid var(--divider)",
            background: "transparent",
            color: "var(--text-primary-rack)",
            cursor: "pointer",
          }}
        >
          <X size={12} strokeWidth={2} aria-hidden="true" />
          Clear Filters
        </button>
      )}
    </div>
  );
}
