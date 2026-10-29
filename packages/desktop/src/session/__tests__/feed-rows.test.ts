/**
 * Story #56: which log entries become feed rows. The v0.1 walk (2026-10-16, entries 6, 21, 28, 34)
 * logged a feed made mostly of noise — hook lifecycle notices, reasoning blocks, rate-limit events,
 * Claude Code's own read-only git calls — and tool results shown as raw JSON because nothing paired
 * them with their call. Input shapes come from the real captures in `scripts/uat/fixtures/`.
 */
import { describe, expect, it } from "vitest";
import askFixture from "../../../../../scripts/uat/fixtures/live-opus5-ask-user-question.json";
import unmodelledFixture from "../../../../../scripts/uat/fixtures/live-opus5-unmodelled-shapes.json";
import { buildFeedRows, isReadOnlyGitCommand } from "../feedRows";
import { at } from "../../test/present";

const AT = "2026-10-19T10:00:00.000Z";
let seq = 0;

function ev(fields: Record<string, unknown>): Record<string, unknown> {
  seq += 1;
  return { runId: "run-1", seq, at: AT, raw: `raw-${seq}`, ...fields };
}

function bash(command: string, toolUseId = `toolu_${seq + 1}`) {
  return ev({ type: "tool_call", toolName: "Bash", input: { command }, toolUseId });
}

function result(toolUseId: string, output: unknown) {
  // The real wire's tool result carries no tool name: only the id of the call it answers.
  return ev({ type: "tool_result", output, toolUseId });
}

