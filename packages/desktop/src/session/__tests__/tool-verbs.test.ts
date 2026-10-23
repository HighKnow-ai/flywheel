/**
 * Story #118: every tool call reads as a plain verb and what it acted on, board tools by their meaning,
 * with its metrics on the right. No raw `mcp__` name ever reaches the screen.
 */
import { describe, expect, it } from "vitest";
import { describeToolCall, formatDuration, toolCallSeconds, toolDisplayName } from "../toolVerbs";

const BOARD = "mcp__flywheel-board__";

describe("describeToolCall: Claude Code's own tools", () => {
  it("reads a Read as Read, its file, and the lines it returned", () => {
    expect(describeToolCall({ toolName: "Read", input: { file_path: "src/a.ts" }, output: "1\ta\n2\tb\n3\tc" })).toMatchObject({
      kind: "read",
      verb: "Read",
      liveVerb: "Reading",
      target: "src/a.ts",
      targetIsCode: true,
      metrics: [{ text: "3 lines", tone: "neutral" }],
    });
  });

  it("reads an Edit as Edited with the lines it added and removed", () => {
    const d = describeToolCall({ toolName: "Edit", input: { file_path: "src/a.ts", old_string: "a\nb", new_string: "a\nb\nc\nd" } });
    expect(d).toMatchObject({ kind: "edit", verb: "Edited", target: "src/a.ts" });
    expect(d.metrics).toEqual([{ text: "+4 −2", tone: "neutral" }]);
  });

  it("sums a MultiEdit's edits", () => {
    const d = describeToolCall({
      toolName: "MultiEdit",
      input: { file_path: "a.ts", edits: [{ old_string: "x", new_string: "y\nz" }, { old_string: "p\nq", new_string: "" }] },
    });
    expect(d.verb).toBe("Edited");
    expect(d.metrics).toEqual([{ text: "+2 −3", tone: "neutral" }]);
  });

  it("reads a Write as Wrote with its line count", () => {
    expect(describeToolCall({ toolName: "Write", input: { file_path: "b.ts", content: "1\n2\n" } })).toMatchObject({
      kind: "write",
      verb: "Wrote",
      metrics: [{ text: "2 lines", tone: "neutral" }],
    });
  });

  it("reads a Bash call as Ran, its command, and its exit status", () => {
    expect(describeToolCall({ toolName: "Bash", input: { command: "npm test", description: "Run tests" }, output: "ok" })).toMatchObject({
      kind: "run",
      verb: "Ran",
      liveVerb: "Running",
      target: "npm test",
      targetIsCode: true,
      metrics: [{ text: "done", tone: "ok" }],
    });
    expect(describeToolCall({ toolName: "Bash", input: { command: "npm test" }, output: "Exit code 2\nFAIL", isError: true }).metrics).toEqual([
      { text: "exit 2", tone: "failed" },
    ]);
    expect(describeToolCall({ toolName: "Bash", input: { command: "npm test" }, output: "boom", isError: true }).metrics).toEqual([
      { text: "failed", tone: "failed" },
    ]);
  });

  it("says nothing about the exit of a call still running", () => {
    expect(describeToolCall({ toolName: "Bash", input: { command: "npm test" } }).metrics).toEqual([]);
  });

  it("reads Grep and Glob as Searched with their result counts", () => {
    expect(describeToolCall({ toolName: "Grep", input: { pattern: "foo", path: "src" }, output: "a.ts:1\nb.ts:2\n" })).toMatchObject({
      kind: "search",
      verb: "Searched",
      target: "“foo” in src",
      metrics: [{ text: "2 results", tone: "neutral" }],
    });
    expect(describeToolCall({ toolName: "Glob", input: { pattern: "*.ts" }, output: "No files found" }).metrics).toEqual([
      { text: "no results", tone: "neutral" },
    ]);
    expect(describeToolCall({ toolName: "Grep", input: { pattern: "x" }, output: "a.ts:1" }).metrics).toEqual([{ text: "1 result", tone: "neutral" }]);
  });

  it("reads web and agent tools by what they do", () => {
    expect(describeToolCall({ toolName: "WebFetch", input: { url: "https://x.dev" } })).toMatchObject({ kind: "web", verb: "Fetched", target: "https://x.dev" });
    expect(describeToolCall({ toolName: "WebSearch", input: { query: "tauri" } })).toMatchObject({ kind: "web", verb: "Searched the web", target: "tauri", targetIsCode: false });
    expect(describeToolCall({ toolName: "Task", input: { description: "Explore the board" } })).toMatchObject({ kind: "agent", verb: "Delegated", target: "Explore the board" });
  });

  it("names an unknown built-in tool by its own name", () => {
    expect(describeToolCall({ toolName: "FancyNewTool", input: {} })).toMatchObject({ kind: "other", verb: "Used", target: "fancy new tool" });
  });

  it("gives the other built-in tools a plain verb too", () => {
    expect(describeToolCall({ toolName: "ExitPlanMode", input: {} }).verb).toBe("Proposed plan");
    expect(describeToolCall({ toolName: "BashOutput", input: { bash_id: "b1" } }).verb).toBe("Read output");
    expect(describeToolCall({ toolName: "KillShell", input: { shell_id: "b1" } }).verb).toBe("Stopped command");
    expect(describeToolCall({ toolName: "LS", input: { path: "src" } })).toMatchObject({ verb: "Listed", target: "src" });
    expect(describeToolCall({ toolName: "Skill", input: { skill: "tdd" } })).toMatchObject({ verb: "Used", target: "tdd" });
  });

  it("quotes a search pattern, undoes its regex escapes, and names where it looked", () => {
    expect(describeToolCall({ toolName: "Grep", input: { pattern: "setActiveSessionId\\(", path: "packages/desktop/src" } }).target).toBe(
      "“setActiveSessionId(” in src",
    );
    expect(describeToolCall({ toolName: "Grep", input: { pattern: "Dropped", path: "GLOSSARY.md" } }).target).toBe("“Dropped” in GLOSSARY.md");
    expect(describeToolCall({ toolName: "Glob", input: { pattern: "*.ts" } }).target).toBe("“*.ts”");
  });
});

