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
 */
import { useId, useRef, useState, type FormEvent } from "react";
import type { QuestionPrompt } from "./feedRows";
import "./session.css";

/** What the developer picked, keyed by each question's text. */
export type QuestionPicks = Record<string, string[]>;

export interface QuestionFormProps {
  questions: QuestionPrompt[];
  /** Resolves once the answer is stored and relayed; a rejection shows its reason and re-enables the form. */
  onSubmit: (picks: QuestionPicks) => Promise<void>;
}

interface Choice {
  labels: string[];
  other: boolean;
  otherText: string;
}

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

export function QuestionForm({ questions, onSubmit }: QuestionFormProps) {
  const formId = useId();
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => EMPTY));
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
    } catch (err) {
      sendingRef.current = false;
      setSending(false);
      setError(`Could not send your answer: ${rejectionReason(err)}`);
    }
  }

  return (
    <form className="question-form" onSubmit={(e) => void submit(e)} aria-label="Answer the agent's question">
      {questions.map((q, i) => {
        const multi = q.multiSelect === true;
        const choice = choices[i] ?? EMPTY;
        const name = `${formId}-q${i}`;
        return (
          <fieldset key={i} className="question-fieldset" disabled={sending}>
            <legend className="question-legend">
              {q.header && (
                <span className="type-label" style={{ color: "var(--text-muted-rack)", display: "block" }}>
                  {q.header}
                  {multi ? " · pick any" : ""}
                </span>
              )}
              <span className="type-body">{q.question}</span>
            </legend>
            {q.options.map((option, j) => (
              <label key={j} className="question-option type-body">
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={name}
                  checked={choice.labels.includes(option.label)}
                  onChange={() => pickOption(i, option.label, multi)}
                />
                <span>
                  <span style={{ fontWeight: 600 }}>{option.label}</span>
                  {option.description && (
                    <span style={{ color: "var(--text-muted-rack)" }}>{` — ${option.description}`}</span>
                  )}
                </span>
              </label>
            ))}
            <label className="question-option type-body">
              <input
                type={multi ? "checkbox" : "radio"}
                name={name}
                checked={choice.other}
                onChange={() => pickOther(i, multi)}
              />
              <span>Other</span>
            </label>
            <input
              type="text"
              aria-label={`Your own answer to: ${q.question}`}
              placeholder="Type your own answer"
              value={choice.otherText}
              onChange={(e) => typeOther(i, e.target.value, multi)}
              className="control-edge session-field question-other type-body"
            />
          </fieldset>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <button
          type="submit"
          disabled={sending || !complete}
          className="control-edge session-action session-action-lead type-body"
        >
          {sending ? "Sending…" : "Send answer"}
        </button>
        {!complete && !sending && (
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            {questions.length > 1 ? "Answer every question to send." : "Pick an answer or type your own."}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)", overflowWrap: "anywhere" }}>
          {error}
        </p>
      )}
    </form>
  );
}
