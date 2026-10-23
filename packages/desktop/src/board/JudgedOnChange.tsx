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
 * The decisions are the shared `ProposalDecision` (the ghost card's and the triage drawer's), with its edit
 * control worded Edit, as spec §5 names it: Accept applies it as proposed, Edit opens the proposed text (and
 * Check command) and accepts the edit in one act, Reject asks for an optional reason. No blue fill and no
 * yellow, since a pending Proposal never holds the agent that filed it.
 */
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, SquareTerminal } from "lucide-react";
import type { NeedsYouItemDto, NeedsYouJudgedOnDto, ProposalDto } from "../adapters/tauri";
import { ProposalDecision, type AmendField } from "../shaping/GhostCard";
import { needsYouQueryKey } from "../fleet/useFleet";

/** The longest criterion statement, Check command and spec field the core accepts (`proposal_apply`). */
const MAX_STATEMENT_LEN = 2_000;
const MAX_COMMAND_LEN = 2_000;
const MAX_SPEC_LEN = 20_000;

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

/** The proposed Check command, when it is not the Check's own: the core keeps the Check otherwise. */
function newCommand(change: NeedsYouJudgedOnDto): string | null {
  return change.checkAfter && change.checkAfter !== change.checkBefore ? change.checkAfter : null;
}

/** What accepting does, in one line (spec §4.4 and §5). */
export function consequenceOf(change: NeedsYouJudgedOnDto): string {
  if (change.change === "amend_epic_spec") return "Accepting reaches every Story of the Epic from its next session";
  if (newCommand(change)) return "Accepting clears its acceptance; the new Check reads not run";
  if (change.checkBefore) return "Accepting clears its acceptance and marks its Check's last run stale";
  return "Accepting clears its acceptance";
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

/** What Edit opens, and the payload Accept edit sends, in the Proposal's own shape. */
function editOf(change: NeedsYouJudgedOnDto, subject: string) {
  if (change.change === "amend_epic_spec") {
    const fields: AmendField[] = [
      { name: "text", label: `Your ${subject}`, value: change.after, multiline: true, maxLength: MAX_SPEC_LEN, required: true },
    ];
    return { fields, payload: (v: Record<string, string>) => ({ field: change.field, text: v.text }) };
  }
  const fields: AmendField[] = [
    { name: "statement", label: "Your criterion", value: change.after, multiline: true, maxLength: MAX_STATEMENT_LEN, required: true },
    { name: "check_command", label: "Its Check command", value: change.checkAfter ?? "", maxLength: MAX_COMMAND_LEN, code: true },
  ];
  return {
    fields,
    payload: (v: Record<string, string>) => {
      const payload: Record<string, unknown> = {
        criterion_id: change.criterionId ?? change.payload.criterion_id,
        statement: v.statement,
      };
      // A blank command keeps the Check as it is (the core marks its last run stale).
      if (v.check_command) payload.check_command = v.check_command;
      return payload;
    },
  };
}

export function JudgedOnChange({ item }: { item: NeedsYouItemDto }) {
  const change = item.judgedOn!;
  const queryClient = useQueryClient();
  const subject = subjectOf(change);
  const proposed = newCommand(change);
  // ProposalDecision reads the Proposal's id and why; the rest of a ProposalDto plays no part here.
  const proposal = { id: change.proposalId, rationale: change.rationale } as ProposalDto;
  return (
    <div data-slot="judged-on" className="flex min-w-0 flex-col gap-2.5">
      <ProposalDecision
        proposal={proposal}
        subject={`the ${judgedOnWord(change)} on ${item.record.key ?? item.record.title}`}
        amend={editOf(change, subject)}
        amendWord="Edit"
        afterDecide={async () => {
          // Decided, the card leaves the list; the list moves the keyboard to the card in its place.
          await queryClient.invalidateQueries({ queryKey: needsYouQueryKey() });
        }}
      >
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted px-2.5 py-2">
          <Diff label={subject} before={change.before} after={change.after} />
          {proposed && (
            <Diff label="Check" icon={<SquareTerminal aria-hidden="true" />} before={change.checkBefore} after={proposed} code />
          )}
        </div>
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
      </ProposalDecision>
    </div>
  );
}
