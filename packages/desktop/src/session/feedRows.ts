/**
 * Which session-log entries become feed rows, and what each row carries (D-32, reshaped by Story
 * #56). Pure: entries in, rows out. `SessionSurface.tsx` renders the rows through `FeedRow.tsx`;
 * the fleet's activity cell (`fleet/FleetSurface.tsx`) reads the newest one, so both say the same
 * thing about the same line.
 *
 * What the v0.1 walk (2026-10-16) found unreadable, and what this module does about it:
 * - noise: hook lifecycle and thinking-token notices, reasoning blocks, rate-limit events,
 *   heartbeats and Claude Code's own read-only git calls are not rows. They stay in the log and in
 *   "View raw";
 * - raw JSON for tool results: a result pairs with its call by the backend's call id (`toolUseId`),
 *   and the tool-name FIFO is only the fallback for an entry without one. An unpaired result is a
 *   result row with its text, never the raw line;
 * - a healthy run that looked stalled: a `tool_progress` heartbeat folds its elapsed time into the
 *   call it names;
 * - Proposals and AskUserQuestion requests are their own row kinds, which render as cards.
 */
import { describeToolCall } from "./toolVerbs";

/** One AskUserQuestion option, as the sidecar's `parseAskUserQuestionInput` carries it. */
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionPrompt {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

/** One feed row. `key` is a stable React key, independent of whichever fields a kind carries. */
export type FeedRowData =
  | { kind: "assistant_text"; key: string; text: string }
  // Plan 05-12: a turn the application sent into the session — the developer's words, never merged
  // into `assistant_text` (that would attribute them to the agent).
  | { kind: "developer_turn"; key: string; text: string }
  | {
      kind: "tool_call";
      key: string;
      toolName: string;
      input: unknown;
      output?: unknown;
      /** The tool reported a failure on its result. */
      isError?: boolean;
      /** When the call was made (the entry's `at`), for the running clock. */
      startedAt?: string;
      /** When its result came (the result entry's `at`), for the call's duration. */
      endedAt?: string;
      /** The newest `tool_progress` heartbeat's elapsed seconds for this call. */
      elapsedSeconds?: number;
    }
  /** A result whose call is not in the loaded window. */
  | { kind: "tool_result"; key: string; output: unknown; isError?: boolean }
  /** A board tool call that files a Proposal (`propose_*`). */
  | { kind: "proposal"; key: string; toolName: string; input: unknown; output?: unknown; isError?: boolean }
  /** An AskUserQuestion request and, once it came, its answer. */
  | { kind: "question"; key: string; questions: QuestionPrompt[]; answer?: unknown }
  | { kind: "system_notice"; key: string; text: string }
  // D-53: the shim's retry notice, in the system/transient treatment.
  | { kind: "git_retry"; key: string; attempt: number; max: number }
  // D-53: exhaustion is trail-only; the feed renders nothing for it.
  | { kind: "git_lock_exhausted"; key: string }
  | { kind: "raw"; key: string; raw: string };

/** Fields a tool's `input` uses for its human-readable target, first string match wins
 * (02-UI-SPEC.md: `Bash · npm test`, `Edit · src/board/BoardRow.tsx`). */
const TARGET_FIELD_CANDIDATES = ["command", "file_path", "path", "pattern", "url", "description"];

export function toolCallTarget(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    for (const field of TARGET_FIELD_CANDIDATES) {
      if (typeof obj[field] === "string") return obj[field] as string;
    }
  }
  if (typeof input === "string") return input;
  return "";
}

/** The collapsed tool-call label: what the agent did and what it acted on ("Ran · npm test", "Added
 * Task · Write the store test"), worded by `toolVerbs.ts`. Built in one place so the fleet's activity
 * cell, the status line and the feed row never word the same call differently. `live` words a call
 * still running ("Running · npm test"). */
export function toolCallLabel(toolName: string, input: unknown, options: { live?: boolean; output?: unknown } = {}): string {
  const described = describeToolCall({ toolName, input, output: options.output });
  const verb = options.live ? described.liveVerb : described.verb;
  return described.target ? `${verb} · ${described.target}` : verb;
}

