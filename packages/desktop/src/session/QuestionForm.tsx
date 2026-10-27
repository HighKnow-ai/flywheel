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
 * The choices are shadcn choice cards (Story #206): a single-choice question is a Radio Group, a `multiSelect` one a
 * set of Checkboxes, each control inside its Field label, so the arrow keys move a single choice and Space toggles a
 * multiple one. "Other" is one more choice card holding the free-text field; typing in it picks it.
 *
 * The form waits for as long as it takes: nothing here times out, and it is never dismissible.
 *
 * A half-typed answer is a draft kept in UI state under the request id (issue #104), not in the form:
 * the feed is virtualised, so the row holding this form unmounts when it scrolls out of view, and the
 * same request is answerable from the feed and from Waiting on you. Sending clears the draft.
 */
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import type { QuestionPrompt } from "./feedRows";
import { Button } from "@/components/Button";
import {
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  cn,
} from "@highknow/design";
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

/** The Radio Group value of "Other"; an option is its index, so a label never collides with it. */
const OTHER = "other";

function optionValue(options: QuestionPrompt["options"], label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const index = options.findIndex((o) => o.label === label);
  return index < 0 ? undefined : String(index);
}

/** One choice: the stock shadcn choice card, a Field label wrapping the control (Radio Group item or Checkbox), its
 * title and description. The whole card is the hit area; the control is named by the title alone and described by
 * the description, so a screen reader hears "Red, radio button, Warm". `extra` sits under the title ("Other"'s
 * free-text field), inside the card but never forwarding its clicks to the control. */
function ChoiceCard({
  id,
  title,
  description,
  extra,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FieldLabel
      htmlFor={id}
      className="cursor-pointer rounded-md transition-colors duration-(--duration-state) ease-(--ease)"
    >
      <Field orientation="horizontal" className="items-start">
        {children}
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle id={`${id}-title`} className="text-body font-semibold break-words">
            {title}
          </FieldTitle>
          {description && (
            <FieldDescription id={`${id}-desc`} className="text-small">
              {description}
            </FieldDescription>
          )}
          {extra && <div className="mt-1.5">{extra}</div>}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

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
    update(index, (c) =>
      multi ? { ...c, other: true, otherText: text } : { labels: [], other: true, otherText: text },
    );
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

  return (
    <form
      className="@container/question flex min-w-0 flex-col gap-4"
      onSubmit={(e) => void submit(e)}
      aria-label="Answer the agent's question"
    >
      {/* Two questions sit side by side when the card has the room, not when the window does: the same card is 400px
          in the Waiting-on-you column and the feed's width in the session. */}
      <div className={cn("grid min-w-0 gap-x-6 gap-y-5", questions.length > 1 && "@2xl/question:grid-cols-2")}>
        {questions.map((q, i) => {
          const multi = q.multiSelect === true;
          const choice = choices[i] ?? EMPTY;
          const ids = `${formId}-q${i}`;
          const otherInput = (
            <Input
              type="text"
              aria-label={`Your own answer to: ${q.question}`}
              placeholder="Type your own answer"
              value={choice.otherText}
              disabled={sending}
              onChange={(e) => typeOther(i, e.target.value, multi)}
              className="h-8"
            />
          );
          return (
            <FieldSet key={i} className="m-0 min-w-0 gap-2 border-0 p-0" disabled={sending}>
              <FieldLegend className="mb-2 flex w-full flex-col gap-1 p-0 break-words">
                <span className="flex items-center gap-2 text-meta font-semibold text-muted-foreground">
                  {questions.length > 1 && (
                    <span className="flex size-5 items-center justify-center rounded-sm bg-foreground text-meta text-card tabular-nums">
                      {i + 1}
                    </span>
                  )}
                  {q.header ?? "Question"}
                  {multi ? " · pick any" : ""}
                </span>
                <span id={`${ids}-text`} className="text-body font-semibold">
                  {q.question}
                </span>
              </FieldLegend>
              {multi ? (
                <div
                  role="group"
                  aria-labelledby={`${ids}-text`}
                  data-slot="checkbox-group"
                  className="flex flex-col gap-2"
                >
                  {q.options.map((option, j) => (
                    <ChoiceCard key={j} id={`${ids}-o${j}`} title={option.label} description={option.description}>
                      <Checkbox
                        id={`${ids}-o${j}`}
                        aria-labelledby={`${ids}-o${j}-title`}
                        aria-describedby={option.description ? `${ids}-o${j}-desc` : undefined}
                        checked={choice.labels.includes(option.label)}
                        onCheckedChange={() => pickOption(i, option.label, true)}
                        disabled={sending}
                      />
                    </ChoiceCard>
                  ))}
                  <ChoiceCard id={`${ids}-other`} title="Other" extra={otherInput}>
                    <Checkbox
                      id={`${ids}-other`}
                      aria-labelledby={`${ids}-other-title`}
                      checked={choice.other}
                      onCheckedChange={() => pickOther(i, true)}
                      disabled={sending}
                    />
                  </ChoiceCard>
                </div>
              ) : (
                <RadioGroup
                  aria-labelledby={`${ids}-text`}
                  value={choice.other ? OTHER : (optionValue(q.options, choice.labels[0]) ?? "")}
                  onValueChange={(value) =>
                    value === OTHER ? pickOther(i, false) : pickOption(i, q.options[Number(value)].label, false)
                  }
                  disabled={sending}
                  className="gap-2"
                >
                  {q.options.map((option, j) => (
                    <ChoiceCard key={j} id={`${ids}-o${j}`} title={option.label} description={option.description}>
                      <RadioGroupItem
                        id={`${ids}-o${j}`}
                        value={String(j)}
                        aria-labelledby={`${ids}-o${j}-title`}
                        aria-describedby={option.description ? `${ids}-o${j}-desc` : undefined}
                      />
                    </ChoiceCard>
                  ))}
                  <ChoiceCard id={`${ids}-other`} title="Other" extra={otherInput}>
                    <RadioGroupItem id={`${ids}-other`} value={OTHER} aria-labelledby={`${ids}-other-title`} />
                  </ChoiceCard>
                </RadioGroup>
              )}
            </FieldSet>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" loading={sending} disabled={!complete}>
          <Send aria-hidden="true" />
          Send answer
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
