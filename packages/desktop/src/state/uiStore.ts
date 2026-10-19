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
  /** A one-shot request to select a board item and open its detail (FLEET-03). The request outlives
   * a project switch, and `consumePendingFocusItemId` reads and clears it in one call so it can
   * never fire twice. */
  pendingFocusItemId: string | null;
  /** The version string of the update offer the user dismissed (D-187). */
  dismissedUpdateVersion: string | null;
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
  setPendingFocusItemId: (id: string | null) => void;
  setDismissedUpdateVersion: (version: string | null) => void;
  /** Returns the pending focus request and clears it in the same call. */
  consumePendingFocusItemId: () => string | null;
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
  pendingFocusItemId: null,
  dismissedUpdateVersion: null,
} satisfies Partial<UiState>;

export const useUiStore = create<UiState>((set, get) => ({
  ...INITIAL_STATE,

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setDetailItemId: (id) => set({ detailItemId: id }),
  setDeleteTarget: (target) => set({ deleteTarget: target }),
  setActivePicker: (picker) => set({ activePicker: picker }),
  setQuickAddOpen: (open) => set({ quickAddOpen: open }),
  setActiveSessionId: (sessionId, storyId = null, initialLogOffset = null, initialStatus = null) =>
    set({
      activeSessionId: sessionId,
      activeSessionStoryId: storyId,
      activeSessionInitialLogOffset: initialLogOffset,
      activeSessionInitialStatus: initialStatus,
    }),
  setLaunchSheetStoryId: (storyId) => set({ launchSheetStoryId: storyId }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setFleetSurface: (target) =>
    set(target ? { fleetSurface: target, worktreeInventoryOpen: false } : { fleetSurface: null }),
  setWorktreeInventoryOpen: (open) =>
    set(open ? { worktreeInventoryOpen: true, fleetSurface: null } : { worktreeInventoryOpen: false }),
  setPendingFocusItemId: (id) => set({ pendingFocusItemId: id }),
  setDismissedUpdateVersion: (version) => set({ dismissedUpdateVersion: version }),
  consumePendingFocusItemId: () => {
    const id = get().pendingFocusItemId;
    if (id !== null) set({ pendingFocusItemId: null });
    return id;
  },
}));

/** Resets every UI field back to its initial value — the shared reset the test suites use. Zustand's
 * `setState` merges rather than replaces, so a hand-written reset that forgot a field would leak it
 * between tests; one exported reset removes that class of drift. */
export function resetUiState() {
  useUiStore.setState({ ...INITIAL_STATE });
}
