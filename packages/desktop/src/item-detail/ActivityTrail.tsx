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
import { useEffect, type ComponentType } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as icons from "lucide-react";
import { invokeCommand, subscribeBoardChanged } from "../adapters/tauri";
import { actorTypeMarkId, MARKS_BY_ID } from "../legend/marks";
import { useActors } from "../board/useBoardQuery";

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

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
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
  const queryClient = useQueryClient();
  const queryKey = trailQueryKey(parentType, parentId);

  const trailQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      invokeCommand<ActivityEventDto[]>("events_activity_trail", {
        parentKind: parentType,
        parentId,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });

  const actorsQuery = useActors();
  const actorsById = new Map((actorsQuery.data ?? []).map((actor) => [actor.id, actor]));

  // Any mutation anywhere (title edit, status change, a criterion toggled) appends a new event —
  // the trail must invalidate on the same `board:changed` push every other surface already
  // subscribes to (D-04), never trusting a stale cache as the source of truth.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentType, parentId]);

  const ascendingEvents = trailQuery.data?.pages.flat() ?? [];
  // Reversed for display only (newest-first) — the query itself stays ascending by event id
  // (01-UI-SPEC.md "Activity trail").
  const newestFirst = [...ascendingEvents].reverse();

  return (
    <section aria-label="Activity" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Activity
        </span>
      </header>

      {trailQuery.isPending && (
        <p className="type-body" style={{ color: "var(--text-muted-rack)", margin: 0 }}>
          Loading activity…
        </p>
      )}

      <div role="list" aria-label="Activity trail" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {newestFirst.map((event) => {
          const actor = actorsById.get(event.actorId);
          const badgeMark = MARKS_BY_ID[actorTypeMarkId(actor?.actorType ?? "human")];
          const absolute = new Date(event.occurredAt).toLocaleString();
          return (
            <div
              key={event.id}
              role="listitem"
              style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}
            >
              <span
                aria-hidden="true"
                title={badgeMark?.label ?? "Unknown actor type"}
                style={{ display: "inline-flex", flexShrink: 0, marginTop: 2, color: "var(--text-muted-rack)" }}
              >
                <Icon name={badgeMark?.glyph ?? "User"} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="type-body">{event.description}</span>
                <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
                  {actor?.displayName ?? "Unknown actor"} · {badgeMark?.label ?? "Unknown"}
                  {" · "}
                  <time dateTime={event.occurredAt} title={absolute}>
                    {relativeTime(event.occurredAt)}
                  </time>
                </span>
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
