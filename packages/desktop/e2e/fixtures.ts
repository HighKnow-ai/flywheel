/**
 * `flow(...)`: one end-to-end test of a documented flow. It starts a headless core with a scripted
 * agent, hands the body a page already pointed at that core, and, when the body ends, checks the
 * trace the core recorded against the sequence diagram in the flow's doc (`--update` rewrites it).
 */
import path from "node:path";
import fs from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { startCore, type AgentScript, type Core } from "./core";
import { checkFlow } from "./flow-doc";

export const FLOWS_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "docs", "flows");

export interface FlowContext {
  page: Page;
  core: Core;
  /** Open the renderer on this test's core (the latest one, after a restart). */
  open(): Promise<void>;
  /**
   * Crash the core (SIGKILL, no exit step), end the agents it left, and start a new core on the same
   * scratch root: the app's cold start on a board a dead run left behind. Returns the new core. The
   * `core` of this context stays the first one; its trace file is the one trace of the whole flow.
   */
  crashAndRestart(): Promise<Core>;
  /** A full-page screenshot, saved with the test's artifacts. */
  shot(name: string): Promise<void>;
}

export interface FlowSpec {
  /** The doc in `docs/flows/` (or an absolute path) whose diagram this flow's trace must match. */
  doc: string;
  agentScript: AgentScript;
  /** `monorepo`: the project is the `flywheel/` folder of the scratch repository (issue #1600). */
  layout?: "monorepo";
  /** More environment for the core and the agent, for example `FLYWHEEL_FAKE_AWAIT_INTERRUPT: "1"`. */
  agentEnv?: Record<string, string>;
  /** The flow is expected to fail: only the harness's own tests set it. */
  expectFailure?: boolean;
  /** Runs before the trace is reset, so the board is seeded and none of it is part of the flow. */
  seed(core: Core): Promise<void>;
}

/** The spec file that calls `flow(...)`: the first stack frame in a `.spec.ts`, not this file. */
function callerSpec(): string {
  const frame = (new Error().stack ?? "").split("\n").find((l) => /\.spec\.ts/.test(l));
  const file = /(\/[^():]*\.spec\.ts)/.exec(frame ?? "")?.[1] ?? /file:\/\/([^:]*\.spec\.ts)/.exec(frame ?? "")?.[1];
  if (file === undefined)
    throw new Error("flow(...) must be called from a .spec.ts file, so its Tests row can be found");
  return file;
}

export function flow(title: string, spec: FlowSpec, body: (ctx: FlowContext) => Promise<void>): void {
  const specFile = callerSpec();
  test(title, async ({ page }, testInfo) => {
    // For the harness's own test that a diagram mismatch fails the flow.
    if (spec.expectFailure) test.fail();
    const core = await startCore({ agentScript: spec.agentScript, layout: spec.layout, env: spec.agentEnv });
    let current = core;
    try {
      await spec.seed(core);
      await core.resetTrace();
      let shots = 0;
      await body({
        page,
        core,
        open: async () => {
          await page.goto(`/?flywheelCore=${current.port}&flywheelToken=${current.token}`);
        },
        crashAndRestart: async () => {
          await current.crash();
          current.killAgents();
          current = await startCore({
            agentScript: spec.agentScript,
            layout: spec.layout,
            env: spec.agentEnv,
            root: core.root,
          });
          return current;
        },
        shot: async (name) => {
          const file = testInfo.outputPath(`${String(++shots).padStart(2, "0")}-${name}.png`);
          await page.screenshot({ path: file, fullPage: true });
          await testInfo.attach(name, { path: file, contentType: "image/png" });
        },
      });
      await verifyTrace(core, spec.doc, specFile, testInfo);
    } finally {
      await attachCoreArtifacts(current, testInfo);
      await current.stop();
      if (testInfo.status === testInfo.expectedStatus)
        fs.rmSync(path.dirname(core.root), { recursive: true, force: true });
    }
  });
}

/** Compare the core's trace to the doc's diagram, and say what is wrong in the test's own failure. */
async function verifyTrace(core: Core, doc: string, specFile: string, testInfo: TestInfo): Promise<void> {
  const file = path.resolve(FLOWS_DIR, doc);
  // The spec's own path from the `flywheel/` folder, as the doc's Tests table writes it.
  const spec = path
    .relative(path.resolve(FLOWS_DIR, "..", ".."), specFile)
    .split(path.sep)
    .join("/");
  const { failure, rewrote } = checkFlow(file, core.trace(), process.env.FLYWHEEL_E2E_UPDATE === "1", spec);
  if (rewrote) testInfo.annotations.push({ type: "flow doc rewritten", description: file });
  expect(failure, failure ?? "").toBeNull();
}

async function attachCoreArtifacts(core: Core, testInfo: TestInfo): Promise<void> {
  await testInfo.attach("core-trace.jsonl", {
    body: JSON.stringify(core.trace(), null, 1),
    contentType: "application/json",
  });
  await testInfo.attach("core.log", { body: core.log(), contentType: "text/plain" });
}
