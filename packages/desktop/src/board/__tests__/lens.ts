/**
 * The rack opens on the epic roster (08.1 amendment A-01); the long-standing board cases are about
 * the five status bands. Call this after `resetUiState()` to put the rack on the status lens.
 */
import { useUiStore } from "../../state/uiStore";

export function showStatusBands(): void {
  useUiStore.getState().setGroupingKey("status");
}
