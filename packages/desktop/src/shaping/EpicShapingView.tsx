/**
 * An Epic in its shaping view (docs/mvp-spec.md §3 "Shaping an Epic", issue #123): the Epic card beside
 * the Round dock.
 *
 * The Epic card carries the record being shaped: its key, title and state, the Stage it is in, and its
 * spec (Problem, Scope, Out of scope, Exit test), each field still the developer's to edit in place through
 * `epic_update`, with an agent's pending spec change drawn under it as a ghost to decide in place (`GhostCard`,
 * issue #125). The dock beside it holds the agent's Rounds ([`RoundDock`]). From 1280px the two sit side
 * by side, the card at a reading measure and the dock taking the rest; below that they stack, the dock
 * first, so a Round waiting on you is the first thing on screen.
 *
 * Every read is keyed under the project, so the one `board:changed` subscription keeps the dock live as
 * the agent posts a Round and the developer answers it.
 */
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers, PenLine, X } from "lucide-react";
import {
  epicShapingRounds,
  epicShapingSession,
  epicUpdate,
  type EpicDto,
  type EpicSpecInput,
  type ProposalDto,
} from "../adapters/tauri";
import { useBoardChangedSubscription } from "../board/useBoardQuery";
import { EpicShapingControl } from "../board/EpicShapingControl";
import { errorText } from "../board/StoryControls";
import { StateBadge } from "../components/StateBadge";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
import { GhostCard, specChangeOf } from "./GhostCard";
import { RoundDock, STAGE_LABELS } from "./RoundDock";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The read the view and the board's Epic card share, keyed under the project. */
export function epicShapingKey(projectId: string, epicId: string) {
  return ["board", projectId, "shaping-rounds", epicId] as const;
}

export interface EpicShapingViewProps {
  projectId: string;
  projectName: string;
  epicId: string;
  onBack: () => void;
}

export function EpicShapingView({ projectId, projectName, epicId, onBack }: EpicShapingViewProps) {
  useBoardChangedSubscription(projectId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const queryKey = epicShapingKey(projectId, epicId);
  const shapingQuery = useQuery({ queryKey, queryFn: () => epicShapingRounds(epicId) });
  const sessionQuery = useQuery({
    queryKey: ["board", projectId, "shaping-session", epicId],
    queryFn: () => epicShapingSession(epicId),
  });

  const data = shapingQuery.data;
  const epic = data?.epic;
  const openStage = data?.stages.find((s) => s.state === "open") ?? data?.stages[data.stages.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        onBack={onBack}
        crumbs={[
          { label: projectName, onSelect: () => setCurrentProjectId(projectId) },
          { label: epic ? `${epic.key} ${epic.title}` : "Epic" },
        ]}
        actions={epic ? <EpicShapingControl projectId={projectId} epic={epic} place="epic" /> : null}
      />
      <SurfaceBody>
        {shapingQuery.isError ? (
          <p role="alert" className="m-0 text-body text-destructive-text">
            Could not read this Epic: {errorText(shapingQuery.error)}
          </p>
        ) : !data || !epic ? null : (
          // Stacked (under 1280px) in reading order: the current Round, the Epic it shapes, then the earlier
          // Rounds. From 1280px the Epic card holds the left column and both Round parts the right one.
          <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 content-start items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-rows-[auto_1fr]">
            <RoundDock
              rounds={data.rounds}
              sessionLive={Boolean(sessionQuery.data)}
              projectId={projectId}
              epic={epic}
              queryKey={queryKey}
              show="current"
              className="xl:col-start-2 xl:row-start-1"
            />
            <div className="min-w-0 self-stretch xl:col-start-1 xl:row-span-2 xl:row-start-1">
              <EpicCard epic={epic} proposals={data.proposals ?? []} stage={openStage ? { kind: openStage.kind, rank: openStage.rank } : null} queryKey={queryKey} />
            </div>
            <RoundDock
              rounds={data.rounds}
              sessionLive={Boolean(sessionQuery.data)}
              projectId={projectId}
              epic={epic}
              queryKey={queryKey}
              show="earlier"
              className="xl:col-start-2 xl:row-start-2"
            />
          </div>
        )}
      </SurfaceBody>
    </div>
  );
}

/** How many Stages a record of the Stage's kind is shaped in. */
function stageCount(kind: string) {
  return kind === "exit_test" ? 1 : 3;
}

function EpicCard({
  epic,
  proposals,
  stage,
  queryKey,
}: {
  epic: EpicDto;
  /** The Epic's pending and rejected Proposals (issue #125), drawn on the field each would rewrite. */
  proposals: ProposalDto[];
  stage: { kind: string; rank: number } | null;
  queryKey: readonly unknown[];
}) {
  const headingId = useId();
  // `column` is the field as a spec-change Proposal names it (issue #125).
  const fields: { key: keyof EpicSpecInput; column: string; label: string }[] = [
    { key: "problem", column: "problem", label: "Problem" },
    { key: "scope", column: "scope", label: "Scope" },
    { key: "outOfScope", column: "out_of_scope", label: "Out of scope" },
    { key: "exitTest", column: "exit_test", label: "Exit test" },
  ];
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-card xl:sticky xl:top-0"
    >
      <header className="flex min-w-0 flex-col gap-2 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Layers aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
          <span className="font-mono text-small text-muted-foreground">{epic.key}</span>
          <StateBadge state={epic.state} className="h-5.5 text-meta" />
        </div>
        <h1 id={headingId} className="m-0 text-title font-semibold break-words">
          {epic.title}
        </h1>
        {stage && (
          <p className="m-0 text-small text-muted-foreground">
            <span className="font-semibold text-foreground">{STAGE_LABELS[stage.kind] ?? stage.kind}</span>
            <span className="tabular-nums">
              {" "}
              · Stage {stage.rank} of {stageCount(stage.kind)}
            </span>
          </p>
        )}
      </header>
      <dl className="m-0 flex min-w-0 flex-col">
        {fields.map((field) => (
          <SpecField
            key={field.key}
            epic={epic}
            field={field.key}
            label={field.label}
            queryKey={queryKey}
            proposals={proposals
              .filter((p) => specChangeOf(p)?.field === field.column)
              .sort((a, b) => Number(a.state === "rejected") - Number(b.state === "rejected"))}
          />
        ))}
      </dl>
    </section>
  );
}

