/**
 * Starts one headless core per test (`src-tauri/src/bin/flywheel-headless.rs`) and talks to it over
 * the same WebSocket the renderer uses, so a test seeds the board, and reads it back, through the
 * app's own commands. Nothing here opens the database or git directly.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_CLAUDE, HEADLESS_BIN } from "./stage.mjs";
import {
  loadNote,
  sampleProcess,
  snapshotProcesses,
  SNAPSHOT_EVERY_MS,
  START_LIMIT_MS,
  StartTimeline,
} from "./core-start";
import { reapProcesses } from "./scratch";
import type { TraceStep } from "./flow-doc";

export interface Core {
  /** The core's process id. It leads a process group of its own, with the sidecar and the agents in it. */
  pid: number;
  port: number;
  token: string;
  /** The scratch git repository (a clone of nothing: its own `main`, with a local bare `origin`). */
  repo: string;
  /** The folder registered as the project: `repo`, or `<repo>/flywheel` in the monorepo layout. */
  project: string;
  /** The scratch root: database, worktrees, trace and logs. */
  root: string;
  /** Run one command and return its result; a refusal rejects with the core's error value. */
  call<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Forget the trace so far: seeding is not part of a flow. */
  resetTrace(): Promise<void>;
  /** Trace the next scheduler tick that reports changed git facts (one step, `git_facts_tick`). */
  armSchedulerTrace(): Promise<void>;
  /** Every step the core traced since the last reset, in order. */
  trace(): TraceStep[];
  /** Kill -9 every agent process of this core, as a crash would: the session ends, the board keeps its answers. */
  killAgents(): number;
  /**
   * End the core the way a crash or a power cut does: SIGKILL, so it runs no exit step and the
   * database keeps every session it called running. A power cut ends the sidecar and the agents too, so
   * they are ended with it and none is left to write into the root the next core starts on. Then start
   * the next core on the same root with `startCore({ root: core.root })`.
   */
  crash(): Promise<void>;
  /** The core's own log: stderr, with the sidecar's. */
  log(): string;
  /** What the core did while it started, with the time each step took (issue #1743): a stall names its phase here. */
  startReport(): string;
  /**
   * End the core, and then every process that is left of it (the sidecar, the agents, a `git` in
   * flight): ask it to end, wait for it, kill what remains, wait until nothing runs on the root. After
   * it the root can be removed (`removeScratch`, `scratch.ts`).
   */
  stop(): Promise<void>;
}

/** What the scripted fake agent does, as `fake-claude.mjs` reads it (`FLYWHEEL_FAKE_BOARD_CALLS`). */
export type AgentScript = ReadonlyArray<Record<string, unknown>>;

