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
import { useUiStore } from "./uiStore";

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
  | "command-palette"
  | "session-surface"
  | "permission-card"
  | "proposal-tray"
  // D-103 (plan 06-07): the dedicated triage surface's own region — `ProposalRow`'s `region` prop
  // (plan 06-07 Task 1) is what lets the SAME row component act in either this region or the
  // tray's, so the two never fork into separate row implementations.
  | "triage-surface"
  // Phase 8 plan 08-01: the review surface's own region — `j`/`k` through its file list.
  | "review-surface";

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
  | "open-epic-picker"
  | "reorder-up"
  | "reorder-down"
  | "delete-item"
  // Agent actions (02-UI-SPEC.md "Keyboard Map Additions", AGNT-06). `answer-permission-*` are
  // deliberately NOT reachable from `board-list` — `bindingAllowedInLayer` below permits them only
  // in the `"permission-card"` layer (T-02-15).
  | "start-work"
  | "open-review"
  | "open-live-session"
  | "stop-session"
  | "toggle-raw-view"
  | "answer-permission-allow"
  | "answer-permission-deny"
  | "answer-permission-allow-always"
  | "open-settings"
  // D-84/D-88 (plan 05-02): start a fresh epic-authoring session. Command-palette-only in this
  // plan (no key binding yet), mirroring `create-issue`/`open-legend`'s own palette-only entries
  // above — the palette is the least invasive entry point and it re-enters the same
  // `dispatchAction` pipeline every other action uses.
  | "shape-epic"
  // D-91 (plan 05-10): reopen an existing epic's authoring session (SHAPE-05) — a `board-list`
  // binding, epic-row-only, mirroring `open-epic-picker`'s own row-kind refusal pattern (inverted:
  // refused on a TASK row rather than an epic row). Also reachable from `ItemDetailPanel.tsx`'s
  // own Continue Shaping section for the same reason `start-work`'s own button exists beside its
  // keyboard binding.
  | "continue-shaping"
  // D-88/D-90 (plan 05-03): the human-only stage-transition verbs. `advance-stage` is bound to a
  // real key in the `session-surface` region (below); `return-stage` is command-palette-only,
  // mirroring `shape-epic`'s own palette-only entry — neither is reachable from a tool call, which
  // is the whole point of D-90.
  | "advance-stage"
  | "return-stage"
  // D-92/D-95 (plan 05-07): the proposal tray's own per-row verbs, reusing the exact
  // `a`/`d`/`Shift+A` vocabulary the permission card already established (`answer-permission-*`
  // above) — the developer learns one set of answer keys for everything an agent asks of them.
  // `bindingAllowedInLayer` below scopes all four to the `"proposal-tray"` layer only.
  | "accept-proposal"
  | "reject-proposal"
  | "amend-proposal"
  | "accept-proposal-subtree"
  // D-101/D-102/D-104 (plan 06-07): the triage surface's own two new per-row verbs (merge, defer)
  // and its two bulk sweeps (bulk reject, bulk defer) — D-104's ONLY two batchable verbs. No id
  // here or anywhere else in this file means "accept many" or "accept all".
  | "merge-proposal"
  | "defer-proposal"
  | "reject-selected-proposals"
  | "defer-selected-proposals"
  // Phase 8 plan 08-01: expand/collapse the focused file in the review surface.
  | "expand-file"
  // Phase 8 plan 08-06: check the focused criterion against the selected diff lines (D-139).
  | "check-with-selection";

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
  // The four dimension pickers above took their own first letters, leaving `e` to estimate — so
  // the epic picker is bound to `m` for "move under" (the action, not the noun), the only free
  // mnemonic key left in the board-list region (G-01-EPIC-ASSIGN).
  { id: "open-epic-picker", region: "board-list", key: "m", label: "Set Epic" },
  { id: "reorder-up", region: "board-list", key: "ArrowUp", meta: true, label: "Reorder up" },
  { id: "reorder-down", region: "board-list", key: "ArrowDown", meta: true, label: "Reorder down" },
  { id: "delete-item", region: "board-list", key: "Backspace", meta: true, label: "Delete" },
  // `w`/`l` — neither collides with the nine letters above (`j k o c s p e a m`), verified at test
  // time from this table rather than restated (02-03-PLAN.md Task 3).
  { id: "start-work", region: "board-list", key: "w", label: "Start Work" },
  // D-133: `r` is taken, `v` is the free letter that reads as review. Deliberately NOT in
  // `REVIEW_SURFACE_ACTION_IDS` — it is dispatched from the board, so it must fall through to the
  // board clause of `bindingAllowedInLayer`.
  { id: "open-review", region: "board-list", key: "v", label: "Review" },
  { id: "open-live-session", region: "board-list", key: "l", label: "Open Live Session" },
  // `r` — free in this region (verified against every entry above, none of which claims it) and
  // the mnemonic for "reshape"/"reopen" (D-91, plan 05-10 Task 1). Epic-row-only, mirroring
  // `open-epic-picker`'s own row-kind guard above, inverted.
  { id: "continue-shaping", region: "board-list", key: "r", label: "Continue Shaping" },

  // ---- Live session surface (D-31) --------------------------------------------------------
  { id: "stop-session", region: "session-surface", key: ".", meta: true, label: "Stop Session" },
  { id: "toggle-raw-view", region: "session-surface", key: "r", label: "Toggle Raw View" },
  // D-88/D-90 (plan 05-03): `n` is free in this region — the global `Cmd+N` create-task binding
  // carries `meta`, and `resolveBinding` requires `Boolean(binding.meta) === event.metaKey`, so a
  // bare `n` here can never match that global entry regardless of scan order.
  { id: "advance-stage", region: "session-surface", key: "n", label: "Advance Authoring Stage" },

  // ---- Permission-request card (AGNT-06, D-37/D-38) — region-scoped so a bare `a`/`d` here
  // never collides with the board list's own `a` (assignee picker); `bindingAllowedInLayer` below
  // additionally restricts these to the card's own layer (T-02-15). Escape is deliberately NOT
  // bound here — see the Escape ladder below, and its own comment on why the card is excluded
  // entirely (T-02-16).
  { id: "answer-permission-allow", region: "permission-card", key: "a", label: "Allow" },
  { id: "answer-permission-deny", region: "permission-card", key: "d", label: "Deny" },
  {
    id: "answer-permission-allow-always",
    region: "permission-card",
    key: "a",
    shift: true,
    label: "Allow this tool for this project from now on",
  },

  // ---- Global (agent additions) -----------------------------------------------------------
  { id: "open-settings", region: "global", key: ",", meta: true, label: "Open Settings" },

  // ---- Proposal tray (D-92/D-95, plan 05-07) — region-scoped so `a`/`d`/`Shift+A` here reuse
  // the exact permission-card vocabulary without colliding with it (a different region namespace
  // entirely — `resolveBinding` matches on region, never on key alone). `e` is free in this
  // region and matches the board's own `open-estimate-picker` mnemonic only by letter, not by
  // region, which `resolveBinding` resolves correctly. `move-down`/`move-up` reuse the board
  // list's own ids rather than a second "move" vocabulary — `bindingAllowedInLayer` below grants
  // them an extra allowance under the `"proposal-tray"` layer alongside their existing
  // board/quick-add one.
  { id: "accept-proposal", region: "proposal-tray", key: "a", label: "Accept Proposal" },
  { id: "reject-proposal", region: "proposal-tray", key: "d", label: "Reject Proposal" },
  { id: "amend-proposal", region: "proposal-tray", key: "e", label: "Amend Proposal" },
  {
    id: "accept-proposal-subtree",
    region: "proposal-tray",
    key: "a",
    shift: true,
    label: "Accept Task and Its Criteria",
  },
  { id: "move-down", region: "proposal-tray", key: "j", label: "Move selection down" },
  { id: "move-down", region: "proposal-tray", key: "ArrowDown", label: "Move selection down" },
  { id: "move-up", region: "proposal-tray", key: "k", label: "Move selection up" },
  { id: "move-up", region: "proposal-tray", key: "ArrowUp", label: "Move selection up" },

  // ---- Triage surface (D-103, plan 06-07) — the dedicated triage view's own region. Reuses the
  // tray's exact accept/reject/amend vocabulary (same letter, same verb, D-92/D-95's own reasoning
  // extended here) plus two new per-row verbs (`m` merge, `z` defer, neither a free letter the tray
  // itself claims) and two new bulk sweeps (`Shift+D` reject-selected, `Shift+Z` defer-selected) —
  // D-104's only two batchable verbs. Deliberately NO binding anywhere in this region accepts more
  // than one proposal: accept stays per-row (or per-subtree, via the tray's own `accept-proposal-
  // subtree`, which this region does not bind a key to — mouse-only here, same as everywhere else).
  { id: "accept-proposal", region: "triage-surface", key: "a", label: "Accept Proposal" },
  { id: "reject-proposal", region: "triage-surface", key: "d", label: "Reject Proposal" },
  { id: "amend-proposal", region: "triage-surface", key: "e", label: "Amend Proposal" },
  { id: "merge-proposal", region: "triage-surface", key: "m", label: "Merge Proposal" },
  { id: "defer-proposal", region: "triage-surface", key: "z", label: "Defer Proposal" },
  { id: "move-down", region: "triage-surface", key: "j", label: "Move selection down" },
  { id: "move-down", region: "triage-surface", key: "ArrowDown", label: "Move selection down" },
  { id: "move-up", region: "triage-surface", key: "k", label: "Move selection up" },
  { id: "move-up", region: "triage-surface", key: "ArrowUp", label: "Move selection up" },
  {
    id: "reject-selected-proposals",
    region: "triage-surface",
    key: "d",
    shift: true,
    label: "Reject Selected Proposals",
  },
  {
    id: "defer-selected-proposals",
    region: "triage-surface",
    key: "z",
    shift: true,
    label: "Defer Selected Proposals",
  },

  // ---- Review surface (Phase 8 plan 08-01) — j/k through the changed-file list, Enter/Space to
  // expand the focused file. Escape pops the surface itself (handled by the surface component).
  { id: "move-down", region: "review-surface", key: "j", label: "Move selection down" },
  { id: "move-down", region: "review-surface", key: "ArrowDown", label: "Move selection down" },
  { id: "move-up", region: "review-surface", key: "k", label: "Move selection up" },
  { id: "move-up", region: "review-surface", key: "ArrowUp", label: "Move selection up" },
  { id: "expand-file", region: "review-surface", key: "Enter", label: "Expand file" },
  { id: "expand-file", region: "review-surface", key: " ", label: "Expand file" },
  // The check is the act of attestation (T-08-06-01): selecting lines alone never writes. The
  // row's own Space/Enter plain check stays untouched — two affordances, not one overloaded one.
  { id: "check-with-selection", region: "review-surface", key: "c", label: "Check criterion against selection" },

  // ---- Command-palette-only (no keystroke; CommandPalette.tsx's generator source) --------
  { id: "create-issue", region: "command-palette", label: "Create Issue" },
  { id: "open-legend", region: "command-palette", label: "Open Legend" },
  { id: "filter-status", region: "command-palette", label: "Filter by Status" },
  { id: "filter-epic", region: "command-palette", label: "Filter by Epic" },
  { id: "filter-assignee", region: "command-palette", label: "Filter by Assignee" },
  { id: "filter-priority", region: "command-palette", label: "Filter by Priority" },
  { id: "shape-epic", region: "command-palette", label: "Shape an Epic" },
  { id: "return-stage", region: "command-palette", label: "Return to Previous Authoring Stage" },
];

