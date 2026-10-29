/**
 * The Epic's Stories as columns (docs/mvp-spec.md §3 "Shaping an Epic", issue #127): the Stories hang off the
 * Epic card, left to right in execution order, each a column on the floor with its order number, its key, its
 * state and its title and description. Slicing writes into them through Proposals, decided where each lands and
 * never in an inbox:
 *
 * - A pending New Story is a ghost column standing where the Story would land (it carries the rank it proposed):
 *   a dashed primary edge on the running tint, "Proposed Story", its title and description, then Accept, Amend
 *   (its title, description and reason; never its place or what it runs after) and Reject.
 * - A pending move or retirement sits at the foot of its Story's column, saying where the Story would land or
 *   that it would be dropped, with the agent's why, then Accept and Reject.
 * - A runs-after constraint is a bracket drawn above the columns from the Story it runs after to the Story that
 *   waits, its one-line reason on it ("shares `FeedRow.tsx`"). It is informational and never blocks; a pending
 *   Story's bracket is dashed, the ghost's provisional mark.
 *
 * From the Write the Acceptance criteria Stage on (issue #128), each Story column stacks its criteria under its
 * description (`board/CriteriaList`, compact): each with its Check as a chip and its command, or judged at review,
 * and the developer's own Add Check, Change and Remove. A pending criterion Proposal is a ghost card under them,
 * decided there: Accept, Amend (its statement and Check; never its Story) or Reject.
 *
 * Rejected Story and criterion Proposals shrink to struck-through lines under the columns with the developer's
 * reason, like a rejected spec change. A Dropped Story leaves the order. The columns sit on the floor rather than inside a card,
 * since each is a card of its own.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { TruncateTip } from "@/components/TruncateTip";
import { Label, Input, ScrollArea, ScrollBar, Textarea, cn } from "@highknow/design";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Columns3,
  ListChecks,
  SquareTerminal,
} from "lucide-react";
import { proposalAccept, proposalAmend, proposalReject, type ProposalDto, type StoryDto } from "../adapters/tauri";
import { CriteriaList, useCriteria } from "../board/CriteriaList";
import { StateBadge } from "../components/StateBadge";
import { Button } from "@/components/Button";
import {
  AmendActions,
  DecisionGroup,
  OrderChip,
  ProposedBadge,
  RejectReasonForm,
  RejectedLine as RejectedProposal,
  announceDecision,
  type Decision,
} from "./ProposalParts";

/** The core's limits on a New Story (`proposal_apply::MAX_STORY_*`). */
const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 20_000;
const MAX_RUNS_AFTER_REASON_LEN = 500;
/** The core's limits on a New criterion (`proposal_apply::MAX_CRITERION_STATEMENT_LEN`, `MAX_CHECK_COMMAND_LEN`). */
const MAX_CRITERION_LEN = 2_000;
const MAX_CHECK_COMMAND_LEN = 2_000;
/** A column's width; the brackets above the columns meet their centres, half of it in. */
const COLUMN_WIDTH = "17.5rem";

/** A New Story Proposal's payload (`proposal_apply::NewStory`). */
interface NewStoryPayload {
  title: string;
  description: string | null;
  rank: string | null;
  runs_after_story_id: string | null;
  runs_after_proposal_id: string | null;
  runs_after_reason: string | null;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null);

/** A New Story Proposal's payload, or null for any other Proposal. */
export function newStoryOf(proposal: ProposalDto): NewStoryPayload | null {
  if (proposal.verb !== "create" || proposal.targetType !== "story") return null;
  const p = (proposal.payload ?? {}) as Record<string, unknown>;
  const title = text(p.title);
  if (!title) return null;
  return {
    title,
    description: text(p.description),
    rank: text(p.rank),
    runs_after_story_id: text(p.runs_after_story_id),
    runs_after_proposal_id: text(p.runs_after_proposal_id),
    runs_after_reason: text(p.runs_after_reason),
  };
}

/** A New criterion Proposal's payload (`proposal_apply::NewCriterion`, issue #128). */
interface NewCriterionPayload {
  story_id: string;
  statement: string;
  /** `null`: judged at review. */
  check_command: string | null;
}

/** A New criterion Proposal's payload, or null for any other Proposal. */
export function newCriterionOf(proposal: ProposalDto): NewCriterionPayload | null {
  if (proposal.verb !== "create" || proposal.targetType !== "criterion") return null;
  const p = (proposal.payload ?? {}) as Record<string, unknown>;
  const storyId = text(p.story_id);
  const statement = text(p.statement);
  if (!storyId || !statement) return null;
  return { story_id: storyId, statement, check_command: text(p.check_command) };
}

