/**
 * The `⌘K` command palette (01-UI-SPEC.md "Command palette", D-02) — the discoverable escape
 * hatch every board action is reachable through, so `BOARD-07` coverage never depends on having
 * memorised a single-letter binding. Opens over whatever surface currently has focus, fuzzy-
 * filters as the user types, moves selection with the arrow keys, executes on Enter, and closes
 * on Escape restoring focus to the triggering element (Radix `FocusScope`'s default unmount-
 * restore behavior — the same pattern `pickers/StatusPicker.tsx` already established).
 *
 * Mounted once, at the app-shell level (`App.tsx`), so it works on every screen — including
 * `FirstRun` (zero projects registered), where "Register Project…" is still the one live command.
 *
 * The command list is GENERATED, never hand-typed (Task 2's own acceptance criterion): the fixed
 * part comes from `state/keyboard.ts`'s `allActionIds()`/`actionLabel()` (the same table
 * `BoardView.tsx` reads for real keystrokes — an action cannot exist in one surface and not the
 * other), and the runtime parts — one "Go to Project" entry per registered project, and the hot
 * actions on the currently selected item — are generated from `useProjects()`/`useBoardQuery()`
 * each render. `switch-project` is excluded from the fixed generator entirely; it only ever
 * appears as the per-project runtime entries below.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { Legend } from "../legend/Legend";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "../projects/RegisterProjectFlow";
import { StatusPicker } from "./pickers/StatusPicker";
import { PriorityPicker } from "./pickers/PriorityPicker";
import { EstimatePicker } from "./pickers/EstimatePicker";
import { AssigneePicker } from "./pickers/AssigneePicker";
import { ParentPicker, type ParentOption } from "./pickers/ParentPicker";
import {
  allActionIds,
  actionLabel,
  boundarySelectionId,
  dispatchAction,
  nextSelectionId,
  returnToBoardLayer,
  useGlobalBindings,
  type ActionId,
} from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import {
  continueShapingEpic,
  openLiveSessionForTask,
  startAuthoringSessionForProject,
  useActors,
  useBoardQuery,
  useCreateIssue,
  useGitIdentifier as useIdentityLookup,
  useProjects,
  useReorderItem,
  useSetAssignee,
  useSetEstimate,
  useSetPriority,
  useSetStatus,
  useSetTaskEpic,
} from "./useBoardQuery";
import { authoringStageReturn } from "../adapters/tauri";
import { previousAuthoringStage } from "../session/SessionSurface";

/** Board-list action ids whose palette command opens its OWN overlay (a picker, or the delete
 * confirmation via `BoardView.tsx`'s `deleteTarget` in `uiStore`) rather than completing
 * instantly — these must not also close the palette itself when selected. */
const OVERLAY_ACTION_IDS = new Set<ActionId>([
  "open-status-picker",
  "open-priority-picker",
  "open-estimate-picker",
  "open-assignee-picker",
  "open-epic-picker",
  "delete-item",
]);

/** Board-list action ids that are meaningful with no current selection (they act on the LIST,
 * not the selected item) — every other board-list action's palette command is disabled without
 * one. */
const SELECTION_INDEPENDENT_ACTION_IDS = new Set<ActionId>([
  "move-down",
  "move-up",
  "select-first",
  "select-last",
]);

/** Board-list action ids that only apply to a task, never an epic — the fixed three-level
 * hierarchy gives an epic no epic parent of its own (G-01-EPIC-ASSIGN). The palette disables
 * these when an epic is selected, in addition to the no-selection case above. */
const TASK_ONLY_ACTION_IDS = new Set<ActionId>(["open-epic-picker"]);

/** Board-list action ids that only apply to an epic, never a task (D-91, plan 05-10) — the
 * inverse of `TASK_ONLY_ACTION_IDS` above. The palette disables these when a task is selected. */
const EPIC_ONLY_ACTION_IDS = new Set<ActionId>(["continue-shaping"]);

interface Command {
  id: string;
  label: string;
  group: string;
  run: () => void;
  disabled?: boolean;
}

/** Case-insensitive substring match, falling back to an in-order-subsequence match — cheap
 * "fuzzy" filtering (01-UI-SPEC.md "Command palette": "fuzzy-filters as the user types") without
 * pulling in a scoring library for a command list this small. */
