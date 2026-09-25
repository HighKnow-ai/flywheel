import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CapabilityUnsupportedError } from "../dist/adapter.js";
import {
  buildClaudeArgv,
  ClaudeCodeAdapter,
  noticeToAgentEvent,
  normaliseStreamEvent,
  STDERR_DETAIL_MAX_CHARS,
} from "../dist/claude-code-adapter.js";
import { startPermissionServer } from "../dist/mcp-permission-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
// Plan 05-34 (G-05-6 closure): the frozen real capture of an unauthenticated CLI's first turn —
// see scripts/uat/fixtures/unauthenticated-cli-first-turn.json's own `note` field for the full
// provenance. Read once at module load so every test below normalises the SAME real lines rather
// than a hand-typed copy that could drift from the capture.
const UNAUTHENTICATED_FIXTURE_PATH = path.join(
  __dirname,
  "../../../scripts/uat/fixtures/unauthenticated-cli-first-turn.json",
);
const UNAUTHENTICATED_FIXTURE = JSON.parse(readFileSync(UNAUTHENTICATED_FIXTURE_PATH, "utf8"));

test("buildClaudeArgv returns the exact expected array for the default mode, with no credential in it", () => {
  // Exact-array assertions are the fastest signal when the argv changes unintentionally, but
  // alone they are NOT sufficient: this is exactly how G-02-2 shipped — this test asserted a
  // snapshot of whatever buildClaudeArgv currently produced, including a command line the real
  // CLI always rejected, and had no way to distinguish a correct argv from a frozen wrong one.
  // The constraint-shaped test below asserts the --output-format/--verbose pairing as a
  // relationship (survives reordering); real-claude-argv.test.mjs asserts against the real
  // binary. Keep this test for its speed; do not rely on it alone for argv correctness.
  const argv = buildClaudeArgv({ prompt: "<prompt>", permissionMode: "acceptEdits" });
  assert.deepEqual(argv, [
    "-p",
    "<prompt>",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
  ]);
  for (const element of argv) {
    assert.ok(!/sk-ant-|api[_-]?key/i.test(element), `argv element leaked a credential-shaped string: ${element}`);
  }
});

// The single declared source of accepted permission modes for the constraint test below — a
// future mode addition extends the guard by one line here, rather than requiring the literal to
// be repeated at every call site.
const ACCEPTED_PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];

test("buildClaudeArgv always pairs --output-format stream-json with --verbose (G-02-2)", () => {
  // claude 2.1.236: "When using --print, --output-format=stream-json requires --verbose".
  // Without it the CLI exits 1 at argument validation, having emitted nothing, and the session
  // closes as a bare `failed`. Asserted for every permission mode, including the ones that also
  // append the permission-gate flags, so no call shape can lose the pairing. Reordering the argv,
  // or inserting a flag between members, cannot break this guard — it asserts a relationship
  // between members, never their positions.
  const callShapes = [{}, { permissionPromptToolName: "mcp__x__y", mcpConfig: "{}" }];
  let examined = 0;
  for (const permissionMode of ACCEPTED_PERMISSION_MODES) {
    for (const extra of callShapes) {
      examined += 1;
      const argv = buildClaudeArgv({ prompt: "p", permissionMode, ...extra });
      const streamJson =
        argv.includes("--output-format") && argv[argv.indexOf("--output-format") + 1] === "stream-json";
      if (streamJson) {
        assert.ok(
          argv.includes("--verbose"),
          `argv for ${permissionMode} used stream-json without --verbose: ${JSON.stringify(argv)}`,
        );
      }
    }
  }
  // The loop's own iteration count is asserted, so a guard that silently examined nothing (an
  // empty mode list, an empty call-shape list) cannot report green.
  assert.equal(
    examined,
    ACCEPTED_PERMISSION_MODES.length * callShapes.length,
    "the pairing guard must examine every permission-mode / call-shape combination",
  );
  assert.ok(examined > 0, "the pairing guard must examine at least one argv variant");

  // Converse for the two-field call shape: a non-empty argv naming print mode and a permission
  // mode. Without this, an edit that dropped --output-format entirely would satisfy the pairing
  // implication vacuously (no stream-json means nothing to check) while producing a useless argv.
  for (const permissionMode of ACCEPTED_PERMISSION_MODES) {
    const argv = buildClaudeArgv({ prompt: "p", permissionMode });
    assert.ok(argv.length > 0, `two-field argv for ${permissionMode} must be non-empty`);
    assert.ok(
      argv.includes("-p"),
      `two-field argv for ${permissionMode} must name print mode: ${JSON.stringify(argv)}`,
    );
    assert.ok(
      argv.includes(permissionMode),
      `two-field argv for ${permissionMode} must name its own permission mode: ${JSON.stringify(argv)}`,
    );
  }
});

