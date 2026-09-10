/**
 * Band-collapse state (01-UI-SPEC.md "Board list") — a **local UI preference**, never written to
 * the database (it is not board data). Held in Zustand, keyed per project so switching projects
 * does not leak one project's collapsed bands onto another.
 */
import { create } from "zustand";

interface CollapseState {
  collapsedByProject: Record<string, Record<string, boolean>>;
  toggle: (projectId: string, status: string) => void;
  isCollapsed: (projectId: string, status: string) => boolean;
  /** Sets `status`'s collapsed value to `false` unconditionally — never a flip, unlike `toggle`.
   * The setter a caller uses when it needs a band GUARANTEED open rather than switched
   * (G-01-4, 01-19-PLAN.md Task 2): opening quick-add needs Backlog open so the row it inserts
   * there actually exists to be scrolled to and focused. Reusing `toggle` here would close an
   * already-open band on a second consecutive press — the exact bug `expand`'s idempotence
   * exists to avoid. */
  expand: (projectId: string, status: string) => void;
}

export const useCollapseStore = create<CollapseState>((set, get) => ({
  collapsedByProject: {},
  toggle: (projectId, status) =>
    set((state) => {
      const forProject = state.collapsedByProject[projectId] ?? {};
      return {
        collapsedByProject: {
          ...state.collapsedByProject,
          [projectId]: { ...forProject, [status]: !forProject[status] },
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
}));
