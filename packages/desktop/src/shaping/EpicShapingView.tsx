/**
 * An Epic in its shaping view (docs/mvp-spec.md §3 "Shaping an Epic", issue #123): the Epic card beside
 * the Round dock.
 *
 * The Stage bar heads the view (`StageBar`, issue #126). The Epic card carries the record being shaped: its key, title and state, and its
 * spec (Problem, Scope, Out of scope, Exit test), each field still the developer's to edit in place through
 * `epic_update`, with an agent's pending spec change drawn under it as a ghost to decide in place (`GhostCard`,
 * issue #125), and its ADR and glossary chips (issue #129): the ADRs linked to it and the ADRs and terms
 * accepted on it that no Story has written into the repo yet. The dock beside it holds the agent's Rounds ([`RoundDock`]). From 1280px the two sit side
 * by side, the card at a reading measure and the dock taking the rest; below that they stack, the dock
 * first, so a Round waiting on you is the first thing on screen.
 *
 * Every read is keyed under the project, so the one `board:changed` subscription keeps the dock live as
 * the agent posts a Round and the developer answers it.
 */
import { useId, useState } from "react";
import { Label, Textarea, HoverCard, HoverCardContent, HoverCardTrigger, cn } from "@highknow/design";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookA, Check, Layers, PenLine, ScrollText, X } from "lucide-react";
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
import { RoundDock } from "./RoundDock";
import { StageBar } from "./StageBar";
import { StoryColumns } from "./StoryColumns";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { useSettle } from "./ProposalParts";

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
  const openStage = data?.stages.find((s) => s.state === "open");
  // Attention in place of the state word, as the board's Epic card shows it (issue #124): the core's
  // `waitingOnYou`, or an open Round with no live shaping session.
  const rounds = data?.rounds ?? [];
  // Issue #127: the Story columns hang off the Epic once it has a Story or a Story Proposal, or once slicing
  // has started.
  const stories = data?.stories ?? [];
  const showStories =
    stories.length > 0 ||
    (data?.proposals ?? []).some((p) => p.targetType === "story") ||
    (data?.stages ?? []).some((s) => s.kind === "slice" || s.kind === "criteria");
  const attention = rounds.some((r) => r.waitingOnYou)
    ? "waiting_on_you"
    : rounds.some((r) => r.state === "open") && sessionQuery.isSuccess && !sessionQuery.data
      ? "round_waiting"
      : null;

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
          // The Stage bar heads both (issue #126): where shaping stands, and the one control that advances it.
          // The Story columns (issue #127) take the whole width under both, before the earlier Rounds.
          <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 content-start items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-rows-[auto_auto_auto_1fr]">
            {data.stages.length > 0 && (
              <StageBar
                stages={data.stages}
                status={data.openStageStatus ?? null}
                projectId={projectId}
                sessionLive={Boolean(sessionQuery.data)}
                className="xl:col-span-2 xl:row-start-1"
              />
            )}
            <RoundDock
              rounds={data.rounds}
              openStage={openStage ?? null}
              sessionLive={Boolean(sessionQuery.data)}
              projectId={projectId}
              epic={epic}
              queryKey={queryKey}
              show="current"
              done={data.stages.length === 3 && data.stages.every((s) => s.state === "closed")}
              className="xl:col-start-2 xl:row-start-2"
            />
            <div className="min-w-0 self-stretch xl:col-start-1 xl:row-start-2">
              <EpicCard
                epic={epic}
                attention={attention}
                proposals={data.proposals ?? []}
                knowledge={knowledgeChips(data.adrLinks ?? [], data.acceptedKnowledge ?? [])}
                queryKey={queryKey}
              />
            </div>
            {showStories && (
              <StoryColumns
                projectId={projectId}
                criteria={(data?.stages ?? []).some((s) => s.kind === "criteria")}
                stories={stories}
                proposals={data.proposals ?? []}
                queryKey={queryKey}
                className="xl:col-span-2 xl:row-start-3"
              />
            )}
            <RoundDock
              rounds={data.rounds}
              openStage={openStage ?? null}
              sessionLive={Boolean(sessionQuery.data)}
              projectId={projectId}
              epic={epic}
              queryKey={queryKey}
              show="earlier"
              className="xl:col-start-2 xl:row-start-4"
            />
          </div>
        )}
      </SurfaceBody>
    </div>
  );
}

/** One ADR or glossary chip on the Epic card (issue #129). */
interface KnowledgeChip {
  key: string;
  kind: "adr" | "glossary";
  /** What the chip reads: an ADR's file name, a glossary term. */
  name: string;
  /** The full path or the term, for the tooltip. */
  title: string;
  /** Accepted on the Epic and not written into the repo yet: its first Story writes it. */
  pending: boolean;
}

