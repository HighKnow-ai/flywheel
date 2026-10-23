/**
 * The review card's Decisions section (docs/mvp-spec.md §8, issue #161, ADR 0010): what the Story changes in
 * the repo's knowledge, `docs/adr/` and `GLOSSARY.md`, apart from its code, with a count.
 *
 * Each ADR the branch adds is a card: its title and path, its four bar lines (from the hand-off, or from the
 * ADR accepted on the Epic in shaping, or "No bar lines"), the live ADRs on the base branch it relates to, and
 * the developer's decision on it, Keep by default. Every other change (an edited ADR, the glossary) is one row:
 * its path, what happened to it and its line counts. The section is left out when there is nothing in it.
 */
import { useId } from "react";
import { BookA, BookMarked, FilePen, FilePlus, FileX, ScrollText } from "lucide-react";
import type { AdrBarLinesDto, DecisionChangeDto, NewAdrDto } from "../adapters/tauri";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/** The four bar lines (docs/mvp-spec.md §6), in the spec's order. */
const BAR_LINES: { key: keyof AdrBarLinesDto; label: string }[] = [
  { key: "hardToReverse", label: "Hard to reverse" },
  { key: "surprising", label: "Surprising" },
  { key: "losingAlternative", label: "Losing alternative" },
  { key: "relatesTo", label: "Relates to" },
];

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

/** One new ADR: what it decides, why it clears the bar, what it relates to, and Keep. */
function NewAdrCard({ change, adr }: { change: DecisionChangeDto; adr: NewAdrDto }) {
  const titleId = useId();
  const keepId = useId();
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
        <RadioGroup
          aria-label={`Decision on ${adr.title}`}
          value="keep"
          className="flex w-auto shrink-0 items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1.5"
        >
          <RadioGroupItem id={keepId} value="keep" />
          <Label htmlFor={keepId} className="text-small font-semibold">
            Keep
          </Label>
        </RadioGroup>
      </div>

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

/** Any other change: an edited, renamed or deleted ADR, or the glossary. */
function ChangeRow({ change }: { change: DecisionChangeDto }) {
  return (
    <li className="flex min-h-9 min-w-0 items-center gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0 last:pb-0">
      <StatusIcon change={change} />
      <code className="min-w-0 truncate font-mono text-small text-foreground" title={change.path}>
        {change.path}
      </code>
      <span className="min-w-0 truncate text-small text-muted-foreground">{statusWords(change)}</span>
      <span className="flex-1" />
      <LineCounts change={change} />
    </li>
  );
}

export function DecisionsSection({ decisions }: { decisions: DecisionChangeDto[] }) {
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
            <NewAdrCard key={change.path} change={change} adr={change.newAdr} />
          ) : (
            <ChangeRow key={change.path} change={change} />
          ),
        )}
      </ul>
    </section>
  );
}
