import { useEffect } from "react";
import { fleetWatchRun } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";

/**
 * Tells the Rust core which agent run's session is the visible surface (FLEET-05, D-174), so it can
 * withhold the one banner for the session the user is already looking at.
 *
 * "Visible" follows `App.tsx`'s precedence chain: Settings, then triage, then review sit above the
 * session branch, and the fleet sits below it. So the session is the visible surface only when none
 * of the three is on top, and the fleet showing reports nothing, which is why a banner still fires
 * with the fleet open. The core, not this hook, reads whether the window is focused.
 */
export function useWatchedRun(): void {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const triageOpen = useUiStore((state) => state.triageSurfaceProjectId !== null);
  const reviewOpen = useUiStore((state) => state.reviewSurface !== null);
  const activeAgentRunId = useUiStore((state) => state.activeAgentRunId);
  const watched = settingsOpen || triageOpen || reviewOpen ? null : activeAgentRunId;

  useEffect(() => {
    Promise.resolve(fleetWatchRun(watched)).catch(() => {});
  }, [watched]);
}
