/**
 * Plan 05-02 (D-80/D-81) — proves the `propose_task` write surface at the wire level, mirroring
 * `summary-report.test.mjs`'s own precedent: deliberately small and spawn-free where possible.
 *
 * Five things this file proves:
 *   1. `proposeTaskToolDefinition`'s `inputSchema` declares both `title` and `description`, and
 *      marks `title` required.
 *   2. `AUTHORING_PROPOSE_TASK_TOOL_NAME` evaluates to exactly
 *      `mcp__flywheel-permissions__propose_task`.
 *   3. The socket payload `buildProposeTaskPayload` builds for a tool call carries no
 *      `runId`/`projectId`/`epicId` field anywhere.
 *   4. A malformed call (empty title) is rejected BEFORE any socket write — `buildProposeTaskPayload`
 *      throws synchronously, never returning a payload to write.
 *   5. `buildAuthoringClaudeArgv` for an authoring spawn pushes the proposal tool onto
 *      `--allowedTools`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTHORING_PROPOSE_TASK_TOOL_NAME,
  buildProposeTaskPayload,
  MCP_SERVER_NAME,
  proposeTaskToolDefinition,
} from "../dist/mcp-permission-server.js";
import { buildAuthoringClaudeArgv } from "../dist/claude-code-adapter.js";

test("proposeTaskToolDefinition's inputSchema declares title and description, marking title required", () => {
  assert.equal(proposeTaskToolDefinition.name, "propose_task");
  const properties = Object.keys(proposeTaskToolDefinition.inputSchema.properties);
  assert.ok(properties.includes("title"), "expected a title property");
  assert.ok(properties.includes("description"), "expected a description property");
  assert.deepEqual(proposeTaskToolDefinition.inputSchema.required, ["title"]);
});

test("AUTHORING_PROPOSE_TASK_TOOL_NAME evaluates to exactly mcp__flywheel-permissions__propose_task", () => {
  assert.equal(MCP_SERVER_NAME, "flywheel-permissions");
  assert.equal(AUTHORING_PROPOSE_TASK_TOOL_NAME, "mcp__flywheel-permissions__propose_task");
});

test("the socket payload built for a tool call carries no runId/projectId/epicId field anywhere", () => {
  const payload = buildProposeTaskPayload({ title: "Write the doc", description: "explain it" });
  const serialised = JSON.stringify(payload);
  assert.ok(!/"runId"|"run_id"|"projectId"|"project_id"|"epicId"|"epic_id"/.test(serialised), serialised);
  assert.equal(payload.kind, "authoring_proposal");
  assert.equal(payload.verb, "create");
  assert.equal(payload.targetType, "task");
  assert.deepEqual(payload.payload, { kind: "task", title: "Write the doc", description: "explain it" });
});

test("a malformed call (empty title) is rejected before any socket write", () => {
  assert.throws(() => buildProposeTaskPayload({ title: "" }), /non-empty title/);
  assert.throws(() => buildProposeTaskPayload({ title: "   " }), /non-empty title/);
  assert.throws(() => buildProposeTaskPayload({}), /non-empty title/);
});

test("buildAuthoringClaudeArgv for an authoring spawn pushes the proposal tool onto --allowedTools", () => {
  const argv = buildAuthoringClaudeArgv({
    permissionMode: "default",
    permissionPromptToolName: "mcp__flywheel-permissions__approve_action",
    mcpConfig: "{}",
    proposeTaskToolName: AUTHORING_PROPOSE_TASK_TOOL_NAME,
  });
  assert.deepEqual(argv, [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "default",
    "--permission-prompt-tool",
    "mcp__flywheel-permissions__approve_action",
    "--mcp-config",
    "{}",
    "--allowedTools",
    AUTHORING_PROPOSE_TASK_TOOL_NAME,
  ]);

  // No positional prompt anywhere — Option A's turns arrive over stdin, never argv (05-SPIKE-
  // FINDINGS.md's transport_decision: option-a line).
  const bare = buildAuthoringClaudeArgv({ permissionMode: "default" });
  assert.deepEqual(bare, [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "default",
  ]);
});
