import React, { Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import { subscribeMenuAction } from "./adapters/tauri";
import { FirstRun } from "./board/FirstRun";
import { LaunchEnvironmentNotice } from "./board/LaunchEnvironmentNotice";
import { StoryBoard } from "./board/StoryBoard";
import { StoryView } from "./board/StoryView";
import { EpicShapingView } from "./shaping/EpicShapingView";
import { MilestoneShapingView } from "./shaping/MilestoneShapingView";
import { useProjects } from "./board/useBoardQuery";
import { useWatchedRun } from "./fleet/useWatchedRun";
import { LaunchSheet } from "./launch-sheet/LaunchSheet";
import { ProjectRail } from "./projects/ProjectRail";
import { ProjectUnreachable } from "./projects/ProjectUnreachable";
import { useRegisterProjectFlow, useRegistrationErrorToast } from "./projects/RegisterProjectFlow";
import { OrphanRecoveryModal } from "./recovery/OrphanRecoveryModal";
import { SessionSurface } from "./session/SessionSurface";
import { SettingsSurface } from "./settings/SettingsSurface";
import { AndonStrip } from "./shell/AndonStrip";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  Skeleton,
  TooltipProvider,
  Toaster,
  useLoadingPhase,
} from "@highknow/design";
import { CommandPalette } from "./shell/CommandPalette";
import { activeSurface, dispatchAction, useGlobalBindings, type ActionId } from "./state/keyboard";
import { useMenuLayerSync } from "./state/menuSync";
import { useUiStore } from "./state/uiStore";
// Phase 10 plan 10-01: the fleet surface, loaded on first open.
const FleetSurface = React.lazy(() => import("./fleet/FleetSurface").then((m) => ({ default: m.FleetSurface })));
// Phase 10 plan 10-08: the worktree inventory, loaded on first open the same way.
const WorktreeInventory = React.lazy(() =>
  import("./fleet/WorktreeInventory").then((m) => ({ default: m.WorktreeInventory })),
);
import { useColorScheme } from "./theme/colorScheme";
import "./styles/globals.css";

