/**
 * The worktree-removal dialog (WORK-03, D-41/D-42/D-43, 03-UI-SPEC.md "Worktree removal") —
 * reuses `board/DeleteConfirm.tsx`'s exact Radix `FocusScope`/`DismissableLayer`/`createPortal`
 * overlay shape (`role="alertdialog"`, centered scrim, `--surface-secondary` panel). ONE
 * component, three rendered states, resolved by a fresh `git status --porcelain` read taken at
 * open time and never cached (`useWorktreeRemovalCheck`'s own `staleTime: 0`/`gcTime: 0`):
 *
 * 1. **Checking** — the read is in flight: a single centered Micro-role line, no skeleton/spinner
 *    (sub-100ms expected).
 * 2. **Clean** — the worktree has nothing uncommitted: heading + body + Remove/Cancel, Cancel
 *    `autoFocus`ed so a stray Enter never lands on the destructive action.
 * 3. **Dirty** — the worktree holds uncommitted changes (D-42): every `git status --porcelain`
 *    entry renders as its own row and the ONLY button is "OK" — there is no "Remove Anyway."
 *
 * `remove_worktree_for_task` (packages/core) re-reads porcelain itself before ever touching git —
 * this dialog's own Clean/Dirty branch is advisory UI only, never the actual guard (D-43's "no
 * escape hatch" is structural in the backend, not a property of this component).
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useRemoveWorktree, useWorktreeRemovalCheck } from "../board/useBoardQuery";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Porcelain status-word mapping (03-UI-SPEC.md "Porcelain status-word mapping", D-42's four
 * named outcomes) — the single-character codes this record maps by. `??` (untracked) is matched
 * separately, BEFORE this record's single-character lookup, so an untracked file never falls
 * through to the fallback word. */
const PORCELAIN_STATUS_WORDS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
};
const PORCELAIN_UNTRACKED_CODE = "??";
/** The defensive fallback for any porcelain code this mapping does not name (`R`enamed,
 * `C`opied, a merge-conflict code, …) — never a blank cell, never the raw two-letter code. */
const PORCELAIN_FALLBACK_WORD = "Changed";

/** Exported so `GitFactsSection.tsx` (Phase 7 plan 07-01, LINK-09) reuses this exact mapping for
 * the uncommitted-changes view rather than writing a second one (D-42's presentation, applied to
 * a second surface). */
export function porcelainStatusWord(code: string): string {
  if (code === PORCELAIN_UNTRACKED_CODE) return "Untracked";
  return PORCELAIN_STATUS_WORDS[code.charAt(0)] ?? PORCELAIN_FALLBACK_WORD;
}

// Both buttons take the `control-edge` class: a 3:1 `--border-control` edge and the chrome radius.
const secondaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-xs) var(--space-md)",
  background: "transparent",
  color: "var(--text-primary-rack)",
  cursor: "pointer",
};

// Destructive is drawn, not filled: the destructive hue is the TEXT and the edge, on the dialog's own
// surface. The fill this replaced painted ink on `--destructive-strip` at 2.95:1 in light and 2.86:1 in
// dark, both under the 4.5 text floor (the "6.3:1" the old comment claimed was the retired palette's),
// on the one confirmation that must never be illegible. `--destructive-text-rack` on
// `--surface-secondary` is asserted AA in both modes by `theme/__tests__/contrast.test.ts`.
const destructiveButtonStyle: React.CSSProperties = {
  padding: "var(--space-xs) var(--space-md)",
  borderColor: "var(--destructive-text-rack)",
  background: "transparent",
  color: "var(--destructive-text-rack)",
  cursor: "pointer",
};

export interface WorktreeRemovalDialogProps {
  taskId: string;
  onClose: () => void;
}

/** The Remove button's own answering/error state (`PermissionRequestCard.tsx`'s `RowState`
 * pattern, copied here): guards a second press while `removing`, and on failure keeps the dialog
 * mounted with an inline message rather than closing optimistically. */
interface RemoveButtonState {
  removing: boolean;
  error: string | null;
}

