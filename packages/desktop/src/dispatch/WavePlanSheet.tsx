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
 * Approve is the only action that starts dispatch, and it is also the file-sets' accept: the declared
 * sets are live from the moment the planner submits them (restrictive only), and approval freezes
 * what they sequence (D-18). A plan that is not a draft is read-only.
 *
 * A task's files have two editors over ONE value: the chip row (the draft, corrected) and the
 * hand-typed textarea (the escape hatch, never prefilled). Both write through `edit(taskId, { entries })`.
 * Who declared the set, and whether that was the planner, is the core's derivation from the event
 * log (D-19); the renderer shows the boolean it is given.
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
import {
  dispatchPlanKey,
  errorText,
  fileSetProvenanceKey,
  useDispatchPlan,
  useFileSetProvenance,
  useTrackedPaths,
} from "./queries";
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

  // Text typed into a task's hand-typed files field and not yet saved, by task id. Never prefilled.
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

  /** Resolves true when the core accepted the edit, so a caller can keep what it typed on a refusal. */
  async function edit(taskId: string, change: { wave?: number; entries?: string[] }, clearDraft = false) {
    if (!plan || busy) return false;
    setBusy(true);
    try {
      accept(await dispatchPlanEdit(plan.id, [{ taskId, ...change }]));
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: fileSetProvenanceKey(taskId) });
      return true;
    } catch (error) {
      // The core refused: show its words and leave the displayed set as stored.
      setRefusal({ taskId, text: errorText(error) });
      return false;
    } finally {
      if (clearDraft) {
        setDrafts((d) => {
          const { [taskId]: _dropped, ...rest } = d;
          return rest;
        });
      }
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
    const lines = drafts[task.taskId] ?? "";
    const dirty = lines.trim() !== "";
    const editable = isDraft && task.state !== "skipped";
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
        {plan && (
          <FileSetChips
            planId={plan.id}
            task={task}
            editable={editable}
            busy={busy}
            onChange={(entries) => edit(task.taskId, { entries })}
          />
        )}
        {editable && (
          <>
            <p className="type-label wave-plan-note">
              Or type the paths by hand, one per line. This replaces the declared files when you save.
            </p>
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
                  void edit(
                    task.taskId,
                    { entries: lines.split("\n").map((l) => l.trim()).filter((l) => l.length > 0) },
                    true,
                  )
                }
                className="control-edge session-action type-label"
              >
                Save files
              </button>
            </div>
          </>
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
              {isDraft && (
                <p className="type-label wave-plan-approve-note">
                  Approving accepts the declared file-sets as they now stand and freezes the colliding paths that
                  sequence the waves.
                </p>
              )}
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

/** The most suggestions the add control offers at once. */
const SUGGESTION_LIMIT = 50;

/**
 * One task's declared files as chips, with the planner's mark, the undeclared sentence and (for a
 * draft) the add control. It decides nothing about what a legal entry is: a typed value goes to
 * `onChange` as it is, and the core's refusal text is what the sheet shows. Suggestions come from
 * `git ls-files` through the adapter and are only suggestions.
 */
function FileSetChips({
  planId,
  task,
  editable,
  busy,
  onChange,
}: {
  planId: string;
  task: DispatchTaskDto;
  editable: boolean;
  busy: boolean;
  onChange: (entries: string[]) => Promise<boolean>;
}) {
  const provenance = useFileSetProvenance(task.taskId).data ?? null;
  const tracked = useTrackedPaths(planId, editable).data;
  const [typed, setTyped] = useState("");

  const needle = typed.trim().toLowerCase();
  const suggestions =
    needle === "" || !tracked ? [] : tracked.paths.filter((p) => p.toLowerCase().includes(needle)).slice(0, SUGGESTION_LIMIT);
  const undeclared = provenance?.undeclared === true && task.entries.length === 0;
  const listId = `tracked-paths-${task.taskId}`;

  async function add() {
    const value = typed.trim();
    if (value === "" || busy) return;
    if (await onChange([...task.entries, value])) setTyped("");
  }

  return (
    <div className="wave-plan-chip-block">
      {task.entries.length > 0 && (
        <div className="wave-plan-chip-row">
          <ul aria-label={`Declared files for ${task.taskKey}`} className="wave-plan-chips">
            {task.entries.map((entry, index) => (
              <li key={entry} className="wave-plan-chip">
                <code className="type-label">{entry}</code>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${entry} from ${task.taskKey}`}
                    disabled={busy}
                    onClick={() => void onChange(task.entries.filter((_, i) => i !== index))}
                    className="wave-plan-chip-remove type-label"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {provenance?.draftedByAgent === true && (
            <span className="type-label wave-plan-chip-mark">drafted by the planner</span>
          )}
        </div>
      )}
      {undeclared && (
        <p className="type-label wave-plan-note">
          The planner could not determine which files this task touches.
          {editable ? " Add them here or type them below." : ""}
        </p>
      )}
      {editable && (
        <div className="wave-plan-files">
          <input
            type="text"
            list={listId}
            aria-label={`Add a file to ${task.taskKey}`}
            value={typed}
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
            }}
            className="control-edge session-field launch-field type-body wave-plan-chip-input"
          />
          <datalist id={listId}>
            {suggestions.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          <button
            type="button"
            aria-label={`Add file to ${task.taskKey}`}
            disabled={busy || typed.trim() === ""}
            onClick={() => void add()}
            className="control-edge session-action type-label"
          >
            Add
          </button>
        </div>
      )}
      {editable && tracked && tracked.notShown > 0 && (
        <p className="type-label wave-plan-note">
          {`${tracked.notShown} tracked paths are not offered as suggestions; type them in full.`}
        </p>
      )}
    </div>
  );
}
