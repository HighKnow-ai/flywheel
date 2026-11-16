/**
 * A flow doc's sequence diagram is the spec, and the trace the headless core recorded must match it.
 * The diagram follows `docs/flows/README.md`: one Mermaid `sequenceDiagram`, `participant` lines,
 * and one message per line, `<from>->><to>: S<n> <label>`. The label is the name of the command the
 * UI called, or of the board tool the agent called.
 */
import fs from "node:fs";

export interface TraceStep {
  from: string;
  to: string;
  label: string;
}

export interface DiagramStep extends TraceStep {
  /** `S1`, `S2`, ... as written in the doc. */
  id: string;
  /**
   * `false` for a step whose label ends in the mark `(not logged)`: the code performs it, but the core
   * writes no trace line for it (a heartbeat thread, for example). The trace is not compared with it,
   * and `docs/flows/untraced-steps.json` counts it so the number can only shrink.
   */
  traced: boolean;
}

/** The mark that ends the label of a step the core does not trace. */
export const NOT_LOGGED = "(not logged)";

const MESSAGE = /^\s*([a-z0-9-]+)->>([a-z0-9-]+):\s*(S\d+)\s+(.+?)\s*$/;
const BLOCK = /(```mermaid\n)([\s\S]*?)(```)/;

function diagramOf(markdown: string, file: string): string {
  const block = BLOCK.exec(markdown);
  if (!block) throw new Error(`${file} has no mermaid block`);
  return block[2];
}

/** The ordered steps of the doc's diagram. Throws on a malformed one, which a mismatch would hide. */
export function parseDiagram(markdown: string, file = "the flow doc"): DiagramStep[] {
  const steps: DiagramStep[] = [];
  const seen = new Set<string>();
  for (const [index, line] of diagramOf(markdown, file).split("\n").entries()) {
    const text = line.trim();
    if (!text || text.startsWith("%%") || text === "sequenceDiagram" || text.startsWith("participant ")) continue;
    const message = MESSAGE.exec(line);
    if (!message) throw new Error(`${file}: diagram line ${index + 1} is not \`<from>->><to>: S<n> <label>\`: ${text}`);
    const [, from, to, id, labelText] = message;
    if (seen.has(id)) throw new Error(`${file}: step ${id} appears twice`);
    seen.add(id);
    const traced = !labelText.endsWith(NOT_LOGGED);
    const label = traced ? labelText : labelText.slice(0, -NOT_LOGGED.length).trim();
    if (label === "" || /[()]/.test(label))
      throw new Error(`${file}: step ${id} has a label that is empty or holds a bracket: ${labelText}`);
    steps.push({ id, from, to, label, traced });
  }
  if (steps.length === 0) throw new Error(`${file}: the diagram has no steps`);
  return steps;
}

const show = (s: TraceStep) => `${s.from}->>${s.to}: ${s.label}`;

/** `null` when the trace is the diagram's step list, else what differs, first difference named. */
export function compare(
  diagram: readonly (TraceStep & { id?: string; traced?: boolean })[],
  trace: readonly TraceStep[],
): string | null {
  diagram = diagram.filter((s) => s.traced !== false);
  const wanted = diagram.map(show);
  const got = trace.map(show);
  if (wanted.length === got.length && wanted.every((line, i) => line === got[i])) return null;
  const at = wanted.findIndex((line, i) => line !== got[i]);
  const first = at === -1 ? Math.min(wanted.length, got.length) : at;
  const lines = Array.from({ length: Math.max(wanted.length, got.length) }, (_, i) => {
    const mark = wanted[i] === got[i] ? "  " : "! ";
    return `${mark}${String(i + 1).padStart(2)}  diagram: ${wanted[i] ?? "(none)"}\n        trace:   ${got[i] ?? "(none)"}`;
  });
  return `the trace differs from the diagram at step ${first + 1} (${diagram[first]?.id ?? "past the end"}):\n${lines.join("\n")}`;
}

