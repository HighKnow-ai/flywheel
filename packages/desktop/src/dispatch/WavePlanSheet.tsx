/**
 * The wave plan sheet (plan 09-09, D-149, D-157, PLAN-07): the one human look at a draft before
 * anything spawns, and the read-only record of a plan once it is running.
 *
 * Modelled on the launch sheet (`launch-sheet/LaunchSheet.tsx`): same scrim, `FocusScope`,
 * `DismissableLayer` and portal mechanics, same lead-action treatment for the one primary action.
 *
 * It DISPLAYS; it decides nothing. The sequenced pairs and the paths behind them are the plan
 * response's (`edges`, computed by the Rust core: a preview while the plan is a draft, the frozen
 * record afterwards), a refused entry is the core's own refusal text, and "why" is the sentence the
 * core wrote from the edge that was acted on. This file holds no overlap or containment logic of
 * its own, because a second implementation in the renderer is exactly the drift this phase exists to
 * prevent. Every call goes through the single adapter module.
 *
 * Approve is the only action that starts dispatch. A plan that is not a draft is read-only.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQueryClient } from "@tanstack/react-query";
import {
  dispatchPlanApprove,
  dispatchPlanEdit,
  dispatchWhy,
  retryTask,
  skipTask,
  type DispatchEdgeDto,
  type DispatchPlanDto,
  type DispatchTaskDto,
} from "../adapters/tauri";
import { StateBadge } from "../legend/StateBadge";
import { dispatchPlanKey, errorText, useDispatchPlan } from "./queries";
import "../session/session.css";
import "./dispatch.css";

export interface WavePlanSheetProps {
  /** The epic whose plan is shown, or `null` when the sheet is closed. */
  epicId: string | null;
  onClose: () => void;
}

/** The dispatcher's display state for a task, in words. An unknown token is shown as it came. */
const STATE_LABEL: Record<string, string> = {
  planned: "Planned",
  waiting: "Waiting",
  running: "Running",
  finished: "Finished",
  merging: "Merging",
  merged: "Merged",
  conflict: "Merge conflict",
  needs_attention: "Needs you",
  failed: "Failed",
  stopped: "Stopped",
  held_by_limit: "Held by the account limit",
  skipped: "Left out",
};

/** The states that hold a wave until a human acts; the core's `STUCK_STATES`. */
const STUCK = new Set(["failed", "stopped", "conflict"]);

export const stateLabel = (state: string) => STATE_LABEL[state] ?? state;

export function WavePlanSheet({ epicId, onClose }: WavePlanSheetProps) {
  if (epicId === null) return null;
  return <OpenSheet epicId={epicId} onClose={onClose} />;
}

