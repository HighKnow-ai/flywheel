/**
 * The scripted agent of the fleet flow (UAT 12, `scripts/uat/uat-12-fleet-live-reads.mjs`): it makes
 * twenty commits and then stays alive, because the environment of the run says so
 * (`FLYWHEEL_FAKE_AWAIT_INTERRUPT=1`). Each commit prints one line to the session log, so a live run's
 * log is longer than the fleet's tail of 16 lines. A commit is not a board call: it is no step of the flow.
 */
import type { AgentScript } from "../core";

export const COMMITS = 20;
export const FLEET_AGENT: AgentScript = Array.from({ length: COMMITS }, (_, n) => ({
  commit: { path: `notes/n${String(n + 1).padStart(2, "0")}.txt`, content: `note ${n + 1}\n` },
}));

export const FLEET_ENV = { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" };
