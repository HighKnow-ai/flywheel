/**
 * What the harness records while a headless core starts, and what it says when the start stalls
 * (issue #1743). One run, under `taskpolicy -b` at a load average of 38, threw "the headless core was
 * not ready in 60 s" with an empty core log: nothing said whether the binary never loaded, `git`
 * hung, the database was slow or the sidecar did not answer. Now the failure carries a timeline.
 *
 * Three clocks meet in it, and the report puts them in one list:
 *
 * - the harness's own events (spawn, the first byte of output, the ready line, the WebSocket), timed
 *   from the spawn;
 * - the core's phase lines on stderr (`flywheel-headless: [start] @<epoch ms> +<ms since main> ms
 *   <phase>`, written by `StartClock` in `src-tauri/src/bin/flywheel-headless.rs`), placed by their
 *   epoch. The gap from the spawn to the first of them is the time the binary took to load, which no
 *   line of the core can show;
 * - a snapshot of the core and its children every few seconds while the harness waits, and, when it
 *   gives up, a `sample` of the core's stacks: the readiness of the core is ONE line on stdout and
 *   there is no probe to repeat, so these are the attempts a stalled start can be told by.
 *
 * Nothing here starts a process of its own except `ps` and `sample`, and only to look.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

/** How long the harness waits for the core's ready line. Raising it hides a stall; read the report instead. */
export const START_LIMIT_MS = 60_000;
/** How often a snapshot of the core and its children joins the timeline while the harness waits. */
export const SNAPSHOT_EVERY_MS = 5_000;

const PHASE_LINE = /^flywheel-headless: \[start\] @(\d+) \+(\d+) ms (.*)$/;

export interface CorePhase {
  /** The core's wall clock when the phase ended, in ms since the epoch. */
  epochMs: number;
  /** ms since the core's `main` began. */
  sinceMainMs: number;
  phase: string;
}

/** The phase lines of a core log, in order, and every other line (what the core printed besides). */
export function parseCoreLog(log: string): { phases: CorePhase[]; other: string[] } {
  const phases: CorePhase[] = [];
  const other: string[] = [];
  for (const line of log.split("\n")) {
    if (line.trim() === "") continue;
    const m = PHASE_LINE.exec(line);
    if (m) phases.push({ epochMs: Number(m[1]), sinceMainMs: Number(m[2]), phase: m[3]! });
    else other.push(line);
  }
  return { phases, other };
}

/** `s`, cut to `max` characters with an ellipsis. */
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * The processes under `rootPid` (itself and its descendants) from the output of
 * `ps -axo pid=,ppid=,stat=,etime=,time=,nice=,command=`, one line each: process id, parent, state
 * (`U` is an uninterruptible wait, the state of a process stuck in the kernel), time since it
 * started, CPU time it used, nice value and its command.
 */
export function processTree(psTable: string, rootPid: number): string[] {
  const rows = new Map<number, { ppid: number; text: string }>();
  for (const line of psTable.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(-?\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, stat, etime, cpu, nice, command] = m;
    rows.set(Number(pid), {
      ppid: Number(ppid),
      text: `pid ${pid} (parent ${ppid}) state ${stat} up ${etime} cpu ${cpu} nice ${nice}: ${clip(command!, 110)}`,
    });
  }
  if (!rows.has(rootPid)) return [`pid ${rootPid} is not in the process table: the core has exited`];
  const keep = new Set<number>([rootPid]);
  // ps lists a child after nothing in particular: grow the set until no row joins it.
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, row] of rows) {
      if (!keep.has(pid) && keep.has(row.ppid)) {
        keep.add(pid);
        grew = true;
      }
    }
  }
  return [...keep].sort((a, b) => a - b).map((pid) => rows.get(pid)!.text);
}

/** The processes of the core right now, from `ps`; a line that says why when `ps` cannot answer. */
export function snapshotProcesses(rootPid: number): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,stat=,etime=,time=,nice=,command="],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 16 << 20 },
      (err, stdout) => resolve(err ? [`ps failed: ${err.message}`] : processTree(stdout, rootPid)),
    );
  });
}

/** The thread stacks of the "Call graph" in a macOS `sample` report, cut to `max` lines. */
export function callGraph(report: string, max = 40): string {
  const start = report.indexOf("Call graph:");
  if (start < 0) return clip(report.trim(), 600);
  const end = report.indexOf("Total number in stack", start);
  const lines = report
    .slice(start, end < 0 ? undefined : end)
    .trimEnd()
    .split("\n");
  return lines.length <= max
    ? lines.join("\n")
    : `${lines.slice(0, max).join("\n")}\n    … (${lines.length - max} more lines in the sample file)`;
}

