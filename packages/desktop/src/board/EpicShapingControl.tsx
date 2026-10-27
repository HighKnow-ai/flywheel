/**
 * The Epic card's shaping control (docs/mvp-spec.md §3, issues #122, #123, #124). An Epic in Shaping offers
 * one next action, like a Story row:
 *
 * - **Answer** (attention) while a live shaping session is held on one of its Rounds, Waiting on you: it
 *   opens the Epic's shaping view, where the Round dock takes the answers.
 * - **Open session** while a shaping session is live and not waiting (reading, or about to pick an open
 *   Round up with `round_wait`), which opens the session's feed (the click model: only a control labelled
 *   as the session opens it).
 * - **Continue shaping** (issue #124) once the Epic has Rounds and no live session: it starts a fresh
 *   session rebuilt from the board, which carries every Round with its answers and picks the open one up.
 *   It keeps you where you are, like Resume on a Story row.
 * - **Shape** otherwise, which starts a read-only shaping session and keeps you where you are, like Start on
 *   a Story row.
 *
 * Every one is an outline button but Answer, so the heading never competes with a row's filled Start (the
 * One Filled Action Rule). On the board it is followed by the Epic's own chevron, which opens its shaping
 * view (the Epic card and the dock) at any time. An Epic out of Shaping offers none of these. In the shaping
 * view itself (`place="epic"`) Answer never shows (the dock is already on screen), and neither does Continue
 * shaping while a Round is open: the dock's band, beside that Round, carries it.
 *
 * The live session and the Rounds are the core's reads, keyed under the project so the one `board:changed`
 * subscription swaps the controls as the session starts, posts or picks up a Round and ends.
 */
import { useState } from "react";
import { TruncateTip } from "@/components/TruncateTip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MessageCircleQuestionMark, MessagesSquare, RotateCcw, Terminal } from "lucide-react";
import { epicShape, epicShapingRounds, epicShapingSession, shapingContinue, type EpicDto } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/Button";
import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@highknow/design";
import { notify } from "@/lib/notify";
import { errorText } from "./StoryControls";

type EpicRef = Pick<EpicDto, "id" | "key" | "title" | "state">;

export interface EpicShapingControlProps {
  projectId: string;
  epic: EpicRef;
  /** Where the control sits: the board's Epic card (default) or the Epic's own shaping view. */
  place?: "board" | "epic";
}

/** The Epic's live shaping session id, keyed under the project. */
export function shapingSessionKey(projectId: string, epicId: string) {
  return ["board", projectId, "shaping-session", epicId] as const;
}

/** Start a shaping session (Shape or Continue shaping) and refetch the Epic's session, keeping the refusal. */
function useStartShaping(projectId: string, epicId: string, start: (epicId: string) => Promise<unknown>, done: string) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function run() {
    if (starting) return;
    setStarting(true);
    setError(null);
    start(epicId)
      .then(() => {
        notify.success(done);
        return queryClient.invalidateQueries({ queryKey: shapingSessionKey(projectId, epicId) });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setStarting(false));
  }
  return { run, starting, error };
}

function StartError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <TruncateTip text={error}>
      <span role="alert" className="min-w-0 truncate text-small text-destructive-text">
        {error}
      </span>
    </TruncateTip>
  );
}

/**
 * Continue shaping (issue #124), on its own: the dock's band beside a Round whose session died carries it.
 * Starts a fresh session through `shaping_continue` and keeps you where you are.
 */
export function ContinueShapingButton({
  projectId,
  epic,
  className,
}: {
  projectId: string;
  epic: Pick<EpicDto, "id" | "key" | "title">;
  className?: string;
}) {
  const { run, starting, error } = useStartShaping(
    projectId,
    epic.id,
    shapingContinue,
    `Continued shaping ${epic.key}`,
  );
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <StartError error={error} />
      <Button
        variant="outline"
        size="sm"
        aria-label={`Continue shaping ${epic.key} ${epic.title}`}
        onClick={run}
        loading={starting}
        className="shrink-0"
      >
        <RotateCcw aria-hidden="true" />
        Continue shaping
      </Button>
    </span>
  );
}

export function EpicShapingControl({ projectId, epic, place = "board" }: EpicShapingControlProps) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openEpic = useUiStore((state) => state.openEpic);
  const shape = useStartShaping(projectId, epic.id, epicShape, `Started shaping ${epic.key}`);
  const shaping = epic.state === "shaping";
  const liveQuery = useQuery({
    queryKey: shapingSessionKey(projectId, epic.id),
    queryFn: () => epicShapingSession(epic.id),
    enabled: shaping,
  });
  const roundsQuery = useQuery({
    queryKey: ["board", projectId, "shaping-rounds", epic.id],
    queryFn: () => epicShapingRounds(epic.id),
    enabled: shaping,
  });
  if (!shaping) return null;

  const liveSessionId = liveQuery.data ?? null;
  const rounds = roundsQuery.data?.rounds ?? [];
  // The core's derivation: open, with a LIVE session held on it (issue #124).
  const waiting = rounds.some((r) => r.waitingOnYou);
  const roundOpen = rounds.some((r) => r.state === "open");

  let action;
  if (place === "board" && waiting) {
    action = (
      <Button
        variant="attention"
        size="sm"
        aria-label={`Answer the Round on ${epic.key}`}
        onClick={() => openEpic(projectId, epic.id)}
        className="shrink-0"
      >
        <MessageCircleQuestionMark aria-hidden="true" />
        Answer
      </Button>
    );
  } else if (liveSessionId) {
    action = (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Open shaping session of ${epic.key}`}
        onClick={() => setActiveSessionId(liveSessionId, null)}
        className="shrink-0"
      >
        <Terminal aria-hidden="true" />
        Open session
      </Button>
    );
  } else if (rounds.length > 0) {
    // In the shaping view, the dock's band beside the open Round carries Continue shaping.
    action = place === "epic" && roundOpen ? null : <ContinueShapingButton projectId={projectId} epic={epic} />;
  } else {
    action = (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Shape ${epic.key} ${epic.title}`}
        onClick={shape.run}
        loading={shape.starting}
        className="shrink-0"
      >
        <MessagesSquare aria-hidden="true" />
        Shape
      </Button>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <StartError error={shape.error} />
      {action}
      {place === "board" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${epic.key} ${epic.title} and its Rounds`}
              onClick={() => openEpic(projectId, epic.id)}
              className="-mr-7 shrink-0 text-subtle-foreground"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open the Epic and its Rounds</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
