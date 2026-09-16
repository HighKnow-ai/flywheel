/**
 * The permission-request card (AGNT-06, D-37, D-38) — ONE component, mounted in two places
 * (02-UI-SPEC.md Discretion #6): the `feed` variant inline in the session transcript
 * (`SessionSurface.tsx`, plan 02-06 Task 2) and the `compact` variant inside the 480px item detail
 * panel (`ItemDetailPanel.tsx`, same task). Both instances read the SAME
 * `usePendingPermissionRequests(agentRunId)` query (`board/useBoardQuery.ts`) and answer through
 * the same `answerPermissionRequest` mutation, so answering in either place resolves both within
 * one pushed-delta cycle (E3's `partial` consideration) — this component itself is presentational:
 * it renders whatever pending set its caller passes and reports back through `onAnswer`.
 *
 * Reusing one component across two mount points is the pattern `ParentPicker`/`StatusPicker`
 * already established in this codebase (02-UI-SPEC.md's own citation) — do not build a second
 * card.
 *
 * **Not dismissible — deliberately, and this is the one place in the whole product that departs
 * from the shared Escape ladder** (`state/keyboard.ts`'s own doc comment on `EscapeLayer`,
 * T-02-16). This file owns no local key handler, no `onKeyDown` prop and no dismissable-layer
 * wrapper — closing the card without answering would hide the blocked state rather than resolve
 * it, and the agent would still be blocked. Its three keyboard shortcuts (`a`/`d`/Shift+A) resolve
 * through `state/keyboard.ts`'s shared `useRegionBindings` hook instead — the window-level
 * listener lives in that module, not here, which is what keeps this file's own key/dismissal
 * surface at zero (this task's own structural verify gate).
 */
import { useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings } from "../state/keyboard";

export type PermissionRequestCardVariant = "feed" | "compact";

/** One pending `permission_requests` row, projected for this card — mirrors
 * `adapters/tauri.ts`'s `PendingPermissionRequestDto` field-for-field.
 *
 * `destructiveCategory` (plan 03-12, D-55/D-56) is `null` for the routine variant, or one of
 * `destructive::DestructiveCategory::as_str()`'s eight kebab-case names for the destructive-action
 * gate — the field this component's own variant selection branches on. */
export interface PendingPermissionRequest {
  id: string;
  toolName: string;
  inputPayload: string | null;
  destructiveCategory: string | null;
}

/**
 * Per-category consequence copy (D-56, `03-UI-SPEC.md` § "Destructive-action gate card"), keyed
 * by `DestructiveCategory::as_str()`'s exact strings. Three of the six named categories interpolate
 * the target branch name — but `permission_requests.destructive_category` stores only the category
 * string, never the branch the classifier matched (03-07's classifier never persists it
 * alongside the category, per this plan's own flagged assumption). This is a best-effort re-parse
 * of the SAME raw command text already rendered in the Mono payload block beneath it, mirroring
 * `destructive.rs`'s own positional argv parsing at renderer-display precision only — it is NEVER
 * used for any gating decision, since the real classification already happened server-side before
 * this card ever mounted. A command whose branch this parse cannot resolve falls back to a
 * category-correct sentence that simply omits the name, never to the fully generic
 * `UNCATEGORIZED_CONSEQUENCE` — the category itself is still known even when the branch is not.
 */
function commandTokensFromPayload(inputPayload: string | null): string[] {
  if (!inputPayload) return [];
  let command: unknown;
  try {
    command = (JSON.parse(inputPayload) as { command?: unknown }).command;
  } catch {
    return [];
  }
  if (typeof command !== "string") return [];
  return command.trim().split(/\s+/).filter(Boolean);
}

/** A push refspec's destination branch — either the bare form (`main`), the `refs/heads/`-
 * qualified form, or the destination half of a `src:dst` refspec — mirrors
 * `destructive.rs::refspec_targets_branch`'s own parsing at display precision. */
function refspecTargetBranch(refspec: string): string {
  const dst = refspec.includes(":") ? (refspec.split(":").pop() ?? refspec) : refspec;
  return dst.startsWith("refs/heads/") ? dst.slice("refs/heads/".length) : dst;
}

/** `["git", "push", ...args]` — the last non-flag positional is the conventional refspec
 * destination for `git push <remote> <refspec>`. */
function pushDestinationBranch(tokens: string[]): string | undefined {
  const positionals = tokens.slice(2).filter((t) => !t.startsWith("-"));
  const refspec = positionals[positionals.length - 1];
  return refspec ? refspecTargetBranch(refspec) : undefined;
}

/** `["git", "branch", ...args]` — the first non-flag positional after `branch` is the
 * conventional target for `git branch -d/-D/--delete <name>`. */
function branchDeleteTarget(tokens: string[]): string | undefined {
  const positionals = tokens.slice(2).filter((t) => !t.startsWith("-"));
  return positionals[0];
}

type ConsequenceResolver = (inputPayload: string | null) => string;