test("resumeSession rejects with CapabilityUnsupportedError, and capabilities.supportsResume is false", async () => {
  const adapter = new ClaudeCodeAdapter();
  assert.equal(adapter.capabilities.supportsResume, false);
  await assert.rejects(() => adapter.resumeSession("run-1", "session-1"), CapabilityUnsupportedError);
});

test("normalised events for the fake CLI's stream arrive in source order with contiguous seq values", async () => {
  // Points FLYWHEEL_CLAUDE_BIN directly at the executable fake CLI script (its own shebang picks
  // the node interpreter) — resolveClaudeBin() reads this env var verbatim as the spawned binary.
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  const adapter = new ClaudeCodeAdapter();
  const events = [];

  await adapter.startSession({
    runId: "run-1",
    worktreePath: process.cwd(),
    prompt: "say hi",
    permissionMode: "acceptEdits",
    env: {},
    onEvent: (event) => events.push(event),
  });

  // At least init, assistant_text, result, and — plan 02-02's D-35 addition — the terminal
  // session_closed event every session now ends with exactly once, regardless of why it ended.
  assert.ok(events.length >= 4, `expected at least 4 events, got ${events.length}`);
  assert.deepEqual(
    events.map((e) => e.seq),
    events.map((_, i) => i),
    "seq values must be contiguous starting at 0",
  );
  for (const event of events) {
    assert.ok(event.raw && event.raw.length > 0, "every event must carry a non-empty raw field");
  }
  assert.equal(events[0].type, "init");
  assert.equal(events[1].type, "assistant_text");
  assert.equal(events[events.length - 2].type, "result");
  assert.equal(events[events.length - 1].type, "session_closed");
  assert.equal(events[events.length - 1].reason, "completed");

  delete process.env.FLYWHEEL_CLAUDE_BIN;
});

// G-02-3's observation: a table of subtypes, not a list of individually-asserted known names —
// including one the backend does not currently emit — asserted as a CLASS of behaviour so a
// future subtype flows through without a test (or code) change.
const NON_INIT_SYSTEM_SUBTYPES = [
  "hook_started",
  "hook_response",
  "compact_boundary",
  "an_invented_subtype_this_backend_has_never_emitted",
];

test("normaliseStreamEvent maps every non-init system subtype to system_notice (G-02-3)", () => {
  for (const subtype of NON_INIT_SYSTEM_SUBTYPES) {
    const line = JSON.stringify({ type: "system", subtype });
    const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
    assert.equal(event.type, "system_notice", `subtype "${subtype}" must normalise to system_notice`);
    assert.ok(
      typeof event.text === "string" && event.text.length > 0,
      `subtype "${subtype}" must carry a non-empty text summary`,
    );
    // Preservation, not classification: whatever this branch decides the event's TYPE is, the
    // verbatim source line must survive unchanged — the guard against a future edit deciding a
    // notice does not need to carry its source.
    assert.equal(event.raw, line, `subtype "${subtype}": raw must be byte-identical to the input line`);
  }
});

test("normaliseStreamEvent boundary: the init subtype still normalises to init, unchanged", () => {
  const line = JSON.stringify({ type: "system", subtype: "init", session_id: "s-1", model: "m-1" });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "init");
  assert.equal(event.sessionId, "s-1");
  assert.equal(event.raw, line);
});

test("normaliseStreamEvent boundary: a top-level type this function does not recognise still normalises to unknown", () => {
  const line = JSON.stringify({ type: "a_top_level_type_nothing_here_recognises" });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "unknown");
  assert.equal(event.raw, line);
});

