/**
 * The single binding table and focus-region model every keyboard-driven surface reads from
 * (01-UI-SPEC.md "Keyboard Map", BOARD-07). This is the ONLY module that maps a key to a board
 * action — no other component hand-rolls its own `event.key === '...'` switch. It consolidates
 * keystrokes already wired ad hoc in `01-04` (`s`, Enter/`o`), `01-07` (`p`/`e`/`a`, `⌘↑`/`⌘↓`)
 * and `01-08` (`⌘F`/`/`) into one table, and adds the remaining global bindings (`⌘K`, `⌘1`-`⌘9`,
 * `⌘⇧O`, `⌘N`, `⌘⇧N`, `⌘⌫`, `c`, Home/End) this plan introduces.
 *
 * Escape is deliberately NOT a table entry here — it is governed by the fixed-order layer ladder
 * (`nextEscapeLayer` below), never by a per-region binding, so "close the top-most open layer"
 * stays one decision made in one place regardless of which region currently owns focus.
 */
import { useEffect } from "react";

/** Exactly one focus owner at a time (01-UI-SPEC.md "Focus & selection model"). Not every region
 * below has an entry in `BINDINGS` yet — quick-add, item detail and search already own small,
 * already-tested local key handlers of their own (Enter/Escape to compose, Tab between fields,
 * plain typing) that this plan does not re-route through the shared table; the enumeration exists
 * so every surface agrees on the model even where a region's own component still owns its keys. */
export type FocusRegion =
  | "project-rail"
  | "search"
  | "board-list"
  | "quick-add"
  | "item-detail"
  | "command-palette";

/** Every board action reachable from the keyboard, the palette, or (menu.rs) the native menu.
 * `create-issue`/`open-legend`/`filter-status`/`filter-epic`/`filter-assignee`/`filter-priority`
 * carry no key binding in Phase 1 (palette/menu-only) — see the `command-palette`-region entries
 * below, which exist purely so `CommandPalette.tsx` can generate their command-list entry from
 * this one table too, per its own acceptance criterion ("no hand-written array of command
 * labels"). */
export type ActionId =
  | "open-palette"
  | "switch-project"
  | "focus-search"
  | "register-project"
  | "create-task"
  | "create-epic"
  | "create-issue"
  | "open-legend"
  | "filter-status"
  | "filter-epic"
  | "filter-assignee"
  | "filter-priority"
  | "move-down"
  | "move-up"
  | "select-first"
  | "select-last"
  | "open-detail"
  | "open-status-picker"
  | "open-priority-picker"
  | "open-estimate-picker"
  | "open-assignee-picker"
  | "reorder-up"
  | "reorder-down"
  | "delete-item";

export interface Binding {
  id: ActionId;
  region: FocusRegion | "global";
  /** Absent on the palette/menu-only entries above — those never participate in real keydown
   * matching (`resolveBinding` only ever looks up `"global"`/`"board-list"` regions from a live
   * event; `"command-palette"`-region entries exist solely for `CommandPalette.tsx`'s generator). */
  key?: string;
  meta?: boolean;
  shift?: boolean;
  /** The printed command label — both the palette and (indirectly, via the same source) the menu
   * bar draw from this so a label can never drift between the two surfaces. */
  label: string;
  /** `⌘1`..`⌘9`'s 0-indexed project slot — present only on `switch-project` bindings. */
  projectIndex?: number;
}

