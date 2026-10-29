/**
 * The controls a Story offers wherever it is shown: on its board row and in the Story view.
 *
 * The click model (issue #104, spec §7): the live agent opens only from a control labelled as the
 * session ("Open session", "Open feed", or "Answer" on a Story Waiting on you, which opens the feed at the
 * open request). Start and Resume start a session and stay where they are. Drop is the destructive text
 * button, set apart from the primary, and always confirms in ConfirmDestructive, as Stop does; Resume takes
 * its optional note in a Dialog (direction.md § Components).
 *
 * Feedback (DESIGN.md § Feedback, issue #204): every action that can be pending shows it on its own Button
 * (`loading`), and says what it did in a toast. A refusal from the core shows inline, where the action was.
 *
 * The One Filled Action Rule: Start, Make Ready and Resume are outline by default, as they sit on a roster row
 * beside other rows' actions; the Story view, where each is the title card's one next action, asks for them
 * filled (`variant="default"`).
 */
import { useState, type FormEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  MessageCircleQuestionMark,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  sessionSummariesForStory,
  sessionsForStory,
  storyContextPacketSize,
  storyDrop,
  storyMakeReady,
  storyResume,
  storyStart,
  storyStopped,
  stopSession,
  type EndingReason,
  type StoppedDto,
  type StoryDto,
} from "../adapters/tauri";
import { ConfirmDestructive } from "../components/ConfirmDestructive";
import { ReadError } from "../components/ReadError";
import { RelativeTime } from "../components/RelativeTime";
import { StateBadge } from "../components/StateBadge";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/Button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Label,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  useLoadingPhase,
} from "@highknow/design";
import { formatDuration, formatSessionName, formatTokens } from "@/lib/format";
import { notify } from "@/lib/notify";

/** The words for each Story state (GLOSSARY.md "Story state"). */
export const STORY_STATE_WORDS: Record<string, string> = {
  shaping: "Shaping",
  ready: "Ready",
  running: "Running",
  in_review: "In review",
  merged: "Merged",
  dropped: "Dropped",
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whether a click landed on a control of its own inside a row, which then owns the click. A click that
 * reached the row through a portal (a dialog the row opened) is never the row's either. */
export function isOwnControl(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target && !event.currentTarget.contains(target)) return true;
  const control = target?.closest("button, a, input, select, textarea, label, form, ol, ul, p, [role='group']");
  return Boolean(control && control !== event.currentTarget && event.currentTarget.contains(control));
}

/** Stopped is attention, worked out by the core from the Story's sessions: only a Running Story can be. */
export function useStopped(projectId: string, story: StoryDto): StoppedDto | null {
  const stoppedQuery = useQuery({
    queryKey: ["board", projectId, "stopped", story.id],
    queryFn: () => storyStopped(story.id),
    enabled: story.state === "running",
  });
  return story.state === "running" ? (stoppedQuery.data ?? null) : null;
}

/** The read of a Story's sessions, newest first, under the key `board:changed` keeps current. */
export function useStorySessions(projectId: string, storyId: string, enabled = true) {
  return useQuery({
    queryKey: ["board", projectId, "sessions", storyId],
    queryFn: () => sessionsForStory(storyId),
    enabled,
  });
}

/** The Story's live session, if one is running: the newest of its sessions with no end. Read under the
 * same key as the session list, so `board:changed` keeps both current. */
export function useLiveSession(projectId: string, story: StoryDto, enabled = true) {
  const sessionsQuery = useStorySessions(projectId, story.id, enabled && story.state === "running");
  if (story.state !== "running") return null;
  return (sessionsQuery.data ?? []).find((session) => session.endedAt === null) ?? null;
}

/** The Story's live session id: `known` when the caller already read it (the roster's one read, #159), so
 * nothing is read per row; otherwise read from the Story's sessions. */
export function useLiveSessionId(projectId: string, story: StoryDto, known?: string | null): string | null {
  const read = useLiveSession(projectId, story, known === undefined)?.id ?? null;
  return known === undefined ? read : known;
}

/** The one explicit way to the live agent (issue #104): a control labelled as the session. Renders
 * nothing while the Story has no live session. */
