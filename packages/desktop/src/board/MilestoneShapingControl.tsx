/**
 * A Milestone's shaping control (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #132): the
 * Epic card's control (`EpicShapingControl`) for a Milestone in Shaping, on its Roadmap strip row, in the
 * Milestone header and in its own shaping view. One next action:
 *
 * - **Answer** (attention) while a live shaping session is held on its Round, Waiting on you: it opens the
 *   Milestone's shaping view, where the dock takes the answers.
 * - **Open session** while a shaping session is live and not waiting, which opens the session's feed.
 * - **Continue shaping** once the Milestone has Rounds and no live session: a fresh session rebuilt from the
 *   board picks the open Round up. It keeps you where you are, like the Epic's.
 * - **Shape** otherwise, which starts a read-only shaping session on the exit test and opens the
 *   Milestone's shaping view, so the dock with the Exit test Stage is on screen as the first Round lands.
 *
 * Every one is an outline button but Answer (the One Filled Action Rule). In the header (`place="header"`)
 * it is followed by a chevron that opens the shaping view at any time. In the view itself Answer never shows,
 * and neither does Continue shaping while a Round is open: the dock's band carries it. A Milestone out of
 * Shaping offers none of these.
 */
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MessageCircleQuestionMark, MessagesSquare, RotateCcw, Terminal } from "lucide-react";
import {
  milestoneShape,
  milestoneShapingContinue,
  milestoneShapingRounds,
  milestoneShapingSession,
  type MilestoneDto,
} from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { errorText } from "./StoryControls";

type MilestoneRef = Pick<MilestoneDto, "id" | "title" | "state">;

/** The Milestone's shaping read (its Stage, Rounds and Proposals), keyed under the project. */
export function milestoneShapingKey(projectId: string, milestoneId: string) {
  return ["board", projectId, "milestone-shaping", milestoneId] as const;
}

/** The Milestone's live shaping session id, keyed under the project. */
export function milestoneSessionKey(projectId: string, milestoneId: string) {
  return ["board", projectId, "milestone-shaping-session", milestoneId] as const;
}

/**
 * What a Milestone in Shaping asks of the developer, in place of its state word: `waiting_on_you` while a live
 * session is held on its Round, `round_waiting` while a Round is open with no live session, else `null`. The
 * board's Milestone header and the Milestone card read it alike, so the two never disagree.
 */
export function useMilestoneAttention(projectId: string, milestone: Pick<MilestoneDto, "id" | "state">): string | null {
  const shaping = milestone.state === "shaping";
  const live = useQuery({
    queryKey: milestoneSessionKey(projectId, milestone.id),
    queryFn: () => milestoneShapingSession(milestone.id),
    enabled: shaping,
  });
  const read = useQuery({
    queryKey: milestoneShapingKey(projectId, milestone.id),
    queryFn: () => milestoneShapingRounds(milestone.id),
    enabled: shaping,
  });
  if (!shaping) return null;
  const rounds = read.data?.rounds ?? [];
  if (rounds.some((r) => r.waitingOnYou)) return "waiting_on_you";
  if (rounds.some((r) => r.state === "open") && live.isSuccess && !live.data) return "round_waiting";
  return null;
}

/** Start a shaping session on the Milestone (Shape or Continue shaping), keeping the refusal. */
function useStart(projectId: string, milestoneId: string, start: (id: string) => Promise<unknown>, done: string, then?: () => void) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function run() {
    if (starting) return;
    setStarting(true);
    setError(null);
    start(milestoneId)
      .then(() => {
        notify.success(done);
        then?.();
        return queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setStarting(false));
  }
  return { run, starting, error };
}

function StartError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <span role="alert" title={error} className="min-w-0 truncate text-small text-destructive-text">
      {error}
    </span>
  );
}

/**
 * A start control on a strip row, where no line of text fits beside it: a refusal is the button's tooltip,
 * named to assistive tech through a hidden alert the button points at. Elsewhere the refusal is a line.
 */
