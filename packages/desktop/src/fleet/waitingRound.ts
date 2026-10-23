/**
 * How a waiting Round reads wherever Waiting on you shows it (the andon lamp, the sidebar and the Waiting
 * on you queue). An Epic's Round (issue #124) names its Epic and opens the Epic's shaping view; a roadmap
 * Round (issue #133) names the project's Roadmap and opens the project's board, where its ghost rows sit
 * on the Roadmap strip. A Milestone's Round (issue #132) names the Milestone by its title (it has no key)
 * and opens the Milestone's shaping view.
 */
import type { WaitingRoundDto } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";

export interface WaitingRoundWords {
  /** The short code-face key: the Epic's key, or empty for the Roadmap, which has none. */
  key: string;
  /** The record's title: the Epic's, or "Roadmap" where the project is already named around it. */
  title: string;
  /** The title where nothing around it names the project (the fleet-wide andon lamp): "flywheel Roadmap". */
  lampTitle: string;
  /** The record as a sentence names it: "Epic FLY-1 Waitlist", "the Threadfin Roadmap". */
  record: string;
  /** "Round 2", "Roadmap Round 1". */
  round: string;
  /** "Round 2" for both: where the key already names the record (a lamp, a sidebar row). */
  shortRound: string;
  /** "1 of 3 answered", "1 of 2 decided". */
  progress: string;
  /** What the queue says the agent waits for. */
  hint: string;
  /** The queue band's kind word. */
  kind: string;
  /** The answer button's word. */
  action: string;
}

export function waitingRoundWords(round: WaitingRoundDto): WaitingRoundWords {
  if (round.subject === "roadmap") {
    return {
      key: "",
      title: "Roadmap",
      lampTitle: `${round.projectName} Roadmap`,
      record: `the ${round.projectName} Roadmap`,
      round: `Roadmap Round ${round.roundNumber}`,
      shortRound: `Round ${round.roundNumber}`,
      progress: `${round.answered} of ${round.questions} decided`,
      hint: "The agent goes on once every proposed change is decided.",
      kind: "Roadmap change",
      action: "Decide",
    };
  }
  if (round.subject === "milestone") {
    const title = round.milestoneTitle ?? "";
    return {
      key: "",
      title,
      lampTitle: title,
      record: `Milestone ${title}`,
      round: `Round ${round.roundNumber}`,
      shortRound: `Round ${round.roundNumber}`,
      progress: `${round.answered} of ${round.questions} answered`,
      hint: "The agent goes on once every question is answered.",
      kind: "Shaping question",
      action: "Answer",
    };
  }
  const key = round.epicKey ?? "";
  const title = round.epicTitle ?? "";
  return {
    key,
    title,
    lampTitle: title,
    record: `Epic ${`${key} ${title}`.trim()}`,
    round: `Round ${round.roundNumber}`,
    shortRound: `Round ${round.roundNumber}`,
    progress: `${round.answered} of ${round.questions} answered`,
    hint: "The agent goes on once every question is answered.",
    kind: "Shaping question",
    action: "Answer",
  };
}

/** The project whose board is the current place, with nothing open over it, or `null`: where a roadmap
 * Round's lamp and sidebar row are marked current. */
export function usePlaceBoardId(): string | null {
  return useUiStore((state) =>
    state.activeSessionId || state.currentStoryId || state.currentEpicId || state.currentMilestoneId || state.fleetSurface || state.worktreeInventoryOpen || state.settingsOpen
      ? null
      : state.currentProjectId,
  );
}

/** The Epic or Milestone whose shaping view is the current place, with no session over it, or `null`. */
export function usePlaceShapingId(): string | null {
  return useUiStore((state) => (state.activeSessionId ? null : (state.currentEpicId ?? state.currentMilestoneId)));
}

/** Whether a waiting Round's lamp or row marks the current place: its project's board for a roadmap Round,
 * else its Epic's or Milestone's shaping view. */
export function isRoundHere(round: WaitingRoundDto, placeBoardId: string | null, placeShapingId: string | null): boolean {
  if (round.subject === "roadmap") return round.projectId === placeBoardId;
  const id = round.subject === "milestone" ? round.milestoneId : round.epicId;
  return id != null && id === placeShapingId;
}

/** Opens what a waiting Round is about: its Epic's or Milestone's shaping view, or its project's board. */
export function useOpenWaitingRound(): (round: WaitingRoundDto) => void {
  const openEpic = useUiStore((state) => state.openEpic);
  const openMilestone = useUiStore((state) => state.openMilestone);
  const openProject = useUiStore((state) => state.setCurrentProjectId);
  return (round) => {
    if (round.subject === "milestone" && round.milestoneId) openMilestone(round.projectId, round.milestoneId);
    else if (round.subject === "roadmap" || round.epicId === null) openProject(round.projectId);
    else openEpic(round.projectId, round.epicId);
  };
}