/** A payload as one line of plain text: a string as itself, anything else as its field values. */
export function payloadText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(payloadText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${payloadText(v)}`)
      .join(", ");
  }
  return "";
}

/** The kind word a Proposal tool's name carries: `mcp__flywheel__propose_story` reads "story". */
export function proposalKind(toolName: string): string {
  const bare = toolName.split("__").pop() ?? toolName;
  return bare.replace(/^propose_?/i, "").replace(/_/g, " ").trim();
}

/** Whether a tool call files a Proposal on the board: a tool named `propose_*`, on any MCP server. */
export function isProposalTool(toolName: string): boolean {
  const bare = toolName.split("__").pop() ?? toolName;
  return /^propose(_|$)/i.test(bare);
}

/** The one line a row reads as — what the fleet's activity cell shows (D-167: the fleet has no
 * vocabulary of its own for agent activity). */
export function feedRowText(row: FeedRowData): string {
  switch (row.kind) {
    case "assistant_text":
    case "developer_turn":
    case "system_notice":
      return row.text;
    case "tool_call":
      // A call with no result yet is the one in flight: it reads "Running · npm test".
      return toolCallLabel(row.toolName, row.input, { output: row.output, live: row.output === undefined });
    case "tool_result":
      return payloadText(row.output);
    case "proposal": {
      const title = row.input && typeof row.input === "object" ? (row.input as Record<string, unknown>).title : undefined;
      const kind = proposalKind(row.toolName);
      const head = kind ? `Proposal · ${kind}` : "Proposal";
      return typeof title === "string" && title ? `${head} · ${title}` : head;
    }
    case "question":
      return row.questions[0]?.question ?? "Question";
    case "git_retry":
      return gitRetryText(row.attempt, row.max);
    case "git_lock_exhausted":
      return "";
    case "raw":
      return row.raw;
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

/** The Copywriting Contract's fixed retry line (03-UI-SPEC.md), the two integers interpolated. */
export function gitRetryText(attempt: number, max: number): string {
  return `git: retrying after index lock (attempt ${attempt}/${max})…`;
}

/** Entry types that are never rows: consumed elsewhere (`init`/`cost_update`/`result` feed the
 * status strip, `permission_request` is the card mount, `session_closed` the terminal row,
 * `git_lock_exhausted` the Activity Trail, `backend_echo` the developer_turn row), or noise the walk
 * logged (`thinking`, `rate_limit`). `tool_progress` folds into its call instead. */
const SUPPRESSED_EVENT_TYPES = new Set([
  "init",
  "cost_update",
  "result",
  "permission_request",
  "session_closed",
  "git_lock_exhausted",
  "backend_echo",
  "thinking",
  "rate_limit",
  "tool_progress",
]);

/** A backend lifecycle notice that is noise: the sidecar words a `system` line as `system: <subtype>`,
 * and the hook subtypes (`hook_started`, `hook_response`, ...) and thinking-token counts say nothing
 * a supervisor acts on. Other subtypes stay: a future one may matter, and it is one short line. */
function isNoiseNotice(text: string): boolean {
  return /^system: (hook_|thinking)/.test(text);
}

/** Git subcommands that only read. `branch`, `stash`, `worktree`, `remote` and `config` are listed
 * separately because they read only in some forms. */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "blame",
  "describe",
  "shortlog",
  "cat-file",
  "merge-base",
  "grep",
  "reflog",
  "for-each-ref",
  "symbolic-ref",
  "check-ignore",
  "name-rev",
  "whatchanged",
  "count-objects",
  "var",
  "version",
  "help",
]);

/** Commands a read-only git call may pipe into without changing anything. */
const PIPE_FILTERS = new Set(["head", "tail", "grep", "wc", "sort", "uniq", "cat", "cut", "awk", "sed", "tr", "less", "more"]);

/** Git's global options that take a separate value (`-C <path>`, `-c <name>=<value>`). */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function isReadOnlyGitInvocation(words: string[]): boolean {
  if (words[0] !== "git") return false;
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) {
    i += GIT_OPTIONS_WITH_VALUE.has(words[i]) ? 2 : 1;
  }
  const sub = words[i];
  const args = words.slice(i + 1);
  if (!sub) return false;
  if (READ_ONLY_GIT_SUBCOMMANDS.has(sub)) return true;
  const positional = args.filter((a) => !a.startsWith("-"));
  switch (sub) {
    // `git branch` lists unless it is given a name, or a delete/move/copy/upstream flag.
    case "branch":
      return positional.length === 0 && !args.some((a) => /^-(d|D|m|M|c|C|f|u)$|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description)/.test(a));
    case "stash":
    case "worktree":
      return positional[0] === "list" || (sub === "stash" && positional[0] === "show");
    case "remote":
      return positional.length === 0 || positional[0] === "show" || positional[0] === "get-url";
    case "config":
      return args.some((a) => /^--(get|get-all|get-regexp|list)$|^-l$/.test(a));
    default:
      return false;
  }
}

/**
 * Whether a shell command only reads git state: one or more read-only `git` invocations joined by
 * `&&`/`;`, optionally after a `cd` and optionally piped into a text filter. Anything that could
 * write — a redirection, a substitution, another program in the chain — is not read-only. The walk
 * (entry 28) logged Claude Code's own startup checks (`git -c core.hooksPath=/dev/null ls-files
 * --error-unmatch ...`) as the most frequent rows in the feed.
 */
export function isReadOnlyGitCommand(command: string): boolean {
  if (!command.trim()) return false;
  if (/[`$<>(){}]|\|\||&(?!&)/.test(command.replace(/&&/g, ""))) return false;
  const segments = command.split(/&&|;/).map((s) => s.trim());
  let sawGit = false;
  for (const segment of segments) {
    if (!segment) return false;
    const [head, ...pipes] = segment.split("|").map((s) => s.trim());
    const words = head.split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
    if (words[0] === "cd" && words.length <= 2 && pipes.length === 0) continue;
    if (!isReadOnlyGitInvocation(words)) return false;
    if (pipes.some((p) => !PIPE_FILTERS.has(p.split(/\s+/)[0]))) return false;
    sawGit = true;
  }
  return sawGit;
}

