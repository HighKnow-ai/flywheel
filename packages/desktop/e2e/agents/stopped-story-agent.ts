/**
 * The scripted Story agent of the stopped-Story flow: its first session writes one Task and stays alive, because
 * the flow needs a session that is still `running` when the core dies. Its second session, the one a Resume starts,
 * writes nothing: the Resume note is in its packet, so the step is skipped, and the session stays alive until the
 * developer stops it. The staying alive is not in the script but in the environment of the run
 * (`FLYWHEEL_FAKE_AWAIT_INTERRUPT=1`, which makes `fake-claude.mjs` wait for an interrupt instead of exiting after
 * 50 ms).
 */
import type { AgentScript } from "../core";

/** What the developer types at Resume. The packet carries it as `Resume note: <note>`. */
export const RESUME_NOTE = "Pick up where the crash left off";

export const STOPPED_STORY_AGENT: AgentScript = [
  { unless: `Resume note: ${RESUME_NOTE}`, name: "task_add", arguments: { titles: ["Write the parser"] } },
];

export const STOPPED_STORY_ENV = { FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1" };
