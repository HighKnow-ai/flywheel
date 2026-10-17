/**
 * The launch sheet (D-27, 02-UI-SPEC.md "Launch sheet"): a briefing gate, not a confirmation
 * dialog. Reuses the command palette's scrim/`FocusScope`/`DismissableLayer`/portal mechanics
 * (`board/CommandPalette.tsx`) rather than a new overlay pattern, and the item-detail panel's
 * `⌘Enter`-to-save convention for its own free-text field.
 *
 * Mounted once at the `App.tsx` level — a peer of `CommandPalette` — and driven entirely by
 * `state/uiStore.ts`'s `launchSheetTaskId`: `null` renders nothing, a task id opens the sheet
 * against that task. Before Start Work fires it only reads (the task header and its criteria
 * coverage) — it mutates nothing, creates no worktree, writes no trigger row and starts no
 * process, so opening and even Cancelling the sheet costs nothing (T-02-21's "nothing happens
 * until the primary action fires" property). The context packet preview and the epic-authoring
 * variant were deleted by issue #38; the MVP rebuilds the packet.
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
import { startAgentRun, taskCriterionCoverage, taskHeader, waiveTaskCriteria } from "../adapters/tauri";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import { AcceptanceCriteriaList } from "../item-detail/AcceptanceCriteriaList";
import "../session/session.css";

/** The permission mode every run started from this sheet uses (ADR 0001). Flywheel picks the mode;
 * the sheet offers no choice. */
const RUN_PERMISSION_MODE = "acceptEdits";

const INSTRUCTION_PLACEHOLDER = "Anything else the agent should know for this run? (optional)";

function launchSheetHeaderQueryKey(taskId: string) {
  return ["launch-sheet-header", taskId] as const;
}

/** D-12's coverage read, one query per task. Re-read on `board:changed` like every other board read. */
function criterionCoverageQueryKey(taskId: string) {
  return ["task-criterion-coverage", taskId] as const;
}

/** D-11: why Start Work is blocked, in words. A pending draft is not a contract (D-12 keeps it from
 * being drafted twice, not from needing a decision). */
function noContractSentence(pendingDraftCount: number) {
  const lead = "This task has no acceptance criteria";
  const why = "a run against no contract is what the criteria freeze at Start Work exists to prevent";
  if (pendingDraftCount > 0) {
    const noun = pendingDraftCount === 1 ? "drafted criterion is" : "drafted criteria are";
    return `${lead} yet: ${pendingDraftCount} ${noun} waiting for your decision. Start Work unlocks once one is decided; ${why}.`;
  }
  return `${lead}. Write one below, or proceed without; ${why}.`;
}

export interface LaunchSheetProps {
  /** The task the sheet is open for, or `null` to render nothing (App.tsx-level mount pattern —
   * mirrors `SessionSurface`'s own `activeAgentRunId === null` convention). */
  taskId: string | null;
  onClose: () => void;
  /** Called with the new run's id once `startAgentRun` resolves — the caller decides what
   * "route to the session surface" means, matching `ItemDetailPanel.tsx`'s own
   * `onSessionStarted` precedent before this plan replaced it. The second argument is Rust's
   * overlap warning for a launch that overlaps a DIFFERENT live task (plan 09-13), passed on so a
   * host that closes the sheet in this callback can still show it. */
  onStarted: (agentRunId: string, overlapWarning?: string | null) => void;
}

