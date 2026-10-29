/**
 * The permission-request card (AGNT-06, docs/mvp-spec.md §4.1, ADR 0001) — ONE component, mounted
 * in three places: the `feed` variant inline in the session transcript (`SessionSurface.tsx`), the
 * fleet's blocked queue (`fleet/BlockedQueue.tsx`), and the `compact` variant wherever a narrow
 * panel shows a Story's pending request. Every mount reads the same pending set and answers
 * through the same `answerPermissionRequest` wrapper, so answering in one place resolves them all.
 * This component itself is presentational: it renders whatever pending set its caller passes and
 * reports back through `onAnswer`.
 *
 * Two variants, chosen by the request's `destructiveCategory`:
 *
 * - **A request** (no category) offers **Allow once** and **Always allow `<pattern>` in this
 *   project**, the second in a Popover beside the answers (Story #206). The pattern is pre-filled with the backend's suggested rule
 *   (`permission_pattern::suggested_rule`) and is editable, in Claude Code's syntax
 *   (`Bash(npm test:*)`). The backend may refuse the rule (one that could cover a Gated action);
 *   its reason is shown and the request stays pending. Deny stays available as the quiet answer.
 * - **A Gated action** (a category) offers only **Allow once** and **Deny**, Deny filled. It
 *   shows a plain-language sentence for its category and the literal command. No rule can ever
 *   cover a Gated action, so this variant renders no pattern field and no Always allow action at
 *   all — absent, never disabled.
 *
 * - **An agent's question** (issue #100, `toolName` `AskUserQuestion`) is not a permission request at
 *   all: it renders as the question form (`QuestionForm.tsx`), with no Allow, no Deny, no pattern and
 *   no keyboard shortcut, and is answered through `onAnswerQuestion`.
 *
 * **Drawn as Waiting on you** (direction.md § Colour): every request card wears the safety-yellow header,
 * because each one holds a live agent until the developer answers. Both answers sit in one Button Group, and Deny
 * is always its first slot (Story #206, critique F20): answering down the queue, the left button never changes
 * meaning. The tones stay the card's own: a request's Allow once is the attention fill and its Deny outline; on a
 * Gated action Deny is the filled neutral (ink) and Allow once outline, so approve-by-muscle-memory lands on the
 * safe answer. The row that owns the keys draws them (D, A) with Kbd on the buttons.
 *
 * **Not dismissible — deliberately, and this is the one place in the whole product that departs
 * from the shared Escape ladder** (`state/keyboard.ts`'s own doc comment on `EscapeLayer`,
 * T-02-16). This file owns no local key handler and no dismissable-layer wrapper — closing the
 * card without answering would hide the blocked state rather than resolve it. Its three keyboard
 * shortcuts (`a`/`d`/Shift+A) resolve through `state/keyboard.ts`'s shared `useRegionBindings`
 * hook, which ignores keys typed into the pattern field.
 */
import { createContext, useContext, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Label,
  ButtonGroup,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Kbd,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  cn,
} from "@highknow/design";
import { Check, KeyRound, MessageCircleQuestionMark, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useRegionBindings } from "../state/keyboard";
import { Button } from "@/components/Button";
import { ASK_USER_QUESTION_TOOL, questionsFromPayload } from "./feedRows";
import { QuestionForm, type QuestionPicks } from "./QuestionForm";
import { toolDisplayName } from "./toolVerbs";

export type PermissionRequestCardVariant = "feed" | "compact";

/** One pending `permission_requests` row, projected for this card — mirrors
 * `adapters/tauri.ts`'s `PendingPermissionRequestDto`.
 *
 * `destructiveCategory` is `null` for a request, or one of
 * `destructive::DestructiveCategory::as_str()`'s kebab-case names for a Gated action.
 * `suggestedRule` is the rule the Always allow field is pre-filled with; `null` (or absent) for a
 * Gated action, and for a caller that has none, in which case the field starts from the tool name. */