function isReadOnlyGitCall(toolName: string, input: unknown): boolean {
  if (toolName !== "Bash" || !input || typeof input !== "object") return false;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" && isReadOnlyGitCommand(command);
}

/** A stable key: `seq` (never shifts as pages load), then a developer turn's `turnId`, then a
 * malformed line's `line` number, and the array position only as a last resort. */
function keyForEvent(event: Record<string, unknown>, index: number): string {
  if (typeof event.seq === "number") return `seq-${event.seq}`;
  if (typeof event.turnId === "string") return `turn-${event.turnId}`;
  if (typeof event.line === "number") return `line-${event.line}`;
  return `idx-${index}`;
}

function rawTextFor(event: Record<string, unknown>): string {
  if (typeof event.raw === "string") return event.raw;
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

/** Issue #100: the tool name of an agent's question, held as a question rather than a permission request. */
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion";

/** The questions of an `AskUserQuestion` call's raw input payload (a JSON string), or `[]`. */
export function questionsFromPayload(inputPayload: string | null): QuestionPrompt[] {
  if (!inputPayload) return [];
  try {
    return questionsFrom({ input: JSON.parse(inputPayload) as unknown });
  } catch {
    return [];
  }
}

/** Whether two question lists ask the same questions, in the same order: how the feed's question
 * card finds the pending request it answers. */
export function sameQuestions(a: QuestionPrompt[], b: QuestionPrompt[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((q, i) => q.question === b[i].question);
}

function questionsFrom(event: Record<string, unknown>): QuestionPrompt[] {
  const parsed = Array.isArray(event.questions) ? event.questions : undefined;
  const fromInput =
    event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>).questions : undefined;
  const list = parsed ?? (Array.isArray(fromInput) ? fromInput : []);
  return list
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object" && typeof (q as Record<string, unknown>).question === "string")
    .map((q) => ({
      question: q.question as string,
      ...(typeof q.header === "string" ? { header: q.header } : {}),
      ...(typeof q.multiSelect === "boolean" ? { multiSelect: q.multiSelect } : {}),
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof (o as Record<string, unknown>).label === "string")
        .map((o) => ({ label: o.label as string, ...(typeof o.description === "string" ? { description: o.description } : {}) })),
    }));
}

/** Where a pending call sits: its row index, or `null` when the call is filtered out (so its
 * result is dropped with it rather than turning into an orphan row). */
type PendingSlot = number | null;

/**
 * Turn the flattened, ascending entries into the feed's rows. Every entry either becomes a row,
 * folds into one (a result, a heartbeat), or is deliberately left out (see the module comment) —
 * an entry of an unknown type still renders as a raw row (T-02-33).
 */