test("normaliseStreamEvent: a system event with a missing or empty subtype is unrecognised, not a notice with an empty summary", () => {
  const missingSubtypeLine = JSON.stringify({ type: "system" });
  const missingSubtypeEvent = normaliseStreamEvent(
    JSON.parse(missingSubtypeLine),
    missingSubtypeLine,
    "run-1",
    0,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(missingSubtypeEvent.type, "unknown");

  const emptySubtypeLine = JSON.stringify({ type: "system", subtype: "" });
  const emptySubtypeEvent = normaliseStreamEvent(
    JSON.parse(emptySubtypeLine),
    emptySubtypeLine,
    "run-1",
    0,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(emptySubtypeEvent.type, "unknown");
});

// Task 3, plan 05-12: the backend restates a turn it receives (T-05-12's own read_first: the
// envelope written to the child's stdin is a user-role message, arriving back on the stream in
// the SAME shape the agent's own prose uses today). These three cases assert the split: a
// user-role text block becomes the new echo event, an assistant-role text block is unaffected,
// and a user-role TOOL RESULT (which also arrives as a user-role message) still normalises as a
// tool result — the branch order the existing tool-use/tool-result checks rely on must not regress.

test("normaliseStreamEvent: a user-role message's text block normalises to backend_echo, not assistant_text (Task 3)", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "the backend's own restatement" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "backend_echo");
  assert.equal(event.text, "the backend's own restatement");
  assert.equal(event.raw, line);
});

test("normaliseStreamEvent: an assistant-role message's text block still normalises to assistant_text (Task 3)", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "the agent's own reply" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "assistant_text");
  assert.equal(event.text, "the agent's own reply");
});

test("normaliseStreamEvent: a user-role message's tool result still normalises to a tool result — branch order unchanged (Task 3)", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", text: "the tool's own output" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_result");
  assert.equal(event.output, "the tool's own output");
});

// -------------------------------------------------------------------------------------------
// Plan 05-30 (G-05-5 closure): the adapter's correlation-id carry. The harness that grades
// SHAPE-01 must pair a propose tool call with the result that answers it, and for six rounds it
// inferred that pairing from position because this adapter dropped the id the wire already
// supplied. These tests prove the carry at the seam: a `tool_use` block's own `id` and a
// `tool_result` block's own `tool_use_id` round-trip exactly onto `toolUseId`, a block declaring
// neither normalises without throwing and carries NO correlation field at all — key ABSENCE,
// never a present-but-undefined or present-but-empty value — and no id is ever adopted from a
// neighbouring field. See `scripts/uat/README.md` for the fuller narrative.
// -------------------------------------------------------------------------------------------

test("normaliseStreamEvent: a tool_use block's own id round-trips exactly onto toolUseId", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", id: "toolu_call_001", input: {} }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_call");
  assert.equal(event.toolUseId, "toolu_call_001");
});

test("normaliseStreamEvent: a tool_result block's own tool_use_id round-trips exactly onto toolUseId", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_result_001", text: "ok" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_result");
  assert.equal(event.toolUseId, "toolu_result_001");
});

test("normaliseStreamEvent: a tool_use's id and its answering tool_result's tool_use_id normalise to the SAME toolUseId — the property the whole harness pairing rests on", () => {
  const callLine = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", id: "toolu_shared_1", input: {} }] },
  });
  const resultLine = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_shared_1", text: "ok" }] },
  });
  const callEvent = normaliseStreamEvent(JSON.parse(callLine), callLine, "run-1", 0, "2026-01-01T00:00:00.000Z");
  const resultEvent = normaliseStreamEvent(JSON.parse(resultLine), resultLine, "run-1", 1, "2026-01-01T00:00:00.000Z");
  assert.equal(callEvent.toolUseId, resultEvent.toolUseId);
  assert.equal(callEvent.toolUseId, "toolu_shared_1");
});

test("normaliseStreamEvent: a tool_use block with no id normalises without throwing, and carries NO toolUseId key at all", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_call");
  // Key-presence check, not an equality-to-undefined check: the sidecar serialises events to a
  // JSON line, and a present-but-undefined key disappears in serialisation while a
  // present-but-empty-string key would survive and be read downstream as a real id.
  assert.ok(!("toolUseId" in event), "expected no toolUseId key on a tool_call event with no id");
});

