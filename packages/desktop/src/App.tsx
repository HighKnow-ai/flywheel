import React, { Suspense, useCallback, useEffect, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import { subscribeMenuAction } from "./adapters/tauri";
import { BoardView, type EmptyStateContent } from "./board/BoardView";
import { CommandPalette } from "./board/CommandPalette";
import { FilterBar } from "./board/FilterBar";
import { FirstRun } from "./board/FirstRun";
import {
  useBoardChangedSubscription,
  useBoardQuery,
  useCreateTask,
  useEpics,
  useProjects,
  type EpicSummary,
} from "./board/useBoardQuery";
import { WavePlanSheet } from "./dispatch/WavePlanSheet";
import { useWatchedRun } from "./fleet/useWatchedRun";
import { LaunchSheet } from "./launch-sheet/LaunchSheet";
import { ProjectRail } from "./projects/ProjectRail";
import { ProjectUnreachable } from "./projects/ProjectUnreachable";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./projects/RegisterProjectFlow";
import { OrphanRecoveryModal } from "./recovery/OrphanRecoveryModal";
import { SessionSurface } from "./session/SessionSurface";
import { LaunchOverlapToast } from "./shell/LaunchOverlapToast";
import { SettingsSurface } from "./settings/SettingsSurface";
import { activeSurface, dispatchAction, useGlobalBindings, type ActionId } from "./state/keyboard";
import { useMenuLayerSync } from "./state/menuSync";
import { isFilterDraftActive, useUiStore } from "./state/uiStore";
import { TriageSurface } from "./triage/TriageSurface";
// Phase 8 plan 08-01: loaded on first open so the board's cold start pays nothing for the diff
// renderer and the Prism grammars.
const ReviewSurface = React.lazy(() =>
  import("./review/ReviewSurface").then((m) => ({ default: m.ReviewSurface })),
);
// Phase 10 plan 10-01: the fleet surface, loaded on first open like the review surface.
const FleetSurface = React.lazy(() =>
  import("./fleet/FleetSurface").then((m) => ({ default: m.FleetSurface })),
);
// Phase 10 plan 10-08: the worktree inventory, loaded on first open the same way.
const WorktreeInventory = React.lazy(() =>
  import("./fleet/WorktreeInventory").then((m) => ({ default: m.WorktreeInventory })),
);
import { UpdateBanner } from "./update/UpdateBanner";
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
        <FilterBar projectId={projectId} isFetching={boardQuery.isFetching} />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {boardQuery.data ? (
          <BoardView
            projectId={projectId}
            items={boardQuery.data.items}
            issues={boardQuery.data.issues}
            counts={boardQuery.data.counts}
            onCreateTask={(title, epicId) => createTask.mutate({ title, epicId })}
            emptyState={emptyState}
            // keepPreviousData keeps the last project's rows on screen while a switched-to project loads;
            // a pending jump must not be judged against them.
            windowSettled={!boardQuery.isPlaceholderData}
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
  // D-31: the live session surface, pushed into from a task and popped back out of — the board
  // stays the board (this state is `null` whenever no session is being watched).
  const activeAgentRunId = useUiStore((state) => state.activeAgentRunId);
  const activeAgentRunTaskId = useUiStore((state) => state.activeAgentRunTaskId);
  const activeAgentRunAuthoringStage = useUiStore((state) => state.activeAgentRunAuthoringStage);
  const activeAgentRunEpicId = useUiStore((state) => state.activeAgentRunEpicId);
  const activeAgentRunInitialLogOffset = useUiStore((state) => state.activeAgentRunInitialLogOffset);
  const activeAgentRunInitialStatus = useUiStore((state) => state.activeAgentRunInitialStatus);
  const setActiveAgentRunId = useUiStore((state) => state.setActiveAgentRunId);
  // D-103 (plan 06-08): the dedicated triage surface, mounted once here like the session surface
  // and Settings above — opened from `board/TriageLane.tsx`'s header route control, which sets
  // this field directly (the same cross-tree trigger shape every other App-level surface uses).
  const triageSurfaceProjectId = useUiStore((state) => state.triageSurfaceProjectId);
  const setTriageSurfaceProjectId = useUiStore((state) => state.setTriageSurfaceProjectId);
  // Phase 8 plan 08-01: the review surface — same cross-tree trigger shape as the triage surface.
  const reviewSurface = useUiStore((state) => state.reviewSurface);
  const setReviewSurface = useUiStore((state) => state.setReviewSurface);
  // Phase 10 plan 10-01 (D-163): the fleet surface — opened from the project rail's Fleet row, the
  // global `open-fleet` binding, the palette and the native menu.
  const fleetSurface = useUiStore((state) => state.fleetSurface);
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const worktreeInventoryOpen = useUiStore((state) => state.worktreeInventoryOpen);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  // The triage surface's own epic roster — read the same way `BoardView.tsx` does (`useEpics`),
  // since `AppShell` has no other source for it. Gated on `triageSurfaceProjectId` itself
  // (`useEpics`'s own `enabled: Boolean(projectId)`), so this issues no read while the surface is
  // closed.
  const triageEpicsQuery = useEpics(triageSurfaceProjectId ?? undefined);
  const triageEpics = triageEpicsQuery.data?.epics ?? [];
  const triageEpicsById = useMemo<Record<string, EpicSummary>>(
    () => Object.fromEntries(triageEpics.map((epic) => [epic.id, epic])),
    [triageEpics],
  );
  // D-27: the launch sheet, mounted once here as a peer of CommandPalette below — `null` means
  // closed. `ItemDetailPanel.tsx`'s "Start Work" affordance and the board-list `start-work`
  // action id (`w`) both open it purely by setting this task id (`board/BoardView.tsx`).
  const launchSheetTaskId = useUiStore((state) => state.launchSheetTaskId);
  const setLaunchSheetTaskId = useUiStore((state) => state.setLaunchSheetTaskId);
  // Plan 09-09: the wave plan sheet, mounted once here as a peer of the launch sheet below.
  const wavePlanSheetEpicId = useUiStore((state) => state.wavePlanSheetEpicId);
  const setWavePlanSheetEpicId = useUiStore((state) => state.setWavePlanSheetEpicId);
  // D-91 (plan 05-10): the SAME channel `SessionSurface.tsx`'s Discard hand-off (plan 05-09)
  // already writes to — reused here as the general "open the authoring launch sheet" trigger, so
  // `continueShapingEpic` (a fresh reopen) and a post-Discard hand-off (an interrupted one) both
  // land on the one authoring variant of this sheet rather than two independently-wired copies.
  const launchSheetAuthoringHandoff = useUiStore((state) => state.launchSheetAuthoringHandoff);
  const clearLaunchSheetAuthoringHandoff = useUiStore((state) => state.clearLaunchSheetAuthoringHandoff);
  // D-39: the Settings surface, mounted once here like the session surface and the launch sheet
  // above — opened by the native menu's "Settings…" item, the global `⌘,` binding, and the
  // command palette (plan 02-10 Task 3), all through this one `open-settings` action id.
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  // Plan 09-13 / D-REV-43: every launch site writes Rust's overlap warning to the store; this is the
  // one place it is shown, because each launch surface unmounts as the session takes the screen.
  const launchOverlapWarning = useUiStore((state) => state.launchOverlapWarning);
  const setLaunchOverlapWarning = useUiStore((state) => state.setLaunchOverlapWarning);
  const dismissLaunchOverlapWarning = useCallback(() => setLaunchOverlapWarning(null), [setLaunchOverlapWarning]);
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
    "open-settings": () => setSettingsOpen(true),
    "open-fleet": () => setFleetSurface({ view: "fleet" }),
  });

  // Bridges a native menu click/accelerator (`src-tauri/src/menu.rs`'s `on_menu_event`) into the
  // SAME keyboard-action pipeline a real keystroke uses (`dispatchAction`, `state/keyboard.ts`) —
  // the native menu no longer carries a capability the keyboard lacks. A forwarded id re-enters
  // `dispatchAction` and is admitted or refused by `bindingAllowedInLayer` exactly like a real
  // keystroke would be (threat T-01-02); a menu item that is not permitted in the current layer
  // is greyed out by the OS rather than silently dropped here (`state/menuSync.ts`'s
  // `useMenuLayerSync`, 01-16-PLAN.md Task 3).
  //
  // Previously this handler called `returnToBoardLayer()` for every forwarded id except
  // `open-palette` before dispatching, on the theory that a menu action is always an unambiguous
  // click from outside the keyboard. That was UAT gap G-01-1: on macOS the native menu OWNS
  // `create-task`'s `CmdOrCtrl+N` accelerator, so the keystroke never reaches the webview and
  // this handler runs instead — which meant the reset ran on a *keystroke* and dismantled the
  // very layer (the item detail panel) the keystroke was supposed to be blocked by. The layer
  // guard in `state/keyboard.ts` was correct the whole time; it was being bypassed, not failing.
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

  // Pushes the layer guard's verdict onto the native menu bar (`state/menuSync.ts`) — mounted
  // alongside the bridge effect above since both own the same menu seam (01-16-PLAN.md Task 3).
  useMenuLayerSync();

  // Phase 10 plan 10-07 (D-174): reports which session run is the visible surface, so the core can
  // withhold the one banner for the session being watched. Before the early returns below (hooks).
  useWatchedRun();

  // The update offer (plan 11-06, D-187). One element, shared by the two branches below that draw the
  // app, and fixed to the corner, so it shows over whichever surface is open (it is not a surface).
  // A fresh install with no project registered is offered it too: that user is the one most likely to
  // be running a stale first download. The boot branch draws the bare ground only, so it has none.
  const updateBannerNode = <UpdateBanner />;

  // Loading: no copy, no spinner mid-content (01-UI-SPEC.md State Inventory) — the rack ground
  // alone is the boot state until the first project list resolves.
  if (!projectsQuery.data) {
    return (
      <>
        <div id="app-root" className="rack-ground" />
        <CommandPalette />
        <OrphanRecoveryModal />
        {registerNoticeNode}
      </>
    );
  }

  if (projectsQuery.data.length === 0) {
    return (
      <>
        <div id="app-root" className="rack-ground">
          <FirstRun />
          {updateBannerNode}
        </div>
        <CommandPalette />
        <OrphanRecoveryModal />
        {registerNoticeNode}
      </>
    );
  }

  const project =
    projectsQuery.data.find((candidate) => candidate.id === currentProjectId) ?? projectsQuery.data[0];
  // Which surface fills the content area is one modelled value (`state/keyboard.ts`'s
  // `activeSurface`, Phase 13 plan 13-08, FNC-06) — the precedence order and its reasoning live
  // there, beside `topLayer`. This is the one place that knows what "open" means for each store
  // field; the string ids use truthiness, exactly as the conditional this replaced did.
  const surface = activeSurface({
    settingsOpen,
    triageOpen: Boolean(triageSurfaceProjectId),
    reviewOpen: reviewSurface !== null,
    sessionOpen: Boolean(activeAgentRunId),
    fleetOpen: fleetSurface !== null,
    worktreeInventoryOpen,
    projectUnreachable: project.status === "unreachable",
  });
  function renderSurface(): React.ReactNode {
    switch (surface) {
      case "settings":
        // D-39: same "pushed into, popped back out of" shell as the session surface.
        return <SettingsSurface onBack={() => setSettingsOpen(false)} />;
      case "triage":
        if (!triageSurfaceProjectId) return null;
        return (
          <TriageSurface
            projectId={triageSurfaceProjectId}
            epicsById={triageEpicsById}
            onClose={() => setTriageSurfaceProjectId(null)}
            onOpenSession={(agentRunId, epicId, logOffset) => {
              setTriageSurfaceProjectId(null);
              setActiveAgentRunId(agentRunId, null, null, epicId, logOffset);
            }}
          />
        );
      case "review":
        if (!reviewSurface) return null;
        return (
          <Suspense fallback={null}>
            <ReviewSurface
              scope={reviewSurface.scope}
              itemId={reviewSurface.itemId}
              label={reviewSurface.label}
              fromTask={reviewSurface.fromTask}
              onBack={() => setReviewSurface(null)}
              onOpenSession={(agentRunId, epicId, logOffset) => {
                const taskId = reviewSurface.scope === "task" ? reviewSurface.itemId : null;
                setReviewSurface(null);
                setActiveAgentRunId(agentRunId, taskId, null, epicId, logOffset);
              }}
            />
          </Suspense>
        );
      case "session":
        if (!activeAgentRunId) return null;
        return (
          <SessionSurface
            agentRunId={activeAgentRunId}
            taskId={activeAgentRunTaskId}
            authoringStage={activeAgentRunAuthoringStage}
            epicId={activeAgentRunEpicId}
            initialFeedOffset={activeAgentRunInitialLogOffset}
            initialStatus={activeAgentRunInitialStatus}
            onBack={() => setActiveAgentRunId(null)}
          />
        );
      case "fleet":
        return (
          <Suspense fallback={null}>
            <FleetSurface onClose={() => setFleetSurface(null)} />
          </Suspense>
        );
      case "worktree-inventory":
        return (
          <Suspense fallback={null}>
            <WorktreeInventory onClose={() => setWorktreeInventoryOpen(false)} />
          </Suspense>
        );
      case "project-unreachable":
        return <ProjectUnreachable project={project} />;
      case "board":
        return <Board projectId={project.id} projectName={project.name} />;
      default: {
        // A `UiSurface` variant without an arm above is a compile error here, not a silent blank.
        const unhandled: never = surface;
        return unhandled;
      }
    }
  }
  return (
    <>
      <div id="app-root" className="rack-ground" style={{ display: "flex", height: "100%" }}>
        <ProjectRail
          projects={projectsQuery.data}
          currentProjectId={project.id}
          onSelect={(selected) => setCurrentProjectId(selected.id)}
        />
        {updateBannerNode}
        <div style={{ flex: 1, minHeight: 0 }}>
          {renderSurface()}
        </div>
      </div>
      <CommandPalette />
      <OrphanRecoveryModal />
      <LaunchSheet
        taskId={launchSheetTaskId}
        authoring={
          launchSheetAuthoringHandoff
            ? { projectId: project.id, epicId: launchSheetAuthoringHandoff.epicId }
            : null
        }
        onClose={() => {
          if (launchSheetAuthoringHandoff) clearLaunchSheetAuthoringHandoff();
          else setLaunchSheetTaskId(null);
        }}
        onStarted={(agentRunId, overlapWarning) => {
          // `launchSheetTaskId` is captured in this closure at its render-time value, still the
          // task this run just started for — read BEFORE it is cleared below.
          setActiveAgentRunId(agentRunId, launchSheetTaskId);
          setLaunchSheetTaskId(null);
          // The sheet unmounts here, so its own copy of the warning is gone with it; this is the
          // copy the user actually sees (plan 09-13). Rust's sentence, verbatim.
          if (overlapWarning) setLaunchOverlapWarning(overlapWarning);
        }}
        onAuthoringStarted={(run) => {
          setActiveAgentRunId(run.id, null, run.authoringStage, run.epicId);
          clearLaunchSheetAuthoringHandoff();
        }}
      />
      <WavePlanSheet epicId={wavePlanSheetEpicId} onClose={() => setWavePlanSheetEpicId(null)} />
      <LaunchOverlapToast warning={launchOverlapWarning} onDismiss={dismissLaunchOverlapWarning} />
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
