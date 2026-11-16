/**
 * The agent of the supervision flow (`scripts/uat/harness-supervision-gate.mjs`): it does nothing and
 * stays alive, because the environment of the run says so (`FLYWHEEL_FAKE_AWAIT_INTERRUPT=1`, a 30 s
 * safety exit aside). What the flow tests is the core's heartbeat, not the agent.
 */
import type { AgentScript } from "../core";

export const SUPERVISED_AGENT: AgentScript = [];

export const SUPERVISED_ENV = { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" };