function WithRefusal({ error, compact, children }: { error: string | null; compact: boolean; children: React.ReactElement }) {
  const alertId = useId();
  if (!compact || !error) {
    return (
      <>
        {!compact && <StartError error={error} />}
        {children}
      </>
    );
  }
  return (
    <>
      <span id={alertId} role="alert" className="sr-only">
        {error}
      </span>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild aria-describedby={alertId}>
          {children}
        </TooltipTrigger>
        <TooltipContent className="max-w-80">{error}</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Continue shaping a Milestone, on its own: the dock's band beside a Round whose session died carries it. */
export function ContinueMilestoneShapingButton({
  projectId,
  milestone,
  size = "sm",
}: {
  projectId: string;
  milestone: Pick<MilestoneDto, "id" | "title">;
  size?: "sm" | "xs";
}) {
  const { run, starting, error } = useStart(projectId, milestone.id, milestoneShapingContinue, `Continued shaping ${milestone.title}`);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <WithRefusal error={error} compact={size === "xs"}>
      <Button
        variant="outline"
        size={size}
        aria-label={`Continue shaping the exit test of ${milestone.title}`}
        onClick={run}
        loading={starting}
        className="shrink-0"
      >
        <RotateCcw aria-hidden="true" />
        Continue shaping
      </Button>
      </WithRefusal>
    </span>
  );
}

export interface MilestoneShapingControlProps {
  projectId: string;
  milestone: MilestoneRef;
  /** Where the control sits: a Roadmap strip row (compact), the Milestone header, or the shaping view. */
  place: "strip" | "header" | "view";
}

export function MilestoneShapingControl({ projectId, milestone, place }: MilestoneShapingControlProps) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openMilestone = useUiStore((state) => state.openMilestone);
  const open = () => openMilestone(projectId, milestone.id);
  const shape = useStart(projectId, milestone.id, milestoneShape, `Started shaping ${milestone.title}`, place === "view" ? undefined : open);
  const shaping = milestone.state === "shaping";
  const liveQuery = useQuery({
    queryKey: milestoneSessionKey(projectId, milestone.id),
    queryFn: () => milestoneShapingSession(milestone.id),
    enabled: shaping,
  });
  const roundsQuery = useQuery({
    queryKey: milestoneShapingKey(projectId, milestone.id),
    queryFn: () => milestoneShapingRounds(milestone.id),
    enabled: shaping,
  });
  if (!shaping) return null;

  const size = place === "strip" ? "xs" : "sm";
  const liveSessionId = liveQuery.data ?? null;
  const rounds = roundsQuery.data?.rounds ?? [];
  const waiting = rounds.some((r) => r.waitingOnYou);
  const roundOpen = rounds.some((r) => r.state === "open");

  let action;
  if (place !== "view" && waiting) {
    action = (
      <Button
        variant="attention"
        size={size}
        aria-label={`Answer the Round on ${milestone.title}`}
        onClick={open}
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
        size={size}
        aria-label={`Open shaping session of ${milestone.title}`}
        onClick={() => setActiveSessionId(liveSessionId, null)}
        className="shrink-0"
      >
        <Terminal aria-hidden="true" />
        Open session
      </Button>
    );
  } else if (rounds.length > 0) {
    action =
      place === "view" && roundOpen ? null : (
        <ContinueMilestoneShapingButton projectId={projectId} milestone={milestone} size={size} />
      );
  } else {
    action = (
      <WithRefusal error={shape.error} compact={place === "strip"}>
      <Button
        variant="outline"
        size={size}
        aria-label={`Shape the exit test of ${milestone.title}`}
        onClick={shape.run}
        loading={shape.starting}
        className="shrink-0"
      >
        <MessagesSquare aria-hidden="true" />
        Shape
      </Button>
      </WithRefusal>
    );
  }

  return (
    <span className={cn("flex min-w-0 items-center gap-2", place === "strip" && "justify-end")}>
      {action}
      {place === "header" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open the exit test of ${milestone.title} and its Rounds`}
              onClick={open}
              className="shrink-0 text-subtle-foreground"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open the exit test and its Rounds</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