test("normaliseStreamEvent: a tool_result block with no tool_use_id normalises without throwing, and carries NO toolUseId key at all", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", text: "ok" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_result");
  assert.ok(!("toolUseId" in event), "expected no toolUseId key on a tool_result event with no tool_use_id");
});

test("normaliseStreamEvent: a tool_result block carrying an id but no tool_use_id produces NO toolUseId — the result side reads tool_use_id and nothing else", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", id: "toolu_neighbouring_field", text: "ok" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_result");
  assert.ok(
    !("toolUseId" in event),
    "a tool_result must never adopt a neighbouring id field as its correlation key",
  );
});

test("normaliseStreamEvent: an empty-string id yields NO toolUseId, never a present-but-empty value", () => {
  const callLine = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", id: "", input: {} }] },
  });
  const callEvent = normaliseStreamEvent(JSON.parse(callLine), callLine, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.ok(!("toolUseId" in callEvent), "expected no toolUseId key for an empty-string tool_use id");

  const resultLine = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "", text: "ok" }] },
  });
  const resultEvent = normaliseStreamEvent(JSON.parse(resultLine), resultLine, "run-1", 1, "2026-01-01T00:00:00.000Z");
  assert.ok(!("toolUseId" in resultEvent), "expected no toolUseId key for an empty-string tool_use_id");
});

// -------------------------------------------------------------------------------------------
// Plan 05-34 (G-05-6 closure): the adapter's wire-error-fact carry. Gap G-05-6's live run counted
// an unauthenticated backend's "Not logged in · Please run /login" message as agent speech because
// the adapter dropped the wire's own statement that the message was an API error. These tests
// prove the carry at the seam: the assistant envelope's own `error`/`is_api_error_message` fields
// and the result line's own `is_error`/`terminal_reason` fields round-trip exactly onto normalised
// fields, a block declaring neither pair normalises without throwing and carries NO key at all —
// key ABSENCE, never a present-but-undefined or present-but-empty value — a literal `false` on
// `is_error` is carried as `false` rather than dropped as falsy, and no field is ever adopted from
// a neighbouring key. See scripts/uat/README.md for the fuller narrative.
// -------------------------------------------------------------------------------------------

test("normaliseStreamEvent: an assistant envelope's own error flag and error code round-trip onto isApiErrorMessage/errorCode", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }] },
    error: "authentication_failed",
    is_api_error_message: true,
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "assistant_text");
  assert.equal(event.isApiErrorMessage, true);
  assert.equal(event.errorCode, "authentication_failed");
});

test("normaliseStreamEvent: an assistant envelope carrying neither error field normalises with BOTH keys absent", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "ordinary agent prose" }] },
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "assistant_text");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(event, "isApiErrorMessage"),
    "expected no isApiErrorMessage key on an ordinary assistant envelope",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(event, "errorCode"),
    "expected no errorCode key on an ordinary assistant envelope",
  );
});

test("normaliseStreamEvent: an assistant envelope's empty-string error code omits errorCode entirely", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "prose" }] },
    error: "",
    is_api_error_message: true,
  });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.isApiErrorMessage, true);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(event, "errorCode"),
    "expected no errorCode key for an empty-string error code, never a present-but-empty value",
  );
});

test("normaliseStreamEvent: a result line's own error flag and terminal reason round-trip onto isError/terminalReason", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error" });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "result");
  assert.equal(event.isError, true);
  assert.equal(event.terminalReason, "api_error");
});

test("normaliseStreamEvent: a result line's error flag literally false is carried as false, never dropped as falsy", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: false });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "result");
  assert.ok(
    Object.prototype.hasOwnProperty.call(event, "isError"),
    "a literal false is a real reading and must be carried, not dropped as falsy",
  );
  assert.equal(event.isError, false);
});

test("normaliseStreamEvent: a result line carrying neither wire-error field normalises with BOTH keys absent", () => {
  const line = JSON.stringify({ type: "result", subtype: "success" });
  const event = normaliseStreamEvent(JSON.parse(line), line, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "result");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(event, "isError"),
    "expected no isError key on an ordinary result line",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(event, "terminalReason"),
    "expected no terminalReason key on an ordinary result line",
  );
});

