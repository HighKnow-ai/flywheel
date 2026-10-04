/**
 * The forge section (Phase 7 plan 07-08, LINK-05/LINK-06, D-120/D-123): a task's pull/merge
 * request state, its CI result with a link out to the run, and the unresolved-acceptance-criteria
 * marker a merge can raise. Reads through `useForgeRequest` (`board/useBoardQuery.ts`), a live
 * `staleTime: 0` read invalidated by `subscribeBoardChanged` — never a cached verdict (D-75).
 *
 * This section's own defining property, stated here in `WorktreeSummary.tsx`'s own voice: it
 * renders NOTHING AT ALL — no labelled header, no placeholder, no project-level notice — when no
 * forge is configured for the project (D-120, absence is the design), deliberately UNLIKE
 * `ActivityTrail.tsx`/`AcceptanceCriteriaList.tsx`, which always render a labelled header even
 * when their own list is empty. D-120 named and rejected two alternatives this file must not
 * reintroduce: a labelled empty state naming the missing capability and routing to the setting
 * (permanent furniture on every item of a project that may never have a forge), and a single
 * project-level notice instead (a third place to look, after the board and the settings pane).
 * The same "render null" path also covers a task with no `worktrees` row yet (`NoWorktree`,
 * before "Start Work") and a forge configured with no open request for this branch
 * (`NoRequest`) — neither has anything renderable to show, and D-120's own absence discipline
 * applies equally to both.
 *
 * The three CLI-error outcomes read differently from each other and from "no forge configured"
 * (RESEARCH.md open question 3, `<decisions_resolved>`): CLI-not-installed names the missing
 * command, CLI-not-authenticated names the command to run, and `CliFailed`/`MalformedJson` share
 * one generic "could not read the forge" notice — never the CLI's raw stderr, which never crosses
 * the IPC boundary in the first place (`commands/forge.rs`'s own header comment, T-07-08-01).
 *
 * Phase 07 plan 07-09 (D-118, LINK-05's create half) adds the open-request action, rendered
 * exactly when the read resolves to `noRequest` — forge configured, worktree present, nothing
 * open for this branch yet, the one condition under which `<decisions_resolved>` says the action
 * belongs. Pressing it fetches the deterministic draft (`forgeRequestDraft`) and renders its
 * title and body with confirm/cancel controls BEFORE anything is sent — the launch sheet's own
 * "see it before you spend it" shape (plan 02-04) applied here to a forge write instead of a
 * model call. Confirming calls `forgeOpenRequest(taskId)` with the task id alone: the component
 * never passes a title or a body, which is what makes the previewed text and the published text
 * the same text by construction (T-07-09-01) rather than by a promise this file would have to
 * keep. A successful open renders the new request exactly as `useForgeRequest`'s own
 * `board:changed` invalidation would show one opened outside Flywheel — no separate success
 * banner. This component sets no task status itself: the In Review move is plan 07-07's poll.
 */
import { useState } from "react";
import { useForgeRequest } from "../board/useBoardQuery";
import { forgeOpenRequest, forgeRequestDraft } from "../adapters/tauri";
import type { ForgeRequestDto, RequestDraftDto } from "../adapters/tauri";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** LINK-05: the request's lifecycle state in words, never colour alone. */
function requestStateLabel(state: ForgeRequestDto["state"]): string {
  switch (state) {
    case "Open":
      return "Open";
    case "ChangesRequested":
      return "Changes requested";
    case "Merged":
      return "Merged";
    case "ClosedUnmerged":
      return "Closed without merging";
    case "None":
    default:
      return "No request";
  }
}

/** LINK-06: the CI result in words — `null` (the caller's own "no CI element" early return,
 * `CiResult::None`) is handled by the caller, never reaching this function. */
function ciResultLabel(ci: ForgeRequestDto["ci"]): string {
  switch (ci) {
    case "Pending":
      return "CI pending";
    case "Passed":
      return "CI passed";
    case "Failed":
      return "CI failed";
    case "None":
    default:
      return "";
  }
}

