/**
 * Behavior under test (08.1-11-PLAN.md Task 3, D-09): the home surface's "what this says" line is a
 * pure function of already-fetched aggregates — a fixed rule set, so it costs nothing, is the same
 * for the same input, and cannot say anything the numbers do not. No component is rendered here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summaryLine, type BoardAggregates } from "../summaryLine";

const QUIET: BoardAggregates = {
  decisionsPending: 0,
  reviewable: 0,
  agentsBlocked: 0,
  buildsFailing: 0,
  agentsRunning: 0,
  epicsWithoutCriteria: 0,
};

const HOUR = 60 * 60 * 1000;

describe("summaryLine (D-09)", () => {
  it("states the decisions pending", () => {
    expect(summaryLine({ ...QUIET, decisionsPending: 3 })).toContain("3 decisions pending");
    expect(summaryLine({ ...QUIET, decisionsPending: 1 })).toContain("1 decision pending");
  });

  it("states how many items are reviewable", () => {
    expect(summaryLine({ ...QUIET, reviewable: 181 })).toContain("181 items ready to review");
    expect(summaryLine({ ...QUIET, reviewable: 1 })).toContain("1 item ready to review");
  });

  it("states that an agent is blocked and for how long, when the duration is measurable", () => {
    expect(summaryLine({ ...QUIET, agentsBlocked: 1, blockedForMs: 4 * HOUR })).toContain("1 agent blocked for 4 hours");
    expect(summaryLine({ ...QUIET, agentsBlocked: 2, blockedForMs: 90 * 1000 })).toContain(
      "2 agents blocked, the longest for 1 minute",
    );
  });

  it("states that an agent is blocked without inventing a duration when none was measured", () => {
    const line = summaryLine({ ...QUIET, agentsBlocked: 2 });
    expect(line).toContain("2 agents blocked");
    expect(line).not.toMatch(/for \d|longest/);
  });

  it("states how many epics have no criteria", () => {
    expect(summaryLine({ ...QUIET, epicsWithoutCriteria: 8 })).toContain("8 epics have no criteria yet");
    expect(summaryLine({ ...QUIET, epicsWithoutCriteria: 1 })).toContain("1 epic has no criteria yet");
  });

  it("states plainly that nothing is notable, never an empty string", () => {
    const line = summaryLine(QUIET);
    expect(line.length).toBeGreaterThan(0);
    expect(line).toBe("Nothing is waiting on you right now.");
  });

  it("orders the clauses by the cost of waiting, and the same input always gives the same sentence", () => {
    const all: BoardAggregates = {
      decisionsPending: 3,
      reviewable: 181,
      agentsBlocked: 1,
      blockedForMs: 2 * HOUR,
      buildsFailing: 2,
      agentsRunning: 5,
      epicsWithoutCriteria: 8,
    };
    const line = summaryLine(all);

    expect(summaryLine(all)).toBe(line);
    const at = (needle: string) => line.indexOf(needle);
    const order = ["decisions pending", "agent blocked", "failing build", "ready to review", "running", "no criteria yet"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("does no input or output: plain objects in, a string out, and nothing imported", () => {
    expect(typeof summaryLine({ ...QUIET, decisionsPending: 1 })).toBe("string");
    const source = readFileSync(new URL("../summaryLine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