export function OpenSessionControl({
  projectId,
  story,
  sessionId,
  variant = "outline",
  className,
}: {
  projectId: string;
  story: StoryDto;
  /** The live session, when the caller already knows it (the roster); left out, it is read. */
  sessionId?: string | null;
  variant?: "outline" | "default";
  className?: string;
}) {
  const liveSessionId = useLiveSessionId(projectId, story, sessionId);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  if (!liveSessionId) return null;
  return (
    <Button
      variant={variant}
      size="sm"
      aria-label={`Open live session of ${story.key}`}
      onClick={() => setActiveSessionId(liveSessionId, story.id)}
      className={className}
    >
      <Terminal aria-hidden="true" />
      Open session
    </Button>
  );
}

/** Answer what a Story's live session waits on: opens the feed, which scrolls to the open request. */
export function AnswerControl({
  projectId,
  story,
  sessionId,
}: {
  projectId: string;
  story: StoryDto;
  /** The live session, when the caller already knows it (the roster); left out, it is read. */
  sessionId?: string | null;
}) {
  const liveSessionId = useLiveSessionId(projectId, story, sessionId);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  if (!liveSessionId) return null;
  return (
    <Button
      variant="attention"
      size="sm"
      aria-label={`Answer ${story.key}`}
      onClick={() => setActiveSessionId(liveSessionId, story.id, null, "blocked")}
    >
      <MessageCircleQuestionMark aria-hidden="true" />
      Answer
    </Button>
  );
}

/**
 * Stop a Story's live session (Story #118), from its agent station, confirmed in ConfirmDestructive. Stop
 * stays where it is: `board:changed` turns the Story Stopped and takes the station down, a toast says so, and
 * Resume starts a fresh session from the Context packet. If the sidecar could not confirm the process ended,
 * the dialog stays open and says so.
 */
export function StopControl({
  story,
  sessionId,
  onStrip = false,
}: {
  story: StoryDto;
  sessionId: string;
  /** Drawn on the graphite station: a light edge and light ink, never a card-coloured ground. */
  onStrip?: boolean;
}) {
  async function stop() {
    const result = await stopSession(sessionId);
    if (result.sidecarWarning) {
      throw new Error(`Flywheel could not confirm the agent process actually stopped: ${result.sidecarWarning}`);
    }
    notify.success(`Stopped ${story.key}'s agent`, {
      description: "Its worktree stays as the agent left it. Resume starts a fresh session.",
    });
  }

  return (
    <ConfirmDestructive
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={`Stop ${story.key}`}
          className={cn(
            onStrip &&
              "border-white/35 bg-transparent text-strip-foreground hover:border-strip-foreground hover:bg-white/10 focus-visible:outline-strip-foreground",
          )}
        >
          <Square aria-hidden="true" />
          Stop
        </Button>
      }
      title={`Stop ${story.key}'s agent?`}
      description="The session ends now. Its worktree stays exactly as the agent left it, and Resume starts a fresh session from the Context packet."
      cancelLabel="Keep running"
      confirmLabel="Stop the session"
      icon={<Square aria-hidden="true" />}
      onConfirm={stop}
    />
  );
}

/** Start a Ready Story. The session starts in the background: Start never opens it (issue #104). */
export function StartControl({
  story,
  onError,
  variant = "outline",
}: {
  story: StoryDto;
  onError: (message: string | null) => void;
  /** Filled where Start is the region's one next action (the Story view's title card). */
  variant?: "default" | "outline";
}) {
  const [starting, setStarting] = useState(false);

  function handleStart() {
    if (starting) return;
    setStarting(true);
    onError(null);
    storyStart(story.id)
      .then(() =>
        notify.success(`Started ${story.key}`, {
          description: "Its agent is reading the Story. Open session follows it.",
        }),
      )
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setStarting(false));
  }

  return (
    <Button variant={variant} size="sm" aria-label={`Start ${story.key}`} onClick={handleStart} loading={starting}>
      <Play aria-hidden="true" />
      Start
    </Button>
  );
}

