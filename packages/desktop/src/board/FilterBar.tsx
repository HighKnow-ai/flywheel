/**
 * The always-visible top-bar search field and filter chips (01-UI-SPEC.md "Search & filter" —
 * search lives in the bar, not behind the command palette, since it is a primary daily action;
 * `⌘F` and `/` both focus it). Chips cover every dimension BOARD-06 names: status, epic
 * (including "No epic"), assignee (including "Unassigned"), priority and estimate. The epic
 * dimension is one disclosure button (`Epic ▾`) over the roster's chips, collapsed by default, so
 * the bar stays about one row however many epics a project has (the spec asks for "chips/dropdown").
 *
 * This component owns no server data of its own beyond the small rosters below — it never reads
 * the currently loaded board window, and it never runs the board's own filtering query itself. It
 * only reads/writes `state/uiStore.ts`'s filter draft and search term. `board/useBoardQuery.ts`'s
 * `useBoardQuery` is the single place that draft is debounced and translated into a
 * `board_list`/`board_search` call (D-03: no second filtering implementation, not even a
 * client-side preview of one). Selecting an epic chip only writes to `filterDraft.epicIds`; which
 * rows that selects — including the "No epic" bucket, `EpicSelector::NoEpic` in
 * `packages/core/src/query/filter.rs` — remains the Rust core's decision, never a renderer-side
 * null check.
 *
 * The epic chip list is the project's full epic roster from `useEpics` (BOARD-06, G-01-2,
 * 01-18-PLAN.md) — a dedicated "list every epic" query, independent of the currently loaded board
 * window and of any other active filter. Composing the epic filter with another active filter
 * that hides every row of a given epic no longer drops that epic's chip. `useEpics` supplies chip
 * *labels* only.
 */
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
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
import { useActors, useEpics } from "./useBoardQuery";

export interface FilterBarProps {
  /** The project whose epic roster supplies the epic chip labels (`useEpics`, G-01-2). Omitted
   * (or `undefined`) issues no `epic_list_all` call and renders only the `No epic` chip. */
  projectId?: string;
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
    // The edge comes from `.control-edge` (App.css: --border-control, 3:1) — never the 1.2:1
    // hairline. A pressed chip is a CURRENT STATE, so it is marked neutrally like every other one
    // (08.1-UI-SPEC § The brand rule): ink edge, ink text, semibold. The brand is not a state colour.
    ...(active ? { border: "1px solid var(--text-primary-rack)", fontWeight: 600 } : {}),
    background: active ? "var(--surface-dominant)" : "var(--surface-secondary)",
    color: "var(--text-primary-rack)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

export function FilterBar({ projectId, isFetching = false }: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [epicPickerOpen, setEpicPickerOpen] = useState(false);

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
  const toggleHasWorktree = useUiStore((state) => state.toggleHasWorktree);
  const clearFilters = useUiStore((state) => state.clearFilters);

  const actorsQuery = useActors();
  const actors = actorsQuery.data ?? [];

  // The project's full epic roster (BOARD-06, G-01-2) — never the loaded window. Order is the
  // roster's own order (`crate::query::ORDER_BY`, pinned in `packages/core/tests/epic_roster.rs`);
  // this component must not sort, dedupe or re-order it, which would create a second ordering
  // definition.
  const epicsQuery = useEpics(projectId);
  const epicOptions = useMemo(
    () => (epicsQuery.data?.epics ?? []).map((epic) => [epic.id, `${epic.key} ${epic.title}`] as const),
    [epicsQuery.data],
  );

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
        // Groups sit a step further apart than the chips inside a group, so the five dimensions read
        // as five groups rather than one run of forty chips.
        columnGap: "var(--space-md)",
        rowGap: "var(--space-sm)",
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
          className="type-body control-edge"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search titles, bodies or a key like FLY-142…"
          aria-label="Search items"
          aria-busy={isFetching}
          style={{
            width: 320,
            padding: `var(--space-xs) ${isFetching ? "calc(var(--space-lg) + 4px)" : "var(--space-sm)"} var(--space-xs) calc(var(--space-lg) + 4px)`,
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
              background: "var(--text-muted-rack)",
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
              className="type-label control-edge"
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
              className="type-label control-edge"
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
              className="type-label control-edge"
              aria-pressed={selected}
              onClick={() => toggleEstimate(value)}
              style={chipStyle(selected)}
            >
              {estimateLetter(value)}
            </button>
          );
        })}
      </div>

      {/* D-17 / amendment A-04: the core narrows (an epic matches when any child task has an active
          worktree); this chip only writes the draft field. The accessible name says in words what
          it narrows to, and begins with the visible label (WCAG label-in-name). */}
      <div id="filter-worktree" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        <button
          type="button"
          className="type-label control-edge"
          aria-pressed={filterDraft.hasWorktree}
          aria-label="Has worktree: only items with an active worktree, and epics with a task that has one"
          onClick={toggleHasWorktree}
          style={chipStyle(filterDraft.hasWorktree)}
        >
          Has worktree
        </button>
      </div>

      {/* The epic dimension is one picker, not one chip per epic (08.1-14 finish review): thirteen
          epics repeated the roster as thirteen bordered chips and made the bar the loudest structure
          on the page. The dimension is unchanged (BOARD-06) and the list still covers every epic in
          the project (G-01-2); only its default state is collapsed. `display: contents` keeps the
          trigger in the bar's own flow, and the options take a full row of their own while open. The
          options stay mounted but `hidden` when closed, so they are out of the tab order and the
          accessibility tree until asked for. */}
      <div id="filter-epic" style={{ display: "contents" }}>
        <button
          type="button"
          className="type-label control-edge"
          aria-expanded={epicPickerOpen}
          aria-controls="filter-epic-options"
          onClick={() => setEpicPickerOpen((open) => !open)}
          style={{ ...chipStyle(filterDraft.epicIds.length > 0), gap: "var(--space-xs)" }}
        >
          {filterDraft.epicIds.length > 0 ? `Epic \u00b7 ${filterDraft.epicIds.length}` : "Epic"}
          {epicPickerOpen ? <ChevronUp size={12} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />}
        </button>
        <div
          id="filter-epic-options"
          role="group"
          aria-label="Filter by epic"
          hidden={!epicPickerOpen}
          style={epicPickerOpen ? { display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", flexBasis: "100%", order: 1 } : undefined}
        >
          <button
            key="no-epic"
            type="button"
            className="type-label control-edge"
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
                className="type-label control-edge"
                aria-pressed={selected}
                onClick={() => toggleEpic(epicId)}
                style={chipStyle(selected)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div id="filter-assignee" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
        <button
          key="unassigned"
          type="button"
          className="type-label control-edge"
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
              className="type-label control-edge"
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
          className="type-label control-edge"
          onClick={clearFilters}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-xs)",
            padding: "var(--space-xs) var(--space-sm)",
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
