/**
 * The review card's Decisions section (docs/mvp-spec.md §8, issue #161, ADR 0010): what the Story changes in
 * the repo's knowledge, `docs/adr/` and `GLOSSARY.md`, apart from its code, with a count.
 *
 * Each ADR the branch adds is a card: its title and path, its four bar lines (from the hand-off, or from the
 * ADR accepted on the Epic in shaping, or "No bar lines"), the live ADRs on the base branch it relates to, and
 * the developer's decision on it (issue #164, ADR 0016): Keep by default, Not an ADR, or Wrong decision, which
 * opens two fields in place (what is wrong, what it should be) and records nothing until Record. Anything but
 * Keep holds Merge and goes to the agent with Request changes; it never sends the Story back by itself. Every
 * other change (an edited ADR, the glossary) is one row: its path, what happened to it and its line counts.
 *
 * Under each change sit the core's flags (issue #164): "Wording or supersede?" on an existing ADR with a changed
 * line other than `Status:`, "Renumber" on a new ADR whose number the base branch already holds, and
 * "Supersession line missing" on a new ADR whose superseded ADR has no `Status: superseded by` line. The section
 * is left out when there is nothing in it.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { BookA, BookMarked, CircleAlert, FilePen, FilePlus, FileX, ScrollText } from "lucide-react";
import {
  storyAdrDecide,
  type AdrBarLinesDto,
  type AdrDecisionKind,
  type DecisionChangeDto,
  type DecisionFlagDto,
  type NewAdrDto,
} from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The four bar lines (docs/mvp-spec.md §6), in the spec's order. */
const BAR_LINES: { key: keyof AdrBarLinesDto; label: string }[] = [
  { key: "hardToReverse", label: "Hard to reverse" },
  { key: "surprising", label: "Surprising" },
  { key: "losingAlternative", label: "Losing alternative" },
  { key: "relatesTo", label: "Relates to" },
];

/** The three decisions on a new ADR, in the spec's order. */
const DECISIONS: { kind: AdrDecisionKind; label: string }[] = [
  { kind: "keep", label: "Keep" },
  { kind: "not_an_adr", label: "Not an ADR" },
  { kind: "wrong_decision", label: "Wrong decision" },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What happened to a changed file, in words. */
function statusWords(change: DecisionChangeDto): string {
  switch (change.status) {
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return change.oldPath ? `Renamed from ${change.oldPath}` : "Renamed";
    case "C":
      return change.oldPath ? `Copied from ${change.oldPath}` : "Copied";
    default:
      return "Edited";
  }
}

function StatusIcon({ change }: { change: DecisionChangeDto }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (change.kind === "glossary") return <BookA aria-hidden="true" className={className} />;
  if (change.status === "A") return <FilePlus aria-hidden="true" className={className} />;
  if (change.status === "D") return <FileX aria-hidden="true" className={className} />;
  return <FilePen aria-hidden="true" className={className} />;
}

function LineCounts({ change }: { change: DecisionChangeDto }) {
  if (change.added === null && change.removed === null) return null;
  return (
    <span className="shrink-0 text-meta text-muted-foreground tabular-nums">{`+${change.added ?? 0} −${change.removed ?? 0}`}</span>
  );
}

/** "ADR-0002" from `docs/adr/0002-slug.md`, or the file name when it has no number. */
function adrLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  const number = /^(\d+)/.exec(name)?.[1];
  return number ? `ADR-${number}` : name.replace(/\.md$/, "");
}

function barLinesSource(adr: NewAdrDto): string {
  return adr.barLinesFrom === "shaping"
    ? "Bar lines from shaping: this ADR was accepted on the Epic."
    : "Bar lines from the hand-off. They are shown beside the ADR, never written into it.";
}

function Path({ path }: { path: string | null }) {
  return <code className="font-mono break-all text-foreground">{path}</code>;
}

/** One flag the core raised on a change: what it is, then what to do about it. */
function FlagLine({ path, flag }: { path: string; flag: DecisionFlagDto }) {
  let title: string;
  let detail: ReactNode;
  switch (flag.kind) {
    case "wording_or_supersede":
      title = "Wording or supersede?";
      detail =
        "A line other than Status: changed. A wording fix stays in place; a changed decision is a new ADR that supersedes this one.";
      break;
    case "renumber":
      title = "Renumber";
      detail = (
        <>
          {`${adrLabel(path)} is already taken on ${flag.baseBranch ?? "the base branch"} by `}
          <Path path={flag.takenBy} />.
        </>
      );
      break;
    default:
      title = "Supersession line missing";
      detail = (
        <>
          <Path path={flag.superseded} />
          {" has no Status: superseded by line, and this ADR supersedes it."}
        </>
      );
  }
  return (
    <li className="flex min-w-0 items-start gap-2 text-small">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-foreground" />
      <span className="min-w-0 break-words text-muted-foreground">
        <span className="font-semibold text-foreground">{title}</span>
        {" · "}
        {detail}
      </span>
    </li>
  );
}

