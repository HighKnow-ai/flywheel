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
 * WAITING ON YOU (#57, docs/mvp-spec.md §4.1) sits at the very top, above PROJECTS: the count of
 * Gated actions and permission requests waiting on the owner across every project, opening the
 * queue of them. REVIEW QUEUE holds "Needs decision", which opens the fleet list, where the NEEDS
 * YOU band is its first section; it shows only when something needs a decision.
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
 * Story title). The row opens the Story; its "Session" control, and only that, opens the live session
 * (issue #104). A project with nothing running shows no list.
 *
 * The rail shows where the developer is (issue #104): the current project is marked, and so is the
 * current Story under it (the Story open in the Story view, or the Story of the open session), as its
 * running row or, when it is not running, as a row of its own.
 *
 * The `+` affordance at the rail's foot opens the SAME registration flow ⌘⇧O and the native File
 * menu use (`RegisterProjectFlow.tsx`) — never a second, rail-local copy of that sequence.
 *
 * The waiting count is FLEET-WIDE: the length of the queue's own read (one entry per waiting request),
 * across every registered project, not the current project's share. Renders a numeral, never a raw
 * dot, and renders no figure at all at zero (never a visible "0").
 *
 * Plan 03-11 Task 3 added a SECOND, visually distinct figure for D-46's "recovery needed" count —
 * never summed with the waiting count, since the two carry different urgency (Waiting on you: a live agent is
 * waiting on the user right now; Needs Decision: a past session left something to decide, with no live
 * spend attached). That one remains the CURRENT project's count.
 */
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TriangleAlert } from "lucide-react";
import { projectHide, storyGet, type FleetRowDto, type StoryDto } from "../adapters/tauri";
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
import { isRunStatus } from "../legend/runStatus";
import { StateBadge } from "../components/StateBadge";
import { Badge } from "@/components/ui/badge";
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
  background: "var(--sidebar)",
  borderRight: "1px solid var(--border)",
  height: "100%",
  overflowY: "auto",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };

const sectionLabelStyle: CSSProperties = {
  margin: 0,
  padding: "0 var(--space-sm) var(--space-xs)",
  fontFamily: "var(--font-ui-condensed)",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted-foreground)",
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
  borderRadius: "var(--radius-control)",
  border: "none",
  background: "transparent",
  color: "var(--foreground)",
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
  background: "var(--card)",
  boxShadow: "inset 0 0 0 1px var(--border)",
  fontWeight: 600,
};

const sessionRowStyle: CSSProperties = {
  ...entryStyle,
  width: "auto",
  flex: 1,
  minWidth: 0,
  minHeight: 24,
  padding: "2px var(--space-sm) 2px var(--space-md)",
  justifyContent: "flex-start",
  color: "var(--muted-foreground)",
};

// The current Story takes the current project's neutral mark (issue #104), never a new style.
const currentSessionRowStyle: CSSProperties = {
  background: currentEntryStyle.background,
  boxShadow: currentEntryStyle.boxShadow,
  fontWeight: currentEntryStyle.fontWeight,
};

