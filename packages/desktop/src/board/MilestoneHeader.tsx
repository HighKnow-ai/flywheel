import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { milestoneProgress, type MilestoneProgressDto } from "../adapters/tauri";
import { Icon, type IconName } from "../components/Icon";
import { StateBadge } from "../components/StateBadge";
import { Skeleton } from "../components/ui/skeleton";
import { ConfirmExitTest, milestoneExitTestConfirmable } from "./ConfirmExitTest";
import { AddEpicToMilestone } from "./AddRecordControls";
import { EPIC_STATE_WORDS } from "./EpicProgress";
import { MilestoneShapingControl, useMilestoneAttention } from "./MilestoneShapingControl";
import { BAR_SEGMENTS, StoryStateBar, type BarSegment } from "./StoryStateBar";
import { cn } from "@/lib/utils";

/**
 * The count boxes beside the lead box, as the Andon mockup lays them out: the life of a Story on the first
 * row (In review, Running, Ready, Shaping), then the two states that need the Developer (Waiting on you,
 * Stopped) on the second, followed by Dropped and Epics done.
 */
const BOX_ORDER: readonly BarSegment["key"][] = ["inReview", "running", "ready", "shaping", "waitingOnYou", "stopped"];

/**
 * The Milestone header (docs/mvp-spec.md §7, issue #106), drawn as the Andon production board
 * (docs/design/direction.md, `directions/andon.html`): the Milestone picked on the Roadmap strip (#131), the
 * Current one until another is picked. Its name and state, its Exit test
 * as prose, the next Milestone, a graphite lead box "Stories merged n/m", one count box per state, "Epics
 * done" and the stacked bar. Each Epic's own bar sits on its card in the roster below (`StoryBoard.tsx`), so
 * every Epic appears once on the board.
 *
 * Every number comes from the core's `milestone_progress` (one SQL statement for the header, one for the
 * Epic rows); the renderer counts nothing. Keyed under the project, so `board:changed` keeps it live.
 *
 * The count boxes are the bar's legend: each box that has a segment carries that segment's swatch along
 * its top edge. Dropped and Epics done have no segment, so they carry none. Waiting on you lights its box
 * yellow while any Story waits, the one place on the header that asks something of the Developer.
 */
export function MilestoneHeader({ projectId, milestoneId = null }: { projectId: string; milestoneId?: string | null }) {
  const progressQuery = useMilestoneProgress(projectId, milestoneId);

  if (progressQuery.isPending) {
    return <Skeleton aria-label="Loading the Milestone" className="h-[188px] w-full rounded-lg" />;
  }
  if (progressQuery.isError) {
    return (
      <HeaderCard>
        <p className="text-body text-destructive-text">
          {`The Milestone's progress could not be read: ${progressQuery.error instanceof Error ? progressQuery.error.message : String(progressQuery.error)}`}
        </p>
      </HeaderCard>
    );
  }
  const progress = progressQuery.data;
  if (!progress) {
    return (
      <HeaderCard>
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Flag size={16} strokeWidth={2} aria-hidden="true" />
          No Current Milestone. Every Milestone is Done or Dropped, or none is written yet.
        </p>
      </HeaderCard>
    );
  }
  return <MilestoneProgress projectId={projectId} progress={progress} />;
}

/**
 * The header's one core read: `milestoneId` (picked on the Roadmap strip), or the Current Milestone when it
 * is `null`. The roster reads the same key for each Epic's bar, so the two never disagree.
 */
export function useMilestoneProgress(projectId: string, milestoneId: string | null) {
  return useQuery({
    queryKey: ["board", projectId, "milestone-progress", milestoneId],
    queryFn: () => milestoneProgress(projectId, milestoneId),
  });
}

function HeaderCard({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Current Milestone"}
      data-slot="milestone-header"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-4 text-card-foreground shadow-card"
    >
      {children}
    </section>
  );
}

