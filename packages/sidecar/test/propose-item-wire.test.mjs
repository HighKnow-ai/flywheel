/**
 * Plan 06-01 (PROP-01/PROP-02/PROP-07, D-98) — proves the `propose_item` write surface at the
 * wire level, mirroring `authoring-proposal-wire.test.mjs`'s own precedent: deliberately small and
 * spawn-free.
 *
 * Six things this file proves:
 *   1. `proposeItemToolDefinition`'s `inputSchema` declares `target_type`/`title`/`body`/`kind`/
 *      `rationale`, and its `required` array is exactly `target_type`, `title`, `rationale`.
 *   2. `EXECUTION_PROPOSE_ITEM_TOOL_NAME` evaluates to exactly
 *      `mcp__flywheel-permissions__propose_item`.
 *   3. The socket payload `buildProposeItemPayload` builds for a tool call carries no
 *      `runId`/`projectId`/`epicId` field anywhere.
 *   4. A call with a bad `target_type`, an empty/whitespace-only title, an absent/whitespace-only
 *      rationale, or an `issue` target with no valid issue kind throws BEFORE any socket write.
 *   5. `buildClaudeArgv` (the execution-run builder, never `buildAuthoringClaudeArgv`) pushes the
 *      fully-qualified name onto `--allowedTools` when `proposeItemToolName` is supplied.
 *   6. A built payload's `payload` object never carries a bare `kind` property equal to the issue
 *      category — it is `issue_kind`, the translation `buildProposeItemPayload` performs to avoid
 *      colliding with `ProposalPayload`'s own internal `kind` tag on the Rust side.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildProposeItemPayload,
  EXECUTION_PROPOSE_ITEM_TOOL_NAME,
  MCP_SERVER_NAME,
  proposeItemToolDefinition,
  stageAuthoringProposal,
  startPermissionServer,
} from "../dist/mcp-permission-server.js";
import { buildClaudeArgv } from "../dist/claude-code-adapter.js";
import { waitForListening } from "./socket-test-helpers.mjs";

test("proposeItemToolDefinition's inputSchema declares target_type/title/body/kind/rationale, required is exactly target_type, title, rationale", () => {
  assert.equal(proposeItemToolDefinition.name, "propose_item");
  const properties = Object.keys(proposeItemToolDefinition.inputSchema.properties);
  for (const expected of ["target_type", "title", "body", "kind", "rationale"]) {
    assert.ok(properties.includes(expected), `expected a ${expected} property`);
  }
  assert.deepEqual(proposeItemToolDefinition.inputSchema.required, ["target_type", "title", "rationale"]);
});

test("EXECUTION_PROPOSE_ITEM_TOOL_NAME evaluates to exactly mcp__flywheel-permissions__propose_item", () => {
  assert.equal(MCP_SERVER_NAME, "flywheel-permissions");
  assert.equal(EXECUTION_PROPOSE_ITEM_TOOL_NAME, "mcp__flywheel-permissions__propose_item");
});

test("the socket payload built for a task call carries no runId/projectId/epicId field anywhere", () => {
  const payload = buildProposeItemPayload({
    target_type: "task",
    title: "Fix the flaky retry test",
    body: "It fails under load",
    rationale: "Found while executing an unrelated task",
  });
  const serialised = JSON.stringify(payload);
  assert.ok(!/"runId"|"run_id"|"projectId"|"project_id"|"epicId"|"epic_id"/.test(serialised), serialised);
  assert.equal(payload.kind, "authoring_proposal");
  assert.equal(payload.verb, "create");
  assert.equal(payload.targetType, "task");
  assert.equal(payload.rationale, "Found while executing an unrelated task");
  assert.deepEqual(payload.payload, {
    kind: "task",
    title: "Fix the flaky retry test",
    description: "It fails under load",
  });
});

test("the socket payload built for an epic call carries no runId/projectId/epicId field anywhere", () => {
  const payload = buildProposeItemPayload({
    target_type: "epic",
    title: "Bulk export",
    rationale: "Users keep asking for this",
  });
  assert.equal(payload.targetType, "epic");
  assert.deepEqual(payload.payload, { kind: "epic", title: "Bulk export" });
});

test("the socket payload built for an issue call carries issue_kind, never a bare kind matching the issue category", () => {
  const payload = buildProposeItemPayload({
    target_type: "issue",
    title: "Retry budget ignores the configured value",
    body: "fetchWithRetry hardcodes 3",
    kind: "bug",
    rationale: "Found while executing an unrelated task",
  });
  assert.equal(payload.targetType, "issue");
  assert.deepEqual(payload.payload, {
    kind: "issue",
    title: "Retry budget ignores the configured value",
    body: "fetchWithRetry hardcodes 3",
    issue_kind: "bug",
  });
  // The nested payload's own discriminant is "issue" (matching ProposalPayload's serde tag), never
  // "bug"/"idea"/"question"/"risk" under the key "kind" — that value lives under "issue_kind".
  assert.equal(payload.payload.kind, "issue");
});

test("a call with a bad target_type throws before any socket write", () => {
  assert.throws(
    () => buildProposeItemPayload({ target_type: "not-a-real-type", title: "x", rationale: "y" }),
    /target_type/,
  );
  assert.throws(() => buildProposeItemPayload({ title: "x", rationale: "y" }), /target_type/);
});

test("a call with an empty or whitespace-only title throws before any socket write", () => {
  assert.throws(
    () => buildProposeItemPayload({ target_type: "task", title: "", rationale: "y" }),
    /non-empty title/,
  );
  assert.throws(
    () => buildProposeItemPayload({ target_type: "task", title: "   ", rationale: "y" }),
    /non-empty title/,
  );
});

test("a call with an absent or whitespace-only rationale throws before any socket write", () => {
  assert.throws(
    () => buildProposeItemPayload({ target_type: "task", title: "x" }),
    /non-empty rationale/,
  );
  assert.throws(
    () => buildProposeItemPayload({ target_type: "task", title: "x", rationale: "   " }),
    /non-empty rationale/,
  );
});

test("an issue target with no valid issue kind throws before any socket write", () => {
  assert.throws(
    () => buildProposeItemPayload({ target_type: "issue", title: "x", rationale: "y" }),
    /kind/,
  );
  assert.throws(
    () => buildProposeItemPayload({ target_type: "issue", title: "x", rationale: "y", kind: "not-a-real-kind" }),
    /kind/,
  );
});

test("buildClaudeArgv pushes the fully-qualified propose_item name onto --allowedTools when supplied", () => {
  const argv = buildClaudeArgv({
    prompt: "do the task",
    permissionMode: "default",
    permissionPromptToolName: "mcp__flywheel-permissions__approve_action",
    mcpConfig: "{}",
    proposeItemToolName: EXECUTION_PROPOSE_ITEM_TOOL_NAME,
  });
  const allowedToolsIndices = argv.reduce((acc, value, index) => {
    if (value === "--allowedTools") acc.push(index);
    return acc;
  }, []);
  assert.ok(allowedToolsIndices.length >= 1, "expected at least one --allowedTools flag");
  const allowedValues = allowedToolsIndices.map((i) => argv[i + 1]);
  assert.ok(
    allowedValues.includes(EXECUTION_PROPOSE_ITEM_TOOL_NAME),
    `expected ${EXECUTION_PROPOSE_ITEM_TOOL_NAME} among --allowedTools values: ${JSON.stringify(argv)}`,
  );
});

// -----------------------------------------------------------------------------------------------
// Plan 06-05 (D-108): socket-level tests over a real `startPermissionServer` — the duplicate
// candidate reaching the model, its degradation contract, and the limit-refusal transport.
// -----------------------------------------------------------------------------------------------

test(
  "an answer carrying a staged id and a duplicate candidate resolves with both present in the text block",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, {
          proposalId: "01ITEMWITHCANDIDATEAAAAAAA",
          duplicateCandidate: { kind: "task", key: "FLY-42", title: "Fix the flaky retry test", score: -30.5 },
        });
      },
    );
    try {
      await waitForListening(handle.socketPath);
      const result = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeItemPayload({
          target_type: "task",
          title: "Fix the flaky retry test again",
          rationale: "Found while executing an unrelated task",
        }),
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.staged, true);
      assert.equal(parsed.proposalId, "01ITEMWITHCANDIDATEAAAAAAA");
      assert.deepEqual(parsed.duplicateCandidate, {
        kind: "task",
        key: "FLY-42",
        title: "Fix the flaky retry test",
        score: -30.5,
      });
    } finally {
      handle.close();
    }
  },
);

test(
  "an answer carrying only a staged id resolves with exactly the shape the authoring path produces today",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, { proposalId: "01ITEMNOCANDIDATEAAAAAAAAA" });
      },
    );
    try {
      await waitForListening(handle.socketPath);
      const result = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeItemPayload({
          target_type: "task",
          title: "Fix the flaky retry test",
          rationale: "Found while executing an unrelated task",
        }),
      );
      const parsed = JSON.parse(result.content[0].text);
      // Field-by-field, so a future reader can see the divergence from today's shape is purely
      // additive: no duplicateCandidate key present at all when the answer carried none.
      assert.deepEqual(Object.keys(parsed).sort(), ["proposalId", "staged"]);
      assert.equal(parsed.staged, true);
      assert.equal(parsed.proposalId, "01ITEMNOCANDIDATEAAAAAAAAA");
    } finally {
      handle.close();
    }
  },
);

test(
  "an answer carrying a malformed candidate still resolves successfully with the staged id",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, {
          proposalId: "01ITEMMALFORMEDCANDIDATEAA",
          duplicateCandidate: "not an object",
        });
      },
    );
    try {
      await waitForListening(handle.socketPath);
      const result = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeItemPayload({
          target_type: "task",
          title: "Fix the flaky retry test",
          rationale: "Found while executing an unrelated task",
        }),
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.staged, true);
      assert.equal(parsed.proposalId, "01ITEMMALFORMEDCANDIDATEAA");
      assert.equal(parsed.duplicateCandidate, undefined, "a malformed candidate must degrade to no candidate");
    } finally {
      handle.close();
    }
  },
);

test(
  "an answer carrying an error naming the limit rejects with that message intact",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(
          payload.requestId,
          undefined,
          "proposal limit reached: this run has already staged 10 of 10 allowed proposals — this " +
            "one was NOT staged. Call report_summary and put it in the remains field instead.",
        );
      },
    );
    try {
      await waitForListening(handle.socketPath);
      await assert.rejects(
        () =>
          stageAuthoringProposal(
            handle.socketPath,
            buildProposeItemPayload({
              target_type: "task",
              title: "The 11th finding",
              rationale: "Found while executing an unrelated task",
            }),
          ),
        (err) => {
          assert.match(err.message, /proposal limit reached/);
          assert.match(err.message, /report_summary/);
          return true;
        },
      );
    } finally {
      handle.close();
    }
  },
);
