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
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const INSTRUCTION_PLACEHOLDER = "Anything else the agent should know for this run? (optional)";

function launchSheetStoryQueryKey(storyId: string) {
  return ["launch-sheet-story", storyId] as const;
}

export interface LaunchSheetProps {
  /** The Story the sheet is open for, or `null` to render nothing (App.tsx-level mount pattern —
   * mirrors `SessionSurface`'s own `activeSessionId === null` convention). */
  storyId: string | null;
  onClose: () => void;
  /** Called with the new run's id and its Story's project once `startSession` resolves. The caller
   * decides where to land; it never opens the session on its own (issue #104). */
  onStarted: (sessionId: string, projectId: string | null) => void;
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
    // No permission mode is sent: the session kind decides it, never the developer (ADR 0001).
    startSession(storyId as string, instruction)
      .then((run) => onStarted(run.id, storyQuery.data?.projectId ?? null))
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
        <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-(--scrim)">
          <div
            role="dialog"
            aria-label="Launch sheet"
            onKeyDown={handleDialogKeyDown}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay"
            style={{ width: 640, maxHeight: "80vh" }}
          >
            <header className="shrink-0 border-b border-border px-5 py-4">
              <span className="text-section font-semibold">{headerLabel}</span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {story && (
                <section className="flex flex-col gap-1">
                  <div className="text-meta font-semibold text-muted-foreground">Story</div>
                  <div className="text-row font-semibold">{story.title}</div>
                </section>
              )}
              {error && <p className="mt-3 mb-0 text-small text-destructive-text">{error}</p>}
            </div>

            <div className="flex shrink-0 flex-col gap-4 border-t border-border bg-muted/50 px-5 py-4">
              <Textarea
                ref={instructionRef}
                aria-label="Instruction"
                placeholder={INSTRUCTION_PLACEHOLDER}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={3}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={starting}>
                  <Play aria-hidden="true" />
                  {submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
