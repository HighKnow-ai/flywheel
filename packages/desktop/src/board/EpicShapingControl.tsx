/**
 * The Epic card's shaping control (docs/mvp-spec.md §3, issues #122, #123). An Epic in Shaping offers one
 * next action, like a Story row:
 *
 * - **Answer** (attention) while its shaping session is held on a Round, Waiting on you: it opens the Epic's
 *   shaping view, where the Round dock takes the answers.
 * - **Open session** while that session is live and not waiting, which opens the session's feed (the click
 *   model: only a control labelled as the session opens it).
 * - **Shape** otherwise, which starts a read-only shaping session and keeps you where you are, like Start on
 *   a Story row; it is an outline button, so the heading never competes with a row's filled Start (the One
 *   Filled Action Rule).
 *
 * On the board it is followed by the Epic's own chevron, which opens its shaping view (the Epic card and the
 * dock) at any time. An Epic out of Shaping offers none of these. In the shaping view itself (`place="epic"`)
 * only Shape or Open session shows: the dock is already on screen.
 *
 * The live session and the Rounds are the core's reads, keyed under the project so the one `board:changed`
 * subscription swaps the controls as the session starts, posts a Round and ends.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MessageCircleQuestionMark, MessagesSquare, Terminal } from "lucide-react";
import { epicShape, epicShapingRounds, epicShapingSession, type EpicDto } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorText } from "./StoryControls";

export interface EpicShapingControlProps {
  projectId: string;
  epic: Pick<EpicDto, "id" | "key" | "title" | "state">;
  /** Where the control sits: the board's Epic card (default) or the Epic's own shaping view. */
  place?: "board" | "epic";
}

export function EpicShapingControl({ projectId, epic, place = "board" }: EpicShapingControlProps) {
  const queryClient = useQueryClient();
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openEpic = useUiStore((state) => state.openEpic);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shaping = epic.state === "shaping";
  const sessionKey = ["board", projectId, "shaping-session", epic.id];
  const liveQuery = useQuery({
    queryKey: sessionKey,
    queryFn: () => epicShapingSession(epic.id),
    enabled: shaping,
  });
  const roundsQuery = useQuery({
    queryKey: ["board", projectId, "shaping-rounds", epic.id],
    queryFn: () => epicShapingRounds(epic.id),
    enabled: shaping && place === "board",
  });
  if (!shaping) return null;

  const liveSessionId = liveQuery.data ?? null;
  const waiting = Boolean(liveSessionId) && (roundsQuery.data?.rounds ?? []).some((r) => r.state === "open" && r.held);

  function handleShape() {
    if (starting) return;
    setStarting(true);
    setError(null);
    epicShape(epic.id)
      .then(() => queryClient.invalidateQueries({ queryKey: sessionKey }))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setStarting(false));
  }

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
  } else {
    action = (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Shape ${epic.key} ${epic.title}`}
        onClick={handleShape}
        disabled={starting}
        className="shrink-0"
      >
        <MessagesSquare aria-hidden="true" />
        {starting ? "Starting…" : "Shape"}
      </Button>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {error && (
        <span role="alert" title={error} className="min-w-0 truncate text-small text-destructive-text">
          {error}
        </span>
      )}
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
