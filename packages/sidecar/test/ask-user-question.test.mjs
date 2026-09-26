/**
 * G-05-8(a) (plan 05-41): pins the edge behaviour of the `AskUserQuestion` seam Task 1 built —
 * the frozen live capture's happy path, every degenerate/malformed input shape, the tool-name gate,
 * duplicate-question adjacency, the two truncation bounds, per-option skip-not-repair, and the
 * envelope-leakage prohibition (T-05-41-02). The final test is the fixture-wide invariant
 * `05-40-PLAN.md`'s own `<assumption_delta_decision>` names as the generalized suggestion this
 * round does not need to promote: every content-block type any frozen fixture carries must
 * normalise to something other than `unknown`.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  ASK_USER_QUESTION_TOOL_NAME,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_OPTIONS,
  normaliseStreamEvent,
  parseAskUserQuestionInput,
} from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../../../scripts/uat/fixtures");

const LIVE_FIXTURE = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "live-opus5-ask-user-question.json"), "utf8"),
);
const LIVE_LINE = LIVE_FIXTURE.shapes.find((s) => s.name === "ask-user-question").line;

/** Build a bare `tool_use` assistant line with the given tool name and input — the same object
 * shape `normaliseStreamEvent` reads off the wire, mirroring `adapter.test.mjs`'s own convention
 * of constructing lines inline rather than importing a shared builder. */
function toolUseLine(name, input) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_x", name, input }] },
  };
}

test("normaliseStreamEvent: the frozen live AskUserQuestion line yields three questions in emitted order with option labels and descriptions intact", () => {
  const raw = JSON.stringify(LIVE_LINE);
  const event = normaliseStreamEvent(LIVE_LINE, raw, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_call");
  assert.equal(event.toolName, "AskUserQuestion");
  assert.equal(event.toolUseId, "toolu_01GEr3iTHPDe35A6zShpHJeG");
  assert.equal(Object.hasOwn(event, "questions"), true, "expected a present questions key on a real AskUserQuestion call");
  assert.equal(event.questions.length, 3);
  assert.deepEqual(
    event.questions.map((q) => q.header),
    ["Triggers", "Channels", "Timing"],
  );
  assert.deepEqual(
    event.questions.map((q) => q.options.length),
    [4, 4, 3],
  );
  assert.deepEqual(
    event.questions.map((q) => q.multiSelect),
    [true, true, false],
  );
  const firstOption = event.questions[0].options[0];
  assert.equal(firstOption.label, "Assigned to me");
  assert.ok(firstOption.description.startsWith("A card/task on the board is assigned"));
});

test("parseAskUserQuestionInput / normaliseStreamEvent: every degenerate AskUserQuestion payload yields NO questions key at all — key-presence check, never a truthiness check", () => {
  const degenerateInputs = [{ questions: [] }, {}, null, "text", 42, { questions: "no" }, { questions: [{}] }];
  for (const input of degenerateInputs) {
    assert.equal(
      parseAskUserQuestionInput(input),
      undefined,
      `expected parseAskUserQuestionInput(${JSON.stringify(input)}) to return undefined`,
    );

    const line = toolUseLine(ASK_USER_QUESTION_TOOL_NAME, input);
    const raw = JSON.stringify(line);
    const event = normaliseStreamEvent(line, raw, "run-1", 0, "2026-01-01T00:00:00.000Z");
    assert.equal(event.type, "tool_call");
    assert.equal(
      Object.hasOwn(event, "questions"),
      false,
      `expected no questions key for input ${JSON.stringify(input)}, got ${JSON.stringify(event.questions)}`,
    );
  }
});

test("normaliseStreamEvent: a tool_use block named Bash whose input happens to contain a questions array yields NO questions field — the parse gates on the tool name", () => {
  const line = toolUseLine("Bash", { questions: [{ question: "not really a prompt", options: [{ label: "x" }] }] });
  const raw = JSON.stringify(line);
  const event = normaliseStreamEvent(line, raw, "run-1", 0, "2026-01-01T00:00:00.000Z");
  assert.equal(event.type, "tool_call");
  assert.equal(event.toolName, "Bash");
  assert.equal(Object.hasOwn(event, "questions"), false, "expected no questions field for a non-AskUserQuestion tool");
});

test("parseAskUserQuestionInput: two questions with identical question text yield two entries, never merged", () => {
  const input = {
    questions: [
      { question: "Same text?", options: [{ label: "a" }] },
      { question: "Same text?", options: [{ label: "b" }] },
    ],
  };
  const result = parseAskUserQuestionInput(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].question, "Same text?");
  assert.equal(result[1].question, "Same text?");
  assert.equal(result[0].options[0].label, "a");
  assert.equal(result[1].options[0].label, "b");
});

