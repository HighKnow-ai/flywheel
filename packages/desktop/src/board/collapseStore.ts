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
}));
