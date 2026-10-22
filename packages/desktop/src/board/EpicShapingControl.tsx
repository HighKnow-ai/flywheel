/**
 * The Epic card's shaping control (docs/mvp-spec.md §3, issue #122). An Epic in Shaping offers
 * **Shape**, which starts a read-only shaping session on it and keeps you where you are, like Start on a
 * Story row; it is an outline button, so the heading never competes with a row's filled Start (the One
 * Filled Action Rule). While that session is live the card offers **Open session** in its place, which
 * opens the session's feed (the click model: only a control labelled as the session opens it). An Epic out of
 * Shaping offers neither.
 *
 * The live session is the core's read (`epic_shaping_session`), keyed under the project so the one
 * `board:changed` subscription swaps Shape for Open session as the session starts and ends.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Terminal } from "lucide-react";
import { epicShape, epicShapingSession, type EpicDto } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { errorText } from "./StoryControls";

export function EpicShapingControl({ projectId, epic }: { projectId: string; epic: Pick<EpicDto, "id" | "key" | "title" | "state"> }) {
  const queryClient = useQueryClient();
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shaping = epic.state === "shaping";
  const sessionKey = ["board", projectId, "shaping-session", epic.id];
  const liveQuery = useQuery({
    queryKey: sessionKey,
    queryFn: () => epicShapingSession(epic.id),
    enabled: shaping,
  });
  if (!shaping) return null;

  const liveSessionId = liveQuery.data ?? null;
  if (liveSessionId) {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Open shaping session of ${epic.key}`}
        onClick={() => setActiveSessionId(liveSessionId, null)}
      >
        <Terminal aria-hidden="true" />
        Open session
      </Button>
    );
  }

  function handleShape() {
    if (starting) return;
    setStarting(true);
    setError(null);
    epicShape(epic.id)
      .then(() => queryClient.invalidateQueries({ queryKey: sessionKey }))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setStarting(false));
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {error && (
        <span role="alert" title={error} className="min-w-0 truncate text-small text-destructive-text">
          {error}
        </span>
      )}
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
    </span>
  );
}
