/**
 * Local UI state — which project is viewed, which overlay or surface is open, and what the live
 * session surface is showing. Held in Zustand, kept entirely separate from TanStack Query's
 * server-state cache (`board/useBoardQuery.ts`) — letting the two blur is what makes an eventual
 * web port painful, and the adapter seam only pays off if the split stays clean
 * (`.claude/CLAUDE.md`'s stack guidance). Nothing in this file ever calls the Tauri command surface.
 */
import { create } from "zustand";
import type { RunStatus } from "../legend/runStatus";

/** The two board record kinds a create or delete action names (GLOSSARY.md "Board records"). */
export type BoardItemKind = "epic" | "story";

/** Which row-level picker is open, if any. One piece of state covers every picker rather than
 * parallel fields — they share the same open/anchor/close shape. */
export type PickerKind = "epic";

/** What the fleet surface (Phase 10, D-163) is showing: the banded fleet list, or (plan 10-05) the
 * blocked queue. One field, one surface, two views; `null` means the fleet is closed. */
export interface FleetSurfaceTarget {
  view: "fleet" | "queue";
}

interface UiState {
  /**
   * Whether the command palette overlay is open — lives here because the Escape ladder
   * (`state/keyboard.ts`'s `nextEscapeLayer`) and the layer model must be able to read it.
   */
  paletteOpen: boolean;
  /** The currently viewed project (`⌘1`-`⌘9`) — `null` means "no explicit choice yet," in which
   * case `AppShell` falls back to the first registered project. */
  currentProjectId: string | null;
  /** The item detail panel's open item, if any (Escape ladder step 2). */
  detailItemId: string | null;
  /** The pending destructive-delete target, if any (⌘⌫, threat T-01-25). */
  deleteTarget: { kind: BoardItemKind; id: string; key: string; title: string } | null;
  /** The currently open row-level picker, if any — read by `state/keyboard.ts`'s layer model. */
  activePicker: { kind: PickerKind; id: string } | null;
  /** Whether quick-add is open. */
  quickAddOpen: boolean;
  /** The agent run id currently occupying the session surface (D-31), or `null` when the board is
   * showing. Lives here so any opener (the launch sheet, the fleet) can route to the surface that
   * replaces the whole content area at the `AppShell` level. */
  activeSessionId: string | null;
  /** The Story `activeSessionId` belongs to — set together with `activeSessionId` at every call
   * site that opens the live session surface and already has the Story id in scope. Exists so the
   * session surface can name its Story and its Discard verb can hand off to the launch sheet for the
   * SAME Story without a new backend read. */
  activeSessionStoryId: string | null;
  /** A one-shot initial position for the session feed (D-99) — `null` opens the feed at its tail. */
  activeSessionInitialLogOffset: number | null;
  /** The status the opener already knows for `activeSessionId` (Phase 10 plan 10-06, Pitfall 7), or
   * `null` for every caller that does not — the session then falls back to its running default. */
  activeSessionInitialStatus: RunStatus | null;
  /** The Story the launch sheet (D-27) is currently open for, or `null` when it is closed. Mounted
   * once at the `App.tsx` level; whatever opens it does not import the sheet component itself. */
  launchSheetStoryId: string | null;
  /** Whether the Settings surface (D-39) is currently open — opened from the native menu bridge, the
   * global `⌘,` binding, and the command palette, none of which import the surface component. */
  settingsOpen: boolean;
  /** Whether the fleet surface (Phase 10, D-163) is open, and which view. `null` when closed. */
  fleetSurface: FleetSurfaceTarget | null;
  /** Whether the worktree inventory (WORK-07) is open. Mutually exclusive with `fleetSurface`:
   * opening either closes the other. */
  worktreeInventoryOpen: boolean;
  /** The Story open in the Story view of `currentProjectId` (issue #104), or `null` for the board.
   * Opening a Story never opens its session: only an explicit session control does. */
  currentStoryId: string | null;
  /** The Epic open in its shaping view (issue #123), with its Round dock, or `null`. A Story view and an
   * Epic view never show together: opening one closes the other. */
  currentEpicId: string | null;
  /** The places visited before this one, oldest first (issue #104). Every opener below pushes the place
   * it leaves; `goBack` (the Back controls and ⌘[) pops it. Closing a surface pushes nothing. */
  navHistory: NavPlace[];
  /** Half-typed answers to an agent's question, keyed by the request id (issue #104). Kept here, not
   * in the feed row, because a virtualised row unmounts when it scrolls out of view. */
  questionDrafts: Record<string, QuestionDraft[]>;
  /** The version string of the update offer the user dismissed (D-187). */
  dismissedUpdateVersion: string | null;
  /** The Milestone picked on each project's Roadmap strip (#131), keyed by project id. Absent means the
   * Current Milestone, so the header and roster follow it until the developer picks another. */
  selectedMilestoneByProject: Record<string, string>;
  setPaletteOpen: (open: boolean) => void;
  setCurrentProjectId: (id: string | null) => void;
  setDetailItemId: (id: string | null) => void;
  setDeleteTarget: (target: UiState["deleteTarget"]) => void;
  setActivePicker: (picker: UiState["activePicker"]) => void;
  setQuickAddOpen: (open: boolean) => void;
  /** Sets every `activeSession*` field together in one `set` call, so the session surface never
   * reads a run id paired with another run's Story or status. */
  setActiveSessionId: (
    sessionId: string | null,
    storyId?: string | null,
    initialLogOffset?: number | null,
    initialStatus?: RunStatus | null,
  ) => void;
  setLaunchSheetStoryId: (storyId: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Opens/closes the fleet surface (`null` to close). */
  setFleetSurface: (target: FleetSurfaceTarget | null) => void;
  /** Opens/closes the worktree inventory; opening it closes the fleet surface. */
  setWorktreeInventoryOpen: (open: boolean) => void;
  setDismissedUpdateVersion: (version: string | null) => void;
  /** Opens a Story's view in its project (issue #104). Never opens its session. */
  openStory: (projectId: string, storyId: string) => void;
  /** Opens an Epic's shaping view in its project (issue #123): the Epic card and its Round dock. */
  openEpic: (projectId: string, epicId: string) => void;
  /** Returns to the place before this one; with no history, to the current project's board. */
  goBack: () => void;
  setQuestionDraft: (requestId: string, draft: QuestionDraft[] | null) => void;
  /** Picks the Milestone the header and roster show on a project's board; `null` follows the Current one. */
  selectMilestone: (projectId: string, milestoneId: string | null) => void;
}

/** One question's half-typed answer: the picked option labels, and the typed "Other" answer. */
export interface QuestionDraft {
  labels: string[];
  other: boolean;
  otherText: string;
}

/** Where the developer is: every field that decides which surface, project, Story and session show. */
export type NavPlace = Pick<
  UiState,
  | "currentProjectId"
  | "currentStoryId"
  | "currentEpicId"
  | "activeSessionId"
  | "activeSessionStoryId"
  | "activeSessionInitialLogOffset"
  | "activeSessionInitialStatus"
  | "fleetSurface"
  | "worktreeInventoryOpen"
  | "settingsOpen"
>;

/** How many places Back remembers. */
const MAX_HISTORY = 50;

/** Every full-pane surface closed and no session open: what remains is the board or a Story view. */
const NO_SURFACE = {
  activeSessionId: null,
  activeSessionStoryId: null,
  activeSessionInitialLogOffset: null,
  activeSessionInitialStatus: null,
  fleetSurface: null,
  worktreeInventoryOpen: false,
  settingsOpen: false,
} satisfies Partial<NavPlace>;

function placeOf(state: NavPlace): NavPlace {
  return {
    currentProjectId: state.currentProjectId,
    currentStoryId: state.currentStoryId,
    currentEpicId: state.currentEpicId,
    activeSessionId: state.activeSessionId,
    activeSessionStoryId: state.activeSessionStoryId,
    activeSessionInitialLogOffset: state.activeSessionInitialLogOffset,
    activeSessionInitialStatus: state.activeSessionInitialStatus,
    fleetSurface: state.fleetSurface,
    worktreeInventoryOpen: state.worktreeInventoryOpen,
    settingsOpen: state.settingsOpen,
  };
}

function samePlace(a: NavPlace, b: NavPlace): boolean {
  return (
    a.currentProjectId === b.currentProjectId &&
    a.currentStoryId === b.currentStoryId &&
    a.currentEpicId === b.currentEpicId &&
    a.activeSessionId === b.activeSessionId &&
    a.activeSessionStoryId === b.activeSessionStoryId &&
    a.fleetSurface?.view === b.fleetSurface?.view &&
    a.worktreeInventoryOpen === b.worktreeInventoryOpen &&
    a.settingsOpen === b.settingsOpen
  );
}

const INITIAL_STATE = {
  paletteOpen: false,
  currentProjectId: null,
  detailItemId: null,
  deleteTarget: null,
  activePicker: null,
  quickAddOpen: false,
  activeSessionId: null,
  activeSessionStoryId: null,
  activeSessionInitialLogOffset: null,
  activeSessionInitialStatus: null,
  launchSheetStoryId: null,
  settingsOpen: false,
  fleetSurface: null,
  worktreeInventoryOpen: false,
  dismissedUpdateVersion: null,
  currentStoryId: null,
  currentEpicId: null,
  navHistory: [] as NavPlace[],
  questionDrafts: {} as Record<string, QuestionDraft[]>,
  selectedMilestoneByProject: {} as Record<string, string>,
} satisfies Partial<UiState>;

export const useUiStore = create<UiState>((set, get) => {
  /** Moves to the place `patch` describes, remembering the one it leaves. Moving to the same place
   * pushes nothing, so a second click on what is already showing never fills Back with repeats. */
  function go(patch: Partial<NavPlace>) {
    const from = placeOf(get());
    const to = { ...from, ...patch };
    if (samePlace(from, to)) {
      set(patch);
      return;
    }
    set({ ...patch, navHistory: [...get().navHistory, from].slice(-MAX_HISTORY) });
  }

  return {
  ...INITIAL_STATE,

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  // Choosing a project shows its board: whatever surface was open closes, so the click is never
  // swallowed by a session or the fleet sitting on top (issue #104).
  setCurrentProjectId: (id) =>
    id === null ? set({ currentProjectId: null, currentStoryId: null, currentEpicId: null }) : go({ currentProjectId: id, currentStoryId: null, currentEpicId: null, ...NO_SURFACE }),
  setDetailItemId: (id) => set({ detailItemId: id }),
  setDeleteTarget: (target) => set({ deleteTarget: target }),
  setActivePicker: (picker) => set({ activePicker: picker }),
  setQuickAddOpen: (open) => set({ quickAddOpen: open }),
  setActiveSessionId: (sessionId, storyId = null, initialLogOffset = null, initialStatus = null) => {
    const fields = {
      activeSessionId: sessionId,
      activeSessionStoryId: storyId,
      activeSessionInitialLogOffset: initialLogOffset,
      activeSessionInitialStatus: initialStatus,
    };
    // Opening is a move Back can undo; closing (`null`) is not a new place.
    if (sessionId === null) set(fields);
    else go({ ...fields, settingsOpen: false });
  },
  setLaunchSheetStoryId: (storyId) => set({ launchSheetStoryId: storyId }),
  setSettingsOpen: (open) => (open ? go({ settingsOpen: true }) : set({ settingsOpen: false })),
  // Opening the fleet or the inventory replaces whatever shows, a session included, so the click
  // always lands where it says. The session stays one Back away.
  setFleetSurface: (target) =>
    target
      ? go({ ...NO_SURFACE, fleetSurface: target })
      : set({ fleetSurface: null }),
  setWorktreeInventoryOpen: (open) =>
    open ? go({ ...NO_SURFACE, worktreeInventoryOpen: true }) : set({ worktreeInventoryOpen: false }),
  setDismissedUpdateVersion: (version) => set({ dismissedUpdateVersion: version }),
  openStory: (projectId, storyId) => go({ ...NO_SURFACE, currentProjectId: projectId, currentStoryId: storyId, currentEpicId: null }),
  openEpic: (projectId, epicId) => go({ ...NO_SURFACE, currentProjectId: projectId, currentStoryId: null, currentEpicId: epicId }),
  goBack: () => {
    const history = get().navHistory;
    const previous = history[history.length - 1];
    if (previous) {
      set({ ...previous, navHistory: history.slice(0, -1) });
      return;
    }
    // Nothing remembered (the app just opened on a surface): Back lands on the project's board.
    set({ ...NO_SURFACE, currentStoryId: null, currentEpicId: null });
  },
  setQuestionDraft: (requestId, draft) => {
    const drafts = { ...get().questionDrafts };
    if (draft === null) delete drafts[requestId];
    else drafts[requestId] = draft;
    set({ questionDrafts: drafts });
  },
  selectMilestone: (projectId, milestoneId) => {
    const selected = { ...get().selectedMilestoneByProject };
    if (milestoneId === null) delete selected[projectId];
    else selected[projectId] = milestoneId;
    set({ selectedMilestoneByProject: selected });
  },
  };
});

/** Resets every UI field back to its initial value — the shared reset the test suites use. Zustand's
 * `setState` merges rather than replaces, so a hand-written reset that forgot a field would leak it
 * between tests; one exported reset removes that class of drift. */
export function resetUiState() {
  useUiStore.setState({ ...INITIAL_STATE });
}
