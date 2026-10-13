/**
 * Band-collapse state (01-UI-SPEC.md "Board list") — a **local UI preference**, never written to
 * the database (it is not board data). Held in Zustand, keyed per project so switching projects
 * does not leak one project's collapsed bands onto another.
 */
import { create } from "zustand";
import type { GroupingKey } from "../state/uiStore";

/**
 * The collapse key for one group within the active grouping key (D-07, A-02). A status band keeps
 * its bare status name; an epic (or the no-epic bucket, id `null`) is `epic:`-prefixed, so an epic
 * and a band that happen to share a name never share collapse state.
 */
export function groupCollapseKey(grouping: GroupingKey, id: string | null): string {
  return grouping === "status" ? (id as string) : `epic:${id ?? "none"}`;
}

interface CollapseState {
  collapsedByProject: Record<string, Record<string, boolean>>;
  /** Flips `status`'s collapsed value. `defaultCollapsed` is what an untouched group reads as —
   * a status band starts open, an epic starts closed (the roster is the home surface). */
  toggle: (projectId: string, status: string, defaultCollapsed?: boolean) => void;
  isCollapsed: (projectId: string, status: string) => boolean;
  /** Sets `status`'s collapsed value to `false` unconditionally — never a flip, unlike `toggle`.
   * The setter a caller uses when it needs a band GUARANTEED open rather than switched
   * (G-01-4, 01-19-PLAN.md Task 2): opening quick-add needs Backlog open so the row it inserts
   * there actually exists to be scrolled to and focused. Reusing `toggle` here would close an
   * already-open band on a second consecutive press — the exact bug `expand`'s idempotence
   * exists to avoid. */
  expand: (projectId: string, status: string) => void;
  /** `expand`'s mirror: sets `status`'s collapsed value to `true` unconditionally, so a Left key
   * pressed on an already-collapsed epic stays collapsed instead of flipping open (A-09). */
  collapse: (projectId: string, status: string) => void;
}

export const useCollapseStore = create<CollapseState>((set, get) => ({
  collapsedByProject: {},
  toggle: (projectId, status, defaultCollapsed = false) =>
    set((state) => {
      const forProject = state.collapsedByProject[projectId] ?? {};
      return {
        collapsedByProject: {
          ...state.collapsedByProject,
          [projectId]: { ...forProject, [status]: !(forProject[status] ?? defaultCollapsed) },
        },
      };
    }),
  isCollapsed: (projectId, status) => Boolean(get().collapsedByProject[projectId]?.[status]),
  expand: (projectId, status) =>
    set((state) => {
      const forProject = state.collapsedByProject[projectId] ?? {};
      return {
        collapsedByProject: {
          ...state.collapsedByProject,
          [projectId]: { ...forProject, [status]: false },
        },
      };
    }),
  collapse: (projectId, status) =>
    set((state) => {
      const forProject = state.collapsedByProject[projectId] ?? {};
      return {
        collapsedByProject: {
          ...state.collapsedByProject,
          [projectId]: { ...forProject, [status]: true },
        },
      };
    }),
}));
