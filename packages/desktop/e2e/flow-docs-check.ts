/**
 * The static side of the flow docs: what no single run can see. `flow-doc.ts` proves one run against
 * one doc. This file proves that every doc is held by a run at all, so a doc cannot drift into prose.
 *
 * For each `docs/flows/<name>.md` (the README and the template are not flows):
 *   1. it has a Mermaid diagram that parses, and each Entry points row names a file and a symbol that exist;
 *   2. its Tests table has a row for an e2e spec (`packages/desktop/e2e/flows/*.spec.ts`) that exists,
 *      whose source passes `doc: "<name>.md"` to `flow(...)`, the call that runs the matcher, and the
 *      row covers every traced step (`checkTestsRow`);
 *   3. the README lists it;
 *   4. its count of `(not logged)` steps is the number `docs/flows/untraced-steps.json` records. The
 *      number is a RATCHET: more steps than recorded fails, and fewer fails too until the file says
 *      the lower number, so the count only goes down. A step stops being untraced when the core traces it.
 * And each spec in `e2e/flows/` is named by exactly one doc.
 */
import fs from "node:fs";
import path from "node:path";
import { checkTestsRow, parseDiagram, parseTests } from "./flow-doc";

export const RATCHET_FILE = "untraced-steps.json";
const NOT_FLOWS = new Set(["README.md"]);

/** `root` is the `flywheel/` folder. Returns every problem found, empty when the docs are sound. */
export function checkFlowDocs(root: string): string[] {
  const flowsDir = path.join(root, "docs", "flows");
  const specsDir = path.join(root, "packages", "desktop", "e2e", "flows");
  const problems: string[] = [];
  const docs = fs
    .readdirSync(flowsDir)
    .filter((f) => f.endsWith(".md") && !NOT_FLOWS.has(f))
    .sort();
  const readme = fs.readFileSync(path.join(flowsDir, "README.md"), "utf8");
  const ratchetPath = path.join(flowsDir, RATCHET_FILE);
  const ratchet: Record<string, number> = fs.existsSync(ratchetPath)
    ? JSON.parse(fs.readFileSync(ratchetPath, "utf8"))
    : {};
  const claimed = new Map<string, string>();

  for (const doc of docs) {
    const file = `docs/flows/${doc}`;
    const markdown = fs.readFileSync(path.join(flowsDir, doc), "utf8");
    let steps;
    try {
      steps = parseDiagram(markdown, file);
    } catch (error) {
      problems.push(String((error as Error).message));
      continue;
    }

    if (!readme.includes(`(${doc})`)) problems.push(`${file}: docs/flows/README.md does not list it in its table.`);

    // Entry points: each row names a real file that holds the symbol.
    for (const row of entryPoints(markdown)) {
      const target = path.join(root, row.path);
      if (!fs.existsSync(target)) problems.push(`${file}: Entry points names ${row.path}, which does not exist.`);
      else if (!fs.readFileSync(target, "utf8").includes(row.symbol))
        problems.push(`${file}: Entry points names ${row.symbol} in ${row.path}, and the file does not hold it.`);
    }

    // Tests: an e2e spec that exists, calls the matcher for this doc, and is covered whole.
    const specs = parseTests(markdown).filter((r) => /^packages\/desktop\/e2e\/flows\/[^/]+\.spec\.ts$/.test(r.path));
    if (specs.length === 0)
      problems.push(`${file}: the Tests table has no row for a spec in packages/desktop/e2e/flows/.`);
    for (const { path: spec } of specs) {
      const target = path.join(root, spec);
      if (!fs.existsSync(target)) {
        problems.push(`${file}: the Tests table names ${spec}, which does not exist.`);
        continue;
      }
      if (!new RegExp(`doc:\\s*"${doc.replace(".", "\\.")}"`).test(fs.readFileSync(target, "utf8")))
        problems.push(
          `${file}: ${spec} does not call flow(...) with doc: "${doc}", so no run is matched against this diagram.`,
        );
      const row = checkTestsRow(markdown, spec, file);
      if (row !== null) problems.push(row);
      const other = claimed.get(spec);
      if (other !== undefined && other !== doc) problems.push(`${spec} is the spec of two docs: ${other} and ${doc}.`);
      claimed.set(spec, doc);
    }

    // The ratchet.
    const untraced = steps.filter((s) => !s.traced).length;
    const recorded = ratchet[doc] ?? 0;
    if (untraced > recorded)
      problems.push(
        `${file}: ${untraced} step(s) are (not logged), and ${RATCHET_FILE} allows ${recorded}. The count can only shrink: make the core trace the step, or remove it if the code does not perform it.`,
      );
    else if (untraced < recorded)
      problems.push(
        `${file}: only ${untraced} step(s) are (not logged). Lower ${RATCHET_FILE} from ${recorded} to ${untraced}, so the gain stays.`,
      );
  }
  for (const name of Object.keys(ratchet))
    if (!docs.includes(name)) problems.push(`${RATCHET_FILE} has an entry for ${name}, which is not a flow doc.`);

  for (const spec of fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith(".spec.ts"))
    .sort())
    if (!claimed.has(`packages/desktop/e2e/flows/${spec}`))
      problems.push(
        `packages/desktop/e2e/flows/${spec} is in no doc's Tests table, so its flow is not a documented one.`,
      );
  return problems;
}

/** The rows of a doc's `## Entry points` table: the path and the symbol, both from backticks. */
function entryPoints(markdown: string): { path: string; symbol: string }[] {
  const rows: { path: string; symbol: string }[] = [];
  let inside = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) inside = line.trim() === "## Entry points";
    if (!inside || !line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const p = /`([^`]+)`/.exec(cells[2] ?? "")?.[1];
    const symbol = /`([^`]+)`/.exec(cells[3] ?? "")?.[1];
    if (p && symbol) rows.push({ path: p, symbol });
  }
  return rows;
}
