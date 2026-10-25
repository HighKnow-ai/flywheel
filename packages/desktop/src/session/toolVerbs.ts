/**
 * How a tool call reads (Story #118): a plain verb for what the agent did ("Read", "Edited", "Ran",
 * "Searched"), what it acted on, and the metrics a supervisor glances at (lines, exit status, Check
 * results). Board tools read by their meaning ("Added Task", "Ran Checks", "Handed off"), never by their
 * MCP name: no `mcp__…` name reaches the screen.
 *
 * Pure: a call in, its description out. The feed row, the Story's agent station, the fleet's activity
 * cell and the session's status line all word a call from here, so they never disagree.
 */

/** A tool's kind: which Lucide icon the row draws (direction.md § Icons: Read, Edit, Run, Search, board). */
export type ToolKind = "read" | "edit" | "write" | "run" | "search" | "web" | "board" | "agent" | "question" | "other";

/**
 * A metric's tone. `failed` is a call that reported failure: the feed draws it as the destructive StateBadge
 * (issue #205). `failed-check` is a failed Check, in red ink (direction.md § Colour). `ok` is a
 * command that finished cleanly, set in ink like the mockup's "passed" (never green: there is none).
 */
export type MetricTone = "neutral" | "ok" | "failed" | "failed-check";

export interface ToolMetric {
  text: string;
  tone: MetricTone;
}

export interface ToolCallDescription {
  kind: ToolKind;
  /** What the agent did, in the past tense: "Ran". */
  verb: string;
  /** The same while the call is still running: "Running". */
  liveVerb: string;
  /** What it acted on: a path, a command, a Task's title. Empty when there is nothing to name. A path or a
   * command inside the worktree reads relative to it (issue #205), so the file name is never cut off. */
  target: string;
  /** The target as the agent gave it, absolute paths and all: the Tooltip behind a shortened target. */
  fullTarget: string;
  /** Whether the target is code (a path, a command, a pattern) and sets in the code face. */
  targetIsCode: boolean;
  /** Whether the target is one file path, which truncates in the middle so its file name stays in view. */
  targetIsPath: boolean;
  /** Known only once the call answered; a call still running has none. */
  metrics: ToolMetric[];
}

