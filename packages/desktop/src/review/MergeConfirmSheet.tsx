/**
 * The merge confirm sheet (Phase 8 plan 08-07, REVW-04, D-146): everything the merge will do,
 * shown before it does any of it — the launch sheet's "see it before you spend it" shape
 * (`launch-sheet/LaunchSheet.tsx`) applied to a git write instead of a model call, and
 * `item-detail/ForgeSection.tsx`'s preview-then-confirm flow.
 *
 * Opening the sheet performs no write: the only call it makes is the precheck, a side-effect-free
 * dry run. Confirming calls the merge command with the task id ALONE — never a branch, a count or
 * a ref — which is what makes the figures printed here and the figures merged the same figures.
 * The merge re-runs the dry run itself, so a will-conflict hint that went stale between opening
 * and confirming can only make the hint wrong, never the merge.
 *
 * After the write it reports exactly one of three outcomes the core proved — integrated, already
 * integrated, or aborted on conflict — or a named refusal. A conflict names every conflicted file and
 * offers two ways out through affordances that already exist (start a session on the task with the
 * conflict as its brief; open the task's worktree in the editor). There is deliberately no merge tool
 * and no retry on a refusal caused by concurrency: a retry button there invites the race the guard
 * exists to prevent (D-144).
 *
 * This component writes no status (D-122): the adapter surface it imports has no status setter.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useGitFacts } from "../board/useBoardQuery";
import * as adapter from "../adapters/tauri";
import type { MergePreviewDto, ReviewMergeOutcomeDto } from "../adapters/tauri";
import { useMergePrecheck, useReviewCriteriaState } from "./useReviewQuery";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The preview the user confirmed, kept so the result can name the branches after the board has
 * moved on and the live precheck no longer resolves. */
type Ready = Extract<MergePreviewDto, { state: "ready" }>;

type Result =
  | { kind: "outcome"; outcome: ReviewMergeOutcomeDto; confirmed: Ready }
  | { kind: "failure"; code: string; detail: string };

/** Parse the command's rejection, packed as `"<category>[:<detail>]"`. Anything unrecognised is the
 * generic failure; raw text is never shown (the core logs it). */
function parseFailure(err: unknown): { code: string; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  const [code, ...rest] = message.split(":");
  return { code, detail: rest.join(":") };
}

function failureText(code: string, detail: string): string {
  switch (code) {
    case "mergeInFlight":
      return `A merge into ${detail} is already running. Wait for it to finish, then open this sheet again.`;
    case "refused":
      return detail === "noEpic"
        ? "This task has no epic, so it cannot be merged in-app. Open a request for it from the item panel instead."
        : detail === "nothingToMerge"
          ? "Nothing to merge: this branch has no commits ahead of its integration branch."
          : "This task cannot be merged yet: it has no branch or its epic has no integration branch.";
    case "mergeFailed":
      return "The merge did not complete and nothing was recorded on the board. Details are in the application log.";
    case "eventNotRecorded":
      return "The merge landed in git, but Flywheel could not record it on the board, so this task will not show as integrated.";
    default:
      return "The merge could not be started.";
  }
}

/** The conflict as the resolving session's brief — written so the agent can act on it with no other
 * context. Bounded, because the instruction field is capped server-side. */
function conflictBrief(confirmed: Ready, files: string[]): string {
  const listed = files.slice(0, 50).map((f) => `- ${f}`).join("\n");
  const more = files.length > 50 ? `\n- ...and ${files.length - 50} more` : "";
  return (
    `Merging ${confirmed.sourceBranch} into ${confirmed.targetBranch} was attempted and aborted because it conflicts. ` +
    `Nothing was changed. Conflicted files:\n${listed}${more}\n\n` +
    `Resolve this in this worktree: merge ${confirmed.targetBranch} into your branch, resolve each conflict while ` +
    `keeping this task's intent and its acceptance criteria, run the tests, and commit.`
  );
}

export interface MergeConfirmSheetProps {
  taskId: string;
  onClose: () => void;
  /** Starts a session on the task and navigates to it. The surface supplies a version that clears
   * itself first. */
  onOpenSession?: (agentRunId: string) => void;
}

