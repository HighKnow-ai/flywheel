/**
 * Plan 04-03 (D-64/D-65) — proves the `report_summary` write surface over a REAL socket, driving
 * {@link startPermissionServer} directly rather than through a spawned backend: deliberately
 * small and spawn-free, following `socket-permissions.test.mjs`'s own precedent for constructing
 * a `PermissionServerHandle` directly and inspecting the socket at the protocol level.
 *
 * Five things this file proves:
 *   1. A `session_summary` payload round-trips with a receipt ack and fires ONLY `onSummary`.
 *   2. The routine held-request path is completely undisturbed by this plan's own change — a
 *      permission call still stays held, with nothing written back, until `resolvePermission`.
 *   3. A `git_retry` notice is still routed to `onNotice`, never `onSummary` — the two `kind`
 *      values never collide.
 *   4. Structural: the registered summary tool's `inputSchema.properties` carries no key naming a
 *      run, task, project or worktree — read from the SAME object the server registers
 *      ({@link summaryToolDefinition}), never a duplicated literal that could drift.
 *   5. Malformed input (unparseable JSON, and a JSON line with an unrecognised `kind`) never fires
 *      `onSummary` and never crashes the server — proven by a subsequent connection still working.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";

import { startPermissionServer, summaryToolDefinition } from "../dist/mcp-permission-server.js";
import { waitForListening, writeLineAndAwaitClose } from "./socket-test-helpers.mjs";

test("a session_summary payload round-trips with a receipt ack and fires only onSummary", async () => {
  const summaryPayloads = [];
  const requestPayloads = [];
  const noticePayloads = [];
  const handle = startPermissionServer(
    (payload) => requestPayloads.push(payload),
    (payload) => noticePayloads.push(payload),
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    const payload = {
      kind: "session_summary",
      version: 1,
      changedFiles: ["src/a.ts", "src/b.ts"],
      changedProse: "did the thing",
      remains: "more to do",
      nextSessionMustKnow: "watch out for X",
      decisions: [{ id: "d1", statement: "chose X over Y" }],
      acknowledgedDecisions: ["d0"],
    };

    const { line } = await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(payload)}\n`);

    assert.ok(line !== undefined, "expected a receipt line before the connection closed");
    assert.deepEqual(JSON.parse(line), { received: true });

    assert.equal(summaryPayloads.length, 1, "onSummary must fire exactly once");
    assert.deepEqual(summaryPayloads[0], payload, "the six content fields must arrive intact");
    assert.equal(requestPayloads.length, 0, "onRequest must not fire for a summary payload");
    assert.equal(noticePayloads.length, 0, "onNotice must not fire for a summary payload");
  } finally {
    handle.close();
  }
});

test("the held permission-request path is undisturbed: nothing is written back until resolvePermission is called", async () => {
  const requestPayloads = [];
  const handle = startPermissionServer(
    (payload) => requestPayloads.push(payload),
    () => {},
    () => {},
  );
  try {
    await waitForListening(handle.socketPath);

    const requestId = "held-request-1";
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

    // Poll briefly for onRequest to fire (the connection handler runs async relative to connect).
    const deadline = Date.now() + 2000;
    while (requestPayloads.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requestPayloads.length, 1);
    assert.equal(requestPayloads[0].requestId, requestId);

    // No timer of its own (AGNT-06's central falsifiability requirement) — re-asserted here
    // because this plan is exactly the kind of change that could quietly break it.
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

test("a git_retry notice is still routed to onNotice, never onSummary", async () => {
  const summaryPayloads = [];
  const noticePayloads = [];
  const handle = startPermissionServer(
    () => {},
    (payload) => noticePayloads.push(payload),
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    const notice = {
      kind: "git_retry",
      runId: "run-x",
      attempt: 1,
      max: 3,
      repository: "/repo",
      command: "git fetch",
    };
    await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(notice)}\n`);

    assert.equal(noticePayloads.length, 1, "onNotice must fire for a git_retry notice");
    assert.deepEqual(noticePayloads[0], notice);
    assert.equal(summaryPayloads.length, 0, "onSummary must not fire for a git_retry notice");
  } finally {
    handle.close();
  }
});

test("the summary tool schema carries no run/task/project/worktree property name, read from the object the server registers", () => {
  assert.equal(summaryToolDefinition.name, "report_summary");
  const propertyNames = Object.keys(summaryToolDefinition.inputSchema.properties);
  assert.ok(propertyNames.length > 0, "expected the schema to declare at least one property");
  for (const name of propertyNames) {
    assert.ok(
      !/run|task|project|worktree/i.test(name),
      `unexpected board-entity-id-shaped property on the summary tool schema: ${name}`,
    );
  }
  // The nested decisions entries (id/statement) must not carry a board-entity id either.
  const decisionProps = Object.keys(summaryToolDefinition.inputSchema.properties.decisions.items.properties);
  for (const name of decisionProps) {
    assert.ok(!/run|task|project|worktree/i.test(name), `unexpected id-shaped decision property: ${name}`);
  }
});

test("malformed input (unparseable JSON, and an unrecognised kind) never fires onSummary and never crashes the server", async () => {
  const summaryPayloads = [];
  const handle = startPermissionServer(
    () => {},
    () => {},
    (payload) => summaryPayloads.push(payload),
  );
  try {
    await waitForListening(handle.socketPath);

    // A line that does not parse as JSON at all — the server's existing discipline destroys the
    // connection outright, matching every other malformed-line path in this module.
    await new Promise((resolve, reject) => {
      const client = net.createConnection(handle.socketPath, () => {
        client.write("not json at all\n");
      });
      client.once("close", resolve);
      client.once("error", () => resolve()); // destroy() may surface as an error on some platforms
      setTimeout(() => reject(new Error("connection was neither closed nor errored")), 2000);
    });
    assert.equal(summaryPayloads.length, 0, "onSummary must not fire for unparseable input");

    // Valid JSON, but a `kind` this module has never heard of — must not crash the server and
    // must not fire onSummary (it may or may not reach onNotice; that is outside this test's
    // contract, matching the plan's own "neither fires onSummary" wording).
    await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify({ kind: "not_a_real_kind" })}\n`);
    assert.equal(summaryPayloads.length, 0, "onSummary must not fire for an unrecognised kind");

    // Proof the server itself is still alive and healthy: a genuine summary call still works.
    assert.ok(fs.existsSync(handle.socketPath), "the socket file must still exist after malformed input");
    const validPayload = {
      kind: "session_summary",
      version: 1,
      changedFiles: [],
      decisions: [],
      acknowledgedDecisions: [],
    };
    const { line } = await writeLineAndAwaitClose(handle.socketPath, `${JSON.stringify(validPayload)}\n`);
    assert.deepEqual(JSON.parse(line), { received: true });
    assert.equal(summaryPayloads.length, 1, "the server must still process a valid call after malformed input");
  } finally {
    handle.close();
  }
});
