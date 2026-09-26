/**
 * Plan 05-05 (D-80/D-81/D-87), widened plan 05-44 (gap G-05-9) — proves the write-tool and
 * read-tool surfaces at the wire level, sibling of `authoring-proposal-wire.test.mjs` (plan 05-02,
 * left unchanged in spirit — extended only where `buildAuthoringClaudeArgv`'s own signature changed
 * under it).
 *
 * Eight+ things this file proves:
 *   1. All six write tools carry a propose_/amend_/delete_ prefix and match plan 05-03's
 *      stage-gate matcher regex; the permission/summary/read tool names do not.
 *   2. Every write tool's inputSchema declares the required array the plan specifies.
 *   3. A malformed call to each of the six write tools is rejected before any socket write.
 *   4. propose_criterion without parent_proposal_id is rejected.
 *   5. No write tool schema declares a run_id/project_id/epic_id property.
 *   6. --allowedTools for an authoring spawn carries exactly the TEN authoring tools (plan 05-44
 *      added `proposal_list`); an ordinary task spawn carries none of them.
 *   7. amend_proposal/delete_proposal require a target_id of exactly 26 characters.
 *   8. delete_proposal requires a non-empty reason.
 *   9. The FOUR read tools' names sit outside the write matcher's regex, and each declares limit
 *      (epic_get excepted — a single-row lookup).
 *  10. authoring_turn (plan 05-05 Task 3): the op routes to sendAuthoringTurn; an unknown run id
 *      rejects with UnknownRunError; a closed session resolves rather than throwing.
 *  11. Plan 05-44: `proposal_list`'s emitted `readKind` agrees with the Rust dispatch's own match
 *      arm — asserted from the side that writes, read out of both shipped sources, never
 *      hand-fabricated on either side.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AMEND_PROPOSAL_TOOL_NAME,
  amendProposalToolDefinition,
  AUTHORING_AMEND_PROPOSAL_TOOL_NAME,
  AUTHORING_BOARD_SEARCH_TOOL_NAME,
  AUTHORING_DELETE_PROPOSAL_TOOL_NAME,
  AUTHORING_EPIC_GET_TOOL_NAME,
  AUTHORING_PROPOSAL_LIST_TOOL_NAME,
  AUTHORING_PROPOSE_ASSUMPTION_TOOL_NAME,
  AUTHORING_PROPOSE_CRITERION_TOOL_NAME,
  AUTHORING_PROPOSE_EPIC_TOOL_NAME,
  AUTHORING_PROPOSE_TASK_TOOL_NAME,
  AUTHORING_READ_TOOL_NAMES,
  AUTHORING_TASK_LIST_TOOL_NAME,
  AUTHORING_WRITE_TOOL_NAMES,
  boardSearchToolDefinition,
  buildAmendProposalPayload,
  buildDeleteProposalPayload,
  buildProposeAssumptionPayload,
  buildProposeCriterionPayload,
  buildProposeEpicPayload,
  buildProposeTaskPayload,
  DELETE_PROPOSAL_TOOL_NAME,
  deleteProposalToolDefinition,
  epicGetToolDefinition,
  MCP_SERVER_NAME,
  PERMISSION_TOOL_NAME,
  PROPOSAL_LIST_TOOL_NAME,
  proposalListToolDefinition,
  PROPOSE_ASSUMPTION_TOOL_NAME,
  proposeAssumptionToolDefinition,
  PROPOSE_CRITERION_TOOL_NAME,
  proposeCriterionToolDefinition,
  PROPOSE_EPIC_TOOL_NAME,
  proposeEpicToolDefinition,
  proposeTaskToolDefinition,
  startPermissionServer,
  SUMMARY_TOOL_NAME,
  taskListToolDefinition,
} from "../dist/mcp-permission-server.js";
import {
  AUTHORING_STAGE_GATE_MATCHER,
  buildAuthoringClaudeArgv,
  ClaudeCodeAdapter,
} from "../dist/claude-code-adapter.js";
import { UnknownRunError } from "../dist/adapter.js";
import { waitForListening } from "./socket-test-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
const A_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // 26 chars — a plausible-shaped target id
const STAGE_GATE_MATCHER = new RegExp(AUTHORING_STAGE_GATE_MATCHER);

test("all six write tools carry a propose_/amend_/delete_ prefix and match the stage-gate matcher; permission/summary/read tools do not", () => {
  const writeNames = [
    AUTHORING_PROPOSE_EPIC_TOOL_NAME,
    AUTHORING_PROPOSE_TASK_TOOL_NAME,
    AUTHORING_PROPOSE_CRITERION_TOOL_NAME,
    AUTHORING_PROPOSE_ASSUMPTION_TOOL_NAME,
    AUTHORING_AMEND_PROPOSAL_TOOL_NAME,
    AUTHORING_DELETE_PROPOSAL_TOOL_NAME,
  ];
  assert.deepEqual(writeNames, [...AUTHORING_WRITE_TOOL_NAMES]);
  for (const name of writeNames) {
    assert.ok(STAGE_GATE_MATCHER.test(name), `expected ${name} to match the stage-gate matcher`);
  }

  const nonWriteNames = [
    PERMISSION_TOOL_NAME,
    SUMMARY_TOOL_NAME,
    AUTHORING_BOARD_SEARCH_TOOL_NAME,
    AUTHORING_EPIC_GET_TOOL_NAME,
    AUTHORING_TASK_LIST_TOOL_NAME,
  ];
  for (const name of nonWriteNames) {
    assert.ok(!STAGE_GATE_MATCHER.test(name), `expected ${name} NOT to match the stage-gate matcher`);
  }
});

test("every write tool's inputSchema declares the required array the plan specifies", () => {
  assert.deepEqual(proposeEpicToolDefinition.inputSchema.required, ["title"]);
  assert.deepEqual(proposeTaskToolDefinition.inputSchema.required, ["title"]);
  assert.deepEqual(proposeCriterionToolDefinition.inputSchema.required, ["statement", "parent_proposal_id"]);
  assert.deepEqual(proposeAssumptionToolDefinition.inputSchema.required, ["assumption"]);
  assert.deepEqual(amendProposalToolDefinition.inputSchema.required, ["target_id", "target_type"]);
  assert.deepEqual(deleteProposalToolDefinition.inputSchema.required, ["target_id", "target_type", "reason"]);
});

test("a malformed call to each of the six write tools is rejected before any socket write", () => {
  assert.throws(() => buildProposeEpicPayload({ title: "" }), /non-empty title/);
  assert.throws(() => buildProposeTaskPayload({ title: "   " }), /non-empty title/);
  assert.throws(() => buildProposeCriterionPayload({ statement: "", parent_proposal_id: A_ULID }), /non-empty statement/);
  assert.throws(() => buildProposeAssumptionPayload({ assumption: "" }), /non-empty assumption/);
  assert.throws(
    () => buildAmendProposalPayload({ target_id: A_ULID, target_type: "task", title: "" }),
    /non-empty title/,
  );
  assert.throws(
    () => buildDeleteProposalPayload({ target_id: A_ULID, target_type: "task", reason: "" }),
    /non-empty reason/,
  );
});

test("propose_criterion without parent_proposal_id is rejected", () => {
  assert.throws(
    () => buildProposeCriterionPayload({ statement: "a checkable statement" }),
    /non-empty parent_proposal_id/,
  );
  assert.throws(
    () => buildProposeCriterionPayload({ statement: "a checkable statement", parent_proposal_id: "" }),
    /non-empty parent_proposal_id/,
  );
});

test("no write tool schema declares a run_id/project_id/epic_id property", () => {
  const definitions = [
    proposeEpicToolDefinition,
    proposeTaskToolDefinition,
    proposeCriterionToolDefinition,
    proposeAssumptionToolDefinition,
    amendProposalToolDefinition,
    deleteProposalToolDefinition,
  ];
  for (const definition of definitions) {
    const properties = Object.keys(definition.inputSchema.properties);
    for (const forbidden of ["runId", "run_id", "projectId", "project_id", "epicId", "epic_id"]) {
      assert.ok(
        !properties.includes(forbidden),
        `expected ${definition.name} to declare no ${forbidden} property`,
      );
    }
  }
});

test("--allowedTools for an authoring spawn carries exactly the ten authoring tools; an ordinary task spawn carries none of them", () => {
  const allTen = [...AUTHORING_WRITE_TOOL_NAMES, ...AUTHORING_READ_TOOL_NAMES];
  assert.equal(allTen.length, 10);

  const argv = buildAuthoringClaudeArgv({
    permissionMode: "default",
    permissionPromptToolName: PERMISSION_TOOL_NAME,
    mcpConfig: "{}",
    authoringToolNames: allTen,
  });
  const allowedToolsIndex = argv.indexOf("--allowedTools");
  assert.ok(allowedToolsIndex !== -1, "expected --allowedTools to be present");
  assert.deepEqual(argv.slice(allowedToolsIndex + 1), allTen);

  const bareArgv = buildAuthoringClaudeArgv({ permissionMode: "default" });
  assert.ok(!bareArgv.includes("--allowedTools"), "an ordinary/bare spawn must carry none of them");
});

test("amend_proposal/delete_proposal require a target_id that is exactly 26 characters", () => {
  assert.throws(
    () => buildAmendProposalPayload({ target_id: "too-short", target_type: "task", title: "x" }),
    /exactly 26 characters/,
  );
  assert.throws(
    () => buildDeleteProposalPayload({ target_id: "", target_type: "task", reason: "no longer needed" }),
    /exactly 26 characters/,
  );
  // The happy path does not throw for a well-shaped 26-character id.
  const amended = buildAmendProposalPayload({ target_id: A_ULID, target_type: "criterion", statement: "revised" });
  assert.equal(amended.targetId, A_ULID);
  assert.equal(amended.verb, "amend");
});

test("delete_proposal requires a non-empty reason and carries it on the wire payload", () => {
  assert.throws(
    () => buildDeleteProposalPayload({ target_id: A_ULID, target_type: "epic" }),
    /non-empty reason/,
  );
  const deleted = buildDeleteProposalPayload({ target_id: A_ULID, target_type: "epic", reason: "duplicate of FLY-3" });
  assert.equal(deleted.verb, "delete");
  assert.equal(deleted.reason, "duplicate of FLY-3");
  assert.equal(deleted.targetId, A_ULID);
});

test("the four read tools' names sit outside the write matcher's regex, and each declares limit (epic_get excepted)", () => {
  const readNames = [
    AUTHORING_BOARD_SEARCH_TOOL_NAME,
    AUTHORING_EPIC_GET_TOOL_NAME,
    AUTHORING_TASK_LIST_TOOL_NAME,
    AUTHORING_PROPOSAL_LIST_TOOL_NAME,
  ];
  assert.deepEqual(readNames, [...AUTHORING_READ_TOOL_NAMES]);
  for (const name of readNames) {
    assert.ok(!STAGE_GATE_MATCHER.test(name), `expected ${name} NOT to match the stage-gate matcher`);
  }
  assert.ok("limit" in boardSearchToolDefinition.inputSchema.properties);
  assert.ok("limit" in taskListToolDefinition.inputSchema.properties);
  assert.ok("limit" in proposalListToolDefinition.inputSchema.properties);
  // epic_get is a single-row lookup — no limit property is expected or required.
  assert.ok(!("limit" in epicGetToolDefinition.inputSchema.properties));
});

/**
 * Plan 05-44 (Task 3, gap G-05-9): the two-sided read-kind contract — asserted from the side that
 * WRITES, never hand-fabricated on both sides (the seventh rule `scripts/uat/README.md` Item 8
 * records from the previous round: a test that hand-writes both sides of a contract proves nothing
 * about the product). `PROPOSAL_LIST_TOOL_NAME`'s own `CallToolRequestSchema` branch lives inside
 * `runStandaloneServer`'s unexported closure — reachable only by spawning this module as a
 * subprocess — so, per this task's own documented fallback ("if the handler cannot be driven in
 * isolation, the exported definition plus the one literal the branch passes"), this test reads the
 * ONE `readKind` literal that branch actually passes to `requestBoardRead` directly out of the
 * shipped TypeScript source, and the match arm it must agree with directly out of the shipped Rust
 * source — never retyping either string as a hand-written literal in this test.
 */
