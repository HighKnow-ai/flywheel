/**
 * Gap-closure plan 03-23, Task 1 (WR-01) — the permission socket's base directory moved from the
 * per-user, mode-0700 OS temp directory to the shared, world-listable `/tmp` (plan 03-19, to fit
 * `sockaddr_un`'s `SUN_LEN` limit). `randomUUID()` in the filename no longer restricts who can
 * find the path — `/tmp` is listable by every local account — so this file asserts the socket
 * file itself carries an explicit owner-only mode, independent of the process umask.
 *
 * Deliberately small and spawn-free: constructs a `PermissionServerHandle` directly (the same
 * construction `close-provenance.test.mjs` and `adapter.test.mjs` already use for the routine
 * held-request path) and inspects the filesystem — no `fake-claude.mjs`, no grandchild MCP
 * process, so this file is unaffected by the grandchild-process spawning constraint
 * `deferred-items.md` records against `permission.test.mjs`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { test } from "node:test";

import { startPermissionServer } from "../dist/mcp-permission-server.js";

/**
 * `net.Server#listen(path, callback)` defers its `callback` to the 'listening' event, which Node
 * schedules via `process.nextTick` rather than firing synchronously before `listen()` returns —
 * so a socket file can exist (the underlying bind is synchronous for AF_UNIX) before the
 * hardening `chmodSync` inside that callback has actually run. A successful connect is the
 * observable proof that 'listening' — and therefore the callback — has fired, matching the
 * `waitForCondition`/readiness idioms `close-provenance.test.mjs` and `adapter.test.mjs` already
 * use elsewhere in this package rather than an arbitrary sleep.
 */
function waitForListening(socketPath) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    client.once("connect", () => {
      client.end();
      resolve();
    });
    client.once("error", reject);
  });
}

test("the socket file is owner-only (mode 0600) once startPermissionServer is listening", async () => {
  const handle = startPermissionServer(
    () => {},
    () => {},
  );
  try {
    await waitForListening(handle.socketPath);
    const mode = fs.statSync(handle.socketPath).mode & 0o777;
    assert.equal(mode, 0o600, `expected socket mode 0600, got ${mode.toString(8)}`);
  } finally {
    handle.close();
  }
});

test("the owning process can still connect after the mode is hardened", async () => {
  const handle = startPermissionServer(
    () => {},
    () => {},
  );
  try {
    await new Promise((resolve, reject) => {
      const client = net.createConnection(handle.socketPath);
      client.once("connect", () => {
        client.end();
        resolve();
      });
      client.once("error", reject);
    });
  } finally {
    handle.close();
  }
});

test("close() still removes the socket file", () => {
  const handle = startPermissionServer(
    () => {},
    () => {},
  );
  assert.ok(fs.existsSync(handle.socketPath), "the socket file must exist before close()");
  handle.close();
  assert.ok(!fs.existsSync(handle.socketPath), "the socket file must not exist after close()");
});