export function buildFeedRows(entries: Record<string, unknown>[]): FeedRowData[] {
  const rows: FeedRowData[] = [];
  const pendingById = new Map<string, PendingSlot>();
  const pendingByTool = new Map<string, PendingSlot[]>();

  function takePending(event: Record<string, unknown>): PendingSlot | undefined {
    const id = typeof event.toolUseId === "string" ? event.toolUseId : undefined;
    if (id && pendingById.has(id)) {
      const slot = pendingById.get(id) as PendingSlot;
      pendingById.delete(id);
      return slot;
    }
    // Fallback for entries without a call id: the next pending call of the same tool name. A call
    // with an id is never in this queue, so the two pairings cannot take the same call.
    const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
    const queue = toolName ? pendingByTool.get(toolName) : undefined;
    return queue && queue.length > 0 ? queue.shift() : undefined;
  }

  function addPending(event: Record<string, unknown>, toolName: string, slot: PendingSlot) {
    if (typeof event.toolUseId === "string") pendingById.set(event.toolUseId, slot);
    else {
      const queue = pendingByTool.get(toolName) ?? [];
      queue.push(slot);
      pendingByTool.set(toolName, queue);
    }
  }

  entries.forEach((event, index) => {
    const type = typeof event.type === "string" ? event.type : "unknown";
    const key = keyForEvent(event, index);

    if (type === "tool_progress") {
      const id = typeof event.toolUseId === "string" ? event.toolUseId : undefined;
      const slot = id ? pendingById.get(id) : undefined;
      const target = typeof slot === "number" ? rows[slot] : undefined;
      if (target && target.kind === "tool_call" && typeof event.elapsedSeconds === "number") {
        rows[slot as number] = { ...target, elapsedSeconds: event.elapsedSeconds };
      }
      return;
    }

    if (type === "tool_result") {
      const isError = event.isError === true ? { isError: true } : {};
      const slot = takePending(event);
      if (slot === null) return; // the call was filtered out; so is its result
      if (typeof slot === "number") {
        const target = rows[slot];
        if (target.kind === "tool_call" || target.kind === "proposal") {
          const endedAt = target.kind === "tool_call" && typeof event.at === "string" ? { endedAt: event.at } : {};
          rows[slot] = { ...target, output: event.output, ...isError, ...endedAt };
        } else if (target.kind === "question") {
          rows[slot] = { ...target, answer: event.output };
        }
        return;
      }
      rows.push({ kind: "tool_result", key, output: event.output, ...isError });
      return;
    }

    if (SUPPRESSED_EVENT_TYPES.has(type)) return;

    if (type === "assistant_text" || type === "developer_turn") {
      rows.push({ kind: type, key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    if (type === "tool_call") {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      if (isReadOnlyGitCall(toolName, event.input)) {
        addPending(event, toolName, null);
        return;
      }
      if (toolName === "AskUserQuestion" && questionsFrom(event).length > 0) {
        rows.push({ kind: "question", key, questions: questionsFrom(event) });
      } else if (isProposalTool(toolName)) {
        rows.push({ kind: "proposal", key, toolName, input: event.input });
      } else {
        rows.push({
          kind: "tool_call",
          key,
          toolName,
          input: event.input,
          ...(typeof event.at === "string" ? { startedAt: event.at } : {}),
        });
      }
      addPending(event, toolName, rows.length - 1);
      return;
    }

    if (type === "system_notice") {
      const text = typeof event.text === "string" ? event.text : "";
      if (isNoiseNotice(text)) return;
      rows.push({ kind: "system_notice", key, text });
      return;
    }

    if (type === "git_retry") {
      rows.push({
        kind: "git_retry",
        key,
        attempt: typeof event.attempt === "number" ? event.attempt : 0,
        max: typeof event.max === "number" ? event.max : 0,
      });
      return;
    }

    // Anything else, including session_log.rs's `unknown` entry for a malformed line, never
    // disappears (T-02-33).
    rows.push({ kind: "raw", key, raw: rawTextFor(event) });
  });

  return rows;
}

/** The newest call still waiting on its result: the one a running session is executing now. */
export function findLiveCallKey(rows: FeedRowData[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === "tool_call" && row.output === undefined) return row.key;
  }
  return null;
}
