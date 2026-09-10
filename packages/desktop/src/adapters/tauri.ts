/**
 * The single invoke/listen seam between the React tree and the Tauri command surface.
 *
 * This is the ONLY module in the renderer permitted to import from `@tauri-apps/api`
 * (`.claude/CLAUDE.md` names this a phase-1 requirement, not a stack preference — the
 * same React tree must later be able to point at a relay client by editing this one file).
 * Every component that needs to call into the Rust core, or subscribe to board-changed
 * push notifications, does so through `invokeCommand` / `subscribeBoardChanged` — never
 * by importing `invoke`/`listen` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Invoke a Tauri command and return its typed result.
 */
export async function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invoke<TResult>(command, args);
}

/**
 * Subscribe to the `board:changed` event the Rust core emits after every committed
 * mutation (D-04). The handler should invalidate/refetch the affected queries — the UI
 * must never trust its own optimistic write as the source of truth.
 */
export async function subscribeBoardChanged(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen("board:changed", () => handler());
}

/**
 * Open the native folder picker for project registration (01-UI-SPEC.md "Board list", the
 * "Register Project…" flow). Returns the chosen absolute path, or `null` if the user cancelled.
 *
 * This module is also the only place `@tauri-apps/plugin-dialog` is imported, extending the same
 * single-seam rule `invokeCommand`/`subscribeBoardChanged` follow above.
 */
export async function openFolderDialog(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result ?? null;
}

/**
 * Subscribe to `menu:action`, the event `src-tauri/src/menu.rs`'s `on_menu_event` handler emits
 * when the user clicks a native menu item (01-09-PLAN.md Task 2). The payload is the exact
 * `state/keyboard.ts` `ActionId` string the corresponding keystroke would resolve to — menu items
 * invoke the same registered action ids as the keyboard/palette, never a broader capability
 * (threat T-01-02: "no menu item is given a broader capability").
 */
export async function subscribeMenuAction(handler: (actionId: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu:action", (event) => handler(event.payload));
}

/**
 * Start a fresh agent run against `taskId` (D-30, plan 02-01; `instruction`/D-27 added plan
 * 02-04). Thin typed wrapper over `agent_run_start`, following `invokeCommand`'s own single-seam
 * rule.
 */
export interface AgentRunDto {
  id: string;
  taskId: string;
  status: string;
  permissionMode: string;
}

export async function startAgentRun(
  taskId: string,
  permissionMode: string,
  instruction?: string,
): Promise<AgentRunDto> {
  return invokeCommand<AgentRunDto>("agent_run_start", { taskId, permissionMode, instruction });
}

/**
 * One acceptance criterion in the launch sheet's briefing (D-05/D-28) — mirrors
 * `commands/agent_run.rs`'s `CriterionDto` field-for-field.
 */
export interface CriterionDto {
  statement: string;
  verificationHint: string | null;
}

/**
 * The launch sheet's read-only briefing (D-27/D-28, plan 02-04): the assembled context packet's
 * structured fields plus the exact prompt string `agent_run_start` would send for an empty
 * instruction — one Rust-side renderer, so the sheet never shows a briefing that differs from
 * what the agent is actually told (T-02-21).
 */
export interface ContextPacketDto {
  taskKey: string;
  taskTitle: string;
  taskDescription: string | null;
  epicTitle: string | null;
  epicDescription: string | null;
  criteria: CriterionDto[];
  branch: string;
  baseRef: string;
  worktreePath: string;
  renderedPrompt: string;
}

/**
 * Preview the briefing a Start Work run against `taskId` would send (D-27/D-28). Read-only:
 * mutates nothing, creates no worktree, writes no trigger row and emits no event — the launch
 * sheet's own defining property. Thin typed wrapper over `agent_run_preview`, and the only
 * renderer module permitted to name that command string.
 */
export async function previewContextPacket(taskId: string): Promise<ContextPacketDto> {
  return invokeCommand<ContextPacketDto>("agent_run_preview", { taskId });
}

/**
 * A bounded page of an agent run's durable session log (D-33, D-34) — the same
 * `LIMIT`/`OFFSET` windowed-read shape `events_activity_trail` already uses, server-capped at
 * 100 rows regardless of what is requested (T-02-06).
 */
export async function agentRunLogWindow(
  agentRunId: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  return invokeCommand<Record<string, unknown>[]>("agent_run_log_window", {
    agentRunId,
    offset,
    limit,
  });
}

/**
 * Subscribe to `agent:event`, the Rust core's live push of one normalised agent event at a time
 * (D-32) — the session surface invalidates its windowed read on this, never trusting a streamed
 * event as already-persisted (mirrors `subscribeBoardChanged`'s own D-04 discipline).
 */
export async function subscribeAgentEvent(
  handler: (event: Record<string, unknown>) => void,
): Promise<UnlistenFn> {
  return listen<Record<string, unknown>>("agent:event", (event) => handler(event.payload));
}

/**
 * Stop a running agent run (D-35: interrupt, then force; plan 02-02). Thin typed wrapper over
 * `agent_run_stop`, following `invokeCommand`'s single-seam rule. This call's own resolution is
 * NOT the run's terminal status — the sidecar's interrupt-then-force sequence has already
 * finished by the time the Rust command returns, but the session surface reads the actual
 * terminal state back through the pushed `agent:event`'s `session_closed` reason, never from this
 * promise's return value (mirrors `subscribeBoardChanged`'s own "never trust your own write" rule).
 */
export async function stopAgentRun(agentRunId: string): Promise<void> {
  await invokeCommand<void>("agent_run_stop", { agentRunId });
}