export interface ToolCallInput {
  toolName: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

/** How to word a call: `root` is the session's worktree, against which paths and commands read relative. */
export interface DescribeOptions {
  root?: string | null;
}

function trimRoot(root: string | null | undefined): string | null {
  if (!root) return null;
  const trimmed = root.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/** A path relative to the worktree (`packages/export/src/zip.ts`); the root itself reads "."; a path outside
 * it, or with no root known, stays as it is. */
export function relativePath(path: string, root?: string | null): string {
  const base = trimRoot(root);
  if (!base || !path) return path;
  if (path === base) return ".";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** A command with every mention of the worktree made relative: `cd /…/wt && npm test` reads `cd . && npm test`. */
export function relativeCommand(command: string, root?: string | null): string {
  const base = trimRoot(root);
  if (!base || !command) return command;
  return command.split(`${base}/`).join("").split(base).join(".");
}

/** A path split for middle truncation: the folders, which give way first, and the file name, which never does. */
export function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf("/", path.length - 2);
  return slash < 0 ? { dir: "", base: path } : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

/** The MCP server that carries the board tools (`BOARD_SERVER` in `packages/core/src/domain/session_kind.rs`). */
const BOARD_SERVER = "flywheel-board";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A tool result's text: a string as itself, `{ text }` or an array of text blocks joined. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((part) => str(record(part).text)).join("\n");
  return str(record(output).text);
}

/** A tool result parsed as JSON when it is a JSON object (the board tools answer that way), else `{}`. */
function outputJson(output: unknown): Record<string, unknown> {
  if (output && typeof output === "object" && !Array.isArray(output)) return output as Record<string, unknown>;
  const text = outputText(output).trim();
  if (!text.startsWith("{")) return {};
  try {
    return record(JSON.parse(text));
  } catch {
    return {};
  }
}

/** Lines in a block of text, a trailing newline not counted as one more. */
function lineCount(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** An MCP tool name split into its server and its tool: `mcp__github__create_issue` → github, create_issue. */
function splitMcp(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const [server = "", ...rest] = toolName.slice("mcp__".length).split("__");
  return { server, tool: rest.join("__") };
}

const words = (name: string) => name.replace(/[_-]+/g, " ").trim();

/** A camel-case tool name in words: `ExitPlanMode` → "exit plan mode". */
const camelWords = (name: string) => words(name.replace(/([a-z])([A-Z])/g, "$1 $2")).toLowerCase();

/** A search pattern as a person reads it: quoted, the common regex escapes undone (`\(` → `(`), and the
 * place searched when one was given (`“Dropped” in GLOSSARY.md`). */
function searchTarget(input: Record<string, unknown>): string {
  const pattern = str(input.pattern).replace(/\\([()[\]{}.*+?^$|\\/])/g, "$1");
  const scope = str(input.path).split("/").filter(Boolean).pop() ?? str(input.glob);
  const where = scope || str(input.glob);
  return where ? `“${pattern}” in ${where}` : `“${pattern}”`;
}

/** A tool's name fit to print: a built-in tool as itself, an MCP tool as "server · tool" in words. */
export function toolDisplayName(toolName: string): string {
  const mcp = splitMcp(toolName);
  if (!mcp) return toolName;
  const server = mcp.server === BOARD_SERVER ? "Flywheel board" : words(mcp.server);
  return mcp.tool ? `${server} · ${words(mcp.tool)}` : server;
}

/** The Check results a `checks_run` or `handoff` answer carries, as "n passed" and "n failed". */
function checkMetrics(answer: Record<string, unknown>): ToolMetric[] {
  const checks = Array.isArray(answer.checks) ? answer.checks.map((c) => str(record(c).result)) : null;
  if (!checks) return [];
  if (checks.length === 0) return [{ text: "no Checks", tone: "neutral" }];
  const count = (result: string) => checks.filter((r) => r === result).length;
  const metrics: ToolMetric[] = [];
  if (count("passed") > 0) metrics.push({ text: `${count("passed")} passed`, tone: "neutral" });
  if (count("failed") > 0) metrics.push({ text: `${count("failed")} failed`, tone: "failed-check" });
  if (count("timed_out") > 0) metrics.push({ text: `${count("timed_out")} timed out`, tone: "failed-check" });
  return metrics;
}

/** What a failed call says, when it failed: Bash's "Exit code n", or plain "failed". */
function failureMetric(call: ToolCallInput): ToolMetric[] {
  if (!call.isError) return [];
  const code = /^Exit code (\d+)/m.exec(outputText(call.output));
  return [{ text: code ? `exit ${code[1]}` : "failed", tone: "failed" }];
}

const TASK_MOVES: Record<string, [string, string]> = {
  doing: ["Started Task", "Starting Task"],
  done: ["Finished Task", "Finishing Task"],
  dropped: ["Dropped Task", "Dropping Task"],
  open: ["Reopened Task", "Reopening Task"],
};

/** An Epic spec field as the Epic card names it, by the name `propose_spec_change` gives it. */
const SPEC_FIELD_LABELS: Record<string, string> = {
  problem: "Problem",
  scope: "Scope",
  out_of_scope: "Out of scope",
  exit_test: "Exit test",
};

/** A Roadmap change as the strip names it, by the `change` `propose_roadmap_change` gives it (issue #133). */
const ROADMAP_CHANGE_WORDS: Record<string, string> = {
  create_milestone: "New Milestone",
  amend_milestone: "Amend Milestone",
  reorder_milestone: "Move Milestone",
  retire_milestone: "Retire Milestone",
  add_epic: "New Epic",
  drop_epic: "Drop Epic",
};

/** A Story's Proposal kind as the triage card names it, by the `kind` `propose` gives it (issue #160). */
export const STORY_PROPOSAL_KIND_WORDS: Record<string, string> = {
  new_story: "New Story",
  amend_criterion: "Amend criterion",
  amend_epic_spec: "Amend Epic spec",
  reorder_story: "Reorder",
  retire_story: "Retire Story",
  new_epic: "New Epic",
};

function describeBoardTool(tool: string, call: ToolCallInput): Described {
  const input = record(call.input);
  const answer = outputJson(call.output);
  const base = { kind: "board" as const, targetIsCode: false, metrics: failureMetric(call) };
  switch (tool) {
    case "task_add": {
      const titles = Array.isArray(input.titles) ? input.titles.filter((t): t is string => typeof t === "string") : [];
      if (titles.length === 0 && str(input.title)) titles.push(str(input.title));
      const many = titles.length > 1;
      return {
        ...base,
        verb: many ? `Added ${titles.length} Tasks` : "Added Task",
        liveVerb: many ? `Adding ${titles.length} Tasks` : "Adding Task",
        target: titles.join("; "),
      };
    }
    case "task_update": {
      const [verb, liveVerb] = TASK_MOVES[str(input.state)] ?? ["Updated Task", "Updating Task"];
      const tasks = Array.isArray(answer.tasks) ? answer.tasks.map(record) : [];
      const title = str(tasks.find((t) => t.task_id === input.task_id)?.title);
      return { ...base, verb, liveVerb, target: title };
    }
    case "task_list": {
      const tasks = Array.isArray(answer.tasks) ? answer.tasks : null;
      const metrics = base.metrics.length > 0 || !tasks ? base.metrics : [{ text: plural(tasks.length, "Task"), tone: "neutral" as const }];
      return { ...base, verb: "Read Tasks", liveVerb: "Reading Tasks", target: "", metrics };
    }
    case "checks_run":
      return {
        ...base,
        verb: "Ran Checks",
        liveVerb: "Running Checks",
        target: "",
        metrics: base.metrics.length > 0 ? base.metrics : checkMetrics(answer),
      };
    case "handoff":
      return {
        ...base,
        verb: "Handed off",
        liveVerb: "Handing off",
        target: "for review",
        metrics: base.metrics.length > 0 ? base.metrics : checkMetrics(answer),
      };
    case "round_post":
    case "round_wait": {
      // Issue #123: the call is held until every question is answered, so while it runs the agent is
      // waiting on the developer, and once it answers it carries every answer. Issue #124: round_wait is a
      // later session picking up the Round its predecessor left open, held the same way.
      const titles = (Array.isArray(input.questions) ? input.questions : []).map((q) => str(record(q).title)).filter(Boolean);
      const count = Array.isArray(input.questions) ? input.questions.length : 0;
      const answers = Array.isArray(answer.answers) ? answer.answers.map(record) : null;
      const recommended = answers ? answers.filter((a) => a.answered_with === "recommended").length : 0;
      const number = typeof answer.round === "number" ? ` ${answer.round}` : "";
      const posted = tool === "round_post";
      // Issue #133: in a roadmap Round, round_wait comes back with the developer's decisions.
      const decisions = Array.isArray(answer.decisions) ? answer.decisions.map(record) : null;
      if (decisions) {
        const accepted = decisions.filter((d) => d.state === "accepted").length;
        return {
          ...base,
          kind: "question",
          verb: `Roadmap Round${number} decided`,
          liveVerb: "Waiting on your decisions",
          target: "",
          metrics:
            base.metrics.length > 0
              ? base.metrics
              : [{ text: `${accepted} accepted · ${decisions.length - accepted} rejected`, tone: "neutral" as const }],
        };
      }
      return {
        ...base,
        kind: "question",
        verb: posted ? `Posted Round${number}` : `Resumed Round${number}`,
        liveVerb: "Waiting on your answers",
        target: !posted
          ? ""
          : titles.length > 0
            ? `${plural(count, "question")}: ${titles.join("; ")}`
            : plural(count, "question"),
        metrics:
          base.metrics.length > 0 || !answers
            ? base.metrics
            : [{ text: `${answers.length} answered · ${recommended} recommended`, tone: "neutral" as const }],
      };
    }
    case "propose_spec_change": {
      // Issue #125: answered at once; the Proposal waits on the Epic card, never the agent.
      const field = SPEC_FIELD_LABELS[str(input.field)] ?? words(str(input.field));
      const text = str(input.text);
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target: [field, text].filter(Boolean).join(": ") };
    }
    case "propose_roadmap_change": {
      // Issue #133: answered at once; the change waits on the Roadmap strip as a ghost row.
      const what = ROADMAP_CHANGE_WORDS[str(input.change)] ?? words(str(input.change));
      const title = str(input.title);
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target: [what, title].filter(Boolean).join(": ") };
    }
    case "roadmap_holds":
      return { ...base, verb: "Said the Roadmap still holds", liveVerb: "Closing the roadmap Round", target: str(input.why) };
    case "propose_story": {
      // Issue #127: a New Story, waiting as a ghost column; the agent keeps slicing.
      const after = str(input.runs_after);
      const target = `Story: ${str(input.title)}${after ? ` · runs after ${after}` : ""}`;
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target };
    }
    case "propose_story_order": {
      const story = str(input.story);
      const place = str(input.after) ? `after ${str(input.after)}` : str(input.before) ? `before ${str(input.before)}` : "to the end";
      const target = input.action === "retire" ? `Retire ${story}` : `Move ${story} ${place}`;
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target };
    }
    case "propose_criterion": {
      // Issue #128: a criterion for a Story, waiting as a ghost card under it; the agent keeps writing.
      const check = str(input.check) ? " · with a Check" : " · judged at review";
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target: `Criterion on ${str(input.story)}: ${str(input.statement)}${check}` };
    }
    case "propose": {
      // Issue #160: a running Story's Proposal, answered at once; the agent keeps working.
      const kind = str(input.kind);
      const place = str(input.after) ? ` after ${str(input.after)}` : str(input.before) ? ` before ${str(input.before)}` : "";
      const named: Record<string, string> = {
        new_story: str(input.title),
        amend_criterion: str(input.statement),
        amend_epic_spec: SPEC_FIELD_LABELS[str(input.field)] ?? words(str(input.field)),
        reorder_story: `${str(input.story)}${place}`,
        retire_story: str(input.story),
        new_epic: str(input.title),
      };
      const what = STORY_PROPOSAL_KIND_WORDS[kind] ?? words(kind);
      const open = typeof answer.open === "number" && typeof answer.cap === "number" ? answer.open : null;
      const metrics =
        base.metrics.length > 0 || open === null ? base.metrics : [{ text: `${open} of ${String(answer.cap)} open`, tone: "neutral" as const }];
      return { ...base, verb: "Proposed", liveVerb: "Proposing", target: [what, named[kind] ?? ""].filter(Boolean).join(": "), metrics };
    }
    case "proposal_withdraw":
      return { ...base, verb: "Withdrew Proposal", liveVerb: "Withdrawing Proposal", target: "" };
    default:
      return {
        ...base,
        verb: "Called",
        liveVerb: "Calling",
        target: tool ? `${words(tool)} · Flywheel board` : "Flywheel board",
      };
  }
}

