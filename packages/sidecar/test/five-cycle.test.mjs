/**
 * Plan 04-14 (CTX-07's write-surface companion) — proves the `report_summary` write surface
 * survives repetition over one real permission-server socket: five successive summary calls, each
 * on its own fresh connection exactly as the standalone MCP server (`mcp-permission-server.ts`'s
 * `runStandaloneServer`) issues one per tool call, followed by a sixth connection carrying a
 * routine permission request that must still stay held open exactly as every other held-request
 * test in this suite proves for a single call. No live backend is spawned in this file — the
 * property under test is the socket relay's behaviour under repetition, not startup timing; a
 * spawned process would add timing variance for no additional coverage of that property.
 *
 * Four things this file proves:
 *   1. `onSummary` fires five times, once per payload, in order, with each payload's six content
 *      fields intact and distinguishable by a per-cycle marker.
 *   2. Every summary call receives its receipt acknowledgement and every connection closes — none
 *      is left held, which would mean a summary had leaked into the permission gate's pending map.
 *   3. The permission held-request path still works after all five: a sixth connection carrying a
 *      routine permission payload is still held open until `resolvePermission` answers it — the
 *      regression that would matter most, since a summary path that slowly corrupts the gate would
 *      be invisible until a human was asked a question and never got one.
 *   4. `onNotice` never fires for any of the five summary payloads.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";

import { startPermissionServer } from "../dist/mcp-permission-server.js";
import { waitForListening, writeLineAndAwaitClose } from "./socket-test-helpers.mjs";

/** One summary payload for `cycle` (1-based), every content field carrying a marker string unique
 * to that cycle so the payloads are distinguishable and never accidentally equal each other. */
function summaryPayloadForCycle(cycle) {
  return {
    kind: "session_summary",
    version: 1,
    changedFiles: [`src/cycle-${cycle}-a.ts`, `src/cycle-${cycle}-b.ts`],
    changedProse: `cycle-${cycle}-prose-marker did cycle ${cycle}'s own work`,
    remains: `cycle-${cycle}-remains-marker`,
    nextSessionMustKnow: `cycle-${cycle}-next-marker`,
    decisions: [{ id: `cycle-${cycle}-decision`, statement: `cycle-${cycle}-decision-marker chose X` }],
    acknowledgedDecisions: cycle > 1 ? [`cycle-${cycle - 1}-decision`] : [],
  };
}

test("five summary payloads over one server, each on its own connection, fire onSummary five times in order with fields intact", async () => {
  const summaryPayloads = [];
  const noticePayloads = [];
  const handle = startPermissionServer(
    () => {},
    (payload) => noticePayloads.push(payload),
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    for (let cycle = 1; cycle <= 5; cycle++) {
      const payload = summaryPayloadForCycle(cycle);
      const { line } = await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(payload)}\n`);
      assert.ok(line !== undefined, `cycle ${cycle}: expected a receipt line before the connection closed`);
      assert.deepEqual(JSON.parse(line), { received: true }, `cycle ${cycle}: expected a receipt acknowledgement`);
    }

    assert.equal(summaryPayloads.length, 5, "onSummary must fire exactly five times, once per payload");
    for (let cycle = 1; cycle <= 5; cycle++) {
      assert.deepEqual(
        summaryPayloads[cycle - 1],
        summaryPayloadForCycle(cycle),
        `cycle ${cycle}'s payload must arrive intact and in order`,
      );
    }
    assert.equal(noticePayloads.length, 0, "onNotice must never fire for a summary payload");
  } finally {
    handle.close();
  }
});

test("every one of the five summary connections closes cleanly and none is left held", async () => {
  const summaryPayloads = [];
  const handle = startPermissionServer(
    () => {},
    () => {},
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    for (let cycle = 1; cycle <= 5; cycle++) {
      const payload = summaryPayloadForCycle(cycle);
      await new Promise((resolve, reject) => {
        const client = net.createConnection(handle.socketPath, () => {
          client.write(`${JSON.stringify(payload)}\n`);
        });
        // A paused (unread) socket never emits 'end'/'close' for the far side's FIN until its
        // buffered data is actually consumed — `resume()` puts it in flowing mode so the short
        // receipt-ack line drains and the close this test awaits actually fires.
        client.resume();
        client.once("close", resolve);
        client.once("error", reject);
      });
    }
    assert.equal(summaryPayloads.length, 5, "all five summary connections must have closed cleanly");

    // A `resolvePermission` call against an id no connection ever held is the only externally
    // observable way to prove nothing leaked into the private `pending` map: it logs and returns
    // rather than throwing or resolving some other call by accident.
    handle.resolvePermission("no-such-request-id-should-be-pending", "allow");
  } finally {
    handle.close();
  }
});

test("the permission held-request path still works after five summary calls: a sixth connection stays held open until resolved", async () => {
  const summaryPayloads = [];
  const requestPayloads = [];
  const handle = startPermissionServer(
    (payload) => requestPayloads.push(payload),
    () => {},
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    for (let cycle = 1; cycle <= 5; cycle++) {
      await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(summaryPayloadForCycle(cycle))}\n`);
    }
    assert.equal(summaryPayloads.length, 5, "all five summary calls must have landed before the held-request check");

    const requestId = "held-after-five-summaries";
    const client = net.createConnection(handle.socketPath, () => {
      client.write(`${JSON.stringify({ requestId, toolName: "Bash", input: { command: "echo hi" } })}\n`);
    });

    let dataReceived = false;
    client.on("data", () => {
      dataReceived = true;
    });
    let closed = false;
    client.on("close", () => {
      closed = true;
    });

    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });

    const deadline = Date.now() + 2000;
    while (requestPayloads.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requestPayloads.length, 1, "the sixth connection's request must have been raised");
    assert.equal(requestPayloads[0].requestId, requestId);

    // No timer of its own — a routine call must stay held indefinitely until answered, exactly
    // like every single-call held-request test in this suite; re-asserted here specifically
    // because five prior summary calls just ran over the same server and socket-handling code.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(dataReceived, false, "nothing must be written back before resolvePermission is called");
    assert.equal(closed, false, "the connection must still be open before resolvePermission is called");

    const answer = await new Promise((resolve, reject) => {
      const rl = createInterface({ input: client });
      rl.once("line", (line) => resolve(line));
      client.once("error", reject);
      handle.resolvePermission(requestId, "allow");
    });
    assert.deepEqual(JSON.parse(answer), { decision: "allow" });
  } finally {
    handle.close();
  }
});

test("onNotice never fires for any of the five summary payloads", async () => {
  const noticePayloads = [];
  const handle = startPermissionServer(
    () => {},
    (payload) => noticePayloads.push(payload),
    () => {},
  );
  try {
    await waitForListening(handle.socketPath);

    for (let cycle = 1; cycle <= 5; cycle++) {
      await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(summaryPayloadForCycle(cycle))}\n`);
    }

    assert.equal(noticePayloads.length, 0, "onNotice must never fire across five summary calls");
  } finally {
    handle.close();
  }
});
