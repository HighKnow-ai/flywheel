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
 */
import { useForgeRequest } from "../board/useBoardQuery";
import type { ForgeRequestDto } from "../adapters/tauri";

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

export interface ForgeSectionProps {
  taskId: string;
}

export function ForgeSection({ taskId }: ForgeSectionProps) {
  const query = useForgeRequest(taskId);

  // E6 `loading`/`empty`, following WorktreeSummary.tsx/GitFactsSection.tsx's own discipline:
  // nothing renders while the read is in flight, and nothing renders for the no-forge-configured,
  // no-worktree-yet or no-request outcomes — never a labelled header, never a placeholder.
  if (query.isPending || !query.data) return null;

  const read = query.data;

  if (
    read.outcome === "noForgeConfigured" ||
    read.outcome === "noWorktree" ||
    read.outcome === "noRequest"
  ) {
    return null;
  }

  return (
    <section
      aria-label="Forge"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}
    >
      {read.outcome === "request" && (
        <RequestBody request={read.request} unmetCriteria={read.unmetCriteria} />
      )}

      {read.outcome === "cliNotInstalled" && (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          <span style={{ fontFamily: MONO_STACK }}>{read.cli}</span> is not installed — a forge is
          configured for this project, but request/CI state cannot be read without it.
        </p>
      )}

      {read.outcome === "cliNotAuthenticated" && (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          <span style={{ fontFamily: MONO_STACK }}>{read.cli}</span> is installed but not
          authenticated — run{" "}
          <span style={{ fontFamily: MONO_STACK }}>{read.cli} auth login</span>.
        </p>
      )}

      {(read.outcome === "cliFailed" || read.outcome === "malformedJson") && (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Could not read the forge for this task right now.
        </p>
      )}
    </section>
  );
}