export function WorktreeRemovalDialog({ taskId, onClose }: WorktreeRemovalDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const check = useWorktreeRemovalCheck(taskId, true);
  const removeWorktree = useRemoveWorktree(taskId);
  const [removeState, setRemoveState] = useState<RemoveButtonState>({ removing: false, error: null });
  // `removeState.removing` alone is not a sufficient guard against two activations in one
  // synchronous tick — React has not necessarily flushed the state update and the `disabled`
  // attribute with it before a second click fires. A ref reads and writes synchronously and has
  // no such window (mirrors `item-detail/WorktreeSummary.tsx`'s own `actingRef` /
  // `item-detail/RunsSection.tsx`'s `ackActingRef`, both found by the same real failing-test class
  // this file's own plan-03-18 test now proves against). `removeState.removing` stays the source
  // of truth for what the UI renders (disabled/opacity); this ref only guards dispatch.
  const removingRef = useRef(false);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  async function handleRemove() {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoveState({ removing: true, error: null });
    try {
      await removeWorktree.mutateAsync();
      // The ref is deliberately NOT cleared here: `onClose()` unmounts the dialog on this path,
      // and clearing would reopen the exact window this guard closes for the brief span between
      // the resolved promise and the unmount actually taking effect.
      onClose();
    } catch {
      // A failed removal must stay retryable — release the guard before setting the error state,
      // mirroring `WorktreeSummary.tsx`'s `recreate()`/`forgetRecord()` catch-path reset.
      removingRef.current = false;
      setRemoveState({ removing: false, error: "Could not remove the worktree. Try again." });
    }
  }

  let ariaLabel: string;
  let body: ReactNode;

  if (check.isPending) {
    ariaLabel = "Checking for uncommitted changes";
    body = (
      <p
        className="type-label"
        style={{ margin: 0, textAlign: "center", color: "var(--text-muted-rack)" }}
      >
        Checking for uncommitted changes…
      </p>
    );
  } else if (check.isError || !check.data) {
    // E1 `error` (backstop): the porcelain read itself failed — never present the Clean state on
    // an unreadable worktree. The worktree is untouched either way.
    ariaLabel = "Could not check the worktree's status";
    body = (
      <>
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Flywheel could not read this worktree's status. The worktree was not touched.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="type-body control-edge"
            style={secondaryButtonStyle}
          >
            OK
          </button>
        </div>
      </>
    );
  } else if (check.data.dirtyCount === 0 && check.data.entries.length === 0) {
    const { taskKey, path } = check.data;
    ariaLabel = `Remove worktree for ${taskKey}?`;
    body = (
      <>
        <h2 className="type-heading" style={{ margin: 0 }}>
          Remove worktree for {taskKey}?
        </h2>
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Everything in it is committed — nothing will be lost. The directory at {path} will be
          deleted.
        </p>
        {removeState.error && (
          <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
            {removeState.error}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="type-body control-edge"
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={removeState.removing}
            onClick={() => void handleRemove()}
            className="type-body control-edge"
            style={{
              ...destructiveButtonStyle,
              opacity: removeState.removing ? 0.6 : 1,
              cursor: removeState.removing ? "default" : "pointer",
            }}
          >
            Remove
          </button>
        </div>
      </>
    );
  } else {
    const { dirtyCount, entries } = check.data;
    const plural = dirtyCount === 1 ? "change" : "changes";
    // E1 `partial` (backstop): a response that carries a dirty count but no entries, or entries
    // whose `path` is empty, is a truncated/unparseable porcelain read — treated as dirty (never
    // Clean) with a note that the list may be incomplete, rather than silently rendering a
    // partial list as if it were the whole truth.
    const looksPartial = (dirtyCount > 0 && entries.length === 0) || entries.some((entry) => entry.path === "");
    ariaLabel = `Can't remove — ${dirtyCount} uncommitted ${plural}`;
    body = (
      <>
        <h2 className="type-heading" style={{ margin: 0 }}>
          Can&apos;t remove — {dirtyCount} uncommitted {plural}
        </h2>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: 240,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          {entries.map((entry, index) => (
            <li key={index} style={{ display: "flex", gap: "var(--space-sm)", minWidth: 0 }}>
              <span className="type-label" style={{ flexShrink: 0 }}>
                {porcelainStatusWord(entry.code)}
              </span>
              <span
                className="type-body"
                style={{ fontFamily: MONO_STACK, overflowWrap: "anywhere", minWidth: 0 }}
              >
                {entry.path}
              </span>
            </li>
          ))}
        </ul>
        {looksPartial && (
          <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
            This list may be incomplete.
          </p>
        )}
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Commit, stash, or discard these changes in a terminal, then try again. Flywheel
          won&apos;t remove a worktree that would lose work.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="type-body control-edge"
            style={secondaryButtonStyle}
          >
            OK
          </button>
        </div>
      </>
    );
  }

  return createPortal(
    <FocusScope
      trapped
      loop
      asChild
      onMountAutoFocus={(event) => {
        event.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onPointerDownOutside={onClose}
        asChild
      >
        <div
          role="alertdialog"
          aria-label={ariaLabel}
          onKeyDown={handleKeyDown}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--scrim)",
          }}
        >
          <div
            className="type-body"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
              maxWidth: 420,
              padding: "var(--space-lg)",
              background: "var(--surface-secondary)",
              color: "var(--text-primary-rack)",
              border: "1px solid var(--border-control)",
              borderRadius: "var(--radius-chrome)",
              boxShadow: "var(--shadow-dialog)",
            }}
          >
            {body}
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