/**
 * Sample the core's stacks for one second with macOS `sample`, save the whole report to `file`, and
 * return its call graph. It says why when it cannot: a core that never left `exec` may not be
 * sampled, and that is itself a finding.
 */
export function sampleProcess(pid: number, file: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("/usr/bin/sample", [String(pid), "1", "-file", file], { timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) {
        resolve(`sample could not read pid ${pid}: ${(String(stderr) || String(stdout) || err.message).trim()}`);
        return;
      }
      try {
        resolve(callGraph(fs.readFileSync(file, "utf8")));
      } catch (readErr) {
        resolve(`sample wrote no report for pid ${pid}: ${String(readErr)}`);
      }
    });
  });
}

export interface Clocks {
  /** Monotonic ms. */
  now(): number;
  /** Wall clock, ms since the epoch: the clock the core's phase lines carry. */
  epoch(): number;
}

const REAL_CLOCKS: Clocks = { now: () => performance.now(), epoch: () => Date.now() };

/** The record of one core start: what the harness saw and when, with the core's own phases merged in. */
export class StartTimeline {
  private readonly clocks: Clocks;
  private readonly began: number;
  private readonly beganEpoch: number;
  private readonly events: { at: number; text: string }[] = [];
  private seen = { stdout: false, ready: false, socket: false };

  constructor(clocks: Clocks = REAL_CLOCKS) {
    this.clocks = clocks;
    this.began = clocks.now();
    this.beganEpoch = clocks.epoch();
  }

  /** Note a harness event. `kind` marks the three that decide what a stall is called. */
  mark(text: string, kind?: "stdout" | "ready" | "socket"): void {
    if (kind) this.seen[kind] = true;
    this.events.push({ at: Math.round(this.clocks.now() - this.began), text });
  }

  /** ms since the spawn. */
  elapsed(): number {
    return Math.round(this.clocks.now() - this.began);
  }

  /** Whether the first byte of the core's stdout has arrived. */
  get sawStdout(): boolean {
    return this.seen.stdout;
  }

  /**
   * The timeline, one event per line, the core's phases among them in time order. A phase is placed
   * by its epoch against the spawn's, so the two clocks must be the machine's one clock: they are.
   */
  report(coreLog: string): string {
    const { phases, other } = parseCoreLog(coreLog);
    const merged = [
      ...this.events.map((e) => ({ at: e.at, text: `harness: ${e.text}` })),
      ...phases.map((p) => ({
        at: p.epochMs - this.beganEpoch,
        text: `core:    ${p.phase} (core +${p.sinceMainMs} ms)`,
      })),
    ].sort((a, b) => a.at - b.at);
    const rows = merged.map((e) => `  +${String(e.at).padStart(6)} ms  ${e.text}`);
    const stderr = other.length === 0 ? "  (nothing besides the phase lines)" : other.map((l) => `  ${l}`).join("\n");
    return [
      "start timeline (ms from the harness's spawn):",
      ...rows,
      "core stderr, the lines that are no phase:",
      stderr,
    ].join("\n");
  }

  /**
   * Where a start that did not finish stopped, in words: the last thing the core said it had done, or
   * the earlier stage that has no line of the core's.
   */
  stalledAt(coreLog: string): string {
    const { phases } = parseCoreLog(coreLog);
    const last = phases.at(-1);
    if (this.seen.socket) return "after the WebSocket opened (nothing further is waited for)";
    if (this.seen.ready)
      return "between the ready line and the WebSocket opening: the server did not accept the connection";
    if (last) {
      const ago = Math.round((this.clocks.epoch() - last.epochMs) / 100) / 10;
      return `after the core's phase "${last.phase}" (core +${last.sinceMainMs} ms), ${ago} s ago: the next phase did not end`;
    }
    return "BEFORE the core's `main`: the binary was loading or never ran (no phase line, no byte of output)";
  }
}

/** The harness's load, for the head of a timeline: a stall under load is read against the load. */
export function loadNote(): string {
  const [one, five, fifteen] = os.loadavg().map((n) => n.toFixed(1));
  return `load average ${one} ${five} ${fifteen} (1, 5, 15 min), ${os.cpus().length} cpus`;
}