function Flags({ change, className }: { change: DecisionChangeDto; className?: string }) {
  if (change.flags.length === 0) return null;
  return (
    <ul aria-label="Flags" className={cn("m-0 flex min-w-0 list-none flex-col gap-1 p-0", className)}>
      {change.flags.map((flag) => (
        <FlagLine key={`${flag.kind}-${flag.takenBy ?? flag.superseded ?? ""}`} path={change.path} flag={flag} />
      ))}
    </ul>
  );
}

/**
 * The developer's decision on one new ADR: the radio group, and under it the Wrong decision fields or what a
 * stored decision does. Keep and Not an ADR are stored on the pick; Wrong decision is stored on Record. A
 * refusal says the core's words under the card.
 */
function useAdrDecision({
  storyId,
  change,
  adr,
  onDecided,
}: {
  storyId: string;
  change: DecisionChangeDto;
  adr: NewAdrDto;
  onDecided?: () => void;
}): { group: ReactNode; detail: ReactNode } {
  const stored = adr.decision;
  const [choice, setChoice] = useState<AdrDecisionKind>(stored.kind);
  const [whatIsWrong, setWhatIsWrong] = useState(stored.whatIsWrong ?? "");
  const [shouldBe, setShouldBe] = useState(stored.shouldBe ?? "");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // The card re-reads after every write: follow what is on the record.
  useEffect(() => {
    setChoice(stored.kind);
    setWhatIsWrong(stored.whatIsWrong ?? "");
    setShouldBe(stored.shouldBe ?? "");
  }, [stored.kind, stored.whatIsWrong, stored.shouldBe]);

  function decide(kind: AdrDecisionKind, wrong: string | null = null, should: string | null = null) {
    setBusy(true);
    setError(null);
    storyAdrDecide(storyId, change.path, kind, wrong, should)
      .then(() => onDecided?.())
      .catch((err: unknown) => {
        setError(errorText(err));
        setChoice(stored.kind);
      })
      .finally(() => setBusy(false));
  }

  function pick(value: string) {
    const kind = value as AdrDecisionKind;
    setChoice(kind);
    setMissing(false);
    if (kind !== "wrong_decision") decide(kind);
  }

  function record() {
    if (whatIsWrong.trim() === "" || shouldBe.trim() === "") {
      setMissing(true);
      return;
    }
    setMissing(false);
    decide("wrong_decision", whatIsWrong.trim(), shouldBe.trim());
  }

  function cancel() {
    setChoice(stored.kind);
    setWhatIsWrong(stored.whatIsWrong ?? "");
    setShouldBe(stored.shouldBe ?? "");
    setMissing(false);
  }

  // Wrong decision picked, or its answers edited, but not recorded yet.
  const unrecorded =
    choice === "wrong_decision" &&
    (stored.kind !== "wrong_decision" || whatIsWrong !== (stored.whatIsWrong ?? "") || shouldBe !== (stored.shouldBe ?? ""));

  const group = (
    <RadioGroup
      aria-label={`Decision on ${adr.title}`}
      value={choice}
      onValueChange={pick}
      disabled={busy}
      className="flex w-auto shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-input bg-card px-2.5 py-1.5"
    >
      {DECISIONS.map(({ kind, label }) => (
        <span key={kind} className="flex items-center gap-1.5">
          <RadioGroupItem id={`${id}-${kind}`} value={kind} />
          <Label htmlFor={`${id}-${kind}`} className="text-small font-semibold">
            {label}
          </Label>
        </span>
      ))}
    </RadioGroup>
  );

  const field = (key: string, label: string, value: string, set: (next: string) => void) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={`${id}-${key}`} className="text-meta font-semibold text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id={`${id}-${key}`}
        value={value}
        disabled={busy}
        rows={2}
        aria-invalid={(missing && value.trim() === "") || undefined}
        onChange={(event) => set(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            cancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            record();
          }
        }}
        className="min-h-14 bg-card"
      />
    </div>
  );

  const detail = (
    <>
      {choice === "wrong_decision" && (
        <div className="flex min-w-0 flex-col gap-2 pl-6">
          <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 @lg:grid-cols-2">
            {field("wrong", "What is wrong?", whatIsWrong, setWhatIsWrong)}
            {field("should", "What should it be?", shouldBe, setShouldBe)}
          </div>
          {missing && (
            <p className="m-0 text-small text-destructive-text">Say both what is wrong and what it should be.</p>
          )}
          {unrecorded && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={record} loading={busy}>
                <FilePen aria-hidden="true" />
                Record Wrong decision
              </Button>
            </div>
          )}
        </div>
      )}
      {stored.kind !== "keep" && !unrecorded && (
        <p className="m-0 flex items-start gap-1.5 pl-6 text-small text-muted-foreground">
          <FileX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          <span>
            <span className="font-semibold text-foreground">{stored.kind === "not_an_adr" ? "Not an ADR" : "Wrong decision"}</span>
            {stored.kind === "not_an_adr"
              ? " · Merge waits. Request changes asks the agent to delete the file and keep the decision out of docs/adr."
              : " · Merge waits. Request changes sends both answers as one review point on the code and the ADR."}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 pl-6 text-small text-destructive-text">
          {error}
        </p>
      )}
    </>
  );

  return { group, detail };
}

