/**
 * The worktree inventory (Phase 10 plan 10-08, WORK-07, D-177/D-178): every Story worktree across every
 * registered project with how much disk it uses, how old that figure is, and a chip plus a named reason
 * for what can be done with it. Pushed into the shell and popped back out of like the fleet surface;
 * `App.tsx` mounts it.
 *
 * Plan 10-09 (WORK-07, D-179) adds the reclaim: a checkbox on RECLAIMABLE rows only (an in-use or keep
 * row renders none, not a disabled one), a bar naming the count and the total bytes of the selection,
 * one confirmation, and a per-row result list. D-179 rejected a reclaim-everything action, because there
 * would be no way to keep one. #208 adds a select-all Checkbox in the table header, which is not that
 * action: it only selects, every row can still be cleared before the one confirmation, and it selects
 * reclaimable rows only. The selection is ADVISORY. The core re-derives every row's eligibility when it acts, so a row an agent
 * started in since the list was read comes back refused and the view shows exactly that; the list is
 * refetched afterwards rather than edited locally, so what stays on screen is the server's current truth.
 *
 * The Rust core derives the disposition and its reason (`reclaim_eligibility`) and orders the list
 * (size descending, Story key ascending); this file only renders them. A size is the core's cached
 * measurement and is always shown with its age (D-116's grammar: a figure is labelled with how old it is,
 * never pretended live). A worktree that was never measured renders BLANK, never `0 B`: absence is not
 * zero. Sizes are binary (KiB, MiB, GiB) with one decimal above a kibibyte, since they are allocated
 * blocks and `du` reports them the same way.
 *
 * The inventory lists Story worktrees only: every `worktrees` row is owned by exactly one Story.
 *
 * #208 draws it as the fleet's table card: a Table with a sticky header (Story · Size · Status), the rows
 * grouped under their project's name in the core's order, a select-all Checkbox, and a bar at the card's
 * foot that stays in view while the rows scroll ("Reclaim 13 worktrees · 21.4 GiB"), confirmed in
 * ConfirmDestructive.
 */
import { useState } from "react";
import { TruncateTip } from "@/components/TruncateTip";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Check, Lock, Recycle, RefreshCw, Trash2, X } from "lucide-react";
import {
  worktreeMeasure,
  worktreeReclaim,
  type InventoryReason,
  type ReclaimOutcomeDto,
  type WorktreeInventoryRowDto,
} from "../adapters/tauri";
import { ConfirmDestructive } from "../components/ConfirmDestructive";
import { ReadError } from "../components/ReadError";
import { StoryKey } from "../components/StoryKey";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { STICKY_HEADER, TABLE_CARD, useWidth } from "./FleetSurface";
import { useWorktreeInventory, worktreeInventoryQueryKey } from "./useFleet";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@highknow/design";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { formatRelativeTime } from "@/lib/format";
import { notify } from "@/lib/notify";

/** Every reason the core's `ReclaimReason` can return, so a test can prove each one has a word. */
export const RECLAIM_REASONS: readonly InventoryReason[] = [
  "merged",
  "dropped",
  "sessionning",
  "blocked",
  "uncommitted_changes",
  "project_unreachable",
  "directory_missing",
  "story_open",
];

/** The word printed beside the chip for each reason. */
export const RECLAIM_REASON_WORDS: Record<InventoryReason, string> = {
  merged: "Story merged",
  dropped: "Story dropped",
  sessionning: "agent running",
  blocked: "agent blocked on you",
  uncommitted_changes: "uncommitted changes",
  project_unreachable: "project unreachable",
  directory_missing: "directory missing",
  story_open: "Story still open",
};

/** Each disposition's icon and word (never colour alone): reclaimable, in use, keep. */
export const DISPOSITION_CHIPS = {
  reclaimable: { icon: Recycle, label: "Reclaimable" },
  in_use: { icon: Activity, label: "In use" },
  keep: { icon: Lock, label: "Keep" },
} as const;

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** A byte count as `512 B`, `4.0 KiB`, `1.4 GiB`. Only ever called with a measured size. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** The age of a measurement in the app's one relative-time vocabulary: `measured 3m ago`. */
export function formatMeasuredAge(measuredAtIso: string, nowMs: number): string {
  return `measured ${formatRelativeTime(measuredAtIso, nowMs)}`;
}

/** The most worktrees one reclaim call may carry. The core refuses a longer list as a whole. */
export const RECLAIM_BATCH_CAP = 50;

/** One line of the result list: a snapshot of what the row was called when it was submitted, since a
 * removed row is gone from the refetched list. */