/** One spec field, read as prose and edited in place: the developer's own edit, never a Proposal. */
function SpecField({
  epic,
  field,
  label,
  queryKey,
  proposals,
}: {
  epic: EpicDto;
  field: keyof EpicSpecInput;
  label: string;
  queryKey: readonly unknown[];
  proposals: ProposalDto[];
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const value = epic[field] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const text = draft.trim();
    const spec: EpicSpecInput = {
      problem: epic.problem,
      scope: epic.scope,
      outOfScope: epic.outOfScope,
      exitTest: epic.exitTest,
      [field]: text === "" ? null : text,
    };
    try {
      await epicUpdate(epic.id, epic.title, spec);
      await queryClient.invalidateQueries({ queryKey });
      setEditing(false);
    } catch (err) {
      setError(`Could not save ${label}: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-3.5 last:border-b-0">
      <dt className="flex min-h-6 items-center gap-2 text-meta font-semibold text-muted-foreground">
        <label htmlFor={fieldId}>{label}</label>
        {!editing && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            aria-label={`Edit ${label}`}
            onClick={() => {
              setDraft(value ?? "");
              setError(null);
              setEditing(true);
            }}
          >
            <PenLine aria-hidden="true" />
            Edit
          </Button>
        )}
      </dt>
      <dd className="m-0 min-w-0">
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Textarea
              id={fieldId}
              aria-label={label}
              value={draft}
              autoFocus
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline" size="sm" disabled={saving} aria-label={`Save ${label}`}>
                <Check aria-hidden="true" />
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </form>
        ) : value ? (
          <p className="m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words">{value}</p>
        ) : (
          <p className="m-0 text-body text-subtle-foreground">Not written yet</p>
        )}
        {proposals.map((p) => (
          <GhostCard key={p.id} proposal={p} label={label} queryKey={queryKey} />
        ))}
        {error && (
          <p role="alert" className="m-0 mt-1.5 text-small break-words text-destructive-text">
            {error}
          </p>
        )}
      </dd>
    </div>
  );
}