/** One new ADR: what it decides, why it clears the bar, what it relates to, its flags and its decision. */
function NewAdrCard({
  storyId,
  change,
  adr,
  onDecided,
}: {
  storyId: string;
  change: DecisionChangeDto;
  adr: NewAdrDto;
  onDecided?: () => void;
}) {
  const titleId = useId();
  const decision = useAdrDecision({ storyId, change, adr, onDecided });
  return (
    <li
      role="group"
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <ScrollText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span id={titleId} className="text-body font-semibold break-words">
              {adr.title}
            </span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-meta text-muted-foreground">
              <code className="min-w-0 font-mono break-all text-foreground">{change.path}</code>
              <span>New ADR</span>
              <LineCounts change={change} />
            </span>
          </div>
        </div>
        {decision.group}
      </div>

      <Flags change={change} className="pl-6" />
      {decision.detail}

      {adr.barLines ? (
        <div className="flex min-w-0 flex-col gap-1.5 pl-6">
          <ul aria-label="Bar lines" className="m-0 grid min-w-0 list-none grid-cols-1 gap-x-4 gap-y-2 p-0 @lg:grid-cols-2">
            {BAR_LINES.map(({ key, label }) => {
              const value = adr.barLines?.[key] ?? null;
              return (
                <li key={key} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-meta font-semibold text-muted-foreground">{label}</span>
                  <span className={cn("text-small break-words", value ? "text-foreground" : "text-subtle-foreground")}>
                    {value ?? "None"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-meta text-subtle-foreground">{barLinesSource(adr)}</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5 pl-6">
          <span className="text-small font-semibold text-foreground">No bar lines</span>
          <span className="text-meta text-muted-foreground">
            The hand-off gave none and no ADR at this path was accepted in shaping: judge it from the file.
          </span>
        </div>
      )}

      {adr.related.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1 pl-6">
          <span className="text-meta font-semibold text-muted-foreground">Related live ADRs</span>
          <ul aria-label="Related live ADRs" className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
            {adr.related.map((related) => (
              <li key={related.path} className="flex min-w-0 items-baseline gap-2 text-small">
                <BookMarked aria-hidden="true" className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                <code title={related.path} className="shrink-0 font-mono text-meta text-muted-foreground">
                  {adrLabel(related.path)}
                </code>
                <span className="min-w-0 break-words text-foreground">{related.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Any other change: an edited, renamed or deleted ADR, or the glossary, with its flags under it. */
function ChangeRow({ change }: { change: DecisionChangeDto }) {
  return (
    <li className="flex min-w-0 flex-col border-t border-border py-1.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        <StatusIcon change={change} />
        <code className="min-w-0 truncate font-mono text-small text-foreground" title={change.path}>
          {change.path}
        </code>
        <span className="min-w-0 truncate text-small text-muted-foreground">{statusWords(change)}</span>
        <span className="flex-1" />
        <LineCounts change={change} />
      </div>
      <Flags change={change} className="pb-1 pl-6" />
    </li>
  );
}

export function DecisionsSection({
  storyId,
  decisions,
  onDecided,
}: {
  storyId: string;
  decisions: DecisionChangeDto[];
  /** Called once a decision is stored, so the card re-reads. */
  onDecided?: () => void;
}) {
  if (decisions.length === 0) return null;
  const label = `Decisions, ${decisions.length} ${decisions.length === 1 ? "change" : "changes"}`;
  return (
    <section aria-label={label} className="@container flex min-w-0 flex-col gap-2.5">
      <h3 className="m-0 flex items-baseline gap-2 text-small font-semibold">
        Decisions
        <span className="text-meta font-medium text-muted-foreground tabular-nums">
          {`${decisions.length} ${decisions.length === 1 ? "ADR or glossary change" : "ADR and glossary changes"}`}
        </span>
      </h3>
      <ul className="m-0 flex min-w-0 list-none flex-col rounded-md border border-border bg-muted px-3 py-2.5">
        {decisions.map((change) =>
          change.newAdr ? (
            <NewAdrCard key={change.path} storyId={storyId} change={change} adr={change.newAdr} onDecided={onDecided} />
          ) : (
            <ChangeRow key={change.path} change={change} />
          ),
        )}
      </ul>
    </section>
  );
}
