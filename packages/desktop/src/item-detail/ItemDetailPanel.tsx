/**
 * The item detail side panel (01-UI-SPEC.md "Item detail — side panel"): a 480px peer surface,
 * not a modal and not a full page. Opens on `Enter`/`o` on a selected row, closes on `Escape`
 * with focus returning to the row that opened it (handled by Radix `FocusScope`'s default
 * unmount-restore behavior — see `pickers/StatusPicker.tsx` for the same pattern).
 *
 * Renders the inline-editable title and description, the status picker (tasks/epics only — an
 * issue has no status, D-07), the acceptance-criteria list (tasks and epics only, never for an
 * issue — D-07, BOARD-02), and the activity trail (tasks and epics only — `core::query::events`
 * only accepts `"task"`/`"epic"` as a trail's `parent_kind`; no surface opens this panel for an
 * issue yet, matching `AcceptanceCriteriaList`'s own `!isIssue` guard).
 *
 * Below 1100px window width this becomes an overlay with a scrim rather than sharing horizontal
 * space with the list (01-UI-SPEC.md "Item detail — side panel", responsive rule) — the caller
 * (`App.tsx`) decides which layout to render this inside; this component only owns its own
 * 480px content.
 *
 * Plan 02-08 inserts two more task-only sections above the Activity Trail, in this order:
 * `WorktreeSummary` (the task's git identity) then `RunsSection` (every run on this task, newest
 * first). Both are absent until they have something to show (State Inventory "No worktree/runs
 * yet"). `RunsSection` now owns the permission-request card's `compact` mount too (moved here
 * from plan 02-06 Task 2's original panel-level mount) — the card lives beneath the specific
 * blocked run's own row rather than as a generic sibling section, so a run and the answer it is
 * waiting on read as one linked record (Discretion #6 still holds: the SAME
 * `usePendingPermissionRequests(agentRunId)` query every mount point reads).
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { StatusPicker } from "../board/pickers/StatusPicker";
import { MARKS_BY_ID, statusMarkId } from "../legend/marks";
import { AcceptanceCriteriaList } from "./AcceptanceCriteriaList";
import { ActivityTrail } from "./ActivityTrail";
import { GitFactsSection } from "./GitFactsSection";
import { RunsSection } from "./RunsSection";
import { WorktreeSummary } from "./WorktreeSummary";

export type DetailItemKind = "epic" | "task" | "issue";

export interface DetailItem {
  id: string;
  kind: DetailItemKind;
  key: string;
  title: string;
  /** `undefined` for an issue (D-07) — issues carry no status. */
  status?: string;
  /** Needed by the acceptance-criteria list to create a criterion against the right project. */
  projectId?: string;
}

export interface ItemDetailPanelProps {
  item: DetailItem;
  onClose: () => void;
  onUpdateTitle: (title: string) => void;
  onSetStatus?: (status: string) => void;
  /** Whether this panel's `FocusScope` traps Tab movement. Defaults to `true`. The command
   * palette (`board/CommandPalette.tsx`) renders OVER this panel by design (the Escape ladder's
   * fixed order, `state/keyboard.ts`) — the caller passes `false` while the palette is open, so
   * two trapped `FocusScope`s are never mounted at once. That "two trapped scopes at once"
   * condition is exactly what G-01-FOCUS's fifth instance describes: releasing the trap here is
   * how the panel stays open without fighting the palette for focus. This component stays free
   * of any store import — the caller decides. */
  trapped?: boolean;
  /** Called when the "Start Work" affordance is pressed (D-27, plan 02-04) — the caller opens the
   * launch sheet (this component stays free of any store import, per this prop's own precedent
   * above; the sheet itself calls `startAgentRun` once the operator submits it, replacing this
   * component's own former direct call). Only rendered for a task (D-37: an epic/issue has no
   * worktree of its own to run an agent in). */
  onStartWork?: () => void;
  /** Called with an `agent_runs.id` whenever the user selects a run to open, from the Runs
   * section's active-row primary action or any other row (D-31, plan 02-08 Task 3). The caller
   * (`board/BoardView.tsx`) routes this into the app's one session surface. Optional and
   * defaulted to a no-op — this component stays free of any store import (the same established
   * convention `onStartWork` already follows), and an epic/issue never renders the Runs section
   * that would need it (D-37). */
  onOpenRun?: (agentRunId: string) => void;
  /** Called when the "Continue Shaping" affordance is pressed (D-91, plan 05-10) — the caller
   * resolves whether a session is already running for this epic and either routes to it or opens
   * the authoring launch sheet (`useBoardQuery.ts`'s `continueShapingEpic`, the SAME entry point
   * `board/BoardView.tsx`'s own `r` keyboard binding calls). This component stays free of any
   * store import, per `onStartWork`'s own established convention above. Only rendered for an epic
   * (the fixed three-level hierarchy gives only an epic a shaping session of its own). */
  onContinueShaping?: () => void;
}