type Described = Omit<ToolCallDescription, "fullTarget" | "targetIsPath"> & { targetIsPath?: boolean };

/** Describe one tool call: its verb, its target, and (once it answered) its metrics. With the worktree as
 * `root`, a path or a command reads relative to it; `fullTarget` keeps what the agent gave. */
export function describeToolCall(call: ToolCallInput, options: DescribeOptions = {}): ToolCallDescription {
  const described = describeCall(call);
  const fullTarget = described.target;
  const targetIsPath = described.targetIsPath ?? false;
  const target = targetIsPath
    ? relativePath(fullTarget, options.root)
    : described.targetIsCode
      ? relativeCommand(fullTarget, options.root)
      : fullTarget;
  return { ...described, target, fullTarget, targetIsPath };
}

function describeCall(call: ToolCallInput): Described {
  const input = record(call.input);
  const answered = call.output !== undefined;
  const text = outputText(call.output);
  const failed = failureMetric(call);
  const mcp = splitMcp(call.toolName);

  if (mcp) {
    if (mcp.server === BOARD_SERVER) return describeBoardTool(mcp.tool, call);
    const target = [words(mcp.tool), words(mcp.server)].filter(Boolean).join(" · ");
    return { kind: "other", verb: "Called", liveVerb: "Calling", target, targetIsCode: false, metrics: failed };
  }

  const code = (verb: string, liveVerb: string, kind: ToolKind, target: string, metrics: ToolMetric[]): Described => ({
    kind,
    verb,
    liveVerb,
    target,
    targetIsCode: true,
    metrics: failed.length > 0 ? failed : answered ? metrics : [],
  });

  switch (call.toolName) {
    case "Read":
      return {
        ...code("Read", "Reading", "read", str(input.file_path) || str(input.path), [{ text: plural(lineCount(text), "line"), tone: "neutral" }]),
        targetIsPath: true,
      };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const edits = Array.isArray(input.edits) ? input.edits.map(record) : [input];
      const added = edits.reduce((n, e) => n + lineCount(str(e.new_string) || str(e.new_source)), 0);
      const removed = edits.reduce((n, e) => n + lineCount(str(e.old_string)), 0);
      const target = str(input.file_path) || str(input.notebook_path);
      // The lines an edit adds and removes are known from its input, before it answers.
      return {
        ...code("Edited", "Editing", "edit", target, []),
        targetIsPath: true,
        metrics: failed.length > 0 ? failed : [{ text: `+${added} −${removed}`, tone: "neutral" }],
      };
    }
    case "Write":
      return {
        ...code("Wrote", "Writing", "write", str(input.file_path), []),
        targetIsPath: true,
        metrics: failed.length > 0 ? failed : [{ text: plural(lineCount(str(input.content)), "line"), tone: "neutral" }],
      };
    case "Bash":
      // Claude Code marks a non-zero exit as an error, so a clean answer is a clean exit.
      return code("Ran", "Running", "run", str(input.command), [{ text: "done", tone: "ok" }]);
    case "BashOutput":
      return code("Read output", "Reading output", "run", str(input.bash_id) || str(input.shell_id), []);
    case "KillShell":
    case "KillBash":
      return code("Stopped command", "Stopping command", "run", str(input.shell_id) || str(input.bash_id), []);
    case "LS":
      return { ...code("Listed", "Listing", "read", str(input.path), []), targetIsPath: true };
    case "Grep":
    case "Glob": {
      const lines = text.split("\n").filter((line) => line.trim() !== "");
      const none = lines.length === 0 || /^No (files|matches) found/i.test(lines[0]);
      return code("Searched", "Searching", "search", searchTarget(input), [
        { text: none ? "no results" : plural(lines.length, "result"), tone: "neutral" },
      ]);
    }
    case "ExitPlanMode":
      return { ...code("Proposed plan", "Proposing plan", "other", "", []), targetIsCode: false };
    case "Skill":
    case "SlashCommand":
      return { ...code("Used", "Using", "other", str(input.skill) || str(input.command) || words(camelWords(call.toolName)), []), targetIsCode: false };
    case "WebFetch":
      return code("Fetched", "Fetching", "web", str(input.url), []);
    case "WebSearch":
      return { ...code("Searched the web", "Searching the web", "web", str(input.query), []), targetIsCode: false };
    case "Task":
    case "Agent":
      return { ...code("Delegated", "Delegating", "agent", str(input.description), []), targetIsCode: false };
    case "TodoWrite":
      return { ...code("Planned", "Planning", "other", "", []), targetIsCode: false };
    case "AskUserQuestion":
      return { ...code("Asked", "Asking", "question", "a question", []), targetIsCode: false };
    default: {
      // A tool this module does not know: "Used", and the tool's name in words as what it used, so no
      // camel-case tool name ever sits in the verb column.
      const subject = str(input.file_path) || str(input.path) || str(input.description);
      const name = camelWords(call.toolName);
      return { ...code("Used", "Using", "other", subject ? `${name} · ${subject}` : name, []), targetIsCode: false };
    }
  }
}

/** How long a call took, from its start to its result, in seconds; unknown or negative is `undefined`. */
export function toolCallSeconds(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const seconds = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** A duration as a clock reading, from the one vocabulary (`lib/format.ts`): "<1s", "9s", "1m 05s", "1h 02m". */
export { formatDuration } from "@/lib/format";
