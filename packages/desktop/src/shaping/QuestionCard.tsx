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
 *
 * An ADR question (issue #129) is its own variant, `AdrQuestionCard`: the draft with its bar lines beside
 * it, answered Yes or No, and final once answered.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Ban, Check, CircleCheck, FileText, PenLine, ScrollText, Send, X } from "lucide-react";
import type { AdrDraftDto, RoundQuestionDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { OrderChip } from "./ProposalParts";
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
  return <OrderChip number={number} tone={answered ? "quiet" : "ink"} />;
}

export function QuestionCard(props: QuestionCardProps) {
  if (props.question.kind === "adr" && props.question.adr) return <AdrQuestionCard {...props} adr={props.question.adr} />;
  return <PlainQuestionCard {...props} />;
}

function PlainQuestionCard({ question: q, open, onAccept, onAnswer }: QuestionCardProps) {
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
            <Button type="submit" variant="outline" size="sm" loading={busy} disabled={!busy && !draft.trim()}>
              <Send aria-hidden="true" />
              Send answer
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
              disabled={!open}
              loading={busy}
              onClick={() => void run(() => onAccept(q.id))}
              aria-label={`Accept the recommended answer to question ${q.number}`}
            >
              <Check aria-hidden="true" />
              Accept
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

/** The four bar lines (docs/mvp-spec.md §6), in the order the spec gives them. */
const BAR_LINES: { key: keyof Pick<AdrDraftDto, "hardToReverse" | "surprising" | "losingAlternative" | "relatesTo">; label: string }[] = [
  { key: "hardToReverse", label: "Hard to reverse" },
  { key: "surprising", label: "Surprising" },
  { key: "losingAlternative", label: "Losing alternative" },
  { key: "relatesTo", label: "Relates to" },
];

/**
 * An ADR offered inside the Round (issue #129, docs/mvp-spec.md §3 "ADRs in shaping"): the question, its
 * grounding, then the draft as the Story would write it (its path in code face over its text, scrolling on
 * its own once long) with the four bar lines beside it, never part of the file. The recommendation is Yes or
 * No; the two answers are the two buttons, the recommended one outlined. "Yes" accepts the ADR onto the Epic
 * and "No" drops it, and either is final, so an answered ADR folds to a settled line with no Change.
 */
function AdrQuestionCard({ question: q, open, onAnswer, adr }: QuestionCardProps & { adr: AdrDraftDto }) {
  const draftId = useId();
  const questionId = useId();
  const [busy, setBusy] = useState<"Yes" | "No" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Answering unmounts both buttons and the folded line holds no control, so the focus moves to that line
  // rather than falling to the page.
  const folded = useRef<HTMLDivElement>(null);
  const [focusFolded, setFocusFolded] = useState(false);
  useEffect(() => {
    if (focusFolded && q.answer !== null) {
      folded.current?.focus();
      setFocusFolded(false);
    }
  }, [focusFolded, q.answer]);
  const label = `Question ${q.number}: ${q.title}`;
  const recommendsYes = q.recommendedAnswer.trim().toLowerCase().startsWith("yes");

  async function answer(word: "Yes" | "No") {
    if (busy) return;
    setBusy(word);
    setError(null);
    try {
      await onAnswer(q.id, word);
      setFocusFolded(true);
    } catch (err) {
      setError(`Could not save your answer: ${reason(err)}`);
    } finally {
      setBusy(null);
    }
  }

  if (q.answer !== null) {
    const yes = q.answer.trim().toLowerCase().startsWith("yes");
    return (
      <div
        ref={folded}
        tabIndex={-1}
        role="group"
        aria-label={label}
        data-answered="true"
        data-kind="adr"
        className="flex min-h-11 min-w-0 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <NumberChip number={q.number} answered />
        <span className="max-w-[40%] shrink-0 truncate text-body font-semibold" title={q.title}>
          {q.title}
        </span>
        {yes ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-body text-muted-foreground">
            <span className="shrink-0">Yes. Accepted on the Epic:</span>
            <span className="min-w-0 truncate font-mono text-small" title={adr.path}>
              <span className="sr-only">{adr.path.slice(0, adr.path.length - fileName(adr.path).length)}</span>
              {fileName(adr.path)}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">No. Not recorded: no ADR is written</span>
        )}
        <span className="shrink-0 text-meta text-subtle-foreground">
          {q.answeredWith === "own" ? "Your answer" : "Recommended"}
        </span>
      </div>
    );
  }

  const choice = (word: "Yes" | "No") => {
    const recommended = (word === "Yes") === recommendsYes;
    return (
      <Button
        variant={recommended ? "outline" : "ghost"}
        size="sm"
        disabled={!open || (busy !== null && busy !== word)}
        loading={busy === word}
        onClick={() => void answer(word)}
        aria-describedby={questionId}
      >
        {word === "Yes" ? <Check aria-hidden="true" /> : <Ban aria-hidden="true" />}
        {word === "Yes" ? "Yes, record it" : "No, don't record it"}
      </Button>
    );
  };

  return (
    <div
      role="group"
      aria-label={label}
      data-answered="false"
      data-kind="adr"
      className="@container flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 flex min-w-0 items-start gap-2 text-row font-semibold">
          <span className="mt-px flex">
            <NumberChip number={q.number} answered={false} />
          </span>
          <span id={questionId} className="min-w-0 break-words">
            {q.question}
          </span>
        </p>
        <p className="m-0 flex items-start gap-1.5 pl-7 text-small text-subtle-foreground">
          <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="sr-only">Grounding: </span>
          <span className="min-w-0 break-words">{q.grounding}</span>
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
        <figure aria-labelledby={draftId} className="m-0 flex min-w-0 flex-col self-start overflow-clip rounded-md border border-border bg-secondary">
          <figcaption className="flex min-h-9 min-w-0 items-start gap-1.5 border-b border-border px-3 py-1.5 text-meta text-muted-foreground">
            <ScrollText aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="shrink-0 font-semibold">ADR draft</span>
            <span id={draftId} className="min-w-0 font-mono break-all text-foreground">
              {adr.path}
            </span>
          </figcaption>
          {/* A long draft scrolls in place, so the bar lines and the answer stay in reach. */}
          <div
            role="region"
            tabIndex={0}
            aria-label={`The draft of ${adr.path}`}
            className="max-h-72 min-w-0 overflow-auto px-3 py-2.5 text-small whitespace-pre-wrap break-words text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {adr.text.trimEnd()}
          </div>
        </figure>
        <ul aria-label="Bar lines" className="m-0 flex min-w-0 list-none flex-col gap-2.5 p-0">
          {BAR_LINES.map(({ key, label: line }) => (
            <li key={key} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-meta font-semibold text-muted-foreground">{line}</span>
              <span className={cn("text-small break-words", adr[key] ? "text-foreground" : "text-subtle-foreground")}>
                {adr[key] ?? "None"}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="-mt-1.5 mb-0 text-meta text-subtle-foreground">The bar lines are shown beside the ADR, never written into it.</p>

      <div className="flex min-w-0 flex-col gap-1 rounded-md border border-primary bg-running-muted px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-meta font-semibold text-running">
          <Check aria-hidden="true" className="size-3.5" />
          Recommended
        </span>
        <p className="m-0 text-body font-semibold break-words text-foreground">
          {recommendsYes ? "Yes, record it" : "No, don't record it"}
        </p>
        <p className="m-0 text-small break-words text-muted-foreground">Because {lowerFirst(q.because)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {choice("Yes")}
        {choice("No")}
        <span className="text-small text-muted-foreground">
          Yes attaches it to the Epic, and the Epic's first Story writes the file. Either answer is final.
        </span>
      </div>
      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** An ADR's file name, the last segment of its path. */
function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/** "Because" reads as one sentence: the agent's reason keeps its words, its first letter lowered unless it
 * opens on an acronym or a name in code. */
function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/^because\s+/i, "");
  if (/^[A-Z]{2}|^[`"“]/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}