/**
 * Make Ready (docs/mvp-spec.md §2, issue #166): moves a Shaping Story whose Epic's shaping is closed to Ready,
 * such as a New Story a running Story proposed. It is the Story's one next action, as Start is once it is
 * Ready. `refusal`, when the core holds it back (no criterion yet), disables it and is read as its
 * description. It keeps you where you are; the row turns Ready and offers Start.
 */
export function MakeReadyControl({
  story,
  refusal = null,
  onError,
  variant = "outline",
}: {
  story: StoryDto;
  refusal?: string | null;
  onError: (message: string | null) => void;
  /** Filled where Make Ready is the region's one next action (the Story view's title card). */
  variant?: "default" | "outline";
}) {
  const [making, setMaking] = useState(false);
  const refusalId = `make-ready-refusal-${story.id}`;

  function handleMakeReady() {
    if (making || refusal) return;
    setMaking(true);
    onError(null);
    storyMakeReady(story.id)
      .then(() => notify.success(`${story.key} is Ready`, { description: "Start sends an agent to it." }))
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setMaking(false));
  }

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        aria-label={`Make ${story.key} Ready`}
        aria-describedby={refusal ? refusalId : undefined}
        title={refusal ?? undefined}
        onClick={handleMakeReady}
        loading={making}
        disabled={Boolean(refusal)}
      >
        <CircleCheck aria-hidden="true" />
        Make Ready
      </Button>
      {refusal && (
        <span id={refusalId} className="sr-only">
          {refusal}
        </span>
      )}
    </>
  );
}

/** The words for each ending label (docs/mvp-spec.md §4.5); the core writes the same ones in a stub. */
const ENDING_WORDS: Record<EndingReason, string> = {
  refusal: "refusal",
  usage_limit: "usage limit",
  api_error: "API error",
  crash: "crash",
  app_quit: "app quit",
  stopped_by_developer: "stopped by you",
  ended_without_hand_off: "ended without hand-off",
  handed_off: "handed off",
  unknown: "unknown",
};

export function endingWords(reason: EndingReason | null): string {
  return reason ? (ENDING_WORDS[reason] ?? reason) : "unknown";
}

/**
 * How a session ended, as a StateBadge (issue #204): a hand-off completed; a crash, an API error or a refusal
 * failed (red: something went wrong that the Developer should look at); a usage limit holds; anything else was
 * an interruption. The word is sentence-cased, never the raw enum.
 */
export function endingBadge(reason: EndingReason | null): { state: string; label: string } {
  switch (reason) {
    case "handed_off":
      return { state: "completed", label: "Handed off" };
    case "crash":
      return { state: "failed", label: "Crashed" };
    case "api_error":
      return { state: "failed", label: "API error" };
    case "refusal":
      return { state: "failed", label: "Refused" };
    case "usage_limit":
      return { state: "held_by_limit", label: "Usage limit" };
    case "app_quit":
      return { state: "interrupted", label: "App quit" };
    case "stopped_by_developer":
      return { state: "interrupted", label: "Stopped by you" };
    case "ended_without_hand_off":
      return { state: "interrupted", label: "Ended without hand-off" };
    default:
      return { state: "interrupted", label: "Ending unknown" };
  }
}

