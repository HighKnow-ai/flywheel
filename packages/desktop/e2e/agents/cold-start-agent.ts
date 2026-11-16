/**
 * The scripted Story agent of the cold-start flow: it writes one Task and then stays alive, because
 * the flow needs a session that is still `running` when the core dies. The staying alive is not in
 * the script but in the environment of the run (`FLYWHEEL_FAKE_AWAIT_INTERRUPT=1`, which makes
 * `fake-claude.mjs` wait for an interrupt instead of exiting after 50 ms).
 */
import type { AgentScript } from "../core";

export const COLD_START_AGENT: AgentScript = [{ name: "task_add", arguments: { titles: ["Write the parser"] } }];

export const COLD_START_ENV = { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" };
