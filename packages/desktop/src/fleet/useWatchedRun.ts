import { useEffect } from "react";
import { fleetWatchRun } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";

/**
 * Tells the Rust core which agent run's session is the visible surface (FLEET-05, D-174), so it can
 * withhold the one banner for the session the user is already looking at.
 *
 * "Visible" follows `App.tsx`'s precedence chain: Settings sits above the session branch, and the
 * fleet sits below it. So the session is the visible surface only when Settings is not on top, and
 * the fleet showing reports nothing, which is why a banner still fires with the fleet open. The
 * core, not this hook, reads whether the window is focused.
 */
export function useWatchedRun(): void {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const watched = settingsOpen ? null : activeSessionId;

  useEffect(() => {
    Promise.resolve(fleetWatchRun(watched)).catch(() => {});
  }, [watched]);
}
