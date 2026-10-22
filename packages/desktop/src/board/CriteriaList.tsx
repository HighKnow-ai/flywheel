/**
 * A Story's Acceptance criteria with their Checks (docs/mvp-spec.md §4.4, issue #104). Each criterion
 * shows its Check (the command and its current result) or says it is judged at review, and carries a
 * visible control to add, change or remove that Check. In three M2 runs no Check was ever added,
 * because the only way to write one was the Story form: this is the control on the Story itself.
 *
 * Every control is a core write (`check_set`, `check_remove`); the list re-reads on `board:changed`
 * and never trusts its own edit.
 */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkRemove, checkSet, criterionList, type AcceptanceCriterionDto, type CheckDto } from "../adapters/tauri";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The read of one Story's criteria, keyed under the project so `board:changed` keeps it live. */
export function criteriaQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "criteria", storyId] as const;
}

/** The words for a Check's current result. */
const RESULT_WORDS: Record<string, string> = {
  not_run: "not run yet",
  passed: "passed",
  failed: "failed",
  timed_out: "timed out",
};

function resultWords(check: CheckDto): string {
  const words = RESULT_WORDS[check.result] ?? check.result;
  return check.stale ? `${words}, on an older commit` : words;
}

export function CriteriaList({ projectId, storyId, storyKey }: { projectId: string; storyId: string; storyKey: string }) {
  const criteriaQuery = useQuery({
    queryKey: criteriaQueryKey(projectId, storyId),
    queryFn: () => criterionList(storyId),
  });
  const criteria = criteriaQuery.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      {criteriaQuery.isError && (
        <p className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
          {errorText(criteriaQuery.error)}
        </p>
      )}
      {criteriaQuery.isSuccess && criteria.length === 0 && (
        <p className="type-body" style={{ margin: 0, color: "var(--muted-foreground)" }}>
          No Acceptance criteria.
        </p>
      )}
      <ol aria-label={`${storyKey} Acceptance criteria`} style={{ margin: 0, paddingLeft: "1.5em" }}>
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
    <li style={{ padding: "var(--space-xs) 0", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span className="type-body">{criterion.statement}</span>
      {editing ? (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "flex-end" }}
        >
          <label className="type-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", flex: 1, minWidth: "14em" }}>
            {`Check command for criterion ${number}`}
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="A command that passes when the criterion holds, e.g. npm test"
              className="control-edge session-field type-body"
            />
          </label>
          <button
            type="submit"
            disabled={busy || command.trim() === ""}
            className="control-edge session-action session-action-lead type-body"
          >
            Save Check
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="control-edge session-action type-body"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
          {check ? (
            <span className="type-label">
              Check: <code>{check.command}</code>
              {` · ${resultWords(check)}`}
            </span>
          ) : (
            <span className="type-label" style={{ color: "var(--muted-foreground)" }}>
              No Check: judged at review
            </span>
          )}
          <button
            type="button"
            aria-label={check ? `Change the Check of criterion ${number}` : `Add a Check to criterion ${number}`}
            onClick={() => {
              setCommand(check?.command ?? "");
              setError(null);
              setEditing(true);
            }}
            className="control-edge session-action type-body"
          >
            {check ? "Change Check" : "Add Check"}
          </button>
          {check && (
            <button
              type="button"
              aria-label={`Remove the Check of criterion ${number}`}
              onClick={() => write(checkRemove(criterion.id))}
              disabled={busy}
              className="control-edge session-action type-body"
            >
              Remove Check
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
          {error}
        </p>
      )}
    </li>
  );
}