export interface PendingPermissionRequest {
  id: string;
  toolName: string;
  inputPayload: string | null;
  destructiveCategory: string | null;
  suggestedRule?: string | null;
}

/** The command a Bash call would run, read from its raw input payload. `undefined` for a payload
 * that is not a JSON object carrying a string `command`. Display only: the classification already
 * happened server-side before this card mounted, and nothing here decides anything. */
function commandFromPayload(inputPayload: string | null): string | undefined {
  if (!inputPayload) return undefined;
  try {
    const command = (JSON.parse(inputPayload) as { command?: unknown }).command;
    return typeof command === "string" ? command : undefined;
  } catch {
    return undefined;
  }
}

function commandTokensFromPayload(inputPayload: string | null): string[] {
  return (commandFromPayload(inputPayload) ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Skip git's global options (`-C <dir>`, `-c k=v`, `--git-dir=…`) so `tokens[1]` is the
 * subcommand, mirroring the classifier's own skip at display precision. */
function withoutGitGlobalOptions(tokens: string[]): string[] {
  if (tokens[0] !== "git") return tokens;
  const rest: string[] = [];
  let i = 1;
  for (let option = tokens[i]; option?.startsWith("-"); option = tokens[i]) {
    i += option === "-C" || option === "-c" || option === "--git-dir" || option === "--work-tree" ? 2 : 1;
  }
  rest.push(...tokens.slice(i));
  return ["git", ...rest];
}

/** A push refspec's destination branch — the bare form (`main`), the `refs/heads/`-qualified
 * form, or the destination half of a `src:dst` refspec. */
function refspecTargetBranch(refspec: string): string {
  const dst = refspec.includes(":") ? (refspec.split(":").pop() ?? refspec) : refspec;
  return dst.startsWith("refs/heads/") ? dst.slice("refs/heads/".length) : dst;
}

/** `["git", "push", ...args]` — the last non-flag positional is the refspec destination for
 * `git push <remote> <refspec>`; a lone positional is the remote, which names no branch. */
function pushDestinationBranch(tokens: string[]): string | undefined {
  const positionals = tokens.slice(2).filter((t) => !t.startsWith("-"));
  const last = positionals[positionals.length - 1];
  if (positionals.length < 2 || last === undefined) return undefined;
  return refspecTargetBranch(last);
}

/** `["git", "branch", ...args]` — the first non-flag positional is the target of
 * `git branch -d/-D/--delete <name>`. */
function branchDeleteTarget(tokens: string[]): string | undefined {
  const positionals = tokens.slice(2).filter((t) => !t.startsWith("-"));
  return positionals[0];
}

/** The push spelling of a remote branch deletion: an empty-source refspec (`:feature-x`), or the
 * last positional after `--delete`/`-d` when more than the remote is named. */
function pushDeleteTarget(tokens: string[]): string | undefined {
  const colonRefspec = tokens.find((token) => token.startsWith(":"));
  if (colonRefspec) return refspecTargetBranch(colonRefspec);
  const positionals = tokens.slice(2).filter((t) => !t.startsWith("-"));
  return positionals.length > 1 ? positionals[positionals.length - 1] : undefined;
}

/** `["git", "worktree", "remove", ...args]` — the worktree path being removed. */
function worktreeRemoveTarget(tokens: string[]): string | undefined {
  const positionals = tokens.slice(3).filter((t) => !t.startsWith("-"));
  return positionals[0];
}

/** What a publishing command publishes to, from its program and subcommand. */
function publishSentence(tokens: string[]): string {
  const [program, sub, verb] = tokens;
  if (program === "npm") return "This would publish a package to the npm registry, where anyone can install it.";
  if (program === "cargo") return "This would publish this crate to crates.io. A published version can't be deleted.";
  if (program === "gh" && sub === "pr" && verb === "merge") return "This would merge a pull request on GitHub.";
  if (program === "gh" && sub === "release") return "This would change a release on GitHub, where others can see it.";
  return "This would publish something beyond this machine, where others can see it.";
}

type ConsequenceResolver = (inputPayload: string | null) => string;

/** One plain-language sentence per Gated action category (docs/mvp-spec.md §4.1's list), keyed by
 * `DestructiveCategory::as_str()`'s exact strings. A sentence names its target when the command
 * text says it, and falls back to a category-correct sentence without the name when it does not. */
const GATED_CONSEQUENCE: Record<string, ConsequenceResolver> = {
  "git-push": (payload) => {
    const branch = pushDestinationBranch(withoutGitGlobalOptions(commandTokensFromPayload(payload)));
    return branch
      ? `This would push ${branch} to the remote, where others can see it.`
      : "This would push commits to the remote, where others can see them.";
  },
  "force-push": (payload) => {
    const branch = pushDestinationBranch(withoutGitGlobalOptions(commandTokensFromPayload(payload)));
    return branch
      ? `This would force-push to ${branch}, overwriting any commits already there.`
      : "This would force-push, overwriting any commits already on the remote branch.";
  },
  "default-branch-push": (payload) => {
    const branch = pushDestinationBranch(withoutGitGlobalOptions(commandTokensFromPayload(payload)));
    return branch
      ? `This would push directly to ${branch}, the project's main branch.`
      : "This would push directly to the project's main branch.";
  },
  "branch-deletion": (payload) => {
    const tokens = withoutGitGlobalOptions(commandTokensFromPayload(payload));
    const branch = tokens[1] === "push" ? pushDeleteTarget(tokens) : branchDeleteTarget(tokens);
    return branch ? `This would delete the branch ${branch}.` : "This would delete a branch on this remote.";
  },
  "worktree-deletion": (payload) => {
    const target = worktreeRemoveTarget(withoutGitGlobalOptions(commandTokensFromPayload(payload)));
    return target
      ? `This would delete the worktree at ${target}, which isn't this Story's, with any uncommitted work in it.`
      : "This would delete a worktree that isn't this Story's, with any uncommitted work in it.";
  },
  "hard-reset": () => "This would discard uncommitted changes in the worktree — permanently.",
  "force-clean": () => "This would delete every untracked and ignored file in the worktree — permanently.",
  "history-rewrite": () => "This would rewrite the history of a branch other than this Story's own.",
  "recursive-delete": () => "This would delete files outside this Story's worktree — permanently.",
  publish: (payload) => publishSentence(commandTokensFromPayload(payload)),
};

/** Honest fallback for a category this table holds no sentence for. The literal command still
 * renders beneath it. */
const UNRECOGNISED_CONSEQUENCE =
  "This command can destroy work, and Flywheel doesn't recognise exactly what it would do.";

function consequenceCopyFor(category: string, inputPayload: string | null): string {
  const resolver = GATED_CONSEQUENCE[category];
  return resolver ? resolver(inputPayload) : UNRECOGNISED_CONSEQUENCE;
}

export type PermissionDecision = "allow" | "deny" | "allow_always";

export interface PermissionRequestCardProps {
  variant: PermissionRequestCardVariant;
  /** Every pending request for the run this card is mounted against, oldest first, each
   * independently answerable. Renders nothing at all for an empty array. */
  requests: PendingPermissionRequest[];
  /** `rule` is passed only with `allow_always`: the edited pattern field, in Claude Code's syntax.
   * A rejection's message is shown to the developer when the rule was refused. */
  onAnswer: (requestId: string, decision: PermissionDecision, rule?: string) => Promise<void>;
  /** Whether this card instance may own `a`/`d`/Shift+A. Omitted, the first request of the array is
   * the keyboard owner. Passed `false`, NO row in this instance listens. A surface mounting one card
   * per blocked agent (the fleet's blocked queue) must pass `true` to exactly one of them, or one
   * `a` press answers every agent at once. */
  keyboardEnabled?: boolean;
  /** Issue #100: answers an agent's question. Without it a question renders read-only. */
  onAnswerQuestion?: (requestId: string, picks: QuestionPicks) => Promise<void>;
}

/** The reason a rejected answer carries: Tauri rejects with the command's error string. */
function rejectionReason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** One request row's own answering/error state — independent per request id. `decision` is the answer in flight
 * (or the one that failed), so only its button shows the spinner and a refused rule marks the pattern field. */
interface RowState {
  answering: boolean;
  error: string | null;
  decision?: PermissionDecision;
}

/** An answer key drawn on its button (Story #206, P3 Kbd). It tints from the button's own text colour, so it reads
 * on the attention fill, the ink fill and an outline alike, and it stays out of the accessible name: the button
 * carries `aria-keyshortcuts` instead. */
function AnswerKey({ children }: { children: ReactNode }) {
  return (
    <Kbd aria-hidden="true" className="-mr-1 ml-0.5 bg-current/12 text-inherit opacity-80">
      {children}
    </Kbd>
  );
}

function PermissionRequestRow({
  request,
  variant,
  keyboardEnabled,
  onAnswer,
}: {
  request: PendingPermissionRequest;
  variant: PermissionRequestCardVariant;
  /** True only for the row that owns `a`/`d`/Shift+A. */
  keyboardEnabled: boolean;
  onAnswer: (requestId: string, decision: PermissionDecision, rule?: string) => Promise<void>;
}) {
  const [state, setState] = useState<RowState>({ answering: false, error: null });
  const [pattern, setPattern] = useState<string>(request.suggestedRule ?? request.toolName);
  const patternId = useId();
  const [editorOpen, setEditorOpen] = useState(false);
  const isGated = request.destructiveCategory !== null;
  const consequenceCopy = isGated
    ? consequenceCopyFor(request.destructiveCategory as string, request.inputPayload)
    : null;
  // A Bash call shows the literal command it would run; any other tool shows its raw input.
  const literal = commandFromPayload(request.inputPayload) ?? request.inputPayload ?? "";

  // `state.answering` alone cannot stop two activations in one synchronous tick, because React has
  // not necessarily flushed the `disabled` attribute before the second click fires; a ref reads
  // and writes synchronously and has no such window.
  const answeringRef = useRef(false);

  async function answer(decision: PermissionDecision) {
    if (answeringRef.current) return;
    const rule = decision === "allow_always" ? pattern.trim() : undefined;
    if (decision === "allow_always" && !rule) {
      setState({ answering: false, error: "Enter a pattern to always allow, such as Bash(npm test:*).", decision });
      return;
    }
    answeringRef.current = true;
    setState({ answering: true, error: null, decision });
    try {
      if (rule === undefined) {
        await onAnswer(request.id, decision);
      } else {
        await onAnswer(request.id, decision, rule);
      }
      // On success the row unmounts once the shared pending set re-reads; the ref is deliberately
      // never reset, so the window between the resolved promise and the unmount stays closed.
    } catch (err) {
      // A rejected answer re-enables the row so a retry is possible. A refused rule says why.
      answeringRef.current = false;
      setState({
        answering: false,
        decision,
        error:
          decision === "allow_always"
            ? `Flywheel didn't save that rule: ${rejectionReason(err)}`
            : "Could not send your answer. Try again.",
      });
    }
  }

  function submitRule(event: FormEvent) {
    event.preventDefault();
    void answer("allow_always");
  }

  // `Shift+A` is inert on a Gated action: it has no Always allow action to trigger.
  useRegionBindings(
    "permission-card",
    "permission-card",
    keyboardEnabled
      ? {
          "answer-permission-allow": () => void answer("allow"),
          "answer-permission-deny": () => void answer("deny"),
          "answer-permission-allow-always": () => {
            if (!isGated) void answer("allow_always");
          },
        }
      : {},
  );

  const payloadMaxHeight = variant === "compact" ? 160 : 240;

  // One error line: inside the pattern editor while it is open (a refused rule says why next to the rule), on the
  // card otherwise.
  const errorLine = state.error && (
    <p role="alert" className="m-0 text-small break-words text-destructive-text">
      {state.error}
    </p>
  );

  return (
    <RequestFrame
      role="group"
      ariaLabel={`${toolDisplayName(request.toolName)} wants to:`}
      card={isGated ? "gated" : "permission"}
      icon={isGated ? <ShieldAlert /> : <KeyRound />}
      title={isGated ? "Gated action — needs your OK every time" : "Permission request"}
      aside={isGated ? "No rule can cover it" : "The session waits until you answer"}
    >
      {/* A long tool name truncates; the card never widens for it. */}
      <span
        className="min-w-0 text-row font-semibold"
        title={`${toolDisplayName(request.toolName)} wants to:`}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {toolDisplayName(request.toolName)} wants to:
      </span>

      {/* A long branch name in the sentence wraps rather than being cut. */}
      {consequenceCopy && (
        <p className="m-0 text-body" style={{ overflowWrap: "anywhere" }}>
          {consequenceCopy}
        </p>
      )}

      {/* A large payload scrolls inside a bounded block. */}
      <pre
        data-field="literal"
        className="m-0 rounded-md border border-border bg-muted px-3 py-2 font-mono text-small whitespace-pre-wrap text-foreground"
        style={{ maxHeight: payloadMaxHeight, overflowY: "auto", overflowWrap: "anywhere" }}
      >
        {literal}
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        {/* Deny is the first slot of one Button Group on every request card (Story #206, critique F20), so the left
            answer means the same thing all the way down the Waiting-on-you queue. Each card keeps its own tones:
            a request's Allow once is the attention fill, a Gated action's Deny the ink fill, so on a Gated action
            approve-by-muscle-memory still lands on the safe answer. */}
        <ButtonGroup aria-label="Answer">
          <Button
            variant={isGated ? "neutral" : "outline"}
            disabled={state.answering}
            loading={state.answering && state.decision === "deny"}
            aria-keyshortcuts={keyboardEnabled ? "D" : undefined}
            onClick={() => void answer("deny")}
          >
            <X aria-hidden="true" />
            Deny
            {keyboardEnabled && <AnswerKey>D</AnswerKey>}
          </Button>
          <Button
            variant={isGated ? "outline" : "attention"}
            disabled={state.answering}
            loading={state.answering && state.decision === "allow"}
            aria-keyshortcuts={keyboardEnabled ? "A" : undefined}
            onClick={() => void answer("allow")}
          >
            <Check aria-hidden="true" />
            Allow once
            {keyboardEnabled && <AnswerKey>A</AnswerKey>}
          </Button>
        </ButtonGroup>
        {/* The standing rule is absent from a Gated action's card, never rendered-and-disabled, because no rule may
            ever cover one. On a request it is a Popover beside the two quick answers, its pattern pre-filled. */}
        {!isGated && (
          <Popover open={editorOpen} onOpenChange={setEditorOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" disabled={state.answering}>
                <ShieldCheck aria-hidden="true" />
                Always allow…
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] gap-3 p-3">
              <form className="flex flex-col gap-3" onSubmit={submitRule}>
                <PopoverHeader>
                  <PopoverTitle className="text-row font-semibold">Always allow in this project</PopoverTitle>
                  <PopoverDescription className="text-small">
                    Calls that match this pattern run without asking, in this project only. It uses Claude Code&rsquo;s
                    rule syntax, such as <code className="font-mono">Bash(npm test:*)</code>.
                  </PopoverDescription>
                </PopoverHeader>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={patternId} className="text-small font-semibold text-muted-foreground">
                    Pattern
                  </Label>
                  <InputGroup className="h-8.5">
                    <InputGroupInput
                      id={patternId}
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      disabled={state.answering}
                      aria-invalid={state.error !== null && state.decision === "allow_always" ? true : undefined}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="font-mono text-small"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="submit"
                        variant="default"
                        size="sm"
                        disabled={state.answering}
                        loading={state.answering && state.decision === "allow_always"}
                        aria-label="Always allow this pattern in this project"
                        className="h-6.5"
                      >
                        <ShieldCheck aria-hidden="true" />
                        Always allow
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                {editorOpen && errorLine}
              </form>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {!editorOpen && errorLine}
    </RequestFrame>
  );
}

/** Whether a request sits inside the session's own card. There it is a band across the card's full width
 * (a yellow header and two yellow rules), never a card inside a card; on the floor (Waiting on you) it is
 * its own card. */
export const RequestInCard = createContext(false);

/** Issue #156: a request inside a Needs-you card, whose lead line already names its kind and that it waits on
 * you. There the yellow header is left out (it would say it twice and wrap at 400px): the card's own attention
 * edge carries the yellow, and the header's note becomes one meta line at the top of the body. */
export const RequestHeaderless = createContext(false);

/** The frame every request shares: Waiting on you's yellow header (its icon, its title, a note on the
 * right), then the body. */
function RequestFrame({
  role,
  ariaLabel,
  card,
  icon,
  title,
  aside,
  children,
}: {
  role: "group";
  ariaLabel: string;
  card: string;
  icon: ReactNode;
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  const inCard = useContext(RequestInCard);
  const headerless = useContext(RequestHeaderless);
  if (headerless) {
    return (
      <div role={role} aria-label={ariaLabel} data-card={card} className="session-card flex min-w-0 flex-col gap-3">
        {aside && <span className="text-meta font-semibold text-muted-foreground">{aside}</span>}
        {children}
      </div>
    );
  }
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      data-card={card}
      className={cn(
        "session-card min-w-0 overflow-hidden border-attention bg-card",
        inCard ? "-mx-5 border-y-2" : "rounded-lg border-2 shadow-card",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 bg-attention py-2.5 text-attention-foreground [&_svg]:size-[18px] [&_svg]:shrink-0",
          inCard ? "px-5" : "px-4",
        )}
      >
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
        <span className="text-row font-bold">{title}</span>
        {aside && <span className="ml-auto text-small font-semibold">{aside}</span>}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-3 py-4", inCard ? "px-5" : "px-4")}>{children}</div>
    </div>
  );
}

/** Issue #100: an agent's question, held for an answer. Shares the card's frame and nothing else. */
function QuestionRequestRow({
  request,
  onAnswerQuestion,
}: {
  request: PendingPermissionRequest;
  onAnswerQuestion?: ((requestId: string, picks: QuestionPicks) => Promise<void>) | undefined;
}) {
  const questions = questionsFromPayload(request.inputPayload);
  return (
    <RequestFrame
      role="group"
      ariaLabel="The agent has a question"
      card="question"
      icon={<MessageCircleQuestionMark />}
      title={
        questions.length > 1 ? `The agent asks you ${questions.length} questions` : "The agent asks you a question"
      }
      aside="The session waits until you answer"
    >
      {onAnswerQuestion ? (
        <QuestionForm
          questions={questions}
          onSubmit={(picks) => onAnswerQuestion(request.id, picks)}
          draftKey={request.id}
        />
      ) : (
        questions.map((q, i) => (
          <p key={i} className="m-0 text-body break-words">
            {q.question}
          </p>
        ))
      )}
    </RequestFrame>
  );
}

export function PermissionRequestCard({
  variant,
  requests,
  onAnswer,
  keyboardEnabled = true,
  onAnswerQuestion,
}: PermissionRequestCardProps) {
  if (requests.length === 0) return null;

  return (
    <div role="region" aria-label="Pending permission requests" className="flex min-w-0 flex-col gap-3">
      {requests.map((request, index) =>
        request.toolName === ASK_USER_QUESTION_TOOL ? (
          <QuestionRequestRow key={request.id} request={request} onAnswerQuestion={onAnswerQuestion} />
        ) : (
          <PermissionRequestRow
            key={request.id}
            request={request}
            variant={variant}
            keyboardEnabled={keyboardEnabled && index === 0}
            onAnswer={onAnswer}
          />
        ),
      )}
    </div>
  );
}
