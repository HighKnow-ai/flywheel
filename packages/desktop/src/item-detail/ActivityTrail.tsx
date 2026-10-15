/**
 * The activity trail (BOARD-09, D-19): a scrollable section embedded inside the item detail
 * panel — not a separate surface, not a separate route (01-UI-SPEC.md "Activity trail").
 *
 * Reads straight from `events_activity_trail` (`packages/core/src/query/events.rs`), which is
 * itself one indexed query over the append-only `events` table — there is no second,
 * denormalised history anywhere in this codebase for this component to disagree with. The
 * underlying query is ascending by event id (chronological by construction); this component
 * reverses it for display only, so "what just happened" reads first, matching the supervision
 * persona — the query's own ascending window boundary (D-03) is never affected by how the list
 * is read.
 *
 * Paginated with `useInfiniteQuery`: each request is capped at 50 events server-side
 * (`events.rs`'s `TRAIL_MAX_LIMIT`), and "Load more" fetches the next 50-event page rather than
 * ever re-requesting a growing, unbounded window (Performance Contract: "never renders an
 * unbounded trail at once").
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { invokeCommand } from "../adapters/tauri";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import { useActors } from "../board/useBoardQuery";
import "./item-detail.css";

const PAGE_SIZE = 50;

export type ActivityTrailParentKind = "task" | "epic";

export interface ActivityEventDto {
  id: string;
  projectId: string;
  origin: string;
  sequence: number;
  actorId: string;
  eventType: string;
  /** The one-line human sentence the core rendered from the event's own payload (D-19) — this
   * component never re-derives it from raw payload fields, which are not sent over IPC at all. */
  description: string;
  occurredAt: string;
}

export interface ActivityTrailProps {
  parentType: ActivityTrailParentKind;
  parentId: string;
}

/**
 * Event types that are never folded into a neighbour: each is a distinct incident the reader should be
 * able to count (D-53: two lock-exhaustions are two entries). Everything else that repeats is noise.
 */
const NEVER_COLLAPSE = new Set(["git.lock_exhausted"]);

/**
 * Consecutive events that say the same thing, by the same actor, folded into one entry with a count (08.1-15
 * closure, finding 2: eight identical "criterion created" rows were the one thing that would embarrass the panel
 * on first open). Newest-first in, newest-first out; the folded entry keeps the NEWEST event's time. The trail's
 * pagination and ordering are untouched: this only changes how a page is drawn.
 */
export function collapseRepeats(newestFirst: ActivityEventDto[]): { event: ActivityEventDto; count: number }[] {
  const out: { event: ActivityEventDto; count: number }[] = [];
  for (const event of newestFirst) {
    const last = out[out.length - 1];
    if (
      last &&
      !NEVER_COLLAPSE.has(event.eventType) &&
      last.event.eventType === event.eventType &&
      last.event.description === event.description &&
      last.event.actorId === event.actorId
    ) {
      last.count += 1;
    } else {
      out.push({ event, count: 1 });
    }
  }
  return out;
}

function trailQueryKey(parentType: string, parentId: string) {
  return ["activity-trail", parentType, parentId] as const;
}

/** A relative "Xm/Xh/Xd ago" label — the absolute timestamp is carried in the entry's own
 * `title` attribute (native tooltip on hover), per 01-UI-SPEC.md "Activity trail". */
function relativeTime(iso: string): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function ActivityTrail({ parentType, parentId }: ActivityTrailProps) {
  const queryKey = trailQueryKey(parentType, parentId);

  const trailQuery = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) =>
      // `?? []`: an IPC response that resolves to `undefined` (a malformed/empty reply, or — in
      // tests — an unmocked command) must not crash the whole detail panel rendering the trail;
      // it is treated as an empty page instead. `getNextPageParam` below stays defensive too
      // (`lastPage?.length`) so a caller reaching this hook directly (bypassing `queryFn`, e.g. a
      // pre-populated `queryClient` cache) is equally safe.
      (await invokeCommand<ActivityEventDto[]>("events_activity_trail", {
        parentKind: parentType,
        parentId,
        limit: PAGE_SIZE,
        offset: pageParam,
      })) ?? [],
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      (lastPage?.length ?? 0) === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });

  const actorsQuery = useActors();
  const actorsById = new Map((actorsQuery.data ?? []).map((actor) => [actor.id, actor]));

  // Any mutation anywhere (title edit, status change, a criterion toggled) appends a new event —
  // the trail must invalidate on the same `board:changed` push every other surface already
  // subscribes to (D-04), never trusting a stale cache as the source of truth.
  useBoardChangedInvalidation({ kind: "viewed" }, [queryKey]);

  const ascendingEvents = trailQuery.data?.pages.flat() ?? [];
  // Reversed for display only (newest-first) — the query itself stays ascending by event id
  // (01-UI-SPEC.md "Activity trail").
  const newestFirst = [...ascendingEvents].reverse();

  return (
    <section aria-label="Activity" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <header className="detail-section-head">
        <span className="type-body detail-section-title">Activity</span>
      </header>

      {trailQuery.isPending && (
        <p className="type-body" style={{ color: "var(--text-muted-rack)", margin: 0 }}>
          Loading activity…
        </p>
      )}

      <div role="list" aria-label="Activity trail" style={{ display: "flex", flexDirection: "column" }}>
        {collapseRepeats(newestFirst).map(({ event, count }) => {
          const actor = actorsById.get(event.actorId);
          const absolute = new Date(event.occurredAt).toLocaleString();
          return (
            <div key={event.id} role="listitem" className="activity-entry">
              <span className="type-body">
                {event.description}
                {count > 1 && (
                  <>
                    {" "}
                    <span className="tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
                      ×{count}
                    </span>
                  </>
                )}
              </span>
              <span className="type-label tabular-nums activity-meta">
                {actor?.displayName ?? "Unknown actor"}
                {" · "}
                <time dateTime={event.occurredAt} title={absolute}>
                  {relativeTime(event.occurredAt)}
                </time>
              </span>
            </div>
          );
        })}
      </div>

      {trailQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => trailQuery.fetchNextPage()}
          disabled={trailQuery.isFetchingNextPage}
          className="type-label"
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            color: "var(--accent-text-rack)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {trailQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