export async function startCore(options: {
  agentScript: AgentScript;
  layout?: "monorepo";
  /** Start on the scratch root of an earlier core (its `root`): the board, repository and files stay. */
  root?: string;
  /** More environment for the core and, through it, the agent (for example `FLYWHEEL_FAKE_AWAIT_INTERRUPT`). */
  env?: Record<string, string>;
  /** Only the harness's own tests set these two: a stand-in for the core, and a shorter wait for its ready line. */
  bin?: string;
  readyLimitMs?: number;
}): Promise<Core> {
  const resumed = options.root !== undefined;
  const tmp = resumed ? path.dirname(options.root!) : fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-"));
  const root = resumed ? options.root! : path.join(tmp, "run");
  // One log per start: a restarted core must not overwrite the log of the one that crashed.
  let logPath = path.join(tmp, "core.log");
  for (let n = 2; fs.existsSync(logPath); n++) logPath = path.join(tmp, `core-${n}.log`);
  const log = fs.openSync(logPath, "w");
  // The scratch repository, copied from a seeded one: the core seeds it itself only when this fails.
  const planted = resumed || options.bin !== undefined ? "" : await plantSeed(options.layout, root);
  const timeline = new StartTimeline();
  if (planted) timeline.mark(planted);
  timeline.mark(`spawning ${path.basename(options.bin ?? HEADLESS_BIN)}, ${loadNote()}`);
  // From its real path: Tauri refuses, on macOS, an executable path through a symlink, and a
  // checkout reached through one would otherwise carry it (stage.mjs, BIN_DIR, says the rest).
  const child: ChildProcess = spawn(
    fs.realpathSync(options.bin ?? HEADLESS_BIN),
    ["--root", root, ...(options.layout ? ["--layout", options.layout] : [])],
    {
      stdio: ["pipe", "pipe", log],
      // A process group of its own: the core, the sidecar and the agents are in it, and one signal reaches
      // all of them (`reapProcesses`). The core still ends when the harness dies, because its stdin closes.
      detached: true,
      env: {
        ...process.env,
        // No real `claude`, no tokens: the scripted fake agent is the backend leaf.
        FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE,
        FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(options.agentScript),
        ...options.env,
      },
    },
  );
  timeline.mark(`spawn() returned, pid ${child.pid}`);
  // The event fires when the binary has been executed: the gap from `spawn()` to it is the time the
  // system took to load it, before any line of the core's own.
  child.once("spawn", () => timeline.mark("exec done (the binary is running)"));
  const readLog = () => {
    try {
      return fs.readFileSync(logPath, "utf8");
    } catch {
      return "";
    }
  };
  /** The timeline and the core's own phases, kept next to its log, so a failed start leaves both. */
  const saveReport = (extra = "") => {
    const text = `${timeline.report(readLog())}${extra}\n`;
    fs.writeFileSync(path.join(tmp, "core-start.log"), text);
    return text;
  };
  // Whatever goes wrong between the spawn and the open socket ends the core it started, and what the core
  // had started: a core left running by a failed start would go on loading the machine for the tests after it.
  const abandon = async (error: unknown): Promise<never> => {
    child.kill("SIGKILL");
    fs.closeSync(log);
    await reapProcesses({ group: child.pid, marker: path.basename(tmp) });
    throw error;
  };

  let ready: { port: number; token: string; repo: string; project: string; root: string };
  try {
    ready = await waitForReady(child, timeline, {
      limitMs: options.readyLimitMs ?? START_LIMIT_MS,
      readLog,
      saveReport,
      samplePath: path.join(tmp, "core-start-sample.txt"),
    });
  } catch (error) {
    return abandon(error);
  }

  const socket = new WebSocket(`ws://127.0.0.1:${ready.port}/?token=${ready.token}`);
  timeline.mark("connecting the WebSocket");
  try {
    await new Promise<void>((resolve, reject) => {
      const giveUp = setTimeout(
        () => reject(new Error(`the harness could not connect to its core in 30 s:\n${saveReport()}`)),
        30_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(giveUp);
          timeline.mark("WebSocket open", "socket");
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(giveUp);
          reject(new Error(`the harness could not connect to its core:\n${saveReport()}`));
        },
        { once: true },
      );
    });
  } catch (error) {
    socket.close();
    return abandon(error);
  }
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();
  socket.addEventListener("message", (message) => {
    const reply = JSON.parse(String(message.data)) as { id?: number; ok?: unknown; err?: unknown; event?: string };
    if (reply.event !== undefined || reply.id === undefined) return;
    const call = pending.get(reply.id);
    pending.delete(reply.id);
    if (!call) return;
    if ("err" in reply) call.reject(new Error(`${JSON.stringify(reply.err)}`));
    else call.resolve(reply.ok as never);
  });
  const call = <T>(cmd: string, args: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: never) => void, reject });
      socket.send(JSON.stringify({ id, cmd, args }));
    });

  let stopped = false;
  /**
   * Whatever of this core is still running: its process group, and every process whose command line holds
   * the scratch folder's unique name, with their children. The core's exit does not end them, and a flow
   * that removes the root while one still writes fails its teardown with ENOTEMPTY (`scratch.ts`).
   */
  const reap = async () => {
    const left = await reapProcesses({ group: child.pid, marker: path.basename(tmp) });
    if (left.length > 0) console.warn(`the core's processes could not be ended: ${left.join("; ")}`);
  };
  const tracePath = path.join(ready.root, "trace.jsonl");
  return {
    ...ready,
    pid: child.pid!,
    call,
    resetTrace: () => call<void>("__trace_reset"),
    armSchedulerTrace: () => call<void>("__trace_arm_tick"),
    trace: () =>
      // Only lines that end in a newline are steps: the core may be writing the next one (it writes each in
      // one `write`, so a reader sees a whole line or none; this keeps a reader right if that ever changes).
      fs
        .readFileSync(tracePath, "utf8")
        .split("\n")
        .slice(0, -1)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceStep),
    killAgents() {
      // Only this run's own agents: their command lines carry this run's scratch root.
      const table = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
      const pids = table
        .split("\n")
        .filter((line) => line.includes("fake-claude.mjs") && line.includes(ready.root))
        .map((line) => Number(line.trim().split(/\s+/)[0]));
      for (const pid of pids) process.kill(pid, "SIGKILL");
      return pids.length;
    },
    log: () => fs.readFileSync(logPath, "utf8"),
    startReport: () => timeline.report(readLog()),
    async crash() {
      socket.close();
      stopped = true;
      const gone = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
      child.kill("SIGKILL");
      await gone;
      fs.closeSync(log);
      await reap();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      socket.close();
      // The core ends its sessions and the sidecar when stdin closes, as the app does on quit.
      child.stdin!.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
      });
      fs.closeSync(log);
      await reap();
    },
  };
}

/**
 * Wait for the core's ready line (one JSON line on stdout) and say what happened meanwhile. Gives up at
 * `limitMs`: it names the phase the core stopped in, takes a `sample` of its stacks, ends it and fails
 * with the whole timeline, which `saveReport` also keeps in the scratch folder.
 */