describe("describeToolCall: board tools by their meaning", () => {
  const checklist = JSON.stringify({
    tasks: [
      { task_id: "01J1", title: "Write the store test", state: "done" },
      { task_id: "01J2", title: "Clear the session on project switch", state: "doing" },
      { task_id: "01J3", title: "Add the menu item", state: "open" },
    ],
  });

  it("reads task_add as Added Task and its title", () => {
    expect(describeToolCall({ toolName: `${BOARD}task_add`, input: { titles: ["Add the menu item"] } })).toMatchObject({
      kind: "board",
      verb: "Added Task",
      liveVerb: "Adding Task",
      target: "Add the menu item",
      targetIsCode: false,
    });
    expect(describeToolCall({ toolName: `${BOARD}task_add`, input: { titles: ["One", "Two", "Three"] } })).toMatchObject({
      verb: "Added 3 Tasks",
      target: "One; Two; Three",
    });
  });

  it("reads task_update by the move it makes, naming the Task from the checklist it answers", () => {
    const update = (input: Record<string, unknown>) => describeToolCall({ toolName: `${BOARD}task_update`, input: { task_id: "01J2", ...input }, output: checklist });
    expect(update({ state: "doing" })).toMatchObject({ verb: "Started Task", target: "Clear the session on project switch" });
    expect(update({ state: "done" }).verb).toBe("Finished Task");
    expect(update({ state: "dropped", reason: "x" }).verb).toBe("Dropped Task");
    expect(update({ state: "open" }).verb).toBe("Reopened Task");
    expect(update({ note: "found it" }).verb).toBe("Updated Task");
  });

  it("falls back to no title when the checklist does not name the Task", () => {
    expect(describeToolCall({ toolName: `${BOARD}task_update`, input: { task_id: "01J9", state: "done" }, output: "Updated" }).target).toBe("");
  });

  it("reads task_list as Read Tasks with their count", () => {
    expect(describeToolCall({ toolName: `${BOARD}task_list`, input: {}, output: checklist })).toMatchObject({
      verb: "Read Tasks",
      metrics: [{ text: "3 Tasks", tone: "neutral" }],
    });
  });

  it("reads checks_run as Ran Checks, a failed Check in red", () => {
    const output = JSON.stringify({ commit: "abc", checks: [{ result: "passed" }, { result: "failed" }, { result: "passed" }] });
    expect(describeToolCall({ toolName: `${BOARD}checks_run`, input: {}, output })).toMatchObject({
      verb: "Ran Checks",
      liveVerb: "Running Checks",
      metrics: [
        { text: "2 passed", tone: "neutral" },
        { text: "1 failed", tone: "failed-check" },
      ],
    });
  });

  it("reads handoff as Handed off, with its Checks", () => {
    const output = JSON.stringify({ checks: [{ result: "passed" }], story_state: "in_review" });
    expect(describeToolCall({ toolName: `${BOARD}handoff`, input: { next_session_must_know: "x", decisions: "y" }, output })).toMatchObject({
      verb: "Handed off",
      target: "for review",
      metrics: [{ text: "1 passed", tone: "neutral" }],
    });
  });

  // Issue #123: a shaping session's Round reads by its meaning, its questions counted, and once answered
  // how many of them took the recommendation.
  it("reads round_post as Posted Round with its question count, then the answers it came back with", () => {
    const input = { note: "Settles the audience.", questions: [{ title: "Audience" }, { title: "Surface" }] };
    expect(describeToolCall({ toolName: `${BOARD}round_post`, input })).toMatchObject({
      kind: "question",
      verb: "Posted Round",
      liveVerb: "Waiting on your answers",
      target: "2 questions: Audience; Surface",
      metrics: [],
    });
    const output = JSON.stringify({
      round: 1,
      answers: [
        { number: 1, answer: "Yes", answered_with: "recommended" },
        { number: 2, answer: "Desktop and web", answered_with: "own" },
      ],
    });
    expect(describeToolCall({ toolName: `${BOARD}round_post`, input, output })).toMatchObject({
      verb: "Posted Round 1",
      metrics: [{ text: "2 answered · 1 recommended", tone: "neutral" }],
    });
  });

  // Issue #125: a spec change reads as the Proposal it files, named by the field it would rewrite.
  it("reads propose_spec_change as Proposed with the field and its new text", () => {
    const input = { field: "out_of_scope", text: "Milestone shaping.", why: "Round 1" };
    expect(describeToolCall({ toolName: `${BOARD}propose_spec_change`, input })).toMatchObject({
      kind: "board",
      verb: "Proposed",
      liveVerb: "Proposing",
      target: "Out of scope: Milestone shaping.",
    });
  });

  // Issue #127: slicing reads as the Story Proposals it files.
  it("reads propose_story as Proposed with the Story's title and what it runs after", () => {
    const input = { title: "Feed row", description: "Ships the row.", runs_after: "FLY-3", runs_after_reason: "shares FeedRow.tsx" };
    expect(describeToolCall({ toolName: `${BOARD}propose_story`, input })).toMatchObject({
      kind: "board",
      verb: "Proposed",
      liveVerb: "Proposing",
      target: "Story: Feed row · runs after FLY-3",
    });
    expect(describeToolCall({ toolName: `${BOARD}propose_story`, input: { title: "Schema" } }).target).toBe("Story: Schema");
  });

  it("reads propose_story_order as Proposed with the move or the retirement", () => {
    const move = { story: "FLY-3", action: "move", after: "FLY-5", why: "y" };
    expect(describeToolCall({ toolName: `${BOARD}propose_story_order`, input: move })).toMatchObject({
      verb: "Proposed",
      target: "Move FLY-3 after FLY-5",
    });
    const front = { story: "FLY-3", action: "move", before: "FLY-1", why: "y" };
    expect(describeToolCall({ toolName: `${BOARD}propose_story_order`, input: front }).target).toBe("Move FLY-3 before FLY-1");
    const end = { story: "FLY-3", action: "move", why: "y" };
    expect(describeToolCall({ toolName: `${BOARD}propose_story_order`, input: end }).target).toBe("Move FLY-3 to the end");
    const retire = { story: "FLY-3", action: "retire", why: "y" };
    expect(describeToolCall({ toolName: `${BOARD}propose_story_order`, input: retire }).target).toBe("Retire FLY-3");
  });

  // Issue #124: a later session picks the open Round up and waits on it like round_post did.
  it("reads round_wait as Resumed Round, waiting on your answers, then the Round it came back with", () => {
    expect(describeToolCall({ toolName: `${BOARD}round_wait`, input: {} })).toMatchObject({
      kind: "question",
      verb: "Resumed Round",
      liveVerb: "Waiting on your answers",
      target: "",
      metrics: [],
    });
    const output = JSON.stringify({
      round: 2,
      answers: [
        { number: 1, answer: "Yes", answered_with: "recommended" },
        { number: 2, answer: "Yes", answered_with: "recommended" },
      ],
    });
    expect(describeToolCall({ toolName: `${BOARD}round_wait`, input: {}, output })).toMatchObject({
      verb: "Resumed Round 2",
      metrics: [{ text: "2 answered · 2 recommended", tone: "neutral" }],
    });
  });

  // Issue #133: a roadmap Round's tools.
  it("reads propose_roadmap_change and roadmap_holds, and a roadmap round_wait's decisions", () => {
    expect(
      describeToolCall({ toolName: `${BOARD}propose_roadmap_change`, input: { change: "create_milestone", title: "Mobile", why: "x" } }),
    ).toMatchObject({ kind: "board", verb: "Proposed", liveVerb: "Proposing", target: "New Milestone: Mobile" });
    expect(describeToolCall({ toolName: `${BOARD}roadmap_holds`, input: { why: "The next Milestone is right" } })).toMatchObject({
      verb: "Said the Roadmap still holds",
      target: "The next Milestone is right",
    });
    const output = JSON.stringify({ round: 1, decisions: [{ state: "accepted" }, { state: "rejected" }] });
    expect(describeToolCall({ toolName: `${BOARD}round_wait`, input: {}, output })).toMatchObject({
      verb: "Roadmap Round 1 decided",
      metrics: [{ text: "1 accepted · 1 rejected", tone: "neutral" }],
    });
  });

  it("never prints a raw mcp__ name, for any server", () => {
    for (const toolName of [`${BOARD}story_get`, "mcp__github__create_issue", "mcp__x"]) {
      const d = describeToolCall({ toolName, input: {} });
      expect(`${d.verb} ${d.target}`).not.toMatch(/mcp__|__/);
    }
    expect(describeToolCall({ toolName: "mcp__github__create_issue", input: {} })).toMatchObject({ verb: "Called", target: "create issue · github" });
  });
});

describe("toolDisplayName", () => {
  it("keeps a built-in tool's name and humanises an MCP tool's", () => {
    expect(toolDisplayName("Bash")).toBe("Bash");
    expect(toolDisplayName(`${BOARD}task_add`)).toBe("Flywheel board · task add");
    expect(toolDisplayName("mcp__github__create_issue")).toBe("github · create issue");
  });
});

describe("durations", () => {
  it("measures a call from its start to its result", () => {
    expect(toolCallSeconds("2026-10-19T10:00:00.000Z", "2026-10-19T10:00:41.500Z")).toBe(41.5);
    expect(toolCallSeconds(undefined, "2026-10-19T10:00:41.500Z")).toBeUndefined();
    expect(toolCallSeconds("2026-10-19T10:00:41Z", "2026-10-19T10:00:00Z")).toBeUndefined();
  });

  it("formats a duration as a clock reading", () => {
    expect(formatDuration(0.4)).toBe("<1s");
    expect(formatDuration(9)).toBe("9s");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(formatDuration(3725)).toBe("1h 02m");
  });
});
