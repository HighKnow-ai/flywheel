/**
 * The bare board for Milestone 2 (issue #50): a plain live list of the project's Stories with
 * their state and a Start control, and a form that writes a Milestone, an Epic and a Story with
 * its Acceptance criteria and optional Checks. Scaffolding: shaping replaces the form's role in
 * Milestone 3, and the board surface replaces the list.
 *
 * A Story is written only inside a chosen Epic (Create Story stays disabled without one, and the
 * core refuses it anyway), and criteria exist only as rows of the Story being written: there is no
 * control that makes a criterion on its own. Every read is keyed under the project so the one
 * `board:changed` subscription keeps the list live; the renderer never trusts its own write.
 */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  epicCreate,
  epicList,
  milestoneCreate,
  milestoneList,
  storyListForProject,
  storyStart,
  storyWriteByHand,
  type StoryDto,
} from "../adapters/tauri";
import { useBoardChangedSubscription } from "./useBoardQuery";
import "../session/session.css";

/** The words for each Story state (GLOSSARY.md "Story state"). */
const STORY_STATE_WORDS: Record<string, string> = {
  shaping: "Shaping",
  ready: "Ready",
  running: "Running",
  in_review: "In review",
  merged: "Merged",
  dropped: "Dropped",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface StoryBoardProps {
  projectId: string;
  projectName: string;
  /** Called with the new session's id and its Story once Start resolves. */
  onStarted: (sessionId: string, storyId: string) => void;
}

export function StoryBoard({ projectId, projectName, onStarted }: StoryBoardProps) {
  useBoardChangedSubscription(projectId);
  return (
    <div className="board-shell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        className="board-header type-heading"
        style={{ padding: "var(--space-md)", color: "var(--text-primary-rack)" }}
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
          color: "var(--text-primary-rack)",
        }}
      >
        <StoryList projectId={projectId} onStarted={onStarted} />
        <StoryForm projectId={projectId} />
      </div>
    </div>
  );
}

function StoryList({ projectId, onStarted }: { projectId: string; onStarted: StoryBoardProps["onStarted"] }) {
  const storiesQuery = useQuery({
    queryKey: ["board", projectId, "stories"],
    queryFn: () => storyListForProject(projectId),
  });
  const stories = storiesQuery.data ?? [];
  return (
    <section aria-labelledby="story-list-heading">
      <h2 id="story-list-heading" className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        Stories
      </h2>
      {storiesQuery.isError && (
        <p className="type-body" style={{ color: "var(--destructive-text-rack)" }}>
          {errorText(storiesQuery.error)}
        </p>
      )}
      {storiesQuery.isSuccess && stories.length === 0 && (
        <p className="type-body" style={{ color: "var(--text-muted-rack)" }}>
          No Stories yet. Write one below.
        </p>
      )}
      <ul aria-label="Stories" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {stories.map((story) => (
          <StoryRow key={story.id} story={story} onStarted={onStarted} />
        ))}
      </ul>
    </section>
  );
}

function StoryRow({ story, onStarted }: { story: StoryDto; onStarted: StoryBoardProps["onStarted"] }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStart() {
    if (starting) return;
    setStarting(true);
    setError(null);
    storyStart(story.id)
      .then((session) => onStarted(session.id, story.id))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setStarting(false));
  }

  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) 0",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span className="type-label" style={{ color: "var(--text-muted-rack)", minWidth: "5em" }}>
        {story.key}
      </span>
      <span className="type-body" style={{ flex: 1, minWidth: 0 }}>
        {story.title}
      </span>
      <span className="type-label">{STORY_STATE_WORDS[story.state] ?? story.state}</span>
      {story.state === "ready" && (
        <button
          type="button"
          aria-label={`Start ${story.key}`}
          onClick={handleStart}
          disabled={starting}
          className="control-edge session-action session-action-lead type-body"
        >
          {starting ? "Starting…" : "Start"}
        </button>
      )}
      {error && (
        <p className="type-body" style={{ flexBasis: "100%", margin: 0, color: "var(--destructive-text-rack)" }}>
          {error}
        </p>
      )}
    </li>
  );
}

interface CriterionDraft {
  statement: string;
  checkCommand: string;
}

const EMPTY_CRITERION: CriterionDraft = { statement: "", checkCommand: "" };

const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: "var(--space-xs)" };
const groupStyle = {
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-chrome)",
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
      <h2 id="story-form-heading" className="type-label" style={{ color: "var(--text-muted-rack)", margin: 0 }}>
        Write a Story
      </h2>
      {error && (
        <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
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
        <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
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
          <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
            A Story is written inside an Epic: choose one above.
          </p>
        )}
      </fieldset>
    </form>
  );
}