/** A live session: one a person could be watching. Finished sessions stay on the fleet surface only. */
function isLiveSession(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** The Story the developer is on: the one open in the Story view, or the open session's. */
function usePlaceStoryId(): string | null {
  return useUiStore((state) => (state.activeSessionId ? state.activeSessionStoryId : state.currentStoryId));
}

/** The current Story's record, read under the Story view's own key so the two share one read. Only
 * the Story view's Story is read here; a session's Story is named by its running row. */
function useCurrentStory(currentProjectId: string | undefined): StoryDto | null {
  const storyId = useUiStore((state) => (state.activeSessionId ? null : state.currentStoryId));
  const query = useQuery({
    queryKey: ["board", currentProjectId, "story", storyId],
    queryFn: () => storyGet(storyId as string),
    enabled: Boolean(storyId && currentProjectId),
  });
  return storyId ? (query.data ?? null) : null;
}

const sessionControlStyle: CSSProperties = {
  ...rowStyle,
  minHeight: 24,
  padding: "2px var(--space-xs)",
  flexShrink: 0,
  cursor: "pointer",
  color: "var(--muted-foreground)",
};

/** One project's running sessions, under its entry, plus the current Story when it is not running.
 * Renders nothing when neither is there. */
function RunningSessions({
  projectId,
  projectName,
  sessions,
  currentStory,
}: {
  projectId: string;
  projectName: string;
  sessions: FleetRowDto[];
  currentStory: StoryDto | null;
}) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openStory = useUiStore((state) => state.openStory);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const placeStoryId = usePlaceStoryId();
  const extraStory =
    currentStory && currentStory.projectId === projectId && !sessions.some((s) => s.storyId === currentStory.id)
      ? currentStory
      : null;
  if (sessions.length === 0 && !extraStory) return null;
  return (
    <ul
      role="list"
      aria-label={`${projectName} running sessions`}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}
    >
      {extraStory && (
        <li style={{ display: "flex" }}>
          <button
            type="button"
            className="type-label"
            aria-current="location"
            aria-label={`Open Story ${extraStory.key} ${extraStory.title}`}
            title={`${extraStory.key} ${extraStory.title}`}
            onClick={() => openStory(projectId, extraStory.id)}
            style={{ ...sessionRowStyle, ...currentSessionRowStyle }}
          >
            <span className="tabular-nums" style={{ flexShrink: 0, color: "var(--foreground)" }}>
              {extraStory.key}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {extraStory.title}
            </span>
          </button>
        </li>
      )}
      {sessions.map((session) => {
        const doing = session.doingTaskTitle;
        const subject = `${session.storyKey} ${session.storyTitle}`.trim();
        // The core's derived fleet state, never the stored status: a session is waiting on you only
        // while it holds a pending request (#57).
        const waiting = session.fleetState === "blocked";
        const here = session.storyId === placeStoryId;
        return (
          <li key={session.sessionId} style={{ display: "flex", alignItems: "center" }}>
            <button
              type="button"
              className="type-label"
              data-story-id={session.storyId}
              aria-current={here ? "location" : undefined}
              aria-label={doing ? `Open Story ${subject}, doing ${doing}` : `Open Story ${subject}`}
              title={doing ? `${subject}: ${doing}` : subject}
              onClick={() => openStory(session.projectId, session.storyId)}
              style={here ? { ...sessionRowStyle, ...currentSessionRowStyle } : sessionRowStyle}
            >
              <span className="tabular-nums" style={{ flexShrink: 0, color: "var(--foreground)" }}>
                {session.storyKey}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {doing ?? session.storyTitle}
              </span>
              {waiting && (
                // The hand in yellow, its word as the accessible name and tooltip: the rail is too narrow
                // for the word beside the key, the doing Task and Session.
                <StateBadge state="waiting_on_you" hideLabel className="h-5 shrink-0" />
              )}
            </button>
            {/* The one explicit way to the live agent from the sidebar (issue #104). */}
            <button
              type="button"
              className="type-label"
              data-session-id={session.sessionId}
              aria-current={session.sessionId === activeSessionId ? "page" : undefined}
              aria-label={`Open ${subject} session`}
              title={`Open the live session of ${session.storyKey}`}
              onClick={() =>
                setActiveSessionId(
                  session.sessionId,
                  session.storyId,
                  null,
                  isRunStatus(session.runStatus) ? session.runStatus : null,
                )
              }
              style={sessionControlStyle}
            >
              Session
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
  // The count of requests waiting on you across every project (#57): the queue's own read, one entry
  // per waiting request, so the figure and the list cannot disagree. Called unconditionally, above
  // the early return below, so this hook's call order never changes between renders (Rules of Hooks).
  const waitingCount = useBlockedQueue().data?.length ?? 0;
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
  const currentStory = useCurrentStory(currentProjectId);

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
          over the glyph-only asset lets `--foreground` colour it in both schemes; an image element cannot
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
      <Section id="rail-waiting" label="Waiting on you">
        {/* At the top of the sidebar (docs/mvp-spec.md §4.1): what a live agent can't go on without,
            across every project, outranks everything below it. */}
        <button
          type="button"
          className="type-body"
          aria-label={waitingCount > 0 ? `Open Waiting on you, ${waitingCount} waiting` : "Open Waiting on you"}
          title="Every Gated action and permission request waiting on you, across every project"
          onClick={() => setFleetSurface({ view: "queue" })}
          style={{ ...entryStyle, color: waitingCount > 0 ? "var(--foreground)" : "var(--muted-foreground)" }}
        >
          <span>{waitingCount > 0 ? "Requests" : "Nothing waiting"}</span>
          {waitingCount > 0 && (
            // A numeral, never a raw dot (D-37), absent entirely at zero. The Needs-you count is one of the
            // few things safety yellow means (direction.md § Colour).
            <Badge
              variant="attention"
              data-count="waiting"
              title={waitingCount === 1 ? "1 request waiting on you" : `${waitingCount} requests waiting on you`}
              className="h-5 min-w-5 px-1.5 tabular-nums"
            >
              {waitingCount}
            </Badge>
          )}
        </button>
      </Section>

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
                  color: isUnreachable ? "var(--muted-foreground)" : "var(--foreground)",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: "var(--space-xs)", minWidth: 0, maxWidth: "100%" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
                    <span className="type-label tabular-nums" style={{ flexShrink: 0, color: "var(--muted-foreground)" }}>
                      {project.keyPrefix}
                    </span>
                  </span>
                  {isUnreachable && (
                    // The word AND a glyph, never a colour change alone (01-UI-SPEC.md "Accessibility").
                    // Its own line, so the name is never truncated to make room for it.
                    <span
                      className="type-label"
                      style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--destructive-text)" }}
                    >
                      <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
                      Unreachable
                    </span>
                  )}
                </span>
              </button>
              <RunningSessions
                projectId={project.id}
                projectName={project.name}
                sessions={liveSessions.filter((session) => session.projectId === project.id)}
                currentStory={currentStory}
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
          style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--muted-foreground)" }}
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
              <p className="type-label" style={{ margin: 0, color: "var(--foreground)" }}>
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
                style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--muted-foreground)" }}
              >
                Keep it
              </button>
              {removeError && (
                <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text)" }}>
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
              style={{ ...entryStyle, justifyContent: "flex-start", color: "var(--muted-foreground)" }}
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

      {recoveryCount > 0 && (
        <Section id="rail-review-queue" label="Review queue">
          {/* Never merged with the waiting count (D-46): different urgency, so a different row and a
              different data-channel role. It opens the fleet list, not the queue: the queue holds
              requests waiting on you only. */}
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
              style={{ color: "var(--destructive-text)", fontWeight: 600 }}
            >
              {recoveryCount}
            </span>
          </button>
        </Section>
      )}

      {notice && (
        <div
          role="status"
          className="type-label"
          style={{ color: "var(--muted-foreground)", padding: "0 var(--space-sm)" }}
        >
          {notice}
        </div>
      )}
      {registrationErrorNotice && (
        <div
          role="status"
          className="type-label"
          style={{ color: "var(--destructive-text)", padding: "0 var(--space-sm)" }}
        >
          {registrationErrorNotice}
        </div>
      )}
    </nav>
  );
}
