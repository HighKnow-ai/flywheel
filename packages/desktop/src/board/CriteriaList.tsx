/**
 * A Story's Acceptance criteria with their Checks (docs/mvp-spec.md §4.4, issue #104). Each criterion
 * shows its Check as a chip (its current result, and Stale when the branch has moved since) beside the
 * command, or says it is judged at review, and carries a visible control to add, change or remove that
 * Check. In three M2 runs no Check was ever added, because the only way to write one was the Story form:
 * this is the control on the Story itself.
 *
 * Every control is a core write (`check_set`, `check_remove`); the list re-reads on `board:changed`
 * and never trusts its own edit.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, X } from "lucide-react";
import { checkRemove, checkSet, criterionList, type AcceptanceCriterionDto, type CheckDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function CriteriaList({ projectId, storyId, storyKey }: { projectId: string; storyId: string; storyKey: string }) {
  const criteriaQuery = useCriteria(projectId, storyId);
  const criteria = criteriaQuery.data ?? [];

  return (
    <div className="flex flex-col">
      {criteriaQuery.isError && <p className="m-0 text-small text-destructive-text">{errorText(criteriaQuery.error)}</p>}
      {criteriaQuery.isSuccess && criteria.length === 0 && (
        <p className="m-0 text-body text-muted-foreground">No Acceptance criteria.</p>
      )}
      <ol aria-label={`${storyKey} Acceptance criteria`} className="m-0 list-none p-0">
        {criteria.map((criterion, index) => (
          <CriterionRow key={criterion.id} projectId={projectId} criterion={criterion} number={index + 1} />
        ))}
      </ol>
    </div>
  );
}

function CriterionRow({
  projectId,
  criterion,
  number,
}: {
  projectId: string;
  criterion: AcceptanceCriterionDto;
  number: number;
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || command.trim() === "") return;
    write(checkSet(criterion.id, command.trim()), () => setEditing(false));
  }

  return (
    <li className="group/criterion flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0">
      <span className="text-body font-semibold">{criterion.statement}</span>
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
          <Button type="submit" size="sm" disabled={busy || command.trim() === ""}>
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
              <code className="min-w-0 truncate font-mono text-small text-muted-foreground">{check.command}</code>
            </>
          ) : (
            <StateBadge state="judged_at_review" label="No Check: judged at review" className="h-5.5 text-meta" />
          )}
          <span className="ml-auto flex gap-0.5">
            <Button
              variant="ghost"
              size="xs"
              aria-label={check ? `Change the Check of criterion ${number}` : `Add a Check to criterion ${number}`}
              onClick={() => {
                setCommand(check?.command ?? "");
                setError(null);
                setEditing(true);
              }}
              className={check ? "text-muted-foreground" : "text-running"}
            >
              {check ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {check ? "Change" : "Add Check"}
            </Button>
            {check && (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Remove the Check of criterion ${number}`}
                onClick={() => write(checkRemove(criterion.id))}
                disabled={busy}
                className="text-muted-foreground"
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