const DESTRUCTIVE_CONSEQUENCE: Record<string, ConsequenceResolver> = {
  "force-push": (payload) => {
    const branch = pushDestinationBranch(commandTokensFromPayload(payload));
    return branch
      ? `This would force-push to ${branch}, overwriting any commits already there.`
      : "This would force-push, overwriting any commits already on the remote branch.";
  },
  "branch-deletion": (payload) => {
    const branch = branchDeleteTarget(commandTokensFromPayload(payload));
    return branch ? `This would delete the branch ${branch}.` : "This would delete a branch on this remote.";
  },
  "default-branch-push": (payload) => {
    const branch = pushDestinationBranch(commandTokensFromPayload(payload));
    return branch
      ? `This would push directly to ${branch}, the project's main branch.`
      : "This would push directly to the project's main branch.";
  },
  "hard-reset": () => "This would discard uncommitted changes in the worktree — permanently.",
  "force-clean": () => "This would delete every untracked and ignored file in the worktree — permanently.",
  "history-rewrite": () => "This would rewrite commit history other work may depend on.",
};

/** Generic, honest fallback (D-56's fail-closed rule applied to copy) for any category value this
 * record does not hold a key for — an unrecognised string OR a recognised-but-uncovered category
 * such as `recursive-delete` (the D-56 copy table names six of the classifier's seven named
 * categories; `recursive-delete` has no dedicated sentence in `03-UI-SPEC.md`'s own table). Never
 * a bare tool name or a silently-blank sentence — the raw command still renders in Mono beneath
 * this text either way. */
const UNCATEGORIZED_CONSEQUENCE =
  "This command can destroy work, and Flywheel doesn't recognise exactly what it would do.";

function consequenceCopyFor(category: string, inputPayload: string | null): string {
  const resolver = DESTRUCTIVE_CONSEQUENCE[category];
  return resolver ? resolver(inputPayload) : UNCATEGORIZED_CONSEQUENCE;
}

export type PermissionDecision = "allow" | "deny" | "allow_always";

