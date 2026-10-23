/**
 * The triage drawer (docs/mvp-spec.md §5 "One row" and "Card", issue #162): every Proposal a running Story filed
 * that waits on the developer, in a Sheet from the right, opened by Triage on the Needs-you Proposals row or by an
 * Epic row's "n Proposals" marker.
 *
 * Grouped by the record each lands on, in the core's order (`proposal_list_for_triage`): each Epic in Roadmap
 * order, then "Roadmap · after this Milestone" for the New Epics. Each card reads its kind, what it names, the
 * change (a Reorder's places as a before and after), the agent's why, its evidence, and the Story that filed it
 * with its age. Accept, Amend and Reject are the shaping ghost's own controls (`ProposalDecision`), on the same
 * commands, so a decision here is the same decision. Deciding never touches the session that filed it.
 *
 * A duplicate (issue #165) is flagged under what it names: what it repeats and the Story that filed that one, since
 * accepting the original closes it in the core.
 *
 * A judged-on change (an amended criterion or Epic spec) is not here: it is its own Needs-you item (issue #163).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, CircleMinus, Compass, Copy, FilePlus2, Layers, Lightbulb, ListChecks, ScanSearch } from "lucide-react";
import { proposalListForTriage, type ProposalDto, type TriageProposalDto } from "../adapters/tauri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProposalDecision, type AmendField } from "../shaping/GhostCard";
import { STORY_PROPOSAL_KIND_WORDS } from "../session/toolVerbs";
import { formatAge } from "../legend/runStatus";
import { needsYouQueryKey } from "../fleet/useFleet";
import { errorText } from "../board/StoryControls";
import { useTriageDrawer } from "./triageStore";

/** The drawer's read, under the board's key so `board:changed` keeps it live. */
export function triageQueryKey(projectId: string) {
  return ["board", projectId, "proposals-triage"] as const;
}

/** The longest texts the core accepts (`proposal_apply`'s limits). */
const MAX_STORY_TITLE_LEN = 500;
const MAX_STORY_DESCRIPTION_LEN = 20_000;
const MAX_EPIC_TITLE_LEN = 200;
const MAX_EPIC_TEXT_LEN = 4_000;

function field(payload: unknown, key: string): string {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : "";
}

type Kind = "new_story" | "reorder_story" | "retire_story" | "new_epic" | "amend_criterion" | "amend_epic_spec";

/** The `propose` kind a Proposal's verb and target make (issue #160's table). */
export function kindOf(p: ProposalDto): Kind | null {
  switch (`${p.verb} ${p.targetType}`) {
    case "create story":
      return "new_story";
    case "reorder story":
      return "reorder_story";
    case "retire story":
      return "retire_story";
    case "create epic":
      return "new_epic";
    case "amend criterion":
      return "amend_criterion";
    case "amend epic":
      return "amend_epic_spec";
    default:
      return null;
  }
}

const KIND_ICON: Record<Kind, ReactNode> = {
  new_story: <FilePlus2 />,
  reorder_story: <ArrowUpDown />,
  retire_story: <CircleMinus />,
  new_epic: <Layers />,
  amend_criterion: <ListChecks />,
  amend_epic_spec: <Layers />,
};

/** The card's title: what the Proposal names. */
function titleOf(t: TriageProposalDto): string {
  const kind = kindOf(t.proposal);
  if (kind === "reorder_story" || kind === "retire_story") return t.targetTitle ?? "";
  return field(t.proposal.payload, "title");
}

/** How the controls and the live region name a card: "New Story “Empty-line recovery”". */
function subjectOf(t: TriageProposalDto): string {
  const kind = kindOf(t.proposal);
  const words = kind ? STORY_PROPOSAL_KIND_WORDS[kind] : `${t.proposal.verb} ${t.proposal.targetType}`;
  const named = kind === "reorder_story" || kind === "retire_story" ? [t.targetKey, t.targetTitle].filter(Boolean).join(" ") : titleOf(t);
  return named ? `${words} “${named}”` : words;
}

