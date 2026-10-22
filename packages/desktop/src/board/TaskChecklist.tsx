/**
 * A Story's Task checklist (docs/mvp-spec.md §4.3, issue #52). The Story's agent writes and ticks
 * it through its board tool; here the developer sees it, with the *doing* Task on the Story's own
 * row, and can add, edit, reorder or drop Tasks at any time. Every control is a core write: the
 * list re-reads on `board:changed` and never trusts its own edit. Nothing here infers a Task's
 * state from a diff or a transcript.
 *
 * Each Task carries a note (issue #96): what the agent has learned on it, so a stopped session
 * leaves that behind. The note is collapsed by default and the developer can edit it like the title.
 */
import { StateBadge } from "../components/StateBadge";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { taskAdd, taskList, taskMove, taskRename, taskSetNote, taskSetState, type TaskDto } from "../adapters/tauri";

/** The words for each Task state (GLOSSARY.md "Task"). */
const TASK_STATE_WORDS: Record<string, string> = {
  open: "Open",
  doing: "Doing",
  done: "Done",
  dropped: "Dropped",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The read of one Story's checklist, keyed under the project so `board:changed` keeps it live. */
export function useStoryTasks(projectId: string, storyId: string) {
  return useQuery({
    queryKey: ["board", projectId, "tasks", storyId],
    queryFn: () => taskList(storyId),
  });
}

/** The Story row's one-line "what its agent is doing now": the *doing* Task, when there is one. */
export function DoingTask({ tasks, storyKey }: { tasks: TaskDto[]; storyKey: string }) {
  const doing = tasks.find((t) => t.state === "doing");
  if (!doing) return null;
  return (
    <span aria-label={`${storyKey} is doing`} className="type-body" style={{ color: "var(--muted-foreground)" }}>
      Doing: {doing.title}
    </span>
  );
}

export function TaskChecklist({ storyKey, storyId, tasks }: { storyKey: string; storyId: string; tasks: TaskDto[] }) {
  const [error, setError] = useState<string | null>(null);

  function run(write: Promise<unknown>) {
    setError(null);
    write.catch((err: unknown) => setError(errorText(err)));
  }

  return (
    <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      {tasks.length === 0 && (
        <p className="type-body" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          No Tasks yet. The Story&apos;s agent writes its plan here once it has read the code and docs the Story touches.
        </p>
      )}
      <ol aria-label={`${storyKey} Tasks`} style={{ margin: 0, paddingLeft: "1.5em" }}>
        {tasks.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            // Up: just before the previous Task. Down: just before the one after the next, or the end.
            onMoveUp={index > 0 ? () => run(taskMove(task.id, tasks[index - 1].id)) : undefined}
            onMoveDown={
              index < tasks.length - 1 ? () => run(taskMove(task.id, tasks[index + 2]?.id ?? null)) : undefined
            }
            onRename={(title) => run(taskRename(task.id, title))}
            onSetNote={(note) => run(taskSetNote(task.id, note))}
            onDrop={(reason) => run(taskSetState(task.id, "dropped", reason))}
          />
        ))}
      </ol>
      <AddTask storyKey={storyKey} onAdd={(title) => run(taskAdd(storyId, title))} />
      {error && (
        <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onMoveUp,
  onMoveDown,
  onRename,
  onSetNote,
  onDrop,
}: {
  task: TaskDto;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRename: (title: string) => void;
  onSetNote: (note: string) => void;
  onDrop: (reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(task.note ?? "");

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "") return;
    onRename(title.trim());
    setEditing(false);
  }

  function saveNote(event: FormEvent) {
    event.preventDefault();
    onSetNote(note.trim());
    setEditingNote(false);
  }

  function confirmDrop(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === "") return;
    onDrop(reason.trim());
    setDropping(false);
    setReason("");
  }

  const dropped = task.state === "dropped";
  return (
    <li style={{ padding: "var(--space-xs) 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-sm)" }}>
        <span style={{ minWidth: "5.5em", display: "inline-flex" }}>
          <StateBadge state={task.state} variant="inline" label={TASK_STATE_WORDS[task.state]} />
        </span>
        {editing ? (
          <form onSubmit={saveTitle} style={{ display: "flex", gap: "var(--space-xs)", flex: 1, minWidth: "12em" }}>
            <input
              aria-label={`Title of ${task.title}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="control-edge session-field type-body"
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={title.trim() === ""} className="control-edge session-action type-body">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(task.title);
                setEditing(false);
              }}
              className="control-edge session-action type-body"
            >
              Cancel
            </button>
          </form>
        ) : (
          <span
            className="type-body"
            style={{ flex: 1, minWidth: 0, textDecoration: dropped ? "line-through" : undefined }}
          >
            {task.title}
          </span>
        )}
        {!editing && (
          <>
            <button
              type="button"
              aria-label={`Edit ${task.title}`}
              onClick={() => {
                setTitle(task.title);
                setEditing(true);
              }}
              className="control-edge session-action type-body"
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`${noteOpen ? "Hide" : "Show"} note of ${task.title}`}
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((open) => !open)}
              className="control-edge session-action type-body"
            >
              {task.note ? "Note" : "No note"}
            </button>
            <button
              type="button"
              aria-label={`Move ${task.title} up`}
              onClick={onMoveUp}
              disabled={!onMoveUp}
              className="control-edge session-action type-body"
            >
              Up
            </button>
            <button
              type="button"
              aria-label={`Move ${task.title} down`}
              onClick={onMoveDown}
              disabled={!onMoveDown}
              className="control-edge session-action type-body"
            >
              Down
            </button>
            {!dropped && (
              <button
                type="button"
                aria-label={`Drop ${task.title}`}
                onClick={() => setDropping((d) => !d)}
                className="control-edge session-action type-body"
              >
                Drop
              </button>
            )}
          </>
        )}
      </div>
      {dropped && task.droppedReason && (
        <p className="type-body" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          Dropped: {task.droppedReason}
        </p>
      )}
      {noteOpen && (
        <div aria-label={`Note of ${task.title}`} role="region" style={{ paddingLeft: "4.5em" }}>
          {editingNote ? (
            <form onSubmit={saveNote} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <textarea
                aria-label={`Note text of ${task.title}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={4000}
                className="control-edge session-field type-body"
              />
              <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                <button type="submit" className="control-edge session-action type-body">
                  Save note
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNote(task.note ?? "");
                    setEditingNote(false);
                  }}
                  className="control-edge session-action type-body"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "var(--space-sm)" }}>
              <p
                className="type-body"
                style={{
                  margin: 0,
                  flex: 1,
                  minWidth: "12em",
                  whiteSpace: "pre-wrap",
                  color: task.note ? undefined : "var(--muted-foreground)",
                }}
              >
                {task.note ?? "No note yet. The agent writes here what it learns on this Task."}
              </p>
              <button
                type="button"
                aria-label={`Edit note of ${task.title}`}
                onClick={() => {
                  setNote(task.note ?? "");
                  setEditingNote(true);
                }}
                className="control-edge session-action type-body"
              >
                Edit note
              </button>
            </div>
          )}
        </div>
      )}
      {dropping && (
        <form onSubmit={confirmDrop} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
          <input
            aria-label={`Reason for dropping ${task.title}`}
            placeholder="One line: why it is dropped"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="control-edge session-field type-body"
            style={{ flex: 1, minWidth: "12em" }}
          />
          <button type="submit" disabled={reason.trim() === ""} className="control-edge session-action type-body">
            Confirm drop
          </button>
        </form>
      )}
    </li>
  );
}

function AddTask({ storyKey, onAdd }: { storyKey: string; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "") return;
    onAdd(title.trim());
    setTitle("");
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
      <input
        aria-label={`New Task for ${storyKey}`}
        placeholder="Add a Task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="control-edge session-field type-body"
        style={{ flex: 1, minWidth: "12em" }}
      />
      <button type="submit" disabled={title.trim() === ""} className="control-edge session-action type-body">
        Add Task
      </button>
    </form>
  );
}
