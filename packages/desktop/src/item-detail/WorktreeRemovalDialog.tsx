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

function porcelainStatusWord(code: string): string {
  if (code === PORCELAIN_UNTRACKED_CODE) return "Untracked";
  return PORCELAIN_STATUS_WORDS[code.charAt(0)] ?? PORCELAIN_FALLBACK_WORD;
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: "var(--space-xs) var(--space-md)",
  borderRadius: "var(--radius-chrome)",
  border: "1px solid var(--divider)",
  background: "var(--surface-dominant)",
  color: "var(--text-primary-rack)",
  cursor: "pointer",
};

const destructiveButtonStyle: React.CSSProperties = {
  padding: "var(--space-xs) var(--space-md)",
  borderRadius: "var(--radius-chrome)",
  border: "1px solid var(--destructive-strip)",
  background: "var(--destructive-strip)",
  // `--text-primary-rack` measures 6.3:1 against `--destructive-strip`, well past AA — the same
  // ratio note `DeleteConfirm.tsx`'s own "Delete" button carries.
  color: "var(--text-primary-rack)",
  cursor: "pointer",
};

export interface WorktreeRemovalDialogProps {
  taskId: string;
  onClose: () => void;
}

export function WorktreeRemovalDialog({ taskId, onClose }: WorktreeRemovalDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const check = useWorktreeRemovalCheck(taskId, true);
  const removeWorktree = useRemoveWorktree(taskId);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  async function handleRemove() {
    if (removeWorktree.isPending) return;
    setRemoveError(null);
    try {
      await removeWorktree.mutateAsync();
      onClose();
    } catch {
      setRemoveError("Could not remove the worktree. Try again.");
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
            className="type-body"
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
        {removeError && (
          <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
            {removeError}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="type-body"
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={removeWorktree.isPending}
            onClick={() => void handleRemove()}
            className="type-body"
            style={{
              ...destructiveButtonStyle,
              opacity: removeWorktree.isPending ? 0.6 : 1,
              cursor: removeWorktree.isPending ? "default" : "pointer",
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
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Commit, stash, or discard these changes in a terminal, then try again. Flywheel
          won&apos;t remove a worktree that would lose work.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="type-body"
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
            background: "rgba(0,0,0,0.45)",
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
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
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