/** What Amend edits: a New Story's title and description, a New Epic's title and problem; nothing else carries text. */
function amendOf(t: TriageProposalDto): { fields: AmendField[]; payload: (values: Record<string, string>) => unknown } | null {
  const payload = (t.proposal.payload ?? {}) as Record<string, unknown>;
  switch (kindOf(t.proposal)) {
    case "new_story":
      return {
        fields: [
          { name: "title", label: "Title", value: field(payload, "title"), maxLength: MAX_STORY_TITLE_LEN, required: true },
          { name: "description", label: "Description", value: field(payload, "description"), maxLength: MAX_STORY_DESCRIPTION_LEN, multiline: true },
        ],
        payload: (v) => ({ ...payload, title: v.title, description: v.description || null }),
      };
    case "new_epic":
      return {
        fields: [
          { name: "title", label: "Title", value: field(payload, "title"), maxLength: MAX_EPIC_TITLE_LEN, required: true },
          { name: "problem", label: "Problem", value: field(payload, "problem"), maxLength: MAX_EPIC_TEXT_LEN, multiline: true },
        ],
        payload: (v) => ({ ...payload, title: v.title, problem: v.problem || null }),
      };
    default:
      return null;
  }
}

/** One group of the drawer: an Epic, or the Roadmap. */
interface Group {
  key: string;
  epicId: string | null;
  cards: TriageProposalDto[];
}

function groupsOf(rows: TriageProposalDto[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const key = row.proposal.epicId ?? "roadmap";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.cards.push(row);
    else groups.push({ key, epicId: row.proposal.epicId, cards: [row] });
  }
  return groups;
}

function countWords(n: number): string {
  return n === 1 ? "1 Proposal" : `${n} Proposals`;
}

/** Triage, on the Needs-you Proposals row: opens the drawer at its top. */
export function TriageButton({ projectId, count }: { projectId: string; count: number }) {
  const openTriage = useTriageDrawer((s) => s.openTriage);
  return (
    <Button variant="outline" size="sm" aria-haspopup="dialog" aria-label={`Triage ${countWords(count)}`} onClick={() => openTriage(projectId)}>
      <ListChecks aria-hidden="true" />
      Triage
    </Button>
  );
}

/** "n Proposals" on an Epic row (spec §7 roster): opens the drawer at the Epic's group. */
export function ProposalsMarker({ projectId, epic, count }: { projectId: string; epic: { id: string; title: string }; count: number }) {
  const openTriage = useTriageDrawer((s) => s.openTriage);
  if (count <= 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-marker="proposals"
      aria-haspopup="dialog"
      aria-label={`Triage ${countWords(count)} on ${epic.title}`}
      className="shrink-0 tabular-nums"
      onClick={() => openTriage(projectId, epic.id)}
    >
      <Lightbulb aria-hidden="true" />
      {countWords(count)}
    </Button>
  );
}

