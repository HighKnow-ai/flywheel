/**
 * Whether the triage drawer is open, and at which Epic (issue #162). UI state, so Zustand: the Needs-you
 * Proposals row's Triage and each Epic row's "n Proposals" marker open it, and the board mounts it once.
 */
import { create } from "zustand";

interface TriageDrawerState {
  /** The project whose drawer is open, or `null` when it is closed. */
  projectId: string | null;
  /** The Epic whose group to bring into view on opening; `null` opens at the top. */
  epicId: string | null;
  openTriage: (projectId: string, epicId?: string | null) => void;
  closeTriage: () => void;
}

export const useTriageDrawer = create<TriageDrawerState>((set) => ({
  projectId: null,
  epicId: null,
  openTriage: (projectId, epicId = null) => set({ projectId, epicId }),
  closeTriage: () => set({ projectId: null, epicId: null }),
}));
