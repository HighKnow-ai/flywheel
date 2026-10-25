/**
 * The words a Proposal is named by (issue #203, critique F45): one map for every verb and every target the core
 * knows (`ProposalVerb` x `ProposalTarget` in `core/src/domain/proposal.rs`), so a kind pill never falls back to
 * the raw "amend story" beside a sibling's "New Story". The six kinds execution files read as the core's own
 * `proposal_kind_words` names them; the rest follow the same pattern.
 *
 * Also here: what a decision says once it lands (a toast through `notify`), and an evidence line's paths shown
 * relative to the filing Story's worktree, middle-truncated, the whole path in a Tooltip.
 */
import { useRef, type MouseEvent, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notify } from "@/lib/notify";

const VERBS = ["create", "amend", "reorder", "retire"] as const;
const TARGETS = ["milestone", "epic", "story", "criterion", "adr", "glossary_term"] as const;

type Verb = (typeof VERBS)[number];
type Target = (typeof TARGETS)[number];

/** Every Proposal kind's word, by `"<verb> <target>"`. */
export const PROPOSAL_KIND_WORDS: Record<`${Verb} ${Target}`, string> = {
  "create milestone": "New Milestone",
  "create epic": "New Epic",
  "create story": "New Story",
  "create criterion": "New criterion",
  "create adr": "New ADR",
  "create glossary_term": "New glossary term",
  "amend milestone": "Amend Milestone",
  "amend epic": "Amend Epic spec",
  "amend story": "Amend Story",
  "amend criterion": "Amend criterion",
  "amend adr": "Amend ADR",
  "amend glossary_term": "Amend glossary term",
  "reorder milestone": "Reorder Milestone",
  "reorder epic": "Reorder Epic",
  "reorder story": "Reorder",
  "reorder criterion": "Reorder criterion",
  "reorder adr": "Reorder ADR",
  "reorder glossary_term": "Reorder glossary term",
  "retire milestone": "Retire Milestone",
  "retire epic": "Retire Epic",
  "retire story": "Retire Story",
  "retire criterion": "Retire criterion",
  "retire adr": "Retire ADR",
  "retire glossary_term": "Retire glossary term",
};

/** A Proposal's kind in words. A verb or target the core adds later still reads as words, capitalised. */
export function proposalKindWords(verb: string, targetType: string): string {
  const known = (PROPOSAL_KIND_WORDS as Record<string, string>)[`${verb} ${targetType}`];
  if (known) return known;
  const words = `${verb} ${targetType.replace(/_/g, " ")}`.trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a decision on a pending Proposal ended. */
export type Decision = "accepted" | "amended" | "rejected";

/**
 * Which decision the shared `ProposalDecision` (`shaping/GhostCard.tsx`) is taking, read from the control the
 * Developer pressed: Accept, Amend/Edit (then Accept edit) or Reject (then its Reject). Its `afterDecide` does not
 * say which landed, so the card listens to the clicks around it (capture phase, on a `display: contents` wrapper).
 */
export function useDecisionIntent(amendWord = "Amend"): {
  wrap: (children: ReactNode) => ReactNode;
  current: () => Decision;
} {
  const intent = useRef<Decision>("accepted");
  function onClickCapture(event: MouseEvent) {
    const button = (event.target as HTMLElement | null)?.closest("button");
    const label = button?.getAttribute("aria-label") ?? "";
    if (label.startsWith("Accept edit")) intent.current = "amended";
    else if (label.startsWith("Accept ")) intent.current = "accepted";
    else if (label.startsWith("Reject ")) intent.current = "rejected";
    else if (label.startsWith(`${amendWord} `)) intent.current = "amended";
  }
  return {
    wrap: (children) => (
      <div className="contents" onClickCapture={onClickCapture}>
        {children}
      </div>
    ),
    current: () => intent.current,
  };
}

/** What a decision says once it lands: "Accepted New Story “Empty-line recovery”". The core keeps a decision
 * final (there is no command that takes one back), so no Undo is offered. */
export function notifyDecided(decision: Decision, subject: string, description?: string): void {
  const title =
    decision === "accepted" ? `Accepted ${subject}` : decision === "amended" ? `Accepted your edit to ${subject}` : `Rejected ${subject}`;
  notify.success(title, { description });
}

/** The longest path drawn whole; a longer one keeps its head and its file name around an ellipsis. */
const PATH_MAX = 44;

/**
 * `path` relative to the filing Story's worktree: Flywheel puts a Story's worktree at
 * `~/Flywheel/<key prefix>/<Story key>/` (D-23), so whatever follows the Story key's own directory is the
 * worktree-relative path. A path outside it is kept as it is.
 */
export function worktreeRelative(path: string, storyKey: string | null): string {
  if (!storyKey || !path.startsWith("/")) return path;
  const marker = `/${storyKey}/`;
  const at = path.lastIndexOf(marker);
  return at >= 0 ? path.slice(at + marker.length) : path;
}

/**
 * "packages/…/queue/ReviewQueue.tsx:214": the first directory, then as many trailing ones as fit before the file
 * name, the middle elided. A home directory reads as `~`. A name too long on its own keeps its end.
 */
export function middleTruncate(path: string, max = PATH_MAX): string {
  const short = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, "~");
  if (short.length <= max) return short;
  const parts = short.split("/");
  const file = parts.pop() ?? "";
  const head = parts.shift() ?? "";
  const lead = head === "" ? `/${parts.shift() ?? ""}` : head;
  let tail = `/${file}`;
  if (lead.length + 2 + tail.length > max) return `…${short.slice(-(max - 1))}`;
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = `/${parts[i]}${tail}`;
    if (lead.length + 2 + next.length > max) break;
    tail = next;
  }
  return `${lead}/…${tail}`;
}

const PATHLIKE = /^[~./]?[\w@.~-]*\/[\w@.~/-]+(?::\d+(?::\d+)?)?[),.;]?$/;

/**
 * An agent's evidence line with each path in it worktree-relative and middle-truncated, the whole path in a
 * Tooltip on focus and hover. Everything else in the line reads as written.
 */
export function EvidenceLine({ evidence, storyKey }: { evidence: string; storyKey: string | null }) {
  const parts = evidence.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => {
        if (!PATHLIKE.test(part)) return part;
        const trail = /[),.;]$/.test(part) ? part.slice(-1) : "";
        const path = trail ? part.slice(0, -1) : part;
        const shown = middleTruncate(worktreeRelative(path, storyKey));
        if (shown === path) return part;
        return (
          <span key={i}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span data-path={path} tabIndex={0} className="rounded-sm whitespace-nowrap">
                  {shown}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-md font-mono break-all">{path}</TooltipContent>
            </Tooltip>
            {trail}
          </span>
        );
      })}
    </>
  );
}
