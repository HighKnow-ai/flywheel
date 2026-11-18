/**
 * The harness's own failure modes, against the real headless core: a connection without the token is
 * refused, an unknown command is an error, reads stay out of the trace, the trace can be reset, and a
 * flow whose diagram does not match its trace fails. A start that stalls names its phase (issue #1743), and
 * ending a core leaves no process of it, so its root can be removed.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startCore } from "./core";
import { flow } from "./fixtures";
import { HEADLESS_BIN } from "./stage.mjs";
import { removeScratch } from "./scratch";
import { seedFleetBoard } from "./seed";
import { FLEET_AGENT, FLEET_ENV } from "./agents/fleet-agent";

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

/** The processes whose command line holds the scratch folder's unique name, one line each. */
function processesOn(dir: string): string[] {
  const marker = path.basename(dir);
  return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(marker) && !/\bps -axo\b/.test(line));
}

/** The processes in the process group of `pid`. */
function groupOf(pid: number): string[] {
  return execFileSync("ps", ["-axo", "pgid=,pid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => Number(line.trim().split(/\s+/)[0]) === pid && !/\bps -axo\b/.test(line));
}

/** The pid of the grandchild a stubborn fake agent forks (`fake-claude.mjs`), which carries no scratch folder in its command line. */
function stubbornGrandchild(): number | null {
  const line = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .find((l) => l.includes("process.on('SIGINT', () => {}); console.log('ready')") && !/\bps -axo\b/.test(l));
  return line ? Number(line.trim().split(/\s+/)[0]) : null;
}

/** Whether `pid` runs now, and is no zombie (a zombie holds nothing). */
function runs(pid: number): boolean {
  try {
    const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return stat !== "" && !stat.startsWith("Z");
  } catch {
    return false; // `ps -p` exits 1 for a pid that is not there
  }
}

/** A process that writes into the core's `app-data/runtime` in a loop, and carries the scratch root in its command line, as an agent does. */
const LATE_WRITER = `
const fs = require("fs"), path = require("path");
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let n = 0; ; n++) {
  try {
    fs.mkdirSync(path.join(process.argv[1], "app-data", "runtime"), { recursive: true });
    fs.writeFileSync(path.join(process.argv[1], "app-data", "runtime", "late" + n), "x");
  } catch {}
  Atomics.wait(pause, 0, 0, 1);
}`;

// THE CONTROL OF THE END OF A FLOW (`scratch.ts`). On the gate (run 44204397397) a flow's teardown failed
// with ENOTEMPTY on `run/app-data/runtime`: a process of the core still wrote into the root when the
// harness removed it. The core's exit does not end its sidecar or its agents, and how long they linger
// depends on the load, so a real agent cannot make the test fail on demand. This one does what the late
// writer did, and the agent is stubborn (`FLYWHEEL_FAKE_STUBBORN`): it ignores the interrupt, and the
// sidecar ends it only after its grace. Without the reaping in `stop()` and `crash()` the writer outlives
// the core, and the first assertion after it fails.
for (const ending of ["stop", "crash"] as const) {
  test(`ending a core with ${ending}() leaves no process of it, so its root can be removed`, async ({
    browserName,
  }) => {
    test.skip(browserName !== "webkit", "the harness does not depend on the engine");
    const core = await startCore({
      agentScript: FLEET_AGENT,
      env: { ...FLEET_ENV, FLYWHEEL_FAKE_STUBBORN: "1" },
    });
    const tmp = path.dirname(core.root);
    const board = await seedFleetBoard(core);
    await core.call("story_start", { storyId: board.stories[0]!.id });
    // The agent has made its commits and is stubborn now: its grandchild runs.
    await expect.poll(stubbornGrandchild, { timeout: 60_000 }).not.toBeNull();
    const grandchild = stubbornGrandchild()!;
    expect(processesOn(tmp).some((l) => l.includes("fake-claude.mjs"))).toBe(true);
    expect(groupOf(core.pid).length).toBeGreaterThan(1); // the core, its sidecar and more
    const writer = spawn(process.execPath, ["-e", LATE_WRITER, core.root], { stdio: "ignore" });
    try {
      await expect.poll(() => fs.existsSync(path.join(core.root, "app-data", "runtime", "late5"))).toBe(true);

      await core[ending]();

      expect(runs(writer.pid!), "the late writer outlived the core").toBe(false);
    } finally {
      writer.kill("SIGKILL");
    }
    expect(processesOn(tmp)).toEqual([]);
    expect(groupOf(core.pid)).toEqual([]);
    expect(runs(grandchild)).toBe(false);
    expect(await removeScratch(tmp)).toBeNull();
    expect(fs.existsSync(tmp)).toBe(false);
  });
}

const LISTENING = /^listening on 127\.0\.0\.1:\d+$/;

/** The phases a core's stderr names, in order. */
const phasesOf = (log: string) =>
  log.split("\n").flatMap((l) => /^flywheel-headless: \[start\] @\d+ \+\d+ ms (.*)$/.exec(l)?.[1] ?? []);

test("a core's start leaves its phases in its log and in its timeline", async ({ browserName }) => {
  test.skip(browserName !== "webkit", "the harness does not depend on the engine");
  const core = await startCore({ agentScript: [] });
  try {
    // The order is the order of the start: the scratch root, the login shell, the repository, the app, the boot, the port.
    const order = [
      "main entered",
      "scratch root created",
      "login path adopted",
      "repository found, not seeded",
      "mock app and window built",
      "booting",
      "database opened and migrated",
      "projects, worktrees and sessions reconciled",
      "sidecar answered its readiness handshake",
      "AppState managed and scheduler spawned",
    ];
    const phases = phasesOf(core.log()).map((p) => p.replace(/^booting:.*/, "booting"));
    expect(phases.slice(0, -1)).toEqual(order);
    expect(phases.at(-1)).toMatch(LISTENING);
    const report = core.startReport();
    for (const event of ["spawn() returned", "first byte of stdout", "ready line read", "WebSocket open"])
      expect(report, event).toContain(event);
    expect(report).toContain("core:    sidecar answered its readiness handshake");
    // The repository came from the seed, not from nine `git` processes of the core's own.
    expect(report).toContain("scratch repository copied from the seed");
    // ... and its `origin` is the copy of the bare remote under this root, not the seed's own.
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", core.repo, ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      }).trim();
    expect(fs.realpathSync(git("remote", "get-url", "origin"))).toBe(
      fs.realpathSync(path.join(core.root, "remote.git")),
    );
    expect(git("ls-remote", "origin", "refs/heads/main")).toContain(git("rev-parse", "main"));
  } finally {
    await core.stop();
  }
});

test("a core that seeds its own repository logs each git call as a phase", async ({ browserName }) => {
  test.skip(browserName !== "webkit", "the harness does not depend on the engine");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-seed-test-"));
  try {
    // `--seed-only` is the seeding the harness runs once for each layout and copies into every start.
    const run = spawnSync(fs.realpathSync(HEADLESS_BIN), ["--seed-only", "--root", root], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(phasesOf(run.stderr).filter((p) => p.startsWith("git "))).toEqual([
      "git init done",
      "git init done",
      "git config user.email done",
      "git config user.name done",
      "git config commit.gpgsign done",
      "git add done",
      "git commit done",
      "git remote done",
      "git push done",
    ]);
    expect(fs.existsSync(path.join(root, "repo", ".git"))).toBe(true);
    expect(fs.existsSync(path.join(root, "remote.git", "HEAD"))).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A flow reads the trace while the core is still writing it (`expect.poll(() => core.trace()...)`). The core
// once wrote a line with `writeln!` on a bare file, which is many `write` calls, so a reader could see half
// a line and `JSON.parse` threw "Unterminated string" (the old code, a run on the gate runner's Mac, 2026-11-18).
test("a trace line is written whole: a reader of the file never sees half of one", async ({ browserName }) => {
  test.skip(browserName !== "webkit", "the harness does not depend on the engine");
  const core = await startCore({ agentScript: [] });
  try {
    const file = path.join(core.root, "trace.jsonl");
    const torn: string[] = [];
    let reads = 0;
    // The core writes in its own process while this loop reads, with no wait between two reads: how many
    // reads happen does not depend on how busy this process is. 40 batches of 40 commands, each batch read
    // for 5 ms while the core writes it. An unknown name is no read, so each call is one traced step.
    for (let batch = 0; batch < 40; batch++) {
      const replies = Array.from({ length: 40 }, () => core.call("no_such_command").catch(() => undefined));
      for (const until = performance.now() + 5; performance.now() < until; reads++) {
        const text = fs.readFileSync(file, "utf8");
        // Whatever follows the last newline is a line the core has not finished.
        const tail = text.slice(text.lastIndexOf("\n") + 1);
        if (tail !== "") torn.push(tail);
      }
      await Promise.all(replies);
    }
    expect(reads, "the reader ran while the core wrote").toBeGreaterThan(1000);
    expect(core.trace()).toHaveLength(1600);
    expect(torn).toEqual([]);
  } finally {
    await core.stop();
  }
});

/** A stand-in for the headless core: a script that says what it did, then does nothing. */
function stalledCore(lines: string[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-stalled-")), "stalled-core.mjs");
  const say = lines.map(
    (phase, n) => `console.error("flywheel-headless: [start] @" + Date.now() + " +${n * 5} ms ${phase}");`,
  );
  fs.writeFileSync(file, `#!/usr/bin/env node\n${say.join("\n")}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  return file;
}

test("a core that stalls after a phase is reported with that phase and ended", async ({ browserName }) => {
  test.skip(browserName !== "webkit", "the harness does not depend on the engine");
  const bin = stalledCore(["main entered", "git init done"]);
  const failure = await startCore({ agentScript: [], bin, readyLimitMs: 2_000 }).then(
    () => null,
    (error: Error) => error,
  );
  expect(failure, "the start of a core that never says it is ready must fail").not.toBeNull();
  const message = failure!.message;
  // The first line is the verdict, and it is the phase the core stopped in, not the limit alone.
  expect(message.split("\n")[0]).toMatch(
    /^the headless core was not ready in 2 s: the start stalled after the core's phase "git init done"/,
  );
  expect(message).toContain("core:    main entered");
  expect(message).toContain("gave up: no ready line in 2 s");
  expect(message).toContain("processes at the stall:");
  expect(message).toContain("stalled-core.mjs");
  expect(message).toContain("stacks of the core at the stall");
  // The core of a failed start is ended, and the report stays in its scratch folder.
  expect(execFileSync("ps", ["-axo", "command="], { encoding: "utf8" })).not.toContain(bin);
});

test("a core that says nothing is reported as one that never reached its main, with a snapshot of it while it waited", async ({
  browserName,
}) => {
  test.skip(browserName !== "webkit", "the harness does not depend on the engine");
  const bin = stalledCore([]);
  const failure = await startCore({ agentScript: [], bin, readyLimitMs: 6_500 }).then(
    () => null,
    (error: Error) => error,
  );
  expect(failure).not.toBeNull();
  expect(failure!.message.split("\n")[0]).toMatch(/not ready in 6\.5 s: the start stalled BEFORE the core's `main`/);
  // One snapshot of the core and its children while the harness waited (every 5 s), with its state and CPU.
  expect(failure!.message).toMatch(
    /still waiting: 0 bytes of stdout, 0 bytes of core log;\s+pid \d+ \(parent \d+\) state \S+ up \S+ cpu \S+ nice \d+: .*stalled-core\.mjs/,
  );
  expect(execFileSync("ps", ["-axo", "command="], { encoding: "utf8" })).not.toContain(bin);
});
