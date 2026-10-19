/**
 * The persistent project switcher (01-UI-SPEC.md "Project switcher (left rail)"), regrouped into
 * three labelled sections (08.1 CONTEXT "Specific Ideas", adopted from the owner's reference):
 * PROJECTS (the switcher itself, with its register affordance), FLEET (facts about the running
 * fleet) and REVIEW QUEUE (what waits on the owner). Present whenever ≥1 project is registered and
 * absent before the first registration (`App.tsx` renders `FirstRun` instead in that case; this
 * component never mounts with zero projects). Each entry names the project and its key prefix.
 * The current project is marked NEUTRALLY, by a surface shift (08.1-UI-SPEC.md § The brand rule,
 * D-12): the brand carries progress, never the current position.
 *
 * The FLEET section's "All agents" row is an ENTRY POINT (Phase 10, D-163): it opens the fleet
 * surface, the one view of every agent across every project. 08.1 held every row in this rail back as
 * a read-only fact because "a row that looks like a button and does nothing is worse than a plain
 * number" — the fleet surface now exists, so that row is a real button. So is "Worktrees" (plan
 * 10-08): it opens the cross-project worktree inventory. It carries no count of its own, because a
 * count of the current project's worktrees beside a view of every project's would disagree with it;
 * the inventory's header holds the total.
 * REVIEW QUEUE holds the two rows that wait on the owner, and both are entry points (plan 10-05):
 * "Blocked" opens the blocked queue, and "Needs decision" opens the fleet list, where the NEEDS YOU
 * band is its first section.
 *
 * "Challenges" is also deliberately absent: pending items of that kind never surface in this rail
 * (D-46/D-82, pinned by `project-rail.test.tsx`'s source scan), so that comp row is not built.
 *
 * An unreachable project (D-16) renders a warning glyph *in addition to* its key glyph, plus the
 * literal word "Unreachable" — never a colour change alone (01-UI-SPEC.md "Accessibility").
 * Selecting it still calls `onSelect`; `App.tsx` is what decides an unreachable selection opens
 * `ProjectUnreachable` instead of a board — this component only renders the switcher itself.
 *
 * "Remove from Flywheel…" (D-200, D-REV-29) hides the CURRENT project and nothing else. It is a
 * reversible soft-hide, never a delete, and its confirmation says so by naming what is kept: the
 * board, the worktrees, the runs and the activity trail. Registering the same repository again
 * brings the project back. Afterwards the rail selects another project rather than leaving the
 * surface pointing at one that no longer lists.
 *
 * Each project entry carries its running sessions beneath it (docs/mvp-spec.md §7, #58): one row per live
 * (running or blocked) Story session, read from the fleet's own query so the rail and the fleet surface
 * can never disagree. A row names the Story and what its agent is doing now (the *doing* Task, else the
 * Story title), and opening it opens that session's feed. A project with nothing running shows no list.
 *
 * The `+` affordance at the rail's foot opens the SAME registration flow ⌘⇧O and the native File
 * menu use (`RegisterProjectFlow.tsx`) — never a second, rail-local copy of that sequence.
 *
 * Plan 02-06 Task 3 added a blocked-count badge (D-37, AGNT-06); plan 10-05 (FLEET-02) makes it
 * FLEET-WIDE: it is the length of the blocked queue's own read, across every registered project, not the
 * current project's share. Renders a numeral, never a raw dot, and renders no figure at all at zero
 * (never a visible "0").
 *
 * Plan 03-11 Task 3 added a SECOND, visually distinct figure for D-46's "recovery needed" count —
 * never summed with the blocked count, since the two carry different urgency (Blocked: a live agent is
 * waiting on the user right now; Needs Decision: a past session left something to decide, with no live
 * spend attached). That one remains the CURRENT project's count.
 */
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, TriangleAlert } from "lucide-react";
import { projectHide, type FleetRowDto } from "../adapters/tauri";
import glyphUrl from "../assets/logo-glyph.svg";
import type { Project } from "../board/useBoardQuery";
import { useRecoverySummary } from "../board/useBoardQuery";
import {
  blockedQueueQueryKey,
  fleetQueryKey,
  useBlockedQueue,
  useFleet,
  worktreeInventoryQueryKey,
} from "../fleet/useFleet";
import { isRunStatus, RUN_STATUS_LABELS } from "../legend/runStatus";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./RegisterProjectFlow";
import { useUiStore } from "../state/uiStore";

