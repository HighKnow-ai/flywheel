/**
 * The launch sheet (D-27, 02-UI-SPEC.md "Launch sheet"): a briefing gate, not a confirmation
 * dialog. Reuses the command palette's scrim/`FocusScope`/`DismissableLayer`/portal mechanics
 * (`board/CommandPalette.tsx`) rather than a new overlay pattern, and the item-detail panel's
 * `⌘Enter`-to-save convention for its own free-text field.
 *
 * Mounted once at the `App.tsx` level — a peer of `CommandPalette` — and driven entirely by
 * `state/uiStore.ts`'s `launchSheetTaskId`: `null` renders nothing, a task id opens the sheet
 * against that task. `previewContextPacket` is the ONLY read this component issues before Start
 * Work fires (D-28) — it mutates nothing, creates no worktree, writes no trigger row and starts
 * no process, so opening and even Cancelling the sheet costs nothing (T-02-21's "nothing happens
 * until the primary action fires" property).
 *
 * No global `keydown` listener is registered here: Enter/⌘Enter/Tab are handled by this dialog's
 * own local `onKeyDown` (exactly the pattern `CommandPalette.tsx`'s own command list already
 * uses), and Escape is Radix `DismissableLayer`'s `onEscapeKeyDown` — never a second hand-rolled
 * `event.key === '...'` switch (`state/keyboard.ts`'s own house rule).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQuery } from "@tanstack/react-query";
import { previewContextPacket, startAgentRun, type ContextPacketDto } from "../adapters/tauri";

const MONO_FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The four permission-mode values (D-36), labelled exactly as 02-UI-SPEC.md's segmented control
 * specifies — one-to-one onto the adapter's mode values, no relabeling in between. `Accept Edits`
 * is first (and therefore the default selection, D-36). */
const PERMISSION_MODE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "default", label: "Ask Every Time" },
  { value: "bypassPermissions", label: "Bypass Permissions" },
];

const DEFAULT_PERMISSION_MODE = PERMISSION_MODE_OPTIONS[0].value;

const INSTRUCTION_PLACEHOLDER = "Anything else the agent should know for this run? (optional)";

function launchSheetPreviewQueryKey(taskId: string) {
  return ["launch-sheet-preview", taskId] as const;
}

/** A row-shaped placeholder for the near-instant window between the sheet mounting and the
 * preview resolving (E1 loading, 02-UI-SPEC.md State Inventory) — this codebase has no existing
 * skeleton-row component to reuse yet, so this is a minimal, self-contained equivalent: muted
 * bars, never an empty dialog and never a spinner. */
function PreviewSkeleton() {
  const barStyle = {
    height: 12,
    borderRadius: "var(--radius-chrome)",
    background: "var(--divider)",
  };
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <div style={{ ...barStyle, width: "40%" }} />
      <div style={{ ...barStyle, width: "90%" }} />
      <div style={{ ...barStyle, width: "70%" }} />
      <div style={{ ...barStyle, width: "55%" }} />
    </div>
  );
}

