import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import { BoardView, type EmptyStateContent } from "./board/BoardView";
import { FilterBar } from "./board/FilterBar";
import { FirstRun } from "./board/FirstRun";
import {
  useBoardChangedSubscription,
  useBoardQuery,
  useCreateTask,
  useProjects,
} from "./board/useBoardQuery";
import { isFilterDraftActive, useUiStore } from "./state/uiStore";
import "./styles/tokens.css";
import "./styles/type.css";
import "./styles/motion.css";
import "./App.css";

/**
 * The tracer's end-to-end path (01-03-PLAN.md): register a project, see its rack, quick-add a
 * task, watch it appear via the pushed `board:changed` delta, survive a relaunch.
 *
 * Plan 01-08 adds `FilterBar` (search + filter chips, BOARD-06) above the rack and threads the
 * filter draft/search term from `state/uiStore.ts` into `useBoardQuery` — the one place they are
 * debounced and turned into a `board_list`/`board_search` call (D-03).
 *
 * A single project's board renders here — the project rail that lets a user switch between
 * multiple registered projects is a later plan's surface (01-UI-SPEC.md "Project switcher");
 * this plan proves the one path with the first registered project.
 */
function Board({ projectId, projectName }: { projectId: string; projectName: string }) {
  const filterDraft = useUiStore((state) => state.filterDraft);
  const searchTerm = useUiStore((state) => state.searchTerm);
  const clearFilters = useUiStore((state) => state.clearFilters);

  const boardQuery = useBoardQuery(projectId, filterDraft, searchTerm);
  const createTask = useCreateTask(projectId);

  // Subscribes exactly once to the core's board:changed push channel (D-04) — the UI never
  // trusts its own mutation as already resolved.
  useBoardChangedSubscription();

  // Distinguishes the two empty-window states purely from this component's own filter/search UI
  // state (01-UI-SPEC.md "State Inventory") — `BandCounts` alone cannot make this distinction,
  // since a truly empty project and a filter matching nothing both report all-zero counts.
  const filtersActive = isFilterDraftActive(filterDraft) || searchTerm.trim().length > 0;

  const emptyState: EmptyStateContent | undefined = filtersActive
    ? {
        heading: "No items match these filters",
        body: "Try removing a filter or clearing the search.",
        ctaLabel: "Clear Filters",
        onCta: clearFilters,
      }
    : boardQuery.data
      ? { heading: "This board is empty", body: "Start typing below to create your first task or epic. Press Enter to save it." }
      : undefined;

  return (
    <div className="board-shell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        className="board-header type-heading"
        style={{ padding: "var(--space-md)", color: "var(--text-primary-rack)" }}
      >
        {projectName}
      </header>
      {boardQuery.data && (
        <FilterBar items={boardQuery.data.items} isFetching={boardQuery.isFetching} />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {boardQuery.data ? (
          <BoardView
            projectId={projectId}
            items={boardQuery.data.items}
            issues={boardQuery.data.issues}
            counts={boardQuery.data.counts}
            onCreateTask={(title) => createTask.mutate(title)}
            emptyState={emptyState}
          />
        ) : null}
      </div>
    </div>
  );
}

function AppShell() {
  const projectsQuery = useProjects();

  // Loading: no copy, no spinner mid-content (01-UI-SPEC.md State Inventory) — the rack ground
  // alone is the boot state until the first project list resolves.
  if (!projectsQuery.data) {
    return <div id="app-root" className="rack-ground" />;
  }

  if (projectsQuery.data.length === 0) {
    return (
      <div id="app-root" className="rack-ground">
        <FirstRun />
      </div>
    );
  }

  const project = projectsQuery.data[0];
  return (
    <div id="app-root" className="rack-ground">
      <Board projectId={project.id} projectName={project.name} />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

export default App;