function OpenSheet({ epicId, onClose }: { epicId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const planQuery = useDispatchPlan(epicId);
  const plan = planQuery.data ?? null;
  const isDraft = plan?.status === "draft";

  // Text typed into a task's files field and not yet saved, by task id.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<{ taskId: string; text: string } | null>(null);
  const [whyText, setWhyText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const taskById = new Map((plan?.tasks ?? []).map((t) => [t.taskId, t]));
  const waves = [...new Set((plan?.tasks ?? []).map((t) => t.wave))].sort((a, b) => a - b);
  const waveOptions = Array.from({ length: (waves[waves.length - 1] ?? 0) + 1 }, (_, i) => i + 1);

  function accept(next: DispatchPlanDto) {
    queryClient.setQueryData(dispatchPlanKey(epicId), next);
  }

  async function edit(taskId: string, change: { wave?: number; entries?: string[] }) {
    if (!plan || busy) return;
    setBusy(true);
    try {
      accept(await dispatchPlanEdit(plan.id, [{ taskId, ...change }]));
      setRefusal(null);
    } catch (error) {
      // The core refused: show its words and leave the displayed set as stored.
      setRefusal({ taskId, text: errorText(error) });
    } finally {
      setDrafts((d) => {
        const { [taskId]: _dropped, ...rest } = d;
        return rest;
      });
      setBusy(false);
    }
  }

  async function leave(verb: typeof retryTask, taskId: string) {
    if (busy) return;
    setBusy(true);
    try {
      accept(await verb(taskId));
      setRefusal(null);
    } catch (error) {
      // The core's own refusal, shown on the task it concerns.
      setRefusal({ taskId, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!plan || approving) return;
    setApproving(true);
    setApproveError(null);
    try {
      accept(await dispatchPlanApprove(plan.id));
      onClose();
    } catch (error) {
      setApproveError(errorText(error));
      setApproving(false);
    }
  }

  async function askWhy(edge: DispatchEdgeDto) {
    if (!plan) return;
    const key = `${edge.beforeTaskId}:${edge.afterTaskId}`;
    try {
      const answer = await dispatchWhy(plan.id, edge.afterTaskId, edge.beforeTaskId);
      setWhyText((w) => ({ ...w, [key]: answer.sentence }));
    } catch (error) {
      setWhyText((w) => ({ ...w, [key]: errorText(error) }));
    }
  }

  const keyOf = (taskId: string) => taskById.get(taskId)?.taskKey ?? taskId;
  const titleOf = (taskId: string) => taskById.get(taskId)?.title ?? "";

  function renderTask(task: DispatchTaskDto) {
    const lines = drafts[task.taskId] ?? task.entries.join("\n");
    const dirty = drafts[task.taskId] !== undefined && drafts[task.taskId] !== task.entries.join("\n");
    return (
      <li key={task.taskId} aria-label={`${task.taskKey} ${task.title}`} className="wave-plan-task">
        <div className="wave-plan-task-head">
          <span className="type-label wave-plan-key">{task.taskKey}</span>
          <span className="type-body wave-plan-title">{task.title}</span>
          {!isDraft &&
            (task.state === "held_by_limit" ? (
              // The one wave-plan state drawn in a class (D-34): a limit hold reads as needs-you, like blocked.
              <StateBadge state={task.state} variant="wash" label={stateLabel(task.state)} />
            ) : (
              <span className="type-label wave-plan-state">{stateLabel(task.state)}</span>
            ))}
          {isDraft && task.state !== "skipped" && (
            <select
              aria-label={`Wave for ${task.taskKey}`}
              value={task.wave}
              disabled={busy}
              onChange={(event) => void edit(task.taskId, { wave: Number(event.target.value) })}
              className="control-edge type-label wave-plan-wave"
            >
              {waveOptions.map((n) => (
                <option key={n} value={n}>{`Wave ${n}`}</option>
              ))}
            </select>
          )}
        </div>
        {task.rationale && <p className="type-label wave-plan-note">{task.rationale}</p>}
        {task.attention && <p className="type-label wave-plan-attention">{task.attention}</p>}
        {!isDraft && STUCK.has(task.state) && (
          <div className="wave-plan-files">
            <button
              type="button"
              aria-label={`Retry ${task.taskKey}`}
              disabled={busy}
              onClick={() => void leave(retryTask, task.taskId)}
              className="control-edge session-action type-label"
            >
              Retry
            </button>
            <button
              type="button"
              aria-label={`Skip ${task.taskKey}`}
              disabled={busy}
              onClick={() => void leave(skipTask, task.taskId)}
              className="control-edge session-action type-label"
            >
              Skip
            </button>
          </div>
        )}
        {task.entries.length === 0 && task.state !== "skipped" && (
          <p className="type-label wave-plan-note">No files declared, so this task runs alone.</p>
        )}
        {isDraft && task.state !== "skipped" ? (
          <div className="wave-plan-files">
            <textarea
              aria-label={`Files for ${task.taskKey}`}
              value={lines}
              rows={Math.max(2, lines.split("\n").length)}
              disabled={busy}
              onChange={(event) => setDrafts((d) => ({ ...d, [task.taskId]: event.target.value }))}
              className="control-edge session-field launch-field type-body wave-plan-textarea"
            />
            <button
              type="button"
              aria-label={`Save files for ${task.taskKey}`}
              disabled={busy || !dirty}
              onClick={() =>
                void edit(task.taskId, {
                  entries: lines.split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
                })
              }
              className="control-edge session-action type-label"
            >
              Save files
            </button>
          </div>
        ) : (
          task.entries.length > 0 && (
            <ul className="wave-plan-entries">
              {task.entries.map((entry) => (
                <li key={entry}>
                  <code className="type-label">{entry}</code>
                </li>
              ))}
            </ul>
          )
        )}
        {refusal?.taskId === task.taskId && (
          <p role="alert" className="type-label wave-plan-refusal">
            {refusal.text}
          </p>
        )}
      </li>
    );
  }

  function renderPair(edge: DispatchEdgeDto) {
    const key = `${edge.beforeTaskId}:${edge.afterTaskId}`;
    return (
      <li key={key} aria-label={`${keyOf(edge.afterTaskId)} waits for ${keyOf(edge.beforeTaskId)}`} className="wave-plan-pair">
        <p className="type-body">
          <strong>{keyOf(edge.afterTaskId)}</strong> <span>{titleOf(edge.afterTaskId)}</span> waits for{" "}
          <strong>{keyOf(edge.beforeTaskId)}</strong> <span>{titleOf(edge.beforeTaskId)}</span>
          {edge.cause === "widen" ? " (after a live widen)" : ""}
        </p>
        <ul className="wave-plan-entries" aria-label="Colliding paths">
          {edge.collidingPaths.map((c) => (
            <li key={`${c.before}|${c.after}`} className="type-label">
              <code>{c.before}</code>
              {c.after !== c.before && (
                <>
                  {" and "}
                  <code>{c.after}</code>
                </>
              )}
            </li>
          ))}
        </ul>
        {!isDraft && (
          <button
            type="button"
            aria-label={`Why does ${keyOf(edge.afterTaskId)} wait?`}
            onClick={() => void askWhy(edge)}
            className="control-edge session-action type-label"
          >
            Why?
          </button>
        )}
        {whyText[key] && <p className="type-label wave-plan-note">{whyText[key]}</p>}
      </li>
    );
  }

  return createPortal(
    <FocusScope trapped loop asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onPointerDownOutside={onClose}
        asChild
      >
        <div role="presentation" className="launch-scrim">
          <div role="dialog" aria-label="Wave plan" className="launch-sheet wave-plan-sheet">
            <header className="wave-plan-header">
              <span className="type-heading">Wave plan</span>
              {plan && (
                <span className="type-label wave-plan-status">
                  {isDraft
                    ? "Draft. Nothing starts until you approve it."
                    : `${plan.status}. Read-only; the ordering below is what was recorded at approval.`}
                </span>
              )}
            </header>

            <div className="wave-plan-body">
              {planQuery.isPending && <p className="type-body">Loading the plan…</p>}
              {planQuery.isError && !plan && (
                <p role="alert" className="type-body wave-plan-refusal">
                  Could not load the plan. Close this sheet and try again.
                </p>
              )}
              {planQuery.isSuccess && !plan && <p className="type-body">This epic has no plan yet.</p>}
              {plan &&
                waves.map((wave) => {
                  const inWave = plan.tasks.filter((t) => t.wave === wave);
                  const pairs = plan.edges.filter(
                    (e) => taskById.get(e.afterTaskId)?.wave === wave && taskById.get(e.beforeTaskId)?.wave === wave,
                  );
                  return (
                    <section key={wave} role="region" aria-label={`Wave ${wave}`} className="wave-plan-wave-block">
                      <h3 className="type-heading">{`Wave ${wave}`}</h3>
                      <ul className="wave-plan-tasks">{inWave.map(renderTask)}</ul>
                      {pairs.length > 0 && (
                        <>
                          <p className="type-label wave-plan-note">
                            {plan.edgesFrozen
                              ? "Sequenced inside this wave, as recorded at approval:"
                              : "Sequenced inside this wave. Approval records these:"}
                          </p>
                          <ul className="wave-plan-pairs">{pairs.map(renderPair)}</ul>
                        </>
                      )}
                    </section>
                  );
                })}
              {approveError && (
                <p role="alert" className="type-body wave-plan-refusal">
                  {approveError}
                </p>
              )}
            </div>

            <div className="wave-plan-footer">
              <button type="button" onClick={onClose} className="control-edge session-action type-body">
                {isDraft ? "Cancel" : "Close"}
              </button>
              {isDraft && (
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={approving || busy}
                  className="control-edge session-action session-action-lead type-body"
                >
                  Approve and start
                </button>
              )}
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
