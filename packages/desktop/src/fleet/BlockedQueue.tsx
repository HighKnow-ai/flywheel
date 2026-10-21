/**
 * The Waiting on you queue (Phase 10 plan 10-05, FLEET-02, D-172, D-173; #57): every Gated action and
 * permission request a live session holds, across every registered project, one entry per request,
 * answered in place. The core derives it from the pending requests themselves, never from a stored
 * session status. An abandoned run and an awaiting-review run stay on the fleet view and in their own
 * rail rows. A request waits here until it is answered: nothing times it out or denies it.
 *
 * Each entry is the THIRD mount of `PermissionRequestCard` (after the session feed and the item detail
 * panel), reading and writing the same `permission_requests` row through the unchanged
 * `answerPermissionRequest` wrapper, so answering here resolves the session's own instance too. There
 * is no second answer verb, no local dismiss and no key handler in this file; the card keeps its own
 * rule that a pending request cannot be closed without an answer.
 *
 * ONE keystroke answers ONE request. The card registers a window-level listener per row, with no
 * deduplication, so `keyboardEnabled` is passed `true` to exactly one card (the first in queue order)
 * and `false` to every other. That owner is marked in words and by a left rule, never by colour alone.
 * Draining a queue may be quick; it may never become approving in bulk.
 *
 * A Gated action raised by the shim lands here like any other request, with Deny leading and no
 * standing rule offered.
 */
import { useQueryClient } from "@tanstack/react-query";
import { answerPermissionRequest, answerQuestion, type BlockedQueueEntryDto } from "../adapters/tauri";
import { pendingPermissionRequestsQueryKey } from "../board/useBoardQuery";
import { formatAge } from "../legend/runStatus";
import { PermissionRequestCard, type PermissionDecision } from "../session/PermissionRequestCard";
import { ASK_USER_QUESTION_TOOL } from "../session/feedRows";
import { blockedQueueQueryKey, fleetQueryKey } from "./useFleet";

/** What the waiting session is about: its Story's key and title. */
function subjectText(entry: BlockedQueueEntryDto): { key: string; detail: string | null } {
  return { key: entry.storyKey, detail: entry.storyTitle || null };
}

export interface BlockedQueueProps {
  /** Entries in queue order, longest waiting first, as the core read returns them. */
  entries: BlockedQueueEntryDto[];
  /** The shared clock, so the elapsed times tick on the surface's one interval. */
  now: number;
}

export function BlockedQueue({ entries, now }: BlockedQueueProps) {
  const queryClient = useQueryClient();

  async function onAnswer(
    entry: BlockedQueueEntryDto,
    requestId: string,
    decision: PermissionDecision,
    rule?: string,
  ) {
    await answerPermissionRequest(requestId, decision, rule);
    refresh(entry);
  }

  /** Issue #100: an agent's question is answered here too, with answers, never Allow / Deny. */
  async function onAnswerQuestion(entry: BlockedQueueEntryDto, requestId: string, picks: Record<string, string[]>) {
    await answerQuestion(requestId, picks);
    refresh(entry);
  }

  function refresh(entry: BlockedQueueEntryDto) {
    // Re-read rather than edit local state, so the keyboard owner moves because the list moved.
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: pendingPermissionRequestsQueryKey(entry.sessionId) });
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <span className="type-heading">Nothing is waiting on you</span>
        <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
          When an agent in any project stops to ask for your answer, its request appears here.
        </span>
      </div>
    );
  }

  // A question takes no keystroke (issue #100), so A and D belong to the first permission request.
  const ownerIndex = entries.findIndex((e) => e.toolName !== ASK_USER_QUESTION_TOOL);

  return (
    <div role="list" aria-label="Requests waiting on you" style={{ display: "flex", flexDirection: "column" }}>
      {entries.map((entry, index) => {
        const owner = index === ownerIndex;
        const subject = subjectText(entry);
        return (
          <div
            key={entry.requestId}
            role="listitem"
            data-run-id={entry.sessionId}
            data-keyboard-owner={owner ? "true" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              padding: "var(--space-sm) var(--space-md)",
              borderBottom: "1px solid var(--divider)",
              borderLeft: owner ? "4px solid var(--selection-rule)" : "4px solid transparent",
            }}
          >
            <div className="type-label" style={{ display: "flex", gap: "var(--space-sm)", alignItems: "baseline", minWidth: 0 }}>
              <span style={{ color: "var(--blocked-text-rack)", fontWeight: 600 }}>Waiting on you</span>
              <span data-field="project">{entry.projectName}</span>
              <span className="tabular-nums" data-field="subject">
                {subject.key}
                {subject.detail ? <span style={{ color: "var(--text-muted-rack)" }}>{` ${subject.detail}`}</span> : null}
              </span>
              {owner && (
                <span data-field="owner" style={{ color: "var(--text-muted-rack)" }}>
                  Keys A and D answer this one
                </span>
              )}
              <span
                className="tabular-nums"
                data-field="age"
                aria-label={`Waiting ${formatAge(entry.blockedSince, now)}`}
                style={{ marginLeft: "auto", color: "var(--text-muted-rack)" }}
              >
                {formatAge(entry.blockedSince, now)}
              </span>
            </div>
            <PermissionRequestCard
              variant="feed"
              keyboardEnabled={owner}
              requests={[
                {
                  id: entry.requestId,
                  toolName: entry.toolName,
                  inputPayload: entry.inputPayload,
                  destructiveCategory: entry.destructiveCategory,
                  suggestedRule: entry.suggestedRule,
                },
              ]}
              onAnswer={(requestId, decision, rule) => onAnswer(entry, requestId, decision, rule)}
              onAnswerQuestion={(requestId, picks) => onAnswerQuestion(entry, requestId, picks)}
            />
          </div>
        );
      })}
    </div>
  );
}
