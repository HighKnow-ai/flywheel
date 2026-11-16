/**
 * The flow docs are held by runs: every doc has a Tests row for an e2e spec that calls the matcher, and
 * the count of `(not logged)` steps only shrinks. The first test runs on the real `docs/flows/`. The
 * others are positive controls: a scratch copy of the folder is broken one way at a time, and the check
 * must name that way. A check that never failed would prove nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFlowDocs, RATCHET_FILE } from "./flow-docs-check";
import { checkFlow, checkTestsRow, compare, parseDiagram, rewriteDiagram, type TraceStep } from "./flow-doc";

const FLYWHEEL = path.resolve(import.meta.dirname, "..", "..", "..");

/** A scratch `flywheel/` folder with the real flow docs and specs, to break. */
function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flow-docs-"));
  for (const dir of ["docs/flows", "packages/desktop/e2e/flows", "packages/desktop/src-tauri/src"]) {
    fs.cpSync(path.join(FLYWHEEL, dir), path.join(root, dir), { recursive: true });
  }
  return root;
}
const flowsOf = (root: string, name: string) => path.join(root, "docs", "flows", name);
const edit = (file: string, from: string | RegExp, to: string) => {
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(from, to);
  expect(after, `${file} must change`).not.toBe(before);
  fs.writeFileSync(file, after);
};

describe("the flow docs of this repository", () => {
  it("are all held by a spec that calls the matcher, and stay within the ratchet", () => {
    expect(checkFlowDocs(FLYWHEEL)).toEqual([]);
  });
});

describe("the check refuses", () => {
  it("a doc whose Tests table has no e2e spec row", () => {
    const root = scratch();
    edit(flowsOf(root, "cold-start.md"), /\| A session that was running.*\n/, "");
    expect(checkFlowDocs(root).join("\n")).toMatch(/cold-start\.md: the Tests table has no row for a spec/);
  });

  it("a Tests row that skips a traced step", () => {
    const root = scratch();
    edit(flowsOf(root, "cold-start.md"), "| S1-S4 |", "| S1-S3 |");
    expect(checkFlowDocs(root).join("\n")).toMatch(/does not cover S4/);
  });

  it("a spec that does not pass its doc to flow(), so the matcher never reads the diagram", () => {
    const root = scratch();
    edit(
      path.join(root, "packages/desktop/e2e/flows/cold-start.spec.ts"),
      'doc: "cold-start.md"',
      'doc: "blocked-queue.md"',
    );
    expect(checkFlowDocs(root).join("\n")).toMatch(/does not call flow\(\.\.\.\) with doc: "cold-start\.md"/);
  });

  it("a spec that no doc names", () => {
    const root = scratch();
    fs.copyFileSync(
      path.join(root, "packages/desktop/e2e/flows/cold-start.spec.ts"),
      path.join(root, "packages/desktop/e2e/flows/orphan.spec.ts"),
    );
    expect(checkFlowDocs(root).join("\n")).toMatch(/orphan\.spec\.ts is in no doc's Tests table/);
  });

  it("an Entry points row whose symbol is not in its file", () => {
    const root = scratch();
    edit(flowsOf(root, "cold-start.md"), "`boot`", "`no_such_symbol`");
    expect(checkFlowDocs(root).join("\n")).toMatch(/no_such_symbol/);
  });

  it("a new (not logged) step: the ratchet only shrinks", () => {
    const root = scratch();
    edit(
      flowsOf(root, "cold-start.md"),
      "  scheduler->>core: S4",
      "  core->>core: S4 sleep (not logged)\n  scheduler->>core: S5",
    );
    expect(checkFlowDocs(root).join("\n")).toMatch(
      /cold-start\.md: 1 step\(s\) are \(not logged\), and untraced-steps\.json allows 0/,
    );
  });

  it("a (not logged) step that went away while the ratchet still counts it", () => {
    const root = scratch();
    fs.writeFileSync(flowsOf(root, RATCHET_FILE), JSON.stringify({ "session-supervision.md": 1, "cold-start.md": 1 }));
    expect(checkFlowDocs(root).join("\n")).toMatch(
      /cold-start\.md: only 0 step\(s\).*Lower untraced-steps\.json from 1 to 0/,
    );
  });
});

describe("a (not logged) step", () => {
  const DOC = [
    "# A flow",
    "```mermaid",
    "sequenceDiagram",
    "  participant ui",
    "  participant core",
    "  ui->>core: S1 story_start",
    "  core->>core: S2 touch_heartbeat (not logged)",
    "  ui->>core: S3 session_stop",
    "```",
    "## Tests",
    "| What | Test path | Covers steps |",
    "|---|---|---|",
    "| x | `packages/desktop/e2e/flows/a.spec.ts` | S1,S3 |",
    "",
  ].join("\n");
  const step = (from: string, to: string, label: string): TraceStep => ({ from, to, label });
  const TRACE = [step("ui", "core", "story_start"), step("ui", "core", "session_stop")];

  it("is read as untraced and left out of the comparison", () => {
    const steps = parseDiagram(DOC);
    expect(steps.map((s) => [s.id, s.traced, s.label])).toEqual([
      ["S1", true, "story_start"],
      ["S2", false, "touch_heartbeat"],
      ["S3", true, "session_stop"],
    ]);
    expect(compare(steps, TRACE)).toBeNull();
  });

  it("does not hide a traced step: a reordered trace and a missing event fail with the step named", () => {
    const steps = parseDiagram(DOC);
    expect(compare(steps, [TRACE[1], TRACE[0]])).toMatch(
      /at step 1 \(S1\)[\s\S]*diagram: ui->>core: story_start[\s\S]*trace:\s+ui->>core: session_stop/,
    );
    expect(compare(steps, TRACE.slice(0, 1))).toMatch(/at step 2 \(S3\)[\s\S]*trace:\s+\(none\)/);
  });

  it("keeps its place when --update rewrites the diagram", () => {
    const trace = [TRACE[0], step("agent", "core", "handoff"), TRACE[1]];
    const out = rewriteDiagram(DOC, trace);
    expect(out).toContain(
      "  ui->>core: S1 story_start\n  core->>core: S2 touch_heartbeat (not logged)\n  agent->>core: S3 handoff\n  ui->>core: S4 session_stop",
    );
  });

  it("is refused when its label holds a bracket", () => {
    expect(() => parseDiagram(DOC.replace("touch_heartbeat", "touch (twice)"))).toThrow(/bracket/);
  });

  it("makes checkFlow fail when the spec has no Tests row", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-doc-")), "flow.md");
    fs.writeFileSync(file, DOC);
    expect(checkFlow(file, TRACE, false, "packages/desktop/e2e/flows/a.spec.ts").failure).toBeNull();
    expect(checkFlow(file, TRACE, false, "packages/desktop/e2e/flows/b.spec.ts").failure).toMatch(
      /no row for packages\/desktop\/e2e\/flows\/b\.spec\.ts/,
    );
    expect(checkTestsRow(DOC.replace("S1,S3", "S1"), "packages/desktop/e2e/flows/a.spec.ts")).toMatch(
      /does not cover S3/,
    );
  });
});
