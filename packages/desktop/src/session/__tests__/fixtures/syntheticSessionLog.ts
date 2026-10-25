/**
 * A synthetic session log of the same shape as a real handed-off Story session (issue #190): 168
 * lines that open with Claude CLI's stdin warning and its SessionStart hook lines, then interleave
 * thinking-token notices, reasoning blocks, Bash calls and their results, a rate-limit event, board
 * tool calls with the board server's own `board_tool_request` echo, background-task notices and
 * agent turns, and close with the `result` totals and `session_closed`.
 *
 * Every value is invented. The shape (event types, field names, ordering, the line count that is
 * more than three 50-line pages and not a multiple of 50) is what matters: it is what paged the
 * feed into overlapping windows on the installed build.
 */

export const SYNTHETIC_RUN_ID = "run-synthetic";
export const SYNTHETIC_STARTED_AT = "2026-10-19T09:40:35.000Z";
export const SYNTHETIC_ENDED_AT = "2026-10-19T09:43:36.000Z";
export const SYNTHETIC_LINE_COUNT = 168;
export const STDIN_WARNING =
  "Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.";

type Entry = Record<string, unknown>;

const START_MS = Date.parse(SYNTHETIC_STARTED_AT);

function at(seq: number): string {
  return new Date(START_MS + seq * 1070).toISOString();
}

/** Builds the log. Pure and deterministic: the same 168 entries on every call. */
export function syntheticSessionLog(): Entry[] {
  const entries: Entry[] = [];
  const push = (entry: Entry) => {
    const seq = entries.length;
    entries.push({ runId: SYNTHETIC_RUN_ID, seq, at: at(seq), raw: JSON.stringify(entry), ...entry });
  };
  const notice = (text: string) => push({ type: "system_notice", text });

  // A CLI stderr line, carried verbatim.
  push({ type: "system_notice", text: STDIN_WARNING });
  for (let i = 0; i < 6; i += 1) notice("system: hook_started");
  for (let i = 0; i < 6; i += 1) notice("system: hook_response");
  push({ type: "init", sessionId: "ext-synthetic", model: "claude-synthetic" });

  let call = 0;
  let turn = 0;
  // Leave room for the closing pair.
  while (entries.length < SYNTHETIC_LINE_COUNT - 2) {
    const remaining = SYNTHETIC_LINE_COUNT - 2 - entries.length;
    const id = `toolu_synthetic_${call}`;
    if (call % 9 === 4 && remaining >= 4) {
      // A board tool call: the agent's call, the board server's echo of it, and the result.
      push({ type: "tool_call", toolName: "mcp__flywheel-board__task_update", toolUseId: id, input: { task_id: `task-${call}`, state: "done" } });
      push({ type: "board_tool_request", requestId: `req-${call}`, tool: "task_update", args: { task_id: `task-${call}`, state: "done" } });
      push({ type: "tool_result", toolUseId: id, isError: false, output: "ok" });
      call += 1;
      continue;
    }
    if (call % 11 === 7 && remaining >= 2) {
      notice("system: task_started");
      notice("system: task_notification");
    }
    if (entries.length + 2 > SYNTHETIC_LINE_COUNT - 2) break;
    if (remaining >= 5) {
      notice("system: thinking_tokens");
      push({ type: "thinking", text: "", hasSignature: true });
    }
    if (entries.length + 2 > SYNTHETIC_LINE_COUNT - 2) {
      push({ type: "assistant_text", text: `Synthetic turn ${turn}.` });
      turn += 1;
      continue;
    }
    push({
      type: "tool_call",
      toolName: "Bash",
      toolUseId: id,
      input: { command: `cat docs/synthetic-${call}.md && wc -l docs/synthetic-${call}.md`, description: `Read page ${call}` },
    });
    if (call === 1) push({ type: "rate_limit", status: "allowed", rateLimitType: "five_hour" });
    push({ type: "tool_result", toolUseId: id, isError: call % 13 === 0, output: `page ${call}\n`.repeat(3) });
    if (call % 4 === 3 && entries.length < SYNTHETIC_LINE_COUNT - 2) {
      push({ type: "assistant_text", text: `Synthetic turn ${turn}: page ${call} read, moving to the next one.` });
      turn += 1;
    }
    call += 1;
  }
  while (entries.length < SYNTHETIC_LINE_COUNT - 2) {
    push({ type: "assistant_text", text: `Synthetic turn ${turn}.` });
    turn += 1;
  }
  push({
    type: "result",
    subtype: "success",
    isError: false,
    inputTokens: 2_000_000,
    outputTokens: 15_000,
    totalCostUsd: 1.25,
    stopReason: "end_turn",
  });
  push({ type: "session_closed", reason: "completed", result: { subtype: "success" } });
  return entries;
}

/** A `LogWindowDto` over `entries`, as `commands/session.rs`'s `session_log_window` returns it: the
 * limit is clamped to 100, and `total` is always the whole log's length. */
export function logWindow(entries: Entry[], offset: number, limit: number) {
  const effective = Math.min(limit, 100);
  return { entries: entries.slice(offset, offset + effective), offset, limit: effective, total: entries.length };
}

/** A `RawLogWindowDto` over `entries`, as `session_raw_window` returns it. */
export function rawWindow(entries: Entry[], offset: number, limit: number) {
  const effective = Math.min(limit, 100);
  return {
    lines: entries.slice(offset, offset + effective).map((entry, i) => ({ line: offset + i, text: JSON.stringify(entry) })),
    offset,
    limit: effective,
    total: entries.length,
  };
}

/** The session's stored row, ended. */
export const SYNTHETIC_ENDED_ROW = {
  id: SYNTHETIC_RUN_ID,
  storyId: null,
  status: "completed",
  startedAt: SYNTHETIC_STARTED_AT,
  endedAt: SYNTHETIC_ENDED_AT,
  costUsd: 1.25,
  tokensIn: 2_000_000,
  tokensOut: 15_000,
  externalSessionId: "ext-synthetic",
  acknowledgedAt: null,
  abandonedReason: null,
  endingReason: "handed_off",
};
