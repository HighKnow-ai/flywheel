/**
 * The persistent project switcher (01-UI-SPEC.md "Project switcher (left rail)"): rack chrome — a
 * narrow, receded rail on the left edge, present whenever ≥1 project is registered and absent
 * before the first registration (`App.tsx` renders `FirstRun` instead in that case; this
 * component never mounts with zero projects). Each entry shows the project's key prefix as its
 * glyph; hover/focus reveals the full name via the native title tooltip. The current project is
 * the ONE thing `accent` marks here — 01-UI-SPEC.md "Color & Token Roles" reserves it for exactly
 * one "loudest" element per view, and the current position in the rail is one of the few named
 * uses.
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
import { useBlockedSummary, useRecoverySummary } from "../board/useBoardQuery";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./RegisterProjectFlow";

// 01-UI-SPEC.md "Project switcher (left rail)": "collapsed width ~56–72px" — 72 (the upper
// bound) is what gives the "Unreachable" label below an unreachable entry's icon enough measure
// to wrap onto two short lines without touching the next entry (craft-floor "Type": run the real
// copy and fix what overflows — a fixed 64px/40px square let that label overlap the entry below
// it before this width/auto-height pass).
const RAIL_WIDTH = 72;
const NOTICE_VISIBLE_MS = 4000;

const railStyle: CSSProperties = {
  width: RAIL_WIDTH,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-md) var(--space-xs)",
  background: "var(--surface-secondary)",
  borderRight: "1px solid var(--divider)",
  height: "100%",
  overflowY: "auto",
};

const entryBaseStyle: CSSProperties = {
  width: 60,
  minHeight: 40,
  borderRadius: "var(--radius-chrome)",
  border: "1px solid var(--divider)",
  background: "transparent",
  color: "var(--text-primary-rack)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  cursor: "pointer",
  position: "relative",
  flexShrink: 0,
  padding: "6px 2px",
};

const currentEntryStyle: CSSProperties = {
  ...entryBaseStyle,
  border: "1px solid var(--accent-nontext)",
  color: "var(--accent-text-rack)",
  background: "rgba(60, 100, 221, 0.14)",
};

export interface ProjectRailProps {
  projects: Project[];
  currentProjectId: string | undefined;
  onSelect: (project: Project) => void;
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
        width={36}
        height={36}
        style={{ flexShrink: 0, marginBottom: "var(--space-sm)" }}
      />
      {projects.map((project) => {
        const isCurrent = project.id === currentProjectId;
        const isUnreachable = project.status === "unreachable";
        return (
          <button
            key={project.id}
            type="button"
            title={project.name}
            aria-label={isUnreachable ? `${project.name}, Unreachable` : project.name}
            aria-current={isCurrent ? "true" : undefined}
            onClick={() => onSelect(project)}
            style={isCurrent ? currentEntryStyle : entryBaseStyle}
          >
            <span
              className="type-label tabular-nums"
              style={{ fontWeight: isCurrent ? 600 : 400, letterSpacing: "0.02em" }}
            >
              {project.keyPrefix}
            </span>
            {isCurrent && blockedCount > 0 && (
              // A numeral, never a raw dot (D-37) — absent entirely at zero, never a visible "0".
              <span
                aria-hidden="true"
                title={blockedCount === 1 ? "1 task waiting on you" : `${blockedCount} tasks waiting on you`}
                className="type-micro tabular-nums"
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 16,
                  height: 16,
                  padding: "0 3px",
                  color: "var(--surface-dominant)",
                  background: "var(--blocked-text-rack)",
                  borderRadius: "50%",
                  fontWeight: 600,
                }}
              >
                {blockedCount}
              </span>
            )}
            {isCurrent && recoveryCount > 0 && (
              // A second, visually distinct badge (destructive-red family) — never merged with
              // blockedCount above (D-46). Positioned at the opposite corner from the Blocked
              // badge/Unreachable glyph so neither ever overlaps the other when both are present.
              <span
                aria-hidden="true"
                title={
                  recoveryCount === 1 ? "1 task needs a decision." : `${recoveryCount} tasks need a decision.`
                }
                className="type-micro tabular-nums"
                style={{
                  position: "absolute",
                  bottom: -4,
                  right: -4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 16,
                  height: 16,
                  padding: "0 3px",
                  color: "var(--surface-dominant)",
                  background: "var(--destructive-text-rack)",
                  borderRadius: "50%",
                  fontWeight: 600,
                }}
              >
                {recoveryCount}
              </span>
            )}
            {isUnreachable && (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    display: "flex",
                    color: "var(--destructive-strip)",
                    background: "var(--surface-secondary)",
                    borderRadius: "50%",
                  }}
                >
                  <TriangleAlert size={12} strokeWidth={2} />
                </span>
                <span
                  className="type-micro"
                  style={{
                    color: "var(--destructive-strip)",
                    lineHeight: 1.15,
                    textAlign: "center",
                    width: "100%",
                    overflowWrap: "break-word",
                  }}
                >
                  {/* A soft hyphen (U+00AD) at the syllable boundary — invisible to the
                  accessible name (the button's own `aria-label` above already supplies the
                  literal, unhyphenated word for assistive tech) and to sighted users unless the
                  line actually breaks there — gives the ~60px column a clean two-line wrap
                  instead of relying on browser auto-hyphenation, which headless/CI Chromium does
                  not reliably support without a locale dictionary. */}
                  Unreach&shy;able
                </span>
              </>
            )}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Register Project…"
        title="Register Project…"
        onClick={() => void registerProjectFlow()}
        style={entryBaseStyle}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
      {notice && (
        <div
          role="status"
          className="type-micro"
          style={{ color: "var(--text-muted-rack)", textAlign: "center", padding: "0 var(--space-xs)" }}
        >
          {notice}
        </div>
      )}
      {registrationErrorNotice && (
        <div
          role="status"
          className="type-micro"
          style={{ color: "var(--destructive-strip)", textAlign: "center", padding: "0 var(--space-xs)" }}
        >
          {registrationErrorNotice}
        </div>
      )}
    </nav>
  );
}