/** The drawer, mounted once per board. */
export function ProposalDrawer({ projectId }: { projectId: string }) {
  const openFor = useTriageDrawer((s) => s.projectId);
  const epicId = useTriageDrawer((s) => s.epicId);
  const closeTriage = useTriageDrawer((s) => s.closeTriage);
  const open = openFor === projectId;
  const query = useQuery({
    queryKey: triageQueryKey(projectId),
    queryFn: () => proposalListForTriage(projectId),
    enabled: open,
  });
  const rows = query.data ?? [];
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeTriage()}>
      <SheetContent
        side="right"
        className="w-[560px] gap-0 bg-background data-[side=right]:w-[560px] data-[side=right]:sm:max-w-[560px]"
      >
        <SheetHeader className="border-b border-border bg-card px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-section font-semibold">
            <Lightbulb aria-hidden="true" size={18} />
            Triage Proposals
            {rows.length > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 rounded-md px-1.5 text-meta tabular-nums">
                {rows.length}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription className="text-small text-muted-foreground">
            Filed by running Stories, grouped by where each lands. Deciding never pauses an agent.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {open && <TriageList projectId={projectId} rows={rows} loaded={query.isSuccess} error={query.error} epicId={epicId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TriageList({
  projectId,
  rows,
  loaded,
  error,
  epicId,
}: {
  projectId: string;
  rows: TriageProposalDto[];
  loaded: boolean;
  error: unknown;
  epicId: string | null;
}) {
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const now = Date.now();
  const groups = groupsOf(rows);

  // Opened from an Epic's marker: that Epic's group comes into view, its heading holding the keyboard.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !loaded || !epicId) return;
    landed.current = true;
    const heading = listRef.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(epicId)}"] h3`);
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [loaded, epicId]);

  if (error) return <p className="m-0 text-small text-destructive-text">{`Could not read the Proposals: ${errorText(error)}`}</p>;
  if (loaded && rows.length === 0) {
    return (
      <div ref={emptyRef} tabIndex={-1} className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-4 shadow-card">
        <span role="status" className="sr-only">
          {announcement}
        </span>
        <span className="text-row font-semibold">Nothing to triage</span>
        <span className="text-small text-muted-foreground">
          A Proposal a running Story files shows here, under the Epic it lands on.
        </span>
      </div>
    );
  }

  /** Once a card is decided: the keyboard lands on the card now in its place, and the region says what is left. */
  function afterDecide(id: string): () => Promise<void> {
    return async () => {
      const cards = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-proposal-card]") ?? [])];
      const index = cards.findIndex((c) => c.dataset.proposalCard === id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: triageQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: needsYouQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: ["board", projectId] }),
      ]);
      const left = (queryClient.getQueryData<TriageProposalDto[]>(triageQueryKey(projectId)) ?? []).length;
      setAnnouncement(left === 0 ? "Decided. Nothing left to triage." : `Decided. ${countWords(left)} left to triage.`);
      requestAnimationFrame(() => {
        const now = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-proposal-card]") ?? [])];
        const card = now[Math.min(Math.max(index, 0), now.length - 1)];
        const target = card?.querySelector<HTMLElement>("[data-decision=accept]") ?? emptyRef.current;
        target?.focus();
      });
    };
  }

  return (
    <div ref={listRef} className="flex flex-col gap-5">
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {groups.map((group) => (
        <section key={group.key} data-group={group.epicId ?? "roadmap"} aria-labelledby={`triage-${group.key}`} className="flex flex-col gap-2.5">
          <GroupHeading id={`triage-${group.key}`} first={group.cards[0]} count={group.cards.length} />
          <ol aria-labelledby={`triage-${group.key}`} className="m-0 flex list-none flex-col gap-2.5 p-0">
            {group.cards.map((t) => (
              <TriageCard key={t.proposal.id} card={t} now={now} afterDecide={afterDecide(t.proposal.id)} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function GroupHeading({ id, first, count }: { id: string; first: TriageProposalDto; count: number }) {
  const roadmap = first.proposal.epicId === null;
  return (
    <h3 id={id} tabIndex={-1} className="m-0 flex min-w-0 items-center gap-2 px-0.5 text-row font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {roadmap ? (
        <>
          <Compass aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">Roadmap · after this Milestone</span>
        </>
      ) : (
        <>
          <Layers aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
          {first.epicKey && <span className="shrink-0 font-mono text-meta font-normal text-muted-foreground">{first.epicKey}</span>}
          <span className="min-w-0 truncate" title={first.epicTitle ?? undefined}>
            {first.epicTitle}
          </span>
        </>
      )}
      <span className="ml-auto shrink-0 text-meta font-medium text-subtle-foreground tabular-nums">{count}</span>
    </h3>
  );
}

/** A Reorder's change, as a before and after of where its Story sits. */
function ReorderDiff({ t }: { t: TriageProposalDto }) {
  const place = t.reorder;
  if (!place) return null;
  const words = (after: string | null) => (after ? `after ${after}` : "first in the Epic");
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-md bg-secondary px-3 py-2 text-small">
      <dt className="text-meta text-subtle-foreground">Now</dt>
      <dd className="m-0 text-muted-foreground">
        <del className="font-mono decoration-1">{words(place.nowAfter)}</del>
      </dd>
      <dt className="text-meta font-semibold text-running">Proposed</dt>
      <dd className="m-0">
        <ins className="font-mono font-semibold text-foreground no-underline">{words(place.proposedAfter)}</ins>
      </dd>
    </dl>
  );
}

function CardBody({ t }: { t: TriageProposalDto }) {
  const p = t.proposal;
  switch (kindOf(p)) {
    case "new_story": {
      const description = field(p.payload, "description");
      return (
        <>
          {description && <p className="m-0 line-clamp-4 max-w-[68ch] text-small whitespace-pre-wrap break-words text-muted-foreground">{description}</p>}
          <p className="m-0 text-meta text-subtle-foreground">Created in Shaping, at the end of the Epic's order</p>
        </>
      );
    }
    case "reorder_story":
      return <ReorderDiff t={t} />;
    case "retire_story":
      return <p className="m-0 text-small text-muted-foreground">Drops it before it starts.</p>;
    case "new_epic": {
      const problem = field(p.payload, "problem");
      return (
        <>
          {problem && <p className="m-0 line-clamp-4 max-w-[68ch] text-small whitespace-pre-wrap break-words text-muted-foreground">{problem}</p>}
          <p className="m-0 text-meta text-subtle-foreground">
            {t.milestoneTitle ? `Created in Shaping, in Milestone “${t.milestoneTitle}”` : "Created in Shaping, after the Current Milestone"}
          </p>
        </>
      );
    }
    default:
      return null;
  }
}

/** A duplicate's flag (issue #165): what it repeats, who filed that one, and that accepting it closes this one. */
function DuplicateFlag({ duplicate }: { duplicate: NonNullable<TriageProposalDto["duplicate"]> }) {
  return (
    <p data-duplicate-of={duplicate.proposalId} className="m-0 flex min-w-0 items-start gap-1.5 rounded-md bg-secondary px-3 py-2 text-small text-muted-foreground">
      <Copy aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="font-semibold text-foreground">Duplicate of “{duplicate.title}”</span>
        {duplicate.storyKey && (
          <>
            , filed by <span className="font-mono text-meta">{duplicate.storyKey}</span>
          </>
        )}
        . Accepting that one closes this one.
      </span>
    </p>
  );
}

function TriageCard({ card: t, now, afterDecide }: { card: TriageProposalDto; now: number; afterDecide: () => Promise<void> }) {
  const p = t.proposal;
  const kind = kindOf(p);
  const title = titleOf(t);
  return (
    <li
      data-proposal-card={p.id}
      data-kind={kind ?? undefined}
      data-duplicate={t.duplicate?.proposalId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4 pt-3 pb-3.5 shadow-card"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="h-5.5 text-meta [&_svg]:size-[15px]">
          {kind && KIND_ICON[kind]}
          {kind ? STORY_PROPOSAL_KIND_WORDS[kind] : `${p.verb} ${p.targetType}`}
        </Badge>
        <time dateTime={p.createdAt} title={p.createdAt.replace("T", " ").slice(0, 16)} className="ml-auto shrink-0 text-meta text-subtle-foreground tabular-nums">
          <span className="sr-only">Filed </span>
          {formatAge(p.createdAt, now)}
        </time>
      </div>
      <ProposalDecision proposal={p} subject={subjectOf(t)} amend={amendOf(t)} afterDecide={afterDecide}>
        <p className="m-0 flex min-w-0 items-baseline gap-2 text-row font-semibold">
          {(kind === "reorder_story" || kind === "retire_story") && t.targetKey && (
            <span className="shrink-0 font-mono text-meta font-normal text-muted-foreground">{t.targetKey}</span>
          )}
          <span className="min-w-0 line-clamp-2 break-words">{title}</span>
        </p>
        {t.duplicate && <DuplicateFlag duplicate={t.duplicate} />}
        <CardBody t={t} />
        {p.rationale && <p className="m-0 max-w-[68ch] text-small break-words">Why: {p.rationale}</p>}
        {p.evidence && (
          <p className="m-0 flex min-w-0 items-start gap-1.5 text-small text-muted-foreground">
            <ScanSearch aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-subtle-foreground" />
            <span className="sr-only">Evidence: </span>
            <span className="min-w-0 font-mono text-meta break-words">{p.evidence}</span>
          </p>
        )}
        <p className="m-0 flex min-w-0 items-baseline gap-1.5 text-meta text-subtle-foreground">
          <span className="shrink-0">Filed by</span>
          <span className="shrink-0 font-mono">{t.storyKey}</span>
          <span className="min-w-0 truncate text-muted-foreground" title={t.storyTitle}>
            {t.storyTitle}
          </span>
        </p>
      </ProposalDecision>
    </li>
  );
}