test(`parseAskUserQuestionInput: a questions array of MAX_ASK_USER_QUESTIONS + 5 entries yields exactly MAX_ASK_USER_QUESTIONS entries, the first ones in order`, () => {
  const oversized = Array.from({ length: MAX_ASK_USER_QUESTIONS + 5 }, (_, i) => ({
    question: `question ${i}`,
    options: [{ label: `option ${i}` }],
  }));
  const result = parseAskUserQuestionInput({ questions: oversized });
  assert.equal(result.length, MAX_ASK_USER_QUESTIONS);
  assert.deepEqual(
    result.map((q) => q.question),
    oversized.slice(0, MAX_ASK_USER_QUESTIONS).map((q) => q.question),
  );
});

test(`parseAskUserQuestionInput: a question with MAX_ASK_USER_QUESTION_OPTIONS + 5 options yields exactly MAX_ASK_USER_QUESTION_OPTIONS options, the first ones in order`, () => {
  const oversizedOptions = Array.from({ length: MAX_ASK_USER_QUESTION_OPTIONS + 5 }, (_, i) => ({
    label: `option ${i}`,
  }));
  const result = parseAskUserQuestionInput({ questions: [{ question: "q", options: oversizedOptions }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].options.length, MAX_ASK_USER_QUESTION_OPTIONS);
  assert.deepEqual(
    result[0].options.map((o) => o.label),
    oversizedOptions.slice(0, MAX_ASK_USER_QUESTION_OPTIONS).map((o) => o.label),
  );
});

test("parseAskUserQuestionInput: an option entry with no label is skipped while its siblings survive", () => {
  const result = parseAskUserQuestionInput({
    questions: [
      {
        question: "q",
        options: [{ label: "keep-1" }, { description: "no label here" }, { label: "keep-2" }],
      },
    ],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].options.map((o) => o.label),
    ["keep-1", "keep-2"],
  );
});

test("normaliseStreamEvent: the frozen envelope's own signature/caller/usage fields appear nowhere on the typed questions field", () => {
  // `raw` and `input` legitimately carry the verbatim original envelope/payload (every event's
  // pre-existing, unconditional passthrough fields — Task 1's own "additive, nothing lost"
  // comment) — this assertion is about the NEW typed `questions` field specifically (T-05-41-02):
  // only `question`/`header`/`multiSelect`/`label`/`description` may appear on it, never the
  // envelope's `caller`/`usage`/`signature` siblings the frozen line also carries.
  const raw = JSON.stringify(LIVE_LINE);
  const event = normaliseStreamEvent(LIVE_LINE, raw, "run-1", 0, "2026-01-01T00:00:00.000Z");
  const serialisedQuestions = JSON.stringify(event.questions);
  for (const forbidden of ["signature", "caller", "cache_read_input_tokens"]) {
    assert.ok(
      !serialisedQuestions.includes(forbidden),
      `expected "${forbidden}" to appear nowhere on the normalised event's questions field`,
    );
  }
});

/** Collect every wire line a fixture file declares, handling both the `shapes[].line` shape
 * (`live-opus5-unmodelled-shapes.json`, `live-opus5-ask-user-question.json`) and the flat
 * `lines` array shape (`unauthenticated-cli-first-turn.json`). Returns an empty array — never
 * throws — for a fixture declaring neither, per 05-40-PLAN.md's own `<assumption_delta_decision>`
 * suggested invariant wording ("skipping any file that declares neither rather than failing on
 * it").
 */
function collectFixtureLines(fixture) {
  if (Array.isArray(fixture.shapes)) return fixture.shapes.map((s) => s.line);
  if (Array.isArray(fixture.lines)) return fixture.lines;
  return [];
}

test("fixture-wide invariant (05-40-PLAN.md <assumption_delta_decision>): every content-block type present across every fixture under scripts/uat/fixtures/ normalises to something other than unknown", () => {
  const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  assert.ok(fixtureFiles.length > 0, "expected at least one fixture file under scripts/uat/fixtures/");

  const observedContentBlockTypes = new Set();
  let linesExamined = 0;

  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
    const lines = collectFixtureLines(fixture);
    for (const line of lines) {
      linesExamined += 1;
      for (const block of line?.message?.content ?? []) {
        if (typeof block?.type === "string") observedContentBlockTypes.add(block.type);
      }
      const raw = JSON.stringify(line);
      const event = normaliseStreamEvent(line, raw, "run-1", 0, "2026-01-01T00:00:00.000Z");
      assert.notEqual(
        event.type,
        "unknown",
        `fixture "${file}": a line normalised to unknown — ${raw.slice(0, 200)}`,
      );
    }
  }

  assert.ok(linesExamined > 0, "expected at least one line across every fixture — a vacuous invariant proves nothing");
  assert.ok(
    observedContentBlockTypes.size > 0,
    "expected at least one distinct content-block type observed across every fixture — a vacuous invariant proves nothing",
  );
});
