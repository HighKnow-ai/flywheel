/**
 * One numbered question of a Round (docs/mvp-spec.md §3 "The dock", issue #123).
 *
 * Open, it reads top to bottom as the decision it is: the number and title, the question, the grounding
 * line (what the agent read that raised it), then the agent's recommended answer already filled in, in the
 * running tint with its "because" line, so accepting it is one click on the answer the developer can read.
 * Two actions sit under it: Accept (the recommendation as it is) and Answer differently, which opens a field
 * that starts from the recommendation so a small correction is a small edit. Borrowed from the session's
 * `QuestionForm` (#100): the number chip, the legend's weight, the hint line under the send button.
 *
 * Answered, it folds to one line: a check, the number and title, then the answer and whose it was
 * ("Recommended" or "Your answer"). While the Round is still open the line offers Change, which reopens
 * the field on the answer given.
 */
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, CircleCheck, FileText, PenLine, Send, X } from "lucide-react";
import type { RoundQuestionDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/** The longest answer the core accepts (`round::MAX_ROUND_TEXT_LEN`). */
const MAX_ANSWER_LEN = 4000;

export interface QuestionCardProps {
  question: RoundQuestionDto;
  /** Whether the Round still takes answers. An answered Round's questions are settled. */
  open: boolean;
  /** Stores the recommended answer as it is. Resolves once it is stored. */
  onAccept: (questionId: string) => Promise<void>;
  /** Stores the developer's own words. Resolves once it is stored. */
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}

function reason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

function NumberChip({ number, answered }: { number: number; answered: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm text-meta font-semibold tabular-nums",
        answered ? "bg-secondary text-muted-foreground" : "bg-foreground text-card",
      )}
    >
      {number}
    </span>
  );
}

export function QuestionCard({ question: q, open, onAccept, onAnswer }: QuestionCardProps) {
  const fieldId = useId();
  const answered = q.answer !== null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await write();
      setEditing(false);
    } catch (err) {
      setError(`Could not save your answer: ${reason(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setDraft(q.answer ?? q.recommendedAnswer);
    setError(null);
    setEditing(true);
  }

  function submit(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void run(() => onAnswer(q.id, text));
  }

  const label = `Question ${q.number}: ${q.title}`;

  if (answered && !editing) {
    const own = q.answeredWith === "own";
    return (
      <div
        role="group"
        aria-label={label}
        data-answered="true"
        className="flex min-h-11 min-w-0 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
      >
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <NumberChip number={q.number} answered />
        <span className="max-w-[40%] shrink-0 truncate text-body font-semibold" title={q.title}>
          {q.title}
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-muted-foreground" title={q.answer ?? undefined}>
          {q.answer}
        </span>
        <span className="shrink-0 text-meta text-subtle-foreground">{own ? "Your answer" : "Recommended"}</span>
        {open && (
          <Button variant="ghost" size="xs" onClick={startEditing} aria-label={`Change the answer to question ${q.number}`}>
            <PenLine aria-hidden="true" />
            Change
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-answered={answered ? "true" : "false"}
      className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 flex min-w-0 items-start gap-2 text-row font-semibold">
          <span className="mt-px flex">
            <NumberChip number={q.number} answered={false} />
          </span>
          <span className="min-w-0 break-words">{q.question}</span>
        </p>
        <p className="m-0 flex items-start gap-1.5 pl-7 text-small text-subtle-foreground">
          <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="sr-only">Grounding: </span>
          <span className="min-w-0 break-words">{q.grounding}</span>
        </p>
      </div>

      {editing ? (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submit}>
          {/* The recommendation stays in sight while the developer writes their own. */}
          <p className="m-0 flex min-w-0 items-start gap-1.5 text-small">
            <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-running" />
            <span className="min-w-0 break-words">
              <span className="font-semibold text-running">Recommended: </span>
              {q.recommendedAnswer}
              <span className="text-muted-foreground"> · Because {lowerFirst(q.because)}</span>
            </span>
          </p>
          <label htmlFor={fieldId} className="sr-only">
            Your answer to question {q.number}
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            maxLength={MAX_ANSWER_LEN}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(e);
              }
            }}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={busy || !draft.trim()}>
              <Send aria-hidden="true" />
              {busy ? "Saving…" : "Send answer"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              <X aria-hidden="true" />
              Cancel
            </Button>
            <span className="text-small text-muted-foreground">
              {draft.trim() ? "Saved on the board as soon as you send it." : "Write your answer to send it."}
            </span>
            <Kbd className="ml-auto">⌘↩</Kbd>
          </div>
        </form>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1 rounded-md border border-primary bg-running-muted px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-meta font-semibold text-running">
              <Check aria-hidden="true" className="size-3.5" />
              Recommended
            </span>
            <p className="m-0 text-body font-semibold break-words text-foreground">{q.recommendedAnswer}</p>
            <p className="m-0 text-small break-words text-muted-foreground">Because {lowerFirst(q.because)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!open || busy}
              onClick={() => void run(() => onAccept(q.id))}
              aria-label={`Accept the recommended answer to question ${q.number}`}
            >
              <Check aria-hidden="true" />
              {busy ? "Saving…" : "Accept"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!open || busy}
              onClick={startEditing}
              aria-label={`Answer question ${q.number} differently`}
            >
              <PenLine aria-hidden="true" />
              Answer differently
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Because" reads as one sentence: the agent's reason keeps its words, its first letter lowered unless it
 * opens on an acronym or a name in code. */
function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/^because\s+/i, "");
  if (/^[A-Z]{2}|^[`"“]/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}
