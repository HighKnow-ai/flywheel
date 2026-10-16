import type { ComponentType, CSSProperties } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID } from "./marks";
import { RUN_STATUS_LABELS, isFleetState } from "./runStatus";

/**
 * The ONE consumer of the `--state-*` colour tokens (Phase 14 plan 04, VIS-01, D-15 to D-19).
 *
 * A state is drawn as a glyph AND a word (or, when the word is not drawn, an accessible name carrying it)
 * AND the class's colour. Colour is the fastest channel and never the only one, and the API makes that
 * impossible to violate rather than merely discouraged: there is no prop that removes the glyph, and the
 * only prop that removes the drawn word (`hideLabel`) substitutes `role="img"` with the word as its name.
 *
 * theme/__tests__/state-token-gate.test.ts fails the build when any other production file names a
 * `--state-*` token. To colour a state, render it through this component.
 *
 * Membership below is declared ONCE. Glyph and word come from the published registry (`marks.ts`) and the
 * run-status label map, never from a second list here.
 */

/** The five classes, defined by what the developer must DO about a state (D-15). */
export type StateClass = "needs-you" | "running" | "failed" | "merged" | "quiet";

/** `text` = ink only, `wash` = on a tinted ground, `edge` = a full 1px boundary, `mark` = glyph in the mark role. */
export type StateBadgeVariant = "text" | "wash" | "edge" | "mark";

interface StateEntry {
  cls: StateClass;
  /** An id in `MARKS_BY_ID`. A test fails if it is absent; the component never falls back to another glyph. */
  markId: string;
}

/**
 * Every state the vocabulary knows. `abandoned` sits in needs-you because `bandForState` already groups it
 * with blocked in the fleet's NEEDS YOU band; it does not take the failed class, an unsupervised session
 * is not an error. `completed` and `interrupted` are quiet: a state that does not need the developer is
 * not painted as if it did.
 */
export const STATE_VOCABULARY: Record<string, StateEntry> = {
  blocked: { cls: "needs-you", markId: "blocked-indicator" },
  // The dispatcher's task state under a paused account-limit gate (Phase 15 plan 03, D-34): a vocabulary KEY
  // on blocked's class and mark, not a sixth class.
  held_by_limit: { cls: "needs-you", markId: "blocked-indicator" },
  awaiting_review: { cls: "needs-you", markId: "run-awaiting-review" },
  abandoned: { cls: "needs-you", markId: "run-abandoned" },
  needs_decision: { cls: "needs-you", markId: "recovery-needed" },
  proposals_pending: { cls: "needs-you", markId: "proposal-pending" },
  running: { cls: "running", markId: "run-running" },
  failed: { cls: "failed", markId: "run-failed" },
  ci_failed: { cls: "failed", markId: "ci-failed" },
  merged: { cls: "merged", markId: "run-merged" },
  completed: { cls: "quiet", markId: "run-completed" },
  interrupted: { cls: "quiet", markId: "run-interrupted" },
};

/**
 * An unknown value is quiet, prints its raw value, and wears the neutral dashed circle of the Backlog mark:
 * the registry's one glyph that claims nothing about a state.
 */
const UNKNOWN_MARK_ID = "status-backlog";

/**
 * The variant a LIST ROW draws a state in (Phase 14 plan 09, decided on the demonstration board). Needs-you and failed
 * carry a wash, because those are the two classes that ask something of the developer; running, merged and the quiet
 * states are ink, glyph and word. With a wash behind all of them, five of six fleet rows read as a pastel plate and the
 * plate stopped telling the needs-you band from the running one. A wash is never the only carrier (D-15, and forced
 * colors discards it), so this chooses emphasis and removes no information.
 */
export function rowVariant(state: string): StateBadgeVariant {
  const cls = stateClassOf(state);
  return cls === "needs-you" || cls === "failed" ? "wash" : "text";
}

const own = (state: string): StateEntry | undefined =>
  Object.prototype.hasOwnProperty.call(STATE_VOCABULARY, state) ? STATE_VOCABULARY[state] : undefined;

/** Which class a state value belongs to; a value the vocabulary does not know is quiet. */
export function stateClassOf(state: string): StateClass {
  return own(state)?.cls ?? "quiet";
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Resolve a Lucide icon by name, the by-name pattern every surface here uses. */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

const token = (cls: StateClass, role: "text" | "wash" | "edge" | "mark"): string => `var(--state-${cls}-${role})`;

export interface StateBadgeProps {
  /** A run status, a fleet state, or one of the other states in `STATE_VOCABULARY`. Anything else renders quiet. */
  state: string;
  variant?: StateBadgeVariant;
  /** The caller's own word, for a state whose registry label would mislead (a task held by the account limit is not "Blocked"). */
  label?: string;
  /** Do not draw the word; the glyph then carries it as an accessible name. The word is never dropped silently. */
  hideLabel?: boolean;
  /** Pulse the glyph (`agent-pulse`): the one continuous-motion exception, for a process alive right now. The caller omits it under reduced motion. */
  pulse?: boolean;
}

export function StateBadge({ state, variant = "text", label, hideLabel = false, pulse = false }: StateBadgeProps) {
  const entry = own(state);
  const cls = entry?.cls ?? "quiet";
  const mark = MARKS_BY_ID[entry?.markId ?? UNKNOWN_MARK_ID];
  const word = label ?? (entry ? (isFleetState(state) ? RUN_STATUS_LABELS[state] : mark.label) : state || "Unknown");

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-xs)",
  };
  if (variant !== "mark") style.color = token(cls, "text");
  if (variant === "wash") style.background = token(cls, "wash");
  if (variant === "edge") {
    // A full 1px boundary on all sides, never a 2px side stripe (A-06 reserves that for selection).
    style.borderWidth = "1px";
    style.borderStyle = "solid";
    style.borderColor = token(cls, "edge");
  }
  if (variant === "wash" || variant === "edge") {
    style.padding = "0 var(--space-xs)";
    style.borderRadius = "var(--radius-mark)";
  }

  const glyph = (
    <span
      aria-hidden="true"
      className={pulse ? "agent-pulse" : undefined}
      style={{ display: "inline-flex", color: variant === "mark" ? token(cls, "mark") : undefined }}
    >
      <Icon name={mark.glyph} />
    </span>
  );

  return (
    <span
      className="type-label"
      data-state-class={cls}
      style={style}
      {...(hideLabel ? { role: "img", "aria-label": word } : {})}
    >
      {glyph}
      {hideLabel ? null : word}
    </span>
  );
}
