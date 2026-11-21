/**
 * A note to the agent (docs/mvp-spec.md §4.7, docs/adr/0044): the developer types a line to the agent of a
 * running Story, and the board says where it is: "Sent" until the agent has it, then "Delivered".
 *
 * The note reaches the agent at its next turn boundary, after the tool call it is making, never during
 * one. So the card says "Waits for the agent's next step" while a note is Sent. A note whose session ends
 * first is "Not delivered", and the card says so in words: the session ended before the agent took it, and
 * the next session does not receive it. The text stays on the card, so the developer can use it again.
 *
 * Only a Story with a live session shows the field. The notes stay on the Story after the session ends.
 */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { sessionNoteSend, storyNotes, type NoteDto } from "../adapters/tauri";
import { Button } from "@/components/Button";
import { RelativeTime } from "../components/RelativeTime";
import { errorText } from "./StoryControls";
import { Label, Textarea } from "@highknow/design";

const NOTE_MAX = 1000;

/** The words for a note's state. */
export const NOTE_STATE_WORDS: Record<NoteDto["status"], string> = {
  sent: "Sent. Waits for the agent's next step.",
  delivered: "Delivered. The agent has it.",
  undelivered: "Not delivered. The session ended before the agent took it, and the next session does not receive it.",
};

export function noteQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "notes", storyId] as const;
}

export function NoteToAgent({
  projectId,
  storyId,
  storyKey,
  live,
}: {
  projectId: string;
  storyId: string;
  storyKey: string;
  /** The Story has a running or blocked session. */
  live: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = useQuery({
    queryKey: noteQueryKey(projectId, storyId),
    queryFn: () => storyNotes(storyId),
  });
  const list = notes.data ?? [];
  if (!live && list.length === 0) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (busy || body === "") return;
    setBusy(true);
    setError(null);
    sessionNoteSend(storyId, body)
      .then(() => setText(""))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => {
        setBusy(false);
        void notes.refetch();
      });
  }

  return (
    <section
      aria-labelledby={`note-heading-${storyId}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-card"
    >
      <h2 id={`note-heading-${storyId}`} className="m-0 flex items-center gap-2 text-section font-semibold">
        <MessageSquareText aria-hidden="true" size={18} />
        Note to the agent
      </h2>
      {live && (
        <form onSubmit={submit} className="grid gap-2">
          <Label htmlFor={`note-${storyId}`}>Tell the agent something. It reads it after its current step.</Label>
          <Textarea
            id={`note-${storyId}`}
            aria-label={`Note to the agent on ${storyKey}`}
            value={text}
            maxLength={NOTE_MAX}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: use the 2024 fixture, not the 2023 one"
          />
          {error && (
            <p role="alert" className="m-0 text-small text-destructive-text">
              {error}
            </p>
          )}
          <div>
            <Button
              type="submit"
              size="sm"
              aria-label={`Send note to ${storyKey}`}
              loading={busy}
              disabled={text.trim() === ""}
            >
              Send note
            </Button>
          </div>
        </form>
      )}
      {list.length > 0 && (
        <ul aria-label={`Notes on ${storyKey}`} className="m-0 grid list-none gap-2 p-0">
          {list.map((note) => (
            <li key={note.id} className="grid gap-0.5" data-note-status={note.status}>
              <span className="whitespace-pre-wrap text-body">{note.body}</span>
              <span className="text-small text-muted-foreground">
                {NOTE_STATE_WORDS[note.status]} <RelativeTime at={note.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