test("proposal_list's emitted readKind agrees with the Rust dispatch's own match arm", () => {
  const sidecarSourcePath = path.join(__dirname, "..", "src", "mcp-permission-server.ts");
  const sidecarSource = readFileSync(sidecarSourcePath, "utf8");
  const branchMatch = sidecarSource.match(
    /request\.params\.name === PROPOSAL_LIST_TOOL_NAME\)\s*\{[\s\S]*?readKind:\s*"([^"]+)"/,
  );
  assert.ok(
    branchMatch,
    `expected to find PROPOSAL_LIST_TOOL_NAME's own requestBoardRead call with a readKind ` +
      `literal in ${sidecarSourcePath}`,
  );
  const emittedReadKind = branchMatch[1];

  const rustSourcePath = path.join(__dirname, "..", "..", "core", "src", "query", "authoring.rs");
  const rustSource = readFileSync(rustSourcePath, "utf8");
  assert.ok(
    rustSource.includes(`"${emittedReadKind}" =>`),
    `expected ${rustSourcePath} to declare a "${emittedReadKind}" match arm — the sidecar emits ` +
      `this exact string, read from its own shipped source, never hand-copied`,
  );
  assert.equal(emittedReadKind, "list_proposals");
});

test("board_search/task_list/proposal_list tool names are outside the propose_/amend_/delete_ prefix literally", () => {
  assert.ok(!AUTHORING_BOARD_SEARCH_TOOL_NAME.includes("propose_"));
  assert.ok(!AUTHORING_TASK_LIST_TOOL_NAME.includes("amend_"));
  assert.ok(!AUTHORING_EPIC_GET_TOOL_NAME.includes("delete_"));
  assert.ok(!AUTHORING_PROPOSAL_LIST_TOOL_NAME.includes("propose_"));
  assert.equal(proposalListToolDefinition.name, PROPOSAL_LIST_TOOL_NAME);
  assert.equal(AUTHORING_PROPOSAL_LIST_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${PROPOSAL_LIST_TOOL_NAME}`);
});

test("every write tool's fully-qualified name is composed from MCP_SERVER_NAME, never hand-written", () => {
  assert.equal(AUTHORING_PROPOSE_EPIC_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${PROPOSE_EPIC_TOOL_NAME}`);
  assert.equal(AUTHORING_PROPOSE_CRITERION_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${PROPOSE_CRITERION_TOOL_NAME}`);
  assert.equal(AUTHORING_PROPOSE_ASSUMPTION_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${PROPOSE_ASSUMPTION_TOOL_NAME}`);
  assert.equal(AUTHORING_AMEND_PROPOSAL_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${AMEND_PROPOSAL_TOOL_NAME}`);
  assert.equal(AUTHORING_DELETE_PROPOSAL_TOOL_NAME, `mcp__${MCP_SERVER_NAME}__${DELETE_PROPOSAL_TOOL_NAME}`);
});

// ---------------------------------------------------------------------------------------------
// Task 3 (D-89): authoring_turn — the one way anything above the adapter can say something to a
// live authoring session.
// ---------------------------------------------------------------------------------------------

test("sendAuthoringTurn rejects an unknown run id with UnknownRunError before anything is written", async () => {
  const adapter = new ClaudeCodeAdapter();
  await assert.rejects(
    () => adapter.sendAuthoringTurn("no-such-run-id", "hello"),
    (err) => err instanceof UnknownRunError,
  );
});

test("sendAuthoringTurn resolves (does not throw) for a session that has already closed", async () => {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  try {
    const adapter = new ClaudeCodeAdapter();
    const runId = `authoring-turn-closed-${Date.now()}`;
    const events = [];

    // fake-claude.mjs's default (non-stubborn) mode prints its fixed three lines and exits on its
    // own — this call resolves once that happens, mirroring startSession's own contract.
    await adapter.startAuthoringSession({
      runId,
      repoPath: __dirname,
      prompt: "I want to shape a new epic.",
      permissionMode: "default",
      onEvent: (event) => events.push(event),
    });

    await assert.doesNotReject(() => adapter.sendAuthoringTurn(runId, "are you still there?"));
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

test("sendAuthoringTurn delivers a turn to a LIVE authoring session without throwing — the authoring_turn sidecar op's own destination", async () => {
  // index.ts's own "authoring_turn" case is a thin pass-through to adapter.sendAuthoringTurn (the
  // same shape "interrupt"/"kill"/"permission_answer" already take in that file); this proves the
  // ADAPTER method it routes to actually delivers a turn against a genuinely still-running session,
  // not merely that the method exists.
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FLYWHEEL_FAKE_STUBBORN = "1";
  try {
    const adapter = new ClaudeCodeAdapter();
    const runId = `authoring-turn-live-${Date.now()}`;
    const events = [];

    const sessionPromise = adapter.startAuthoringSession({
      runId,
      repoPath: __dirname,
      prompt: "I want to shape a new epic.",
      permissionMode: "default",
      onEvent: (event) => events.push(event),
    });

    // Let the stubborn fake backend actually spawn and print its init/assistant lines before a
    // follow-up turn is written to its stdin.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await assert.doesNotReject(() => adapter.sendAuthoringTurn(runId, "a follow-up turn while still live"));

    await adapter.killSession(runId);
    await sessionPromise.catch(() => {});
  } finally {
    delete process.env.FLYWHEEL_FAKE_STUBBORN;
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
});

// ---------------------------------------------------------------------------------------------
// Task 2 (D-87): the board_read round trip — held over the SAME per-run socket, answered by the
// Rust core rather than fabricated locally, driven directly against startPermissionServer per
// summary-report.test.mjs's own established pattern (no backend, no Tauri app needed to prove
// the sidecar-side wire shape).
// ---------------------------------------------------------------------------------------------

test(
  "a board_read request is HELD (never fire-and-forget) and carries no project id anywhere on the wire",
  { timeout: 5000 },
  async () => {
    const boardReadPayloads = [];
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      () => {},
      (payload) => boardReadPayloads.push(payload),
    );
    try {
      await waitForListening(handle.socketPath);

      const requestId = "board-read-held-1";
      let closed = false;
      const client = net.createConnection(handle.socketPath, () => {
        client.write(
          `${JSON.stringify({ kind: "board_read", requestId, readKind: "get_epic", epicId: "some-epic" })}\n`,
        );
      });
      client.on("close", () => {
        closed = true;
      });
      const rl = createInterface({ input: client });
      const answerLine = new Promise((resolve) => rl.once("line", resolve));

      // Give the connection a moment to be held — unlike a notice/proposal, board_read must NOT
      // close on its own; it waits for answerBoardRead exactly like a routine permission request.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(closed, false, "a board_read connection must stay open until answered");
      assert.equal(boardReadPayloads.length, 1);
      const serialised = JSON.stringify(boardReadPayloads[0]);
      assert.ok(
        !/"projectId"|"project_id"|"runId"|"run_id"/.test(serialised),
        `board_read payload must carry no project/run id: ${serialised}`,
      );

      handle.answerBoardRead(requestId, { epic: null, found: false });
      const line = await answerLine;
      assert.deepEqual(JSON.parse(line), { result: { epic: null, found: false } });
      client.destroy();
    } finally {
      handle.close();
    }
  },
);

test(
  "answerBoardRead resolves the held connection with {result}, and a mismatched requestId is a no-op",
  { timeout: 5000 },
  async () => {
    let resolveHeld;
    const held = new Promise((resolve) => {
      resolveHeld = resolve;
    });
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      () => {},
      (payload) => resolveHeld(payload),
    );
    try {
      await waitForListening(handle.socketPath);

      const requestId = "board-read-answer-2";
      const client = net.createConnection(handle.socketPath, () => {
        client.write(`${JSON.stringify({ kind: "board_read", requestId, readKind: "search", term: "auth" })}\n`);
      });
      const rl = createInterface({ input: client });
      const answered = new Promise((resolve) => rl.once("line", resolve));

      // Wait for the server to have actually registered this connection as a HELD call before
      // answering it — answering before the held-request map has the entry is a race in the TEST
      // itself, not something the implementation can be expected to paper over.
      await held;

      // A mismatched requestId must be a harmless no-op — nothing is written back for it.
      handle.answerBoardRead("no-such-request-id", { items: [] });
      handle.answerBoardRead(requestId, { items: [{ id: "x" }], truncated: false });

      const line = await answered;
      const parsed = JSON.parse(line);
      assert.deepEqual(parsed, { result: { items: [{ id: "x" }], truncated: false } });
      client.destroy();
    } finally {
      handle.close();
    }
  },
);
