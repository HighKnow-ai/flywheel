/**
 * A Story's Task checklist (docs/mvp-spec.md §4.3, issue #52). The Story's agent writes and ticks
 * it through its board tool; here the developer sees it, with the *doing* Task on the Story's own
 * row, and can add, edit, reorder or drop Tasks at any time. Every control is a core write: the
 * list re-reads on `board:changed` and never trusts its own edit. Nothing here infers a Task's
 * state from a diff or a transcript.
 *
 * Each Task carries a note (issue #96): what the agent has learned on it, so a stopped session
 * leaves that behind. The note is collapsed by default and the developer can edit it like the title.
 *
 * A row is its state icon (the word is its accessible name and tooltip), its title, and its note. The
 * edit controls are quiet icon buttons, each with a tooltip and an accessible name; a Task with a note
 * says so in words.
 */
import { StateBadge } from "../components/StateBadge";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, CircleSlash, NotebookText, Pencil, Plus } from "lucide-react";
import { taskAdd, taskList, taskMove, taskRename, taskSetNote, taskSetState, type TaskDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

/** A quiet icon control: an icon, its tooltip, and its accessible name. */
function IconControl({
  label,
  tooltip,
  onClick,
  disabled,
  children,
  ...rest
}: {
  label: string;
  tooltip: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, "children" | "onClick">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className="text-subtle-foreground hover:text-foreground"
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function TaskChecklist({ storyKey, storyId, tasks }: { storyKey: string; storyId: string; tasks: TaskDto[] }) {
  const [error, setError] = useState<string | null>(null);

  function run(write: Promise<unknown>) {
    setError(null);
    write.catch((err: unknown) => setError(errorText(err)));
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.length === 0 && (
        <p className="m-0 text-body text-muted-foreground">
          No Tasks yet. The Story&apos;s agent writes its plan here once it has read the code and docs the Story touches.
        </p>
      )}
      <ol aria-label={`${storyKey} Tasks`} className="m-0 list-none p-0">
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
        <p role="alert" className="m-0 text-small text-destructive-text">
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
  const doing = task.state === "doing";
  return (
    <li className="group/task flex flex-col gap-1.5 border-t border-border py-2 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2.5">
        <StateBadge
          state={task.state}
          variant="inline"
          hideLabel
          label={TASK_STATE_WORDS[task.state]}
          className="mt-0.5 shrink-0"
        />
        {editing ? (
          <form onSubmit={saveTitle} className="flex min-w-0 flex-1 gap-1.5">
            <Input
              aria-label={`Title of ${task.title}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-7.5"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={title.trim() === ""}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTitle(task.title);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 text-body",
              doing && "font-semibold",
              (dropped || task.state === "done") && "text-muted-foreground",
              dropped && "line-through",
            )}
          >
            {task.title}
          </span>
        )}
        {!editing && (
          <span className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="xs"
              aria-label={`${noteOpen ? "Hide" : "Show"} note of ${task.title}`}
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((open) => !open)}
              className={cn(
                task.note ? "text-muted-foreground" : "text-subtle-foreground opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100",
              )}
            >
              <NotebookText aria-hidden="true" />
              {task.note ? "Note" : <span className="sr-only">No note</span>}
              <ChevronRight aria-hidden="true" className={cn("transition-transform duration-(--duration-state)", noteOpen && "rotate-90")} />
            </Button>
            <span className="flex opacity-0 transition-opacity duration-(--duration-state) group-hover/task:opacity-100 group-focus-within/task:opacity-100">
              <IconControl
                label={`Edit ${task.title}`}
                tooltip="Rename"
                onClick={() => {
                  setTitle(task.title);
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
              </IconControl>
              <IconControl label={`Move ${task.title} up`} tooltip="Move up" onClick={onMoveUp} disabled={!onMoveUp}>
                <ArrowUp aria-hidden="true" />
              </IconControl>
              <IconControl label={`Move ${task.title} down`} tooltip="Move down" onClick={onMoveDown} disabled={!onMoveDown}>
                <ArrowDown aria-hidden="true" />
              </IconControl>
              {!dropped && (
                <IconControl label={`Drop ${task.title}`} tooltip="Drop, with a reason" onClick={() => setDropping((d) => !d)}>
                  <CircleSlash aria-hidden="true" />
                </IconControl>
              )}
            </span>
          </span>
        )}
      </div>
      {dropped && task.droppedReason && (
        <p className="m-0 pl-7 text-small text-muted-foreground">Dropped: {task.droppedReason}</p>
      )}
      {noteOpen && (
        <div aria-label={`Note of ${task.title}`} role="region" className="ml-7 rounded-md border border-border bg-muted px-3 py-2">
          {editingNote ? (
            <form onSubmit={saveNote} className="flex flex-col gap-2">
              <Textarea
                aria-label={`Note text of ${task.title}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={4000}
                autoFocus
              />
              <div className="flex gap-1.5">
                <Button type="submit" size="sm">
                  Save note
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNote(task.note ?? "");
                    setEditingNote(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-start gap-2">
              <p className={cn("m-0 min-w-0 flex-1 text-small whitespace-pre-wrap", !task.note && "text-muted-foreground")}>
                {task.note ?? "No note yet. The agent writes here what it learns on this Task."}
              </p>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Edit note of ${task.title}`}
                onClick={() => {
                  setNote(task.note ?? "");
                  setEditingNote(true);
                }}
                className="text-muted-foreground"
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            </div>
          )}
        </div>
      )}
      {dropping && (
        <form onSubmit={confirmDrop} className="ml-7 flex flex-wrap gap-1.5">
          <Input
            aria-label={`Reason for dropping ${task.title}`}
            placeholder="One line: why it is dropped"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-7.5 min-w-48 flex-1"
            autoFocus
          />
          <Button type="submit" size="sm" variant="outline" disabled={reason.trim() === ""}>
            Confirm drop
          </Button>
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
    <form onSubmit={handleSubmit} className="flex gap-1.5 pt-1">
      <Input
        aria-label={`New Task for ${storyKey}`}
        placeholder="Add a Task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-7.5"
      />
      <Button type="submit" size="sm" variant="outline" disabled={title.trim() === ""} aria-label="Add Task">
        <Plus aria-hidden="true" />
        Add
      </Button>
    </form>
  );
}
