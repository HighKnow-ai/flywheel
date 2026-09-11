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
 * Plan 02-06 Task 2 adds the permission-request card's `compact` variant, rendered above the
 * Activity Trail whenever the task's most recent run has a pending request (AGNT-06, D-37, D-38,
 * Discretion #6). Only a task can have a run (an epic/issue has no worktree of its own — D-37's
 * Boundary note), so this resolves its own `agentRunId` self-contained, the same pattern
 * `AcceptanceCriteriaList`/`ActivityTrail` already use for their own embedded-section queries
 * keyed off `item.id` — this component still imports no store (its own established convention).
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { answerPermissionRequest } from "../adapters/tauri";
import { useLatestAgentRunId, usePendingPermissionRequests } from "../board/useBoardQuery";
import { StatusPicker } from "../board/pickers/StatusPicker";
import { MARKS_BY_ID, statusMarkId } from "../legend/marks";
import { PermissionRequestCard, type PermissionDecision } from "../session/PermissionRequestCard";
import { AcceptanceCriteriaList } from "./AcceptanceCriteriaList";
import { ActivityTrail } from "./ActivityTrail";

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
}

export function ItemDetailPanel({
  item,
  onClose,
  onUpdateTitle,
  onSetStatus,
  trapped = true,
  onStartWork,
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

  // The permission-request card's `compact` mount (AGNT-06, plan 02-06 Task 2) — resolves this
  // task's most recent run, then reads the exact SAME `agentRunId`-keyed query the session feed's
  // mount reads for that run, so answering in either place clears both (Discretion #6).
  const latestRunQuery = useLatestAgentRunId(isTask ? item.id : undefined);
  const pendingQuery = usePendingPermissionRequests(isTask ? latestRunQuery.data : undefined);
  const pendingRequests = pendingQuery.data ?? [];

  async function handleAnswerPermission(requestId: string, decision: PermissionDecision) {
    await answerPermissionRequest(requestId, decision);
  }

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

          {!isIssue && (
            <AcceptanceCriteriaList
              parentType={item.kind === "epic" ? "epic" : "task"}
              parentId={item.id}
              projectId={item.projectId}
            />
          )}

          {isTask && pendingRequests.length > 0 && (
            <PermissionRequestCard variant="compact" requests={pendingRequests} onAnswer={handleAnswerPermission} />
          )}

          {!isIssue && <ActivityTrail parentType={item.kind === "epic" ? "epic" : "task"} parentId={item.id} />}
        </aside>
      </DismissableLayer>
    </FocusScope>
  );
}
