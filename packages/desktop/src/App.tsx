import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import { subscribeMenuAction } from "./adapters/tauri";
import { BoardView, type EmptyStateContent } from "./board/BoardView";
import { CommandPalette } from "./board/CommandPalette";
import { FilterBar } from "./board/FilterBar";
import { FirstRun } from "./board/FirstRun";
import { useBoardChangedSubscription, useBoardQuery, useCreateTask, useProjects } from "./board/useBoardQuery";
import { ProjectRail } from "./projects/ProjectRail";
import { ProjectUnreachable } from "./projects/ProjectUnreachable";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./projects/RegisterProjectFlow";
import { dispatchAction, useGlobalBindings, type ActionId } from "./state/keyboard";
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
  const currentProjectId = useUiStore((state) => state.currentProjectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  // `⌘⇧O`'s actual effect — the SAME registration flow the rail's `+` button and the palette's
  // "Register Project…" command use (`projects/RegisterProjectFlow.tsx`), never a re-derived
  // copy (01-UI-SPEC.md "Project switcher"). `isError`/`error` are surfaced below (CR-02) —
  // this was previously the one entry point that discarded them entirely, leaving the folder
  // picker closing with zero feedback on a rejected registration.
  const { registerProjectFlow, isError: registerIsError, error: registerError } = useRegisterProjectFlow();
  const registerNotice = useRegistrationErrorNotice(registerIsError, registerError);
  // A fixed-position toast so a `⌘⇧O` failure is visible regardless of which of the three
  // return branches below is currently active (boot, zero-project FirstRun, or the rail+board) —
  // reuses FirstRun.tsx's own `type-label`/`var(--destructive-strip)` error styling rather than
  // inventing a second idiom (CR-02).
  const registerNoticeNode = registerNotice ? (
    <div
      role="status"
      className="type-label"
      style={{
        position: "fixed",
        bottom: "var(--space-lg)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1400,
        color: "var(--destructive-strip)",
        background: "var(--surface-secondary)",
        border: "1px solid var(--divider)",
        borderRadius: "var(--radius-chrome)",
        padding: "var(--space-sm) var(--space-md)",
        maxWidth: "80vw",
      }}
    >
      {registerNotice}
    </div>
  ) : null;

  // `⌘⇧O` and `⌘1`-`⌘9` (01-UI-SPEC.md Keyboard Map, Global) — held here because this is where
  // the registered-project list and the "which project is current" state both live.
  useGlobalBindings({
    "register-project": () => {
      void registerProjectFlow();
    },
    "switch-project": (binding) => {
      const project = (projectsQuery.data ?? [])[binding.projectIndex ?? -1];
      if (project) setCurrentProjectId(project.id);
    },
  });

  // Bridges a native menu click (`src-tauri/src/menu.rs`'s `on_menu_event`) into the SAME
  // keyboard-action pipeline a real keystroke uses (`dispatchAction`, `state/keyboard.ts`) —
  // menu items never call a mutation/command directly, only ever the identical action id a
  // keystroke would resolve to (threat T-01-02).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeMenuAction((actionId) => {
      dispatchAction(actionId as ActionId);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Loading: no copy, no spinner mid-content (01-UI-SPEC.md State Inventory) — the rack ground
  // alone is the boot state until the first project list resolves.
  if (!projectsQuery.data) {
    return (
      <>
        <div id="app-root" className="rack-ground" />
        <CommandPalette />
        {registerNoticeNode}
      </>
    );
  }

  if (projectsQuery.data.length === 0) {
    return (
      <>
        <div id="app-root" className="rack-ground">
          <FirstRun />
        </div>
        <CommandPalette />
        {registerNoticeNode}
      </>
    );
  }

  const project =
    projectsQuery.data.find((candidate) => candidate.id === currentProjectId) ?? projectsQuery.data[0];
  return (
    <>
      <div id="app-root" className="rack-ground" style={{ display: "flex", height: "100%" }}>
        <ProjectRail
          projects={projectsQuery.data}
          currentProjectId={project.id}
          onSelect={(selected) => setCurrentProjectId(selected.id)}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          {project.status === "unreachable" ? (
            // D-16: an unreachable project's marker no longer matches its cached path — this
            // surface replaces the board entirely and offers only explicit relocation, never a
            // board rendered against a repository Flywheel can no longer verify.
            <ProjectUnreachable project={project} />
          ) : (
            <Board projectId={project.id} projectName={project.name} />
          )}
        </div>
      </div>
      <CommandPalette />
      {registerNoticeNode}
    </>
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
