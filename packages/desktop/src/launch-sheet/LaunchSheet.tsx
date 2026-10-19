/**
 * The launch sheet (D-27, 02-UI-SPEC.md "Launch sheet"): a briefing gate, not a confirmation
 * dialog. Reuses the command palette's scrim/`FocusScope`/`DismissableLayer`/portal mechanics
 * rather than a new overlay pattern, and the `⌘Enter`-to-save convention for its own free-text field.
 *
 * Mounted once at the `App.tsx` level and driven entirely by `state/uiStore.ts`'s
 * `launchSheetStoryId`: `null` renders nothing, a Story id opens the sheet against that Story.
 * Before Start Work fires it only reads (the Story itself) — it mutates nothing, creates no
 * worktree, writes no trigger row and starts no process, so opening and even Cancelling the sheet
 * costs nothing (T-02-21's "nothing happens until the primary action fires" property). Whether the
 * Story may start is the Rust core's decision: a refused start is shown as the core's own words.
 *
 * No global `keydown` listener is registered here: Enter/⌘Enter/Tab are handled by this dialog's
 * own local `onKeyDown`, and Escape is Radix `DismissableLayer`'s `onEscapeKeyDown` — never a second
 * hand-rolled `event.key === '...'` switch (`state/keyboard.ts`'s own house rule).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQuery } from "@tanstack/react-query";
import { startSession, storyGet } from "../adapters/tauri";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import "../session/session.css";

/** The permission mode every run started from this sheet uses (ADR 0001). Flywheel picks the mode;
 * the sheet offers no choice. */
const RUN_PERMISSION_MODE = "acceptEdits";

const INSTRUCTION_PLACEHOLDER = "Anything else the agent should know for this run? (optional)";

function launchSheetStoryQueryKey(storyId: string) {
  return ["launch-sheet-story", storyId] as const;
}

export interface LaunchSheetProps {
  /** The Story the sheet is open for, or `null` to render nothing (App.tsx-level mount pattern —
   * mirrors `SessionSurface`'s own `activeSessionId === null` convention). */
  storyId: string | null;
  onClose: () => void;
  /** Called with the new run's id once `startSession` resolves — the caller decides what
   * "route to the session surface" means. */
  onStarted: (sessionId: string) => void;
}

export function LaunchSheet({ storyId, onClose, onStarted }: LaunchSheetProps) {
  const [instruction, setInstruction] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  // WR-03 (plan 05-09 code review): `handleSubmit` is reachable both from a click on the submit
  // button and, independently, from `handleDialogKeyDown`'s own Enter branch — React has not
  // necessarily flushed the `starting` state's disabling re-render before a second activation
  // fires in the same synchronous tick, so a ref (synchronous read/write) is the guard, mirroring
  // this codebase's own established pattern (`SessionSurface.tsx`'s `stoppingRef`/`discardingRef`).
  const startingRef = useRef(false);

  const storyQuery = useQuery({
    queryKey: storyId ? launchSheetStoryQueryKey(storyId) : ["launch-sheet-story", "none"],
    queryFn: () => storyGet(storyId as string),
    enabled: storyId !== null,
  });
  useBoardChangedInvalidation({ kind: "viewed" }, storyId ? [launchSheetStoryQueryKey(storyId)] : []);

  // Reset the per-open draft state whenever the sheet opens for a (possibly different) Story —
  // reopening must not carry over a previous Story's typed instruction.
  useEffect(() => {
    if (storyId !== null) {
      setInstruction("");
      setStarting(false);
      startingRef.current = false;
      setError(null);
    }
  }, [storyId]);

  if (storyId === null) return null;

  function handleCancel() {
    onClose();
  }

  function handleSubmit() {
    // The synchronous-tick guard (WR-03, see startingRef's own doc comment above) — checked and
    // set BEFORE the `starting` state guard, since the ref is what is actually safe against two
    // activations racing in the same tick; `starting` state still drives the disabled button and
    // the "Starting…" label.
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    startSession(storyId as string, RUN_PERMISSION_MODE, instruction)
      .then((run) => onStarted(run.id))
      .catch((err: unknown) => {
        startingRef.current = false;
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

  const story = storyQuery.data;
  const headerLabel = `Start Work on ${story?.key ?? ""}`;
  const submitLabel = starting ? "Starting…" : "Start Work";

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
        <div role="presentation" className="launch-scrim">
          <div
            role="dialog"
            aria-label="Launch sheet"
            onKeyDown={handleDialogKeyDown}
            className="launch-sheet"
            style={{ width: 640, maxHeight: "80vh" }}
          >
            <header
              style={{
                padding: "var(--space-md)",
                borderBottom: "1px solid var(--divider)",
                flexShrink: 0,
              }}
            >
              <span className="type-heading">{headerLabel}</span>
            </header>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}>
              {story && (
                <section>
                  <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                    Story
                  </div>
                  <div className="type-body">{story.title}</div>
                </section>
              )}
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
                className="control-edge session-field launch-field type-body"
              />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)" }}>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="control-edge session-action type-body"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={starting}
                  className="control-edge session-action session-action-lead type-body"
                >
                  {submitLabel}
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