/** True when `target` is a live text-entry element (input/textarea/contentEditable) — the
 * ambiguity guard this plan's Task 1 requires: a bare (unmodified) key never fires a board action
 * while the user is typing. Modifier-bearing bindings (`⌘K`, `⌘N`, …) still fire regardless. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/** True when `target` sits inside a button, anchor or `role=button` element. `isTypingTarget` guards
 * *text entry*; this guards *activation*: Enter and Space belong to a focused interactive element
 * (the browser clicks it on keydown's default action), so a window-level binding must not claim
 * them — cancelling the keydown here is what made a confirm sheet's button unreachable by keyboard
 * (CR-03). Used only by `useRegionBindings`; `resolveBinding` stays unchanged because BoardView's
 * element-level handler wants Enter on its focused list container. */
function isActivationTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("button, a, [role='button']") !== null;
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

/** The TypeScript mirror of `src-tauri/src/main.rs`'s `FORWARDED_MENU_ACTIONS` — the exact five
 * ids `menu.rs` builds as custom native menu items and `on_menu_event` forwards over
 * `menu:action`. This is the set `state/menuSync.ts`'s `useMenuLayerSync` (01-16-PLAN.md Task 3)
 * drives native enable/disable state for, and the set `App.tsx`'s bridge re-enters
 * `dispatchAction`/`bindingAllowedInLayer` for exactly like a real keystroke (G-01-1, threat
 * T-01-02) — kept here, not re-declared in either consumer, so the two sides of the seam cannot
 * drift independently. `"open-settings"` is plan 02-10 Task 3's addition (D-39). */
