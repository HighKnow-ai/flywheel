/**
 * Pushes the renderer's layer verdict onto the native menu bar (01-16-PLAN.md Task 3, UAT gap
 * G-01-1's affordance half). `useTopLayer()` (`state/keyboard.ts`) is read here, and for each id
 * in `MENU_ACTION_IDS` the same `bindingAllowedInLayer(id, layer)` call every keystroke already
 * goes through decides whether that item should be enabled — this hook holds no second copy of
 * that policy, it only mirrors the verdict onto `menu_set_action_enabled`
 * (`src-tauri/src/commands/menu.rs`) through the one seam the renderer may call Tauri through
 * (`adapters/tauri.ts`'s `invokeCommand`).
 *
 * This is NOT the enforcement point. `useGlobalBindings` (`state/keyboard.ts`, unchanged) still
 * refuses a dispatched id regardless of what this hook has pushed — the push below is
 * asynchronous, so a keystroke that beats the round trip is still refused by the guard, exactly
 * as G-01-1's fix (Task 1) requires. What this hook changes is only what the native menu bar
 * LOOKS like: a disabled `MenuItem` greys out and macOS stops firing its key equivalent, so a
 * trapped layer (the item detail panel, a row-level picker, the palette) no longer leaves a menu
 * item enabled-but-dead the way the pre-fix bridge did.
 */
import { useEffect, useRef } from "react";
import { invokeCommand } from "../adapters/tauri";
import { bindingAllowedInLayer, MENU_ACTION_IDS, useTopLayer } from "./keyboard";

export function useMenuLayerSync(): void {
  const layer = useTopLayer();
  // The last verdict actually pushed per id. Compared against on every layer change so the push
  // is delta-only (one round trip per CHANGED id, never one per store write) — a layer change
  // that does not alter any id's verdict (e.g. board <-> quick-add, which permit the identical
  // set) issues no calls at all.
  const pushedRef = useRef<Partial<Record<string, boolean>>>({});

  useEffect(() => {
    for (const actionId of MENU_ACTION_IDS) {
      const enabled = bindingAllowedInLayer(actionId, layer);
      if (pushedRef.current[actionId] === enabled) continue;
      pushedRef.current[actionId] = enabled;
      invokeCommand<void>("menu_set_action_enabled", { actionId, enabled }).catch(() => {
        // No native menu attached (a non-macOS host today, or a future relay-backed web
        // surface), or the IPC call itself failed. Either way the guard still enforces
        // everything — this hook only affects the affordance — so this is degrade, not crash.
        // Clearing the cached verdict makes the next layer change retry rather than leaving a
        // real native menu (if one exists) stuck on a state that was never actually applied.
        delete pushedRef.current[actionId];
      });
    }
  }, [layer]);
}
