// Plan 09-05 (AGNT-05): the adapter seam's reading of "may this account keep being sent requests".
//
// WHAT IS AND IS NOT OBSERVED. Exactly two shapes below are real captures: the `allowed` event with
// an overage status of `rejected` (the NEGATIVE fixture - it must never pause dispatch) and the
// `allowed_warning` event. Every `rejected` shape is CONSTRUCTED from the documented shape. No hard
// rate limit has ever been observed live in this project, so what a real one looks like on the wire
// is unconfirmed; these tests prove the code reacts to the documented shape, not that the documented
// shape is what arrives.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ClaudeCodeAdapter, normaliseStreamEvent, rateLimitTier } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
const WARNING_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "../../../scripts/uat/fixtures/live-opus5-unmodelled-shapes.json"), "utf8"),
).shapes.find((s) => s.expectedEventType === "rate_limit");

function normalise(obj) {
  const line = JSON.stringify(obj);
  return normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
}

// OBSERVED (09-RESEARCH.md M6, verbatim from a live run): top-level status allowed, overage status
// rejected. The substring "rejected" appears in it; it is not a limit.
const OBSERVED_ALLOWED = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    resetsAt: 1791538200,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled",
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.28, resetsAt: 1791538200 },
      seven_day: { utilization: 0.31, resetsAt: 1791806400 },
    },
  },
};

// CONSTRUCTED from the documented shape; never observed.
const CONSTRUCTED_REJECTED = {
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected", resetsAt: 1791538200, rateLimitType: "five_hour" },
};

test("the observed allowed event, overage status rejected and all, reads as tier open", () => {
  const event = normalise(OBSERVED_ALLOWED);
  assert.equal(event.type, "rate_limit");
  assert.equal(event.tier, "open");
});

test("a constructed event with top-level status rejected reads as tier rejected and keeps its reset time", () => {
  const event = normalise(CONSTRUCTED_REJECTED);
  assert.equal(event.tier, "rejected");
  assert.equal(event.resetsAt, 1791538200);
  assert.equal(event.rateLimitType, "five_hour");
});

test("the observed warning-tier shape reads as tier warning", () => {
  const event = normalise(WARNING_FIXTURE.line);
  assert.equal(event.tier, "warning");
  assert.equal(event.rateLimitType, "seven_day");
});

test("the tier is read from the top-level status alone, never from the overage status", () => {
  const allowedButOverageRejected = normalise({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed", overageStatus: "rejected" },
  });
  assert.equal(allowedButOverageRejected.tier, "open");
  const rejectedButOverageAllowed = normalise({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", overageStatus: "allowed" },
  });
  assert.equal(rejectedButOverageAllowed.tier, "rejected");
});

test("a missing or unrecognised status carries no tier at all, never a guess in either direction", () => {
  assert.ok(!("tier" in normalise({ type: "rate_limit_event" })));
  assert.ok(!("tier" in normalise({ type: "rate_limit_event", rate_limit_info: { status: "something_new" } })));
  assert.ok(!("tier" in normalise({ type: "rate_limit_event", rate_limit_info: { status: 7 } })));
  assert.equal(rateLimitTier(undefined), undefined);
  assert.equal(rateLimitTier("Rejected"), undefined, "the match is exact, not case-folded or substring");
  assert.equal(rateLimitTier("not rejected"), undefined);
});

test("an assistant message whose error code is rate_limit carries tier rejected and still carries its text", () => {
  const event = normalise({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "limit reached" }] },
    is_api_error_message: true,
    error: "rate_limit",
  });
  assert.equal(event.type, "assistant_text");
  assert.equal(event.text, "limit reached");
  assert.equal(event.rateLimitTier, "rejected");
});

test("an assistant message with any other error code, or none, carries no rate-limit tier", () => {
  for (const error of ["authentication_failed", "overloaded", "billing_error", undefined]) {
    const event = normalise({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      ...(error ? { error } : {}),
    });
    assert.ok(!("rateLimitTier" in event), `error ${error} must not carry a tier`);
  }
});

async function runFake(env) {
  const saved = {};
  for (const [k, v] of Object.entries({ FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE, ...env })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const events = [];
    await new ClaudeCodeAdapter().startSession({
      runId: "run-1",
      worktreePath: process.cwd(),
      prompt: "hi",
      permissionMode: "acceptEdits",
      env: {},
      onEvent: (e) => events.push(e),
    });
    return events;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("through the real stream path a rejected limit line arrives as a rejected-tier event and the session still closes completed", async () => {
  const events = await runFake({ FLYWHEEL_FAKE_RATE_LIMIT: JSON.stringify(CONSTRUCTED_REJECTED.rate_limit_info) });
  const limit = events.find((e) => e.type === "rate_limit");
  assert.equal(limit?.tier, "rejected");
  assert.equal(events.at(-1).type, "session_closed");
  assert.equal(events.at(-1).reason, "completed");
});

test("through the real stream path the observed allowed line arrives as tier open", async () => {
  const events = await runFake({ FLYWHEEL_FAKE_RATE_LIMIT: JSON.stringify(OBSERVED_ALLOWED.rate_limit_info) });
  assert.equal(events.find((e) => e.type === "rate_limit")?.tier, "open");
});

test("through the real stream path a rate_limit error on an assistant message arrives carrying the rejected tier", async () => {
  const events = await runFake({ FLYWHEEL_FAKE_ASSISTANT_ERROR: "rate_limit" });
  assert.ok(events.some((e) => e.type === "assistant_text" && e.rateLimitTier === "rejected"));
});