export function ItemDetailPanel({
  item,
  onClose,
  onUpdateTitle,
  onSetStatus,
  trapped = true,
  onStartWork,
  onOpenRun,
  onContinueShaping,
}: ItemDetailPanelProps) {
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [statusPickerAnchor, setStatusPickerAnchor] = useState<{ top: number; left: number; bottom: number } | null>(
    null,
  );
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const isIssue = item.kind === "issue";
  const isTask = item.kind === "task";
  const statusMark = item.status ? MARKS_BY_ID[statusMarkId(item.status)] : undefined;

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0 && trimmed !== item.title) {
      onUpdateTitle(trimmed);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || (event.key === "Enter" && event.metaKey)) {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setTitleDraft(item.title);
      event.currentTarget.blur();
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !statusPickerOpen) {
      onClose();
    }
  }

  return (
    <FocusScope trapped={trapped} asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          if (statusPickerOpen) {
            event.preventDefault();
            return;
          }
          onClose();
        }}
        asChild
      >
        <aside
          role="dialog"
          aria-label={`${item.key} detail`}
          onKeyDown={handlePanelKeyDown}
          style={{
            width: 480,
            flexShrink: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
            padding: "var(--space-lg)",
            background: "var(--surface-secondary)",
            color: "var(--text-primary-rack)",
            borderLeft: "1px solid var(--divider)",
            overflowY: "auto",
          }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
              {item.key}
            </span>
            <button
              type="button"
              aria-label="Close detail panel"
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
            >
              Close
            </button>
          </header>

          <input
            className="type-heading"
            aria-label="Title"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleTitleKeyDown}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--divider)",
              color: "inherit",
              padding: "var(--space-xs) 0",
            }}
          />

          {!isIssue && (
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                Status
              </span>
              <button
                ref={statusButtonRef}
                type="button"
                onClick={() => {
                  const rect = statusButtonRef.current?.getBoundingClientRect();
                  if (rect) {
                    setStatusPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
                  }
                  setStatusPickerOpen(true);
                }}
                className="type-body"
                style={{
                  background: "var(--surface-dominant)",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "inherit",
                  padding: "var(--space-xs) var(--space-sm)",
                  cursor: "pointer",
                }}
              >
                {statusMark?.label ?? item.status}
              </button>
              {statusPickerOpen && item.status && statusPickerAnchor && (
                <StatusPicker
                  currentStatus={item.status}
                  anchorRect={statusPickerAnchor}
                  onSelect={(status) => {
                    onSetStatus?.(status);
                    setStatusPickerOpen(false);
                  }}
                  onClose={() => setStatusPickerOpen(false)}
                />
              )}
            </div>
          )}

          {item.kind === "task" && (
            <button
              type="button"
              onClick={onStartWork}
              className="type-body"
              style={{
                alignSelf: "flex-start",
                background: "var(--accent-nontext)",
                border: "none",
                borderRadius: "var(--radius-chrome)",
                color: "var(--text-primary-rack)",
                padding: "var(--space-xs) var(--space-md)",
                cursor: "pointer",
              }}
            >
              Start Work
            </button>
          )}

          {item.kind === "epic" && (
            <button
              type="button"
              onClick={onContinueShaping}
              className="type-body"
              style={{
                alignSelf: "flex-start",
                background: "var(--accent-nontext)",
                border: "none",
                borderRadius: "var(--radius-chrome)",
                color: "var(--text-primary-rack)",
                padding: "var(--space-xs) var(--space-md)",
                cursor: "pointer",
              }}
            >
              Continue Shaping
            </button>
          )}

          {!isIssue && (
            <AcceptanceCriteriaList
              parentType={item.kind === "epic" ? "epic" : "task"}
              parentId={item.id}
              projectId={item.projectId}
            />
          )}

          {isTask && <WorktreeSummary taskId={item.id} />}

          {isTask && <GitFactsSection taskId={item.id} />}

          {isTask && <RunsSection taskId={item.id} onOpenRun={onOpenRun ?? (() => {})} />}

          {!isIssue && <ActivityTrail parentType={item.kind === "epic" ? "epic" : "task"} parentId={item.id} />}
        </aside>
      </DismissableLayer>
    </FocusScope>
  );
}
