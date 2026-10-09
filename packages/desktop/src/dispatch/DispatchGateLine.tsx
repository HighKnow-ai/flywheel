/**
 * The line that says why dispatch is waiting (plan 09-09, D-161, D-162).
 *
 * Open renders nothing: an always-present line that usually says "fine" trains the eye to ignore
 * it. Paused renders the reason the Rust core wrote plus a resume-now action, and tells the two
 * paused variants apart: with a reset instant it says when dispatch resumes; with none it says the
 * reset time is unknown and only a manual resume clears it, because that is what the gate does and a
 * hopeful "retrying soon" would be a lie. Warning renders the reason plus an advance-now action and
 * says the running wave will finish, which is the point of the tier.
 *
 * The reason is read from the response. The gate's state machine is in the core, and a second
 * wording of the same condition here would be a second source of truth about what the backend said.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { dispatchAdvanceNow, dispatchGateResumeNow } from "../adapters/tauri";
import { dispatchPlanKey, errorText, GATE_KEY, useDispatchGate } from "./queries";
import "./dispatch.css";

export interface DispatchGateLineProps {
  planId: string;
  /** The epic the plan belongs to, so an advance refreshes that epic's plan. */
  epicId?: string;
}

export function DispatchGateLine({ planId, epicId }: DispatchGateLineProps) {
  const queryClient = useQueryClient();
  const gateQuery = useDispatchGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = gateQuery.data;
  if (!gate || gate.state === "open") return null;

  async function act(call: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = "control-edge session-action type-label epic-dispatch-btn";
  return (
    <div role="status" aria-label="Dispatch gate" className="type-label epic-dispatch-gate">
      <span className="epic-dispatch-gate-text">
        <span>{gate.message}</span>{" "}
        {gate.state === "paused" ? (
          gate.resumeAt !== null ? (
            <span>{`Dispatch resumes ${new Date(gate.resumeAt * 1000).toLocaleString()}.`}</span>
          ) : (
            <span>The reset time is unknown. Only a manual resume will clear this.</span>
          )
        ) : (
          <span>The running wave will finish.</span>
        )}
      </span>
      {gate.state === "paused" ? (
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() =>
            void act(async () => {
              queryClient.setQueryData(GATE_KEY, await dispatchGateResumeNow());
            })
          }
        >
          Resume now
        </button>
      ) : (
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const plan = await dispatchAdvanceNow(planId);
              if (epicId) queryClient.setQueryData(dispatchPlanKey(epicId), plan);
            })
          }
        >
          Advance now
        </button>
      )}
      {error && (
        <span role="alert" className="epic-dispatch-error">
          {error}
        </span>
      )}
    </div>
  );
}