export const BINDINGS: Binding[] = [
  // ---- Global (anywhere in the app) ------------------------------------------------------
  { id: "open-palette", region: "global", key: "k", meta: true, label: "Open command palette" },
  { id: "focus-search", region: "global", key: "f", meta: true, label: "Search Board" },
  { id: "focus-search", region: "global", key: "/", label: "Search Board" },
  {
    id: "register-project",
    region: "global",
    key: "o",
    meta: true,
    shift: true,
    label: "Register Project…",
  },
  { id: "create-task", region: "global", key: "n", meta: true, label: "Create Task" },
  { id: "create-epic", region: "global", key: "n", meta: true, shift: true, label: "Create Epic" },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: "switch-project" as const,
    region: "global" as const,
    key: String(index + 1),
    meta: true,
    label: `Go to project ${index + 1}`,
    projectIndex: index,
  })),

  // ---- Board list (focus in the list, no text field focused) -----------------------------
  { id: "move-down", region: "board-list", key: "j", label: "Move selection down" },
  { id: "move-down", region: "board-list", key: "ArrowDown", label: "Move selection down" },
  { id: "move-up", region: "board-list", key: "k", label: "Move selection up" },
  { id: "move-up", region: "board-list", key: "ArrowUp", label: "Move selection up" },
  { id: "select-first", region: "board-list", key: "Home", label: "Jump to first row" },
  { id: "select-last", region: "board-list", key: "End", label: "Jump to last row" },
  { id: "open-detail", region: "board-list", key: "Enter", label: "Open selected item" },
  { id: "open-detail", region: "board-list", key: "o", label: "Open selected item" },
  { id: "create-task", region: "board-list", key: "c", label: "Create Task" },
  { id: "open-status-picker", region: "board-list", key: "s", label: "Set Status" },
  { id: "open-priority-picker", region: "board-list", key: "p", label: "Set Priority" },
  { id: "open-estimate-picker", region: "board-list", key: "e", label: "Set Estimate" },
  { id: "open-assignee-picker", region: "board-list", key: "a", label: "Set Assignee" },
  { id: "reorder-up", region: "board-list", key: "ArrowUp", meta: true, label: "Reorder up" },
  { id: "reorder-down", region: "board-list", key: "ArrowDown", meta: true, label: "Reorder down" },
  { id: "delete-item", region: "board-list", key: "Backspace", meta: true, label: "Delete" },

  // ---- Command-palette-only (no keystroke; CommandPalette.tsx's generator source) --------
  { id: "create-issue", region: "command-palette", label: "Create Issue" },
  { id: "open-legend", region: "command-palette", label: "Open Legend" },
  { id: "filter-status", region: "command-palette", label: "Filter by Status" },
  { id: "filter-epic", region: "command-palette", label: "Filter by Epic" },
  { id: "filter-assignee", region: "command-palette", label: "Filter by Assignee" },
  { id: "filter-priority", region: "command-palette", label: "Filter by Priority" },
];

/** True when `target` is a live text-entry element (input/textarea/contentEditable) — the
 * ambiguity guard this plan's Task 1 requires: a bare (unmodified) key never fires a board action
 * while the user is typing. Modifier-bearing bindings (`⌘K`, `⌘N`, …) still fire regardless. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function keyMatches(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey">,
  binding: Binding,
): boolean {
  if (!binding.key || binding.key !== event.key) return false;
  if (Boolean(binding.meta) !== event.metaKey) return false;
  if (Boolean(binding.shift) !== event.shiftKey) return false;
  return true;
}

/**
 * Maps a raw keydown event to the one `Binding` it activates in `region`, or `undefined` if none
 * applies. `"global"`-region bindings match regardless of the `region` the caller passes — a
 * container-level handler can request `"board-list"` and still resolve `⌘K`. Returns `undefined`
 * — never throws — for a bare (unmodified) key while the event's real target is a text field,
 * even when the caller believes it owns `region`: a container-level handler can receive a bubbled
 * event from a nested `<input>` (e.g. the quick-add title field renders inside the board-list
 * container), and this is the one place that ambiguity is settled.
 */
export function resolveBinding(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "target">,
  region: FocusRegion,
): Binding | undefined {
  const typing = isTypingTarget(event.target as EventTarget | null);
  for (const binding of BINDINGS) {
    if (!keyMatches(event, binding)) continue;
    if (binding.region !== "global" && binding.region !== region) continue;
    if (typing && !event.metaKey) continue;
    return binding;
  }
  return undefined;
}

/**
 * Like `resolveBinding`, but only ever matches `"global"`-region bindings — the lookup
 * `useGlobalBindings` (below) needs, since a `window`-level listener has no board-list/quick-add/
 * item-detail *region* of its own and must never accidentally pick up a board-list binding (`j`,
 * `s`, …) that happens to share a bare key with nothing in particular.
 */
function resolveGlobalBinding(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "target">,
): Binding | undefined {
  const typing = isTypingTarget(event.target as EventTarget | null);
  for (const binding of BINDINGS) {
    if (binding.region !== "global") continue;
    if (!keyMatches(event, binding)) continue;
    if (typing && !event.metaKey) continue;
    return binding;
  }
  return undefined;
}

/** Every unique action id declared anywhere in `BINDINGS`, in first-declaration order —
 * `CommandPalette.tsx`'s generator source for the fixed (non-runtime) part of its command list.
 * `"switch-project"` is deliberately excluded: it expands to one command per *registered*
 * project (a runtime list, generated separately), never a single generic entry. */
export function allActionIds(): ActionId[] {
  const seen = new Set<ActionId>();
  const out: ActionId[] = [];
  for (const binding of BINDINGS) {
    if (binding.id === "switch-project") continue;
    if (seen.has(binding.id)) continue;
    seen.add(binding.id);
    out.push(binding.id);
  }
  return out;
}

/** Every unique board-list action id, in first-declaration order — the set Task 2's own
 * acceptance criterion measures the palette against ("every action in the board-list binding
 * table has a corresponding palette entry"). */
export function boardListActionIds(): ActionId[] {
  const seen = new Set<ActionId>();
  const out: ActionId[] = [];
  for (const binding of BINDINGS) {
    if (binding.region !== "board-list") continue;
    if (seen.has(binding.id)) continue;
    seen.add(binding.id);
    out.push(binding.id);
  }
  return out;
}