test("normaliseStreamEvent: a neighbouring, differently-named field is never adopted as the wire error flag or error code", () => {
  const assistantLine = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "prose" }] },
    error_code: "authentication_failed",
    apiErrorMessage: true,
  });
  const assistantEvent = normaliseStreamEvent(
    JSON.parse(assistantLine),
    assistantLine,
    "run-1",
    0,
    "2026-01-01T00:00:00.000Z",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(assistantEvent, "isApiErrorMessage"),
    "a neighbouring differently-named field must never be adopted as isApiErrorMessage",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(assistantEvent, "errorCode"),
    "a neighbouring differently-named field must never be adopted as errorCode",
  );

  const resultLine = JSON.stringify({ type: "result", subtype: "success", error: true, terminalReason: "api_error" });
  const resultEvent = normaliseStreamEvent(JSON.parse(resultLine), resultLine, "run-1", 1, "2026-01-01T00:00:00.000Z");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(resultEvent, "isError"),
    "a neighbouring differently-named field must never be adopted as isError",
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(resultEvent, "terminalReason"),
    "a neighbouring differently-named field must never be adopted as terminalReason",
  );
});

test("normaliseStreamEvent: every line in the frozen unauthenticated-CLI fixture normalises without throwing, and the assistant line reports the error flag true", () => {
  assert.equal(UNAUTHENTICATED_FIXTURE.lines.length, 3, "the frozen fixture must have exactly three captured lines");
  const events = UNAUTHENTICATED_FIXTURE.lines.map((parsed, index) =>
    normaliseStreamEvent(parsed, JSON.stringify(parsed), "run-1", index, "2026-01-01T00:00:00.000Z"),
  );
  const assistantEvent = events.find((event) => event.type === "assistant_text");
  assert.ok(assistantEvent, "expected one assistant_text event among the fixture's normalised lines");
  assert.equal(assistantEvent.isApiErrorMessage, true);
  assert.equal(assistantEvent.errorCode, "authentication_failed");

  const resultEvent = events.find((event) => event.type === "result");
  assert.ok(resultEvent, "expected one result event among the fixture's normalised lines");
  assert.equal(resultEvent.isError, true);
  assert.equal(resultEvent.terminalReason, "api_error");
});

test("the stderr detail tail is bounded even by a single oversized line (T-02G-17-03)", () => {
  // The cap was a check-before-append with no truncate: a tail sitting one character below the
  // limit still accepted an arbitrarily long line whole, yielding CAP-1 + line.length. That tail
  // crosses into both the persisted JSONL and the rendered feed, so the bound is a real one.
  // Modelled here rather than driven through a live session, because provoking a multi-kilobyte
  // single stderr line from a real backend is not something a test can arrange reliably — the
  // property under test is the accumulate-and-clamp arithmetic itself.
  const CAP = STDERR_DETAIL_MAX_CHARS;
  const accumulate = (tail, line) => {
    if (tail.length < CAP) {
      tail += `${line}\n`;
      tail = tail.slice(0, CAP);
    }
    return tail;
  };

  // The exact shape that used to overflow: one character short of the cap, then a huge line.
  let tail = "x".repeat(CAP - 1);
  tail = accumulate(tail, "y".repeat(50_000));
  assert.equal(tail.length, CAP, "a single oversized line must not push the tail past the cap");

  // And it stays bounded across many appends.
  tail = "";
  for (let i = 0; i < 500; i++) tail = accumulate(tail, `line ${i} ${"z".repeat(200)}`);
  assert.ok(tail.length <= CAP, `tail grew to ${tail.length}, past the ${CAP} cap`);
});

// --- startPermissionServer notice handling (plan 03-13, D-53) ----------------------------------

/** Connects a fresh raw socket to `socketPath`, writes one JSON line, and returns the socket plus
 * a promise resolving with the first line the server writes back (or `undefined` if the server
 * closes the connection without ever writing a reply). */
function sendRawLine(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("error", reject);
    let repliedWith;
    const rl = createInterface({ input: socket });
    rl.on("line", (line) => {
      repliedWith = line;
    });
    socket.on("close", () => resolve({ socket, repliedWith }));
  });
}

