/**
 * A Milestone in its shaping view (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #132): its
 * exit test beside the Round dock, under the one-step Stage bar.
 *
 * A Milestone has one Stage, Exit test, so the Stage bar is its one-step variant (`StageBar` with
 * `MILESTONE_STAGES`): closing it with nothing open makes the Milestone Ready and starts no further session. The
 * Milestone card carries the record being shaped: its flag, its place on the Roadmap, its state (attention in
 * its place while a Round waits) and its name, then the exit test as prose at a reading measure, with an
 * agent's pending exit test drawn under it as a ghost to decide in place (`GhostCard`, `propose_exit_test`), and
 * the rejected ones struck through. The name and the exit test stay the developer's to edit in place through
 * `milestone_update` (issue #149), as the Epic card's spec fields are; a pending ghost stays under the exit
 * test while it is edited, and is still to decide after the save. A Done or Dropped Milestone offers no Edit.
 * Under it, the Milestones before and after it on the Roadmap with their exit
 * tests: the agent challenges the exit test until it can be told apart from them, so the developer reads them
 * here too. The dock beside it is the Epic's (`RoundDock`), with the Milestone's own Continue shaping.
 *
 * Every read is keyed under the project, so the one `board:changed` subscription keeps it live.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Flag, PenLine, X } from "lucide-react";
import {
  milestoneShapingRounds,
  milestoneShapingSession,
  milestoneUpdate,
  type MilestoneDto,
  type ProposalDto,
} from "../adapters/tauri";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useSettle } from "./ProposalParts";

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
  // Its one Stage closed, shaping is done: the dock waits for no Round (`RoundDock`'s `done`, issue #128).
  const done = Boolean(data && data.stages.length > 0 && data.stages.every((s) => s.state === "closed"));
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
              done={done}
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
  const exitTestFieldId = useId();
  const editable = milestone.state !== "done" && milestone.state !== "dropped";
  const titleEdit = useHandEdit(milestone, queryKey, "title");
  const exitTestEdit = useHandEdit(milestone, queryKey, "Exit test");
  // An accepted exit-test Proposal settles into the field; the Developer's own save does not tint it.
  const settle = useSettle(milestone.exitTest);
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
          {editable && !titleEdit.editing && (
            <EditButton edit={titleEdit} value={milestone.title} label="title" className="ml-auto" />
          )}
        </div>
        {/* The heading stays while the field is open, for the screen reader alone, so the card keeps its name. */}
        <h1 id={headingId} className={titleEdit.editing ? "sr-only" : "m-0 text-title font-semibold break-words"}>
          {milestone.title}
        </h1>
        {titleEdit.editing && (
          <EditForm edit={titleEdit} label="title" onSave={(draft) => titleEdit.save(draft, milestone.exitTest)}>
            <Input
              aria-label="Title"
              value={titleEdit.draft}
              autoFocus
              disabled={titleEdit.saving}
              className="h-10 text-title font-semibold"
              onChange={(e) => titleEdit.setDraft(e.target.value)}
              onKeyDown={titleEdit.escape}
            />
          </EditForm>
        )}
        {titleEdit.error && <EditError text={titleEdit.error} />}
      </header>
      <dl className="m-0 flex min-w-0 flex-col">
        <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-3.5">
          <dt className="flex min-h-6 items-center gap-2 text-meta font-semibold text-muted-foreground">
            <label id={exitTestId} htmlFor={exitTestFieldId}>
              Exit test
            </label>
            {editable && !exitTestEdit.editing && (
              <EditButton edit={exitTestEdit} value={milestone.exitTest ?? ""} label="Exit test" className="ml-auto" />
            )}
          </dt>
          {/* Named, and focusable so the keyboard lands here once a ghost under it is decided on a Milestone
              with no Edit (`GhostCard`); otherwise it lands on the Edit above. */}
          <dd tabIndex={-1} role="group" aria-labelledby={exitTestId} className="m-0 min-w-0 rounded-sm">
            {exitTestEdit.editing ? (
              <EditForm
                edit={exitTestEdit}
                label="Exit test"
                onSave={(draft) => {
                  settle.own();
                  return exitTestEdit.save(milestone.title, draft);
                }}
              >
                <Textarea
                  id={exitTestFieldId}
                  aria-label="Exit test"
                  value={exitTestEdit.draft}
                  autoFocus
                  disabled={exitTestEdit.saving}
                  className="max-w-[68ch]"
                  onChange={(e) => exitTestEdit.setDraft(e.target.value)}
                  onKeyDown={exitTestEdit.escape}
                />
              </EditForm>
            ) : milestone.exitTest ? (
              <p
                data-settling={settle.settling || undefined}
                className={cn("m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words", settle.className)}
              >
                {milestone.exitTest}
              </p>
            ) : (
              <p className="m-0 text-body text-subtle-foreground">Not written yet</p>
            )}
            {/* A pending ghost stays under the field while it is edited: the edit decides nothing for it. */}
            {ordered.map((p) => (
              <GhostCard key={p.id} proposal={p} label="Exit test" queryKey={queryKey} />
            ))}
            {exitTestEdit.error && <EditError text={exitTestEdit.error} />}
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

/**
 * One field of the Milestone edited by hand (issue #149): open or closed, the draft, the save through
 * `milestone_update` and its error, and the focus back on the field's Edit once the field closes.
 */
function useHandEdit(milestone: MilestoneDto, queryKey: readonly unknown[], label: string) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (wasEditing.current && !editing) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open(value: string) {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function close() {
    setError(null);
    setEditing(false);
  }

  async function save(title: string, exitTest: string | null) {
    if (saving) return;
    const name = title.trim();
    if (name === "") {
      setError("A Milestone needs a title: write one, or Cancel to keep it as it was.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await milestoneUpdate(milestone.id, name, exitTest?.trim() || null);
      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    } catch (err) {
      setError(`Could not save ${label}: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function escape(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  return { editing, draft, setDraft, saving, error, editRef, open, close, save, escape };
}

type HandEdit = ReturnType<typeof useHandEdit>;

/** The ghost Edit that opens a field in place, as on the Epic card (`SpecField`). */
function EditButton({ edit, value, label, className }: { edit: HandEdit; value: string; label: string; className?: string }) {
  return (
    <Button
      ref={edit.editRef}
      variant="ghost"
      size="xs"
      className={className}
      aria-label={`Edit ${label}`}
      onClick={() => edit.open(value)}
    >
      <PenLine aria-hidden="true" />
      Edit
    </Button>
  );
}

/** A field open in place, Save (outline) and Cancel (ghost) under it. */
function EditForm({
  edit,
  label,
  onSave,
  children,
}: {
  edit: HandEdit;
  label: string;
  onSave: (draft: string) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <form
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(edit.draft);
      }}
    >
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="sm" loading={edit.saving} aria-label={`Save ${label}`}>
          <Check aria-hidden="true" />
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={edit.saving} onClick={edit.close}>
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditError({ text }: { text: string }) {
  return (
    <p role="alert" className="m-0 mt-1.5 text-small break-words text-destructive-text">
      {text}
    </p>
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