interface ResultLine {
  label: string;
  outcome: ReclaimOutcomeDto;
}

/** The sum of the measured sizes, and how many have no measurement. An unmeasured size is absent, never
 * zero, so the total says how many it leaves out. */
function sizeTotal(sizes: (number | null)[]): { bytes: number; unmeasured: number } {
  let bytes = 0;
  let unmeasured = 0;
  for (const size of sizes) {
    if (size == null) unmeasured += 1;
    else bytes += size;
  }
  return { bytes, unmeasured };
}

function totalWords({ bytes, unmeasured }: { bytes: number; unmeasured: number }, count: number): string {
  if (unmeasured === count) return "size not measured";
  return unmeasured === 0 ? formatBytes(bytes) : `${formatBytes(bytes)} measured, ${unmeasured} not measured`;
}

function worktreesWord(count: number): string {
  return `${count} ${count === 1 ? "worktree" : "worktrees"}`;
}

function outcomeWords(o: ReclaimOutcomeDto): string {
  if (o.removed) return "removed";
  if (o.reason != null) return `refused: ${RECLAIM_REASON_WORDS[o.reason]}`;
  return `refused: ${o.error ?? "not removed"}`;
}

/** The bar at the card's foot while anything is selected: what the reclaim would take, Clear, and the one
 * action, confirmed in ConfirmDestructive. It sits outside the table's scroller, so it stays in view. */