function RequestBody({
  request,
  unmetCriteria,
}: {
  request: ForgeRequestDto;
  unmetCriteria: number;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", minWidth: 0 }}>
        <a
          href={request.url}
          target="_blank"
          rel="noreferrer"
          className="type-body"
          style={{ color: "var(--accent-text-rack)", overflowWrap: "anywhere" }}
        >
          #{request.number} {request.title}
        </a>
      </div>
      <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
        {requestStateLabel(request.state)}
      </p>

      {request.ci !== "None" && (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          {request.ciUrl ? (
            <a
              href={request.ciUrl}
              target="_blank"
              rel="noreferrer"
              className="type-body"
              style={{ color: "var(--accent-text-rack)" }}
            >
              {ciResultLabel(request.ci)}
            </a>
          ) : (
            ciResultLabel(request.ci)
          )}
        </p>
      )}

      {unmetCriteria > 0 && (
        // D-123: a merge carried this task to Done past unmet acceptance criteria — git stays
        // the truth, and this marker is what keeps the gap from being scrollable-past. The
        // criteria rows themselves stay exactly as unchecked as they already are in
        // `AcceptanceCriteriaList.tsx`, which this marker does not touch.
        <p
          role="alert"
          className="type-body"
          style={{ margin: 0, color: "var(--destructive-text-rack)" }}
        >
          Merged with {unmetCriteria} unresolved acceptance{" "}
          {unmetCriteria === 1 ? "criterion" : "criteria"}
        </p>
      )}
    </>
  );
}

/** The three distinguishable CLI-error categories a read OR an open can surface (RESEARCH.md
 * open question 3) — `cliFailed`/`malformedJson` share one generic notice below, matching the
 * read path's own collapse of those two. */
type CliNoticeOutcome = "cliNotInstalled" | "cliNotAuthenticated" | "cliFailed" | "malformedJson";

/** The one shared rendering of the three CLI-error notices (T-07-08-01's "never the raw stderr"
 * discipline, extended here to the open path) — used both by the read path's switch below and by
 * `OpenRequestAction`'s own error state, so the wording can never drift between the two surfaces. */
function CliErrorNotice({ outcome, cli }: { outcome: CliNoticeOutcome; cli: string }) {
  if (outcome === "cliNotInstalled") {
    return (
      <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
        <span style={{ fontFamily: MONO_STACK }}>{cli}</span> is not installed — a forge is
        configured for this project, but request/CI state cannot be read without it.
      </p>
    );
  }
  if (outcome === "cliNotAuthenticated") {
    return (
      <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
        <span style={{ fontFamily: MONO_STACK }}>{cli}</span> is installed but not authenticated —
        run <span style={{ fontFamily: MONO_STACK }}>{cli} auth login</span>.
      </p>
    );
  }
  return (
    <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
      Could not read the forge for this task right now.
    </p>
  );
}

/** Parse `forgeOpenRequest`'s rejection message, packed by `commands/forge.rs` as
 * `"<category>:<cli>"` (never the CLI's raw stderr, T-07-09-08). An unparseable message — a
 * connection-lock failure, a draft-assembly error, anything that is not one of the four typed
 * forge categories — degrades to the same generic `cliFailed` notice rather than surfacing raw
 * text, which this component never has a home for. */
function parseOpenRequestError(message: string): { outcome: CliNoticeOutcome; cli: string } {
  const [category, cli] = message.split(":", 2);
  if (
    category === "cliNotInstalled" ||
    category === "cliNotAuthenticated" ||
    category === "cliFailed" ||
    category === "malformedJson"
  ) {
    return { outcome: category, cli: cli ?? "" };
  }
  return { outcome: "cliFailed", cli: "" };
}

/**
 * The open-request action (D-118): a button that previews the deterministic draft before
 * sending anything, then a confirm/cancel pair once the draft is shown. `draft === null` is the
 * button's own resting state; setting it back to `null` (Cancel) returns to that resting state
 * and sends nothing — the preview is never auto-dismissed by anything other than the user's own
 * Cancel or a successful Confirm's `board:changed` invalidation unmounting this outcome entirely.
 */
