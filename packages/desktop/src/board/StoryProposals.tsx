/**
 * Proposals filed by this Story (issue #160): what the Story's sessions proposed with `propose`, each
 * with its kind, what it names, the agent's why and its evidence, and Accept / Reject while it waits.
 * Interim: the triage drawer beside the roster (#162) takes these over, grouped by the record each lands
 * on. A withdrawn Proposal is the agent's own retraction and is not listed.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { proposalAccept, proposalListForStory, proposalReject, type ProposalDto } from "../adapters/tauri";
import { STORY_PROPOSAL_KIND_WORDS } from "../session/toolVerbs";
import { Button } from "@/components/ui/button";
import { errorText, formatWhen } from "./StoryControls";

export function storyProposalsQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "story-proposals", storyId] as const;
}

const SPEC_FIELD_LABELS: Record<string, string> = {
  problem: "Problem",
  scope: "Scope",
  out_of_scope: "Out of scope",
  exit_test: "Exit test",
};

function field(payload: unknown, key: string): string {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : "";
}

/** The kind a Proposal's verb and target make, as the card names it, and the line it names. */
export function describeStoryProposal(p: ProposalDto): { kind: string; names: string } {
  const key = `${p.verb} ${p.targetType}`;
  switch (key) {
    case "create story":
      return { kind: STORY_PROPOSAL_KIND_WORDS.new_story, names: field(p.payload, "title") };
    case "amend criterion":
      return { kind: STORY_PROPOSAL_KIND_WORDS.amend_criterion, names: field(p.payload, "statement") };
    case "amend epic": {
      const label = SPEC_FIELD_LABELS[field(p.payload, "field")] ?? field(p.payload, "field");
      return { kind: STORY_PROPOSAL_KIND_WORDS.amend_epic_spec, names: [label, field(p.payload, "text")].filter(Boolean).join(": ") };
    }
    case "reorder story":
      return { kind: STORY_PROPOSAL_KIND_WORDS.reorder_story, names: "" };
    case "retire story":
      return { kind: STORY_PROPOSAL_KIND_WORDS.retire_story, names: "" };
    case "create epic":
      return { kind: STORY_PROPOSAL_KIND_WORDS.new_epic, names: field(p.payload, "title") };
    default:
      return { kind: `${p.verb} ${p.targetType}`, names: "" };
  }
}

function stateWords(p: ProposalDto): string {
  if (p.state === "accepted") return "Accepted";
  if (p.state === "rejected") return p.rejectionReason ? `Rejected: ${p.rejectionReason}` : "Rejected";
  return "Waiting on you";
}

export function StoryProposals({ projectId, storyId }: { projectId: string; storyId: string }) {
  const query = useQuery({
    queryKey: storyProposalsQueryKey(projectId, storyId),
    queryFn: () => proposalListForStory(storyId),
  });
  const proposals = (query.data ?? []).filter((p) => p.state !== "withdrawn");
  if (proposals.length === 0) return null;
  const pending = proposals.filter((p) => p.state === "pending").length;

  return (
    <section aria-labelledby="story-proposals-heading" className="rounded-lg border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-[18px]">
          <Lightbulb />
        </span>
        <h2 id="story-proposals-heading" className="m-0 text-section font-semibold">
          Proposals filed by this Story
        </h2>
        {pending > 0 && <span className="text-body text-muted-foreground tabular-nums">{`${pending} waiting`}</span>}
      </header>
      <ol aria-label="Proposals filed by this Story" className="m-0 list-none px-4 pb-4">
        {proposals.map((p) => (
          <ProposalRow key={p.id} projectId={projectId} storyId={storyId} proposal={p} />
        ))}
      </ol>
    </section>
  );
}

function ProposalRow({ projectId, storyId, proposal }: { projectId: string; storyId: string; proposal: ProposalDto }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { kind, names } = describeStoryProposal(proposal);
  const label = [kind, names].filter(Boolean).join(" ");

  function decide(write: Promise<void>) {
    setBusy(true);
    setError(null);
    write
      .then(() => queryClient.invalidateQueries({ queryKey: storyProposalsQueryKey(projectId, storyId) }))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start gap-3">
        <p className="m-0 min-w-0 flex-1 text-body break-words">
          <span className="font-semibold">{kind}</span>
          {names && <span>{` · ${names}`}</span>}
        </p>
        {proposal.state === "pending" && (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Accept ${label}`} onClick={() => decide(proposalAccept(proposal.id))}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Reject ${label}`} onClick={() => decide(proposalReject(proposal.id, null))}>
              Reject
            </Button>
          </span>
        )}
      </div>
      {proposal.rationale && <p className="m-0 max-w-[75ch] text-small">{proposal.rationale}</p>}
      {proposal.evidence && (
        <p className="m-0 max-w-[75ch] text-small text-muted-foreground break-words">
          Evidence: <span className="font-mono">{proposal.evidence}</span>
        </p>
      )}
      <p className="m-0 text-meta text-muted-foreground tabular-nums">
        {`${stateWords(proposal)} · filed ${formatWhen(proposal.createdAt)}`}
      </p>
      {error && <p className="m-0 text-small text-destructive-text">{error}</p>}
    </li>
  );
}