// The comp's rail is a labelled list, not an icon column (08.1-DIRECTION): wide enough for a project
// name beside its key and for a section row's label beside its count.
const RAIL_WIDTH = 184;
const NOTICE_VISIBLE_MS = 4000;

const railStyle: CSSProperties = {
  width: RAIL_WIDTH,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-md) var(--space-sm)",
  background: "var(--surface-secondary)",
  borderRight: "1px solid var(--divider)",
  height: "100%",
  overflowY: "auto",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };

const sectionLabelStyle: CSSProperties = {
  margin: 0,
  padding: "0 var(--space-sm) var(--space-xs)",
  fontWeight: 400,
  fontStretch: "75%",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-muted-rack)",
};

// One row grammar for every entry in every section: 32px, the chrome radius, label left, a trailing
// figure right. Rows are separated by space, not by rules or fills (D-10).
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
  minHeight: 32,
  padding: "var(--space-xs) var(--space-sm)",
  borderRadius: "var(--radius-chrome)",
  border: "none",
  background: "transparent",
  color: "var(--text-primary-rack)",
  textAlign: "left",
  position: "relative",
};

const entryStyle: CSSProperties = { ...rowStyle, width: "100%", cursor: "pointer" };

// Neutral current-position mark, never the brand. The rail's own ground (--surface-secondary) is within
// one step of the selected-row surface (#f6f8fa vs #f5f7f9, #0f0f0f vs #101010), so shifting to that
// colour would draw next to nothing: the current entry lifts to the page ground instead, with a
// hairline edge, and takes semibold. Not colour alone.
const currentEntryStyle: CSSProperties = {
  ...entryStyle,
  background: "var(--surface-dominant)",
  boxShadow: "inset 0 0 0 1px var(--divider)",
  fontWeight: 600,
};

const sessionRowStyle: CSSProperties = {
  ...entryStyle,
  minHeight: 24,
  padding: "2px var(--space-sm) 2px var(--space-md)",
  justifyContent: "flex-start",
  color: "var(--text-muted-rack)",
};