export const MENU_ACTION_IDS: readonly ActionId[] = [
  "register-project",
  "create-task",
  "create-epic",
  "open-palette",
  "open-settings",
];

// -------------------------------------------------------------------------------------------
// The layer model (01-UI-SPEC.md "Focus & selection model", G-01-FOCUS): which overlay is
// topmost, and whether a given action id may fire under it. `useGlobalBindings` below and the
// board-list container's own key handler (`board/BoardView.tsx`) both read this, so "may this
// keystroke fire" is decided in exactly one place instead of once per consumer — G-01-FOCUS
// diagnosed five separate misfocus symptoms as five copies of a guard that never existed here.
// -------------------------------------------------------------------------------------------

/** The layers a keystroke can be "under" — `"picker"` covers every surface that either traps
 * focus or arms a one-keypress decision that isn't itself a Radix focus trap: a row-level picker,
 * the delete confirmation, and the Done warning (`DoneWarning.tsx` self-focuses and owns its own
 * Enter/Escape; a global shortcut moving focus away would silently disarm it — the same reasoning
 * that already exempts a real picker from the Escape ladder below).
 *
 * `"session-surface"`/`"permission-card"` are this plan's additions (02-UI-SPEC.md D-31/AGNT-06):
 * the live session surface and the permission-request card each get their own layer so
 * `bindingAllowedInLayer` can scope their actions the same way every other layer's actions are
 * scoped, rather than a special case. No component wires these layers into `topLayer` yet — that
 * is plans 02-07/02-08's job once the surfaces themselves exist; this plan only reserves the
 * vocabulary so `bindingAllowedInLayer` has somewhere correct to point a future caller. */
