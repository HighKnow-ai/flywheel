/**
 * The epic row's dispatch controls (plan 09-09, D-149, D-155): start a fan-out, review its draft,
 * and pause, resume or stop it once it runs.
 *
 * The control is a function of the plan the Rust core reports. Each action is one call through the
 * adapter module and is disabled while it is in flight; the next state shown is the call's own
 * response, never a local guess, because the core may refuse and the renderer holds no authority
 * over plan state. Pause and stop change what is STARTED. They do not touch a running session, and
 * the wording says so, because "stop starting things" and "kill what is running" are different
 * choices and only the first is on offer here.
 *
 * What is running against the cap is `settings_get`'s occupancy (counted by the core), not a count
 * made here. A stuck task in the current wave is named, so a wave that cannot move does not look
 * like a slow one.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  dispatchPlanGenerate,
  dispatchPlanPause,
  dispatchPlanResume,
  dispatchPlanStop,
  type DispatchPlanDto,
} from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { Icon } from "../board/BoardRow";
import { useUiStore } from "../state/uiStore";
import { DispatchGateLine } from "./DispatchGateLine";
import { dispatchPlanKey, errorText, planningRunKey, useDispatchCap, useDispatchPlan, usePlanningRun } from "./queries";
import "./dispatch.css";

export interface EpicDispatchControlsProps {
  epicId: string;
}

/** The plan statuses that mean a plan is in force or waiting for approval (the core's one-live-plan index). */
const LIVE_STATUSES = ["draft", "approved", "running", "paused"];
/** Task display states that hold their wave until the user acts. */
const STUCK_STATES = ["needs_attention", "failed", "stopped", "conflict", "held_by_limit"];

const PAUSE_TITLE = "Stop starting new work. Running sessions are not stopped.";
const STOP_TITLE = "End the fan-out. Running sessions are not stopped.";

export function EpicDispatchControls({ epicId }: EpicDispatchControlsProps) {
  const queryClient = useQueryClient();
  const setWavePlanSheetEpicId = useUiStore((state) => state.setWavePlanSheetEpicId);
  const planQuery = useDispatchPlan(epicId);
  const runQuery = usePlanningRun(epicId);
  const plan = planQuery.data && LIVE_STATUSES.includes(planQuery.data.status) ? planQuery.data : null;
  const inForce = plan?.status === "running" || plan?.status === "approved" || plan?.status === "paused";
  const capQuery = useDispatchCap(plan?.status === "running" || plan?.status === "approved");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  async function act<T>(call: () => Promise<T>, accept: (result: T) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      accept(await call());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const acceptPlan = (dto: DispatchPlanDto) => queryClient.setQueryData(dispatchPlanKey(epicId), dto);

  // Unknown is not a zero: say nothing until a plan read has landed. `null` is a landed read ("no plan");
  // a failed refetch keeps the data it had, so it does not blank the controls.
  if (planQuery.data === undefined) return null;

  const btn = "control-edge session-action type-label epic-dispatch-btn";
  let status: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (!plan) {
    if (runQuery.data) {
      status = <span role="status">Planning in progress. A draft appears here when it is ready.</span>;
    } else {
      actions = (
        <button
          type="button"
          className={btn}
          disabled={busy}
          title="Ask an agent to read the repository and draft which tasks can run together. Nothing starts until you approve."
          onClick={() =>
            void act(
              () => dispatchPlanGenerate(epicId),
              (run) => queryClient.setQueryData(planningRunKey(epicId), run),
            )
          }
        >
          Plan fan-out
        </button>
      );
    }
  } else if (plan.status === "draft") {
    status = <span>Draft plan, not started</span>;
    actions = (
      <button type="button" className={btn} onClick={() => setWavePlanSheetEpicId(epicId)}>
        Review plan
      </button>
    );
  } else if (inForce) {
    const lastWave = Math.max(...plan.tasks.map((t) => t.wave));
    const stuck = plan.tasks.filter((t) => t.wave === plan.waveCursor && STUCK_STATES.includes(t.state));
    const cap = capQuery.data;
    if (confirmingStop) {
      status = <span>Stop starting new work? Running sessions keep going; nothing is interrupted.</span>;
      actions = (
        <>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() =>
              void act(
                () => dispatchPlanStop(plan.id),
                (dto) => {
                  acceptPlan(dto);
                  setConfirmingStop(false);
                },
              )
            }
          >
            Stop the fan-out
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => setConfirmingStop(false)}>
            Keep the plan
          </button>
        </>
      );
    } else {
      status = (
        <>
          <span title={MARKS_BY_ID["epic-dispatch-wave"]?.meaning} className="epic-dispatch-wave">
            <Icon name={MARKS_BY_ID["epic-dispatch-wave"]?.glyph ?? "Layers"} size={12} />
            <span>{`Wave ${plan.waveCursor} of ${lastWave}`}</span>
          </span>
          {plan.status === "paused" && <span>Paused: no new work starts</span>}
          {cap && <span>{`${cap.occupiedSlots} of ${cap.maxParallel} agent slots in use`}</span>}
          {stuck.length > 0 && <span>{`${stuck.length} stuck: ${stuck.map((t) => t.taskKey).join(", ")}`}</span>}
        </>
      );
      actions = (
        <>
          {plan.status === "paused" ? (
            <button
              type="button"
              className={btn}
              disabled={busy}
              title="Continue starting work."
              onClick={() => void act(() => dispatchPlanResume(plan.id), acceptPlan)}
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              disabled={busy}
              title={PAUSE_TITLE}
              onClick={() => void act(() => dispatchPlanPause(plan.id), acceptPlan)}
            >
              Pause
            </button>
          )}
          <button type="button" className={btn} disabled={busy} title={STOP_TITLE} onClick={() => setConfirmingStop(true)}>
            Stop
          </button>
          <button type="button" className={btn} onClick={() => setWavePlanSheetEpicId(epicId)}>
            Open plan
          </button>
        </>
      );
    }
  }

  return (
    <div
      className="epic-dispatch field-epic-dispatch"
      data-slot="dispatch"
      // The row toggles and opens on click, double-click and keys; none of those are meant for these.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {/* The gate is account-wide but only matters to a plan that is starting work. */}
      {plan && (plan.status === "running" || plan.status === "approved") && !confirmingStop && (
        <DispatchGateLine planId={plan.id} epicId={epicId} />
      )}
      {status && <div className="type-label epic-dispatch-line">{status}</div>}
      {actions && <div className="epic-dispatch-actions">{actions}</div>}
      {error && (
        <div role="alert" className="type-label epic-dispatch-error">
          {error}
        </div>
      )}
    </div>
  );
}
