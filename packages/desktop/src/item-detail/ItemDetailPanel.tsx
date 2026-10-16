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
 * Plan 15-07 (DRFT-03, D-02): an agent's suggested title, body and priority are GHOSTED into these same
 * fields, not shown beside them in a second surface. A ghost is visual only: nothing is written on
 * render, hover or focus. Focusing the title adopts the suggestion as the draft, and the human's own
 * Enter or edit commits it through `onUpdateTitle` like any typed title. Reject is the undo (D-04) and
 * is offered per field; Start Work confirms what is left, inside the core.
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
import { MARKS_BY_ID, priorityMarkId, statusMarkId } from "../legend/marks";
import { useItemProvisionalValues, useRejectProvisionalValue } from "../authoring/useAuthoringQuery";
import type { ProvisionalValueDto } from "../adapters/tauri";
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
  // Server state (React Query); the title draft above stays component state, never blurred (CLAUDE.md).
  const provisional = useItemProvisionalValues(isTask ? item.id : null).data ?? [];
  const rejectProvisional = useRejectProvisionalValue(item.id);
  // When two amendments suggest one field, the later one is what Start Work leaves, so it is the one shown.
  const ghostFor = (field: ProvisionalValueDto["field"]): ProvisionalValueDto | undefined => {
    const forField = provisional.filter((v) => v.field === field);
    return forField[forField.length - 1];
  };
  const titleGhost = ghostFor("title");
  const descriptionGhost = ghostFor("description");
  const priorityGhost = ghostFor("priority");
  const [titleEditing, setTitleEditing] = useState(false);
  // True while the draft is the agent's suggestion adopted on focus and not yet touched by the human:
  // leaving the field then must write nothing (a focus is not a decision), Enter is the explicit commit.
  const adoptedUntouched = useRef(false);
  // One reject per proposal, however many activations land before the mutation settles.
  const rejecting = useRef(new Set<string>());
  const reject = (proposalId: string) => {
    if (rejecting.current.has(proposalId)) return;
    rejecting.current.add(proposalId);
    rejectProvisional.mutate(proposalId, { onError: () => rejecting.current.delete(proposalId) });
  };
  const showTitleGhost = !!titleGhost && !titleEditing;
  const statusMark = item.status ? MARKS_BY_ID[statusMarkId(item.status)] : undefined;
  // Printed only where there is a value to print. The panel receives no other property (assignee, epic and the
  // worktree facts have their own sections), and an unknown value prints nothing rather than a dash.
  const priorityMark = item.priority === undefined ? undefined : MARKS_BY_ID[priorityMarkId(item.priority)];
  const ghostPriorityMark = priorityGhost ? MARKS_BY_ID[priorityMarkId(Number(priorityGhost.proposed))] : undefined;
  const hasProps = (!isIssue && !!item.status) || !!priorityMark || !!ghostPriorityMark;

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0 && trimmed !== item.title) {
      onUpdateTitle(trimmed);
    }
  }

  function handleTitleFocus() {
    if (!titleGhost) return;
    setTitleDraft(titleGhost.proposed);
    setTitleEditing(true);
    adoptedUntouched.current = true;
  }

  function handleTitleBlur() {
    setTitleEditing(false);
    if (adoptedUntouched.current) {
      // Focus alone adopted the suggestion; the human never touched it, so nothing is written.
      adoptedUntouched.current = false;
      setTitleDraft(item.title);
      return;
    }
    commitTitle();
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || (event.key === "Enter" && event.metaKey)) {
      // Enter on an adopted suggestion is the human's own commit.
      adoptedUntouched.current = false;
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      adoptedUntouched.current = false;
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
              className={`type-heading detail-title${showTitleGhost ? " detail-title-ghost" : ""}`}
              aria-label="Title"
              value={showTitleGhost ? titleGhost.proposed : titleDraft}
              onChange={(event) => {
                adoptedUntouched.current = false;
                setTitleDraft(event.target.value);
              }}
              onFocus={handleTitleFocus}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
            />
            {showTitleGhost && (
              <p className="type-body detail-ghost-note">
                <span>
                  Suggested by {titleGhost.actorName}. Now: {titleGhost.current ?? item.title}
                </span>
                <button
                  type="button"
                  className="type-body detail-ghost-reject"
                  aria-label="Reject suggested title"
                  onClick={() => reject(titleGhost.proposalId)}
                >
                  Reject
                </button>
              </p>
            )}
          </div>

          {hasProps && (
            <dl className="detail-props">
              {!isIssue && item.status && (
                <>
                  <dt className="type-body">Status</dt>
                  <dd className="type-body">{statusMark?.label ?? item.status}</dd>
                </>
              )}
              {(priorityMark || ghostPriorityMark) && (
                <>
                  <dt className="type-body">Priority</dt>
                  <dd className="type-body">
                    {priorityMark?.label}
                    {priorityGhost && ghostPriorityMark && (
                      <span className="detail-ghost-priority">
                        Suggested: {ghostPriorityMark.label}
                        <button
                          type="button"
                          className="type-body detail-ghost-reject"
                          aria-label="Reject suggested priority"
                          onClick={() => reject(priorityGhost.proposalId)}
                        >
                          Reject
                        </button>
                      </span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          )}

          {descriptionGhost && (
            <section className="detail-ghost" aria-label="Suggested description">
              <p className="type-label detail-ghost-note">
                <span>Suggested description by {descriptionGhost.actorName}</span>
                <button
                  type="button"
                  className="type-body detail-ghost-reject"
                  aria-label="Reject suggested description"
                  onClick={() => reject(descriptionGhost.proposalId)}
                >
                  Reject
                </button>
              </p>
              <p className="type-body detail-ghost-text">{descriptionGhost.proposed}</p>
              {descriptionGhost.current && (
                <p className="type-body detail-ghost-current">Now: {descriptionGhost.current}</p>
              )}
            </section>
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
