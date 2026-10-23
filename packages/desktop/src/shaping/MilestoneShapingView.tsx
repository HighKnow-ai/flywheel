/**
 * A Milestone in its shaping view (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #132): its
 * exit test beside the Round dock, under the one-step Stage bar.
 *
 * A Milestone has one Stage, Exit test, so the Stage bar is its one-step variant (`StageBar` with
 * `MILESTONE_STAGES`): closing it with nothing open makes the Milestone Ready and starts no further session. The
 * Milestone card carries the record being shaped: its flag, its place on the Roadmap, its state (attention in
 * its place while a Round waits) and its name, then the exit test as prose at a reading measure, with an
 * agent's pending exit test drawn under it as a ghost to decide in place (`GhostCard`, `propose_exit_test`), and
 * the rejected ones struck through. Under it, the Milestones before and after it on the Roadmap with their exit
 * tests: the agent challenges the exit test until it can be told apart from them, so the developer reads them
 * here too. The dock beside it is the Epic's (`RoundDock`), with the Milestone's own Continue shaping.
 *
 * Every read is keyed under the project, so the one `board:changed` subscription keeps it live.
 */
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Flag } from "lucide-react";
import { milestoneShapingRounds, milestoneShapingSession, type MilestoneDto, type ProposalDto } from "../adapters/tauri";
import {
  ContinueMilestoneShapingButton,
  MilestoneShapingControl,
  milestoneSessionKey,
  milestoneShapingKey,
  useMilestoneAttention,
} from "../board/MilestoneShapingControl";
import { EPIC_STATE_WORDS } from "../board/EpicProgress";
import { useRoadmap } from "../board/RoadmapStrip";
import { errorText } from "../board/StoryControls";
import { useBoardChangedSubscription } from "../board/useBoardQuery";
import { StateBadge } from "../components/StateBadge";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
import { GhostCard } from "./GhostCard";
import { RoundDock } from "./RoundDock";
import { MILESTONE_STAGES, StageBar } from "./StageBar";

export interface MilestoneShapingViewProps {
  projectId: string;
  projectName: string;
  milestoneId: string;
  onBack: () => void;
}

export function MilestoneShapingView({ projectId, projectName, milestoneId, onBack }: MilestoneShapingViewProps) {
  useBoardChangedSubscription(projectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const queryKey = milestoneShapingKey(projectId, milestoneId);
  const shapingQuery = useQuery({ queryKey, queryFn: () => milestoneShapingRounds(milestoneId) });
  const sessionQuery = useQuery({
    queryKey: milestoneSessionKey(projectId, milestoneId),
    queryFn: () => milestoneShapingSession(milestoneId),
  });
  const roadmap = useRoadmap(projectId).data ?? [];

  const data = shapingQuery.data;
  const milestone = data?.milestone;
  const openStage = data?.stages.find((s) => s.state === "open");
  const sessionLive = Boolean(sessionQuery.data);
  // Attention in place of the state word, the same reading as the board's Milestone header (issue #124).
  const attention = useMilestoneAttention(projectId, { id: milestoneId, state: milestone?.state ?? "shaping" });
  const resume = milestone ? <ContinueMilestoneShapingButton projectId={projectId} milestone={milestone} /> : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        onBack={onBack}
        crumbs={[
          { label: projectName, onSelect: () => setCurrentProjectId(projectId) },
          { label: milestone ? milestone.title : "Milestone" },
        ]}
        actions={milestone ? <MilestoneShapingControl projectId={projectId} milestone={milestone} place="view" /> : null}
      />
      <SurfaceBody>
        {shapingQuery.isError ? (
          <p role="alert" className="m-0 text-body text-destructive-text">
            Could not read this Milestone: {errorText(shapingQuery.error)}
          </p>
        ) : !data || !milestone ? null : (
          // The Epic view's grid: stacked under 1280px (the current Round, the Milestone, the earlier Rounds),
          // side by side from 1280px, the Stage bar across both.
          <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 content-start items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-rows-[auto_auto_1fr]">
            {data.stages.length > 0 && (
              <StageBar
                stages={data.stages}
                status={data.openStageStatus ?? null}
                projectId={projectId}
                sessionLive={sessionLive}
                order={MILESTONE_STAGES}
                record="Milestone"
                className="xl:col-span-2 xl:row-start-1"
              />
            )}
            <RoundDock
              rounds={data.rounds}
              openStage={openStage ?? null}
              sessionLive={sessionLive}
              projectId={projectId}
              resume={resume}
              subject="Milestone"
              queryKey={queryKey}
              show="current"
              className="xl:col-start-2 xl:row-start-2"
            />
            <div className="min-w-0 self-stretch xl:col-start-1 xl:row-span-2 xl:row-start-2">
              <MilestoneCard
                milestone={milestone}
                attention={attention}
                proposals={data.proposals ?? []}
                roadmap={roadmap}
                queryKey={queryKey}
              />
            </div>
            <RoundDock
              rounds={data.rounds}
              openStage={openStage ?? null}
              sessionLive={sessionLive}
              projectId={projectId}
              resume={resume}
              subject="Milestone"
              queryKey={queryKey}
              show="earlier"
              className="xl:col-start-2 xl:row-start-3"
            />
          </div>
        )}
      </SurfaceBody>
    </div>
  );
}

