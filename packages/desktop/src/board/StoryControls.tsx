/**
 * The controls a Story offers wherever it is shown: on its board row and in the Story view.
 *
 * The click model (issue #104, spec §7): the live agent opens only from a control labelled as the
 * session ("Open session", "Open feed", or "Answer" on a Story Waiting on you, which opens the feed at the
 * open request). Start and Resume start a session and stay where they are. Drop is the destructive text
 * button, set apart from the primary, and always confirms in an AlertDialog; Resume takes its optional
 * note in a Dialog (direction.md § Components).
 */
import { useState, type FormEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleQuestionMark, Play, RotateCcw, Square, Terminal, Trash2 } from "lucide-react";
import {
  sessionSummariesForStory,
  sessionsForStory,
  storyContextPacketSize,
  storyDrop,
  storyResume,
  storyStart,
  storyStopped,
  stopSession,
  type EndingReason,
  type StoppedDto,
  type StoryDto,
} from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { useUiStore } from "../state/uiStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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

/** The Story's live session, if one is running: the newest of its sessions with no end. Read under the
 * same key as the session list, so `board:changed` keeps both current. */
export function useLiveSession(projectId: string, story: StoryDto) {
  const sessionsQuery = useQuery({
    queryKey: ["board", projectId, "sessions", story.id],
    queryFn: () => sessionsForStory(story.id),
    enabled: story.state === "running",
  });
  if (story.state !== "running") return null;
  return (sessionsQuery.data ?? []).find((session) => session.endedAt === null) ?? null;
}

export function useLiveSessionId(projectId: string, story: StoryDto): string | null {
  return useLiveSession(projectId, story)?.id ?? null;
}

/** The one explicit way to the live agent (issue #104): a control labelled as the session. Renders
 * nothing while the Story has no live session. */
