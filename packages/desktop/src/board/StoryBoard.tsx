/**
 * The click model (issue #104): a Story row opens the Story (`StoryView.tsx`), anywhere on the row
 * that is not a control of its own, the key, the title and the *doing* Task included. The live agent
 * opens only from a control labelled as the session ("Open session", "Open feed"). Start and Resume
 * start a session and stay where they are: nothing here opens a session on its own.
 *
 * The bare board for Milestone 2 (issue #50): a plain live list of the project's Stories with
 * their state, a Start control, the *doing* Task and the Task checklist (issue #52), and a form that writes a Milestone, an Epic and a Story with
 * its Acceptance criteria and optional Checks. Scaffolding: shaping replaces the form's role in
 * Milestone 3, and the board surface replaces the list.
 *
 * A Story is written only inside a chosen Epic (Create Story stays disabled without one, and the
 * core refuses it anyway), and criteria exist only as rows of the Story being written: there is no
 * control that makes a criterion on its own. Every read is keyed under the project so the one
 * `board:changed` subscription keeps the list live; the renderer never trusts its own write.
 */
import { useState, type FormEvent, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  blockedSummary,
  epicCreate,
  epicList,
  milestoneCreate,
  milestoneList,
  sessionSummariesForStory,
  sessionsForStory,
  storyContextPacketSize,
  storyDrop,
  storyListForProject,
  storyResume,
  storyStart,
  storyStopped,
  storyWriteByHand,
  type EndingReason,
  type StoppedDto,
  type StoryDto,
} from "../adapters/tauri";
import { useBoardChangedSubscription } from "./useBoardQuery";
import { DoingTask, TaskChecklist, useStoryTasks } from "./TaskChecklist";
import { StateBadge } from "../components/StateBadge";
import { useUiStore } from "../state/uiStore";
import "../session/session.css";

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

export interface StoryBoardProps {
  projectId: string;
  projectName: string;
}

export function StoryBoard({ projectId, projectName }: StoryBoardProps) {
  useBoardChangedSubscription(projectId);
  return (
    <div className="board-shell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        className="board-header type-heading"
        style={{ padding: "var(--space-md)", color: "var(--foreground)" }}
      >
        {projectName}
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 var(--space-md) var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          color: "var(--foreground)",
        }}
      >
        <StoryList projectId={projectId} />
        <StoryForm projectId={projectId} />
      </div>
    </div>
  );
}

