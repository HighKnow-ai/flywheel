/**
 * Closing a Cycle (Phase 14, RECD-10, D-11): one row per unfinished epic, each offering exactly
 * three answers (move to a named later Cycle, return to no Cycle, leave it in this closed Cycle).
 * DRFT-07 makes the item the unit of acceptance, so there is NO control that applies a choice to
 * more than one row (no header control, no "same as above") and NO row starts with a choice: a
 * pre-selected default on every row would be a bulk accept wearing per-item clothing.
 *
 * The confirm stays disabled until every row is decided, and the dialog says in words how many are
 * not, so the gate is legible. The dialog is not the guarantee, though: the core refuses a close
 * with any unfinished epic undecided, whoever calls it. On confirm the cycle-region query is
 * invalidated and re-reads from the store of record; nothing is patched locally.
 *
 * Shape follows `DeleteConfirm.tsx` (dialog tier, focus trapped, Escape cancels). No colour is
 * declared here: the group-scoped styles live in `states-and-confirms.css`.
 */
import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQueryClient } from "@tanstack/react-query";
import { cycleClose, type EpicChoiceDto, type UnfinishedEpicDto } from "../adapters/tauri";
import { cycleRegionQueryKey } from "./useCycleRegionQuery";
import "../styles/states-and-confirms.css";

export interface CycleCloseDialogProps {
  projectId: string;
  cycleId: string;
  cycleGoal: string;
  epics: UnfinishedEpicDto[];
  /** The later Cycles an epic can be moved into. */
  targets: { id: string; key: string; goal: string }[];
  onDone: () => void;
  onCancel: () => void;
}

type Kind = EpicChoiceDto["choice"];
const CHOICES: { kind: Kind; label: string }[] = [
  { kind: "move_to", label: "Move to a later cycle" },
  { kind: "unassign", label: "Return to no cycle" },
  { kind: "leave_here", label: "Leave in this cycle" },
];

function undecidedSentence(n: number, total: number): string {
  if (total === 0) return "Every epic in this cycle is finished. There is nothing to decide.";
  if (n === 0) return "Every epic has a choice.";
  return n === 1 ? "1 epic still needs a choice." : `${n} epics still need a choice.`;
}

export function CycleCloseDialog({ projectId, cycleId, cycleGoal, epics, targets, onDone, onCancel }: CycleCloseDialogProps) {
  const queryClient = useQueryClient();
  const idBase = useId();
  // Both maps start empty: nothing is selected until the owner selects it.
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const answer = (epic: UnfinishedEpicDto): EpicChoiceDto | null => {
    const kind = kinds[epic.id];
    if (kind === "unassign" || kind === "leave_here") return { epicId: epic.id, choice: kind };
    if (kind === "move_to" && target[epic.id]) return { epicId: epic.id, choice: kind, targetCycleId: target[epic.id] };
    return null;
  };
  const answers = epics.map(answer);
  const undecided = answers.filter((a) => a === null).length;

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await cycleClose(cycleId, answers as EpicChoiceDto[]);
      await queryClient.invalidateQueries({ queryKey: cycleRegionQueryKey(projectId) });
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  let rows: ReactNode = null;
  if (epics.length > 0) {
    rows = (
      <ul className="cycle-close-rows">
        {epics.map((epic) => {
          const legendId = `${idBase}-${epic.id}`;
          return (
            <li key={epic.id}>
              <fieldset className="cycle-close-row">
                <legend id={legendId} className="type-body">
                  {epic.key} {epic.title}
                </legend>
                <div role="radiogroup" aria-labelledby={legendId} className="cycle-close-choices">
                  {CHOICES.map(({ kind, label }) => (
                    <label key={kind} className="type-body">
                      <input
                        type="radio"
                        name={`${idBase}-${epic.id}`}
                        checked={kinds[epic.id] === kind}
                        disabled={kind === "move_to" && targets.length === 0}
                        onChange={() => setKinds({ ...kinds, [epic.id]: kind })}
                      />{" "}
                      {label}
                    </label>
                  ))}
                </div>
                <select
                  className="type-body control-edge"
                  aria-label={`Which later cycle for ${epic.key}`}
                  value={target[epic.id] ?? ""}
                  disabled={kinds[epic.id] !== "move_to"}
                  onChange={(e) => setTarget({ ...target, [epic.id]: e.target.value })}
                >
                  <option value="">Choose a cycle</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.key} {t.goal}
                    </option>
                  ))}
                </select>
              </fieldset>
            </li>
          );
        })}
      </ul>
    );
  }

  return createPortal(
    <FocusScope trapped loop asChild>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
        onPointerDownOutside={onCancel}
        asChild
      >
        <div role="dialog" aria-label={`Close cycle ${cycleGoal}`} className="confirm-scrim">
          <div className="type-body confirm-dialog confirm-dialog-wide">
            <h2 className="type-heading">Close "{cycleGoal}"?</h2>
            {epics.length > 0 && <p className="type-body">Decide what happens to each unfinished epic.</p>}
            {rows}
            <p role="status" className="type-body">
              {undecidedSentence(undecided, epics.length)}
            </p>
            {failed && (
              <p role="alert" className="type-body">
                The cycle could not be closed. Nothing was changed.
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" autoFocus className="type-body control-edge confirm-action" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="type-body control-edge confirm-action"
                disabled={undecided > 0 || busy}
                onClick={confirm}
              >
                Close cycle
              </button>
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
