import assert from "node:assert/strict";
import test from "node:test";

import { createLiveGuard, createVerdicts, formatUsage, summariseUsage } from "../lib/live-guard.mjs";

const guard = (over = {}) => createLiveGuard({ maxToolCalls: 2, maxPermissionAsks: 2, deadlineMs: 1000, ...over });

test("an ordinary stream does not trip the guard", () => {
  const g = guard();
  const events = [
    { type: "assistant_text", text: "Writing the file." },
    { type: "tool_call", toolName: "Bash" },
    { type: "permission_request" },
    { type: "rate_limit", status: "allowed" },
    { type: "rate_limit", status: "allowed_warning" },
    { type: "result", subtype: "success", isError: false },
  ];
  for (const e of events) assert.equal(g.observe(e), null);
});

test("the first backend refusal trips it, by banner, error flag, is_error result or rejected rate limit", () => {
  const banner = "API Error: Claude Code is unable to respond to this request\nRequest ID: abc";
  assert.match(guard().observe({ type: "assistant_text", text: banner }).reason, /backend refusal/);
  assert.match(guard().observe({ type: "assistant_text", text: "limit reached", isApiErrorMessage: true, errorCode: "rate_limit" }).reason, /rate_limit/);
  assert.match(guard().observe({ type: "result", subtype: "error_during_execution", isError: true, terminalReason: "model_error" }).reason, /is_error \(model_error\)/);
  assert.match(guard().observe({ type: "rate_limit", status: "rejected" }).reason, /"rejected"/);
});

test("prose that merely discusses an API error does not trip it", () => {
  assert.equal(guard().observe({ type: "assistant_text", text: "The push gave an API Error: it was declined." }), null);
});

test("more tool calls or permission requests than the cap trip it", () => {
  const g = guard();
  assert.equal(g.observe({ type: "tool_call" }), null);
  assert.equal(g.observe({ type: "tool_call" }), null);
  assert.match(g.observe({ type: "tool_call" }).reason, /more than 2 tool calls/);
  const p = guard();
  p.observe({ type: "permission_request" });
  p.observe({ type: "permission_request" });
  assert.match(p.observe({ type: "permission_request" }).reason, /more than 2 permission requests/);
  assert.deepEqual(p.counts(), { toolCalls: 0, permissionAsks: 3 });
});

test("the wall clock trips it after the deadline", () => {
  let now = 0;
  const g = guard({ now: () => now });
  now = 1000;
  assert.equal(g.checkClock(), null);
  now = 1001;
  assert.match(g.checkClock().reason, /no end after 1s/);
});

test("usage sums the result lines, falls back to session_closed, and never invents a zero", () => {
  const usage = summariseUsage([
    { type: "tool_call" },
    { type: "result", inputTokens: 100, outputTokens: 10, totalCostUsd: 0.01 },
    { type: "result", inputTokens: 50, totalCostUsd: 0.02 },
  ]);
  assert.deepEqual(usage, { turns: 2, inputTokens: 150, outputTokens: 10, totalCostUsd: 0.03, toolCalls: 1 });
  assert.match(formatUsage(usage), /input tokens 150, output tokens 10, cost \$0\.0300/);
  const closeOnly = summariseUsage([{ type: "session_closed", result: { inputTokens: 7 } }]);
  assert.deepEqual([closeOnly.turns, closeOnly.inputTokens, closeOnly.outputTokens, closeOnly.totalCostUsd], [1, 7, null, null]);
  assert.match(formatUsage(summariseUsage([])), /input tokens not reported.*cost not reported/);
});

test("the verdict table judges every check, then fails once with every failed name", () => {
  const lines = [];
  const v = createVerdicts((l) => lines.push(l));
  v.check("a", true);
  v.check("b", "it did not");
  v.check("c", "nor this");
  assert.deepEqual(lines, ["   · PASS  a", "   · FAIL  b: it did not", "   · FAIL  c: nor this"]);
  assert.throws(() => v.finish(), /2 of 3 checks failed: b; c/);
  assert.deepEqual(v.rows().map((r) => r.pass), [true, false, false]);
});