function MilestoneCard({
  milestone,
  attention,
  proposals,
  roadmap,
  queryKey,
}: {
  milestone: MilestoneDto;
  attention: string | null;
  /** The pending and rejected exit-test Proposals, oldest first. */
  proposals: ProposalDto[];
  /** The project's Roadmap in order, for the Milestone's place and its neighbours. */
  roadmap: MilestoneDto[];
  queryKey: readonly unknown[];
}) {
  const headingId = useId();
  const exitTestId = useId();
  const index = roadmap.findIndex((m) => m.id === milestone.id);
  const before = index > 0 ? roadmap[index - 1] : null;
  const after = index >= 0 && index < roadmap.length - 1 ? roadmap[index + 1] : null;
  const stateWord = EPIC_STATE_WORDS[milestone.state] ?? milestone.state;
  // Pending first: the ghost sits right under the exit test, the struck-through lines after it.
  const ordered = proposals.slice().sort((a, b) => Number(a.state === "rejected") - Number(b.state === "rejected"));

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-card xl:sticky xl:top-0"
    >
      <header className="flex min-w-0 flex-col gap-2 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Flag aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
          {index >= 0 && (
            <span className="text-small text-muted-foreground tabular-nums">
              Milestone {index + 1} of {roadmap.length}
            </span>
          )}
          <StateBadge
            state={attention ?? milestone.state}
            label={attention ? undefined : stateWord}
            className="h-5.5 text-meta"
          />
          {milestone.current && <span className="text-meta font-semibold text-foreground">Current</span>}
        </div>
        <h1 id={headingId} className="m-0 text-title font-semibold break-words">
          {milestone.title}
        </h1>
      </header>
      <dl className="m-0 flex min-w-0 flex-col">
        <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-3.5">
          <dt id={exitTestId} className="flex min-h-6 items-center text-meta font-semibold text-muted-foreground">
            Exit test
          </dt>
          {/* Focusable and named, so the keyboard lands here once a ghost under it is decided (`GhostCard`). */}
          <dd tabIndex={-1} role="group" aria-labelledby={exitTestId} className="m-0 min-w-0 rounded-sm">
            {milestone.exitTest ? (
              <p className="m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words">{milestone.exitTest}</p>
            ) : (
              <p className="m-0 text-body text-subtle-foreground">Not written yet</p>
            )}
            {ordered.map((p) => (
              <GhostCard key={p.id} proposal={p} label="Exit test" queryKey={queryKey} />
            ))}
          </dd>
        </div>
        {(before || after) && (
          <div className="flex min-w-0 flex-col gap-2.5 px-5 py-3.5">
            <dt className="flex min-h-6 items-center text-meta font-semibold text-muted-foreground">
              Around it on the Roadmap
            </dt>
            <dd className="m-0 min-w-0">
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {before && <Neighbour milestone={before} place="Before" />}
                {after && <Neighbour milestone={after} place="After" />}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** A neighbouring Milestone and its exit test, which this one's must be told apart from. */
function Neighbour({ milestone, place }: { milestone: MilestoneDto; place: "Before" | "After" }) {
  const Arrow = place === "Before" ? ArrowUp : ArrowDown;
  return (
    <li className="flex min-w-0 items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
      <Arrow aria-hidden="true" className="text-subtle-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0 text-small break-words">
          <span className="sr-only">{place}: </span>
          <span className="font-semibold">{milestone.title}</span>
          <span className="text-muted-foreground"> · {EPIC_STATE_WORDS[milestone.state] ?? milestone.state}</span>
        </span>
        <span className="max-w-[68ch] text-small break-words text-muted-foreground">
          {milestone.exitTest ?? <span className="text-subtle-foreground">Exit test not written yet</span>}
        </span>
      </span>
    </li>
  );
}