function AppShell() {
  const projectsQuery = useProjects();
  const currentProjectId = useUiStore((state) => state.currentProjectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  // D-31: the live session surface, pushed into from a Story and popped back out of — the board
  // stays the board (this state is `null` whenever no session is being watched).
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const activeSessionStoryId = useUiStore((state) => state.activeSessionStoryId);
  const activeSessionInitialLogOffset = useUiStore((state) => state.activeSessionInitialLogOffset);
  const activeSessionInitialStatus = useUiStore((state) => state.activeSessionInitialStatus);
  // Issue #104: the Story open in the Story view, and the one Back every surface uses.
  const currentStoryId = useUiStore((state) => state.currentStoryId);
  const currentEpicId = useUiStore((state) => state.currentEpicId);
  const currentMilestoneId = useUiStore((state) => state.currentMilestoneId);
  const openStory = useUiStore((state) => state.openStory);
  const goBack = useUiStore((state) => state.goBack);
  // Phase 10 plan 10-01 (D-163): the fleet surface — opened from the project rail's Fleet row, the
  // global `open-fleet` binding, the palette and the native menu.
  const fleetSurface = useUiStore((state) => state.fleetSurface);
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  // The fleet and inventory close through Back, like every other surface (issue #104).
  const worktreeInventoryOpen = useUiStore((state) => state.worktreeInventoryOpen);
  // D-27: the launch sheet, mounted once here — `null` means closed. Opened by setting this Story id.
  const launchSheetStoryId = useUiStore((state) => state.launchSheetStoryId);
  const setLaunchSheetStoryId = useUiStore((state) => state.setLaunchSheetStoryId);
  // D-39: the Settings surface, mounted once here like the session surface and the launch sheet
  // above — opened by the native menu's "Settings…" item, the global `⌘,` binding, and the
  // command palette (plan 02-10 Task 3), all through this one `open-settings` action id.
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  // `⌘⇧O`'s actual effect — the SAME registration flow the rail's `+` button and the palette's
  // "Register project…" command use (`projects/RegisterProjectFlow.tsx`). This entry point has no
  // surface of its own, so a failure is an error toast (DESIGN.md § Feedback, issue #210), visible
  // whichever branch below is drawn (CR-02).
  const { registerProjectFlow, isError: registerIsError, error: registerError } = useRegisterProjectFlow();
  useRegistrationErrorToast(registerIsError, registerError);

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
    "go-back": () => goBack(),
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
  // `create-story`'s `CmdOrCtrl+N` accelerator, so the keystroke never reaches the webview and
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

  // Boot (critique F47, issue #210): the shell in its own shape, the rail and the board drawn as
  // Skeletons, until the first project list resolves. No copy and no spinner (DESIGN.md § Feedback). The
  // design system's loading rule: the floor alone for the first 150 ms, so a fast boot never flashes the
  // skeleton, and once drawn the skeleton holds at least 400 ms.
  const bootPhase = useLoadingPhase(projectsQuery.isPending);
  if (bootPhase !== "ready" || !projectsQuery.data) {
    return (
      <>
        {bootPhase === "blank" ? null : <BootShell />}
        <OrphanRecoveryModal />
      </>
    );
  }

  if (projectsQuery.data.length === 0) {
    return (
      <>
        <div id="app-root" className="h-full bg-background text-foreground">
          {/* Settings is reachable before any project exists: first run's missing-claude Alert offers it. */}
          {settingsOpen ? <SettingsSurface onBack={() => setSettingsOpen(false)} /> : <FirstRun />}
        </div>
        <OrphanRecoveryModal />
      </>
    );
  }

  const project = projectsQuery.data.find((candidate) => candidate.id === currentProjectId) ?? projectsQuery.data[0];
  // Which surface fills the content area is one modelled value (`state/keyboard.ts`'s
  // `activeSurface`, Phase 13 plan 13-08, FNC-06) — the precedence order and its reasoning live
  // there, beside `topLayer`. This is the one place that knows what "open" means for each store
  // field; the string ids use truthiness, exactly as the conditional this replaced did.
  const surface = activeSurface({
    settingsOpen,
    sessionOpen: Boolean(activeSessionId),
    fleetOpen: fleetSurface !== null,
    worktreeInventoryOpen,
    projectUnreachable: project.status === "unreachable",
    storyOpen: currentStoryId !== null,
    epicOpen: currentEpicId !== null,
    milestoneOpen: currentMilestoneId !== null,
  });
  function renderSurface(): React.ReactNode {
    switch (surface) {
      case "settings":
        // D-39: same "pushed into, popped back out of" shell as the session surface.
        return <SettingsSurface onBack={goBack} />;
      case "session":
        if (!activeSessionId) return null;
        return (
          <SessionSurface
            // One surface per session: what it heard about one session never carries into another.
            key={activeSessionId}
            sessionId={activeSessionId}
            storyId={activeSessionStoryId}
            initialFeedOffset={activeSessionInitialLogOffset}
            initialStatus={activeSessionInitialStatus}
            onBack={goBack}
          />
        );
      case "fleet":
        return (
          <Suspense fallback={null}>
            <FleetSurface onClose={goBack} />
          </Suspense>
        );
      case "worktree-inventory":
        return (
          <Suspense fallback={null}>
            <WorktreeInventory onClose={goBack} />
          </Suspense>
        );
      case "project-unreachable":
        return <ProjectUnreachable project={project} projects={projectsQuery.data} />;
      case "story":
        if (!currentStoryId) return null;
        return <StoryView projectId={project.id} projectName={project.name} storyId={currentStoryId} onBack={goBack} />;
      case "epic":
        if (!currentEpicId) return null;
        // Issue #123: the Epic card beside its Round dock.
        return (
          <EpicShapingView projectId={project.id} projectName={project.name} epicId={currentEpicId} onBack={goBack} />
        );
      case "milestone":
        if (!currentMilestoneId) return null;
        // Issue #132: the Milestone's exit test beside its Round dock.
        return (
          <MilestoneShapingView
            projectId={project.id}
            projectName={project.name}
            milestoneId={currentMilestoneId}
            onBack={goBack}
          />
        );
      case "board":
        // The bare board (issue #50): the Story list with Start, and the hand-written Story form.
        // Start starts the session and stays on the board: the session opens only from its own
        // control (issue #104).
        return <StoryBoard projectId={project.id} projectName={project.name} />;
      default: {
        // A `UiSurface` variant without an arm above is a compile error here, not a silent blank.
        const unhandled: never = surface;
        return unhandled;
      }
    }
  }
  return (
    <>
      {/* The shell is shadcn's layout: the provider, the rail as its Sidebar, the main pane as its SidebarInset.
          It is exactly the window, positioned and clipped, so nothing laid out inside it can make the window
          scroll and carry the rail away with it; only the main pane's own scroller moves (issue #191). */}
      <SidebarProvider id="app-root" className="relative h-full min-h-0 overflow-clip bg-background text-foreground">
        <ProjectRail
          projects={projectsQuery.data}
          currentProjectId={project.id}
          onSelect={(selected) => setCurrentProjectId(selected.id)}
        />
        <SidebarInset className="min-h-0 min-w-0">
          {/* The andon strip: one lamp per live session, on every screen (direction.md). */}
          <AndonStrip />
          {/* The reserved slot for what Flywheel found at launch (a missing `claude`): in the flow under the
              strip, so it pushes the surface down and never covers a lamp (critique F6). Empty when all is well. */}
          <LaunchEnvironmentNotice />
          <div className="flex min-h-0 flex-1 flex-col">{renderSurface()}</div>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette projects={projectsQuery.data} currentProjectId={project.id} />
      <OrphanRecoveryModal />
      <LaunchSheet
        storyId={launchSheetStoryId}
        onClose={() => setLaunchSheetStoryId(null)}
        onStarted={(_sessionId, projectId) => {
          // `launchSheetStoryId` is captured in this closure at its render-time value, still the
          // Story this run just started for — read BEFORE it is cleared below. The new session is
          // not opened (issue #104): the developer lands on its Story, which offers "Open session".
          const storyId = launchSheetStoryId;
          setLaunchSheetStoryId(null);
          if (storyId && projectId) openStory(projectId, storyId);
        }}
      />
    </>
  );
}

/** The boot state: the shell's own shape, so the window never shows a blank floor before the rail and
 * the board arrive (critique F47). */
function BootShell() {
  return (
    <SidebarProvider id="app-root" className="relative h-full min-h-0 overflow-clip bg-background text-foreground">
      <Sidebar
        collapsible="none"
        style={{ "--sidebar-width": "248px" } as React.CSSProperties}
        className="shrink-0 border-r border-sidebar-border"
      >
        <SidebarHeader className="flex-row items-center gap-2.5 px-4 pt-4 pb-2">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-20" />
        </SidebarHeader>
        <SidebarContent className="px-2 pt-2">
          <SidebarMenu>
            {Array.from({ length: 6 }, (_, index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset data-slot="boot" className="min-h-0 min-w-0" aria-busy="true" aria-label="Loading your projects">
        <div className="flex h-14 shrink-0 items-center gap-3 px-5">
          <Skeleton className="h-5 w-40" />
          <span className="flex-1" />
          <Skeleton className="h-8.5 w-52" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 pb-5">
          <Skeleton className="h-24 w-full shrink-0 rounded-[10px]" />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full shrink-0 rounded-[10px]" />
          ))}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function App() {
  useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <AppShell />
        {/* After-action feedback (DESIGN.md § Feedback): the one Toaster, bottom-right, clear of the andon
            strip. Screens fire toasts through `lib/notify.ts`. */}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
