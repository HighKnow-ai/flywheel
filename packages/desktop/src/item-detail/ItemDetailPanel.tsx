/**
 * The item detail side panel (01-UI-SPEC.md "Item detail — side panel"): a 480px peer surface,
 * not a modal and not a full page. Opens on `Enter`/`o` on a selected row, closes on `Escape`
 * with focus returning to the row that opened it (handled by Radix `FocusScope`'s default
 * unmount-restore behavior — see `board/pickers/PriorityPicker.tsx` for the same pattern).
 *
 * Renders the inline-editable title and description, the status value, read-only (tasks/epics only — an
 * issue has no status, D-07; status is derived, DRFT-04, D-19), the acceptance-criteria list (tasks and epics only, never for an
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
import { useState, type KeyboardEvent } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { MARKS_BY_ID, priorityMarkId, statusMarkId } from "../legend/marks";
import { AcceptanceCriteriaList } from "./AcceptanceCriteriaList";
import { ActivityTrail } from "./ActivityTrail";
import { ForgeSection } from "./ForgeSection";
import { GitFactsSection } from "./GitFactsSection";
import { RunsSection } from "./RunsSection";
import { WorktreeSummary } from "./WorktreeSummary";
import "./item-detail.css";

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
  /** The item's priority (0-4, keyed as the keyboard map). `undefined` means NOT KNOWN (an epic
   * reached from the roster carries none), which prints no row; `0` is the fact "No priority". */
  priority?: number;
}

export interface ItemDetailPanelProps {
  item: DetailItem;
  onClose: () => void;
  onUpdateTitle: (title: string) => void;
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
  /** Called when the Review button is pressed (Phase 8 plan 08-01) — the caller pushes into the
   * review surface. Offered for both a task and an epic, since one surface serves both scopes. */
  onReview?: () => void;
}

export function ItemDetailPanel({
  item,
  onClose,
  onUpdateTitle,
  trapped = true,
  onStartWork,
  onOpenRun,
  onContinueShaping,
  onReview,
}: ItemDetailPanelProps) {
  const [titleDraft, setTitleDraft] = useState(item.title);
  const isIssue = item.kind === "issue";
  const isTask = item.kind === "task";
  const statusMark = item.status ? MARKS_BY_ID[statusMarkId(item.status)] : undefined;
  // Printed only where there is a value to print. The panel receives no other property (assignee, epic and the
  // worktree facts have their own sections), and an unknown value prints nothing rather than a dash.
  const priorityMark = item.priority === undefined ? undefined : MARKS_BY_ID[priorityMarkId(item.priority)];
  const hasProps = (!isIssue && !!item.status) || !!priorityMark;

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
    if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <FocusScope trapped={trapped} asChild>
      <DismissableLayer
        onEscapeKeyDown={() => {
          onClose();
        }}
        asChild
      >
        <aside
          role="dialog"
          aria-label={`${item.key} detail`}
          // `panel-slide-in` (motion.css): arrives from the trailing edge by transform only — width
          // is never animated, since board rows re-evaluate a container query on every width frame.
          className="panel-slide-in detail-panel"
          onKeyDown={handlePanelKeyDown}
          style={{
            width: 480,
            flexShrink: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
            padding: "var(--space-lg)",
            overflowY: "auto",
          }}
        >
          {/* The key and the title are one unit (tight), set well apart from the rest (the panel's gap):
              spacing is the title's focal device, since the locked 11/13/15 scale cannot grow it. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
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
              className="type-heading detail-title"
              aria-label="Title"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
            />
          </div>

          {hasProps && (
            <dl className="detail-props">
              {!isIssue && item.status && (
                <>
                  <dt className="type-body">Status</dt>
                  <dd className="type-body">{statusMark?.label ?? item.status}</dd>
                </>
              )}
              {priorityMark && (
                <>
                  <dt className="type-body">Priority</dt>
                  <dd className="type-body">{priorityMark.label}</dd>
                </>
              )}
            </dl>
          )}

          <div className="detail-actions">
            {/* One leading action per section carries the 2px ink edge (the selection rule's device); the rest stay
                on the hairline control edge. A task leads with Start Work, an epic with Continue Shaping. */}
            {item.kind === "task" && (
              <button
                type="button"
                onClick={onStartWork}
                className="type-body control-edge detail-action detail-action-lead"
              >
                Start Work
              </button>
            )}

            {item.kind === "epic" && (
              <button
                type="button"
                onClick={onContinueShaping}
                className="type-body control-edge detail-action detail-action-lead"
              >
                Continue Shaping
              </button>
            )}

            {(item.kind === "task" || item.kind === "epic") && (
              <button
                type="button"
                onClick={onReview}
                className="type-body control-edge detail-action"
              >
                Review
              </button>
            )}
          </div>

          {!isIssue && (
            <AcceptanceCriteriaList
              parentType={item.kind === "epic" ? "epic" : "task"}
              parentId={item.id}
              projectId={item.projectId}
            />
          )}

          {isTask && <WorktreeSummary taskId={item.id} />}

          {isTask && <GitFactsSection taskId={item.id} />}

          {isTask && <ForgeSection taskId={item.id} />}

          {isTask && <RunsSection taskId={item.id} onOpenRun={onOpenRun ?? (() => {})} />}

          {!isIssue && <ActivityTrail parentType={item.kind === "epic" ? "epic" : "task"} parentId={item.id} />}
        </aside>
      </DismissableLayer>
    </FocusScope>
  );
}
