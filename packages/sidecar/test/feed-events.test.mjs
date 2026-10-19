/**
 * Story #56 (the session feed is readable): the two wire shapes the feed could not read.
 *
 * - A real tool result carries its output on `content` (a string, or an array of text blocks), not
 *   on `text`. The adapter read `text` only, so every real result reached the feed with no output.
 *   Grounded in `scripts/uat/fixtures/live-opus5-ask-user-question.json`'s `cliAnsweredToolResult`.
 * - `tool_progress` is Claude Code's heartbeat for a long tool call (`elapsed_time_seconds` 30, 60
 *   in the v0.1 walk, entry 34). It fell through to `unknown`, so a healthy run looked stalled.
 *   No capture of the line exists in this repo; the shape below is the Agent SDK's documented
 *   `SDKToolProgressMessage` with the field values the walk logged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { normaliseStreamEvent } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASK_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, "../../../scripts/uat/fixtures/live-opus5-ask-user-question.json"), "utf8"),
);
const AT = "2026-10-19T00:00:00.000Z";

function normalise(line) {
  const raw = JSON.stringify(line);
  return normaliseStreamEvent(JSON.parse(raw), raw, "run-1", 0, AT);
}

test("a real tool result's string content becomes its output", () => {
  const block = ASK_FIXTURE.cliAnsweredToolResult;
  const event = normalise({ type: "user", message: { role: "user", content: [block] } });
  assert.equal(event.type, "tool_result");
  assert.equal(event.output, "The user did not answer the questions.");
  assert.equal(event.toolUseId, "toolu_01GEr3iTHPDe35A6zShpHJeG");
});

test("a tool result whose content is text blocks becomes their joined text", () => {
  const event = normalise({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "text", text: "first part" },
            { type: "image", source: { type: "base64", data: "AAAA" } },
            { type: "text", text: "second part" },
          ],
        },
      ],
    },
  });
  assert.equal(event.output, "first part\nsecond part");
});

test("a tool result's is_error is carried as isError, and absent when the wire has none", () => {
  const failed = normalise({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "boom", is_error: true }] },
  });
  assert.equal(failed.isError, true);
  const plain = normalise({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
  });
  assert.equal("isError" in plain, false);
});

test("the legacy text field still reads when content is absent", () => {
  const event = normalise({ type: "user", message: { role: "user", content: [{ type: "tool_result", text: "old" }] } });
  assert.equal(event.output, "old");
});

test("a tool_progress heartbeat normalises to tool_progress, carrying the call id, tool and elapsed seconds", () => {
  const event = normalise({
    type: "tool_progress",
    tool_use_id: "toolu_01Long",
    tool_name: "Bash",
    parent_tool_use_id: null,
    elapsed_time_seconds: 60,
    uuid: "11111111-1111-1111-1111-111111111111",
    session_id: "sess-1",
  });
  assert.equal(event.type, "tool_progress");
  assert.equal(event.toolUseId, "toolu_01Long");
  assert.equal(event.toolName, "Bash");
  assert.equal(event.elapsedSeconds, 60);
});

test("a malformed tool_progress line omits what it lacks and never throws", () => {
  const event = normalise({ type: "tool_progress", elapsed_time_seconds: "soon" });
  assert.equal(event.type, "tool_progress");
  assert.equal("toolUseId" in event, false);
  assert.equal("toolName" in event, false);
  assert.equal("elapsedSeconds" in event, false);
});