function fuzzyMatches(query: string, label: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (l.includes(q)) return true;
  let qi = 0;
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) qi++;
  }
  return qi === q.length;
}

function focusFirstChildButton(id: string) {
  document.getElementById(id)?.querySelector("button")?.focus();
}

type PaletteOverlay = "status" | "priority" | "estimate" | "assignee" | "epic" | "legend" | null;

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const currentProjectId = useUiStore((state) => state.currentProjectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const selectedItemId = useUiStore((state) => state.selectedItemId);
  const setSelectedItemId = useUiStore((state) => state.setSelectedItemId);
  const setDetailItemId = useUiStore((state) => state.setDetailItemId);
  const setDeleteTarget = useUiStore((state) => state.setDeleteTarget);
  // D-90 (plan 05-03): the `return-stage` palette entry's own gate — disabled unless the CURRENT
  // session (if any) is an authoring run with somewhere earlier to return to.
  const activeAgentRunId = useUiStore((state) => state.activeAgentRunId);
  const activeAgentRunAuthoringStage = useUiStore((state) => state.activeAgentRunAuthoringStage);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [overlay, setOverlay] = useState<PaletteOverlay>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const effectiveProjectId = currentProjectId ?? projects[0]?.id;

  // `enabled` (inside `useBoardQuery`) stays false while the palette is closed, so mounting this
  // component once at the app shell never issues a background query nobody is looking at.
  const boardQuery = useBoardQuery(open ? effectiveProjectId : undefined);
  const items = boardQuery.data?.items ?? [];
  const actorsQuery = useActors();
  const actors = actorsQuery.data ?? [];
  const selectedItem = items.find((item) => item.id === selectedItemId);

  // D-127/D-128 (Phase 7 plan 07-05): the git identifier round trip. `enabled` inside the hook
  // stays false for ordinary text, so typing a search term spends no IPC call (T-07-05-05) — read
  // once per render, never a second time.
  const identityQuery = useIdentityLookup(query);

  // The SAME registration flow ⌘⇧O and the rail's `+` button use (`RegisterProjectFlow.tsx`) —
  // never a re-derived copy. `isError`/`error` are surfaced below (CR-02) — this command runs
  // `close()` immediately (see `run` below), so by the time the mutation actually rejects the
  // palette has already closed; the notice below is rendered from the `!open` early return so it
  // survives the close instead of vanishing with the rest of the palette's content.
  const {
    registerProjectFlow,
    isError: registerIsError,
    error: registerError,
  } = useRegisterProjectFlow();
  const registerNotice = useRegistrationErrorNotice(registerIsError, registerError);
  const createIssue = useCreateIssue(effectiveProjectId);
  const setStatus = useSetStatus(effectiveProjectId);
  const setPriority = useSetPriority(effectiveProjectId);
  const setEstimate = useSetEstimate(effectiveProjectId);
  const setAssignee = useSetAssignee(effectiveProjectId);
  const setTaskEpic = useSetTaskEpic(effectiveProjectId);
  const reorderItem = useReorderItem(effectiveProjectId);

  // `⌘K` — the one binding this component owns directly, since it is the surface it opens.
  // Every other global binding (`⌘N`, `⌘⇧N`, `⌘⇧O`, `⌘1`-`⌘9`, `⌘F`/`/`) is owned by whichever
  // component holds the state it drives (`BoardView.tsx`, `FilterBar.tsx`, `AppShell` below).
  useGlobalBindings({ "open-palette": () => setOpen(true) });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setOverlay(null);
    }
  }, [open]);

  function close() {
    setOpen(false);
  }

  /** For every command whose effect moves focus to a different region (a project switch,
   * `focus-search`, `register-project`, `create-task`/`create-epic`, the `filter-*` ids): closes
   * the palette AND the item detail panel first (`returnToBoardLayer`, `state/keyboard.ts`), so
   * the surface the command is about to open is the only focus owner rather than being silently
   * dropped by the new layer guard (01-13-PLAN.md, G-01-FOCUS). The "Selected item" board-list
   * commands, `create-issue` and `open-legend` keep plain `close()` — they mutate or open in
   * place and move no focus out. */
  function closeToBoard() {
    returnToBoardLayer();
  }

  function runBoardListAction(id: ActionId) {
    switch (id) {
      case "move-down":
        setSelectedItemId(nextSelectionId(items, selectedItemId, 1));
        break;
      case "move-up":
        setSelectedItemId(nextSelectionId(items, selectedItemId, -1));
        break;
      case "select-first":
        setSelectedItemId(boundarySelectionId(items, "first"));
        break;
      case "select-last":
        setSelectedItemId(boundarySelectionId(items, "last"));
        break;
      case "open-detail":
        if (selectedItemId) setDetailItemId(selectedItemId);
        break;
      case "open-status-picker":
        if (selectedItem) setOverlay("status");
        break;
      case "open-priority-picker":
        if (selectedItem) setOverlay("priority");
        break;
      case "open-estimate-picker":
        if (selectedItem) setOverlay("estimate");
        break;
      case "open-assignee-picker":
        if (selectedItem) setOverlay("assignee");
        break;
      case "open-epic-picker":
        if (selectedItem && (selectedItem.kind ?? "task") === "task") setOverlay("epic");
        break;
      case "reorder-up":
        if (selectedItem) reorderItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, direction: "up" });
        break;
      case "reorder-down":
        if (selectedItem) reorderItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, direction: "down" });
        break;
      case "delete-item":
        if (selectedItem) {
          setDeleteTarget({
            kind: selectedItem.kind ?? "task",
            id: selectedItem.id,
            key: selectedItem.key,
            title: selectedItem.title,
          });
          close();
        }
        break;
      case "open-live-session":
        // Same task-only refusal `BoardView.tsx`'s board-list `l` key applies (D-37) — resolved
        // through the ONE shared entry point (`openLiveSessionForTask`, `useBoardQuery.ts`) so the
        // palette and the real keystroke never compute "which run is active" two different ways.
        if (selectedItem && (selectedItem.kind ?? "task") === "task") {
          void openLiveSessionForTask(selectedItem.id);
        }
        break;
      case "continue-shaping":
        // D-91 (plan 05-10): epic-only, the inverse of `open-epic-picker`'s task-only refusal
        // above — resolved through the ONE shared entry point (`continueShapingEpic`,
        // `useBoardQuery.ts`) so the palette and `BoardView.tsx`'s real `r` keystroke never
        // compute "is a session already running for this epic" two different ways.
        if (selectedItem && (selectedItem.kind ?? "task") === "epic") {
          void continueShapingEpic(selectedItem.id);
        }
        break;
      default:
        break;
    }
  }

  // The one runtime-generated section D-127 adds (mirrors the "Go to Project" loop's own
  // generated-every-render shape): at most one entry, computed from the identity query's current
  // outcome. A resolved outcome activates straight to the item; an ambiguous outcome renders a
  // single non-activatable entry naming the count; a not-found outcome renders nothing — never a
  // second static list and never a second palette input (D-127 rejects both).
  const identityEntries = useMemo<Command[]>(() => {
    const outcome = identityQuery.data;
    if (!outcome) return [];
    if (outcome.outcome === "resolved") {
      const { resolution } = outcome;
      const shaPart = resolution.matchedSha
        ? ` (${resolution.matchedSha.slice(0, 7)}${resolution.runId ? `, ${resolution.runId}` : ""})`
        : "";
      return [
        {
          id: `git-identifier:${resolution.itemId}`,
          label: `${resolution.itemKey} ${resolution.itemTitle}${shaPart}`,
          group: "Git",
          run: () => {
            setCurrentProjectId(resolution.projectId);
            setSelectedItemId(resolution.itemId);
            setDetailItemId(resolution.itemId);
            close();
          },
        },
      ];
    }
    if (outcome.outcome === "ambiguousPrefix") {
      return [
        {
          id: "git-identifier:ambiguous-prefix",
          label: `Ambiguous — ${outcome.matches} commits share this prefix`,
          group: "Git",
          disabled: true,
          run: () => {},
        },
      ];
    }
    if (outcome.outcome === "ambiguousAcrossRepositories") {
      return [
        {
          id: "git-identifier:ambiguous-repositories",
          label: `Ambiguous — found in ${outcome.repositories} repositories`,
          group: "Git",
          disabled: true,
          run: () => {},
        },
      ];
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityQuery.data, setCurrentProjectId, setSelectedItemId, setDetailItemId]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];

    for (const project of projects) {
      out.push({
        id: `switch-project:${project.id}`,
        label: `Go to Project: ${project.name}`,
        group: "Navigation",
        run: () => {
          setCurrentProjectId(project.id);
          closeToBoard();
        },
      });
    }

    for (const id of allActionIds()) {
      const label = actionLabel(id);
      switch (id) {
        case "open-palette":
          // The palette cannot usefully offer "open the palette" as a command inside itself.
          continue;
        case "focus-search":
          out.push({
            id,
            label,
            group: "Navigation",
            run: () => {
              closeToBoard();
              (document.querySelector('input[aria-label="Search items"]') as HTMLInputElement | null)?.focus();
            },
          });
          continue;
        case "register-project":
          out.push({
            id,
            label,
            group: "Project",
            run: () => {
              closeToBoard();
              void registerProjectFlow();
            },
          });
          continue;
        case "create-task":
        case "create-epic":
          out.push({
            id,
            label,
            group: "Create",
            // Re-enters the exact same path a real `⌘N`/`⌘⇧N` keystroke takes
            // (`dispatchAction`'s doc comment in `state/keyboard.ts`) — `BoardView.tsx`'s own
            // `useGlobalBindings` registration is what actually opens quick-add. `closeToBoard()`
            // MUST run before `dispatchAction` — Zustand's `set` is synchronous, so by the time
            // the synthesized keydown reaches the window listener the layer is already "board"
            // and the new guard (`bindingAllowedInLayer`) admits it. Dispatching first would have
            // the palette drop its own command (this ordering is not incidental).
            run: () => {
              closeToBoard();
              dispatchAction(id);
            },
          });
          continue;
        case "open-settings":
          out.push({
            id,
            label,
            group: "Navigation",
            // Same `closeToBoard()`-then-`dispatchAction` shape as `create-task`/`create-epic`
            // above — the label comes from the binding table (plan 02-10 Task 3's own acceptance
            // criterion: no hand-written literal here), and `App.tsx`'s `useGlobalBindings`
            // registration is what actually opens the surface, so the menu item, `⌘,` and this
            // palette entry all dispatch through the one `open-settings` action id.
            run: () => {
              closeToBoard();
              dispatchAction(id);
            },
          });
          continue;
        case "create-issue":
          out.push({
            id,
            label,
            group: "Create",
            disabled: !effectiveProjectId,
            run: () => {
              if (!effectiveProjectId) return;
              const title = "New issue";
              // Files the new issue under whatever is currently selected — an epic, a task, or
              // neither with no selection — the second half of G-01-EPIC-ASSIGN's first cause
              // (`useCreateIssue` previously dropped both ids regardless of what this command
              // sent it).
              const selectedKind = selectedItem?.kind ?? "task";
              createIssue.mutate({
                title,
                kind: "idea",
                epicId: selectedItem && selectedKind === "epic" ? selectedItem.id : undefined,
                taskId: selectedItem && selectedKind === "task" ? selectedItem.id : undefined,
              });
              close();
            },
          });
          continue;
        case "open-legend":
          out.push({ id, label, group: "Reference", run: () => setOverlay("legend") });
          continue;
        case "shape-epic":
          // D-84/D-86 (plan 05-02): starts a fresh epic-authoring session and opens the session
          // surface on the returned run id (`startAuthoringSessionForProject`,
          // `board/useBoardQuery.ts`) — the least invasive entry point (SHAPE-01), re-entering the
          // same `activeAgentRunId` plumbing every task-execution run already uses.
          out.push({
            id,
            label,
            group: "Create",
            disabled: !effectiveProjectId,
            run: () => {
              if (!effectiveProjectId) return;
              close();
              void startAuthoringSessionForProject(effectiveProjectId);
            },
          });
          continue;
        case "return-stage": {
          // D-90 (plan 05-03): the palette's own reachable path to the same verb
          // `SessionSurface.tsx`'s inline "way back" control calls — disabled unless the CURRENT
          // session is an authoring run with somewhere earlier to return to. `run()` fires the
          // command directly (mirrors `shape-epic`'s own direct-run pattern) rather than routing
          // through `dispatchAction`, which only works for bindings that carry a real key.
          const target = activeAgentRunAuthoringStage
            ? previousAuthoringStage(activeAgentRunAuthoringStage)
            : undefined;
          out.push({
            id,
            label,
            group: "Session",
            disabled: !activeAgentRunId || !target,
            run: () => {
              if (!activeAgentRunId || !target) return;
              close();
              void authoringStageReturn(activeAgentRunId, target);
            },
          });
          continue;
        }
        case "accept-proposal":
        case "reject-proposal":
        case "amend-proposal":
        case "accept-proposal-subtree":
          // D-92/D-95 (plan 05-07): proposal-tray-scoped verbs with no palette-reachable target —
          // the palette's own selection model has no "selected proposal" concept, and
          // `bindingAllowedInLayer` gates all four to the `"proposal-tray"` layer only, so a
          // palette-issued `dispatchAction`/`runBoardListAction` call could never actually reach
          // one. Excluded here, mirroring `open-palette`'s own continue-without-pushing pattern,
          // rather than falling through to the generic board-list handler below and silently
          // doing nothing (the exact dead-menu-entry defect `return-stage`'s own case above was
          // added to avoid, 05-03-SUMMARY.md's Deviations).
          continue;
        case "filter-status":
        case "filter-epic":
        case "filter-assignee":
        case "filter-priority":
          out.push({
            id,
            label,
            group: "Filter",
            run: () => {
              closeToBoard();
              focusFirstChildButton(id);
            },
          });
          continue;
        default:
          break;
      }

      // Every remaining action id is board-list-region — Task 2's own acceptance criterion is
      // that ALL of them appear here, generated, not a hand-picked subset.
      out.push({
        id,
        label,
        group: "Selected item",
        disabled:
          (!selectedItemId && !SELECTION_INDEPENDENT_ACTION_IDS.has(id)) ||
          (TASK_ONLY_ACTION_IDS.has(id) && (selectedItem?.kind ?? "task") === "epic") ||
          (EPIC_ONLY_ACTION_IDS.has(id) && (selectedItem?.kind ?? "task") === "task"),
        run: () => {
          runBoardListAction(id);
          if (!OVERLAY_ACTION_IDS.has(id)) close();
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, items, selectedItemId, selectedItem, effectiveProjectId]);

  const filtered = useMemo(() => {
    // The identity entry never passes `fuzzyMatches` against the raw hash/branch the user typed
    // (its label carries the resolved item's key and title, not the pasted string) — it is
    // positioned ahead of the fuzzy-filtered list by position, not by a sort comparator.
    const result = commands.filter((command) => fuzzyMatches(query, command.label));
    for (let i = identityEntries.length - 1; i >= 0; i -= 1) {
      result.unshift(identityEntries[i]);
    }
    return result;
  }, [commands, query, identityEntries]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command && !command.disabled) command.run();
    }
  }

  if (!open) {
    // The one branch that must still render something: `run()` above calls `close()`
    // synchronously, so `open` is already false by the time a rejected registration sets
    // `registerNotice` — without this, the notice would never reach the screen.
    return registerNotice
      ? createPortal(
          <div
            role="status"
            className="type-label"
            style={{
              position: "fixed",
              bottom: "var(--space-lg)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1400,
              color: "var(--destructive-strip)",
              background: "var(--surface-secondary)",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              padding: "var(--space-sm) var(--space-md)",
              maxWidth: "80vw",
            }}
          >
            {registerNotice}
          </div>,
          document.body,
        )
      : null;
  }

  if (overlay === "legend") {
    return <Legend onClose={() => setOverlay(null)} />;
  }

  if (overlay && selectedItem) {
    const anchorRect = panelRef.current?.getBoundingClientRect();
    const rect = anchorRect
      ? { top: anchorRect.top, left: anchorRect.left, bottom: anchorRect.bottom }
      : { top: 80, left: 80, bottom: 84 };
    const closeOverlay = () => setOverlay(null);
    const kind = selectedItem.kind ?? "task";
    switch (overlay) {
      case "status":
        return (
          <StatusPicker
            currentStatus={selectedItem.status}
            anchorRect={rect}
            onSelect={(status) => {
              setStatus.mutate({ kind, id: selectedItem.id, status });
              closeOverlay();
              close();
            }}
            onClose={closeOverlay}
          />
        );
      case "priority":
        return (
          <PriorityPicker
            currentPriority={selectedItem.priority}
            anchorRect={rect}
            onSelect={(priority) => {
              setPriority.mutate({ kind, id: selectedItem.id, priority });
              closeOverlay();
              close();
            }}
            onClose={closeOverlay}
          />
        );
      case "estimate":
        return (
          <EstimatePicker
            currentEstimate={selectedItem.estimate ?? null}
            anchorRect={rect}
            onSelect={(estimate) => {
              setEstimate.mutate({ kind, id: selectedItem.id, estimate });
              closeOverlay();
              close();
            }}
            onClose={closeOverlay}
          />
        );
      case "assignee":
        return (
          <AssigneePicker
            currentAssigneeId={selectedItem.assigneeId ?? null}
            actors={actors}
            anchorRect={rect}
            onSelect={(assigneeId) => {
              setAssignee.mutate({ kind, id: selectedItem.id, assigneeId });
              closeOverlay();
              close();
            }}
            onClose={closeOverlay}
          />
        );
      case "epic": {
        const epicOptions: ParentOption[] = items
          .filter((item) => item.kind === "epic" && item.id !== selectedItem.id)
          .map((epic) => ({ id: epic.id, label: `${epic.key} ${epic.title}` }));
        return (
          <ParentPicker
            ariaLabel="Set epic"
            emptyLabel="No epic"
            currentId={selectedItem.epicId}
            options={epicOptions}
            anchorRect={rect}
            onSelect={(epicId) => {
              setTaskEpic.mutate({ taskId: selectedItem.id, epicId });
              closeOverlay();
              close();
            }}
            onClose={closeOverlay}
          />
        );
      }
      default:
        return null;
    }
  }

  return createPortal(
    <FocusScope trapped loop asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
        onPointerDownOutside={close}
        asChild
      >
        <div
          role="dialog"
          aria-label="Command palette"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "12vh",
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            ref={panelRef}
            className="command-palette"
            onKeyDown={handleKeyDown}
            style={{
              width: 560,
              maxHeight: "60vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface-secondary)",
              color: "var(--text-primary-rack)",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            <input
              ref={inputRef}
              // Deliberately NOT `autoFocus`: the native attribute focuses the input during
              // React's commit phase, BEFORE `FocusScope`'s own mount effect (a passive effect,
              // which runs afterward) has a chance to capture `document.activeElement` as the
              // triggering element. If this input steals focus first, `FocusScope` captures ITS
              // OWN input as "what to restore focus to" on close — and since that input is what's
              // being unmounted, the restore silently no-ops, leaving focus on `<body>`.
              // `FocusScope`'s own default mount behavior (`focusFirst` over the container's
              // tabbable candidates) already lands focus here, correctly, after that capture.
              className="type-body"
              aria-label="Command search"
              placeholder="Type a command…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{
                padding: "var(--space-md)",
                border: "none",
                borderBottom: "1px solid var(--divider)",
                background: "transparent",
                color: "inherit",
                outline: "none",
              }}
            />
            <div role="listbox" aria-label="Commands" style={{ overflowY: "auto" }}>
              {filtered.length === 0 && (
                <div className="type-body" style={{ padding: "var(--space-md)", color: "var(--text-muted-rack)" }}>
                  No matching commands or items
                </div>
              )}
              {filtered.map((command, index) => (
                <div
                  key={command.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-disabled={command.disabled}
                  className="type-body"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => !command.disabled && command.run()}
                  style={{
                    padding: "var(--space-sm) var(--space-md)",
                    background: index === activeIndex ? "var(--surface-dominant)" : "transparent",
                    color: command.disabled ? "var(--text-muted-rack)" : "inherit",
                    cursor: command.disabled ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{command.label}</span>
                  <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                    {command.group}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