function OpenRequestAction({ taskId }: { taskId: string }) {
  const [draft, setDraft] = useState<RequestDraftDto | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<{ outcome: CliNoticeOutcome; cli: string } | null>(
    null,
  );

  async function handlePreview() {
    setIsLoadingDraft(true);
    setOpenError(null);
    try {
      const fetched = await forgeRequestDraft(taskId);
      setDraft(fetched);
    } catch {
      // The draft read failing (a stale task id, a locked connection) has no home in this
      // component's own three-category error state — the button simply stays, unpressed.
    } finally {
      setIsLoadingDraft(false);
    }
  }

  function handleCancel() {
    setDraft(null);
    setOpenError(null);
  }

  async function handleConfirm() {
    setIsOpening(true);
    setOpenError(null);
    try {
      await forgeOpenRequest(taskId);
      // Success: `forge_open_request`'s own `board:changed` emit invalidates `useForgeRequest`
      // (`board/useBoardQuery.ts`), which re-renders this task's outcome as `request` — this
      // component's parent stops rendering `OpenRequestAction` at all. No local success state.
    } catch (err) {
      setOpenError(parseOpenRequestError(err instanceof Error ? err.message : String(err)));
      setIsOpening(false);
    }
  }

  if (!draft) {
    return (
      <button
        type="button"
        disabled={isLoadingDraft}
        onClick={() => void handlePreview()}
        className="type-label"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-muted-rack)",
          textDecoration: "underline",
          padding: 0,
          cursor: "pointer",
          opacity: isLoadingDraft ? 0.6 : 1,
          alignSelf: "flex-start",
        }}
      >
        Open request
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}>
      <p className="type-body" style={{ margin: 0, fontWeight: 600, color: "var(--text-primary-rack)" }}>
        {draft.title}
      </p>
      <pre
        className="type-body"
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          color: "var(--text-primary-rack)",
          fontFamily: "inherit",
        }}
      >
        {draft.body}
      </pre>

      {openError && <CliErrorNotice outcome={openError.outcome} cli={openError.cli} />}

      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <button
          type="button"
          disabled={isOpening}
          onClick={() => void handleConfirm()}
          className="type-label"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent-text-rack)",
            textDecoration: "underline",
            padding: 0,
            cursor: "pointer",
            opacity: isOpening ? 0.6 : 1,
          }}
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={isOpening}
          onClick={handleCancel}
          className="type-label"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted-rack)",
            textDecoration: "underline",
            padding: 0,
            cursor: "pointer",
            opacity: isOpening ? 0.6 : 1,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export interface ForgeSectionProps {
  taskId: string;
}

export function ForgeSection({ taskId }: ForgeSectionProps) {
  const query = useForgeRequest(taskId);

  // E6 `loading`/`empty`, following WorktreeSummary.tsx/GitFactsSection.tsx's own discipline:
  // nothing renders while the read is in flight, and nothing renders for the no-forge-configured
  // or no-worktree-yet outcomes — never a labelled header, never a placeholder. `noRequest` is
  // NOT in this early-return list (plan 07-09): forge configured, worktree present, nothing open
  // for this branch yet is precisely the one condition the open-request action belongs under.
  if (query.isPending || !query.data) return null;

  const read = query.data;

  if (read.outcome === "noForgeConfigured" || read.outcome === "noWorktree") {
    return null;
  }

  return (
    <section
      aria-label="Forge"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}
    >
      {read.outcome === "noRequest" && <OpenRequestAction taskId={taskId} />}

      {read.outcome === "request" && (
        <RequestBody request={read.request} unmetCriteria={read.unmetCriteria} />
      )}

      {(read.outcome === "cliNotInstalled" ||
        read.outcome === "cliNotAuthenticated" ||
        read.outcome === "cliFailed" ||
        read.outcome === "malformedJson") && (
        <CliErrorNotice outcome={read.outcome} cli={read.cli} />
      )}
    </section>
  );
}