export type UiLayer =
  | "board"
  | "quick-add"
  | "detail"
  | "picker"
  | "palette"
  | "session-surface"
  | "permission-card"
  | "proposal-tray"
  // D-103 (plan 06-07): the triage surface's own layer — see `TRIAGE_SURFACE_ACTION_IDS` below.
  | "triage-surface"
  // Phase 8 plan 08-01: the review surface's own layer — its allow-list sits beside the triage one below.
  | "review-surface";

/** The four booleans every layer decision is made from. `EscapeLadderState` below extends this
 * with only `hasSelection` — the two are the same subject read two ways (which layer to CLOSE on
 * Escape vs. which layer is on TOP for every other binding). */
export interface LayerState {
  paletteOpen: boolean;
  detailOpen: boolean;
  pickerOpen: boolean;
  quickAddOpen: boolean;
}

/** The single topmost layer, in a fixed order — the same order the Escape ladder below already
 * closes in, since the palette renders over the detail panel, which renders over quick-add. */
export function topLayer(state: LayerState): UiLayer {
  if (state.paletteOpen) return "palette";
  if (state.pickerOpen) return "picker";
  if (state.detailOpen) return "detail";
  if (state.quickAddOpen) return "quick-add";
  return "board";
}

/** Whether `id` may fire while `layer` is on top. Exactly two rules. Rule one: `open-palette` is
 * the discoverability guarantee BOARD-07 rests on, so a trapped detail panel must never be able
 * to strand the user without it — allowed in every layer except `"picker"` (a real
 * picker/`DeleteConfirm`/`DoneWarning` already owns a single keypress of its own) and
 * `"palette"` itself. Rule two: every OTHER action id — global or board-list — is allowed only in
 * `"board"` and `"quick-add"`, the two layers that own no focus trap. Quick-add is permissive
 * here because it is an inline input inside the list, not a trapped scope — a bare letter typed
 * into it is separately suppressed by `resolveBinding`'s `isTypingTarget` check, which this
 * function does not touch. */
