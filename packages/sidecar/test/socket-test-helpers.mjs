/**
 * Shared socket-driving helpers for the test files that talk to `startPermissionServer` directly
 * over its Unix domain socket, without spawning a backend (`summary-report.test.mjs`,
 * `five-cycle.test.mjs`). Factored out here (04-14-PLAN.md Task 3) so there is exactly ONE copy of
 * this scaffolding across both files — two divergent copies is how one of them quietly stops
 * testing what it claims to. Deliberately named without a `.test.mjs` suffix so `npm test`'s
 * `node --test test/*.test.mjs` glob never picks this file up as a test file of its own.
 */
import net from "node:net";
import { createInterface } from "node:readline";

/** Mirrors `socket-permissions.test.mjs::waitForListening` — `net.Server#listen`'s callback fires
 * on a later tick than `listen()` returns, so a successful connect is the observable proof the
 * server is actually accepting connections. */
export function waitForListening(socketPath) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    client.once("connect", () => {
      client.end();
      resolve();
    });
    client.once("error", reject);
  });
}

/** Connect a fresh socket to `socketPath`, write `rawLine` (already newline-terminated by the
 * caller convention this module uses — every call site appends its own `"\n"`), and resolve once
 * the connection closes with whatever line (if any) was read before the close. Never rejects on a
 * connection error the caller expects (a destroyed socket after malformed input) — callers that
 * need to assert on an error path do so via their own raw `client` handle instead. */
export function writeLineAndAwaitClose(socketPath, rawLine) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(rawLine);
    });
    let receivedLine;
    const rl = createInterface({ input: client });
    rl.once("line", (line) => {
      receivedLine = line;
    });
    client.once("error", reject);
    client.once("close", () => resolve({ line: receivedLine }));
  });
}
