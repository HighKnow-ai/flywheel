/**
 * The harness's own failure modes, against the real headless core: a connection without the token is
 * refused, an unknown command is an error, reads stay out of the trace, the trace can be reset, and a
 * flow whose diagram does not match its trace fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startCore } from "./core";
import { flow } from "./fixtures";

test("the core refuses a connection without its token", async () => {
  const core = await startCore({ agentScript: [] });
  try {
    for (const query of ["", "?token=wrong", `?token=${core.token}x`]) {
      const outcome = await new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${core.port}/${query}`);
        socket.addEventListener("open", () => resolve("open"), { once: true });
        socket.addEventListener("error", () => resolve("refused"), { once: true });
      });
      expect(outcome, `query ${JSON.stringify(query)}`).toBe("refused");
    }
  } finally {
    await core.stop();
  }
});

test("an unknown command is an error, reads are not traced, and the trace resets", async () => {
  const core = await startCore({ agentScript: [] });
  try {
    await expect(core.call("no_such_command")).rejects.toThrow(/not found/);
    await core.call("project_list");
    await core.call("project_register", { name: "Scratch", repoPath: core.repo, keyPrefix: "SCR" });
    // An unknown name is no read, so it is traced, and a flow that makes it fails on the diagram.
    expect(core.trace().map((s) => s.label)).toEqual(["no_such_command", "project_register"]);
    await core.resetTrace();
    expect(core.trace()).toEqual([]);
  } finally {
    await core.stop();
  }
});

test("the scratch repository and database are under the scratch root", async () => {
  const core = await startCore({ agentScript: [] });
  try {
    expect(core.repo.startsWith(core.root)).toBe(true);
    expect(fs.existsSync(path.join(core.root, "app-data", "flywheel.db"))).toBe(true);
    expect(core.root.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
  } finally {
    await core.stop();
  }
});

// A flow whose diagram says something else than what happened fails. `expectFailure` makes this
// test green only if it does, so the check cannot go vacuous.
const WRONG_DOC = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-doc-")), "wrong.md");
fs.writeFileSync(
  WRONG_DOC,
  "```mermaid\nsequenceDiagram\n  participant ui\n  participant core\n  ui->>core: S1 story_merge\n```\n",
);
flow(
  "a flow whose diagram does not match its trace fails (marked as an expected failure)",
  {
    doc: WRONG_DOC,
    expectFailure: true,
    agentScript: [],
    seed: async () => {},
  },
  async ({ core }) => {
    await core.call("project_register", { name: "Scratch", repoPath: core.repo, keyPrefix: "SCR" });
  },
);
