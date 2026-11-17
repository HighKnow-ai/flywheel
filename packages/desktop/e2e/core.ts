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
import type { TraceStep } from "./flow-doc";

export interface Core {
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
   * database keeps every session it called running. The sidecar notices its closed stdin and goes.
   * Then start the next core on the same root with `startCore({ root: core.root })`.
   */
  crash(): Promise<void>;
  /** The core's own log: stderr, with the sidecar's. */
  log(): string;
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
}): Promise<Core> {
  const resumed = options.root !== undefined;
  const tmp = resumed ? path.dirname(options.root!) : fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-"));
  const root = resumed ? options.root! : path.join(tmp, "run");
  // One log per start: a restarted core must not overwrite the log of the one that crashed.
  let logPath = path.join(tmp, "core.log");
  for (let n = 2; fs.existsSync(logPath); n++) logPath = path.join(tmp, `core-${n}.log`);
  const log = fs.openSync(logPath, "w");
  // From its real path: Tauri refuses, on macOS, an executable path through a symlink, and a
  // checkout reached through one would otherwise carry it (stage.mjs, BIN_DIR, says the rest).
  const child: ChildProcess = spawn(
    fs.realpathSync(HEADLESS_BIN),
    ["--root", root, ...(options.layout ? ["--layout", options.layout] : [])],
    {
      stdio: ["pipe", "pipe", log],
      env: {
        ...process.env,
        // No real `claude`, no tokens: the scripted fake agent is the backend leaf.
        FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE,
        FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(options.agentScript),
        ...options.env,
      },
    },
  );
  const ready = await new Promise<{ port: number; token: string; repo: string; project: string; root: string }>(
    (resolve, reject) => {
      let buffered = "";
      child.once("exit", (code) =>
        reject(
          new Error(`the headless core exited (${code}) before it was ready:\n${fs.readFileSync(logPath, "utf8")}`),
        ),
      );
      // Cleared once the core is ready: a timer left running would read the log of a test whose scratch
      // folder is gone by then, and fail whichever longer test is running at that moment.
      const notReady = setTimeout(
        () => reject(new Error(`the headless core was not ready in 60 s:\n${fs.readFileSync(logPath, "utf8")}`)),
        60_000,
      );
      notReady.unref();
      child.stdout!.on("data", (chunk) => {
        buffered += chunk;
        const line = buffered.split("\n").find((l) => l.startsWith("{"));
        if (line) {
          clearTimeout(notReady);
          resolve(JSON.parse(line));
        }
      });
    },
  );

  const socket = new WebSocket(`ws://127.0.0.1:${ready.port}/?token=${ready.token}`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("the harness could not connect to its core")), {
      once: true,
    });
  });
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
  const tracePath = path.join(ready.root, "trace.jsonl");
  return {
    ...ready,
    call,
    resetTrace: () => call<void>("__trace_reset"),
    armSchedulerTrace: () => call<void>("__trace_arm_tick"),
    trace: () =>
      fs
        .readFileSync(tracePath, "utf8")
        .split("\n")
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
    async crash() {
      socket.close();
      stopped = true;
      const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await gone;
      fs.closeSync(log);
    },
    async stop() {
      if (stopped) return;
      socket.close();
      // The core ends its sessions and the sidecar when stdin closes, as the app does on quit.
      child.stdin!.end();
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        if (child.exitCode !== null) resolve();
      });
      fs.closeSync(log);
    },
  };
}