export interface PermissionRequestCardProps {
  variant: PermissionRequestCardVariant;
  /** Every pending request for the run this card is mounted against, oldest first (E3's
   * zero-one-many resolution: "stacked in creation order, each independently answerable" — never
   * only the first). Renders nothing at all for an empty array — not an empty container, not a
   * placeholder (E3 `empty`). */
  requests: PendingPermissionRequest[];
  onAnswer: (requestId: string, decision: PermissionDecision) => Promise<void>;
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** One request row's own answering/error state — independent per request id, so answering one
 * card never touches a sibling's state (E3 `partial`/zero-one-many). */
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
  /** True only for the oldest pending request — the one `a`/`d`/Shift+A apply to when more than
   * one request is showing at once. A deliberate, documented simplification: concurrent requests
   * on one run are rare (02-05-SUMMARY's own D4 measured exactly two), and every request stays
   * independently answerable by click regardless of which one currently owns the keyboard. */
  keyboardEnabled: boolean;
  onAnswer: (requestId: string, decision: PermissionDecision) => Promise<void>;
}) {
  const [state, setState] = useState<RowState>({ answering: false, error: null });
  // A destructive category selects the strong variant; `null` is the routine variant unchanged
  // from before this plan (03-UI-SPEC.md's own "populated" resolution — the routine layout is
  // never reached for a destructive category, and vice versa).
  const isDestructive = request.destructiveCategory !== null;
  const glyph = MARKS_BY_ID[isDestructive ? "destructive-gate" : "blocked-indicator"];
  const consequenceCopy = isDestructive
    ? consequenceCopyFor(request.destructiveCategory as string, request.inputPayload)
    : null;

  // `state.answering` alone is not a sufficient guard against two activations in the same
  // synchronous tick, because React has not necessarily flushed the state update — and the
  // `disabled` attribute with it — before a second click fires; a ref reads and writes
  // synchronously and has no such window. `state.answering` stays the source of truth for what
  // the UI renders. This is the destructive-gate card, so a double-click here would double-answer
  // a destructive permission request (mirrors `item-detail/RunsSection.tsx`'s `ackActingRef`,
  // which itself cites `item-detail/WorktreeSummary.tsx`'s `actingRef` as the original fix,
  // 03-16-PLAN.md Task 1).
  const answeringRef = useRef(false);

  async function answer(decision: PermissionDecision) {
    // A second activation while the ref is set invokes nothing — the synchronous-tick guard.
    if (answeringRef.current) return;
    answeringRef.current = true;
    setState({ answering: true, error: null });
    try {
      await onAnswer(request.id, decision);
      // On success this row disappears once the shared pending-set query re-reads (Task 2) — no
      // local "answered" state to hold here, and the ref is deliberately never reset: the row
      // unmounts when that happens, which is what removes it. Resetting on success would reopen
      // the same window this guard exists to close, for the brief span between the resolved
      // promise and the unmount.
    } catch {
      // Clear the ref before setting the error state (mirrors `acknowledge()` in
      // `RunsSection.tsx`) — a rejected answer must re-enable the row so a retry is possible; a
      // guard that is never cleared on failure would permanently disable the only affordance that
      // unblocks a waiting agent.
      answeringRef.current = false;
      setState({ answering: false, error: "Could not send your answer. Try again." });
    }
  }

  // The destructive variant reuses these SAME two action ids through this SAME
  // `useRegionBindings` call — no new entry in `state/keyboard.ts`, only which button each
  // visually occupies differs (03-UI-SPEC.md Keyboard Map Additions). `Shift+A` is inert on this
  // variant per that same section ("has no effect... since it renders no allow-always action to
  // trigger") — gated here, in this row's own handler, not by touching the shared binding table.
  useRegionBindings("permission-card", "permission-card", {
    "answer-permission-allow": () => {
      if (keyboardEnabled) void answer("allow");
    },
    "answer-permission-deny": () => {
      if (keyboardEnabled) void answer("deny");
    },
    "answer-permission-allow-always": () => {
      if (keyboardEnabled && !isDestructive) void answer("allow_always");
    },
  });

  const payloadMaxHeight = variant === "compact" ? 160 : 240;

  return (
    <div
      role="group"
      aria-label={`${request.toolName} wants to:`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-chrome)",
        borderLeft: isDestructive ? "4px solid var(--destructive-text-rack)" : undefined,
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      {isDestructive && (
        <span className="type-heading" style={{ color: "var(--destructive-text-rack)" }}>
          Destructive action — needs your OK
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            color: isDestructive ? "var(--destructive-text-rack)" : "var(--blocked-text-rack)",
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
        style={{
          margin: 0,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxHeight: payloadMaxHeight,
          overflowY: "auto",
          color: "var(--text-primary-rack)",
        }}
      >
        {request.inputPayload ?? ""}
      </pre>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          {isDestructive ? (
            <>
              {/* Reversed emphasis (03-UI-SPEC.md § "Destructive-action gate card", the load-bearing
                  decision this plan adds): Deny takes the filled/primary position a routine card's
                  Allow occupies, repurposing approve-by-muscle-memory as the safety mechanism rather
                  than fighting it with a delay or a typed confirmation. */}
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("deny")}
                className="type-body"
                style={{
                  border: "1px solid var(--destructive-strip)",
                  background: "var(--destructive-strip)",
                  // `--text-primary-strip` (dark ink, meant for strip PAPER stock) measures only
                  // 2.2:1 against `--destructive-strip` — `--text-primary-rack` (the light rack
                  // text token) measures 6.3:1 here instead, well past AA. Same reasoning
                  // `DeleteConfirm.tsx`'s own "Delete" button carries; reused verbatim.
                  color: "var(--text-primary-rack)",
                  borderRadius: "var(--radius-chrome)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: state.answering ? "default" : "pointer",
                  opacity: state.answering ? 0.6 : 1,
                }}
              >
                Deny
              </button>
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("allow")}
                className="type-body"
                style={{
                  background: "transparent",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "var(--text-primary-rack)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: state.answering ? "default" : "pointer",
                  opacity: state.answering ? 0.6 : 1,
                }}
              >
                Allow, just this once
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("allow")}
                className="type-body"
                style={{
                  background: "var(--accent-nontext)",
                  border: "none",
                  borderRadius: "var(--radius-chrome)",
                  color: "var(--text-primary-rack)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: state.answering ? "default" : "pointer",
                  opacity: state.answering ? 0.6 : 1,
                }}
              >
                Allow
              </button>
              <button
                type="button"
                disabled={state.answering}
                onClick={() => void answer("deny")}
                className="type-body"
                style={{
                  background: "transparent",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "var(--text-primary-rack)",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: state.answering ? "default" : "pointer",
                  opacity: state.answering ? 0.6 : 1,
                }}
              >
                Deny
              </button>
            </>
          )}
        </div>
        {/* The tertiary allow-always action is conditionally ABSENT from the destructive variant —
            not rendered-and-disabled — so it can never regress back in for a destructive category
            (D-57). `disabled` is never used to hide it; the whole button is omitted from the tree. */}
        {!isDestructive && (
          <button
            type="button"
            disabled={state.answering}
            onClick={() => void answer("allow_always")}
            className="type-label"
            style={{
              alignSelf: "flex-start",
              background: "transparent",
              border: "none",
              color: "var(--text-muted-rack)",
              textDecoration: "underline",
              padding: 0,
              cursor: state.answering ? "default" : "pointer",
              opacity: state.answering ? 0.6 : 1,
            }}
          >
            Allow this tool for this project from now on
          </button>
        )}
      </div>

      {state.error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}

export function PermissionRequestCard({ variant, requests, onAnswer }: PermissionRequestCardProps) {
  if (requests.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Pending permission requests"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
      {requests.map((request, index) => (
        <PermissionRequestRow
          key={request.id}
          request={request}
          variant={variant}
          keyboardEnabled={index === 0}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}
