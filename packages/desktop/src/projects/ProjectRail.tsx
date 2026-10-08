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
 * FLEET and REVIEW QUEUE rows are READ-ONLY FACTS, not links. The comp's Mission Control, Agents,
 * Worktrees, In review and Challenges rows imply destinations that do not exist, and a row that
 * looks like a button and does nothing is worse than a plain number. "Challenges" is also
 * deliberately absent: pending proposals never surface in this rail (D-46/D-82, pinned by
 * `project-rail.test.tsx`'s source scan), so that comp row is not built.
 *
 * An unreachable project (D-16) renders a warning glyph *in addition to* its key glyph, plus the
 * literal word "Unreachable" — never a colour change alone (01-UI-SPEC.md "Accessibility").
 * Selecting it still calls `onSelect`; `App.tsx` is what decides an unreachable selection opens
 * `ProjectUnreachable` instead of a board — this component only renders the switcher itself.
 *
 * The `+` affordance at the rail's foot opens the SAME registration flow ⌘⇧O and the native File
 * menu use (`RegisterProjectFlow.tsx`) — never a second, rail-local copy of that sequence.
 *
 * Plan 02-06 Task 3 adds the current project's blocked-count badge (D-37, AGNT-06) — the
 * per-project half of the mechanism FLEET-02 generalises across projects in Phase 10, built as the
 * real mechanism rather than a placeholder. Renders a numeral, never a raw dot, and renders
 * nothing at all at zero (never a visible "0") — only the CURRENT project's entry carries it, per
 * this plan's own scope (a rail-wide per-project count is FLEET-02's job).
 *
 * Plan 03-11 Task 3 adds a SECOND, visually distinct badge for D-46's "recovery needed" count —
 * never summed with the blocked-count badge above, since the two carry different urgency (Blocked:
 * a live agent is waiting on the user right now; Needs Decision: a past session left something to
 * decide, with no live spend attached). Same zero-renders-nothing rule, same current-project-only
 * scope, opposite corner so the two badges never visually collide.
 */
import { useState, type CSSProperties } from "react";
import { Plus, TriangleAlert } from "lucide-react";
import logoUrl from "../assets/logo.svg";
import type { Project } from "../board/useBoardQuery";
import { useBlockedSummary, useChangeFlags, useRecoverySummary } from "../board/useBoardQuery";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./RegisterProjectFlow";

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
  // The current project's blocked count (D-37) — called unconditionally, above the early return
  // below, so this hook's call order never changes between renders (Rules of Hooks). Disabled
  // entirely (no read at all) when no project is current.
  const blockedSummaryQuery = useBlockedSummary(currentProjectId);
  const blockedCount = blockedSummaryQuery.data?.blockedCount ?? 0;
  // D-46's board-visible "recovery needed" count (plan 03-11 Task 3) — called unconditionally,
  // immediately after the blocked-summary call above, for the same reason. A SEPARATE badge from
  // blockedCount, never summed into it: Blocked means a live agent is waiting on the user right
  // now; Needs Decision means a past session left something to decide with no live spend
  // attached — different urgencies, so a single number would flatten the one distinction the rail
  // exists to make at a glance.
  const recoverySummaryQuery = useRecoverySummary(currentProjectId);
  const recoveryCount = recoverySummaryQuery.data?.recoveryCount ?? 0;
  // FLEET's worktree count: one change flag per task that has a worktree, the SAME query the board
  // already holds (deduplicated by key). Absent until it lands — an unknown is not a zero.
  const worktreeCount = useChangeFlags(currentProjectId).data?.length;

  if (projects.length === 0) {
    // Not present pre-first-registration — `App.tsx` renders `FirstRun` instead, but this guard
    // keeps the component itself honest even if a future caller renders it unconditionally.
    return null;
  }

  return (
    <nav aria-label="Projects" className="project-rail" style={railStyle}>
      <img
        src={logoUrl}
        alt="Flywheel by HighKnow"
        width={28}
        height={28}
        style={{ flexShrink: 0, margin: "0 var(--space-sm)" }}
      />
      <Section id="rail-projects" label="Projects">
        {projects.map((project) => {
          const isCurrent = project.id === currentProjectId;
          const isUnreachable = project.status === "unreachable";
          return (
            <button
              key={project.id}
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
      </Section>

      <Section id="rail-fleet" label="Fleet">
        {worktreeCount !== undefined && (
          <div className="type-body" style={rowStyle}>
            <span>Worktrees</span>
            <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
              {worktreeCount}
            </span>
          </div>
        )}
        {blockedCount > 0 && (
          // A numeral, never a raw dot (D-37) — absent entirely at zero, never a visible "0". The
          // blocked role is a data channel (D-11), so the figure takes the colour, not a fill.
          <div className="type-body" style={rowStyle}>
            <span>Blocked</span>
            <span
              aria-hidden="true"
              title={blockedCount === 1 ? "1 task waiting on you" : `${blockedCount} tasks waiting on you`}
              className="type-label tabular-nums"
              style={{ color: "var(--blocked-text-rack)", fontWeight: 600 }}
            >
              {blockedCount}
            </span>
          </div>
        )}
      </Section>

      <Section id="rail-review-queue" label="Review queue">
        {recoveryCount > 0 ? (
          // Never merged with the blocked count (D-46): different urgency, so a different row and a
          // different data-channel role.
          <div className="type-body" style={rowStyle}>
            <span>Needs decision</span>
            <span
              aria-hidden="true"
              title={
                recoveryCount === 1 ? "1 task needs a decision." : `${recoveryCount} tasks need a decision.`
              }
              className="type-label tabular-nums"
              style={{ color: "var(--destructive-text-rack)", fontWeight: 600 }}
            >
              {recoveryCount}
            </span>
          </div>
        ) : (
          <div className="type-body" style={{ ...rowStyle, color: "var(--text-muted-rack)" }}>
            Nothing waiting
          </div>
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
