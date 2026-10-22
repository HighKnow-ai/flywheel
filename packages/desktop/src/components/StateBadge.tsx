import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/Icon";
import { RUN_STATUS_LABELS, isFleetState } from "../legend/runStatus";

/**
 * A state, drawn as its icon AND its word AND its tone (direction.md § Components, rule 1). The ONE place a
 * state picks a colour: no screen colours a state itself.
 *
 * Four tones, one meaning each. `attention` (safety yellow) is Waiting on you and nothing else; `running`
 * (brand blue) is an agent at work; `destructive` (red) is Stopped or failed; `neutral` is every other state,
 * told apart by its icon and word, never by a hue. The API cannot drop the meaning: there is no prop that
 * removes the icon, and `hideLabel` moves the word into the accessible name.
 */
export type StateTone = "attention" | "running" | "destructive" | "neutral";

interface StateEntry {
  tone: StateTone;
  icon: IconName;
  label: string;
  /** A neutral state that has stopped asking anything (Shaping, Merged, Dropped, a stale Check): quieter ink. */
  quiet?: boolean;
}

/**
 * Every state the app draws, with the Lucide icon direction.md § Icons names for it. Story states, the two
 * attention states, run statuses (the fleet and session surfaces), Check results and Task states share one
 * table: where a word means the same thing in two records ("failed", "dropped") it is one entry.
 */
export const STATE_VOCABULARY = {
  // Story states.
  shaping: { tone: "neutral", icon: "CircleDashed", label: "Shaping", quiet: true },
  ready: { tone: "neutral", icon: "Circle", label: "Ready" },
  running: { tone: "running", icon: "LoaderCircle", label: "Running" },
  in_review: { tone: "neutral", icon: "GitPullRequest", label: "In review" },
  merged: { tone: "neutral", icon: "GitMerge", label: "Merged", quiet: true },
  dropped: { tone: "neutral", icon: "CircleSlash", label: "Dropped", quiet: true },
  // Epic and Milestone states: In progress is derived (Shaping, Ready, Done and Dropped are shared above and below).
  in_progress: { tone: "neutral", icon: "CircleDot", label: "In progress" },
  // Attention, worked out from the session and shown in place of the state word.
  waiting_on_you: { tone: "attention", icon: "Hand", label: "Waiting on you" },
  stopped: { tone: "destructive", icon: "CirclePause", label: "Stopped" },
  // Run statuses. `blocked` is the core's word for a session Waiting on you (GLOSSARY.md).
  blocked: { tone: "attention", icon: "Hand", label: "Waiting on you" },
  awaiting_review: { tone: "neutral", icon: "GitPullRequest", label: "In review" },
  completed: { tone: "neutral", icon: "CircleCheck", label: "Completed" },
  interrupted: { tone: "neutral", icon: "CirclePause", label: "Interrupted", quiet: true },
  abandoned: { tone: "destructive", icon: "CirclePause", label: "Abandoned" },
  failed: { tone: "destructive", icon: "CircleX", label: "Failed" },
  ci_failed: { tone: "destructive", icon: "CircleX", label: "CI failed" },
  held_by_limit: { tone: "neutral", icon: "Hourglass", label: "Held by usage limit" },
  // Check results.
  passed: { tone: "neutral", icon: "CircleCheck", label: "Passed" },
  not_run: { tone: "neutral", icon: "Circle", label: "Not run", quiet: true },
  timed_out: { tone: "neutral", icon: "Hourglass", label: "Timed out" },
  stale: { tone: "neutral", icon: "History", label: "Stale", quiet: true },
  judged_at_review: { tone: "neutral", icon: "GitPullRequest", label: "Judged at review", quiet: true },
  // Task states (`dropped` is shared with the Story state above).
  open: { tone: "neutral", icon: "Circle", label: "Open" },
  doing: { tone: "running", icon: "LoaderCircle", label: "Doing" },
  done: { tone: "neutral", icon: "CircleCheck", label: "Done" },
} as const satisfies Record<string, StateEntry>;

export type KnownState = keyof typeof STATE_VOCABULARY;

/** An unknown value is neutral, wears the dashed circle (the one glyph that claims nothing) and prints itself. */
const UNKNOWN: StateEntry = { tone: "neutral", icon: "CircleDashed", label: "Unknown", quiet: true };

function entryOf(state: string): StateEntry | undefined {
  return Object.prototype.hasOwnProperty.call(STATE_VOCABULARY, state)
    ? (STATE_VOCABULARY as Record<string, StateEntry>)[state]
    : undefined;
}

/** The tone a state value draws in; a value the vocabulary does not know is neutral. */
export function stateToneOf(state: string): StateTone {
  return entryOf(state)?.tone ?? "neutral";
}

/** The word a state prints: a fleet state keeps the run-status vocabulary's word (legend/runStatus.ts). */
export function stateWordOf(state: string): string {
  const entry = entryOf(state);
  if (!entry) return state || UNKNOWN.label;
  return isFleetState(state) ? RUN_STATUS_LABELS[state] : entry.label;
}

export interface StateBadgeProps {
  /** A Story state, an attention state, a run status, a Check result or a Task state. Anything else is neutral. */
  state: string;
  /**
   * `pill` (default): the tone's ground, for rows, headers and cards. `inline`: icon and word in the tone's
   * ink on no ground, for a sentence or a dense table cell. Attention and destructive keep their fill even
   * inline, because yellow and red are only ever read as fills.
   */
  variant?: "pill" | "inline";
  /** The caller's own word, when the state's word would mislead or needs its reason ("Stopped: crash"). */
  label?: string;
  /** Do not draw the word; the icon carries it as an accessible name. The word is never dropped silently. */
  hideLabel?: boolean;
  /** Pulse the icon: a process alive right now. The caller omits it under reduced motion. */
  pulse?: boolean;
  className?: string;
}

const INLINE_INK: Record<StateTone, string> = {
  attention: "",
  destructive: "",
  running: "text-running",
  neutral: "text-foreground",
};

export function StateBadge({ state, variant = "pill", label, hideLabel = false, pulse = false, className }: StateBadgeProps) {
  const entry = entryOf(state) ?? UNKNOWN;
  const word = label ?? stateWordOf(state);
  const filled = variant === "pill" || entry.tone === "attention" || entry.tone === "destructive";
  const a11y = hideLabel ? { role: "img" as const, "aria-label": word, title: word } : {};

  return (
    <Badge
      variant={filled ? entry.tone : "ghost"}
      data-tone={entry.tone}
      data-state={state}
      className={cn(
        entry.quiet && "text-muted-foreground",
        state === "shaping" && filled && "border-dashed border-input bg-transparent",
        !filled && cn("h-auto gap-1 px-0 hover:bg-transparent", INLINE_INK[entry.tone], entry.quiet && "text-muted-foreground"),
        hideLabel && filled && "px-1.5",
        className,
      )}
      {...a11y}
    >
      <Icon name={entry.icon} size={15} className={pulse ? "agent-pulse" : undefined} />
      {hideLabel ? null : word}
    </Badge>
  );
}