type Column =
  | { kind: "story"; id: string; rank: string; story: StoryDto }
  | { kind: "ghost"; id: string; rank: string; proposal: ProposalDto; draft: NewStoryPayload };

/** How a column is named in a sentence: a Story by its key, a ghost by its title. */
function shortName(column: Column) {
  return column.kind === "story" ? column.story.key : column.draft.title;
}

/** The order the core keeps: rank, then id. A New Story with no rank (filed by a Story session) goes last. */
function byRank(a: { rank: string; id: string }, b: { rank: string; id: string }) {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reason(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** One end of a bracket: a Story by its key, a pending Story by its column number in a dashed chip. */
interface ColumnRef {
  number: number;
  key: string | null;
}

interface Constraint {
  key: string;
  /** 1-based column of the Story it runs after. */
  from: number;
  /** 1-based column of the Story that waits. */
  to: number;
  /** How the Story it runs after is named. */
  fromName: string;
  /** The two ends as the bracket draws them: the Story that waits, then the one it runs after. */
  ends: [ColumnRef, ColumnRef];
  /** The Story that waits is placed before the one it runs after: said, never refused. */
  earlier: boolean;
  sentence: string;
  reason: string;
  provisional: boolean;
}

export interface StoryColumnsProps {
  /** The project the Epic belongs to: each column's criteria are read under it (issue #128). */
  projectId: string;
  /** The Epic's Stories, in any order. */
  stories: StoryDto[];
  /** The Epic's pending and rejected Proposals; only the Story and criterion ones are drawn here. */
  proposals: ProposalDto[];
  /** The read to refresh once a decision lands. */
  queryKey: readonly unknown[];
  /**
   * Whether each column stacks its Acceptance criteria (issue #128): from the Criteria Stage on, or as soon as a
   * criterion or a criterion Proposal exists. Slicing leaves them out.
   */
  criteria?: boolean;
  className?: string | undefined;
}

export function StoryColumns({
  projectId,
  stories,
  proposals,
  queryKey,
  criteria = false,
  className,
}: StoryColumnsProps) {
  const headingId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const storyProposals = proposals.filter((p) => p.targetType === "story");
  const pending = storyProposals.filter((p) => p.state === "pending");
  // Issue #128: criterion Proposals, drawn under the Story each is for.
  const criterionProposals = proposals.filter((p) => newCriterionOf(p) !== null);
  const pendingCriteria = criterionProposals.filter((p) => p.state === "pending");
  const rejected = [...storyProposals, ...criterionProposals].filter((p) => p.state === "rejected");
  const showCriteria = criteria || criterionProposals.length > 0;

  const columns: Column[] = [
    ...stories
      .filter((s) => s.state !== "dropped")
      .map((story) => ({ kind: "story" as const, id: story.id, rank: story.rank, story })),
    ...pending.flatMap((proposal) => {
      const draft = newStoryOf(proposal);
      return draft ? [{ kind: "ghost" as const, id: proposal.id, rank: draft.rank ?? "￿", proposal, draft }] : [];
    }),
  ].sort(byRank);

  const position = (id: string | null) => (id ? columns.findIndex((c) => c.id === id) + 1 : 0);
  const constraints: Constraint[] = columns.flatMap((column, index) => {
    const after =
      column.kind === "story"
        ? column.story.runsAfterStoryId
        : (column.draft.runs_after_story_id ?? column.draft.runs_after_proposal_id);
    const why = column.kind === "story" ? column.story.runsAfterReason : column.draft.runs_after_reason;
    const from = position(after);
    // `from` is 0 for no constraint, and `columns[-1]` is undefined.
    const target = columns[from - 1];
    if (!target || from === index + 1) return [];
    const provisional = column.kind === "ghost" || target.kind === "ghost";
    const earlier = from > index + 1 ? ", though it comes first in the order" : "";
    return [
      {
        key: column.id,
        from,
        to: index + 1,
        fromName: shortName(target),
        ends: [
          { number: index + 1, key: column.kind === "story" ? column.story.key : null },
          { number: from, key: target.kind === "story" ? target.story.key : null },
        ] as [ColumnRef, ColumnRef],
        earlier: from > index + 1,
        sentence: `${shortName(column)} runs after ${shortName(target)}${earlier}`,
        reason: why ?? "",
        provisional,
      },
    ];
  });
  // The longest bracket on top, so the short ones sit nearest the columns they join.
  constraints.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.from - b.from);

  const proposed = columns.filter((c) => c.kind === "ghost").length;
  const recorded = columns.length - proposed;
  const grid = { gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, ${COLUMN_WIDTH})` };

  /** Once a decision lands, the control that made it may be gone: the keyboard stays on the columns. */
  const settle = () => regionRef.current?.focus();

  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={headingId} className="m-0 flex items-center gap-2 text-section font-semibold">
          <Columns3 aria-hidden="true" size={18} className="shrink-0 self-center text-muted-foreground" />
          Stories
        </h2>
        <span className="text-meta text-muted-foreground tabular-nums">
          {columns.length === 0
            ? "In execution order, left to right"
            : [
                `${recorded} ${recorded === 1 ? "Story" : "Stories"}`,
                proposed > 0 ? `${proposed} proposed` : null,
                "in execution order, left to right",
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        {columns.length > 0 && <OverflowChips regionRef={regionRef} watch={columns.map((c) => c.id).join()} />}
      </header>

      {columns.length === 0 ? (
        <p className="m-0 max-w-[68ch] text-body text-muted-foreground">
          No Story yet. In Slice into Stories the agent proposes each one here, where it falls in the order, for you to
          accept, amend or reject.
        </p>
      ) : (
        // A horizontal Scroll Area that bleeds into the surface's gutter by its own edge padding: at rest the first
        // column lines up with the heading, and scrolled to its end the last column and every bracket label keep
        // that same padding from the edge instead of running into it (issue #211, F46).
        <ScrollArea
          role="region"
          aria-labelledby={headingId}
          className={cn(
            "-mx-3 min-w-0",
            "data-[overflow-after=true]:[mask-image:linear-gradient(to_right,#000_calc(100%-3rem),transparent)]",
            "data-[overflow-before=true]:[mask-image:linear-gradient(to_left,#000_calc(100%-3rem),transparent)]",
            "data-[overflow-before=true]:data-[overflow-after=true]:[mask-image:linear-gradient(to_right,transparent,#000_3rem,#000_calc(100%-3rem),transparent)]",
          )}
          ref={(root: HTMLDivElement | null) => {
            const viewport = root?.querySelector<HTMLDivElement>("[data-slot=scroll-area-viewport]") ?? null;
            // Once a decision lands the control that made it may be gone: the keyboard lands on the strip.
            if (viewport) viewport.tabIndex = -1;
            regionRef.current = viewport;
          }}
        >
          <div className="w-max px-3 pt-1 pb-4">
            <div className="flex w-max flex-col">
              {constraints.length > 0 && (
                <ul
                  aria-label="Runs-after constraints"
                  className="relative m-0 list-none p-0"
                  style={{ height: constraints.length * BRACKET_ROW + BRACKET_FOOT }}
                >
                  {constraints.map((c, row) => (
                    <Bracket key={c.key} constraint={c} row={row} count={columns.length} />
                  ))}
                </ul>
              )}
              <ol
                aria-label="Stories in execution order"
                className="m-0 grid list-none items-start gap-x-3 p-0"
                style={grid}
              >
                {columns.map((column, index) =>
                  column.kind === "story" ? (
                    <StoryColumn
                      key={column.id}
                      projectId={projectId}
                      number={index + 1}
                      story={column.story}
                      columns={columns}
                      proposals={pending.filter(
                        (p) => p.targetId === column.id && (p.verb === "reorder" || p.verb === "retire"),
                      )}
                      criteria={
                        showCriteria ? pendingCriteria.filter((p) => newCriterionOf(p)?.story_id === column.id) : null
                      }
                      queryKey={queryKey}
                      onSettled={settle}
                    />
                  ) : (
                    <GhostColumn
                      key={column.id}
                      number={index + 1}
                      proposal={column.proposal}
                      draft={column.draft}
                      runsAfter={constraints.find((c) => c.key === column.id)?.fromName ?? null}
                      queryKey={queryKey}
                      onSettled={settle}
                    />
                  ),
                )}
              </ol>
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}

      {rejected.length > 0 && (
        <ul aria-label="Rejected Proposals" className="m-0 flex list-none flex-col gap-2 p-0">
          {rejected.map((p) => (
            <RejectedLine key={p.id} proposal={p} stories={stories} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One bracket's row above the columns: its label, then its line. */
const BRACKET_ROW = 30;
/** How far the lowest bracket's feet reach down to the columns. */
const BRACKET_FOOT = 8;
/** Where a column's centre sits, from the left edge of the first column. */
const centre = (column: number) => `${column - 1} * (${COLUMN_WIDTH} + 0.75rem) + ${COLUMN_WIDTH} / 2`;
/**
 * A foot's x. A bracket's arrow lands just left of its column's centre and a bracket starts just right of it, so a
 * Story that both waits and is waited on carries two feet, never one line that reads as both.
 */
const footX = (column: number, end: "arrow" | "start") => `(${centre(column)} ${end === "arrow" ? "-" : "+"} 0.75rem)`;

/**
 * A runs-after bracket: a line from the centre of the column it runs after to the centre of the one that waits,
 * its feet running down to the tops of both columns and an arrow on the one that waits. The label sits over the
 * arrow's end, so it reads as a sentence about the Story under it; it knocks out the feet of the brackets above.
 */
function Bracket({ constraint, row, count }: { constraint: Constraint; row: number; count: number }) {
  const { from, to, provisional } = constraint;
  const [left, right] = from < to ? [from, to] : [to, from];
  const arrowOnRight = to > from;
  const leftFoot = footX(left, arrowOnRight ? "start" : "arrow");
  const rightFoot = footX(right, arrowOnRight ? "arrow" : "start");
  // Each bracket has a row of its own, so its label may run past the bracket's span, away from the arrow, as far
  // as the strip's own edge: a short bracket between neighbours keeps its reason instead of cutting it to "·".
  const strip = `(${count} * ${COLUMN_WIDTH} + ${count - 1} * 0.75rem)`;
  const labelMax = arrowOnRight ? `calc(${rightFoot} + 0.5rem)` : `calc(${strip} - ${leftFoot} + 0.5rem)`;
  return (
    <li
      data-from={from}
      data-to={to}
      data-provisional={String(provisional)}
      className="absolute bottom-0 min-w-0"
      style={{ top: row * BRACKET_ROW, left: `calc${leftFoot}`, width: `calc(${rightFoot} - ${leftFoot})` }}
      title={constraint.reason ? `${constraint.sentence}: ${constraint.reason}` : constraint.sentence}
    >
      <span className="sr-only">
        {constraint.sentence}
        {constraint.reason ? `: ${constraint.reason}` : ""}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute bottom-0 rounded-t-sm border border-b-0",
          provisional ? "border-dashed border-primary" : "border-input",
        )}
        style={{ top: 21, left: 0, right: 0 }}
      >
        <ArrowDown
          size={12}
          strokeWidth={2.5}
          className={cn(
            "absolute -bottom-0.5",
            provisional ? "text-running" : "text-muted-foreground",
            arrowOnRight ? "-right-[6.5px]" : "-left-[6.5px]",
          )}
        />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0 z-10 flex h-5 w-max min-w-0 items-center gap-1.5 bg-background px-1 text-meta",
          arrowOnRight ? "right-0 translate-x-2" : "left-0 -translate-x-2",
        )}
        style={{ maxWidth: labelMax }}
      >
        <span className={cn("flex shrink-0 items-center gap-1.5", provisional ? "text-running" : "text-foreground")}>
          <End end={constraint.ends[0]} />
          <span className="font-semibold">runs after</span>
          <End end={constraint.ends[1]} />
          {constraint.earlier && <span className="text-muted-foreground">yet comes first</span>}
        </span>
        {constraint.reason && (
          <>
            <span className="shrink-0 text-subtle-foreground">·</span>
            <span className="min-w-0 truncate text-muted-foreground">{constraint.reason}</span>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * The columns past either edge of the strip, named with what in them waits on a decision, as two buttons in the
 * heading that scroll the strip that way. Once the strip mounts, a pending Proposal past the right edge is scrolled into view.
 */
function OverflowChips({ regionRef, watch }: { regionRef: RefObject<HTMLDivElement | null>; watch: string }) {
  const [edges, setEdges] = useState({ before: 0, after: 0, pendingBefore: 0, pendingAfter: 0 });
  const scrolledOnce = useRef(false);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const measure = () => {
      const box = region.getBoundingClientRect();
      const next = { before: 0, after: 0, pendingBefore: 0, pendingAfter: 0 };
      for (const li of Array.from(region.querySelectorAll<HTMLElement>("ol > li"))) {
        const r = li.getBoundingClientRect();
        const pending = li.dataset.state === "pending" || li.querySelector('[data-state="pending"]') !== null;
        if (r.right > box.right + 1) {
          next.after += 1;
          if (pending) next.pendingAfter += 1;
        } else if (r.left < box.left - 1) {
          next.before += 1;
          if (pending) next.pendingBefore += 1;
        }
      }
      // The Scroll Area fades whichever edge has columns past it, so a column cut there reads as more to scroll to.
      const root = region.parentElement;
      if (root) {
        root.dataset.overflowBefore = String(next.before > 0);
        root.dataset.overflowAfter = String(next.after > 0);
      }
      setEdges((prev) =>
        prev.before === next.before &&
        prev.after === next.after &&
        prev.pendingBefore === next.pendingBefore &&
        prev.pendingAfter === next.pendingAfter
          ? prev
          : next,
      );
    };
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      const first = region.querySelector<HTMLElement>('ol > li[data-state="pending"], ol > li [data-state="pending"]');
      if (first) {
        const overshoot = first.getBoundingClientRect().right - region.getBoundingClientRect().right;
        if (overshoot > 0) region.scrollLeft += overshoot + 24;
      }
    }
    measure();
    region.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(region);
    return () => {
      region.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [regionRef, watch]);

  const scroll = (direction: 1 | -1) => {
    const region = regionRef.current;
    if (!region) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    region.scrollBy({ left: direction * region.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };
  const words = (count: number, pendingCount: number, side: string) =>
    [`${count} ${side}`, pendingCount > 0 ? `${pendingCount} to decide` : null].filter(Boolean).join(" · ");

  return (
    <>
      {(edges.before > 0 || edges.after > 0) && (
        <span className="ml-auto flex items-center gap-2 self-center">
          <Button
            variant="outline"
            size="sm"
            disabled={edges.before === 0}
            className={cn(edges.before === 0 && "invisible")}
            onClick={() => scroll(-1)}
            aria-label={`Scroll to the earlier Stories: ${words(edges.before, edges.pendingBefore, "earlier")}`}
          >
            <ChevronLeft aria-hidden="true" />
            <span className="tabular-nums">{words(edges.before, edges.pendingBefore, "earlier")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={edges.after === 0}
            className={cn(edges.after === 0 && "invisible")}
            onClick={() => scroll(1)}
            aria-label={`Scroll to the later Stories: ${words(edges.after, edges.pendingAfter, "more")}`}
          >
            <span className="tabular-nums">{words(edges.after, edges.pendingAfter, "more")}</span>
            <ChevronRight aria-hidden="true" />
          </Button>
        </span>
      )}
    </>
  );
}

function End({ end }: { end: ColumnRef }) {
  return end.key ? (
    <span className="font-mono text-small text-foreground">{end.key}</span>
  ) : (
    <OrderChip number={end.number} tone="ghost" />
  );
}

/**
 * Accept, Amend and Reject all end the same way: refresh the read and say what the decision did, or say why it
 * failed. `pending` names the decision under way, for its button's `loading`.
 */
function useDecision(queryKey: readonly unknown[], what: string, onSettled: () => void) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: Decision, write: () => Promise<void>) {
    if (pending) return;
    setPending(decision);
    setError(null);
    try {
      await write();
      announceDecision(decision, what);
      await queryClient.invalidateQueries({ queryKey });
      onSettled();
    } catch (err) {
      setError(`Could not decide ${what}: ${reason(err)}`);
      setPending(null);
    }
  }
  return { pending, busy: pending !== null, error, setError, decide };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="m-0 text-small break-words text-destructive-text">
      {error}
    </p>
  );
}

function StoryColumn({
  projectId,
  number,
  story,
  columns,
  proposals,
  criteria,
  queryKey,
  onSettled,
}: {
  projectId: string;
  number: number;
  story: StoryDto;
  columns: Column[];
  /** Its pending move and retirement Proposals. */
  proposals: ProposalDto[];
  /** Its pending criterion Proposals, or `null` while its criteria are not shown (slicing). */
  criteria: ProposalDto[] | null;
  queryKey: readonly unknown[];
  onSettled: () => void;
}) {
  return (
    <li
      aria-label={`${number}. ${story.key} ${story.title}`}
      data-state={story.state}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-card"
    >
      <div className="flex min-w-0 items-center gap-2">
        <OrderChip number={number} />
        <span className="min-w-0 truncate font-mono text-small text-muted-foreground">{story.key}</span>
        <StateBadge state={story.state} className="ml-auto h-5.5 shrink-0 text-meta" />
      </div>
      <h3 className="m-0 text-row font-semibold break-words">{story.title}</h3>
      {story.description ? (
        <TruncateTip text={story.description}>
          <p className="m-0 line-clamp-6 text-small whitespace-pre-wrap break-words text-muted-foreground">
            {story.description}
          </p>
        </TruncateTip>
      ) : (
        <p className="m-0 text-small text-subtle-foreground">No description yet</p>
      )}
      {criteria && (
        <StoryCriteria
          projectId={projectId}
          story={story}
          pending={criteria}
          queryKey={queryKey}
          onSettled={onSettled}
        />
      )}
      {proposals.map((p) => (
        <OrderPlate key={p.id} proposal={p} story={story} columns={columns} queryKey={queryKey} onSettled={onSettled} />
      ))}
    </li>
  );
}

/** Where a move would land the Story, among the other columns as they stand. */
function Landing({ proposal, story, columns }: { proposal: ProposalDto; story: StoryDto; columns: Column[] }) {
  const rank = text((proposal.payload as Record<string, unknown> | null)?.rank);
  if (!rank) return <>Moves elsewhere in the order</>;
  const before = columns.filter((c) => c.id !== story.id && byRank(c, { rank, id: story.id }) < 0);
  const prev = before[before.length - 1];
  if (!prev) return <>Moves to the front of the order</>;
  // Named as the columns name it: a Story by its key, a pending one by its dashed order chip.
  const number = columns.indexOf(prev) + 1;
  const title = prev.kind === "story" ? prev.story.title : prev.draft.title;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">Moves after</span>
      {prev.kind === "story" ? (
        <span className="shrink-0 font-mono text-small">{prev.story.key}</span>
      ) : (
        <OrderChip number={number} tone="ghost" />
      )}
      <TruncateTip text={title}>
        <span className="min-w-0 truncate">{title}</span>
      </TruncateTip>
    </span>
  );
}

/** A pending move or retirement at the foot of its Story's column. Accept or Reject; nothing to amend. */
function OrderPlate({
  proposal,
  story,
  columns,
  queryKey,
  onSettled,
}: {
  proposal: ProposalDto;
  story: StoryDto;
  columns: Column[];
  queryKey: readonly unknown[];
  onSettled: () => void;
}) {
  const move = proposal.verb === "reorder";
  const noun = move ? "move" : "retirement";
  const { pending, busy, error, setError, decide } = useDecision(queryKey, `the ${noun} of ${story.key}`, onSettled);
  const [rejecting, setRejecting] = useState(false);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const Icon = move ? ArrowRightLeft : CircleSlash;
  return (
    <div
      role="group"
      aria-label={`Proposed ${noun} of ${story.key}`}
      data-state="pending"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-primary bg-running-muted px-2.5 py-2"
    >
      <ProposedBadge icon={<Icon aria-hidden="true" />}>Proposed {noun}</ProposedBadge>
      <div className="m-0 min-w-0 text-small break-words text-foreground">
        {move ? <Landing proposal={proposal} story={story} columns={columns} /> : "Drops it from the Epic"}
      </div>
      {proposal.rationale && (
        <p className="m-0 text-small break-words text-muted-foreground">Why: {proposal.rationale}</p>
      )}
      {rejecting ? (
        <RejectReasonForm
          stacked
          busy={busy}
          onReject={(why) => void decide("reject", () => proposalReject(proposal.id, why))}
          onCancel={() => {
            setRejecting(false);
            setError(null);
            requestAnimationFrame(() => rejectRef.current?.focus());
          }}
        />
      ) : (
        <DecisionGroup
          size="xs"
          name={(verb) => `${verb} the ${noun} of ${story.key}`}
          pending={pending}
          rejectRef={rejectRef}
          onAccept={() => void decide("accept", () => proposalAccept(proposal.id))}
          onReject={() => {
            setError(null);
            setRejecting(true);
          }}
        />
      )}
      <ErrorLine error={error} />
    </div>
  );
}

type Mode = "idle" | "amending" | "rejecting";

/** A pending New Story, standing where it would land. */
function GhostColumn({
  number,
  proposal,
  draft,
  runsAfter,
  queryKey,
  onSettled,
}: {
  number: number;
  proposal: ProposalDto;
  draft: NewStoryPayload;
  /** How the Story it runs after is named, when that one is on the columns. */
  runsAfter: string | null;
  queryKey: readonly unknown[];
  onSettled: () => void;
}) {
  const name = `the proposed Story ${draft.title}`;
  const { pending, busy, error, setError, decide } = useDecision(queryKey, name, onSettled);
  const [mode, setMode] = useState<Mode>("idle");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [why, setWhy] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const whyId = useId();
  const amendRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const runsAfterSomething = Boolean(draft.runs_after_story_id || draft.runs_after_proposal_id);

  function cancel() {
    const opener = mode === "amending" ? amendRef : rejectRef;
    setMode("idle");
    setError(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  function submitAmend(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const edited = {
      ...(proposal.payload as Record<string, unknown>),
      title: title.trim(),
      description: description.trim() === "" ? null : description.trim(),
      ...(runsAfterSomething ? { runs_after_reason: why.trim() } : {}),
    };
    void decide("amend", () => proposalAmend(proposal.id, edited));
  }

  const onEditKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submitAmend(e);
    }
  };

  return (
    <li
      aria-label={`${number}. Proposed Story: ${draft.title}`}
      data-state="pending"
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-primary bg-running-muted p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <OrderChip number={number} tone="ghost" />
        <ProposedBadge>Proposed Story</ProposedBadge>
      </div>

      {mode === "amending" ? (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submitAmend}>
          <Label htmlFor={titleId} className="text-meta font-semibold text-muted-foreground">
            Title
          </Label>
          {/* The whole title in sight while it is edited: it grows with its words, and Enter never breaks it. */}
          <Textarea
            id={titleId}
            rows={1}
            value={title}
            maxLength={MAX_TITLE_LEN}
            autoFocus
            disabled={busy}
            className="min-h-0 resize-none font-semibold"
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) e.preventDefault();
              onEditKey(e);
            }}
          />
          <Label htmlFor={descriptionId} className="text-meta font-semibold text-muted-foreground">
            Description
          </Label>
          <Textarea
            id={descriptionId}
            className="resize-none"
            value={description}
            maxLength={MAX_DESCRIPTION_LEN}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onEditKey}
          />
          {runsAfterSomething && (
            <>
              <Label htmlFor={whyId} className="text-meta font-semibold text-muted-foreground">
                Why it runs after {runsAfter ?? "the other Story"}
              </Label>
              <Input
                id={whyId}
                value={why}
                maxLength={MAX_RUNS_AFTER_REASON_LEN}
                disabled={busy}
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={onEditKey}
              />
            </>
          )}
          <AmendActions
            busy={busy}
            ready={Boolean(title.trim()) && !(runsAfterSomething && !why.trim())}
            subject={name}
            onCancel={cancel}
          />
        </form>
      ) : (
        <>
          <h3 className="m-0 text-row font-semibold break-words text-foreground">{draft.title}</h3>
          {draft.description && (
            <p className="m-0 text-small whitespace-pre-wrap break-words text-foreground">{draft.description}</p>
          )}
        </>
      )}

      {mode === "rejecting" && (
        <RejectReasonForm
          stacked
          busy={busy}
          onReject={(given) => void decide("reject", () => proposalReject(proposal.id, given))}
          onCancel={cancel}
        />
      )}

      {mode === "idle" && (
        <DecisionGroup
          size="xs"
          name={(verb) => `${verb} ${name}`}
          pending={pending}
          amendRef={amendRef}
          rejectRef={rejectRef}
          onAccept={() => void decide("accept", () => proposalAccept(proposal.id))}
          onAmend={() => {
            setTitle(draft.title);
            setDescription(draft.description ?? "");
            setWhy(draft.runs_after_reason ?? "");
            setError(null);
            setMode("amending");
          }}
          onReject={() => {
            setError(null);
            setMode("rejecting");
          }}
        />
      )}
      <ErrorLine error={error} />
    </li>
  );
}

/**
 * A Story's Acceptance criteria at the foot of its column, under its description (issue #128): the criteria already
 * on it (`CriteriaList`, compact), each with its Check as a chip or judged at review, then each pending criterion
 * as a ghost card, decided there.
 */
function StoryCriteria({
  projectId,
  story,
  pending,
  queryKey,
  onSettled,
}: {
  projectId: string;
  story: StoryDto;
  pending: ProposalDto[];
  queryKey: readonly unknown[];
  onSettled: () => void;
}) {
  const headingId = useId();
  const recorded = useCriteria(projectId, story.id).data?.length ?? 0;
  const count = [recorded > 0 ? String(recorded) : null, pending.length > 0 ? `${pending.length} proposed` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 border-t border-border pt-2.5">
      <h4 id={headingId} className="m-0 flex items-center gap-1.5 text-meta font-semibold text-muted-foreground">
        <ListChecks aria-hidden="true" className="size-3.5 shrink-0" />
        Acceptance criteria
        {count && <span className="font-normal tabular-nums text-subtle-foreground">{count}</span>}
      </h4>
      <CriteriaList
        projectId={projectId}
        storyId={story.id}
        storyKey={story.key}
        compact
        emptyText={pending.length > 0 ? null : "No criterion yet"}
      />
      {pending.map((p) => (
        <GhostCriterion key={p.id} proposal={p} queryKey={queryKey} onSettled={onSettled} />
      ))}
    </section>
  );
}

/** The Check a criterion would carry: its command, or judged at review. */
function ProposedCheck({ command }: { command: string | null }) {
  if (!command)
    return <StateBadge state="judged_at_review" label="Judged at review" className="h-5.5 self-start text-meta" />;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
      <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">Check: </span>
      <TruncateTip text={command} mono>
        <code className="min-w-0 truncate font-mono text-foreground">{command}</code>
      </TruncateTip>
    </span>
  );
}

/** A pending criterion under its Story: Accept, Amend (its statement and Check, never its Story) or Reject. */
function GhostCriterion({
  proposal,
  queryKey,
  onSettled,
}: {
  proposal: ProposalDto;
  queryKey: readonly unknown[];
  onSettled: () => void;
}) {
  const draft = newCriterionOf(proposal) as NewCriterionPayload;
  const name = `the proposed criterion ${draft.statement}`;
  const { pending, busy, error, setError, decide } = useDecision(queryKey, name, onSettled);
  const [mode, setMode] = useState<Mode>("idle");
  const [statement, setStatement] = useState("");
  const [command, setCommand] = useState("");
  const statementId = useId();
  const commandId = useId();
  const amendRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);

  function cancel() {
    const opener = mode === "amending" ? amendRef : rejectRef;
    setMode("idle");
    setError(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  function submitAmend(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    if (!statement.trim()) return;
    const edited = {
      story_id: draft.story_id,
      statement: statement.trim(),
      check_command: command.trim() === "" ? null : command.trim(),
    };
    void decide("amend", () => proposalAmend(proposal.id, edited));
  }

  const onEditKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submitAmend(e);
    }
  };

  return (
    <div
      role="group"
      aria-label={`Proposed criterion: ${draft.statement}`}
      data-state="pending"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-primary bg-running-muted px-2.5 py-2"
    >
      <ProposedBadge>Proposed criterion</ProposedBadge>
      {mode === "amending" ? (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submitAmend}>
          <Label htmlFor={statementId} className="text-meta font-semibold text-muted-foreground">
            Criterion
          </Label>
          <Textarea
            id={statementId}
            className="min-h-16 resize-none text-small"
            value={statement}
            maxLength={MAX_CRITERION_LEN}
            autoFocus
            disabled={busy}
            onChange={(e) => setStatement(e.target.value)}
            onKeyDown={onEditKey}
          />
          <Label htmlFor={commandId} className="block text-meta font-semibold text-muted-foreground">
            Check command <span className="font-normal">(blank: judged at review)</span>
          </Label>
          <Input
            id={commandId}
            value={command}
            maxLength={MAX_CHECK_COMMAND_LEN}
            disabled={busy}
            className="h-7.5 font-mono text-small"
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onEditKey}
          />
          <AmendActions busy={busy} ready={Boolean(statement.trim())} subject={name} onCancel={cancel} />
        </form>
      ) : (
        <>
          <p className="m-0 text-small font-semibold break-words text-foreground">{draft.statement}</p>
          <ProposedCheck command={draft.check_command} />
        </>
      )}
      {mode === "rejecting" && (
        <RejectReasonForm
          stacked
          busy={busy}
          onReject={(given) => void decide("reject", () => proposalReject(proposal.id, given))}
          onCancel={cancel}
        />
      )}
      {mode === "idle" && (
        <DecisionGroup
          size="xs"
          name={(verb) => `${verb} ${name}`}
          pending={pending}
          amendRef={amendRef}
          rejectRef={rejectRef}
          onAccept={() => void decide("accept", () => proposalAccept(proposal.id))}
          onAmend={() => {
            setStatement(draft.statement);
            setCommand(draft.check_command ?? "");
            setError(null);
            setMode("amending");
          }}
          onReject={() => {
            setError(null);
            setMode("rejecting");
          }}
        />
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** A rejected Story or criterion Proposal, shrunk to one struck-through line with the developer's reason. */
function RejectedLine({ proposal, stories }: { proposal: ProposalDto; stories: StoryDto[] }) {
  const draft = newStoryOf(proposal);
  const criterion = newCriterionOf(proposal);
  const key = stories.find((s) => s.id === (criterion?.story_id ?? proposal.targetId))?.key ?? "a Story";
  const [label, struck] = criterion
    ? [`Rejected criterion on ${key}: ${criterion.statement}`, criterion.statement]
    : draft
      ? [`Rejected Story ${draft.title}`, draft.title]
      : proposal.verb === "reorder"
        ? [`Rejected move of ${key}`, `Move ${key}`]
        : [`Rejected retirement of ${key}`, `Retire ${key}`];
  return <RejectedProposal as="li" label={label} struck={struck} reason={proposal.rejectionReason} />;
}
