/**
 * An Epic in its shaping view (docs/mvp-spec.md §3 "Shaping an Epic", issue #123): the Epic card beside
 * the Round dock.
 *
 * The Epic card carries the record being shaped: its key, title and state, the Stage it is in, and its
 * spec (Problem, Scope, Out of scope, Exit test), each field still the developer's to edit in place through
 * `epic_update`. The dock beside it holds the agent's Rounds ([`RoundDock`]). From 1280px the two sit side
 * by side, the card at a reading measure and the dock taking the rest; below that they stack, the dock
 * first, so a Round waiting on you is the first thing on screen.
 *
 * Every read is keyed under the project, so the one `board:changed` subscription keeps the dock live as
 * the agent posts a Round and the developer answers it.
 */
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, PenLine } from "lucide-react";
import { epicShapingRounds, epicShapingSession, epicUpdate, type EpicDto, type EpicSpecInput } from "../adapters/tauri";
import { useBoardChangedSubscription } from "../board/useBoardQuery";
import { EpicShapingControl } from "../board/EpicShapingControl";
import { errorText } from "../board/StoryControls";
import { StateBadge } from "../components/StateBadge";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
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
          <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <EpicCard epic={epic} stage={openStage ? { kind: openStage.kind, rank: openStage.rank } : null} queryKey={queryKey} />
            <div className="order-first flex min-w-0 flex-col gap-3 xl:order-none">
              <RoundDock rounds={data.rounds} sessionLive={Boolean(sessionQuery.data)} queryKey={queryKey} />
            </div>
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
  stage,
  queryKey,
}: {
  epic: EpicDto;
  stage: { kind: string; rank: number } | null;
  queryKey: readonly unknown[];
}) {
  const headingId = useId();
  const fields: { key: keyof EpicSpecInput; label: string }[] = [
    { key: "problem", label: "Problem" },
    { key: "scope", label: "Scope" },
    { key: "outOfScope", label: "Out of scope" },
    { key: "exitTest", label: "Exit test" },
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
          <SpecField key={field.key} epic={epic} field={field.key} label={field.label} queryKey={queryKey} />
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
}: {
  epic: EpicDto;
  field: keyof EpicSpecInput;
  label: string;
  queryKey: readonly unknown[];
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
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : value ? (
          <p className="m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words">{value}</p>
        ) : (
          <p className="m-0 text-body text-subtle-foreground">Not written yet</p>
        )}
        {error && (
          <p role="alert" className="m-0 mt-1.5 text-small break-words text-destructive-text">
            {error}
          </p>
        )}
      </dd>
    </div>
  );
}
