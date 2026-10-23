/**
 * A judged-on change in Needs you (docs/mvp-spec.md §5 "Judged-on changes skip the wait", issue #163): a
 * Proposal from execution that changes what a Story is judged on, an Amend criterion or an Amend Epic spec.
 * It never waits in the Proposals row: it is its own card, ranked with Review, decided where it is drawn.
 *
 * The card shows the change as a before and after, on an inset panel: the text the board holds now, struck
 * through in secondary ink, then the proposed text in ink on the dashed running tint, the shape of something
 * not yet on the record (`GhostCard`'s ghost). An Amend criterion that proposes a new Check command shows the
 * Check's before and after too, in the code face. One line says what accepting does, then the agent's why,
 * its evidence and the Story whose session filed it.
 *
 * - Accept applies it as proposed (`proposal_accept`, one transaction with the decision).
 * - Edit opens the proposed text (and Check command) to edit; accepting the edit is one act (`proposal_amend`).
 * - Reject asks for an optional reason (`proposal_reject`).
 *
 * Accept is an outline and Edit and Reject are ghosts, as on the ghost card: no blue fill and no yellow, since
 * a pending Proposal never holds the agent that filed it.
 */
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Minus, PenLine, Plus, SquareTerminal, X } from "lucide-react";
import { proposalAccept, proposalAmend, proposalReject, type NeedsYouItemDto, type NeedsYouJudgedOnDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { needsYouQueryKey } from "../fleet/useFleet";
import { errorText } from "./StoryControls";

/** The longest criterion statement, Check command and spec field the core accepts (`proposal_apply`). */
const MAX_STATEMENT_LEN = 2_000;
const MAX_COMMAND_LEN = 2_000;
const MAX_SPEC_LEN = 20_000;
/** The longest rejection reason `proposal_reject` accepts. */
const MAX_REASON_LEN = 500;

const SPEC_FIELD_LABELS: Record<string, string> = {
  problem: "Problem",
  scope: "Scope",
  out_of_scope: "Out of scope",
  exit_test: "Exit test",
};

/** The kind as the card names it (spec §5's card kinds). */
export function judgedOnWord(change: NeedsYouJudgedOnDto): string {
  return change.change === "amend_criterion" ? "Amend criterion" : "Amend Epic spec";
}

/** What the change rewrites, as the diff's label names it: "Criterion", or the Epic spec field. */
function subjectOf(change: NeedsYouJudgedOnDto): string {
  if (change.change === "amend_criterion") return "Criterion";
  return SPEC_FIELD_LABELS[change.field ?? ""] ?? change.field ?? "Epic spec";
}

/** What accepting does, in one line (spec §4.4 and §5). */
export function consequenceOf(change: NeedsYouJudgedOnDto): string {
  if (change.change === "amend_epic_spec") return "Accepting reaches every Story of the Epic from its next session";
  if (newCommand(change)) return "Accepting clears its acceptance; the new Check reads not run";
  if (change.checkBefore) return "Accepting clears its acceptance and marks its Check's last run stale";
  return "Accepting clears its acceptance";
}

/** The proposed Check command, when it is not the Check's own: the core keeps the Check otherwise. */
function newCommand(change: NeedsYouJudgedOnDto): string | null {
  return change.checkAfter && change.checkAfter !== change.checkBefore ? change.checkAfter : null;
}

/** One before-and-after pair. `code` draws both in the code face. */
function Diff({ label, icon, before, after, code }: { label: string; icon?: ReactNode; before: string | null; after: string; code?: boolean }) {
  const face = code ? "font-mono text-small" : "text-body";
  return (
    <div role="group" aria-label={`${label}, before and after`} className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-meta font-semibold text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <div className="flex min-w-0 items-start gap-2 px-2 py-1">
        <Minus aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-subtle-foreground" />
        <span className="sr-only">Before: </span>
        {before ? (
          <del className={`min-w-0 break-words whitespace-pre-wrap text-muted-foreground decoration-1 ${face}`}>{before}</del>
        ) : (
          <span className="text-small text-subtle-foreground">Empty</span>
        )}
      </div>
      <div className="flex min-w-0 items-start gap-2 rounded-md border border-dashed border-primary bg-running-muted px-2 py-1">
        <Plus aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-running" />
        <span className="sr-only">After: </span>
        <ins className={`min-w-0 break-words whitespace-pre-wrap text-foreground no-underline ${face}`}>{after}</ins>
      </div>
    </div>
  );
}

type Mode = "idle" | "editing" | "rejecting";

export function JudgedOnChange({ item }: { item: NeedsYouItemDto }) {
  const change = item.judgedOn!;
  const queryClient = useQueryClient();
  const statementId = useId();
  const commandId = useId();
  const reasonId = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState("");
  const [command, setCommand] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const criterion = change.change === "amend_criterion";
  const word = judgedOnWord(change);
  const subject = subjectOf(change);
  const on = item.record.key ?? item.record.title;
  const proposed = newCommand(change);

  async function decide(write: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await write();
      // Decided, the card leaves the list; the list moves the keyboard to the card in its place.
      await queryClient.invalidateQueries({ queryKey: needsYouQueryKey() });
    } catch (err) {
      setError(`Could not decide the ${word}: ${errorText(err)}`);
      setBusy(false);
    }
  }

  function submitEdit(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const payload: Record<string, unknown> = criterion
      ? { criterion_id: change.criterionId ?? change.payload.criterion_id, statement: text }
      : { field: change.field, text };
    const cmd = command.trim();
    if (criterion && cmd) payload.check_command = cmd;
    void decide(() => proposalAmend(change.proposalId, payload));
  }

  function submitReject(event: FormEvent) {
    event.preventDefault();
    const given = why.trim();
    void decide(() => proposalReject(change.proposalId, given === "" ? null : given));
  }

  function cancel() {
    const opener = mode === "editing" ? editRef : rejectRef;
    setMode("idle");
    setError(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  const escape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };

  return (
    <div data-slot="judged-on" className="flex min-w-0 flex-col gap-2.5">
      {mode !== "editing" && (
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted px-2.5 py-2">
          <Diff label={subject} before={change.before} after={change.after} />
          {criterion && proposed && (
            <Diff label="Check" icon={<SquareTerminal aria-hidden="true" />} before={change.checkBefore} after={proposed} code />
          )}
        </div>
      )}

      <p className="m-0 text-small text-foreground">{consequenceOf(change)}</p>
      {change.rationale && (
        <p className="m-0 text-small break-words text-muted-foreground">
          Why: <span>{change.rationale}</span>
        </p>
      )}
      {change.evidence && (
        <p className="m-0 text-small break-words text-muted-foreground">
          Evidence: <span className="font-mono">{change.evidence}</span>
        </p>
      )}
      {change.filedBy && <p className="m-0 text-meta text-subtle-foreground">{`Filed by ${change.filedBy}'s session`}</p>}

      {mode === "editing" && (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={submitEdit}>
          <label htmlFor={statementId} className="text-meta font-semibold text-muted-foreground">
            {criterion ? "Your criterion" : `Your ${subject}`}
          </label>
          <Textarea
            id={statementId}
            value={draft}
            maxLength={criterion ? MAX_STATEMENT_LEN : MAX_SPEC_LEN}
            autoFocus
            disabled={busy}
            className="min-h-20"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              escape(e);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitEdit(e);
            }}
          />
          {criterion && (
            <>
              <label htmlFor={commandId} className="text-meta font-semibold text-muted-foreground">
                Its Check command
              </label>
              <Input
                id={commandId}
                value={command}
                maxLength={MAX_COMMAND_LEN}
                disabled={busy}
                placeholder={change.checkBefore ? "Keep the Check as it is" : "None: judged at review"}
                className="h-7.5 font-mono text-small"
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={escape}
              />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={busy || !draft.trim()}>
              <Check aria-hidden="true" />
              {busy ? "Saving…" : "Accept edit"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              <X aria-hidden="true" />
              Cancel
            </Button>
            <Kbd className="ml-auto">⌘↩</Kbd>
          </div>
        </form>
      )}

      {mode === "rejecting" && (
        <form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={submitReject}>
          <label htmlFor={reasonId} className="sr-only">
            Why not? (optional)
          </label>
          <Input
            id={reasonId}
            value={why}
            maxLength={MAX_REASON_LEN}
            autoFocus
            disabled={busy}
            placeholder="Why not? (optional)"
            className="h-7.5 min-w-40 flex-1"
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={escape}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            <Ban aria-hidden="true" />
            {busy ? "Saving…" : "Reject"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        </form>
      )}

      {mode === "idle" && (
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Accept the ${word} on ${on}`}
            onClick={() => void decide(() => proposalAccept(change.proposalId))}
          >
            <Check aria-hidden="true" />
            {busy ? "Saving…" : "Accept"}
          </Button>
          <Button
            ref={editRef}
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Edit the ${word} on ${on}`}
            onClick={() => {
              setDraft(change.after);
              setCommand(change.checkAfter ?? "");
              setError(null);
              setMode("editing");
            }}
          >
            <PenLine aria-hidden="true" />
            Edit
          </Button>
          <Button
            ref={rejectRef}
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Reject the ${word} on ${on}`}
            onClick={() => {
              setWhy("");
              setError(null);
              setMode("rejecting");
            }}
          >
            <Ban aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 text-small break-words text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