export function OpenSessionControl({
  projectId,
  story,
  variant = "outline",
  className,
}: {
  projectId: string;
  story: StoryDto;
  variant?: "outline" | "default";
  className?: string;
}) {
  const liveSessionId = useLiveSessionId(projectId, story);
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
export function AnswerControl({ projectId, story }: { projectId: string; story: StoryDto }) {
  const liveSessionId = useLiveSessionId(projectId, story);
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
 * Stop a Story's live session (Story #118), from its agent station. Confirmed in an AlertDialog, as
 * direction.md asks of Stop and Drop. Stop stays where it is: `board:changed` turns the Story Stopped
 * and takes the station down, and Resume starts a fresh session from the Context packet. If the sidecar
 * could not confirm the process ended, the dialog stays open and says so.
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function handleStop() {
    if (busy) return;
    setBusy(true);
    setError(null);
    stopSession(sessionId)
      .then((result) => {
        if (result.sidecarWarning) setWarning(result.sidecarWarning);
        else setOpen(false);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Stop ${story.key}`}
        onClick={() => {
          setError(null);
          setWarning(null);
          setOpen(true);
        }}
        className={cn(
          onStrip &&
            "border-white/35 bg-transparent text-strip-foreground hover:border-strip-foreground hover:bg-white/10 focus-visible:outline-strip-foreground",
        )}
      >
        <Square aria-hidden="true" />
        Stop
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">{`Stop ${story.key}'s agent?`}</AlertDialogTitle>
            <AlertDialogDescription>
              The session ends now. Its worktree stays exactly as the agent left it, and Resume starts a fresh
              session from the Context packet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {warning && (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2">
              <p className="m-0 text-small">Flywheel could not confirm the agent process actually stopped.</p>
              <p className="m-0 font-mono text-meta text-muted-foreground">{warning}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="m-0 text-small text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            {warning ? (
              <AlertDialogCancel>Close</AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel disabled={busy}>Keep running</AlertDialogCancel>
                <Button
                  variant="destructive"
                  aria-label={`Confirm stop of ${story.key}`}
                  onClick={handleStop}
                  disabled={busy}
                >
                  <Square aria-hidden="true" />
                  {busy ? "Stopping…" : "Stop the session"}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Start a Ready Story. The session starts in the background: Start never opens it (issue #104). */
export function StartControl({ story, onError }: { story: StoryDto; onError: (message: string | null) => void }) {
  const [starting, setStarting] = useState(false);

  function handleStart() {
    if (starting) return;
    setStarting(true);
    onError(null);
    storyStart(story.id)
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setStarting(false));
  }

  return (
    <Button size="sm" aria-label={`Start ${story.key}`} onClick={handleStart} disabled={starting}>
      <Play aria-hidden="true" />
      {starting ? "Starting…" : "Start"}
    </Button>
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
  stopped: StoppedDto | null;
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
export function ResumeControl({ story }: { story: StoryDto }) {
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
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <Button
        size="sm"
        aria-label={`Resume ${story.key}`}
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
              <Button type="submit" aria-label={`Start the new session for ${story.key}`} disabled={busy}>
                <RotateCcw aria-hidden="true" />
                {busy ? "Resuming…" : "Start the new session"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Drop (docs/mvp-spec.md §2): the developer ends the Story on purpose. Confirmed in an AlertDialog,
 * because it removes the worktree and branch with any uncommitted work. The core refuses while a session
 * is live; its reason is shown as is. `board:changed` refreshes the Story.
 */
export function DropControl({ story }: { story: StoryDto }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDrop() {
    if (busy) return;
    setBusy(true);
    setError(null);
    storyDrop(story.id)
      .then(() => setOpen(false))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        aria-label={`Drop ${story.key}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Drop…
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-section font-semibold">{`Drop ${story.key}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This removes its worktree and branch, uncommitted work included. The Story&apos;s record stays readable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="m-0 text-small text-destructive-text">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel aria-label={`Keep ${story.key}`} disabled={busy}>
              Keep
            </AlertDialogCancel>
            <Button
              variant="destructive"
              aria-label={`Confirm drop of ${story.key}`}
              onClick={handleDrop}
              disabled={busy}
            >
              <Trash2 aria-hidden="true" />
              {busy ? "Dropping…" : "Drop"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The Story's sessions, newest first (docs/mvp-spec.md §4.5): ID, start and end, ending reason and
 * summary. Each opens its feed, which stays readable after the session dies.
 */
export function SessionList({ projectId, story }: { projectId: string; story: StoryDto }) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const sessionsQuery = useQuery({
    queryKey: ["board", projectId, "sessions", story.id],
    queryFn: () => sessionsForStory(story.id),
  });
  const summariesQuery = useQuery({
    queryKey: ["board", projectId, "session-summaries", story.id],
    queryFn: () => sessionSummariesForStory(story.id),
  });
  const sessions = sessionsQuery.data ?? [];
  const summaries = summariesQuery.data ?? [];

  return (
    <div className="flex flex-col">
      {sessionsQuery.isError && <p className="m-0 text-small text-destructive-text">{errorText(sessionsQuery.error)}</p>}
      {sessionsQuery.isSuccess && sessions.length === 0 && (
        <p className="m-0 text-body text-muted-foreground">No sessions yet.</p>
      )}
      <ul aria-label={`Sessions of ${story.key}`} className="m-0 flex list-none flex-col p-0">
        {sessions.map((session, index) => {
          // Summaries arrive oldest first; a session's latest one is the one it left.
          const summary = summaries.filter((s) => s.sessionId === session.id).pop();
          const live = !session.endedAt;
          return (
            <li key={session.id} className={cn("flex flex-col gap-1.5 py-3", index > 0 && "border-t border-border")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* A handed-off session ended as planned; any other ending is an interruption. */}
                <StateBadge
                  state={live ? "running" : session.endingReason === "handed_off" ? "completed" : "interrupted"}
                  variant="inline"
                  label={live ? "live" : endingWords(session.endingReason)}
                />
                <span className="font-mono text-meta text-muted-foreground">{session.id}</span>
                <span className="text-meta text-subtle-foreground tabular-nums">
                  {session.endedAt
                    ? `${formatWhen(session.startedAt)} to ${formatWhen(session.endedAt)}`
                    : `since ${formatWhen(session.startedAt)}`}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  aria-label={`Open feed of session ${session.id}`}
                  onClick={() => setActiveSessionId(session.id, story.id)}
                  className="ml-auto"
                >
                  <Terminal aria-hidden="true" />
                  Open feed
                </Button>
              </div>
              {summary && (
                <div className="text-small whitespace-pre-wrap text-muted-foreground">
                  <span className="font-semibold text-foreground">{summary.isStub ? "Stub summary" : "Summary"}</span>
                  {`\n${summary.nextSessionMustKnow}`}
                  {summary.decisions.trim() !== "" && `\nDecisions: ${summary.decisions}`}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A token count as the Story shows it: thousands as `12.3K`. */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

/**
 * The size of the Context packet the Story's next session starts from, with a soft warning above
 * about 20K tokens. Keyed under the project so `board:changed` keeps it current.
 */
export function PacketSize({ story, className }: { story: StoryDto; className?: string }) {
  const sizeQuery = useQuery({
    queryKey: ["board", story.projectId, "packet-size", story.id],
    queryFn: () => storyContextPacketSize(story.id),
  });
  if (!sizeQuery.data) return null;
  const { approxTokens, overSoftLimit } = sizeQuery.data;
  const text = `Context packet ~${formatTokens(approxTokens)} tokens`;
  return (
    <span
      title={overSoftLimit ? "Above the soft limit of about 20K tokens: trim the Epic spec or the summaries" : undefined}
      className={cn("tabular-nums", overSoftLimit ? "font-semibold text-foreground" : "text-subtle-foreground", className)}
    >
      {overSoftLimit ? `${text}, above the ~20K soft limit` : text}
    </span>
  );
}