const SESSION_SURFACE_ACTION_IDS = new Set<ActionId>(["stop-session", "toggle-raw-view", "advance-stage"]);

const PERMISSION_CARD_ACTION_IDS = new Set<ActionId>([
  "answer-permission-allow",
  "answer-permission-deny",
  "answer-permission-allow-always",
]);

// T-05-07-02 (STRIDE, elevation of privilege): the tray's own four verbs must never fire outside
// its own layer, mirroring PERMISSION_CARD_ACTION_IDS' identical reasoning above.
const PROPOSAL_TRAY_ACTION_IDS = new Set<ActionId>([
  "accept-proposal",
  "reject-proposal",
  "amend-proposal",
  "accept-proposal-subtree",
]);

// `move-down`/`move-up` are shared with the board list's own ids (plan 05-07) rather than a
// second "move" vocabulary — this is the tray's own allowance for them, additive to the
// board/quick-add allowance the final `return` below already grants.
const TRAY_SELECTION_ACTION_IDS = new Set<ActionId>(["move-down", "move-up"]);

// D-103/D-104 (plan 06-07): the triage surface's own complete allow-list — the four verbs it
// shares with the tray (accept/reject/amend, reused by the SAME id so the same key means the same
// thing in both places) plus its own two new per-row verbs (merge, defer) and its own two bulk
// sweeps. This is checked as its OWN layer-first branch (below), never by widening
// `PROPOSAL_TRAY_ACTION_IDS`'s existing rule — that rule stays exactly `layer === "proposal-tray"`,
// unchanged for every id it already governed, so the tray's own keyboard tests keep asserting the
// same behaviour they always did.
const TRIAGE_SURFACE_ACTION_IDS = new Set<ActionId>([
  "accept-proposal",
  "reject-proposal",
  "amend-proposal",
  "merge-proposal",
  "defer-proposal",
  "reject-selected-proposals",
  "defer-selected-proposals",
]);

// Phase 8 plan 08-01: the review surface's complete allow-list. The movement ids are shared with
// the tray and triage sets, so the layer branch below answers from THIS set rather than falling
// through to the board clause.
const REVIEW_SURFACE_ACTION_IDS = new Set<ActionId>(["move-down", "move-up", "expand-file", "check-with-selection"]);

export function bindingAllowedInLayer(id: ActionId, layer: UiLayer): boolean {
  if (id === "open-palette") return layer !== "picker" && layer !== "palette";
  // T-02-15 (STRIDE, elevation of privilege): permission-answer bindings must never fire outside
  // the card's own layer — a stray `a`/`d` on the board must never approve or deny a tool call.
  if (PERMISSION_CARD_ACTION_IDS.has(id)) return layer === "permission-card";
  if (SESSION_SURFACE_ACTION_IDS.has(id)) return layer === "session-surface";
  // Checked BEFORE `PROPOSAL_TRAY_ACTION_IDS` below because three ids (accept/reject/amend-
  // proposal) are members of both sets — under the triage-surface layer this branch decides them;
  // under every other layer it is a no-op (its own condition is false) and the tray's own branch
  // decides them exactly as it always has.
  if (layer === "triage-surface") {
    return TRIAGE_SURFACE_ACTION_IDS.has(id) || TRAY_SELECTION_ACTION_IDS.has(id);
  }
  if (layer === "review-surface") return REVIEW_SURFACE_ACTION_IDS.has(id);
  // `expand-file` and `check-with-selection` are the review surface's alone (move-down/up are shared
  // with the board, so cannot be refused here); every other layer must refuse them rather than fall
  // through to the board clause.
  if (id === "expand-file" || id === "check-with-selection") return false;
  if (PROPOSAL_TRAY_ACTION_IDS.has(id)) return layer === "proposal-tray";
  if (layer === "proposal-tray") return TRAY_SELECTION_ACTION_IDS.has(id);
  return layer === "board" || layer === "quick-add";
}