function waitForReady(
  child: ChildProcess,
  timeline: StartTimeline,
  how: { limitMs: number; readLog(): string; saveReport(extra?: string): string; samplePath: string },
): Promise<{ port: number; token: string; repo: string; project: string; root: string }> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    let stdoutBytes = 0;
    let stalled = false;
    // Cleared once the core is ready or has failed: a timer left running would read the log of a test
    // whose scratch folder is gone by then, and fail whichever longer test is running at that moment.
    const stop = () => {
      clearTimeout(limit);
      clearInterval(beat);
    };

    child.once("exit", (code, signal) => {
      timeline.mark(`the core exited (code ${code}, signal ${signal})`);
      // After the harness gave up, the stall's own report is the error, not this exit.
      if (stalled) return;
      stop();
      reject(new Error(`the headless core exited (${code}) before it was ready:\n${how.saveReport()}`));
    });
    child.once("error", (err) => {
      stop();
      reject(new Error(`the headless core could not be spawned: ${err.message}\n${how.saveReport()}`));
    });

    // The attempts a stalled start can be told by: the core's readiness is one line, so there is nothing
    // to retry, and this looks at the core instead, every few seconds.
    const beat = setInterval(() => {
      if (stalled || child.pid === undefined) return;
      void snapshotProcesses(child.pid).then((rows) => {
        timeline.mark(
          `still waiting: ${stdoutBytes} bytes of stdout, ${how.readLog().length} bytes of core log;\n${rows
            .map((r) => `                  ${r}`)
            .join("\n")}`,
        );
      });
    }, SNAPSHOT_EVERY_MS);
    beat.unref();

    const limit = setTimeout(() => {
      stalled = true;
      stop();
      void (async () => {
        const seconds = how.limitMs / 1000;
        timeline.mark(`gave up: no ready line in ${seconds} s`);
        const rows = child.pid === undefined ? ["no pid"] : await snapshotProcesses(child.pid);
        const sample = child.pid === undefined ? "no pid" : await sampleProcess(child.pid, how.samplePath);
        child.kill("SIGKILL");
        const where = timeline.stalledAt(how.readLog());
        reject(
          new Error(
            `the headless core was not ready in ${seconds} s: the start stalled ${where}\n` +
              `${how.saveReport(`\nprocesses at the stall:\n${rows.map((r) => `  ${r}`).join("\n")}\n` + `stacks of the core at the stall (full sample: ${how.samplePath}):\n${sample}`)}`,
          ),
        );
      })();
    }, how.limitMs);
    limit.unref();

    child.stdout!.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (!timeline.sawStdout) timeline.mark(`first byte of stdout (${chunk.length} bytes)`, "stdout");
      buffered += chunk;
      const line = buffered.split("\n").find((l) => l.startsWith("{"));
      if (line) {
        stop();
        timeline.mark("ready line read", "ready");
        resolve(JSON.parse(line));
      }
    });
  });
}

/**
 * One seeded scratch repository for each layout in this process, made once by the core itself
 * (`flywheel-headless --seed-only`) and copied for every start. Seeding is nine `git` processes, and at
 * background priority on a loaded Mac each one took half a second to a second (the start report of
 * issue #1743 shows it): most of a start. A copy costs no process, and the core, finding `repo/.git`
 * under its root, keeps the repository it finds, as it does when it restarts on a crashed core's root.
 */
const seeds = new Map<string, Promise<string>>();

function seedFor(layout: "monorepo" | undefined): Promise<string> {
  const key = layout ?? "root";
  let seed = seeds.get(key);
  if (seed === undefined) {
    seed = makeSeed(layout);
    seeds.set(key, seed);
    // A seed that failed is not kept: the next start tries again.
    seed.catch(() => seeds.delete(key));
  }
  return seed;
}

async function makeSeed(layout: "monorepo" | undefined): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-seed-"));
  process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      fs.realpathSync(HEADLESS_BIN),
      ["--seed-only", "--root", dir, ...(layout ? ["--layout", layout] : [])],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`seeding the scratch repository failed (${code}):\n${stderr}`)),
    );
  });
  return fs.realpathSync(dir);
}

/**
 * Copy the seed into `root` (APFS clones, so no bytes move) and point the repository's `origin` at the
 * copy of the bare remote: the one absolute path the seed holds is its own remote's. Returns what it did
 * for the start report, or "" when it could not, and then leaves `root` as it found it.
 */
async function plantSeed(layout: "monorepo" | undefined, root: string): Promise<string> {
  const began = performance.now();
  try {
    const seed = await seedFor(layout);
    fs.mkdirSync(root, { recursive: true });
    const canonical = fs.realpathSync(root);
    for (const name of ["repo", "remote.git"])
      await fs.promises.cp(path.join(seed, name), path.join(canonical, name), {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE,
      });
    const config = path.join(canonical, "repo", ".git", "config");
    const text = fs.readFileSync(config, "utf8");
    const [from, to] = [path.join(seed, "remote.git"), path.join(canonical, "remote.git")];
    if (!text.includes(from)) throw new Error(`the seeded repository's config does not name its remote ${from}`);
    fs.writeFileSync(config, text.replaceAll(from, to));
    return `scratch repository copied from the seed in ${Math.round(performance.now() - began)} ms (no git process)`;
  } catch (error) {
    for (const name of ["repo", "remote.git"]) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    console.warn(`flywheel e2e: the seed was not copied, the core seeds the repository itself: ${String(error)}`);
    return "";
  }
}
