import React, { Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import { subscribeMenuAction } from "./adapters/tauri";
import { FirstRun } from "./board/FirstRun";
import { StoryBoard } from "./board/StoryBoard";
import { useProjects } from "./board/useBoardQuery";
import { useWatchedRun } from "./fleet/useWatchedRun";
import { LaunchSheet } from "./launch-sheet/LaunchSheet";
import { ProjectRail } from "./projects/ProjectRail";
import { ProjectUnreachable } from "./projects/ProjectUnreachable";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./projects/RegisterProjectFlow";
import { OrphanRecoveryModal } from "./recovery/OrphanRecoveryModal";
import { SessionSurface } from "./session/SessionSurface";
import { SettingsSurface } from "./settings/SettingsSurface";
import { activeSurface, dispatchAction, useGlobalBindings, type ActionId } from "./state/keyboard";
import { useMenuLayerSync } from "./state/menuSync";
import { useUiStore } from "./state/uiStore";
// Phase 10 plan 10-01: the fleet surface, loaded on first open.
const FleetSurface = React.lazy(() =>
  import("./fleet/FleetSurface").then((m) => ({ default: m.FleetSurface })),
);
// Phase 10 plan 10-08: the worktree inventory, loaded on first open the same way.
const WorktreeInventory = React.lazy(() =>
  import("./fleet/WorktreeInventory").then((m) => ({ default: m.WorktreeInventory })),
);
import "./styles/tokens.css";
import "./styles/type.css";
import "./styles/motion.css";
import "./App.css";

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
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  // Phase 10 plan 10-01 (D-163): the fleet surface — opened from the project rail's Fleet row, the
  // global `open-fleet` binding, the palette and the native menu.
  const fleetSurface = useUiStore((state) => state.fleetSurface);
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const worktreeInventoryOpen = useUiStore((state) => state.worktreeInventoryOpen);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  // D-27: the launch sheet, mounted once here — `null` means closed. Opened by setting this Story id.
  const launchSheetStoryId = useUiStore((state) => state.launchSheetStoryId);
  const setLaunchSheetStoryId = useUiStore((state) => state.setLaunchSheetStoryId);
  // D-39: the Settings surface, mounted once here like the session surface and the launch sheet
  // above — opened by the native menu's "Settings…" item, the global `⌘,` binding, and the
  // command palette (plan 02-10 Task 3), all through this one `open-settings` action id.
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
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

  // Loading: no copy, no spinner mid-content (01-UI-SPEC.md State Inventory) — the rack ground
  // alone is the boot state until the first project list resolves.
  if (!projectsQuery.data) {
    return (
      <>
        <div id="app-root" className="rack-ground" />
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
        </div>
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
    sessionOpen: Boolean(activeSessionId),
    fleetOpen: fleetSurface !== null,
    worktreeInventoryOpen,
    projectUnreachable: project.status === "unreachable",
  });
  function renderSurface(): React.ReactNode {
    switch (surface) {
      case "settings":
        // D-39: same "pushed into, popped back out of" shell as the session surface.
        return <SettingsSurface onBack={() => setSettingsOpen(false)} />;
      case "session":
        if (!activeSessionId) return null;
        return (
          <SessionSurface
            sessionId={activeSessionId}
            storyId={activeSessionStoryId}
            initialFeedOffset={activeSessionInitialLogOffset}
            initialStatus={activeSessionInitialStatus}
            onBack={() => setActiveSessionId(null)}
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
        // The bare board (issue #50): the Story list with Start, and the hand-written Story form.
        // Start opens the new session's surface, the same push the launch sheet makes.
        return (
          <StoryBoard
            projectId={project.id}
            projectName={project.name}
            onStarted={(sessionId, storyId) => setActiveSessionId(sessionId, storyId)}
          />
        );
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
        <div style={{ flex: 1, minHeight: 0 }}>
          {renderSurface()}
        </div>
      </div>
      <OrphanRecoveryModal />
      <LaunchSheet
        storyId={launchSheetStoryId}
        onClose={() => setLaunchSheetStoryId(null)}
        onStarted={(sessionId) => {
          // `launchSheetStoryId` is captured in this closure at its render-time value, still the
          // Story this run just started for — read BEFORE it is cleared below.
          setActiveSessionId(sessionId, launchSheetStoryId);
          setLaunchSheetStoryId(null);
        }}
      />
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
