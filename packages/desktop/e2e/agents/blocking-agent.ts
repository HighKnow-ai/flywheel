/**
 * The agent of the blocked-queue flow (UAT 12, D-REV-50): it asks for one permission and waits for the
 * answer. The asking is not in the script but in the environment of the run (`FLYWHEEL_FAKE_CALL_PERMISSION=1`),
 * which makes `fake-claude.mjs` call the permission tool of its own MCP server, as the real backend does.
 */
import type { AgentScript } from "../core";

export const BLOCKING_AGENT: AgentScript = [];

export const BLOCKING_ENV = { FLYWHEEL_FAKE_CALL_PERMISSION: "1" };