function ReclaimBar({
  rows,
  onClear,
  onReclaim,
}: {
  rows: WorktreeInventoryRowDto[];
  onClear: () => void;
  onReclaim: () => Promise<void>;
}) {
  const over = rows.length > RECLAIM_BATCH_CAP;
  const total = totalWords(sizeTotal(rows.map((r) => r.sizeBytes)), rows.length);
  return (
    <div
      data-reclaim-bar
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-muted px-4 py-2.5"
    >
      <span data-field="selection" className="text-small font-semibold tabular-nums">
        {`Reclaim ${worktreesWord(rows.length)} · ${total}`}
      </span>
      {over && (
        <span role="status" className="text-meta text-muted-foreground">
          {`At most ${RECLAIM_BATCH_CAP} at a time.`}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <ConfirmDestructive
          trigger={
            <Button variant="destructive" size="sm" disabled={over}>
              <Trash2 aria-hidden="true" />
              Reclaim
            </Button>
          }
          title={`Reclaim ${worktreesWord(rows.length)}?`}
          description={`${total}. Their directories are removed from disk; branches and commits are kept. A worktree with uncommitted changes, or one an agent has started in since the list was read, is refused and left alone.`}
          confirmLabel={`Reclaim ${worktreesWord(rows.length)}`}
          icon={<Trash2 aria-hidden="true" />}
          onConfirm={onReclaim}
        />
      </span>
    </div>
  );
}

/** What a reclaim that left something behind did, row by row. A reclaim that removed everything says so in
 * a toast instead: the rows leaving the table already show it. */
function ReclaimResultList({ lines, onClose }: { lines: ResultLine[]; onClose: () => void }) {
  const removed = lines.filter((l) => l.outcome.removed).length;
  return (
    <Alert data-reclaim-result role="status" className="mx-auto max-w-[1240px] shrink-0 pr-12">
      <AlertTitle className="text-body font-semibold tabular-nums">{`Result · ${removed} of ${lines.length} removed`}</AlertTitle>
      <AlertDescription>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {lines.map(({ label, outcome }) => (
            <li
              key={outcome.storyId}
              data-reclaim-outcome={outcome.removed ? "removed" : "refused"}
              data-story-id={outcome.storyId}
              className="flex items-center gap-1.5 text-small"
            >
              {outcome.removed ? (
                <Check aria-hidden="true" size={15} className="shrink-0 text-muted-foreground" />
              ) : (
                <X aria-hidden="true" size={15} className="shrink-0 text-destructive-text" />
              )}
              <span>{label}</span>{" "}
              <span className={outcome.removed ? "text-muted-foreground" : undefined}>{outcomeWords(outcome)}</span>
            </li>
          ))}
        </ul>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close the result"
        onClick={onClose}
        className="absolute top-1.5 right-1.5"
      >
        <X aria-hidden="true" />
      </Button>
    </Alert>
  );
}

function Chip({ row }: { row: WorktreeInventoryRowDto }) {
  const chip = DISPOSITION_CHIPS[row.disposition];
  const ChipIcon = chip.icon;
  return (
    <span
      data-field="disposition"
      data-disposition={row.disposition}
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
    >
      <Badge variant={row.disposition === "reclaimable" ? "outline" : "secondary"}>
        <ChipIcon aria-hidden="true" />
        {chip.label}
      </Badge>
      <span data-field="reason" className="text-small whitespace-nowrap text-muted-foreground">
        {RECLAIM_REASON_WORDS[row.reason]}
      </span>
    </span>
  );
}

function Row({
  row,
  now,
  selected,
  onToggle,
}: {
  row: WorktreeInventoryRowDto;
  now: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const reclaimable = row.disposition === "reclaimable";
  return (
    <TableRow
      data-worktree-row={row.storyId}
      data-state={selected ? "selected" : undefined}
      onClick={reclaimable ? onToggle : undefined}
      className={cn("h-13 border-border", reclaimable && "cursor-pointer", "data-[state=selected]:bg-running-muted")}
    >
      <TableCell className="pl-4">
        {/* Only a reclaimable row can be selected. An in-use or keep row renders no checkbox at all: an
            affordance that looks live and is not is worse than its absence. */}
        {reclaimable && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${row.projectName} ${row.storyKey} for reclaim`}
          />
        )}
      </TableCell>
      <TruncateTip text={`${row.storyKey} ${row.storyTitle}`}>
        <TableCell data-field="story" className="truncate">
          <StoryKey value={row.storyKey} />
          {row.storyTitle ? " " : ""}
          {row.storyTitle && <span className="text-body font-semibold">{row.storyTitle}</span>}
        </TableCell>
      </TruncateTip>
      <TableCell data-field="size" className="text-right tabular-nums">
        {row.sizeBytes == null ? "" : <span className="block text-small">{formatBytes(row.sizeBytes)}</span>}
        {row.sizeBytes != null && row.sizeMeasuredAt != null && (
          <span data-field="measured" className="block text-meta text-muted-foreground">
            {formatMeasuredAge(row.sizeMeasuredAt, now)}
          </span>
        )}
      </TableCell>
      <TableCell className="pr-4 whitespace-normal">
        <Chip row={row} />
      </TableCell>
    </TableRow>
  );
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  rows: WorktreeInventoryRowDto[];
}

/** The rows grouped under their project, the groups in the order the core's list first names them (largest
 * worktree first), the rows in the core's order inside each. */
function byProject(rows: WorktreeInventoryRowDto[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const row of rows) {
    const group = groups.get(row.projectId);
    if (group) group.rows.push(row);
    else groups.set(row.projectId, { projectId: row.projectId, projectName: row.projectName, rows: [row] });
  }
  return [...groups.values()];
}

export function WorktreeInventory({ onClose }: { onClose: () => void }) {
  const inventory = useWorktreeInventory();
  const queryClient = useQueryClient();
  const [measuring, setMeasuring] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<ResultLine[] | null>(null);
  const rows = inventory.data ?? [];
  const now = Date.now();
  const reclaimable = rows.filter((r) => r.disposition === "reclaimable");
  // The selection can only ever name rows that are reclaimable in the CURRENT list, so a row that
  // came back in use after a refusal drops out of it instead of sitting selected and unselectable.
  const selectedRows = reclaimable.filter((r) => selected.has(r.storyId));
  const allSelected = reclaimable.length > 0 && selectedRows.length === reclaimable.length;
  // A narrow card gives the Status column less room; its reason then wraps under the chip.
  const [cardRef, cardWidth] = useWidth<HTMLDivElement>();
  const wide = cardWidth === null || cardWidth >= 672;

  const toggle = (storyId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });

  // Throws when the call fails outright, so the confirmation stays open with the failure and nothing is
  // reported as removed.
  const reclaim = async () => {
    const submitted = selectedRows.map((r) => ({
      id: r.storyId,
      label: `${r.projectName} ${r.storyKey}`,
      bytes: r.sizeBytes,
    }));
    try {
      const outcomes = await worktreeReclaim(submitted.map((r) => r.id));
      const labels = new Map(submitted.map((r) => [r.id, r.label]));
      // Removed rows leave the selection; refused rows stay in it so a retry costs no re-selection.
      const gone = new Set(outcomes.filter((o) => o.removed).map((o) => o.storyId));
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      if (outcomes.length > 0 && gone.size === outcomes.length) {
        setResults(null);
        const freed = submitted.filter((r) => gone.has(r.id)).map((r) => r.bytes);
        notify.success(`Reclaimed ${worktreesWord(gone.size)}`, {
          description: `${totalWords(sizeTotal(freed), freed.length)} freed. Branches and commits are kept.`,
        });
      } else {
        setResults(outcomes.map((outcome) => ({ label: labels.get(outcome.storyId) ?? outcome.storyId, outcome })));
      }
    } finally {
      // Refetch rather than edit the list: a refused row reappears with its real disposition.
      void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
    }
  };

  const remeasure = async () => {
    setMeasuring(true);
    try {
      const measured = await worktreeMeasure();
      const incomplete = measured.filter((r) => r.bounded || r.error !== null).length;
      if (incomplete > 0) {
        notify.error(`${worktreesWord(incomplete)} could not be measured completely`, {
          description: `${incomplete === 1 ? "It keeps" : "They keep"} no size.`,
        });
      } else {
        notify.success(`Measured ${worktreesWord(measured.length)}`);
      }
      await queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
    } catch (error) {
      notify.error("Couldn't measure the worktrees", { error });
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <PageHeader
        onBack={onClose}
        crumbs={[{ label: "Worktrees" }]}
        actions={
          <>
            <span
              aria-live="polite"
              className="shrink-0 text-small whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {worktreesWord(rows.length)}
            </span>
            <Button variant="outline" loading={measuring} onClick={() => void remeasure()}>
              <RefreshCw aria-hidden="true" />
              Re-measure sizes
            </Button>
          </>
        }
      />
      <SurfaceBody className="flex flex-col gap-3 overflow-hidden">
        {results !== null && results.length > 0 && (
          <ReclaimResultList lines={results} onClose={() => setResults(null)} />
        )}
        {inventory.isError ? (
          <ReadError title="Couldn't load the worktrees" query={inventory} className="mx-auto max-w-[1240px]" />
        ) : inventory.isSuccess && rows.length === 0 ? (
          <Empty className="mx-auto max-w-[1240px] flex-none rounded-lg border border-solid border-border bg-card shadow-card">
            <EmptyHeader>
              <EmptyTitle className="text-section font-semibold">No worktrees</EmptyTitle>
              <EmptyDescription>A Story gets a worktree when work starts on it, and it appears here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          rows.length > 0 && (
            <div ref={cardRef} data-worktree-table className={TABLE_CARD}>
              <Table className="table-fixed">
                <TableHeader className={STICKY_HEADER}>
                  <TableRow>
                    <TableHead className="w-11 pl-4">
                      {reclaimable.length > 0 && (
                        <Checkbox
                          checked={allSelected ? true : selectedRows.length > 0 ? "indeterminate" : false}
                          // A partial selection reads as a dash, not the tick the shared indicator draws.
                          className="data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:rounded-full data-[state=indeterminate]:before:bg-primary-foreground data-[state=indeterminate]:[&_svg]:hidden"
                          onCheckedChange={() =>
                            setSelected(allSelected ? new Set() : new Set(reclaimable.map((r) => r.storyId)))
                          }
                          aria-label={`Select every worktree that can be reclaimed (${reclaimable.length})`}
                        />
                      )}
                    </TableHead>
                    <TableHead>Story</TableHead>
                    <TableHead className="w-36 text-right">Size</TableHead>
                    <TableHead className={cn("pr-4", wide ? "w-72" : "w-44")}>Status</TableHead>
                  </TableRow>
                </TableHeader>
                {byProject(rows).map((group) => (
                  <TableBody
                    key={group.projectId}
                    data-project={group.projectId}
                    aria-label={group.projectName}
                    className="[&_tr:last-child]:border-b"
                  >
                    <TableRow className="border-border bg-muted hover:bg-muted">
                      <TableHead scope="rowgroup" colSpan={4} className="h-9 px-4">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <TruncateTip text={group.projectName}>
                            <span data-field="project" className="truncate text-small font-semibold">
                              {group.projectName}
                            </span>
                          </TruncateTip>
                          <span className="shrink-0 text-meta font-normal text-muted-foreground tabular-nums">
                            {worktreesWord(group.rows.length)}
                          </span>
                        </span>
                      </TableHead>
                    </TableRow>
                    {group.rows.map((row) => (
                      <Row
                        key={row.storyId}
                        row={row}
                        now={now}
                        selected={selected.has(row.storyId)}
                        onToggle={() => toggle(row.storyId)}
                      />
                    ))}
                  </TableBody>
                ))}
              </Table>
              {selectedRows.length > 0 && (
                <ReclaimBar rows={selectedRows} onClear={() => setSelected(new Set())} onReclaim={reclaim} />
              )}
            </div>
          )
        )}
      </SurfaceBody>
    </div>
  );
}