/** An RFC 3339 timestamp as the session list shows it: `2026-10-19 10:00`. */
export function formatWhen(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

/** The state word, or the attention flag that replaces it. */
export function StoryStateWord({
  story,
  stopped,
  waitingOnYou,
  withReason = false,
  className,
}: {
  story: StoryDto;
  /** Set when the Story is Stopped: why its session ended. */
  stopped: Pick<StoppedDto, "endingReason"> | null;
  waitingOnYou: boolean;
  /** Print the ending reason in the pill ("Stopped: crash"), where nothing beside it says it. */
  withReason?: boolean;
  className?: string;
}) {
  // A Stopped Story has no live session, so it is never Waiting on you (the core agrees).
  if (stopped) {
    return (
      <StateBadge
        state="stopped"
        label={withReason ? `Stopped: ${endingWords(stopped.endingReason)}` : "Stopped"}
        className={className}
      />
    );
  }
  // The attention flag replaces the state word and outranks every other status.
  if (waitingOnYou) return <StateBadge state="waiting_on_you" className={className} />;
  return <StateBadge state={story.state} label={STORY_STATE_WORDS[story.state]} className={className} />;
}

/**
 * Resume a Stopped Story (docs/mvp-spec.md §4.5): always the developer's click, with an optional
 * one-line note, asked in a dialog. The core starts a fresh session in the same worktree from the Context
 * packet. Like Start, Resume stays where it is: the new session opens only from its own control.
 */
export function ResumeControl({
  story,
  variant = "outline",
}: {
  story: Pick<StoryDto, "id" | "key">;
  /** Filled where Resume is the region's one filled primary (the Story view, the first Needs-you card). */
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const trimmed = note.trim();
    storyResume(story.id, trimmed === "" ? undefined : trimmed)
      .then(() => {
        setOpen(false);
        setNote("");
        notify.success(`Resumed ${story.key}`, { description: "A fresh session started from the Context packet." });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        aria-label={`Resume ${story.key}`}
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <RotateCcw aria-hidden="true" />
        Resume
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="text-section font-semibold">{`Resume ${story.key}`}</DialogTitle>
              <DialogDescription>
                A fresh session starts in the Story&apos;s worktree from its Context packet. You stay where you are.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={`resume-note-${story.id}`}>Resume note (optional, one line)</Label>
              <Input
                id={`resume-note-${story.id}`}
                aria-label={`Resume note for ${story.key}`}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, " "))}
                placeholder="What the next session should know first"
                autoFocus
              />
            </div>
            {error && (
              <p role="alert" className="m-0 text-small text-destructive-text">
                {error}
              </p>
            )}
            <DialogFooter className="-mx-4 -mb-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" aria-label={`Start the new session for ${story.key}`} loading={busy}>
                <RotateCcw aria-hidden="true" />
                Start the new session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Drop (docs/mvp-spec.md §2): the developer ends the Story on purpose. Confirmed in ConfirmDestructive,
 * because it removes the worktree and branch with any uncommitted work. The core refuses while a session
 * is live; its reason is shown as is, in the dialog. `board:changed` refreshes the Story; a toast says so.
 */
export function DropControl({ story }: { story: StoryDto }) {
  async function drop() {
    await storyDrop(story.id);
    notify.success(`Dropped ${story.key}`, {
      description: "Its worktree and branch are gone; the record stays readable.",
    });
  }

  return (
    <ConfirmDestructive
      trigger={
        <Button variant="destructive" size="sm" aria-label={`Drop ${story.key}`}>
          <Trash2 aria-hidden="true" />
          Drop…
        </Button>
      }
      title={`Drop ${story.key}?`}
      description="This removes its worktree and branch, uncommitted work included. The Story's record stays readable."
      cancelLabel="Keep"
      confirmLabel="Drop the Story"
      icon={<Trash2 aria-hidden="true" />}
      onConfirm={drop}
    />
  );
}

/** How long a session ran, as a clock reading, or since it started while it is live. */
function sessionDuration(startedAt: string, endedAt: string | null, now: number): string {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  return formatDuration(Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 1000);
}

/**
 * The Story's sessions, newest first (docs/mvp-spec.md §4.5): each as an Item, named by its ordinal, with
 * how it ended as a StateBadge, when it started and how long it ran, and the summary it left. Each opens its
 * feed, which stays readable after the session dies. A failed read says so; the empty state shows only once
 * the read succeeded with nothing in it.
 */
export function SessionList({ projectId, story }: { projectId: string; story: StoryDto }) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const sessionsQuery = useStorySessions(projectId, story.id);
  const summariesQuery = useQuery({
    queryKey: ["board", projectId, "session-summaries", story.id],
    queryFn: () => sessionSummariesForStory(story.id),
  });
  const now = Date.now();
  // The loading rule (DESIGN.md § Feedback): nothing for 150 ms, then the skeleton, held at least 350 ms.
  const loadingPhase = useLoadingPhase(sessionsQuery.isPending);

  if (loadingPhase === "skeleton") return <ListSkeleton rows={2} label="Loading the sessions" />;
  if (sessionsQuery.isError) return <ReadError title="Couldn't load the sessions" query={sessionsQuery} />;
  if (sessionsQuery.isPending) return null;
  const sessions = sessionsQuery.data;
  if (sessions.length === 0) {
    return (
      <Empty className="p-4">
        <EmptyHeader>
          <EmptyTitle className="text-body font-semibold">No sessions yet</EmptyTitle>
          <EmptyDescription className="text-small">
            Each session an agent runs on this Story is listed here, with the summary it leaves.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const summaries = summariesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {summariesQuery.isError && <ReadError title="Couldn't load the session summaries" query={summariesQuery} />}
      <ItemGroup aria-label={`Sessions of ${story.key}`} role="list" className="gap-0">
        {sessions.map((session, index) => {
          // Summaries arrive oldest first; a session's latest one is the one it left.
          const summary = summaries.filter((s) => s.sessionId === session.id).pop();
          const live = !session.endedAt;
          const ending = live ? { state: "running", label: "Live" } : endingBadge(session.endingReason);
          return (
            <Item
              key={session.id}
              role="listitem"
              size="sm"
              className={cn("items-start rounded-none px-0", index > 0 && "border-t-border")}
            >
              <ItemContent className="min-w-0 gap-1">
                <ItemTitle className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-body font-semibold">
                  {formatSessionName(sessions.length - index)}
                  <StateBadge state={ending.state} label={ending.label} className="h-5.5 text-meta" />
                </ItemTitle>
                <ItemDescription className="m-0 flex flex-wrap items-center gap-x-1.5 text-meta text-muted-foreground tabular-nums">
                  <span>Started</span>
                  <RelativeTime at={session.startedAt} now={now} />
                  <span aria-hidden="true">·</span>
                  <span>{`${live ? "running" : "ran"} ${sessionDuration(session.startedAt, session.endedAt, now)}`}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-subtle-foreground">{session.id}</span>
                </ItemDescription>
                {summary && (
                  <div className="mt-1 flex flex-col gap-0.5 text-small text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {summary.isStub ? "Summary written by Flywheel (the agent left none)" : "Summary"}
                    </span>
                    <span className="whitespace-pre-wrap">{summary.nextSessionMustKnow}</span>
                    {summary.decisions.trim() !== "" && (
                      <span className="whitespace-pre-wrap">{`Decisions: ${summary.decisions}`}</span>
                    )}
                  </div>
                )}
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Open feed of session ${session.id}`}
                  onClick={() => setActiveSessionId(session.id, story.id)}
                >
                  <Terminal aria-hidden="true" />
                  Open feed
                </Button>
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </div>
  );
}

/** A list region still loading its first data: bars in the shape of its rows (DESIGN.md § Feedback). */
export function ListSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2.5 py-1">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={cn("h-4", index % 2 === 0 ? "w-3/4" : "w-1/2")} />
      ))}
    </div>
  );
}

/**
 * The size of the Context packet the Story's next session starts from, with a soft warning above
 * about 20K tokens: an icon and the words, and a Tooltip saying what to do. Keyed under the project so
 * `board:changed` keeps it current.
 */
export function PacketSize({ story, className }: { story: StoryDto; className?: string }) {
  const sizeQuery = useQuery({
    queryKey: ["board", story.projectId, "packet-size", story.id],
    queryFn: () => storyContextPacketSize(story.id),
  });
  if (!sizeQuery.data) return null;
  const { approxTokens, overSoftLimit } = sizeQuery.data;
  const text = `Context packet ~${formatTokens(approxTokens)} tokens`;
  if (!overSoftLimit) {
    return <span className={cn("text-subtle-foreground tabular-nums", className)}>{text}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm font-semibold text-foreground tabular-nums",
            className,
          )}
        >
          <TriangleAlert aria-hidden="true" size={16} />
          {`${text}, above the ~20K soft limit`}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Trim the Epic spec or the session summaries: every session starts by reading all of it.
      </TooltipContent>
    </Tooltip>
  );
}
