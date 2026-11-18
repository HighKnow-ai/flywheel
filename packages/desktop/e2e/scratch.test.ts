/**
 * The end of a flow's scratch root (`scratch.ts`): what a late writer must not be able to do. On the
 * gate a flow's teardown failed with ENOTEMPTY because a process of the core was still writing into the
 * folder the harness removed. These tests run real processes: a stand-in for the sidecar and one for an
 * agent, and a writer that does what the late one did.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ownedProcesses, parseProcessTable, reapProcesses, removeScratch } from "./scratch";

/** Every child a test started, ended in `afterEach` whatever the test did. */
const started: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const child of started.splice(0)) if (child.pid) tryKill(child.pid);
  // A SIGKILLed writer may still be mid-write for a moment: retry the removal, as `removeScratch` does (it flaked
  // with ENOTEMPTY on the pre-push gate without the retries).
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function tryKill(pid: number, signal: NodeJS.Signals = "SIGKILL") {
  try {
    process.kill(pid, signal);
  } catch {
    // Gone already.
  }
}

/** A scratch folder with a name no other has, as a flow's is. */
function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-"));
  dirs.push(dir);
  return dir;
}

/** Alive: in the table and not a zombie (a zombie holds nothing). */
function alive(pid: number): boolean {
  const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return stat !== "" && !stat.startsWith("Z");
}

const aliveAfter = (pid: number) => {
  try {
    return alive(pid);
  } catch {
    return false; // `ps -p` exits 1 for a pid that is not there
  }
};

/** Starts `node -e code args...` and resolves with the pids it printed on stdout (one JSON line). */
function run<Pids>(code: string, args: string[], options: { detached?: boolean } = {}) {
  const child = spawn(process.execPath, ["-e", code, ...args], { stdio: ["ignore", "pipe", "ignore"], ...options });
  started.push(child);
  const pids = new Promise<Pids>((resolve) => {
    let text = "";
    child.stdout!.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) resolve(JSON.parse(text.split("\n")[0]!));
    });
  });
  return { child, pids };
}

/** The late writer: recreates the folder it writes in, in a loop, as a process that was never told to stop does. */
const WRITER = `
const fs = require("fs"), path = require("path");
const dir = process.argv[1];
console.log(JSON.stringify({ writer: process.pid }));
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let n = 0; ; n++) {
  try {
    fs.mkdirSync(path.join(dir, "app-data", "runtime"), { recursive: true });
    // A few names, written again and again: a tree that grows without bound makes lsof and the removal slow.
    fs.writeFileSync(path.join(dir, "app-data", "runtime", "w" + (n % 4)), "x");
  } catch {}
  Atomics.wait(pause, 0, 0, 1);
}`;

describe("parseProcessTable and ownedProcesses", () => {
  const TABLE = parseProcessTable(
    [
      "    1     0     1 Ss   /sbin/launchd",
      "  500   400   500 S+   /usr/bin/node playwright worker",
      "  600     1   600 S    flywheel-headless --root /tmp/flywheel-e2e-AbC123/run",
      "  610   600   600 S    node dist/index.js",
      "  620   610   620 S    fake-claude.mjs /tmp/flywheel-e2e-AbC123/run/worktrees/FLY-2",
      "  630     1   630 S    fake-claude.mjs /tmp/flywheel-e2e-AbC123/run/worktrees/FLY-3",
      "  640   630   640 Z    (defunct)",
      "  700     1   700 S    node some-other-flow's-sidecar /tmp/flywheel-e2e-ZzZ999/run",
    ].join("\n"),
  );

  it("takes the group, the command lines that hold the folder's name, and what is below them", () => {
    const owned = ownedProcesses(TABLE, { group: 600, marker: "flywheel-e2e-AbC123", except: new Set([500]) });
    expect(owned.map((r) => r.pid)).toEqual([600, 610, 620, 630]);
  });

  it("leaves the processes of another flow, the harness and a zombie alone", () => {
    const owned = ownedProcesses(TABLE, { group: 600, marker: "flywheel-e2e-AbC123", except: new Set([600, 500]) });
    expect(owned.map((r) => r.pid)).not.toContain(700);
    expect(owned.map((r) => r.pid)).not.toContain(500);
    expect(owned.map((r) => r.pid)).not.toContain(640);
  });
});

