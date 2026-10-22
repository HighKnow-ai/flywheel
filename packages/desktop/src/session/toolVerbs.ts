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
 * A metric's tone. `failed` is a call that reported failure: it stays neutral ink, told apart by its icon
 * and word. `failed-check` is a failed Check, the one failure that is red (direction.md § Colour). `ok` is a
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
  /** What it acted on: a path, a command, a Task's title. Empty when there is nothing to name. */
  target: string;
  /** Whether the target is code (a path, a command, a pattern) and sets in the code face. */
  targetIsCode: boolean;
  /** Known only once the call answered; a call still running has none. */
  metrics: ToolMetric[];
}

export interface ToolCallInput {
  toolName: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
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

function describeBoardTool(tool: string, call: ToolCallInput): ToolCallDescription {
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
      return {
        ...base,
        kind: "question",
        verb: posted ? `Posted Round${number}` : number ? `Picked up Round${number}` : "Picked up the open Round",
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
    default:
      return {
        ...base,
        verb: "Called",
        liveVerb: "Calling",
        target: tool ? `${words(tool)} · Flywheel board` : "Flywheel board",
      };
  }
}

/** Describe one tool call: its verb, its target, and (once it answered) its metrics. */
export function describeToolCall(call: ToolCallInput): ToolCallDescription {
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

  const code = (verb: string, liveVerb: string, kind: ToolKind, target: string, metrics: ToolMetric[]): ToolCallDescription => ({
    kind,
    verb,
    liveVerb,
    target,
    targetIsCode: true,
    metrics: failed.length > 0 ? failed : answered ? metrics : [],
  });

  switch (call.toolName) {
    case "Read":
      return code("Read", "Reading", "read", str(input.file_path) || str(input.path), [{ text: plural(lineCount(text), "line"), tone: "neutral" }]);
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const edits = Array.isArray(input.edits) ? input.edits.map(record) : [input];
      const added = edits.reduce((n, e) => n + lineCount(str(e.new_string) || str(e.new_source)), 0);
      const removed = edits.reduce((n, e) => n + lineCount(str(e.old_string)), 0);
      const target = str(input.file_path) || str(input.notebook_path);
      // The lines an edit adds and removes are known from its input, before it answers.
      return { ...code("Edited", "Editing", "edit", target, []), metrics: failed.length > 0 ? failed : [{ text: `+${added} −${removed}`, tone: "neutral" }] };
    }
    case "Write":
      return {
        ...code("Wrote", "Writing", "write", str(input.file_path), []),
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
      return code("Listed", "Listing", "read", str(input.path), []);
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

/** A duration as a clock reading: "<1s", "9s", "1m 05s", "1h 02m". */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return "<1s";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
