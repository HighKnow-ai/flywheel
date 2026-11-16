/**
 * The harness's own failure modes: the diagram is the spec, so a trace that differs from it must
 * fail, a malformed diagram must fail loudly, and `--update` must rewrite only the messages.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFlow, compare, parseDiagram, rewriteDiagram, type TraceStep } from "./flow-doc";

const DOC = [
  "# A flow",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  participant ui as Developer UI",
  "  participant core as Rust core",
  "  %% a comment",
  "  ui->>core: S1 story_start",
  "  core->>ui: S2 board:changed",
  "```",
  "",
  "## Entry points",
  "",
].join("\n");

const step = (from: string, to: string, label: string): TraceStep => ({ from, to, label });
const TRACE = [step("ui", "core", "story_start"), step("core", "ui", "board:changed")];

function tempDoc(markdown: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-doc-")), "flow.md");
  fs.writeFileSync(file, markdown);
  return file;
}

describe("the diagram", () => {
  it("reads its steps in order, skipping participants and comments", () => {
    expect(parseDiagram(DOC)).toEqual([
      { id: "S1", from: "ui", to: "core", label: "story_start", traced: true },
      { id: "S2", from: "core", to: "ui", label: "board:changed", traced: true },
    ]);
  });

  it("refuses a line that is not a step, a repeated step id and an empty diagram", () => {
    expect(() => parseDiagram(DOC.replace("  ui->>core: S1 story_start", "  Note over ui: hello"))).toThrow(
      /diagram line/,
    );
    expect(() => parseDiagram(DOC.replace("S2", "S1"))).toThrow(/appears twice/);
    expect(() => parseDiagram("```mermaid\nsequenceDiagram\n  participant ui\n```")).toThrow(/no steps/);
    expect(() => parseDiagram("no diagram here")).toThrow(/no mermaid block/);
  });
});

describe("the trace against the diagram", () => {
  it("passes when they match", () => {
    expect(compare(parseDiagram(DOC), TRACE)).toBeNull();
  });

  it("fails on a different label, a missing step, an extra step and a different order, naming the first difference", () => {
    const diagram = parseDiagram(DOC);
    expect(compare(diagram, [step("ui", "core", "story_drop"), TRACE[1]])).toMatch(/at step 1 \(S1\)[\s\S]*story_drop/);
    expect(compare(diagram, TRACE.slice(0, 1))).toMatch(/at step 2 \(S2\)[\s\S]*\(none\)/);
    expect(compare(diagram, [...TRACE, step("ui", "core", "story_merge")])).toMatch(/at step 3 \(past the end\)/);
    expect(compare(diagram, [TRACE[1], TRACE[0]])).toMatch(/at step 1/);
  });

  it("fails on the right label sent by the wrong participant", () => {
    expect(compare(parseDiagram(DOC), [step("agent", "core", "story_start"), TRACE[1]])).toMatch(/at step 1/);
  });
});

describe("checkFlow", () => {
  it("fails on a mismatch and leaves the doc alone", () => {
    const file = tempDoc(DOC);
    const { failure, rewrote } = checkFlow(file, [step("ui", "core", "story_drop")], false);
    expect(failure).toMatch(/differs from the diagram/);
    expect(failure).toMatch(/--update/);
    expect(rewrote).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(DOC);
  });

  it("rewrites the messages in update mode and keeps participants, comments and the rest of the doc", () => {
    const file = tempDoc(DOC);
    const trace = [
      step("ui", "core", "story_drop"),
      step("agent", "core", "handoff"),
      step("core", "ui", "board:changed"),
    ];
    const { failure, rewrote } = checkFlow(file, trace, true);
    expect(failure).toBeNull();
    expect(rewrote).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("  participant ui as Developer UI");
    expect(text).toContain("  ui->>core: S1 story_drop");
    expect(text).toContain("  agent->>core: S2 handoff");
    expect(text).toContain("  core->>ui: S3 board:changed");
    expect(text).not.toContain("story_start");
    expect(text).toContain("## Entry points");
    // What it wrote is what it then accepts.
    expect(checkFlow(file, trace, false)).toEqual({ failure: null, rewrote: false });
  });

  it("does not rewrite a doc that already matches", () => {
    const file = tempDoc(DOC);
    expect(checkFlow(file, TRACE, true)).toEqual({ failure: null, rewrote: false });
    expect(rewriteDiagram(DOC, TRACE)).toBe(DOC);
  });
});
