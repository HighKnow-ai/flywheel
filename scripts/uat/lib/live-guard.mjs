/**
 * The cost cap of a live UAT item (issue #1843): the live items drive a real `claude` on the developer's own
 * Claude usage, so each one runs under a guard that ends the session the moment it goes wrong, and prints what
 * the session used.
 *
 * The guard stops a session (it sends the sidecar's `kill`) on the FIRST of:
 *   - a backend refusal: an `API Error:` banner as the agent's text (`readBackendRefusal`), an assistant message
 *     that carries the wire's error flag, a `result` line with `is_error`, or a `rate_limit` event that says
 *     `rejected`. Nothing is retried: a refused session that goes on only spends more;
 *   - more tool calls than `maxToolCalls`, or more permission requests than `maxPermissionAsks`: a session that
 *     loops on a request is not measuring what the item measures;
 *   - the wall clock passing `deadlineMs` after the guard was armed.
 *
 * `createLiveGuard` is pure (it reads the clock through `now`), so `scripts/uat/test/live-guard.test.mjs` runs
 * every branch with no `claude`. `armGuard` is the one piece that touches a sidecar.
 */
import { readBackendRefusal } from "./sidecar-harness.mjs";

/** `rate_limit` statuses that mean the backend still serves the request. Anything else stops the session. */
const SERVING_RATE_LIMIT_STATUSES = new Set(["allowed", "allowed_warning"]);

/**
 * @param {{ maxToolCalls: number, maxPermissionAsks: number, deadlineMs: number, now?: () => number }} options
 */
export function createLiveGuard({ maxToolCalls, maxPermissionAsks, deadlineMs, now = Date.now }) {
  const startedAt = now();
  let toolCalls = 0;
  let permissionAsks = 0;
  return {
    /** Feed one event of the guarded session. Returns `null`, or `{ reason }` when the session must stop. */
    observe(event) {
      if (event.type === "tool_call") {
        toolCalls += 1;
        if (toolCalls > maxToolCalls) return { reason: `more than ${maxToolCalls} tool calls` };
      } else if (event.type === "permission_request") {
        permissionAsks += 1;
        if (permissionAsks > maxPermissionAsks) return { reason: `more than ${maxPermissionAsks} permission requests` };
      } else if (event.type === "assistant_text") {
        const refusal = readBackendRefusal(event.text);
        if (refusal !== null) return { reason: `backend refusal: ${String(event.text).trim().slice(0, 160)}` };
        if (event.isApiErrorMessage === true) {
          return { reason: `backend error ${event.errorCode ?? ""}: ${String(event.text).trim().slice(0, 160)}`.replace("error :", "error:") };
        }
      } else if (event.type === "result" && event.isError === true) {
        return { reason: `the backend ended a turn with is_error (${event.terminalReason ?? event.subtype ?? "no reason"})` };
      } else if (event.type === "rate_limit" && typeof event.status === "string" && !SERVING_RATE_LIMIT_STATUSES.has(event.status)) {
        return { reason: `rate limit status "${event.status}"` };
      }
      return null;
    },
    /** `{ reason }` once the wall clock passed the deadline, else `null`. */
    checkClock() {
      return now() - startedAt > deadlineMs ? { reason: `no end after ${Math.round(deadlineMs / 1000)}s` } : null;
    },
    counts() {
      return { toolCalls, permissionAsks };
    },
  };
}

/**
 * Arm `guard` on a live session: scan the run's new events once a second and, on the first trip, send the
 * sidecar's `kill`. The returned handle says whether it tripped, and why. `stop()` ends the scan; call it when
 * the session has closed.
 */
export function armGuard(sidecar, runId, guard, { cursor = sidecar.events.length, intervalMs = 1_000 } = {}) {
  let seen = cursor;
  let tripped = null;
  const trip = (verdict) => {
    if (tripped !== null) return;
    tripped = verdict;
    process.stdout.write(`   · COST GUARD: stopping the session: ${verdict.reason}\n`);
    sidecar.request({ op: "kill", runId }).catch(() => {});
  };
  const scan = () => {
    while (seen < sidecar.events.length) {
      const event = sidecar.events[seen];
      seen += 1;
      if (event.runId !== undefined && event.runId !== runId) continue;
      const verdict = guard.observe(event);
      if (verdict !== null) trip(verdict);
    }
    const late = guard.checkClock();
    if (late !== null) trip(late);
  };
  const timer = setInterval(scan, intervalMs);
  return {
    tripped: () => tripped,
    stop() {
      clearInterval(timer);
      scan();
    },
  };
}

/**
 * What a session used: the sum over its `result` lines (one per turn), or, when it printed none, over the
 * `result` the sidecar attaches to `session_closed`. Fields the backend did not report stay `null`, never zero.
 */
export function summariseUsage(events) {
  const results = events.filter((e) => e.type === "result");
  const fromClose = events.filter((e) => e.type === "session_closed" && e.result !== undefined).map((e) => e.result);
  const sources = results.length > 0 ? results : fromClose;
  const sum = (field) => {
    const values = sources.map((r) => r[field]).filter((v) => typeof v === "number");
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  return {
    turns: sources.length,
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalCostUsd: sum("totalCostUsd"),
    toolCalls: events.filter((e) => e.type === "tool_call").length,
  };
}

/** One line for a verdict table: `usage: ...`. */
export function formatUsage(usage) {
  const n = (v) => (v === null ? "not reported" : String(v));
  const cost = usage.totalCostUsd === null ? "not reported" : `$${usage.totalCostUsd.toFixed(4)}`;
  return `usage: ${usage.turns} turn(s), ${usage.toolCalls} tool call(s), input tokens ${n(usage.inputTokens)}, output tokens ${n(usage.outputTokens)}, cost ${cost}`;
}

/**
 * A verdict table that does not stop at the first failure: a live run is paid for, so every property is judged
 * from the one run. `check(name, result)` takes `true` (PASS) or a string, the reason it failed (FAIL), and
 * prints one line each. `finish()` throws, with every failed name, when any check failed; `rows()` is the
 * table for the run's durable artifact.
 */
export function createVerdicts(print = (line) => process.stdout.write(`${line}\n`)) {
  const table = [];
  return {
    check(name, result) {
      const pass = result === true;
      table.push({ name, pass, ...(pass ? {} : { reason: String(result) }) });
      print(pass ? `   · PASS  ${name}` : `   · FAIL  ${name}: ${result}`);
    },
    rows: () => table,
    finish() {
      const failed = table.filter((row) => !row.pass);
      if (failed.length > 0) {
        throw new Error(`${failed.length} of ${table.length} checks failed: ${failed.map((row) => row.name).join("; ")}`);
      }
    },
  };
}
