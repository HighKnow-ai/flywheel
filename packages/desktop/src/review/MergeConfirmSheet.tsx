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
 * This component writes no status (D-122): the adapter surface it imports has no status setter.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useGitFacts } from "../board/useBoardQuery";
import * as adapter from "../adapters/tauri";
import { useMergePrecheck, useReviewCriteriaState } from "./useReviewQuery";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export interface MergeConfirmSheetProps {
  taskId: string;
  onClose: () => void;
}

export function MergeConfirmSheet({ taskId, onClose }: MergeConfirmSheetProps) {
  const precheck = useMergePrecheck(taskId, true);
  const criteria = useReviewCriteriaState("task", taskId);
  const gitFacts = useGitFacts(taskId);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref is the synchronous guard: React may not have flushed the disabling re-render before a
  // second activation fires in the same tick (the launch sheet's own `startingRef` reasoning).
  const mergingRef = useRef(false);

  const preview = precheck.data?.state === "ready" ? precheck.data : null;
  const withoutEvidence = (criteria.data ?? []).filter((s) => s.criterion.checked && !s.anchor).length;
  const uncommitted = gitFacts.data?.uncommitted.length ?? 0;

  function handleCancel() {
    if (!mergingRef.current) onClose();
  }

  function handleConfirm() {
    if (mergingRef.current || !preview) return;
    mergingRef.current = true;
    setMerging(true);
    setError(null);
    adapter
      .reviewMergeTask(taskId)
      .then(() => onClose())
      .catch((err: unknown) => {
        mergingRef.current = false;
        setMerging(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  return createPortal(
    <FocusScope trapped loop asChild>
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
                {preview ? `Merge ${preview.sourceBranch} → ${preview.targetBranch}` : "Merge"}
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
              {precheck.isError && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  Could not read what this merge would do. Close this sheet and try again.
                </p>
              )}
              {preview && (
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
              {error && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  {error}
                </p>
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
              {merging ? (
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