/** A live session: one a person could be watching. Finished sessions stay on the fleet surface only. */
function isLiveSession(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** One project's running sessions, under its entry. Renders nothing when none is running. */
function RunningSessions({ projectName, sessions }: { projectName: string; sessions: FleetRowDto[] }) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  if (sessions.length === 0) return null;
  return (
    <ul
      role="list"
      aria-label={`${projectName} running sessions`}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}
    >
      {sessions.map((session) => {
        const doing = session.doingTaskTitle;
        const subject = `${session.storyKey} ${session.storyTitle}`.trim();
        const blocked = session.runStatus === "blocked";
        return (
          <li key={session.sessionId}>
            <button
              type="button"
              className="type-label"
              data-session-id={session.sessionId}
              aria-label={doing ? `Open ${subject} session, doing ${doing}` : `Open ${subject} session`}
              title={doing ? `${subject}: ${doing}` : subject}
              onClick={() =>
                setActiveSessionId(
                  session.sessionId,
                  session.storyId,
                  null,
                  isRunStatus(session.runStatus) ? session.runStatus : null,
                )
              }
              style={sessionRowStyle}
            >
              <span className="tabular-nums" style={{ flexShrink: 0, color: "var(--text-primary-rack)" }}>
                {session.storyKey}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {doing ?? session.storyTitle}
              </span>
              {blocked && (
                // The word, never colour alone.
                <span style={{ flexShrink: 0, color: "var(--blocked-text-rack)", fontWeight: 600 }}>
                  {RUN_STATUS_LABELS.blocked}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface ProjectRailProps {
  projects: Project[];
  currentProjectId: string | undefined;
  onSelect: (project: Project) => void;
}

/** A labelled group of rows. `role="group"` named by its own label, so a screen reader hears the section. */
function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} style={sectionStyle}>
      <h2 id={id} className="type-label" style={sectionLabelStyle}>
        {label}
      </h2>
      {children}
    </div>
  );
}

export function ProjectRail({ projects, currentProjectId, onSelect }: ProjectRailProps) {
  const [notice, setNotice] = useState<string | null>(null);
  // The project id the open confirmation is FOR, so switching project never carries it across.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  const {
    registerProjectFlow,
    isError: registerIsError,
    error: registerError,
  } = useRegisterProjectFlow((result) => {
    if (result.alreadyRegistered) {
      // A clone being re-adopted (or the same repository re-registered) is a visible event, not
      // a silent one (01-UI-SPEC.md "Project switcher", this plan's own read of D-15) — surfaced
      // here rather than at ⌘⇧O/the palette, where the user already explicitly chose to
      // re-register a repository they typed the shortcut for.
      setNotice(`"${result.project.name}" was already registered.`);
      window.setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
    }
  });
  // The rail's `+` button was previously the third of three entry points that discarded
  // `isError`/`error` entirely (CR-02) — reuses the same transient-notice slot below rather than
  // a second one, and `FirstRun.tsx`'s own error copy/styling rather than a third idiom.
  const registrationErrorNotice = useRegistrationErrorNotice(registerIsError, registerError);
  // The fleet-wide blocked count (FLEET-02): the queue's own read, so the figure and the list cannot
  // disagree. Called unconditionally, above the early return below, so this hook's call order never
  // changes between renders (Rules of Hooks).
  const blockedCount = useBlockedQueue().data?.length ?? 0;
  // D-46's board-visible "recovery needed" count (plan 03-11 Task 3) — called unconditionally,
  // immediately after the blocked-count call above, for the same reason. A SEPARATE figure from
  // blockedCount, never summed into it: Blocked means a live agent is waiting on the user right
  // now; Needs Decision means a past session left something to decide with no live spend
  // attached — different urgencies, so a single number would flatten the one distinction the rail
  // exists to make at a glance.
  const recoverySummaryQuery = useRecoverySummary(currentProjectId);
  const recoveryCount = recoverySummaryQuery.data?.recoveryCount ?? 0;
  // Every project's running sessions, from the fleet's one app-wide read (#58). Also above the early
  // return, for the same reason.
  const liveSessions = (useFleet().data?.rows ?? []).filter(isLiveSession);

  const currentProject = projects.find((project) => project.id === currentProjectId);

  async function removeCurrentProject() {
    if (!currentProject) return;
    try {
      await projectHide(currentProject.id);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
      return;
    }
    setConfirmingRemoveId(null);
    setRemoveError(null);
    // Land on another project before the list refetches, so the surface never points at a project
    // that no longer lists. With none left, the empty list sends the app back to first run.
    const next = projects.find((project) => project.id !== currentProject.id);
    if (next) onSelect(next);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
  }

  if (projects.length === 0) {
    // Not present pre-first-registration — `App.tsx` renders `FirstRun` instead, but this guard
    // keeps the component itself honest even if a future caller renders it unconditionally.
    return null;
  }

  return (
    <nav aria-label="Projects" className="project-rail" style={railStyle}>
      {/* A-08(c): ink, not the brand-filled tile. The owner declined a fifth permitted brand use for an
          identity mark, so the rail follows FirstRun rather than keeping the fill it dropped. A CSS mask
          over the glyph-only asset lets `--text-primary-rack` colour it in both schemes; an <img> cannot
          read the page's tokens. Still a static file reference, never inline markup (T-08.1-05). */}
      <span
        role="img"
        aria-label="Flywheel by HighKnow"
        className="rail-mark"
        style={{
          maskImage: `url(${glyphUrl})`,
          WebkitMaskImage: `url(${glyphUrl})`,
          flexShrink: 0,
          margin: "0 var(--space-sm)",
        }}
      />
      <Section id="rail-projects" label="Projects">
        {projects.map((project) => {
          const isCurrent = project.id === currentProjectId;
          const isUnreachable = project.status === "unreachable";
          return (
            <div key={project.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                className="type-body"
                title={project.name}
                aria-label={isUnreachable ? `${project.name}, Unreachable` : project.name}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => onSelect(project)}
                style={{
                  ...(isCurrent ? currentEntryStyle : entryStyle),
                  color: isUnreachable ? "var(--text-muted-rack)" : "var(--text-primary-rack)",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: "var(--space-xs)", minWidth: 0, maxWidth: "100%" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
                    <span className="type-label tabular-nums" style={{ flexShrink: 0, color: "var(--text-muted-rack)" }}>
                      {project.keyPrefix}
                    </span>
                  </span>
                  {isUnreachable && (
                    // The word AND a glyph, never a colour change alone (01-UI-SPEC.md "Accessibility").
                    // Its own line, so the name is never truncated to make room for it.
                    <span
                      className="type-label"
                      style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--destructive-text-rack)" }}
                    >
                      <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
                      Unreachable
                    </span>
                  )}
                </span>
              </button>
              <RunningSessions
                projectName={project.name}
                sessions={liveSessions.filter((session) => session.projectId === project.id)}
              />
            </div>
          );
        })}
        <button
          type="button"
          className="type-body"
          aria-label="Register Project…"
          title="Register Project…"
          onClick={() => void registerProjectFlow()}
          style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--text-muted-rack)" }}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          <span style={{ flex: 1 }}>Register Project…</span>
        </button>
        {currentProject &&
          (confirmingRemoveId === currentProject.id ? (
            <div
              role="group"
              aria-label={`Remove ${currentProject.name} from Flywheel`}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", padding: "0 var(--space-sm)" }}
            >
              <p className="type-label" style={{ margin: 0, color: "var(--text-primary-rack)" }}>
                Remove {currentProject.name} from Flywheel? Its board, worktrees, runs and activity trail are all
                kept, and nothing is deleted. Register the repository again to bring it back.
              </p>
              <button
                type="button"
                className="type-body control-edge"
                onClick={() => void removeCurrentProject()}
                style={{ ...entryStyle, justifyContent: "flex-start" }}
              >
                Remove from Flywheel
              </button>
              <button
                type="button"
                className="type-body"
                onClick={() => {
                  setConfirmingRemoveId(null);
                  setRemoveError(null);
                }}
                style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--text-muted-rack)" }}
              >
                Keep it
              </button>
              {removeError && (
                <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  Couldn&rsquo;t remove it — {removeError}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="type-body"
              aria-label="Remove from Flywheel…"
              title="Hide this project. Nothing is deleted."
              onClick={() => setConfirmingRemoveId(currentProject.id)}
              style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--text-muted-rack)" }}
            >
              <span style={{ flex: 1 }}>Remove from Flywheel…</span>
            </button>
          ))}
      </Section>

      <Section id="rail-fleet" label="Fleet">
        <button
          type="button"
          className="type-body"
          aria-label="Open fleet"
          title="Every agent across every project"
          onClick={() => setFleetSurface({ view: "fleet" })}
          style={entryStyle}
        >
          <span>All agents</span>
        </button>
        <button
          type="button"
          className="type-body"
          aria-label="Open worktree inventory"
          title="Every task worktree across every project, with its disk usage"
          onClick={() => setWorktreeInventoryOpen(true)}
          style={entryStyle}
        >
          <span>Worktrees</span>
        </button>
      </Section>

      <Section id="rail-review-queue" label="Review queue">
        <button
          type="button"
          className="type-body"
          aria-label={blockedCount > 0 ? `Open blocked queue, ${blockedCount} waiting` : "Open blocked queue"}
          title="Open the blocked queue"
          onClick={() => setFleetSurface({ view: "queue" })}
          style={{ ...entryStyle, color: blockedCount > 0 ? "var(--text-primary-rack)" : "var(--text-muted-rack)" }}
        >
          <span>Blocked</span>
          {blockedCount > 0 && (
            // A numeral, never a raw dot (D-37) — absent entirely at zero, never a visible "0". The
            // blocked role is a data channel (D-11), so the figure takes the colour, not a fill.
            <span
              data-count="blocked"
              title={blockedCount === 1 ? "1 agent waiting on you" : `${blockedCount} agents waiting on you`}
              className="type-label tabular-nums"
              style={{ color: "var(--blocked-text-rack)", fontWeight: 600 }}
            >
              {blockedCount}
            </span>
          )}
        </button>
        {recoveryCount > 0 && (
          // Never merged with the blocked count (D-46): different urgency, so a different row and a
          // different data-channel role. It opens the fleet list, not the queue: the queue holds live
          // blocks only.
          <button
            type="button"
            className="type-body"
            aria-label="Open decisions"
            onClick={() => setFleetSurface({ view: "fleet" })}
            style={entryStyle}
          >
            <span>Needs decision</span>
            <span
              data-count="needs-decision"
              title={
                recoveryCount === 1 ? "1 task needs a decision." : `${recoveryCount} tasks need a decision.`
              }
              className="type-label tabular-nums"
              style={{ color: "var(--destructive-text-rack)", fontWeight: 600 }}
            >
              {recoveryCount}
            </span>
          </button>
        )}
      </Section>

      {notice && (
        <div
          role="status"
          className="type-label"
          style={{ color: "var(--text-muted-rack)", padding: "0 var(--space-sm)" }}
        >
          {notice}
        </div>
      )}
      {registrationErrorNotice && (
        <div
          role="status"
          className="type-label"
          style={{ color: "var(--destructive-text-rack)", padding: "0 var(--space-sm)" }}
        >
          {registrationErrorNotice}
        </div>
      )}
    </nav>
  );
}