export function LaunchSheet({ taskId, onClose, onStarted }: LaunchSheetProps) {
  const [instruction, setInstruction] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  // WR-03 (plan 05-09 code review): `handleSubmit` is reachable both from a click on the submit
  // button and, independently, from `handleDialogKeyDown`'s own Enter branch — React has not
  // necessarily flushed the `starting` state's disabling re-render before a second activation
  // fires in the same synchronous tick, so a ref (synchronous read/write) is the guard, mirroring
  // this codebase's own established pattern (`SessionSurface.tsx`'s `stoppingRef`/`discardingRef`).
  const startingRef = useRef(false);

  const headerQuery = useQuery({
    queryKey: taskId ? launchSheetHeaderQueryKey(taskId) : ["launch-sheet-header", "none"],
    queryFn: () => taskHeader(taskId as string),
    enabled: taskId !== null,
  });

  // D-11/D-12: the gate. Fail open — a coverage read that errors blocks nothing (T-15-30), and only a
  // definite "no current criteria" routes through drafting. The sheet never recomputes the definition.
  const coverageQuery = useQuery({
    queryKey: taskId ? criterionCoverageQueryKey(taskId) : ["task-criterion-coverage", "none"],
    queryFn: () => taskCriterionCoverage(taskId as string),
    enabled: taskId !== null,
  });
  useBoardChangedInvalidation({ kind: "viewed" }, taskId ? [criterionCoverageQueryKey(taskId)] : []);
  const [waived, setWaived] = useState(false);
  const waivingRef = useRef(false);
  const coverage = coverageQuery.data;
  const needsContract = !waived && coverage !== undefined && coverage.currentCount === 0;

  // Reset the per-open draft state whenever the sheet opens for a (possibly different) task —
  // reopening on a task that already has a worktree must not carry over a previous task's typed
  // instruction.
  useEffect(() => {
    if (taskId !== null) {
      setInstruction("");
      setStarting(false);
      startingRef.current = false;
      setError(null);
      setOverlapWarning(null);
      setWaived(false);
      waivingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  if (taskId === null) return null;

  function handleCancel() {
    onClose();
  }

  /** D-13: the escape hatch. One recorded call, no confirmation (a task no lint will pass must still
   * be startable); the ref makes two synchronous activations one call. */
  function handleWaive() {
    if (waivingRef.current) return;
    waivingRef.current = true;
    waiveTaskCriteria(taskId as string)
      .then(() => setWaived(true))
      .catch((err: unknown) => {
        waivingRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  function handleSubmit() {
    // D-11: Start Work is blocked, not the task. Guarded here, not only on the button, because Enter
    // reaches this function from `handleDialogKeyDown` too.
    if (needsContract) return;
    // The synchronous-tick guard (WR-03, see startingRef's own doc comment above) — checked and
    // set BEFORE the `starting` state guard, since the ref is what is actually safe against two
    // activations racing in the same tick; `starting` state still drives the disabled button and
    // the "Starting…" label as before.
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    startAgentRun(taskId as string, RUN_PERMISSION_MODE, instruction)
      .then((run) => {
        setOverlapWarning(run.overlapWarning ?? null);
        onStarted(run.id, run.overlapWarning ?? null);
      })
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

  const header = headerQuery.data;
  const headerLabel = `Start Work on ${header?.key ?? ""}`;
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
              {header && (
                <section>
                  <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                    Task
                  </div>
                  <div className="type-body">{header.title}</div>
                </section>
              )}
              {/* D-02: the SAME criteria form the item panel uses, composed — not a sheet-local editor. */}
              {needsContract && (
                <AcceptanceCriteriaList
                  parentType="task"
                  parentId={taskId as string}
                  projectId={coverage?.projectId ?? undefined}
                  autoOpenWhenEmpty
                />
              )}
              {error && (
                <p className="type-body" style={{ color: "var(--destructive-text-rack)" }}>
                  {error}
                </p>
              )}
              {/* Plan 09-13: the launch went ahead over a live task; Rust's own sentence, shown as
                  given — this component composes no task name and compares no path. Not the alert
                  role: that is reserved for money burning, and an overlap the user chose is not that. */}
              {overlapWarning && (
                <p
                  role="note"
                  aria-label="Launch overlap warning"
                  className="type-body"
                  style={{ color: "var(--destructive-text-rack)" }}
                >
                  {overlapWarning}
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

              {needsContract && coverage && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}>
                  <p
                    role="note"
                    aria-label="No acceptance criteria"
                    className="type-body"
                    style={{ flex: 1, margin: 0, color: "var(--text-muted-rack)" }}
                  >
                    {noContractSentence(coverage.pendingDraftCount)}
                  </p>
                  <button
                    type="button"
                    onClick={handleWaive}
                    title="Starts the run with no contract. Recorded on the task's activity trail."
                    className="session-text-action type-body"
                  >
                    Proceed without criteria
                  </button>
                </div>
              )}

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
                  disabled={starting || needsContract}
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