/** The six raw store fields the layer stack is built from — `layerStateFromStoreFields` below is
 * the one place this shape is mapped into a `LayerState`, shared by `currentLayerState` (a
 * one-shot `getState()` read, no subscription) and `useTopLayer` (a live-subscribing hook,
 * 01-16-PLAN.md Task 3) so the field list exists exactly once. */
interface RawLayerFields {
  paletteOpen: boolean;
  detailItemId: string | null;
  activePicker: unknown;
  deleteTarget: unknown;
  pendingDone: unknown;
  quickAddOpen: boolean;
}

/** Maps the store's raw fields to a `LayerState`. `pickerOpen` is true while ANY of the row-level
 * pickers, the delete confirmation, or the Done warning is open (see `UiLayer`'s doc comment on
 * `"picker"`). */
function layerStateFromStoreFields(fields: RawLayerFields): LayerState {
  return {
    paletteOpen: fields.paletteOpen,
    detailOpen: fields.detailItemId !== null,
    pickerOpen: fields.activePicker !== null || fields.deleteTarget !== null || fields.pendingDone !== null,
    quickAddOpen: fields.quickAddOpen,
  };
}

/** The one place this module touches the store via a one-shot read — used by `useGlobalBindings`,
 * which reads the layer stack fresh at keystroke time rather than from a subscribed value. No
 * import cycle: `uiStore.ts` imports only a type from `board/useBoardQuery`, and nothing imports
 * this module from either. */
function currentLayerState(): LayerState {
  return layerStateFromStoreFields(useUiStore.getState());
}

/** Live-subscribing counterpart of `currentLayerState` — `state/menuSync.ts`'s
 * `useMenuLayerSync` (01-16-PLAN.md Task 3) reads this to drive the native menu bar's enable/
 * disable state. Subscribes to the same six store fields and returns `topLayer(...)` of them as
 * a single `UiLayer` string: returning a primitive keeps the selector's result referentially
 * stable across renders that do not change the top layer, so it does not re-fire consumers on
 * every unrelated store write (e.g. a filter or search-term change). */
export function useTopLayer(): UiLayer {
  return useUiStore((state) =>
    topLayer(
      layerStateFromStoreFields({
        paletteOpen: state.paletteOpen,
        detailItemId: state.detailItemId,
        activePicker: state.activePicker,
        deleteTarget: state.deleteTarget,
        pendingDone: state.pendingDone,
        quickAddOpen: state.quickAddOpen,
      }),
    ),
  );
}

/** The move a region-changing action makes before it runs: closes the palette and the detail
 * panel so the surface it is about to open is the only focus owner (01-UI-SPEC.md "exactly one
 * focus owner at a time"). `board/CommandPalette.tsx`'s region-changing commands and `App.tsx`'s
 * native-menu bridge both call this before dispatching. */
export function returnToBoardLayer(): void {
  useUiStore.getState().setPaletteOpen(false);
  useUiStore.getState().setDetailItemId(null);
}

// -------------------------------------------------------------------------------------------
// The Escape ladder (01-UI-SPEC.md "Focus & selection model", 01-09-PLAN.md Task 1): exactly one
// layer closes per press, in a fixed order — command palette, then item detail panel, then
// quick-add, then clear selection. A press with nothing open and nothing selected is a no-op.
// -------------------------------------------------------------------------------------------