/** The printed label for an action id — the first `BINDINGS` entry declaring it wins (multiple
 * keys mapping to the same id, e.g. `j`/`ArrowDown`, always share one label). */
export function actionLabel(id: ActionId): string {
  return BINDINGS.find((b) => b.id === id)?.label ?? id;
}

// -------------------------------------------------------------------------------------------
// The Escape ladder (01-UI-SPEC.md "Focus & selection model", this plan's Task 1): exactly one
// layer closes per press, in a fixed order — command palette, then item detail panel, then
// quick-add, then clear selection. A press with nothing open and nothing selected is a no-op.
// -------------------------------------------------------------------------------------------

export type EscapeLayer = "palette" | "detail" | "quick-add" | "selection";

export interface EscapeLadderState {
  paletteOpen: boolean;
  detailOpen: boolean;
  quickAddOpen: boolean;
  /** A row-level picker (status/priority/estimate/assignee) is not one of the four named layers
   * — it already owns its own Escape via its Radix `DismissableLayer` (`pickers/StatusPicker.tsx`
   * and its siblings), so the ladder steps aside entirely (`null`) while one is open rather than
   * racing it for the same keystroke. */
  pickerOpen: boolean;
  hasSelection: boolean;
}

/** Pure — the caller applies whatever state change closing the returned layer implies. */
export function nextEscapeLayer(state: EscapeLadderState): EscapeLayer | null {
  if (state.pickerOpen) return null;
  if (state.paletteOpen) return "palette";
  if (state.detailOpen) return "detail";
  if (state.quickAddOpen) return "quick-add";
  if (state.hasSelection) return "selection";
  return null;
}

// -------------------------------------------------------------------------------------------
// Selection movement — the one implementation `BoardView.tsx` (keyboard-driven) and
// `CommandPalette.tsx` (palette-issued "Move selection down"/"Jump to first row" commands) both
// call, so "what does moving mean" is never derived twice.
// -------------------------------------------------------------------------------------------

/** Moves `delta` positions from `currentId` within `items` (in their given order), clamped to the
 * list's bounds. With no current selection, a positive delta lands on the first item and a
 * negative delta on the last — mirroring `Home`/`End`'s own boundary behavior. Returns `null` for
 * an empty list — the caller's no-op case (01-UI-SPEC.md: navigation on an empty board must not
 * throw and must not move focus out of the list region). */
export function nextSelectionId<T extends { id: string }>(
  items: T[],
  currentId: string | null,
  delta: number,
): string | null {
  if (items.length === 0) return null;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const nextIndex =
    currentIndex === -1
      ? delta > 0
        ? 0
        : items.length - 1
      : Math.min(Math.max(currentIndex + delta, 0), items.length - 1);
  return items[nextIndex]?.id ?? null;
}

/** `Home`/`End` — jumps to the first/last item, or `null` for an empty list. */
export function boundarySelectionId<T extends { id: string }>(
  items: T[],
  edge: "first" | "last",
): string | null {
  if (items.length === 0) return null;
  return edge === "first" ? items[0].id : items[items.length - 1].id;
}

// -------------------------------------------------------------------------------------------
// Synthetic dispatch — for the two callers that need to trigger a `"global"`-region action
// without a real keydown ever having happened: `CommandPalette.tsx` executing a selected
// command, and `App.tsx`'s listener translating a native menu click (`menu.rs`'s `on_menu_event`)
// into the same action. Both re-enter the exact same `resolveBinding`/`useGlobalBindings` path a
// real keystroke would, rather than duplicating what each action "does" a third time.
// -------------------------------------------------------------------------------------------

export function dispatchAction(id: ActionId, opts?: { projectIndex?: number }): boolean {
  const binding = BINDINGS.find(
    (b) =>
      b.region === "global" &&
      b.id === id &&
      (opts?.projectIndex === undefined || b.projectIndex === opts.projectIndex),
  );
  if (!binding?.key) return false;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: binding.key,
      metaKey: Boolean(binding.meta),
      shiftKey: Boolean(binding.shift),
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

// -------------------------------------------------------------------------------------------
// Global bindings hook — any component supplies handlers keyed by action id; this hook owns the
// actual `keydown` listener and the key-matching decision (`resolveBinding`), so no caller ever
// writes its own `event.key === '...'` check (Task 1's own acceptance criterion, extended here to
// every consumer of a `"global"`-region binding, not only the board-list container).
// -------------------------------------------------------------------------------------------

export function useGlobalBindings(handlers: Partial<Record<ActionId, (binding: Binding) => void>>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const binding = resolveGlobalBinding(event);
      if (!binding) return;
      const handler = handlers[binding.id];
      if (!handler) return;
      event.preventDefault();
      handler(binding);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
