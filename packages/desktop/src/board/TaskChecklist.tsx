/**
 * A Story's Task checklist (docs/mvp-spec.md §4.3, issue #52). The Story's agent writes and ticks
 * it through its board tool; here the developer sees it, with the *doing* Task on the Story's own
 * row, and can add, edit, reorder or drop Tasks at any time. Every control is a core write: the
 * list re-reads on `board:changed` and never trusts its own edit. Nothing here infers a Task's
 * state from a diff or a transcript.
 *
 * Each Task carries a note (issue #96): what the agent has learned on it, so a stopped session
 * leaves that behind. The note is a Collapsible, closed by default, and the developer can edit it.
 *
 * Controls on demand (issue #204): a row is its state icon (the word is its accessible name and tooltip), its
 * title, its Note disclosure when it has a note, and one ⋯ menu (Rename, Move up, Move down, Drop…) that shows
 * on the row's hover and while focus is inside it. Drop asks its one-line reason in a Popover beside the menu.
 * A new Task is typed into one Input Group with its Add button inside.
 */
import { StateBadge } from "../components/StateBadge";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, CircleSlash, Ellipsis, NotebookText, Pencil, Plus } from "lucide-react";
import { taskAdd, taskList, taskMove, taskRename, taskSetNote, taskSetState, type TaskDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
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

/** A row control shown on demand: on the row's hover, while focus is in the row, while open, and always on a
 * screen without hover. */
const ON_DEMAND =
  "opacity-0 transition-opacity group-hover/task:opacity-100 group-focus-within/task:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * The checklist of a Story whose Tasks were read. The caller draws the read's pending and failed states, so an
 * empty list here always means the Story has no Task yet.
 */
export function TaskChecklist({ storyKey, storyId, tasks }: { storyKey: string; storyId: string; tasks: TaskDto[] }) {
  const [error, setError] = useState<string | null>(null);

  function run(write: Promise<unknown>) {
    setError(null);
    write.catch((err: unknown) => setError(errorText(err)));
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.length === 0 && (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyTitle className="text-body font-semibold">No Tasks yet</EmptyTitle>
            <EmptyDescription className="text-small">
              The Story&apos;s agent writes its plan here once it has read the code and docs the Story touches.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ol aria-label={`${storyKey} Tasks`} className="m-0 list-none p-0 empty:hidden">
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
  const droppingNext = useRef(false);
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
    <Collapsible
      asChild
      open={noteOpen}
      onOpenChange={setNoteOpen}
    >
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
                "min-w-0 flex-1 text-body break-words",
                doing && "font-semibold",
                (dropped || task.state === "done") && "text-muted-foreground",
                dropped && "line-through",
              )}
            >
              {task.title}
            </span>
          )}
          {!editing && (
            <span className="-my-0.5 flex shrink-0 items-center gap-0.5">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`${noteOpen ? "Hide" : "Show"} note of ${task.title}`}
                  className={cn(task.note ? "text-muted-foreground" : cn("text-subtle-foreground", ON_DEMAND))}
                >
                  <NotebookText aria-hidden="true" />
                  {task.note ? "Note" : <span className="sr-only">No note</span>}
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("transition-transform duration-(--duration-state)", noteOpen && "rotate-90")}
                  />
                </Button>
              </CollapsibleTrigger>
              <Popover open={dropping} onOpenChange={setDropping}>
                <DropdownMenu modal={false}>
                  <PopoverAnchor asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Actions for ${task.title}`}
                        className={cn("text-subtle-foreground hover:text-foreground", ON_DEMAND, dropping && "opacity-100")}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                  </PopoverAnchor>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-44"
                    // Drop… hands the focus to its Popover; every other item gives it back to the menu button.
                    onCloseAutoFocus={(event) => {
                      if (droppingNext.current) event.preventDefault();
                      droppingNext.current = false;
                    }}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        setTitle(task.title);
                        setEditing(true);
                      }}
                    >
                      <Pencil aria-hidden="true" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!onMoveUp} onSelect={() => onMoveUp?.()}>
                      <ArrowUp aria-hidden="true" />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!onMoveDown} onSelect={() => onMoveDown?.()}>
                      <ArrowDown aria-hidden="true" />
                      Move down
                    </DropdownMenuItem>
                    {!dropped && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => {
                            droppingNext.current = true;
                            setDropping(true);
                          }}>
                          <CircleSlash aria-hidden="true" />
                          Drop…
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <PopoverContent align="end" className="w-80 p-3" aria-label={`Drop ${task.title}`}>
                  <form onSubmit={confirmDrop} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1.5 text-small font-semibold" htmlFor={`drop-reason-${task.id}`}>
                      Why drop this Task?
                      <Input
                        id={`drop-reason-${task.id}`}
                        aria-label={`Reason for dropping ${task.title}`}
                        placeholder="One line: the agent reads it in the next Context packet"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="h-7.5 font-normal"
                        autoFocus
                      />
                    </label>
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDropping(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" variant="outline" disabled={reason.trim() === ""}>
                        <CircleSlash aria-hidden="true" />
                        Drop Task
                      </Button>
                    </div>
                  </form>
                </PopoverContent>
              </Popover>
            </span>
          )}
        </div>
        {dropped && task.droppedReason && (
          <p className="m-0 pl-7 text-small text-muted-foreground">Dropped: {task.droppedReason}</p>
        )}
        <CollapsibleContent aria-label={`Note of ${task.title}`} role="region">
          <div className="ml-7 rounded-md border border-border bg-muted px-3 py-2">
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
        </CollapsibleContent>
      </li>
    </Collapsible>
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
    <form onSubmit={handleSubmit} className="pt-1">
      {/* The empty field holds Add back without greying the whole group: only the button reads as disabled. */}
      <InputGroup className="h-8.5 bg-card has-disabled:bg-card has-disabled:opacity-100">
        <InputGroupInput
          aria-label={`New Task for ${storyKey}`}
          placeholder="Add a Task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" disabled={title.trim() === ""} aria-label="Add Task">
            <Plus aria-hidden="true" />
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