function MilestoneProgress({ projectId, progress }: { projectId: string; progress: MilestoneProgressDto }) {
  const { counts } = progress;
  const headingId = `milestone-${progress.milestoneId}`;
  // Issue #132: a Round waiting on its exit test shows in place of the state word, as on the Milestone card.
  const attention = useMilestoneAttention(projectId, { id: progress.milestoneId, state: progress.state });
  const confirmable = milestoneExitTestConfirmable(progress);
  return (
    <HeaderCard labelledBy={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-7 gap-y-4">
        <div className="flex min-w-[min(100%,320px)] flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Flag size={20} strokeWidth={2} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <h2 id={headingId} className="text-milestone font-bold tracking-[-0.015em]">
              {progress.title}
            </h2>
            <StateBadge
              state={attention ?? progress.state}
              label={attention ? undefined : EPIC_STATE_WORDS[progress.state]}
            />
            {/* Issue #132: Shape (or Answer, Open session, Continue shaping) while the Milestone is in Shaping;
                issue #134: Confirm exit test in the same place once every Epic is Done. */}
            {!confirmable && (
              <MilestoneShapingControl
                projectId={projectId}
                milestone={{ id: progress.milestoneId, title: progress.title, state: progress.state }}
                place="header"
              />
            )}
            {confirmable && (
              <ConfirmExitTest
                projectId={projectId}
                place="header"
                subject={{
                  kind: "milestone",
                  id: progress.milestoneId,
                  title: progress.title,
                  exitTest: progress.exitTest,
                  state: progress.state,
                }}
              />
            )}
            {/* Issue #168: + Epic adds an Epic to this Milestone, the one the roster below shows. */}
            <AddEpicToMilestone
              projectId={projectId}
              milestone={{ id: progress.milestoneId, title: progress.title, state: progress.state }}
            />
          </div>
          <p className="max-w-[72ch] text-[14.5px] leading-[1.45]">
            <b className="font-bold">Exit test:</b>{" "}
            {progress.exitTest ?? <span className="text-muted-foreground">not written yet</span>}
          </p>
          <p className="text-small text-muted-foreground">
            {progress.nextMilestoneTitle ? `Next: ${progress.nextMilestoneTitle}` : "No Milestone after this one yet"}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(5,minmax(96px,auto))] gap-1.5" role="list" aria-label="Stories by state">
          <LeadBox merged={counts.merged} total={counts.storiesTotal} />
          {BOX_ORDER.map((key) => BAR_SEGMENTS.find((s) => s.key === key) as BarSegment).map((segment) => (
            <CountBox
              key={segment.key}
              count={counts[segment.key]}
              label={segment.label}
              icon={segment.icon}
              swatch={segment.swatch}
              swatchStyle={segment.style}
              lit={segment.key === "waitingOnYou" && counts.waitingOnYou > 0}
            />
          ))}
          <CountBox count={counts.dropped} label="Dropped" icon="CircleSlash" quiet />
          <CountBox count={progress.epicsDone} of={progress.epicsTotal} label="Epics done" icon="Layers" />
        </div>
      </div>

      <StoryStateBar counts={counts} />
    </HeaderCard>
  );
}

/** The graphite lead box: Stories merged out of the Stories that will ship. Spans both rows of boxes. */
function LeadBox({ merged, total }: { merged: number; total: number }) {
  return (
    <div
      role="listitem"
      aria-label={`${merged} of ${total} Stories merged`}
      className="row-span-2 flex min-w-[124px] flex-col justify-between gap-2 rounded-md border border-border bg-strip px-3 pt-2.5 pb-2 text-strip-foreground"
    >
      <span className="type-condensed text-meta text-strip-muted-foreground">Stories merged</span>
      <span className="text-lead font-bold tracking-[-0.02em] tabular-nums">
        {merged}
        <span className="text-[26px] font-semibold tracking-normal text-strip-muted-foreground">/{total}</span>
      </span>
    </div>
  );
}

function CountBox({
  count,
  of,
  label,
  icon,
  swatch,
  swatchStyle,
  lit = false,
  quiet = false,
}: {
  count: number;
  of?: number;
  label: string;
  icon: IconName;
  /** The bar segment's swatch, drawn along the top edge: this box is that segment's legend. */
  swatch?: string;
  swatchStyle?: CSSProperties;
  /** Waiting on you with a Story waiting: the box takes the yellow fill. */
  lit?: boolean;
  /** A count that is not progress (Dropped): secondary ink. */
  quiet?: boolean;
}) {
  return (
    <div
      role="listitem"
      aria-label={of === undefined ? `${count} ${label}` : `${count} of ${of} ${label}`}
      data-lit={lit || undefined}
      className={cn(
        "relative flex flex-col gap-0.5 overflow-hidden rounded-md px-3 pt-2.5 pb-1.5",
        lit ? "bg-attention text-attention-foreground" : "border border-border bg-secondary text-foreground",
      )}
    >
      {swatch && !lit && <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", swatch)} style={swatchStyle} />}
      <span className={cn("text-count font-bold tracking-[-0.02em] tabular-nums", quiet && "text-muted-foreground")}>
        {count}
        {of !== undefined && <span className="text-[18px] font-semibold tracking-normal text-muted-foreground">/{of}</span>}
      </span>
      <span
        className={cn(
          "type-condensed flex items-center gap-1.5 text-meta whitespace-nowrap",
          lit ? "text-attention-foreground" : "text-muted-foreground",
        )}
      >
        <Icon name={icon} size={13} />
        {label}
      </span>
    </div>
  );
}