// The permission-request card (AGNT-06, D-37/D-38, T-02-16) is DELIBERATELY excluded from
// `EscapeLayer` — no member here represents it, and no field on `EscapeLadderState` can express
// "a card is pending" reaching this ladder. This is intentional, not an omission: dismissing a
// pending permission card without answering it would hide the blocked state rather than resolve
// it, so the agent must stay blocked until one of the card's own three actions (Allow/Deny/
// Allow-always) fires. Every other overlay in this product (palette, detail, quick-add, and now
// the session surface below) closes on Escape; the permission card is the one deliberate
// deviation from that pattern in the whole product.
export type EscapeLayer = "palette" | "session-surface" | "detail" | "quick-add" | "selection";

export interface EscapeLadderState extends LayerState {
  hasSelection: boolean;
  /** True while the live session surface (D-31) is open. Optional because no component sets it
   * yet — plans 02-07/02-08 wire the surface itself; this ladder is ready for it now so that
   * wiring only needs to supply the field, not touch this function. */
  sessionSurfaceOpen?: boolean;
}

/** Pure — the caller applies whatever state change closing the returned layer implies. Escape
 * from the session surface returns to the board with focus restored to the task's row (D-31),
 * ranked directly under the palette since the surface replaces the board's own content area —
 * the item detail panel it would otherwise rank against is not simultaneously open. */
export function nextEscapeLayer(state: EscapeLadderState): EscapeLayer | null {
  if (state.pickerOpen) return null;
  if (state.paletteOpen) return "palette";
  if (state.sessionSurfaceOpen) return "session-surface";
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
// actual `keydown` listener, the key-matching decision (`resolveBinding`), AND the layer-gate
// decision (`bindingAllowedInLayer`/`topLayer`, above) — so no caller ever writes its own
// `event.key === '...'` check OR its own detail-panel guard (Task 1's own acceptance criterion,
// extended here to every consumer of a `"global"`-region binding, not only the board-list
// container). This is the single place "may this fire" is decided; G-01-FOCUS's five separate
// misfocus symptoms were five copies of a guard that never existed here.
// -------------------------------------------------------------------------------------------

export function useGlobalBindings(handlers: Partial<Record<ActionId, (binding: Binding) => void>>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const binding = resolveGlobalBinding(event);
      if (!binding) return;
      // Read the layer state at keystroke time, never from this effect's closure — a `window`
      // listener registered once must see the layer stack as it is NOW, not as it was when the
      // effect last ran.
      if (!bindingAllowedInLayer(binding.id, topLayer(currentLayerState()))) return;
      const handler = handlers[binding.id];
      if (!handler) return;
      event.preventDefault();
      handler(binding);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

// -------------------------------------------------------------------------------------------
// Region-scoped bindings hook (AGNT-06, plan 02-06 Task 1) — `useGlobalBindings`'s
// `resolveGlobalBinding` only ever matches `"global"`-region bindings by design, so it cannot
// serve a REGION-owned surface like the permission-request card, whose three `answer-permission-*`
// actions live in the `"permission-card"` region (`BINDINGS` above) and are gated to the
// `"permission-card"` `UiLayer` (`bindingAllowedInLayer`). This is that surface's own hook: the
// `window`-level listener lives HERE, in this module, not inside the region-owning component —
// which is what lets a component register its keys with no `onKeyDown` prop and no
// `addEventListener` call of its own (T-02-16's whole point for the permission card: no local key
// or dismissal handler that could let a pending request be closed without an answer).
// -------------------------------------------------------------------------------------------

export function useRegionBindings(
  region: FocusRegion,
  layer: UiLayer,
  handlers: Partial<Record<ActionId, (binding: Binding) => void>>,
) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const binding = resolveBinding(event, region);
      if (!binding) return;
      // Before preventDefault: a focused button keeps its own Enter/Space activation (CR-03).
      if ((event.key === "Enter" || event.key === " ") && isActivationTarget(event.target)) return;
      if (!bindingAllowedInLayer(binding.id, layer)) return;
      const handler = handlers[binding.id];
      if (!handler) return;
      event.preventDefault();
      handler(binding);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [region, layer, handlers]);
}