/** The Epic's chips: every ADR linked to it, then every ADR and glossary term accepted on it, an accepted
 * ADR already linked shown once. */
function knowledgeChips(adrLinks: string[], accepted: ProposalDto[]): KnowledgeChip[] {
  const fileName = (path: string) => path.split("/").pop() || path;
  const chips: KnowledgeChip[] = adrLinks.map((path) => ({
    key: `link:${path}`,
    kind: "adr",
    name: fileName(path),
    title: path,
    pending: false,
  }));
  for (const p of accepted) {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    if (p.targetType === "adr") {
      const path = typeof payload.path === "string" ? payload.path : "";
      if (!path || adrLinks.includes(path)) continue;
      chips.push({ key: p.id, kind: "adr", name: fileName(path), title: path, pending: true });
    } else if (p.targetType === "glossary_term") {
      const term = [payload.term, payload.name, payload.title].find(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      );
      if (term) chips.push({ key: p.id, kind: "glossary", name: term, title: `GLOSSARY.md: ${term}`, pending: true });
    }
  }
  return chips;
}

function KnowledgeChips({ chips }: { chips: KnowledgeChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="ADRs and glossary" className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0 pt-1">
      {chips.map((chip) => (
        <li key={chip.key} className="flex min-w-0 max-w-full">
          {/* The whole path in a Hover Card (issue #211), opened by the pointer or by the keyboard's focus. */}
          <HoverCard openDelay={300} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Badge
                variant="outline"
                tabIndex={0}
                className={cn(
                  "max-w-full min-w-0 cursor-default text-meta font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  chip.pending && "border-dashed",
                )}
              >
                {chip.kind === "adr" ? <ScrollText aria-hidden="true" /> : <BookA aria-hidden="true" />}
                <span className="sr-only">
                  {chip.kind === "adr"
                    ? `ADR ${chip.title.slice(0, chip.title.length - chip.name.length)}`
                    : "Glossary term "}
                </span>
                <span className={cn("min-w-0 truncate", chip.kind === "adr" && "font-mono")}>{chip.name}</span>
                {chip.pending && (
                  <span className="shrink-0 text-meta text-muted-foreground">
                    {chip.kind === "adr" ? "· not in the repo yet" : "· not in GLOSSARY.md yet"}
                  </span>
                )}
              </Badge>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="flex w-auto max-w-96 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-1.5 text-meta font-semibold text-muted-foreground">
                {chip.kind === "adr" ? (
                  <ScrollText aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <BookA aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                {chip.kind === "adr" ? "ADR" : "Glossary term"}
              </span>
              <span className={cn("text-small break-all text-foreground", chip.kind === "adr" && "font-mono")}>
                {chip.kind === "adr" ? chip.title : chip.name}
              </span>
              <span className="text-meta text-muted-foreground">
                {chip.pending
                  ? chip.kind === "adr"
                    ? "Accepted on this Epic. Its first Story writes the file."
                    : "Accepted on this Epic. Its first Story adds it to GLOSSARY.md."
                  : "Linked to this Epic."}
              </span>
            </HoverCardContent>
          </HoverCard>
        </li>
      ))}
    </ul>
  );
}

function EpicCard({
  epic,
  attention,
  proposals,
  knowledge,
  queryKey,
}: {
  epic: EpicDto;
  attention: string | null;
  /** The ADR and glossary chips (issue #129). */
  knowledge: KnowledgeChip[];
  /** The Epic's pending and rejected Proposals (issue #125), drawn on the field each would rewrite. */
  proposals: ProposalDto[];
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
          <StateBadge state={attention ?? epic.state} className="h-5.5 text-meta" />
        </div>
        <h1 id={headingId} className="m-0 text-title font-semibold break-words">
          {epic.title}
        </h1>
        <KnowledgeChips chips={knowledge} />
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
  // An accepted Proposal settles into the field: its new text takes the running tint and fades to the card.
  const settle = useSettle(value);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const text = draft.trim();
    settle.own();
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
        <Label htmlFor={fieldId} className="text-meta font-semibold">
          {label}
        </Label>
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
              <Button type="submit" variant="outline" size="sm" loading={saving} aria-label={`Save ${label}`}>
                <Check aria-hidden="true" />
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </form>
        ) : value ? (
          <p
            data-settling={settle.settling || undefined}
            className={cn("m-0 max-w-[68ch] text-body whitespace-pre-wrap break-words", settle.className)}
          >
            {value}
          </p>
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
