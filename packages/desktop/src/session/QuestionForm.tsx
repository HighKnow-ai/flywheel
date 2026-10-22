/**
 * Answering an agent's question (issue #100, docs/mvp-spec.md §2 "Attention", §5 "Never a pause").
 *
 * Claude Code sends an `AskUserQuestion` call through the permission-prompt tool, and Flywheel holds
 * it as a question, not a permission request: this form is how the developer answers it, in the
 * session feed's question card and in the Needs-you entry. There is no Allow, no Deny and no rule.
 * Per question the developer picks one option (several when `multiSelect`) or types their own answer
 * under "Other". Sending reports `{ [question text]: [picked labels and/or typed text] }`; the core
 * checks it and builds the answers Claude Code reads.
 *
 * The form waits for as long as it takes: nothing here times out, and it is never dismissible.
 *
 * A half-typed answer is a draft kept in UI state under the request id (issue #104), not in the form:
 * the feed is virtualised, so the row holding this form unmounts when it scrolls out of view, and the
 * same request is answerable from the feed and from Waiting on you. Sending clears the draft.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import type { QuestionPrompt } from "./feedRows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUiStore, type QuestionDraft } from "../state/uiStore";

/** What the developer picked, keyed by each question's text. */
export type QuestionPicks = Record<string, string[]>;

export interface QuestionFormProps {
  questions: QuestionPrompt[];
  /** Resolves once the answer is stored and relayed; a rejection shows its reason and re-enables the form. */
  onSubmit: (picks: QuestionPicks) => Promise<void>;
  /** The request id the draft is kept under. Without one, the draft lives and dies with the form. */
  draftKey?: string;
}

type Choice = QuestionDraft;

const EMPTY: Choice = { labels: [], other: false, otherText: "" };

/** The values one question sends: the picked labels, then the typed text when "Other" is chosen. */
export function picksFor(choice: Choice): string[] {
  const typed = choice.other ? choice.otherText.trim() : "";
  return typed ? [...choice.labels, typed] : [...choice.labels];
}

function rejectionReason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** The form's choices: the stored draft when there is a key, local state otherwise. */
function useChoices(questions: QuestionPrompt[], draftKey: string | undefined) {
  const [local, setLocal] = useState<Choice[]>(() => questions.map(() => EMPTY));
  const stored = useUiStore((state) => (draftKey ? state.questionDrafts[draftKey] : undefined));
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);
  if (!draftKey) return [local, setLocal, () => {}] as const;
  const choices = stored ?? questions.map(() => EMPTY);
  const setChoices = (next: (prev: Choice[]) => Choice[]) => {
    const current = useUiStore.getState().questionDrafts[draftKey] ?? questions.map(() => EMPTY);
    setQuestionDraft(draftKey, next(current));
  };
  return [choices, setChoices, () => setQuestionDraft(draftKey, null)] as const;
}

export function QuestionForm({ questions, onSubmit, draftKey }: QuestionFormProps) {
  const formId = useId();
  const [choices, setChoices, clearDraft] = useChoices(questions, draftKey);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const complete = questions.every((_, i) => picksFor(choices[i] ?? EMPTY).length > 0);

  function update(index: number, next: (choice: Choice) => Choice) {
    setChoices((prev) => prev.map((c, i) => (i === index ? next(c) : c)));
  }

  function pickOption(index: number, label: string, multi: boolean) {
    update(index, (c) =>
      multi
        ? { ...c, labels: c.labels.includes(label) ? c.labels.filter((l) => l !== label) : [...c.labels, label] }
        : { ...c, labels: [label], other: false },
    );
  }

  function pickOther(index: number, multi: boolean) {
    update(index, (c) => (multi ? { ...c, other: !c.other } : { ...c, labels: [], other: true }));
  }

  function typeOther(index: number, text: string, multi: boolean) {
    // Typing is choosing: a single-choice question drops its picked option for the typed answer.
    update(index, (c) => (multi ? { ...c, other: true, otherText: text } : { labels: [], other: true, otherText: text }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current || !complete) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const picks: QuestionPicks = {};
    questions.forEach((q, i) => {
      picks[q.question] = picksFor(choices[i] ?? EMPTY);
    });
    try {
      await onSubmit(picks);
      // On success the card leaves once the pending set re-reads; the ref stays set until then.
      clearDraft();
    } catch (err) {
      sendingRef.current = false;
      setSending(false);
      setError(`Could not send your answer: ${rejectionReason(err)}`);
    }
  }

  const optionClass =
    "question-option flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 text-body transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent has-[input:checked]:border-primary has-[input:checked]:bg-running-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring";
  const inputClass = "mt-0.5 size-4 shrink-0 accent-(--primary) focus-visible:outline-none";

  return (
    <form className="question-form flex min-w-0 flex-col gap-4" onSubmit={(e) => void submit(e)} aria-label="Answer the agent's question">
      <div className={cn("grid min-w-0 gap-x-6 gap-y-5", questions.length > 1 && "lg:grid-cols-2")}>
        {questions.map((q, i) => {
          const multi = q.multiSelect === true;
          const choice = choices[i] ?? EMPTY;
          const name = `${formId}-q${i}`;
          return (
            <fieldset key={i} className="question-fieldset m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={sending}>
              <legend className="question-legend mb-2 flex w-full flex-col gap-1 p-0 break-words">
                <span className="flex items-center gap-2 text-meta font-semibold text-muted-foreground">
                  {questions.length > 1 && (
                    <span className="flex size-5 items-center justify-center rounded-sm bg-foreground text-meta text-card tabular-nums">
                      {i + 1}
                    </span>
                  )}
                  {q.header ?? "Question"}
                  {multi ? " · pick any" : ""}
                </span>
                <span className="text-body font-semibold">{q.question}</span>
              </legend>
              {q.options.map((option, j) => (
                <label key={j} className={optionClass}>
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={name}
                    checked={choice.labels.includes(option.label)}
                    onChange={() => pickOption(i, option.label, multi)}
                    className={inputClass}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{option.label}</span>
                    {option.description && <span className="text-small text-muted-foreground">{option.description}</span>}
                  </span>
                </label>
              ))}
              <div className={cn(optionClass, "flex-col items-stretch gap-2 hover:bg-transparent")}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={name}
                    checked={choice.other}
                    onChange={() => pickOther(i, multi)}
                    className={inputClass}
                  />
                  <span className="font-semibold">Other</span>
                </label>
                <Input
                  type="text"
                  aria-label={`Your own answer to: ${q.question}`}
                  placeholder="Type your own answer"
                  value={choice.otherText}
                  onChange={(e) => typeOther(i, e.target.value, multi)}
                  className="question-other h-8"
                />
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={sending || !complete}>
          <Send aria-hidden="true" />
          {sending ? "Sending…" : "Send answer"}
        </Button>
        <span className="text-small text-muted-foreground">
          {sending
            ? "Sending your answer to the agent."
            : !complete
              ? questions.length > 1
                ? "Answer every question to send."
                : "Pick an answer or type your own."
              : questions.length > 1
                ? "Every question is answered. You can still change them."
                : "Answered. You can still change it."}
        </span>
      </div>
      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </form>
  );
}
