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
 * and `false` to every other. That owner is marked in words, never by colour alone.
 * Draining a queue may be quick; it may never become approving in bulk.
 *
 * A Gated action raised by the shim lands here like any other request, with Deny leading and no
 * standing rule offered.
 *
 * The keyboard owner's hint draws its keys as Kbd, and the in-row Open session is the roster's small size
 * (#208), so an action reads the same size wherever it sits in a row.
 *
 * Every entry goes somewhere (issue #104): its Story key opens the Story, and its "Open session"
 * control, and only that, opens the live session it came from.
 *
 * A shaping Round a live session is held on waits here too (issue #124), after the requests: its Epic, how
 * far it is answered and how long it has waited. It takes no keystroke. A Round is answered question by
 * question in its dock, so its Answer opens the Epic's shaping view, as the Epic card's Answer does.
 */
import { useQueryClient } from "@tanstack/react-query";
import { TruncateTip } from "@/components/TruncateTip";
import {
  answerPermissionRequest,
  answerQuestion,
  type BlockedQueueEntryDto,
  type WaitingRoundDto,
} from "../adapters/tauri";
import { pendingPermissionRequestsQueryKey } from "../board/useBoardQuery";
import { PermissionRequestCard, type PermissionDecision } from "../session/PermissionRequestCard";
import { ASK_USER_QUESTION_TOOL } from "../session/feedRows";
import { useUiStore } from "../state/uiStore";
import { useOpenWaitingRound, waitingRoundWords } from "./waitingRound";
import { ageText, blockedQueueQueryKey, fleetQueryKey } from "./useFleet";
import { ChevronRight, CircleDashed, MessageCircleQuestionMark, Terminal } from "lucide-react";
import { StateBadge } from "../components/StateBadge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";

/** What the waiting session is about: its Story's key and title. */
function subjectText(entry: BlockedQueueEntryDto): { key: string; detail: string | null } {
  return { key: entry.storyKey, detail: entry.storyTitle || null };
}

export interface BlockedQueueProps {
  /** Entries in queue order, longest waiting first, as the core read returns them. */
  entries: BlockedQueueEntryDto[];
  /** Issue #124: the shaping Rounds a live session is held on, longest waiting first. */
  rounds?: WaitingRoundDto[];
  /** The shared clock, so the elapsed times tick on the surface's one interval. */
  now: number;
}

export function BlockedQueue({ entries, rounds = [], now }: BlockedQueueProps) {
  const queryClient = useQueryClient();
  const openStory = useUiStore((state) => state.openStory);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);

  async function onAnswer(entry: BlockedQueueEntryDto, requestId: string, decision: PermissionDecision, rule?: string) {
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

  if (entries.length === 0 && rounds.length === 0) {
    return (
      <Empty className="flex-none rounded-lg border border-solid border-border bg-card shadow-card">
        <EmptyHeader>
          <EmptyTitle className="text-section font-semibold">Nothing is waiting on you</EmptyTitle>
          <EmptyDescription>
            When an agent in any project stops to ask for your answer, its request appears here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // A question takes no keystroke (issue #100), so A and D belong to the first permission request.
  const ownerIndex = entries.findIndex((e) => e.toolName !== ASK_USER_QUESTION_TOOL);

  return (
    <div className="flex flex-col gap-5">
      {entries.length > 0 && (
        <div role="list" aria-label="Requests waiting on you" className="flex flex-col gap-5">
          {entries.map((entry, index) => {
            const owner = index === ownerIndex;
            const subject = subjectText(entry);
            return (
              <div
                key={entry.requestId}
                role="listitem"
                data-run-id={entry.sessionId}
                data-keyboard-owner={owner ? "true" : undefined}
                className="flex flex-col gap-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <StateBadge state="waiting_on_you" className="h-5.5 text-meta" />
                  <span data-field="project" className="text-small text-muted-foreground">
                    {entry.projectName}
                  </span>
                  <button
                    type="button"
                    data-field="subject"
                    aria-label={`Open Story ${subject.key}`}
                    onClick={() => openStory(entry.projectId, entry.storyId)}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent"
                  >
                    <span className="shrink-0 font-mono text-meta text-muted-foreground">{subject.key}</span>
                    {subject.detail ? " " : null}
                    {subject.detail ? (
                      <TruncateTip text={subject.detail}>
                        <span className="truncate text-body font-semibold">{subject.detail}</span>
                      </TruncateTip>
                    ) : null}
                    <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-subtle-foreground" />
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Open live session of ${subject.key}`}
                    onClick={() => setActiveSessionId(entry.sessionId, entry.storyId, null, "blocked")}
                  >
                    <Terminal aria-hidden="true" />
                    Open session
                  </Button>
                  {owner && (
                    <span data-field="owner" className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                      Keys <Kbd>A</Kbd> and <Kbd>D</Kbd> answer this one
                    </span>
                  )}
                  <span
                    data-field="age"
                    aria-label={`Waiting ${ageText(entry.blockedSince, now)}`}
                    className="ml-auto text-small text-muted-foreground tabular-nums"
                  >
                    {ageText(entry.blockedSince, now)}
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
      )}
      {rounds.length > 0 && (
        <div role="list" aria-label="Shaping Rounds waiting on you" className="flex flex-col gap-5">
          {rounds.map((round) => (
            <WaitingRoundItem key={round.roundId} round={round} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One shaping Round a live session is held on: the Epic it shapes, how far it is answered, Answer. A
 * roadmap Round (issue #133): the project's Roadmap, how many proposed changes are decided, Decide. */
function WaitingRoundItem({ round, now }: { round: WaitingRoundDto; now: number }) {
  const open = useOpenWaitingRound();
  const words = waitingRoundWords(round);
  const age = ageText(round.waitingSince, now);
  return (
    <div
      role="listitem"
      aria-label={
        round.subject === "roadmap"
          ? `${words.round} of ${words.record}`
          : `${words.round} of ${words.key} ${words.title}`
      }
      data-round-id={round.roundId}
      className="flex flex-col gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <StateBadge state="waiting_on_you" className="h-5.5 text-meta" />
        <span data-field="project" className="text-small text-muted-foreground">
          {round.projectName}
        </span>
        <button
          type="button"
          data-field="subject"
          aria-label={round.subject === "roadmap" ? `Open ${words.record}` : `Open Epic ${words.key}`}
          onClick={() => open(round)}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent"
        >
          {words.key && <span className="shrink-0 font-mono text-meta text-muted-foreground">{words.key}</span>}{" "}
          <TruncateTip text={words.title}>
            <span className="truncate text-body font-semibold">{words.title}</span>
          </TruncateTip>
          <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-subtle-foreground" />
        </button>
        <span
          data-field="age"
          aria-label={`Waiting ${age}`}
          className="ml-auto text-small text-muted-foreground tabular-nums"
        >
          {age}
        </span>
      </div>
      {/* The request card's frame (the 2px attention edge and the yellow band), so a Round reads as the
          same kind of thing as every other entry here. */}
      <div className="overflow-clip rounded-lg border-2 border-attention bg-card shadow-card">
        <div className="flex min-h-11 items-center gap-2.5 bg-attention px-4 py-2.5 text-attention-foreground [&_svg]:size-[18px]">
          {round.subject === "roadmap" ? (
            <CircleDashed aria-hidden="true" />
          ) : (
            <MessageCircleQuestionMark aria-hidden="true" />
          )}
          <span className="text-row font-bold">{words.round}</span>
          <span className="ml-auto text-small font-semibold">{words.kind}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <span className="text-small font-semibold tabular-nums">{words.progress}</span>
          <span className="min-w-0 flex-1 text-small text-muted-foreground">{words.hint}</span>
          <Button
            variant="attention"
            size="sm"
            aria-label={`${words.action} ${words.round} of ${round.subject === "roadmap" ? words.record : words.key}`}
            onClick={() => open(round)}
          >
            {round.subject === "roadmap" ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <MessageCircleQuestionMark aria-hidden="true" />
            )}
            {words.action}
          </Button>
        </div>
      </div>
    </div>
  );
}
