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
import { openFolderDialog } from "../adapters/tauri";
import { deriveKeyPrefix } from "./FirstRun";
import { Legend } from "../legend/Legend";
import { StatusPicker } from "./pickers/StatusPicker";
import { PriorityPicker } from "./pickers/PriorityPicker";
import { EstimatePicker } from "./pickers/EstimatePicker";
import { AssigneePicker } from "./pickers/AssigneePicker";
import {
  allActionIds,
  actionLabel,
  boundarySelectionId,
  dispatchAction,
  nextSelectionId,
  useGlobalBindings,
  type ActionId,
} from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import {
  useActors,
  useBoardQuery,
  useCreateIssue,
  useProjects,
  useRegisterProject,
  useReorderItem,
  useSetAssignee,
  useSetEstimate,
  useSetPriority,
  useSetStatus,
} from "./useBoardQuery";

/** Board-list action ids whose palette command opens its OWN overlay (a picker, or the delete
 * confirmation via `BoardView.tsx`'s `deleteTarget` in `uiStore`) rather than completing
 * instantly — these must not also close the palette itself when selected. */
const OVERLAY_ACTION_IDS = new Set<ActionId>([
  "open-status-picker",
  "open-priority-picker",
  "open-estimate-picker",
  "open-assignee-picker",
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

type PaletteOverlay = "status" | "priority" | "estimate" | "assignee" | "legend" | null;

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const currentProjectId = useUiStore((state) => state.currentProjectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const selectedItemId = useUiStore((state) => state.selectedItemId);
  const setSelectedItemId = useUiStore((state) => state.setSelectedItemId);
  const setDetailItemId = useUiStore((state) => state.setDetailItemId);
  const setDeleteTarget = useUiStore((state) => state.setDeleteTarget);

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

  const registerProject = useRegisterProject();
  const createIssue = useCreateIssue(effectiveProjectId);
  const setStatus = useSetStatus(effectiveProjectId);
  const setPriority = useSetPriority(effectiveProjectId);
  const setEstimate = useSetEstimate(effectiveProjectId);
  const setAssignee = useSetAssignee(effectiveProjectId);
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

  async function registerProjectFlow() {
    const repoPath = await openFolderDialog();
    if (!repoPath) return;
    const name = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
    registerProject.mutate({ name, repoPath, keyPrefix: deriveKeyPrefix(name) });
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
      default:
        break;
    }
  }

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];

    for (const project of projects) {
      out.push({
        id: `switch-project:${project.id}`,
        label: `Go to Project: ${project.name}`,
        group: "Navigation",
        run: () => {
          setCurrentProjectId(project.id);
          close();
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
              (document.querySelector('input[aria-label="Search items"]') as HTMLInputElement | null)?.focus();
              close();
            },
          });
          continue;
        case "register-project":
          out.push({ id, label, group: "Project", run: () => { void registerProjectFlow(); close(); } });
          continue;
        case "create-task":
        case "create-epic":
          out.push({
            id,
            label,
            group: "Create",
            // Re-enters the exact same path a real `⌘N`/`⌘⇧N` keystroke takes
            // (`dispatchAction`'s doc comment in `state/keyboard.ts`) — `BoardView.tsx`'s own
            // `useGlobalBindings` registration is what actually opens quick-add.
            run: () => {
              dispatchAction(id);
              close();
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
              createIssue.mutate({ title, kind: "idea" });
              close();
            },
          });
          continue;
        case "open-legend":
          out.push({ id, label, group: "Reference", run: () => setOverlay("legend") });
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
              close();
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
        disabled: !selectedItemId && !SELECTION_INDEPENDENT_ACTION_IDS.has(id),
        run: () => {
          runBoardListAction(id);
          if (!OVERLAY_ACTION_IDS.has(id)) close();
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, items, selectedItemId, selectedItem, effectiveProjectId]);

  const filtered = useMemo(
    () => commands.filter((command) => fuzzyMatches(query, command.label)),
    [commands, query],
  );

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

  if (!open) return null;

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
