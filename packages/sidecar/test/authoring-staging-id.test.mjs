/**
 * Plan 05-48 (D-80/D-81/D-92, gap G-05-10) — proves the propose_/amend_/delete_ RETURN
 * CONTRACT: staging a proposal hands the agent back the id of the row the Rust core actually
 * wrote, inside the same tool call. Driven directly against `startPermissionServer` and
 * `stageAuthoringProposal` over a REAL unix socket, per `authoring-tools.test.mjs`'s own
 * established pattern (no backend, no Tauri app needed to prove the sidecar-side wire shape).
 *
 * Task 1: the one end-to-end path (`propose_epic`) with the core-minted id coming back.
 * Task 2: no host failure path may leave a staging call hanging.
 * Task 3: the regression that pins the id across all six staging verbs, plus the adjacency and
 *   empty edges for SHAPE-03.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAmendProposalPayload,
  buildDeleteProposalPayload,
  buildProposeAssumptionPayload,
  buildProposeCriterionPayload,
  buildProposeEpicPayload,
  buildProposeTaskPayload,
  startPermissionServer,
  stageAuthoringProposal,
} from "../dist/mcp-permission-server.js";
import { waitForListening } from "./socket-test-helpers.mjs";

const A_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // 26 chars — a plausible-shaped target id

test(
  "a staged proposal's core-minted id comes back in the propose_epic tool result",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, { proposalId: "01TESTEPICPROPOSALIDAAAAAA" });
      },
    );
    try {
      await waitForListening(handle.socketPath);

      const result = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeEpicPayload({ title: "Run notifications", description: "Notify the developer." }),
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.deepEqual(parsed, { staged: true, proposalId: "01TESTEPICPROPOSALIDAAAAAA" });
    } finally {
      handle.close();
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Task 2: no host failure path may leave a staging call hanging.
// ---------------------------------------------------------------------------------------------

test(
  "a staging call whose host refuses the write is released with an error, never left hanging",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, undefined, "no agent_runs row matches this run");
      },
    );
    try {
      await waitForListening(handle.socketPath);

      await assert.rejects(
        () => stageAuthoringProposal(handle.socketPath, buildProposeTaskPayload({ title: "t", description: "d" })),
        (err) => {
          assert.match(err.message, /no agent_runs row matches this run/);
          return true;
        },
      );
    } finally {
      handle.close();
    }
  },
);

test(
  "a staging answer carrying no proposalId is rejected rather than resolved",
  { timeout: 5000 },
  async () => {
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        handle.answerProposalStaged(payload.requestId, {});
      },
    );
    try {
      await waitForListening(handle.socketPath);

      await assert.rejects(() =>
        stageAuthoringProposal(handle.socketPath, buildProposeTaskPayload({ title: "t", description: "d" })),
      );
    } finally {
      handle.close();
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Task 3: the regression that pins the id across all six staging verbs.
// ---------------------------------------------------------------------------------------------

test(
  "every one of the six staging tools resolves with a 26-character proposalId",
  { timeout: 5000 },
  async () => {
    let calls = 0;
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        calls += 1;
        handle.answerProposalStaged(payload.requestId, { proposalId: "01SIXVERBPROPOSALIDAAAAAAA" });
      },
    );
    try {
      await waitForListening(handle.socketPath);

      const builders = [
        buildProposeTaskPayload({ title: "t", description: "d" }),
        buildProposeEpicPayload({ title: "t", description: "d" }),
        buildProposeCriterionPayload({ statement: "s", parent_proposal_id: A_ULID }),
        buildProposeAssumptionPayload({ assumption: "s", answer: "a" }),
        buildAmendProposalPayload({ target_id: A_ULID, target_type: "task", title: "amended" }),
        buildDeleteProposalPayload({ target_id: A_ULID, target_type: "task", reason: "no longer needed" }),
      ];

      for (const payload of builders) {
        const result = await stageAuthoringProposal(handle.socketPath, payload);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(typeof parsed.proposalId, "string");
        assert.equal(parsed.proposalId.length, 26);
        assert.equal(parsed.staged, true);
      }
      assert.equal(calls, builders.length, "expected every one of the six builders to be exercised");
    } finally {
      handle.close();
    }
  },
);

test(
  "two byte-identical propose_task calls resolve with two different proposalId values",
  { timeout: 5000 },
  async () => {
    let counter = 0;
    const seenRequestIds = new Set();
    const handle = startPermissionServer(
      () => {},
      () => {},
      () => {},
      (payload) => {
        seenRequestIds.add(payload.requestId);
        counter += 1;
        handle.answerProposalStaged(payload.requestId, { proposalId: `01INCREMENTINGIDAAAAAAAA${counter}`.slice(0, 26) });
      },
    );
    try {
      await waitForListening(handle.socketPath);

      const first = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeTaskPayload({ title: "same", description: "same" }),
      );
      const second = await stageAuthoringProposal(
        handle.socketPath,
        buildProposeTaskPayload({ title: "same", description: "same" }),
      );

      const firstParsed = JSON.parse(first.content[0].text);
      const secondParsed = JSON.parse(second.content[0].text);
      assert.notEqual(firstParsed.proposalId, secondParsed.proposalId);
      assert.equal(seenRequestIds.size, 2, "expected two distinct requestId values on the wire");
    } finally {
      handle.close();
    }
  },
);

test("a propose_task with an empty title is rejected before any socket write", async () => {
  let serverInvoked = false;
  const handle = startPermissionServer(
    () => {},
    () => {},
    () => {},
    () => {
      serverInvoked = true;
    },
  );
  try {
    await waitForListening(handle.socketPath);
    assert.throws(() => buildProposeTaskPayload({ title: "   ", description: "d" }), /non-empty title/);
    assert.equal(serverInvoked, false, "the server must never be reached for a rejected builder call");
  } finally {
    handle.close();
  }
});