/** The doc with its diagram's messages replaced by the trace, renumbered; participants stay. */
export function rewriteDiagram(markdown: string, trace: readonly TraceStep[], file = "the flow doc"): string {
  const block = BLOCK.exec(markdown);
  if (!block) throw new Error(`${file} has no mermaid block`);
  const kept = block[2].split("\n").filter((line) => {
    const text = line.trim();
    return text && !MESSAGE.test(line);
  });
  // A `(not logged)` step is not in the trace, so it keeps its place after the same number of traced steps.
  const untraced = parseDiagram(markdown, file).filter((s) => !s.traced);
  const before = new Map<string, number>();
  let seenTraced = 0;
  for (const s of parseDiagram(markdown, file)) {
    if (s.traced) seenTraced += 1;
    else before.set(s.id, seenTraced);
  }
  const entries: string[] = [];
  const place = (count: number) => {
    for (const s of untraced) {
      if (Math.min(before.get(s.id)!, trace.length) === count)
        entries.push(`${s.from}->>${s.to}: @ ${s.label} ${NOT_LOGGED}`);
    }
  };
  place(0);
  trace.forEach((s, i) => {
    entries.push(`${s.from}->>${s.to}: @ ${s.label}`);
    place(i + 1);
  });
  const messages = entries.map((line, i) => `  ${line.replace("@", `S${i + 1}`)}`);
  const rewritten = [...kept, ...messages].join("\n") + "\n";
  return markdown.replace(BLOCK, `${block[1]}${rewritten}${block[3]}`);
}

/** The step numbers a Tests row's last cell names: `S1-S4`, `S1,S3`, `S8`, or `none`. */
export function parseCovers(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.replace(/\s/g, "").split(",")) {
    const m = /^S(\d+)(?:-S(\d+))?$/.exec(part);
    if (!m) continue;
    const to = Number(m[2] ?? m[1]);
    for (let n = Number(m[1]); n <= to; n++) out.push(`S${n}`);
  }
  return out;
}

export interface TestsRow {
  path: string;
  covers: string[];
}

/** The rows of the doc's `## Tests` table: the test path (second column) and the steps it covers (third). */
export function parseTests(markdown: string): TestsRow[] {
  const rows: TestsRow[] = [];
  let inside = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) inside = line.trim() === "## Tests";
    if (!inside || !line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const path = /`([^`]+)`/.exec(cells[2] ?? "")?.[1];
    if (path) rows.push({ path, covers: parseCovers(cells[3] ?? "") });
  }
  return rows;
}

/**
 * What the Tests table says about `spec` (a path relative to the `flywheel/` folder), or the reason it
 * says nothing. The test's row must name every traced step: the trace of a run is one whole, so a row
 * that skips a traced step would let that step go unproved.
 */
export function checkTestsRow(markdown: string, spec: string, file = "the flow doc"): string | null {
  const row = parseTests(markdown).find((r) => r.path === spec);
  if (!row)
    return `${file}: the Tests table has no row for ${spec}. Add one: what it proves, \`${spec}\`, and the steps it covers.`;
  const steps = parseDiagram(markdown, file);
  const missing = steps.filter((s) => s.traced && !row.covers.includes(s.id)).map((s) => s.id);
  if (missing.length > 0)
    return `${file}: the Tests row of ${spec} does not cover ${missing.join(", ")}. The test compares every traced step, so the row must name them.`;
  const unknown = row.covers.filter((id) => !steps.some((s) => s.id === id));
  if (unknown.length > 0)
    return `${file}: the Tests row of ${spec} names ${unknown.join(", ")}, which the diagram does not have.`;
  return null;
}

/**
 * Check the trace against the doc at `file`, and the doc's Tests row for `spec` (when given). With
 * `update` a mismatch rewrites the diagram instead of failing, and the caller reports it. The Tests
 * row is never rewritten: it is a claim a person makes, so the person edits it. Returns the failure
 * text, or `null`.
 */
export function checkFlow(
  file: string,
  trace: readonly TraceStep[],
  update: boolean,
  spec?: string,
): { failure: string | null; rewrote: boolean } {
  let markdown = fs.readFileSync(file, "utf8");
  let rewrote = false;
  const failure = compare(parseDiagram(markdown, file), trace);
  if (failure !== null) {
    if (!update)
      return {
        failure: `${file}: ${failure}\nRun \`npm --prefix packages/desktop run e2e -- --update\` if the new flow is right.`,
        rewrote: false,
      };
    markdown = rewriteDiagram(markdown, trace, file);
    fs.writeFileSync(file, markdown);
    rewrote = true;
  }
  const row = spec === undefined ? null : checkTestsRow(markdown, spec, file);
  return { failure: row, rewrote };
}