function PacketBody({ packet }: { packet: ContextPacketDto }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {packet.epicTitle && (
        <section>
          <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Epic
          </div>
          <div className="type-body">{packet.epicTitle}</div>
          {packet.epicDescription && (
            <p className="type-body" style={{ color: "var(--text-muted-rack)", whiteSpace: "pre-wrap" }}>
              {packet.epicDescription}
            </p>
          )}
        </section>
      )}

      <section>
        <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Task
        </div>
        <div className="type-body">{packet.taskTitle}</div>
        {packet.taskDescription && (
          <p className="type-body" style={{ color: "var(--text-muted-rack)", whiteSpace: "pre-wrap" }}>
            {packet.taskDescription}
          </p>
        )}
      </section>

      {packet.criteria.length > 0 && (
        <section>
          <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Acceptance Criteria
          </div>
          <ul style={{ margin: 0, paddingLeft: "var(--space-md)" }}>
            {packet.criteria.map((criterion, index) => (
              <li key={index} className="type-body">
                {criterion.statement}
                {criterion.verificationHint && (
                  <span style={{ color: "var(--text-muted-rack)" }}> — {criterion.verificationHint}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Worktree
        </div>
        <div
          className="type-body"
          style={{ fontFamily: MONO_FONT_STACK, overflowWrap: "anywhere" }}
        >
          {packet.branch} → {packet.baseRef}
        </div>
        <div
          className="type-body"
          style={{ fontFamily: MONO_FONT_STACK, color: "var(--text-muted-rack)", overflowWrap: "anywhere" }}
        >
          {packet.worktreePath}
        </div>
      </section>
    </div>
  );
}

export interface LaunchSheetProps {
  /** The task the sheet is open for, or `null` to render nothing (App.tsx-level mount pattern —
   * mirrors `SessionSurface`'s own `activeAgentRunId === null` convention). */
  taskId: string | null;
  onClose: () => void;
  /** Called with the new run's id once `startAgentRun` resolves — the caller decides what
   * "route to the session surface" means, matching `ItemDetailPanel.tsx`'s own
   * `onSessionStarted` precedent before this plan replaced it. */
  onStarted: (agentRunId: string) => void;
}

export function LaunchSheet({ taskId, onClose, onStarted }: LaunchSheetProps) {
  const [instruction, setInstruction] = useState("");
  const [permissionMode, setPermissionMode] = useState(DEFAULT_PERMISSION_MODE);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  const previewQuery = useQuery({
    queryKey: taskId ? launchSheetPreviewQueryKey(taskId) : ["launch-sheet-preview", "none"],
    queryFn: () => previewContextPacket(taskId as string),
    enabled: taskId !== null,
  });

  // Reset the per-open draft state whenever the sheet opens for a (possibly different) task —
  // reopening on a task that already has a worktree must not carry over a previous task's typed
  // instruction or mode choice.
  useEffect(() => {
    if (taskId !== null) {
      setInstruction("");
      setPermissionMode(DEFAULT_PERMISSION_MODE);
      setStarting(false);
      setError(null);
    }
  }, [taskId]);

  if (taskId === null) return null;

  function handleCancel() {
    onClose();
  }

  function handleSubmit() {
    if (starting) return;
    setStarting(true);
    setError(null);
    startAgentRun(taskId as string, permissionMode, instruction)
      .then((run) => {
        onStarted(run.id);
      })
      .catch((err: unknown) => {
        setStarting(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const inInstructionField = target === instructionRef.current;

    if (event.key === "Enter") {
      if (inInstructionField && !event.metaKey) {
        // Enter inserts a newline inside the free-text field — the textarea's own default
        // behaviour, so this branch does nothing but decline to submit.
        return;
      }
      event.preventDefault();
      handleSubmit();
    }
  }

  const packet = previewQuery.data;
  const showSkeleton = previewQuery.isPending;

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
            aria-label="Launch sheet"
            onKeyDown={handleDialogKeyDown}
            style={{
              width: 640,
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
            <header
              style={{
                padding: "var(--space-md)",
                borderBottom: "1px solid var(--divider)",
                flexShrink: 0,
              }}
            >
              <span className="type-heading">Start Work on {packet?.taskKey ?? ""}</span>
            </header>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}>
              {showSkeleton && <PreviewSkeleton />}
              {previewQuery.isError && (
                <p className="type-body" style={{ color: "var(--destructive-text-rack)" }}>
                  Could not load the briefing for this task. Close this sheet and try Start Work
                  again.
                </p>
              )}
              {packet && <PacketBody packet={packet} />}
              {error && (
                <p className="type-body" style={{ color: "var(--destructive-text-rack)" }}>
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
                flexDirection: "column",
                gap: "var(--space-md)",
              }}
            >
              <textarea
                ref={instructionRef}
                aria-label="Instruction"
                placeholder={INSTRUCTION_PLACEHOLDER}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={3}
                className="type-body"
                style={{
                  resize: "vertical",
                  background: "var(--surface-dominant)",
                  border: "1px solid var(--divider)",
                  borderRadius: "var(--radius-chrome)",
                  color: "inherit",
                  padding: "var(--space-sm)",
                }}
              />

              <div role="radiogroup" aria-label="Permission mode" style={{ display: "flex", gap: "var(--space-xs)" }}>
                {PERMISSION_MODE_OPTIONS.map((option) => {
                  const selected = option.value === permissionMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPermissionMode(option.value)}
                      className="type-label"
                      style={{
                        flex: 1,
                        padding: "var(--space-xs) var(--space-sm)",
                        border: "1px solid var(--divider)",
                        borderRadius: "var(--radius-chrome)",
                        background: selected ? "var(--accent-nontext)" : "transparent",
                        color: selected ? "var(--text-primary-rack)" : "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
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
                  onClick={handleSubmit}
                  disabled={starting}
                  className="type-body"
                  style={{
                    background: "var(--accent-nontext)",
                    border: "none",
                    borderRadius: "var(--radius-chrome)",
                    color: "var(--text-primary-rack)",
                    padding: "var(--space-xs) var(--space-md)",
                    cursor: starting ? "default" : "pointer",
                  }}
                >
                  {starting ? "Starting…" : "Start Work"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
