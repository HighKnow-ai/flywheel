/**
 * A Story's Acceptance criteria with their Checks (docs/mvp-spec.md §4.4, issue #104). Each criterion
 * shows its Check as a chip (its current result, and Stale when the branch has moved since) beside the
 * command, or says it is judged at review, and carries a visible control to add, change or remove that
 * Check. In three M2 runs no Check was ever added, because the only way to write one was the Story form:
 * this is the control on the Story itself.
 *
 * Every control is a core write (`check_set`, `check_remove`); the list re-reads on `board:changed`
 * and never trusts its own edit.
 *
 * Controls on demand (issue #204): Change and Remove show on the row's hover and while focus is inside it, so a
 * long list reads as statements and Checks; Add Check stays visible, as it is the call to write one. Remove is
 * reversible, so it does not confirm: its toast offers Undo, which sets the same command back. A failed read
 * says so (ReadError); the empty state shows only once the read succeeded with nothing in it.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, SquareTerminal, X } from "lucide-react";
import { checkRemove, checkSet, criterionList, type AcceptanceCriterionDto, type CheckDto } from "../adapters/tauri";
import { ReadError } from "../components/ReadError";
import { StateBadge } from "../components/StateBadge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The read of one Story's criteria, keyed under the project so `board:changed` keeps it live. */
export function criteriaQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "criteria", storyId] as const;
}

export function useCriteria(projectId: string, storyId: string) {
  return useQuery({
    queryKey: criteriaQueryKey(projectId, storyId),
    queryFn: () => criterionList(storyId),
  });
}

/** Whether a criterion's Check passed on the current commit. */
export function checkPasses(criterion: AcceptanceCriterionDto): boolean {
  return criterion.check?.result === "passed" && !criterion.check.stale;
}

/** A Check's result as a chip, then Stale when its result belongs to an older commit. */
export function CheckChip({ check }: { check: CheckDto }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateBadge state={check.result} className="h-5.5 text-meta" />
      {check.stale && (
        <StateBadge state="stale" label="Stale" className="h-5.5 text-meta" />
      )}
    </span>
  );
}

export interface CriteriaListProps {
  projectId: string;
  storyId: string;
  storyKey: string;
  /**
   * The narrow variant a shaping Story column stacks (issue #127's 17.5rem columns, issue #128): the statement at
   * small size, the Check's chip and its controls on one line, the command on its own line under them.
   */
  compact?: boolean;
  /** What an empty list says; `null` says nothing (a pending criterion is already drawn under it). */
  emptyText?: string | null;
}

export function CriteriaList({ projectId, storyId, storyKey, compact = false, emptyText = "No Acceptance criteria yet" }: CriteriaListProps) {
  const criteriaQuery = useCriteria(projectId, storyId);
  const criteria = criteriaQuery.data ?? [];

  return (
    <div className="flex flex-col">
      {criteriaQuery.isError && <ReadError title="Couldn't load the Acceptance criteria" query={criteriaQuery} />}
      {criteriaQuery.isPending && !compact && (
        <div role="status" aria-label="Loading the Acceptance criteria" className="flex flex-col gap-2.5 py-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {criteriaQuery.isSuccess && criteria.length === 0 && emptyText && compact && (
        <p className="m-0 text-small text-muted-foreground">{emptyText}</p>
      )}
      {criteriaQuery.isSuccess && criteria.length === 0 && emptyText && !compact && (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyTitle className="text-body font-semibold">{emptyText}</EmptyTitle>
            <EmptyDescription className="text-small">
              Criteria are written while the Epic is shaped; each can carry a Check that proves it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ol aria-label={`${storyKey} Acceptance criteria`} className="m-0 list-none p-0 empty:hidden">
        {criteria.map((criterion, index) => (
          <CriterionRow key={criterion.id} projectId={projectId} criterion={criterion} number={index + 1} compact={compact} />
        ))}
      </ol>
    </div>
  );
}

/** A row control shown on demand: on the row's hover, while focus is in the row, and always without hover. */
const ON_DEMAND =
  "opacity-0 transition-opacity group-hover/criterion:opacity-100 group-focus-within/criterion:opacity-100 focus-visible:opacity-100 data-[loading=true]:opacity-100 [@media(hover:none)]:opacity-100";

function CriterionRow({
  projectId,
  criterion,
  number,
  compact,
}: {
  projectId: string;
  criterion: AcceptanceCriterionDto;
  number: number;
  compact: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = criterion.check;

  function write(promise: Promise<void>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    promise
      .then(() => {
        onDone?.();
        void queryClient.invalidateQueries({ queryKey: criteriaQueryKey(projectId, criterion.storyId) });
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  function remove(removed: CheckDto) {
    write(checkRemove(criterion.id), () =>
      notify.success(`Removed the Check of criterion ${number}`, {
        description: removed.command,
        undo: () => write(checkSet(criterion.id, removed.command, removed.timeoutSecs)),
      }),
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || command.trim() === "") return;
    write(checkSet(criterion.id, command.trim()), () => setEditing(false));
  }

  return (
    <li
      className={cn(
        "group/criterion flex min-w-0 flex-col border-t border-border first:border-t-0 first:pt-0",
        compact ? "gap-1.5 py-2" : "gap-2 py-3",
      )}
    >
      <span className={cn("font-semibold break-words", compact ? "text-small" : "text-body")}>{criterion.statement}</span>
      {editing ? (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-small text-muted-foreground">
            {`Check command for criterion ${number}`}
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="A command that passes when the criterion holds, e.g. npm test"
              className="font-mono text-small"
              autoFocus
            />
          </label>
          <Button type="submit" size="sm" loading={busy} disabled={command.trim() === ""}>
            <SquareTerminal aria-hidden="true" />
            Save Check
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {check ? (
            <>
              <CheckChip check={check} />
              {compact ? (
                // In a narrow column the command takes its own line first, as a proposed criterion's does, and the
                // chip is followed by the controls that act on it.
                <span className="order-first flex min-w-0 basis-full items-center gap-1.5 text-meta text-muted-foreground">
                  <SquareTerminal aria-hidden="true" className="size-3.5 shrink-0" />
                  <code title={check.command} className="min-w-0 truncate font-mono text-foreground">
                    {check.command}
                  </code>
                </span>
              ) : (
                <code title={check.command} className="min-w-0 truncate font-mono text-small text-muted-foreground">
                  {check.command}
                </code>
              )}
            </>
          ) : (
            <StateBadge
              state="judged_at_review"
              label={compact ? "Judged at review" : "No Check: judged at review"}
              className="h-5.5 text-meta"
            />
          )}
          {/* Change and Remove show on demand (hover, focus-within, or no hover at all); Add Check always. */}
          <span className={cn("flex gap-0.5", !compact && "ml-auto")}>
            <Button
              variant="ghost"
              size="xs"
              aria-label={check ? `Change the Check of criterion ${number}` : `Add a Check to criterion ${number}`}
              onClick={() => {
                setCommand(check?.command ?? "");
                setError(null);
                setEditing(true);
              }}
              className={check ? cn("text-muted-foreground", ON_DEMAND) : "text-running"}
            >
              {check ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {check ? "Change" : "Add Check"}
            </Button>
            {check && (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Remove the Check of criterion ${number}`}
                onClick={() => remove(check)}
                loading={busy}
                className={cn("text-muted-foreground", ON_DEMAND)}
              >
                <X aria-hidden="true" />
                Remove
              </Button>
            )}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-small text-destructive-text">
          {error}
        </p>
      )}
    </li>
  );
}
