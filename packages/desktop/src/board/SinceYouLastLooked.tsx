/**
 * Since you last looked (issue #167, spec §7 item 4): what changed on this project between the Developer's
 * last visit to its board and this one, between Needs you and the roster.
 *
 * Opening the board is the visit: `boardVisit` returns the human-meaningful events after the project's cursor
 * (state moves, hand-offs, merges, Proposals filed or decided, Rounds opened or closed, Done confirmed) and
 * moves the cursor past them. It is called once per opening, never refetched: events that land while the board
 * is open are seen live on the board itself and are not added here, so the query key sits outside the
 * `["board", projectId]` prefix that `board:changed` invalidates, and it is dropped once the board unmounts so
 * the next opening is a fresh visit.
 *
 * Folded by default to one line, "n events since you last looked"; unfolding lists them oldest first, each a
 * line naming its record. Nothing here needs the Developer, so no signal colour is spent on it.
 */
import { useId, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FilePlus2,
  Flag,
  History,
  MessagesSquare,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import { boardVisit, type LookedEventDto, type SinceLastLookedDto } from "../adapters/tauri";
import { formatAge } from "../legend/runStatus";
import { errorText } from "./StoryControls";
import { stateWordOf } from "../components/StateBadge";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, LucideIcon> = {
  "story.state_changed": ArrowRight,
  "story.handed_off": Send,
  "epic.state_changed": Flag,
  "milestone.state_changed": Flag,
  "proposal.filed": FilePlus2,
  "proposal.accepted": Check,
  "proposal.rejected": X,
};

function kindIcon(eventType: string): LucideIcon {
  return KIND_ICON[eventType] ?? (eventType.startsWith("round.") ? MessagesSquare : ArrowRight);
}

/**
 * The core's default sentence for a state move names the states by their stored values ("Moved Story from
 * in_review to merged"), and that sentence is kept in each event as written. The timeline names them in the
 * glossary's words from StateBadge's one vocabulary ("In review", "Merged"), so old events read right too.
 * A sentence of any other shape (a confirmed exit test, a hand-off) is the core's own and is shown as it is.
 */
const STATE_MOVE = /^Moved (Story|Epic|Milestone) from ([a-z_]+) to ([a-z_]+)$/;

export function eventSentence(description: string): string {
  const move = STATE_MOVE.exec(description);
  if (!move) return description;
  const [, record, from, to] = move;
  return `Moved ${record} from ${stateWordOf(from)} to ${stateWordOf(to)}`;
}

export function SinceYouLastLooked({ projectId }: { projectId: string }) {
  const visit = useQuery({
    queryKey: ["board-visit", projectId],
    queryFn: () => boardVisit(projectId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Folded again whenever another project's board opens.
  return <Timeline key={projectId} visit={visit} />;
}

function Timeline({ visit }: { visit: UseQueryResult<SinceLastLookedDto> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (visit.isPending) return null;
  if (visit.isError) {
    return (
      <p className="m-0 text-small text-muted-foreground">
        {`Could not read what changed since you last looked: ${errorText(visit.error)}`}
      </p>
    );
  }
  // A backend with no answer reads as nothing new rather than breaking the board.
  const { total, events } = visit.data ?? { total: 0, events: [] };
  if (total === 0) {
    return (
      <section
        aria-label="Since you last looked"
        className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-4 text-small text-muted-foreground shadow-card"
      >
        <History aria-hidden="true" size={16} className="shrink-0 text-subtle-foreground" />
        Nothing changed since you last looked
      </section>
    );
  }

  const now = Date.now();
  return (
    <section aria-label="Since you last looked" className="rounded-lg border border-border bg-card shadow-card">
      <h2 className="m-0 text-body font-normal">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((was) => !was)}
          className={cn(
            "group/fold flex min-h-11 w-full items-center gap-2.5 rounded-lg px-4 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent",
            open && "rounded-b-none",
          )}
        >
          <ChevronRight
            aria-hidden="true"
            size={16}
            className={cn(
              "shrink-0 text-subtle-foreground transition-transform duration-(--duration-state) ease-(--ease) group-hover/fold:text-foreground",
              open && "rotate-90",
            )}
          />
          <History aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
          <span className="text-row">
            <span className="font-semibold tabular-nums">{total === 1 ? "1 event" : `${total} events`}</span>
            {" since you last looked"}
          </span>
          {events.length > 0 && (
            <span className="ml-auto shrink-0 text-meta text-subtle-foreground tabular-nums">
              {`over the last ${formatAge(events[0].occurredAt, now)}`}
            </span>
          )}
        </button>
      </h2>
      {open && (
        <div id={listId} className="border-t border-border">
          {events.length < total && (
            <p className="m-0 px-4 pt-2 text-meta text-subtle-foreground tabular-nums">{`The newest ${events.length} of ${total}`}</p>
          )}
          <ol aria-label="Since you last looked" className="m-0 list-none py-1 pl-0">
            {events.map((event) => (
              <TimelineRow key={event.id} event={event} now={now} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function TimelineRow({ event, now }: { event: LookedEventDto; now: number }) {
  const Icon = kindIcon(event.eventType);
  return (
    <li className="grid min-h-9 grid-cols-[64px_16px_minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-x-3 px-4">
      <time dateTime={event.occurredAt} className="text-right text-meta text-subtle-foreground tabular-nums">
        {`${formatAge(event.occurredAt, now)} ago`}
      </time>
      <Icon aria-hidden="true" size={16} className="text-muted-foreground" />
      <span className="flex min-w-0 items-baseline gap-2">
        {event.subjectKey && <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground">{event.subjectKey}</span>}
        <span className="truncate text-body font-semibold">{event.subjectTitle ?? "Roadmap"}</span>
      </span>
      <span className="truncate text-small text-muted-foreground">{eventSentence(event.description)}</span>
    </li>
  );
}