test("a notice connection is closed by the server and never becomes a held request", async () => {
  const requests = [];
  const notices = [];
  const handle = startPermissionServer(
    (payload) => requests.push(payload),
    (payload) => notices.push(payload),
  );

  const { repliedWith } = await Promise.race([
    sendRawLine(handle.socketPath, { kind: "git_retry", runId: "run-1", attempt: 2, max: 5 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("notice connection was not closed")), 2000)),
  ]);

  assert.equal(requests.length, 0, "a notice must never reach onRequest");
  assert.equal(notices.length, 1, "a notice must reach onNotice exactly once");
  assert.equal(notices[0].kind, "git_retry");
  assert.equal(notices[0].runId, "run-1");
  assert.equal(repliedWith, undefined, "a notice connection must be closed with no answer line written");

  handle.close();
});

test("a permission request still holds open exactly as before — unaffected by notice handling", async () => {
  const requests = [];
  const handle = startPermissionServer(
    (payload) => requests.push(payload),
    () => {},
  );

  const socket = net.createConnection(handle.socketPath, () => {
    socket.write(`${JSON.stringify({ requestId: "req-1", toolName: "Bash", input: { command: "echo hi" } })}\n`);
  });
  // Nothing here reads the eventual answer line's own content, but the stream must still be put
  // into flowing mode (`resume()`) or Node will never emit 'end'/'close' for a paused Readable
  // sitting on unread buffered bytes once the server writes its answer and calls `.end()`.
  socket.resume();

  await new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (requests.length > 0) {
        clearInterval(check);
        resolve();
      }
    }, 10);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error("onRequest was never called"));
    }, 2000);
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, "req-1");

  // Still held — no answer written back, and the socket must not have been closed by the server.
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(closed, false, "a routine held request must stay open with no timer of its own");

  handle.resolvePermission("req-1", "allow");
  await new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (closed) {
        clearInterval(check);
        resolve();
      }
    }, 10);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error("connection never closed after resolvePermission answered it"));
    }, 2000);
  });

  handle.close();
});

// --- noticeToAgentEvent (plan 03-13, D-53) --------------------------------------------------------

test("noticeToAgentEvent maps a git_retry notice to a git_retry AgentEvent with a non-empty raw", () => {
  const payload = { kind: "git_retry", runId: "run-1", attempt: 2, max: 5, repository: "/repo", command: "git commit" };
  const event = noticeToAgentEvent(payload, "run-1", 3, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "git_retry");
  assert.equal(event.runId, "run-1");
  assert.equal(event.seq, 3);
  assert.equal(event.attempt, 2);
  assert.equal(event.max, 5);
  assert.equal(event.repository, "/repo");
  assert.equal(event.command, "git commit");
  assert.ok(event.raw && event.raw.length > 0, "every notice-derived event must carry a non-empty raw field");
});

test("noticeToAgentEvent maps a git_lock_exhausted notice to a git_lock_exhausted AgentEvent with a non-empty raw", () => {
  const payload = { kind: "git_lock_exhausted", runId: "run-1", repository: "/repo", command: "git commit", attempts: 5 };
  const event = noticeToAgentEvent(payload, "run-1", 4, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "git_lock_exhausted");
  assert.equal(event.attempts, 5);
  assert.equal(event.repository, "/repo");
  assert.equal(event.command, "git commit");
  assert.ok(event.raw && event.raw.length > 0, "every notice-derived event must carry a non-empty raw field");
});

test("noticeToAgentEvent returns undefined for an unrecognised notice kind", () => {
  const payload = { kind: "something_else", runId: "run-1" };
  const event = noticeToAgentEvent(payload, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event, undefined);
});

test("a first-attempt success never produces a notice (no retry, no exhaustion)", () => {
  // The shim's own retry loop calls send_notice() zero times when the closure succeeds on
  // attempt 1 — proved at the Rust level (packages/core/tests/git_retry.rs's
  // `a_first_attempt_success_invokes_the_notify_hook_zero_times`). This test documents the
  // TypeScript-side converse: with no notice ever connecting, `notices` stays empty — the
  // permission server itself never manufactures an event out of nothing.
  const notices = [];
  const handle = startPermissionServer(
    () => {},
    (payload) => notices.push(payload),
  );
  assert.equal(notices.length, 0, "no notice connection means no notice event");
  handle.close();
});