describe("noise stays out of the feed", () => {
  it("drops hook lifecycle and thinking-token notices, keeping other system notices", () => {
    const rows = buildFeedRows([
      ev({ type: "system_notice", text: "system: hook_started" }),
      ev({ type: "system_notice", text: "system: hook_response" }),
      ev({ type: "system_notice", text: "system: hook_progress" }),
      ev({ type: "system_notice", text: "system: thinking_tokens" }),
      ev({ type: "system_notice", text: "Retrying request…" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "system_notice", text: "Retrying request…" });
  });

  it("drops the captured reasoning-only message and rate-limit notice", () => {
    const events = unmodelledFixture.shapes.map((shape) =>
      ev({ type: shape.expectedEventType, raw: JSON.stringify(shape.line), text: "", hasSignature: true }),
    );
    expect(events.map((e) => e.type)).toEqual(["rate_limit", "thinking"]);
    expect(buildFeedRows(events)).toEqual([]);
  });

  it("drops tool_progress heartbeats as rows of their own", () => {
    expect(
      buildFeedRows([ev({ type: "tool_progress", toolUseId: "t", toolName: "Bash", elapsedSeconds: 30 })]),
    ).toEqual([]);
  });

  it("drops read-only git calls and their results, keeping git calls that change something", () => {
    const status = bash("git status --short", "toolu_s");
    const ls = bash(
      "git -c core.hooksPath=/dev/null ls-files --error-unmatch -- .claude/settings.local.json",
      "toolu_l",
    );
    const log = bash("git log --oneline -5 | head -3", "toolu_g");
    const commit = bash('git commit -m "feat: x"', "toolu_c");
    const rows = buildFeedRows([
      status,
      result("toolu_s", " M a.ts"),
      ls,
      result("toolu_l", "error: pathspec"),
      log,
      result("toolu_g", "abc123 feat"),
      commit,
      result("toolu_c", "[main abc] feat: x"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool_call", toolName: "Bash", output: "[main abc] feat: x" });
  });

  it("carries when a call's result came, so the row can say how long it took (#118)", () => {
    const rows = buildFeedRows([
      { ...bash("npm test", "toolu_t"), at: "2026-10-19T10:00:00.000Z" },
      { ...ev({ type: "tool_result", toolUseId: "toolu_t", output: "ok" }), at: "2026-10-19T10:00:41.000Z" },
    ]);
    expect(rows[0]).toMatchObject({ startedAt: "2026-10-19T10:00:00.000Z", endedAt: "2026-10-19T10:00:41.000Z" });
  });
});

describe("isReadOnlyGitCommand", () => {
  it.each([
    "git status",
    "git diff HEAD~1 -- src",
    "git -C /tmp/repo log --oneline",
    "git show HEAD:README.md",
    "git rev-parse --show-toplevel",
    "git branch --show-current",
    "git branch -a",
    "git worktree list",
    "git stash list",
    "git remote -v",
    "git config --get user.name",
    "cd packages/core && git diff --stat",
    "git log --oneline | head -20",
  ])("treats %s as read-only", (command) => {
    expect(isReadOnlyGitCommand(command)).toBe(true);
  });

  it.each([
    "git commit -m x",
    "git push",
    "git checkout -b feature",
    "git branch -D old",
    "git branch new-branch",
    "git stash",
    "git worktree add ../x",
    "git config user.name me",
    "git status && rm -rf build",
    "git diff > patch.diff",
    "git log $(rm -rf /)",
    "npm test",
    "",
  ])("does not treat %s as read-only", (command) => {
    expect(isReadOnlyGitCommand(command)).toBe(false);
  });
});

describe("tool results pair with their call", () => {
  it("pairs by call id even when two same-named calls finish out of order", () => {
    const rows = buildFeedRows([
      ev({ type: "tool_call", toolName: "Read", input: { file_path: "a.ts" }, toolUseId: "toolu_a" }),
      ev({ type: "tool_call", toolName: "Read", input: { file_path: "b.ts" }, toolUseId: "toolu_b" }),
      result("toolu_b", "contents of b"),
      result("toolu_a", "contents of a"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "tool_call", input: { file_path: "a.ts" }, output: "contents of a" });
    expect(rows[1]).toMatchObject({ kind: "tool_call", input: { file_path: "b.ts" }, output: "contents of b" });
  });

  it("carries a failed result's error flag onto its call", () => {
    const rows = buildFeedRows([
      bash("npm test", "toolu_t"),
      ev({ type: "tool_result", output: "1 failed", toolUseId: "toolu_t", isError: true }),
    ]);
    expect(rows[0]).toMatchObject({ kind: "tool_call", isError: true });
  });

  it("folds the newest heartbeat into the call it names", () => {
    const rows = buildFeedRows([
      bash("cargo test --workspace", "toolu_long"),
      ev({ type: "tool_progress", toolUseId: "toolu_long", toolName: "Bash", elapsedSeconds: 30 }),
      ev({ type: "tool_progress", toolUseId: "toolu_long", toolName: "Bash", elapsedSeconds: 60 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool_call", elapsedSeconds: 60, startedAt: AT });
  });

  it("shows a result with no call loaded as a result row carrying its text, never the raw line", () => {
    const rows = buildFeedRows([result("toolu_gone", "orphaned output")]);
    expect(rows).toEqual([expect.objectContaining({ kind: "tool_result", output: "orphaned output" })]);
  });
});

describe("requests and Proposals are cards", () => {
  it("turns the captured AskUserQuestion call into a question card answered by the CLI's result", () => {
    const line = at(askFixture.shapes, 0).line;
    const block = line.message.content.find((b) => b.type === "tool_use")!;
    const rows = buildFeedRows([
      ev({ type: "tool_call", toolName: block.name, input: block.input, toolUseId: block.id }),
      result(askFixture.cliAnsweredToolResult.tool_use_id, askFixture.cliAnsweredToolResult.content),
    ]);
    expect(rows).toHaveLength(1);
    const card = at(rows, 0);
    expect(card.kind).toBe("question");
    if (card.kind !== "question") return;
    const [first] = card.questions;
    expect(first?.question).toBe("Which events should generate a notification in the first version?");
    expect(first?.options.length).toBeGreaterThan(1);
    expect(card.answer).toBe("The user did not answer the questions.");
  });

  it("turns a propose_* board tool call into a Proposal card", () => {
    const rows = buildFeedRows([
      ev({
        type: "tool_call",
        toolName: "mcp__flywheel__propose_story",
        input: { title: "Pair results by id", why: "FIFO by name mispairs" },
        toolUseId: "toolu_p",
      }),
      result("toolu_p", "Proposal P-12 filed"),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "proposal",
        toolName: "mcp__flywheel__propose_story",
        output: "Proposal P-12 filed",
      }),
    ]);
  });
});
