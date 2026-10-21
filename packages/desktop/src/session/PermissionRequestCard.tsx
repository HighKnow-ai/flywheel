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
 *   project**. The pattern is pre-filled with the backend's suggested rule
 *   (`permission_pattern::suggested_rule`) and is editable, in Claude Code's syntax
 *   (`Bash(npm test:*)`). The backend may refuse the rule (one that could cover a Gated action);
 *   its reason is shown and the request stays pending. Deny stays available as the quiet answer.
 * - **A Gated action** (a category) offers only **Allow once** and **Deny**, with Deny leading. It
 *   shows a plain-language sentence for its category and the literal command. No rule can ever
 *   cover a Gated action, so this variant renders no pattern field and no Always allow action at
 *   all — absent, never disabled.
 *
 * - **An agent's question** (issue #100, `toolName` `AskUserQuestion`) is not a permission request at
 *   all: it renders as the question form (`QuestionForm.tsx`), with no Allow, no Deny, no pattern and
 *   no keyboard shortcut, and is answered through `onAnswerQuestion`.
 *
 * **Not dismissible — deliberately, and this is the one place in the whole product that departs
 * from the shared Escape ladder** (`state/keyboard.ts`'s own doc comment on `EscapeLayer`,
 * T-02-16). This file owns no local key handler and no dismissable-layer wrapper — closing the
 * card without answering would hide the blocked state rather than resolve it. Its three keyboard
 * shortcuts (`a`/`d`/Shift+A) resolve through `state/keyboard.ts`'s shared `useRegionBindings`
 * hook, which ignores keys typed into the pattern field.
 */
import { useId, useRef, useState, type ComponentType, type FormEvent } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings } from "../state/keyboard";
import { ASK_USER_QUESTION_TOOL, questionsFromPayload } from "./feedRows";
import { QuestionForm, type QuestionPicks } from "./QuestionForm";
import "./session.css";

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
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const option = tokens[i];
    i += option === "-C" || option === "-c" || option === "--git-dir" || option === "--work-tree" ? 2 : 1;
  }
  for (; i < tokens.length; i += 1) rest.push(tokens[i]);
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
  if (positionals.length < 2) return undefined;
  return refspecTargetBranch(positionals[positionals.length - 1]);
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

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** The reason a rejected answer carries: Tauri rejects with the command's error string. */
function rejectionReason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** One request row's own answering/error state — independent per request id. */
interface RowState {
  answering: boolean;
  error: string | null;
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
  const isGated = request.destructiveCategory !== null;
  const glyph = MARKS_BY_ID[isGated ? "destructive-gate" : "blocked-indicator"];
  const consequenceCopy = isGated ? consequenceCopyFor(request.destructiveCategory as string, request.inputPayload) : null;
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
      setState({ answering: false, error: "Enter a pattern to always allow, such as Bash(npm test:*)." });
      return;
    }
    answeringRef.current = true;
    setState({ answering: true, error: null });
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
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  return (
    <div
      role="group"
      aria-label={`${request.toolName} wants to:`}
      className={`session-card${isGated ? " session-card-destructive" : ""}`}
    >
      {isGated && (
        <span className="type-heading" style={{ color: "var(--destructive-text-rack)" }}>
          Gated action — needs your OK every time
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            color: isGated ? "var(--destructive-text-rack)" : "var(--blocked-text-rack)",
            flexShrink: 0,
            display: "inline-flex",
          }}
        >
          <Icon name={glyph?.glyph ?? "ShieldAlert"} />
        </span>
        <span
          className="type-heading"
          title={`${request.toolName} wants to:`}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {request.toolName} wants to:
        </span>
      </div>

      {consequenceCopy && (
        <p className="type-body" style={{ margin: 0, overflowWrap: "anywhere" }}>
          {consequenceCopy}
        </p>
      )}

      <pre
        className="type-body"
        data-field="literal"
        style={{
          margin: 0,
          fontFamily: mono,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxHeight: payloadMaxHeight,
          overflowY: "auto",
          color: "var(--text-primary-rack)",
        }}
      >
        {literal}
      </pre>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          {isGated ? (
            <>
              {/* Reversed emphasis: Deny takes the lead position a request's Allow once occupies,
                  so approve-by-muscle-memory lands on the safe answer. */}
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("deny")}
                className="control-edge session-action session-action-lead session-action-destructive type-body"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("allow")}
                className="control-edge session-action type-body"
              >
                Allow once
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("allow")}
                className="control-edge session-action session-action-lead type-body"
              >
                Allow once
              </button>
              {/* Deny is the quiet answer: text and a caret, no box. */}
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("deny")}
                className="session-text-action type-body"
              >
                Deny
                <span aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
        {/* The standing rule is absent from a Gated action's card — never rendered-and-disabled —
            because no rule may ever cover one. It sits below a hairline gutter, away from the two
            quick answers, with its pattern pre-filled and editable. */}
        {!isGated && (
          <form className="session-grant session-grant-form" onSubmit={submitRule}>
            <label htmlFor={patternId} className="type-label session-grant-label">
              Pattern
            </label>
            <input
              id={patternId}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              disabled={state.answering}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="control-edge session-field session-grant-pattern type-body"
              style={{ fontFamily: mono }}
            />
            <button type="submit" disabled={state.answering} className="session-text-action type-label">
              Always allow this pattern <strong>in this project</strong>
              <span aria-hidden="true">›</span>
            </button>
          </form>
        )}
      </div>

      {state.error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)", overflowWrap: "anywhere" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}

/** Issue #100: an agent's question, held for an answer. Shares the card's frame and nothing else. */
function QuestionRequestRow({
  request,
  onAnswerQuestion,
}: {
  request: PendingPermissionRequest;
  onAnswerQuestion?: (requestId: string, picks: QuestionPicks) => Promise<void>;
}) {
  const questions = questionsFromPayload(request.inputPayload);
  const glyph = MARKS_BY_ID["blocked-indicator"];
  return (
    <div role="group" aria-label="The agent has a question" className="session-card" data-card="question">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <span aria-hidden="true" style={{ color: "var(--blocked-text-rack)", flexShrink: 0, display: "inline-flex" }}>
          <Icon name={glyph?.glyph ?? "ShieldAlert"} />
        </span>
        <span className="type-heading">
          {questions.length > 1 ? `The agent has ${questions.length} questions` : "The agent has a question"}
        </span>
      </div>
      {onAnswerQuestion ? (
        <QuestionForm questions={questions} onSubmit={(picks) => onAnswerQuestion(request.id, picks)} draftKey={request.id} />
      ) : (
        questions.map((q, i) => (
          <p key={i} className="type-body" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {q.question}
          </p>
        ))
      )}
    </div>
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
    <div
      role="region"
      aria-label="Pending permission requests"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
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
