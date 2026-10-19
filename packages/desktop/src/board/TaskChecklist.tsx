/**
 * A Story's Task checklist (docs/mvp-spec.md §4.3, issue #52). The Story's agent writes and ticks
 * it through its board tool; here the developer sees it, with the *doing* Task on the Story's own
 * row, and can add, edit, reorder or drop Tasks at any time. Every control is a core write: the
 * list re-reads on `board:changed` and never trusts its own edit. Nothing here infers a Task's
 * state from a diff or a transcript.
 */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { taskAdd, taskList, taskMove, taskRename, taskSetState, type TaskDto } from "../adapters/tauri";

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
    <span aria-label={`${storyKey} is doing`} className="type-body" style={{ color: "var(--text-muted-rack)" }}>
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
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          No Tasks yet. The Story&apos;s agent writes its plan here when its first session starts.
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
            onDrop={(reason) => run(taskSetState(task.id, "dropped", reason))}
          />
        ))}
      </ol>
      <AddTask storyKey={storyKey} onAdd={(title) => run(taskAdd(storyId, title))} />
      {error && (
        <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
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
  onDrop,
}: {
  task: TaskDto;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRename: (title: string) => void;
  onDrop: (reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState("");

  function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "") return;
    onRename(title.trim());
    setEditing(false);
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
        <span className="type-label" style={{ minWidth: "4.5em" }}>
          {TASK_STATE_WORDS[task.state] ?? task.state}
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
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Dropped: {task.droppedReason}
        </p>
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