function ResultBody({ result }: { result: Result }) {
  if (result.kind === "failure") {
    return (
      <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
        {failureText(result.code, result.detail)}
      </p>
    );
  }
  const { outcome, confirmed } = result;
  if (outcome.kind === "merged") {
    return (
      <p role="status" className="type-body" style={{ margin: 0 }}>
        Integrated into {outcome.epicKey} — merge commit{" "}
        <span style={{ fontFamily: MONO_STACK }}>{outcome.mergeCommit.slice(0, 7)}</span> on{" "}
        <span style={{ fontFamily: MONO_STACK }}>{outcome.targetBranch}</span>. Nothing was pushed.
      </p>
    );
  }
  if (outcome.kind === "alreadyIntegrated") {
    return (
      <p role="status" className="type-body" style={{ margin: 0 }}>
        Nothing was merged: <span style={{ fontFamily: MONO_STACK }}>{confirmed.sourceBranch}</span> is already contained in{" "}
        <span style={{ fontFamily: MONO_STACK }}>{confirmed.targetBranch}</span>.
      </p>
    );
  }
  const n = outcome.files.length;
  return (
    <div role="alert">
      <p className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
        Merge aborted — {n} {n === 1 ? "conflict" : "conflicts"}, nothing changed.
      </p>
      <ul style={{ margin: 0, paddingLeft: "var(--space-lg)", fontFamily: MONO_STACK }}>
        {outcome.files.map((path) => (
          <li key={path} className="type-label">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConflictExits({
  starting,
  onResolve,
  onOpenEditor,
}: {
  starting: boolean;
  onResolve: () => void;
  onOpenEditor: () => void;
}) {
  const style = {
    background: "transparent",
    border: "none",
    color: "var(--accent-text-rack)",
    textDecoration: "underline",
    padding: 0,
    cursor: "pointer",
  } as const;
  return (
    <div style={{ display: "flex", gap: "var(--space-md)" }}>
      <button type="button" disabled={starting} onClick={onResolve} className="type-label" style={{ ...style, opacity: starting ? 0.6 : 1 }}>
        Start a session to resolve
      </button>
      <button type="button" onClick={onOpenEditor} className="type-label" style={style}>
        Open in editor
      </button>
    </div>
  );
}

export function MergeConfirmSheet({ taskId, onClose, onOpenSession }: MergeConfirmSheetProps) {
  const precheck = useMergePrecheck(taskId, true);
  const criteria = useReviewCriteriaState("task", taskId);
  const gitFacts = useGitFacts(taskId);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // A ref is the synchronous guard: React may not have flushed the disabling re-render before a
  // second activation fires in the same tick (the launch sheet's own `startingRef` reasoning).
  const mergingRef = useRef(false);
  // The confirm button takes initial focus (G-08-6): Tab does not reach buttons in WKWebView, and
  // Radix's own grab would land on Cancel by DOM order. Focused once per open, so a later render
  // cannot pull focus back from wherever the reader has since moved it.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusedRef = useRef(false);

  const preview = precheck.data?.state === "ready" ? precheck.data : null;
  const confirmReady = Boolean(preview) && !result && !merging;
  useEffect(() => {
    if (confirmReady && !focusedRef.current && confirmRef.current) {
      focusedRef.current = true;
      confirmRef.current.focus();
    }
  }, [confirmReady]);
  const withoutEvidence = (criteria.data ?? []).filter((s) => s.criterion.checked && !s.anchor).length;
  const uncommitted = gitFacts.data?.uncommitted.length ?? 0;

  function handleCancel() {
    if (!mergingRef.current) onClose();
  }

  function handleConfirm() {
    if (mergingRef.current || !preview) return;
    mergingRef.current = true;
    setMerging(true);
    const confirmed = preview;
    adapter
      .reviewMergeTask(taskId)
      .then((outcome) => setResult({ kind: "outcome", outcome, confirmed }))
      .catch((err: unknown) => setResult({ kind: "failure", ...parseFailure(err) }))
      .finally(() => {
        mergingRef.current = false;
        setMerging(false);
      });
  }

  function handleResolveSession(confirmed: Ready, files: string[]) {
    setStarting(true);
    setSideError(null);
    adapter
      .startAgentRun(taskId, "acceptEdits", conflictBrief(confirmed, files))
      .then((run) => onOpenSession?.(run.id))
      .catch(() => {
        setStarting(false);
        setSideError("Could not start a session on this task.");
      });
  }

  function handleOpenEditor() {
    setSideError(null);
    adapter.worktreeOpen(taskId, "editor").catch(() => setSideError("Could not open the worktree in the editor."));
  }

  return createPortal(
    <FocusScope trapped loop asChild onMountAutoFocus={(event) => event.preventDefault()}>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          handleCancel();
        }}
        onPointerDownOutside={handleCancel}
        asChild
      >
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            role="dialog"
            aria-label="Merge sheet"
            style={{
              width: 560,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface-secondary)",
              color: "var(--text-primary-rack)",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            <header style={{ padding: "var(--space-md)", borderBottom: "1px solid var(--divider)", flexShrink: 0 }}>
              <span className="type-heading" style={{ fontFamily: MONO_STACK, overflowWrap: "anywhere" }}>
                {result ? "Merge result" : preview ? `Merge ${preview.sourceBranch} → ${preview.targetBranch}` : "Merge"}
              </span>
            </header>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "var(--space-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
              }}
            >
              {!result && precheck.isError && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  Could not read what this merge would do. Close this sheet and try again.
                </p>
              )}
              {result && <ResultBody result={result} />}
              {result?.kind === "outcome" && result.outcome.kind === "conflicted" && (
                <ConflictExits
                  starting={starting}
                  onResolve={() => {
                    if (result.outcome.kind === "conflicted") handleResolveSession(result.confirmed, result.outcome.files);
                  }}
                  onOpenEditor={handleOpenEditor}
                />
              )}
              {sideError && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  {sideError}
                </p>
              )}
              {!result && preview && (
                <>
                  <p className="type-body" style={{ margin: 0 }}>
                    {preview.commitCount} {preview.commitCount === 1 ? "commit" : "commits"},{" "}
                    {preview.fileCount} {preview.fileCount === 1 ? "file" : "files"}, into {preview.epicKey}'s
                    integration branch.
                  </p>
                  {withoutEvidence > 0 && (
                    <p className="type-body" style={{ margin: 0 }}>
                      {withoutEvidence} {withoutEvidence === 1 ? "criterion" : "criteria"} checked without evidence.
                    </p>
                  )}
                  {uncommitted > 0 && (
                    <p className="type-body" style={{ margin: 0 }}>
                      {uncommitted} {uncommitted === 1 ? "file" : "files"} uncommitted in the worktree — not in this
                      diff, and a merge will not carry {uncommitted === 1 ? "it" : "them"}.
                    </p>
                  )}
                  {preview.conflictedFiles.length > 0 && (
                    <div>
                      <p className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                        Will conflict in {preview.conflictedFiles.length}{" "}
                        {preview.conflictedFiles.length === 1 ? "file" : "files"}:
                      </p>
                      <ul style={{ margin: 0, paddingLeft: "var(--space-lg)", fontFamily: MONO_STACK }}>
                        {preview.conflictedFiles.map((path) => (
                          <li key={path} className="type-label">
                            {path}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid var(--divider)",
                padding: "var(--space-md)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-sm)",
              }}
            >
              {result ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="type-body"
                  style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
                >
                  Close
                </button>
              ) : merging ? (
                <span role="status" className="type-body" style={{ color: "var(--text-muted-rack)" }}>
                  Merging…
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="type-body"
                    style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    ref={confirmRef}
                    type="button"
                    onClick={handleConfirm}
                    disabled={!preview}
                    className="type-body"
                    style={{
                      background: "var(--accent-nontext)",
                      border: "none",
                      borderRadius: "var(--radius-chrome)",
                      color: "var(--text-primary-rack)",
                      padding: "var(--space-xs) var(--space-md)",
                      cursor: preview ? "pointer" : "default",
                    }}
                  >
                    Merge
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