function StoryList({ projectId }: { projectId: string }) {
  const storiesQuery = useQuery({
    queryKey: ["board", projectId, "stories"],
    queryFn: () => storyListForProject(projectId),
  });
  const stories = storiesQuery.data ?? [];
  // Waiting on you (docs/mvp-spec.md §2 "Attention"): derived by the core from a live session's
  // pending request, never a stored state. Keyed under the project so `board:changed` keeps it live.
  const waitingQuery = useQuery({
    queryKey: ["board", projectId, "waiting-on-you"],
    queryFn: () => blockedSummary(projectId),
  });
  const waitingIds = new Set(waitingQuery.data?.blockedStoryIds ?? []);
  return (
    <section aria-labelledby="story-list-heading">
      <h2 id="story-list-heading" className="type-label" style={{ color: "var(--muted-foreground)" }}>
        Stories
      </h2>
      {storiesQuery.isError && (
        <p className="type-body" style={{ color: "var(--destructive-text)" }}>
          {errorText(storiesQuery.error)}
        </p>
      )}
      {storiesQuery.isSuccess && stories.length === 0 && (
        <p className="type-body" style={{ color: "var(--muted-foreground)" }}>
          No Stories yet. Write one below.
        </p>
      )}
      <ul aria-label="Stories" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {stories.map((story) => (
          <StoryRow
            key={story.id}
            projectId={projectId}
            story={story}
            waitingOnYou={waitingIds.has(story.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Whether a click landed on a control of its own inside a row, which then owns the click. */
export function isOwnControl(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
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

/** The Story's live session id, if one is running: the newest of its sessions with no end. Read under
 * the same key as the session list, so `board:changed` keeps both current. */
export function useLiveSessionId(projectId: string, story: StoryDto): string | null {
  const sessionsQuery = useQuery({
    queryKey: ["board", projectId, "sessions", story.id],
    queryFn: () => sessionsForStory(story.id),
    enabled: story.state === "running",
  });
  if (story.state !== "running") return null;
  return (sessionsQuery.data ?? []).find((session) => session.endedAt === null)?.id ?? null;
}

/** The one explicit way to the live agent (issue #104): a control labelled as the session. Renders
 * nothing while the Story has no live session. */
export function OpenSessionControl({ projectId, story }: { projectId: string; story: StoryDto }) {
  const liveSessionId = useLiveSessionId(projectId, story);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  if (!liveSessionId) return null;
  return (
    <button
      type="button"
      aria-label={`Open live session of ${story.key}`}
      onClick={() => setActiveSessionId(liveSessionId, story.id)}
      className="control-edge session-action type-body"
    >
      Open session
    </button>
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
    <button
      type="button"
      aria-label={`Start ${story.key}`}
      onClick={handleStart}
      disabled={starting}
      className="control-edge session-action session-action-lead type-body"
    >
      {starting ? "Starting…" : "Start"}
    </button>
  );
}

/** The state word, or the attention flag that replaces it. */
export function StoryStateWord({
  story,
  stopped,
  waitingOnYou,
}: {
  story: StoryDto;
  stopped: StoppedDto | null;
  waitingOnYou: boolean;
}) {
  // A Stopped Story has no live session, so it is never Waiting on you (the core agrees).
  if (stopped) return <StateBadge state="stopped" label={`Stopped: ${endingWords(stopped.endingReason)}`} />;
  // The attention flag replaces the state word and outranks every other status.
  if (waitingOnYou) return <StateBadge state="waiting_on_you" />;
  return <StateBadge state={story.state} label={STORY_STATE_WORDS[story.state]} />;
}

/** The control that opens a Story: its key and title, looking exactly as the text they were. */
const storyOpenStyle = {
  display: "inline-flex",
  gap: "var(--space-sm)",
  alignItems: "baseline",
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: "none",
  background: "none",
  color: "inherit",
  font: "inherit",
  textAlign: "left" as const,
  cursor: "pointer",
};

function StoryRow({
  projectId,
  story,
  waitingOnYou,
}: {
  projectId: string;
  story: StoryDto;
  /** A live session of this Story holds a Gated action or permission request. */
  waitingOnYou: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const tasks = useStoryTasks(projectId, story.id).data ?? [];
  const stopped = useStopped(projectId, story);
  const openStory = useUiStore((state) => state.openStory);

  return (
    <li
      data-story-id={story.id}
      // Anywhere on the row that is not a control of its own opens the Story: the doing Task and the
      // state word go there too. The key-and-title button is the same target for the keyboard.
      onClick={(event) => {
        if (!isOwnControl(event)) openStory(projectId, story.id);
      }}
      style={{
        cursor: "pointer",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        aria-label={`Open Story ${story.key} ${story.title}`}
        onClick={() => openStory(projectId, story.id)}
        style={storyOpenStyle}
      >
        <span className="type-label" style={{ color: "var(--muted-foreground)", minWidth: "5em" }}>
          {story.key}
        </span>
        <span className="type-body" style={{ flex: 1, minWidth: 0 }}>
          {story.title}
        </span>
      </button>
      <DoingTask tasks={tasks} storyKey={story.key} />
      {story.state !== "merged" && story.state !== "dropped" && <PacketSize story={story} />}
      <StoryStateWord story={story} stopped={stopped} waitingOnYou={waitingOnYou} />
      <OpenSessionControl projectId={projectId} story={story} />
      <button
        type="button"
        aria-label={`Tasks of ${story.key}`}
        aria-expanded={showTasks}
        onClick={() => setShowTasks((shown) => !shown)}
        className="control-edge session-action type-body"
      >
        {`Tasks (${tasks.filter((t) => t.state === "done").length}/${tasks.filter((t) => t.state !== "dropped").length})`}
      </button>
      {story.state !== "shaping" && story.state !== "ready" && (
        <button
          type="button"
          aria-label={`Sessions of ${story.key}`}
          aria-expanded={showSessions}
          onClick={() => setShowSessions((shown) => !shown)}
          className="control-edge session-action type-body"
        >
          Sessions
        </button>
      )}
      {stopped && <ResumeControl story={story} />}
      {story.state !== "merged" && story.state !== "dropped" && <DropControl story={story} />}
      {story.state === "ready" && <StartControl story={story} onError={setError} />}
      {error && (
        <p className="type-body" style={{ flexBasis: "100%", margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}
      {showTasks && <TaskChecklist storyKey={story.key} storyId={story.id} tasks={tasks} />}
      {showSessions && <SessionList projectId={projectId} story={story} />}
    </li>
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

/**
 * Resume a Stopped Story (docs/mvp-spec.md §4.5): always the developer's click, with an optional
 * one-line note. The core starts a fresh session in the same worktree from the Context packet. Like
 * Start, Resume stays where it is: the new session opens only from its own control (issue #104).
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

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Resume ${story.key}`}
        onClick={() => setOpen(true)}
        className="control-edge session-action session-action-lead type-body"
      >
        Resume
      </button>
    );
  }
  return (
    <form
      onSubmit={handleSubmit}
      style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "flex-end" }}
    >
      <label className="type-body" style={{ ...fieldStyle, flex: 1, minWidth: "14em" }}>
        Resume note (optional, one line)
        <input
          aria-label={`Resume note for ${story.key}`}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, " "))}
          placeholder="What the next session should know first"
          className="control-edge session-field type-body"
        />
      </label>
      <button
        type="submit"
        aria-label={`Start the new session for ${story.key}`}
        disabled={busy}
        className="control-edge session-action session-action-lead type-body"
      >
        {busy ? "Resuming…" : "Resume"}
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy} className="control-edge session-action type-body">
        Cancel
      </button>
      {error && (
        <p className="type-body" style={{ flexBasis: "100%", margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Drop (docs/mvp-spec.md §2): the developer ends the Story on purpose. Two steps, because it
 * removes the worktree and branch with any uncommitted work. The core refuses while a session is
 * live; its reason is shown as is. `board:changed` refreshes the row.
 */
export function DropControl({ story }: { story: StoryDto }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDrop() {
    if (busy) return;
    setBusy(true);
    setError(null);
    storyDrop(story.id)
      .then(() => setConfirming(false))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  if (!confirming) {
    return (
      <>
        <button
          type="button"
          aria-label={`Drop ${story.key}`}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="control-edge session-action type-body"
        >
          Drop
        </button>
        {error && (
          <p className="type-body" style={{ flexBasis: "100%", margin: 0, color: "var(--destructive-text)" }}>
            {error}
          </p>
        )}
      </>
    );
  }
  return (
    <div
      role="group"
      aria-label={`Drop ${story.key}?`}
      style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}
    >
      <span className="type-body" style={{ flex: 1, minWidth: "14em" }}>
        {`Drop ${story.key}? This removes its worktree and branch, uncommitted work included. The Story's record stays readable.`}
      </span>
      <button
        type="button"
        aria-label={`Confirm drop of ${story.key}`}
        onClick={handleDrop}
        disabled={busy}
        className="control-edge session-action type-body"
        style={{ color: "var(--destructive-text)" }}
      >
        {busy ? "Dropping…" : "Drop"}
      </button>
      <button
        type="button"
        aria-label={`Keep ${story.key}`}
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="control-edge session-action type-body"
      >
        Keep
      </button>
      {error && (
        <p className="type-body" style={{ flexBasis: "100%", margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}
    </div>
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
    <div style={{ flexBasis: "100%" }}>
      {sessionsQuery.isError && (
        <p className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
          {errorText(sessionsQuery.error)}
        </p>
      )}
      {sessionsQuery.isSuccess && sessions.length === 0 && (
        <p className="type-body" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          No sessions yet.
        </p>
      )}
      <ul aria-label={`Sessions of ${story.key}`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sessions.map((session) => {
          // Summaries arrive oldest first; a session's latest one is the one it left.
          const summary = summaries.filter((s) => s.sessionId === session.id).pop();
          return (
            <li
              key={session.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
                padding: "var(--space-xs) 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
                <span className="type-label" style={{ fontFamily: "var(--font-code)" }}>
                  {session.id}
                </span>
                <span className="type-label" style={{ color: "var(--muted-foreground)" }}>
                  {session.endedAt
                    ? `${formatWhen(session.startedAt)} to ${formatWhen(session.endedAt)}`
                    : `since ${formatWhen(session.startedAt)}`}
                </span>
                <span className="type-label">{session.endedAt ? endingWords(session.endingReason) : "live"}</span>
                <button
                  type="button"
                  aria-label={`Open feed of session ${session.id}`}
                  onClick={() => setActiveSessionId(session.id, story.id)}
                  className="control-edge session-action type-body"
                >
                  Open feed
                </button>
              </div>
              {summary && (
                <div className="type-body" style={{ whiteSpace: "pre-wrap", color: "var(--muted-foreground)" }}>
                  <span className="type-label">{summary.isStub ? "Stub summary" : "Summary"}</span>
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
export function PacketSize({ story }: { story: StoryDto }) {
  const sizeQuery = useQuery({
    queryKey: ["board", story.projectId, "packet-size", story.id],
    queryFn: () => storyContextPacketSize(story.id),
  });
  if (!sizeQuery.data) return null;
  const { approxTokens, overSoftLimit } = sizeQuery.data;
  const text = `Context packet ~${formatTokens(approxTokens)} tokens`;
  return (
    <span
      className="type-label"
      title={overSoftLimit ? "Above the soft limit of about 20K tokens: trim the Epic spec or the summaries" : undefined}
      style={{ color: overSoftLimit ? "var(--foreground)" : "var(--muted-foreground)" }}
    >
      {overSoftLimit ? `${text}, above the ~20K soft limit` : text}
    </span>
  );
}

interface CriterionDraft {
  statement: string;
  checkCommand: string;
}

const EMPTY_CRITERION: CriterionDraft = { statement: "", checkCommand: "" };

const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: "var(--space-xs)" };
const groupStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  padding: "var(--space-md)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-sm)",
  margin: 0,
};

function StoryForm({ projectId }: { projectId: string }) {
  const [milestoneId, setMilestoneId] = useState("");
  const [epicId, setEpicId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const milestonesQuery = useQuery({
    queryKey: ["board", projectId, "milestones"],
    queryFn: () => milestoneList(projectId),
  });
  const epicsQuery = useQuery({
    queryKey: ["epics", projectId, milestoneId],
    queryFn: () => epicList(milestoneId),
    enabled: milestoneId !== "",
  });

  return (
    <section aria-labelledby="story-form-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <h2 id="story-form-heading" className="type-label" style={{ color: "var(--muted-foreground)", margin: 0 }}>
        Write a Story
      </h2>
      {error && (
        <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}

      <fieldset style={groupStyle}>
        <legend className="type-label">Milestone</legend>
        <label className="type-body" style={fieldStyle}>
          Milestone
          <select
            value={milestoneId}
            onChange={(event) => {
              setMilestoneId(event.target.value);
              setEpicId("");
            }}
            className="control-edge session-field type-body"
          >
            <option value="">Choose a Milestone</option>
            {(milestonesQuery.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <NewMilestone
          projectId={projectId}
          onCreated={(id) => {
            setMilestoneId(id);
            setEpicId("");
          }}
          onError={setError}
        />
      </fieldset>

      <fieldset style={groupStyle}>
        <legend className="type-label">Epic</legend>
        <label className="type-body" style={fieldStyle}>
          Epic
          <select
            value={epicId}
            onChange={(event) => setEpicId(event.target.value)}
            disabled={milestoneId === ""}
            className="control-edge session-field type-body"
          >
            <option value="">{milestoneId === "" ? "Choose a Milestone first" : "Choose an Epic"}</option>
            {(epicsQuery.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.key} {e.title}
              </option>
            ))}
          </select>
        </label>
        <NewEpic milestoneId={milestoneId} onCreated={setEpicId} onError={setError} />
      </fieldset>

      <NewStory epicId={epicId} onError={setError} />
    </section>
  );
}

function NewMilestone({
  projectId,
  onCreated,
  onError,
}: {
  projectId: string;
  onCreated: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [exitTest, setExitTest] = useState("");
  const [busy, setBusy] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    setBusy(true);
    onError(null);
    milestoneCreate(projectId, title.trim(), exitTest.trim() === "" ? null : exitTest.trim())
      .then((m) => {
        setTitle("");
        setExitTest("");
        onCreated(m.id);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "flex-end" }}>
      <label className="type-body" style={{ ...fieldStyle, flex: 1, minWidth: "12em" }}>
        Milestone title
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="control-edge session-field type-body" />
      </label>
      <label className="type-body" style={{ ...fieldStyle, flex: 2, minWidth: "12em" }}>
        Exit test
        <input value={exitTest} onChange={(e) => setExitTest(e.target.value)} className="control-edge session-field type-body" />
      </label>
      <button type="submit" disabled={busy || title.trim() === ""} className="control-edge session-action type-body">
        Add Milestone
      </button>
    </form>
  );
}

function NewEpic({
  milestoneId,
  onCreated,
  onError,
}: {
  milestoneId: string;
  onCreated: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const canSubmit = !busy && milestoneId !== "" && title.trim() !== "";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    onError(null);
    epicCreate(milestoneId, title.trim())
      .then((e) => {
        setTitle("");
        onCreated(e.id);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "flex-end" }}>
      <label className="type-body" style={{ ...fieldStyle, flex: 1, minWidth: "12em" }}>
        Epic title
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="control-edge session-field type-body" />
      </label>
      <button type="submit" disabled={!canSubmit} className="control-edge session-action type-body">
        Add Epic
      </button>
    </form>
  );
}

function NewStory({ epicId, onError }: { epicId: string; onError: (message: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([EMPTY_CRITERION]);
  const [busy, setBusy] = useState(false);

  // Rows left wholly blank are dropped; a row with only a Check reaches the core, which refuses it.
  const written = criteria.filter((c) => c.statement.trim() !== "" || c.checkCommand.trim() !== "");
  const canSubmit = !busy && epicId !== "" && title.trim() !== "" && written.some((c) => c.statement.trim() !== "");

  function updateCriterion(index: number, patch: Partial<CriterionDraft>) {
    setCriteria((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    onError(null);
    storyWriteByHand(
      epicId,
      title.trim(),
      description.trim() === "" ? null : description.trim(),
      written.map((c) => ({
        statement: c.statement.trim(),
        checkCommand: c.checkCommand.trim() === "" ? null : c.checkCommand.trim(),
      })),
    )
      .then(() => {
        setTitle("");
        setDescription("");
        setCriteria([EMPTY_CRITERION]);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset style={groupStyle}>
        <legend className="type-label">Story</legend>
        <label className="type-body" style={fieldStyle}>
          Story title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="control-edge session-field type-body" />
        </label>
        <label className="type-body" style={fieldStyle}>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="control-edge session-field type-body"
          />
        </label>
        <div className="type-label" style={{ color: "var(--muted-foreground)" }}>
          Acceptance criteria
        </div>
        <ol style={{ margin: 0, paddingLeft: "1.5em", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {criteria.map((criterion, index) => (
            // Rows have no identity beyond their position until the Story is written.
            <li key={index} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "flex-end" }}>
              <label className="type-body" style={{ ...fieldStyle, flex: 2, minWidth: "14em" }}>
                {`Criterion ${index + 1}`}
                <input
                  value={criterion.statement}
                  onChange={(e) => updateCriterion(index, { statement: e.target.value })}
                  className="control-edge session-field type-body"
                />
              </label>
              <label className="type-body" style={{ ...fieldStyle, flex: 1, minWidth: "10em" }}>
                {`Check command ${index + 1}`}
                <input
                  value={criterion.checkCommand}
                  onChange={(e) => updateCriterion(index, { checkCommand: e.target.value })}
                  placeholder="optional"
                  className="control-edge session-field type-body"
                />
              </label>
              {criteria.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove criterion ${index + 1}`}
                  onClick={() => setCriteria((rows) => rows.filter((_, i) => i !== index))}
                  className="control-edge session-action type-body"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)" }}>
          <button
            type="button"
            onClick={() => setCriteria((rows) => [...rows, EMPTY_CRITERION])}
            className="control-edge session-action type-body"
          >
            Add criterion
          </button>
          <button type="submit" disabled={!canSubmit} className="control-edge session-action session-action-lead type-body">
            Create Story
          </button>
        </div>
        {epicId === "" && (
          <p className="type-body" style={{ margin: 0, color: "var(--muted-foreground)" }}>
            A Story is written inside an Epic: choose one above.
          </p>
        )}
      </fieldset>
    </form>
  );
}