describe("reapProcesses", () => {
  it("ends what is left of a core after the core itself has gone: its group, and an agent in a group of its own", async () => {
    const dir = scratchDir();
    const marker = path.basename(dir);
    // The core: leads a group, starts a sidecar in it and an agent in a group of its own that carries the
    // folder in its command line, prints their pids, and exits at once, as a core that ends leaves them.
    const CORE = `
      const { spawn } = require("child_process");
      const idle = "setInterval(() => {}, 1000)";
      const sidecar = spawn(process.execPath, ["-e", idle], { stdio: "ignore" });
      const agent = spawn(process.execPath, ["-e", idle, process.argv[1]], { stdio: "ignore", detached: true });
      console.log(JSON.stringify({ core: process.pid, sidecar: sidecar.pid, agent: agent.pid }));
      setTimeout(() => process.exit(0), 100);`;
    const { child, pids } = run<{ core: number; sidecar: number; agent: number }>(CORE, [dir], { detached: true });
    const { core, sidecar, agent } = await pids;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    expect(aliveAfter(sidecar)).toBe(true);
    expect(aliveAfter(agent)).toBe(true);

    const left = await reapProcesses({ group: core, marker });

    expect(left).toEqual([]);
    expect(aliveAfter(sidecar)).toBe(false);
    expect(aliveAfter(agent)).toBe(false);
  }, 30_000);

  it("leaves a process of no core alone", async () => {
    const dir = scratchDir();
    const { pids } = run<{ other: number }>(
      `console.log(JSON.stringify({ other: process.pid })); setInterval(() => {}, 1000)`,
      [],
    );
    const { other } = await pids;
    expect(await reapProcesses({ group: undefined, marker: path.basename(dir), waitMs: 500 })).toEqual([]);
    expect(aliveAfter(other)).toBe(true);
  }, 30_000);
});

describe("removeScratch", () => {
  it("removes a folder nothing writes to, and a folder that is already gone", async () => {
    const dir = scratchDir();
    fs.mkdirSync(path.join(dir, "run", "app-data", "runtime"), { recursive: true });
    fs.writeFileSync(path.join(dir, "run", "app-data", "runtime", "sock"), "");
    expect(await removeScratch(dir)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
    expect(await removeScratch(dir)).toBeNull();
  });

  it("does not throw when a late writer defeats the removal, and names the writer", async () => {
    const dir = scratchDir();
    const { pids } = run<{ writer: number }>(WRITER, [dir]);
    const { writer } = await pids;
    // The removal that the gate's teardown had: a recursive remove that finds the folder not empty.
    const refused = Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${dir}/run/app-data/runtime'`), {
      code: "ENOTEMPTY",
    });
    const message = await removeScratch(dir, () => Promise.reject(refused));
    expect(message).toContain("ENOTEMPTY");
    expect(message).toContain(dir);
    expect(message).toContain(`pid ${writer}`);
    expect(message).toContain("still held by");
    // The `lsof` and the `ps` the message came from carry the folder in their command lines: they are no holders.
    expect(message).not.toMatch(/lsof|\bps -axo/);
  }, 30_000);

  it("survives the real removal beside a live writer without throwing, and succeeds once the writer is gone", async () => {
    const dir = scratchDir();
    const { pids } = run<{ writer: number }>(WRITER, [dir]);
    const { writer } = await pids;
    // Either outcome is right here: the writer may lose the race or win it. What must hold is that it returns.
    const during = await removeScratch(dir);
    if (during !== null) expect(during).toContain(`pid ${writer}`);
    tryKill(writer);
    await reapProcesses({ group: undefined, marker: path.basename(dir) });
    expect(await removeScratch(dir)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
  }, 30_000);
});
